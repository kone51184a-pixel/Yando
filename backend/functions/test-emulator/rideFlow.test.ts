// Test de bout en bout : une course complète, avec les vraies Cloud Functions (émulateur).
// Lancer avec : npm run test:emulator
import "../dev/emulatorEnv";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { deleteApp } from "firebase/app";
import { set, ref } from "firebase/database";
import { doc, getDoc } from "firebase/firestore";
import { FunctionsError } from "firebase/functions";
import { geohashForLocation } from "geofire-common";
import { deleteApp as deleteAdminApp, getApp as getAdminApp } from "firebase-admin/app";
import { db as adminDb, rtdb as adminRtdb } from "../src/shared/firebase";
import { signInAs, TestClient, waitFor } from "../dev/client";

const GRAND_MARCHE = { lat: 12.6497, lng: -8.0003, label: "Grand Marché" };
const ACI_2000 = { lat: 12.623, lng: -8.023, label: "ACI 2000" };

let passenger: TestClient;
let driver: TestClient;
const DRIVER_ID = "test-chauffeur";

async function putDriverOnline(online: boolean) {
  await set(ref(driver.rtdb, `driverLocations/${DRIVER_ID}`), {
    lat: 12.65,
    lng: -8.001,
    g: geohashForLocation([12.65, -8.001]),
    online,
    vehicleClass: "moto",
    ts: Date.now(),
  });
}

/** Lecture qui renvoie null au lieu d'échouer quand les règles refusent l'accès. */
async function readRide(client: TestClient, rideId: string) {
  try {
    return (await getDoc(doc(client.db, `rides/${rideId}`))).data() ?? null;
  } catch {
    return null;
  }
}

async function expectError(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof FunctionsError, `erreur inattendue : ${String(err)}`);
    assert.equal(err.code, `functions/${code}`);
    return true;
  });
}

before(async () => {
  // Tarifs et réglages (attente courte pour le test).
  const batch = adminDb.batch();
  batch.set(adminDb.doc("pricing/moto"), { base: 300, perKm: 150, perMinute: 15, minimum: 500 });
  batch.set(adminDb.doc("pricing/standard"), { base: 500, perKm: 250, perMinute: 25, minimum: 1000 });
  batch.set(adminDb.doc("pricing/confort"), { base: 800, perKm: 350, perMinute: 35, minimum: 1500 });
  batch.set(adminDb.doc("config/app"), { surge: 1, commissionRate: 0.15, offerTimeoutSeconds: 10, maxOffers: 3 });
  batch.set(adminDb.doc("promoCodes/BIENVENUE"), { active: true, type: "fixed", value: 200, maxUses: 100, uses: 0 });
  batch.set(adminDb.doc(`drivers/${DRIVER_ID}`), {
    name: "Moussa Traoré",
    status: "approved",
    vehicleClass: "moto",
    vehicle: { model: "Jakarta 125", color: "Rouge", plate: "AB-1234-MD" },
    currentRideId: null,
    ratingSum: 0,
    ratingCount: 0,
  });
  await batch.commit();

  passenger = await signInAs("test-passager");
  await adminDb.doc("users/test-passager").set({ name: "Awa Diarra" });
  driver = await signInAs(DRIVER_ID, { driver: true });
});

after(async () => {
  await adminRtdb.ref(`driverLocations/${DRIVER_ID}`).remove();
  await Promise.all([deleteApp(passenger.app), deleteApp(driver.app)]);
  await deleteAdminApp(getAdminApp());
});

test("estimation pour les 3 gammes", async () => {
  const res = await passenger.call<{ estimates: { vehicleClass: string; price: number }[] }>("estimatePrice", {
    pickup: GRAND_MARCHE,
    dropoff: ACI_2000,
  });
  assert.deepEqual(res.estimates.map((e) => e.vehicleClass), ["moto", "standard", "confort"]);
  for (const e of res.estimates) assert.equal(e.price % 25, 0, "prix arrondi à 25");
});

test("refuse un départ hors de Bamako", async () => {
  await expectError(passenger.call("estimatePrice", { pickup: { lat: 14.69, lng: -17.44 }, dropoff: ACI_2000 }), "out-of-range");
});

test("course complète : commande → attribution → PIN → fin → note", async () => {
  await putDriverOnline(true);

  const { rideId, price, discount } = await passenger.call<{ rideId: string; price: number; discount: number }>(
    "createRide",
    { pickup: GRAND_MARCHE, dropoff: ACI_2000, vehicleClass: "moto", paymentMethod: "cash", promoCode: "bienvenue" },
  );
  assert.equal(discount, 200);

  // Une seule course active à la fois.
  await expectError(
    passenger.call("createRide", { pickup: GRAND_MARCHE, dropoff: ACI_2000, vehicleClass: "moto", paymentMethod: "cash" }),
    "failed-precondition",
  );

  // Le serveur propose la course au chauffeur.
  await waitFor(
    async () => (await readRide(driver, rideId))?.offer?.driverId === DRIVER_ID,
    20_000,
    "proposition au chauffeur",
  );
  await driver.call("acceptRide", { rideId });

  const afterAccept = (await getDoc(doc(passenger.db, `rides/${rideId}`))).data()!;
  assert.equal(afterAccept.status, "driver_assigned");
  assert.equal(afterAccept.driver.vehicle.plate, "AB-1234-MD");

  await driver.call("driverArrived", { rideId });

  // Le passager lit son PIN ; le chauffeur se trompe une fois puis saisit le bon.
  const pin = (await getDoc(doc(passenger.db, `rides/${rideId}/private/pin`))).get("pin") as string;
  const wrongPin = pin === "0000" ? "1111" : "0000";
  await expectError(driver.call("startRide", { rideId, pin: wrongPin }), "permission-denied");
  await driver.call("startRide", { rideId, pin });

  const done = await driver.call<{ price: number; driverEarnings: number }>("completeRide", { rideId });
  assert.equal(done.price, price);
  assert.equal(done.driverEarnings, price - Math.round(price * 0.15));

  await passenger.call("rateRide", { rideId, stars: 5, tip: 200 });
  await expectError(passenger.call("rateRide", { rideId, stars: 4 }), "already-exists");

  const payment = (await adminDb.doc(`payments/${rideId}`).get()).data()!;
  assert.equal(payment.status, "paid");
  assert.equal(payment.tip, 200);
  const driverDoc = (await adminDb.doc(`drivers/${DRIVER_ID}`).get()).data()!;
  assert.equal(driverDoc.ratingCount, 1);
  assert.equal(driverDoc.currentRideId, null);
});

test("aucun chauffeur en ligne → no_driver", async () => {
  await putDriverOnline(false);
  const { rideId } = await passenger.call<{ rideId: string }>("createRide", {
    pickup: GRAND_MARCHE,
    dropoff: ACI_2000,
    vehicleClass: "moto",
    paymentMethod: "cash",
  });
  await waitFor(
    async () => (await readRide(passenger, rideId))?.status === "no_driver",
    15_000,
    "statut no_driver",
  );
});

test("le chauffeur refuse → annulation gratuite par le passager", async () => {
  await putDriverOnline(true);
  const { rideId } = await passenger.call<{ rideId: string }>("createRide", {
    pickup: GRAND_MARCHE,
    dropoff: ACI_2000,
    vehicleClass: "moto",
    paymentMethod: "cash",
  });
  await waitFor(
    async () => (await readRide(driver, rideId))?.offer?.driverId === DRIVER_ID,
    20_000,
    "proposition au chauffeur",
  );
  await driver.call("declineRide", { rideId });
  // Un seul chauffeur disponible : la recherche se termine en no_driver.
  await waitFor(
    async () => (await readRide(passenger, rideId))?.status === "no_driver",
    15_000,
    "no_driver après refus",
  );
  await expectError(passenger.call("cancelRide", { rideId }), "failed-precondition");
});

test("annulation pendant la recherche : gratuite", async () => {
  await putDriverOnline(true);
  const { rideId } = await passenger.call<{ rideId: string }>("createRide", {
    pickup: GRAND_MARCHE,
    dropoff: ACI_2000,
    vehicleClass: "moto",
    paymentMethod: "cash",
  });
  const res = await passenger.call<{ cancellationFee: number }>("cancelRide", { rideId, reason: "Test" });
  assert.equal(res.cancellationFee, 0);
  await expectError(driver.call("acceptRide", { rideId }), "failed-precondition");
});
