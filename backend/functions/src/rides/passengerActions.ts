import { randomBytes } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { getAppConfig } from "../shared/config";
import { db, rtdb } from "../shared/firebase";
import { notify } from "../shared/notify";
import { ACTIVE_STATUSES, RideStatus } from "../shared/types";
import { parseRideId, requireAuth } from "../shared/validate";

/**
 * Annulation par le passager ou par le chauffeur.
 * Passager : gratuit si aucun chauffeur n'est encore attribué ou dans les `freeCancelSeconds`
 * qui suivent l'attribution, sinon frais `cancelFee` (enregistrés, à régler à la prochaine course).
 * Une course "in_progress" ne peut pas être annulée depuis l'app (passer par l'admin).
 */
export const cancelRide = onCall(async (request) => {
  const uid = requireAuth(request);
  const data = (request.data ?? {}) as { rideId?: unknown; reason?: unknown };
  const rideId = parseRideId(data.rideId);
  const reason = typeof data.reason === "string" ? data.reason.slice(0, 200) : null;
  const config = await getAppConfig();
  const rideRef = db.doc(`rides/${rideId}`);

  const result = await db.runTransaction(async (t) => {
    const ride = (await t.get(rideRef)).data();
    if (!ride) throw new HttpsError("not-found", "Course introuvable.");
    const byPassenger = ride.passengerId === uid;
    const byDriver = ride.driverId === uid;
    if (!byPassenger && !byDriver) throw new HttpsError("permission-denied", "Ce n'est pas votre course.");

    const status = ride.status as RideStatus;
    if (!ACTIVE_STATUSES.includes(status) || status === "in_progress") {
      throw new HttpsError("failed-precondition", "Cette course ne peut plus être annulée.");
    }

    let cancellationFee = 0;
    if (byPassenger && ride.assignedAt instanceof Timestamp) {
      const elapsed = (Date.now() - ride.assignedAt.toMillis()) / 1000;
      if (elapsed > config.freeCancelSeconds) cancellationFee = config.cancelFee;
    }

    t.update(rideRef, {
      status: "cancelled",
      cancelledBy: byPassenger ? "passenger" : "driver",
      cancelReason: reason,
      cancellationFee,
      offer: null,
      cancelledAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (ride.driverId) t.update(db.doc(`drivers/${ride.driverId}`), { currentRideId: null });
    if (cancellationFee > 0) {
      t.set(db.doc(`users/${ride.passengerId}`), { pendingFees: FieldValue.increment(cancellationFee) }, { merge: true });
    }
    return {
      cancellationFee,
      notifyTarget: byPassenger ? (ride.driverId as string | null) : (ride.passengerId as string),
      byPassenger,
    };
  });

  if (result.notifyTarget) {
    await notify(result.byPassenger ? "drivers" : "users", result.notifyTarget, { type: "ride_cancelled", rideId });
  }
  return { ok: true, cancellationFee: result.cancellationFee };
});

/** Note (1 à 5) + pourboire libre après la course. Une seule fois par course. */
export const rateRide = onCall(async (request) => {
  const uid = requireAuth(request);
  const data = (request.data ?? {}) as { rideId?: unknown; stars?: unknown; tip?: unknown; comment?: unknown };
  const rideId = parseRideId(data.rideId);
  const stars = data.stars;
  if (typeof stars !== "number" || !Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw new HttpsError("invalid-argument", "La note doit être entre 1 et 5.");
  }
  const tip = data.tip === undefined ? 0 : data.tip;
  if (typeof tip !== "number" || !Number.isInteger(tip) || tip < 0 || tip > 10000) {
    throw new HttpsError("invalid-argument", "Pourboire invalide (0 à 10 000 FCFA).");
  }
  const comment = typeof data.comment === "string" ? data.comment.slice(0, 300) : null;

  const rideRef = db.doc(`rides/${rideId}`);
  await db.runTransaction(async (t) => {
    const ride = (await t.get(rideRef)).data();
    if (!ride || ride.passengerId !== uid) throw new HttpsError("permission-denied", "Ce n'est pas votre course.");
    if (ride.status !== "completed") throw new HttpsError("failed-precondition", "La course n'est pas terminée.");
    if (ride.rating) throw new HttpsError("already-exists", "Course déjà notée.");

    const driverRef = db.doc(`drivers/${ride.driverId}`);
    t.update(rideRef, { rating: { stars, comment }, tip, updatedAt: FieldValue.serverTimestamp() });
    t.update(driverRef, { ratingSum: FieldValue.increment(stars), ratingCount: FieldValue.increment(1) });
    if (tip > 0) {
      t.update(db.doc(`payments/${rideId}`), { tip });
      const day = new Date().toISOString().slice(0, 10);
      t.set(driverRef.collection("dailyStats").doc(day), { earnings: FieldValue.increment(tip) }, { merge: true });
    }
  });
  return { ok: true };
});

/** Crée un lien de suivi que le passager peut envoyer à ses proches (WhatsApp...). */
export const createShareLink = onCall(async (request) => {
  const uid = requireAuth(request);
  const rideId = parseRideId((request.data as { rideId?: unknown })?.rideId);
  const rideRef = db.doc(`rides/${rideId}`);
  const ride = (await rideRef.get()).data();
  if (!ride || ride.passengerId !== uid) throw new HttpsError("permission-denied", "Ce n'est pas votre course.");
  if (!ACTIVE_STATUSES.includes(ride.status)) throw new HttpsError("failed-precondition", "Course terminée.");

  const token = (ride.shareToken as string | undefined) ?? randomBytes(16).toString("hex");
  if (!ride.shareToken) await rideRef.update({ shareToken: token });
  return { token };
});

/**
 * Page publique de suivi : GET /sharedTrip?t=<token>
 * Renvoie le strict minimum (pas de numéro de téléphone, pas de nom de famille).
 */
export const sharedTrip = onRequest({ cors: true }, async (req, res) => {
  const token = typeof req.query.t === "string" ? req.query.t : "";
  if (!/^[a-f0-9]{32}$/.test(token)) {
    res.status(400).json({ error: "Lien invalide." });
    return;
  }
  const q = await db.collection("rides").where("shareToken", "==", token).limit(1).get();
  const ride = q.docs[0]?.data();
  if (!ride || !ACTIVE_STATUSES.includes(ride.status)) {
    res.status(404).json({ error: "Course terminée ou introuvable." });
    return;
  }
  let driverLocation: { lat: number; lng: number } | null = null;
  if (ride.driverId) {
    const loc = (await rtdb.ref(`driverLocations/${ride.driverId}`).get()).val();
    if (loc) driverLocation = { lat: loc.lat, lng: loc.lng };
  }
  res.json({
    status: ride.status,
    pickup: ride.pickup.label,
    dropoff: { label: ride.dropoff.label, lat: ride.dropoff.lat, lng: ride.dropoff.lng },
    driver: ride.driver
      ? { firstName: String(ride.driver.name).split(" ")[0], vehicle: ride.driver.vehicle }
      : null,
    driverLocation,
  });
});
