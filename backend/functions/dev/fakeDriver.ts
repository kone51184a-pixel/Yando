/**
 * FAUX CHAUFFEUR pour tester l'app passager sans vrai chauffeur.
 * Il se met en ligne près du Grand Marché, accepte les courses qu'on lui propose,
 * roule jusqu'au passager, démarre avec le PIN, roule jusqu'à la destination et termine.
 *
 * Usage (émulateurs lancés) :
 *   npm run fake-driver                      → moto, accepte tout
 *   npm run fake-driver -- standard          → gamme standard
 *   npm run fake-driver -- moto --refuse     → refuse toutes les propositions
 *   npm run fake-driver -- moto --id=chauffeur-2   → un 2e faux chauffeur en parallèle
 */
import "./emulatorEnv";
import { FieldValue } from "firebase-admin/firestore";
import { ref, set, update } from "firebase/database";
import { geohashForLocation } from "geofire-common";
import { db as adminDb } from "../src/shared/firebase";
import { LatLng, VEHICLE_CLASSES, VehicleClass } from "../src/shared/types";
import { signInAs, sleep, TestClient } from "./client";

const args = process.argv.slice(2);
const vehicleClass = (VEHICLE_CLASSES.find((c) => args.includes(c)) ?? "moto") as VehicleClass;
const refuse = args.includes("--refuse");
const driverId = args.find((a) => a.startsWith("--id="))?.slice(5) ?? `faux-chauffeur-${vehicleClass}`;

const START: LatLng = { lat: 12.6497, lng: -8.0003 }; // Grand Marché
let position: LatLng = { ...START };
let busy = false;

const log = (...m: unknown[]) => console.log(new Date().toLocaleTimeString("fr-FR"), "|", ...m);

async function sendPosition(client: TestClient, online = true) {
  await set(ref(client.rtdb, `driverLocations/${driverId}`), {
    lat: position.lat,
    lng: position.lng,
    g: geohashForLocation([position.lat, position.lng]),
    heading: 0,
    online,
    vehicleClass,
    ts: Date.now(),
  });
}

/** Avance en ligne droite vers `to` en `steps` étapes de 2 s. */
async function driveTo(client: TestClient, to: LatLng, steps: number) {
  const from = { ...position };
  for (let i = 1; i <= steps; i++) {
    position = { lat: from.lat + ((to.lat - from.lat) * i) / steps, lng: from.lng + ((to.lng - from.lng) * i) / steps };
    await sendPosition(client);
    await sleep(2000);
  }
}

async function handleOffer(client: TestClient, rideId: string) {
  busy = true;
  try {
    const ride = (await adminDb.doc(`rides/${rideId}`).get()).data()!;
    log(`Proposition : ${ride.pickup.label} → ${ride.dropoff.label}, ${ride.price} FCFA`);
    await sleep(3000); // le temps de "lire" la proposition

    if (refuse) {
      await client.call("declineRide", { rideId });
      log("Refusée.");
      return;
    }
    await client.call("acceptRide", { rideId });
    log("Acceptée. En route vers le passager…");

    await driveTo(client, ride.pickup, 8);
    if (!(await stillActive(rideId))) return;
    await client.call("driverArrived", { rideId });
    log("Arrivé au point de départ. Attente du passager…");
    await sleep(5000);

    // Un vrai chauffeur demande le code au passager ; ici on le lit directement.
    const pin = (await adminDb.doc(`rides/${rideId}/private/pin`).get()).get("pin");
    if (!(await stillActive(rideId))) return;
    await client.call("startRide", { rideId, pin });
    log(`Course démarrée (PIN ${pin}). En route vers la destination…`);

    await driveTo(client, ride.dropoff, 12);
    if (!(await stillActive(rideId))) return;
    const res = await client.call<{ price: number; driverEarnings: number }>("completeRide", { rideId });
    log(`Course terminée : ${res.price} FCFA, gain chauffeur ${res.driverEarnings} FCFA.`);
  } catch (err) {
    log("Erreur :", (err as Error).message);
  } finally {
    busy = false;
  }
}

async function stillActive(rideId: string): Promise<boolean> {
  const status = (await adminDb.doc(`rides/${rideId}`).get()).get("status");
  if (status === "cancelled") log("Course annulée par le passager.");
  return status !== "cancelled";
}

async function main() {
  // Chauffeur validé dans Firestore + claim "driver".
  await adminDb.doc(`drivers/${driverId}`).set(
    {
      name: `Faux Chauffeur ${vehicleClass}`,
      phone: "+22300000000",
      photoUrl: null,
      vehicleClass,
      vehicle: { model: vehicleClass === "moto" ? "Jakarta 125" : "Toyota Corolla", color: "Gris", plate: "TEST-0001-MD" },
      status: "approved",
      currentRideId: null,
      ratingSum: 0,
      ratingCount: 0,
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await adminDb.doc(`drivers/${driverId}`).update({ currentRideId: null });

  const client = await signInAs(driverId, { driver: true });
  await sendPosition(client);
  log(`${driverId} en ligne (${vehicleClass}) près du Grand Marché.${refuse ? " Mode refus." : ""}`);

  // Position envoyée toutes les 10 s quand il attend.
  const heartbeat = setInterval(() => {
    if (!busy) sendPosition(client).catch(() => undefined);
  }, 10_000);

  const unsubscribe = adminDb
    .collection("rides")
    .where("offer.driverId", "==", driverId)
    .where("status", "==", "searching")
    .onSnapshot((snap) => {
      for (const change of snap.docChanges()) {
        if (change.type === "added" && !busy) void handleOffer(client, change.doc.id);
      }
    });

  const stop = async () => {
    log("Arrêt : passage hors ligne.");
    clearInterval(heartbeat);
    unsubscribe();
    await update(ref(client.rtdb, `driverLocations/${driverId}`), { online: false, ts: Date.now() });
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  log("En attente de courses… (Ctrl+C pour arrêter)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
