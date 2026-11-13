import { randomInt } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { applyPromo, clampSurge, computeFare, PromoRule } from "../pricing/formula";
import { getRoute } from "../pricing/route";
import { getAllPricing, getAppConfig } from "../shared/config";
import { db } from "../shared/firebase";
import { ACTIVE_STATUSES } from "../shared/types";
import { parsePaymentMethod, parsePlace, parseVehicleClass, requireAuth } from "../shared/validate";

/**
 * Commande d'une course. Le prix est recalculé ici, côté serveur :
 * le téléphone ne peut pas imposer son propre prix.
 * Entrée : { pickup, dropoff, vehicleClass, paymentMethod, promoCode? }
 * Sortie : { rideId, price, discount }
 * La création du document déclenche automatiquement la recherche de chauffeur (matching/dispatch.ts).
 */
export const createRide = onCall(async (request) => {
  const uid = requireAuth(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const pickup = parsePlace(data.pickup, "pickup");
  const dropoff = parsePlace(data.dropoff, "dropoff");
  const vehicleClass = parseVehicleClass(data.vehicleClass);
  const paymentMethod = parsePaymentMethod(data.paymentMethod);
  const promoCode =
    typeof data.promoCode === "string" && data.promoCode.trim() ? data.promoCode.trim().toUpperCase() : null;

  const [route, config, pricing, userSnap] = await Promise.all([
    getRoute(pickup, dropoff),
    getAppConfig(),
    getAllPricing(),
    db.doc(`users/${uid}`).get(),
  ]);
  const surge = clampSurge(config.surge);
  const fareBeforePromo = computeFare(pricing[vehicleClass], route.distanceKm, route.durationMin, surge);
  const pin = String(randomInt(0, 10000)).padStart(4, "0");

  const rideRef = db.collection("rides").doc();

  const result = await db.runTransaction(async (t) => {
    // 1. Une seule course active à la fois par passager.
    const active = await t.get(
      db.collection("rides").where("passengerId", "==", uid).where("status", "in", ACTIVE_STATUSES).limit(1),
    );
    if (!active.empty) {
      throw new HttpsError("failed-precondition", "Vous avez déjà une course en cours.", {
        rideId: active.docs[0].id,
      });
    }

    // 2. Code promo (facultatif).
    let promo: PromoRule | null = null;
    if (promoCode) {
      const promoRef = db.doc(`promoCodes/${promoCode}`);
      const redemptionRef = promoRef.collection("redemptions").doc(uid);
      const [promoSnap, redemptionSnap] = await Promise.all([t.get(promoRef), t.get(redemptionRef)]);
      const p = promoSnap.data();
      if (!p || p.active !== true) throw new HttpsError("not-found", "Code promo invalide.");
      if (p.expiresAt instanceof Timestamp && p.expiresAt.toMillis() < Date.now()) {
        throw new HttpsError("failed-precondition", "Code promo expiré.");
      }
      if (typeof p.maxUses === "number" && (p.uses ?? 0) >= p.maxUses) {
        throw new HttpsError("resource-exhausted", "Code promo épuisé.");
      }
      if (redemptionSnap.exists) throw new HttpsError("already-exists", "Code promo déjà utilisé.");
      promo = { type: p.type, value: p.value };
      t.update(promoRef, { uses: FieldValue.increment(1) });
      t.set(redemptionRef, { rideId: rideRef.id, at: FieldValue.serverTimestamp() });
    }

    const { price, discount } = applyPromo(fareBeforePromo, promo);

    // 3. La course.
    t.set(rideRef, {
      passengerId: uid,
      passengerName: (userSnap.get("name") as string | undefined) ?? "Passager",
      pickup,
      dropoff,
      vehicleClass,
      paymentMethod,
      distanceKm: route.distanceKm,
      durationMin: route.durationMin,
      routeSource: route.source,
      surge,
      fareBeforePromo,
      promoCode,
      discount,
      price,
      currency: "XOF",
      status: "searching",
      driverId: null,
      driver: null,
      offer: null,
      offeredDriverIds: [],
      pinAttempts: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 4. Le PIN est dans un sous-document lisible uniquement par le passager (voir firestore.rules).
    t.set(rideRef.collection("private").doc("pin"), { pin });

    return { price, discount };
  });

  return { rideId: rideRef.id, ...result };
});
