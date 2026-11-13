import { DocumentReference, FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getAppConfig } from "../shared/config";
import { db } from "../shared/firebase";
import { notify } from "../shared/notify";
import { OfferResult, Place, VehicleClass } from "../shared/types";
import { findNearbyDrivers } from "./nearby";

/**
 * Attribution d'une course.
 * Dès qu'une course est créée, on propose la course au chauffeur le plus proche.
 * Il a `offerTimeoutSeconds` (15 s) pour accepter (acceptRide) ou refuser (declineRide).
 * Sinon on passe au suivant, jusqu'à `maxOffers` chauffeurs. Personne → status "no_driver".
 */
export const dispatchRide = onDocumentCreated(
  { document: "rides/{rideId}", timeoutSeconds: 300, memory: "256MiB" },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const ride = snap.data();
    if (ride.status !== "searching") return;

    const rideRef = snap.ref;
    const config = await getAppConfig();
    const pickup = ride.pickup as Place;
    const vehicleClass = ride.vehicleClass as VehicleClass;

    const candidates = await findNearbyDrivers(pickup, vehicleClass, config.searchRadiusKm);
    let offered = 0;

    for (const candidate of candidates) {
      if (offered >= config.maxOffers) break;

      // Le chauffeur doit être validé et libre.
      const driverSnap = await db.doc(`drivers/${candidate.driverId}`).get();
      if (driverSnap.get("status") !== "approved" || driverSnap.get("currentRideId")) continue;

      const expiresAt = Timestamp.fromMillis(Date.now() + config.offerTimeoutSeconds * 1000);
      const stillSearching = await db.runTransaction(async (t) => {
        const current = await t.get(rideRef);
        if (current.get("status") !== "searching") return false;
        t.update(rideRef, {
          offer: { driverId: candidate.driverId, expiresAt, declined: false, distanceKm: candidate.distanceKm },
          offeredDriverIds: FieldValue.arrayUnion(candidate.driverId),
          updatedAt: FieldValue.serverTimestamp(),
        });
        return true;
      });
      if (!stillSearching) return; // annulée par le passager entre-temps

      offered++;
      await notify(
        "drivers",
        candidate.driverId,
        { type: "ride_offer", rideId: rideRef.id, expiresAt: String(expiresAt.toMillis()) },
        { title: "Nouvelle course", body: `Départ : ${pickup.label}` },
      );

      // +2 s de marge pour les réseaux lents.
      const result = await waitForOfferResult(rideRef, candidate.driverId, config.offerTimeoutSeconds * 1000 + 2000);
      logger.info("Résultat de la proposition", { rideId: rideRef.id, driverId: candidate.driverId, result });
      if (result === "accepted" || result === "cancelled") return;
    }

    // Personne n'a accepté.
    const noDriver = await db.runTransaction(async (t) => {
      const current = await t.get(rideRef);
      if (current.get("status") !== "searching") return false;
      t.update(rideRef, { status: "no_driver", offer: null, updatedAt: FieldValue.serverTimestamp() });
      return true;
    });
    if (noDriver) {
      await notify(
        "users",
        ride.passengerId as string,
        { type: "no_driver", rideId: rideRef.id },
        { title: "Aucun chauffeur disponible", body: "Réessayez dans quelques minutes." },
      );
    }
  },
);

/** Attend que le chauffeur réponde, que la course change d'état, ou que le délai expire. */
export function waitForOfferResult(rideRef: DocumentReference, driverId: string, timeoutMs: number): Promise<OfferResult> {
  return new Promise((resolve) => {
    let done = false;
    let unsubscribe: (() => void) | null = null;
    const finish = (result: OfferResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe?.();
      resolve(result);
    };
    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    unsubscribe = rideRef.onSnapshot(
      (snap) => {
        const r = snap.data();
        if (!r) return finish("cancelled");
        if (r.status === "driver_assigned") return finish("accepted");
        if (r.status !== "searching") return finish("cancelled");
        if (r.offer?.driverId === driverId && r.offer.declined === true) return finish("declined");
      },
      () => finish("timeout"),
    );
  });
}
