import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { computeCommission } from "../pricing/formula";
import { getAppConfig } from "../shared/config";
import { db } from "../shared/firebase";
import { notify } from "../shared/notify";
import { parseRideId, requireDriver } from "../shared/validate";

const MAX_PIN_ATTEMPTS = 5;

/** Le chauffeur accepte la course qu'on lui propose. Transaction : un seul chauffeur peut gagner. */
export const acceptRide = onCall(async (request) => {
  const uid = requireDriver(request);
  const rideId = parseRideId((request.data as { rideId?: unknown })?.rideId);
  const rideRef = db.doc(`rides/${rideId}`);
  const driverRef = db.doc(`drivers/${uid}`);

  const passengerId = await db.runTransaction(async (t) => {
    const [rideSnap, driverSnap] = await Promise.all([t.get(rideRef), t.get(driverRef)]);
    const ride = rideSnap.data();
    const driver = driverSnap.data();
    if (!ride) throw new HttpsError("not-found", "Course introuvable.");
    if (!driver || driver.status !== "approved") throw new HttpsError("permission-denied", "Compte chauffeur non validé.");
    if (driver.currentRideId) throw new HttpsError("failed-precondition", "Vous avez déjà une course.");
    if (ride.status !== "searching" || ride.offer?.driverId !== uid) {
      throw new HttpsError("failed-precondition", "Cette course n'est plus disponible.");
    }
    // 2 s de tolérance pour les réseaux lents.
    if ((ride.offer.expiresAt as Timestamp).toMillis() + 2000 < Date.now()) {
      throw new HttpsError("deadline-exceeded", "Le délai pour accepter est dépassé.");
    }

    const ratingCount = (driver.ratingCount as number) ?? 0;
    t.update(rideRef, {
      status: "driver_assigned",
      driverId: uid,
      driver: {
        name: driver.name ?? "",
        photoUrl: driver.photoUrl ?? null,
        rating: ratingCount > 0 ? Math.round((driver.ratingSum / ratingCount) * 10) / 10 : null,
        vehicle: driver.vehicle ?? null, // { model, color, plate }
      },
      offer: null,
      assignedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    t.update(driverRef, { currentRideId: rideId });
    return ride.passengerId as string;
  });

  await notify(
    "users",
    passengerId,
    { type: "driver_assigned", rideId },
    { title: "Chauffeur trouvé", body: "Votre chauffeur arrive." },
  );
  return { ok: true };
});

/** Le chauffeur refuse : la recherche passe tout de suite au chauffeur suivant. */
export const declineRide = onCall(async (request) => {
  const uid = requireDriver(request);
  const rideId = parseRideId((request.data as { rideId?: unknown })?.rideId);
  const rideRef = db.doc(`rides/${rideId}`);
  await db.runTransaction(async (t) => {
    const ride = (await t.get(rideRef)).data();
    if (ride?.status === "searching" && ride.offer?.driverId === uid) {
      t.update(rideRef, { "offer.declined": true, updatedAt: FieldValue.serverTimestamp() });
    }
  });
  return { ok: true };
});

/** Le chauffeur signale qu'il est au point de départ. */
export const driverArrived = onCall(async (request) => {
  const uid = requireDriver(request);
  const rideId = parseRideId((request.data as { rideId?: unknown })?.rideId);
  const rideRef = db.doc(`rides/${rideId}`);
  const passengerId = await db.runTransaction(async (t) => {
    const ride = (await t.get(rideRef)).data();
    if (!ride || ride.driverId !== uid) throw new HttpsError("permission-denied", "Ce n'est pas votre course.");
    if (ride.status !== "driver_assigned") throw new HttpsError("failed-precondition", "Statut incorrect.");
    t.update(rideRef, {
      status: "driver_arrived",
      arrivedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return ride.passengerId as string;
  });
  await notify(
    "users",
    passengerId,
    { type: "driver_arrived", rideId },
    { title: "Votre chauffeur est là", body: "Donnez-lui votre code à 4 chiffres." },
  );
  return { ok: true };
});

/** Démarrage de la course avec le code PIN donné par le passager. */
export const startRide = onCall(async (request) => {
  const uid = requireDriver(request);
  const data = (request.data ?? {}) as { rideId?: unknown; pin?: unknown };
  const rideId = parseRideId(data.rideId);
  const pin = typeof data.pin === "string" ? data.pin.trim() : "";
  if (!/^\d{4}$/.test(pin)) throw new HttpsError("invalid-argument", "Le code doit avoir 4 chiffres.");

  const rideRef = db.doc(`rides/${rideId}`);
  const pinRef = rideRef.collection("private").doc("pin");

  // On ne lance pas d'erreur dans la transaction en cas de mauvais code,
  // sinon le compteur de tentatives ne serait pas enregistré.
  const outcome = await db.runTransaction(async (t) => {
    const [rideSnap, pinSnap] = await Promise.all([t.get(rideRef), t.get(pinRef)]);
    const ride = rideSnap.data();
    if (!ride || ride.driverId !== uid) throw new HttpsError("permission-denied", "Ce n'est pas votre course.");
    if (ride.status !== "driver_assigned" && ride.status !== "driver_arrived") {
      throw new HttpsError("failed-precondition", "La course ne peut pas démarrer.");
    }
    const attempts = (ride.pinAttempts as number) ?? 0;
    if (attempts >= MAX_PIN_ATTEMPTS) return "locked" as const;
    if (pinSnap.get("pin") !== pin) {
      t.update(rideRef, { pinAttempts: attempts + 1 });
      return "wrong" as const;
    }
    t.update(rideRef, {
      status: "in_progress",
      startedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return "ok" as const;
  });

  if (outcome === "locked") {
    throw new HttpsError("resource-exhausted", "Trop de codes faux. Contactez le support.");
  }
  if (outcome === "wrong") throw new HttpsError("permission-denied", "Code incorrect.");
  return { ok: true };
});

/**
 * Fin de course. Le prix facturé est le prix annoncé à la commande (enregistré dans la course).
 * Espèces : le paiement est marqué "paid" quand le chauffeur termine la course.
 * Mobile Money : "pending" jusqu'à la confirmation de l'opérateur (payments/mobileMoney.ts).
 */
export const completeRide = onCall(async (request) => {
  const uid = requireDriver(request);
  const rideId = parseRideId((request.data as { rideId?: unknown })?.rideId);
  const config = await getAppConfig();
  const rideRef = db.doc(`rides/${rideId}`);
  const driverRef = db.doc(`drivers/${uid}`);
  const paymentRef = db.doc(`payments/${rideId}`);
  const day = new Date().toISOString().slice(0, 10); // Bamako = UTC
  const statsRef = driverRef.collection("dailyStats").doc(day);

  const result = await db.runTransaction(async (t) => {
    const ride = (await t.get(rideRef)).data();
    if (!ride || ride.driverId !== uid) throw new HttpsError("permission-denied", "Ce n'est pas votre course.");
    if (ride.status !== "in_progress") throw new HttpsError("failed-precondition", "La course n'est pas en cours.");

    const price = ride.price as number;
    const { commission, driverEarnings } = computeCommission(price, config.commissionRate);
    const isCash = ride.paymentMethod === "cash";

    t.update(rideRef, {
      status: "completed",
      commission,
      driverEarnings,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    t.set(paymentRef, {
      rideId,
      passengerId: ride.passengerId,
      driverId: uid,
      method: ride.paymentMethod,
      amount: price,
      tip: 0,
      commission,
      currency: "XOF",
      status: isCash ? "paid" : "pending",
      createdAt: FieldValue.serverTimestamp(),
      paidAt: isCash ? FieldValue.serverTimestamp() : null,
    });
    t.update(driverRef, { currentRideId: null });
    t.set(statsRef, { rides: FieldValue.increment(1), earnings: FieldValue.increment(driverEarnings) }, { merge: true });
    return { passengerId: ride.passengerId as string, price, driverEarnings };
  });

  await notify(
    "users",
    result.passengerId,
    { type: "ride_completed", rideId },
    { title: "Course terminée", body: `Montant : ${result.price} FCFA` },
  );
  return { ok: true, price: result.price, driverEarnings: result.driverEarnings };
});
