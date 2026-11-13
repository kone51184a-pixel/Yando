// Tests des règles de sécurité Firestore et Realtime Database.
// Lancer avec : npm run test:emulator   (démarre les émulateurs tout seul)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { ref, set } from "firebase/database";
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";

const backendDir = resolve(__dirname, "../../..");
let env: RulesTestEnvironment;

const PASSENGER = "passager-1";
const OTHER = "passager-2";
const DRIVER = "chauffeur-1";
const OTHER_DRIVER = "chauffeur-2";
const ADMIN = "admin-1";

const passenger = () => env.authenticatedContext(PASSENGER).firestore();
const other = () => env.authenticatedContext(OTHER).firestore();
const driver = () => env.authenticatedContext(DRIVER, { driver: true }).firestore();
const otherDriver = () => env.authenticatedContext(OTHER_DRIVER, { driver: true }).firestore();
const admin = () => env.authenticatedContext(ADMIN, { admin: true }).firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-vtc-bamako",
    firestore: { rules: readFileSync(resolve(backendDir, "firestore.rules"), "utf8"), host: "127.0.0.1", port: 8080 },
    database: { rules: readFileSync(resolve(backendDir, "database.rules.json"), "utf8"), host: "127.0.0.1", port: 9000 },
  });
});

after(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `users/${PASSENGER}`), { name: "Awa" });
    await setDoc(doc(db, `drivers/${DRIVER}`), { name: "Moussa", status: "approved", ratingSum: 0, ratingCount: 0 });
    await setDoc(doc(db, "rides/r1"), {
      passengerId: PASSENGER,
      driverId: DRIVER,
      status: "driver_assigned",
      offer: null,
      price: 2000,
    });
    await setDoc(doc(db, "rides/r1/private/pin"), { pin: "1234" });
    await setDoc(doc(db, "rides/r2"), {
      passengerId: OTHER,
      driverId: null,
      status: "searching",
      offer: { driverId: OTHER_DRIVER },
      price: 1500,
    });
    await setDoc(doc(db, "pricing/moto"), { base: 300, perKm: 150, perMinute: 15, minimum: 500 });
  });
});

describe("Passagers (users)", () => {
  test("lit son profil, pas celui d'un autre", async () => {
    await assertSucceeds(getDoc(doc(passenger(), `users/${PASSENGER}`)));
    await assertFails(getDoc(doc(other(), `users/${PASSENGER}`)));
  });
  test("ne peut pas se donner un rôle à la création", async () => {
    await assertFails(setDoc(doc(other(), `users/${OTHER}`), { name: "Ibrahim", role: "admin" }));
    await assertSucceeds(setDoc(doc(other(), `users/${OTHER}`), { name: "Ibrahim" }));
  });
});

describe("Chauffeurs (drivers)", () => {
  test("inscription seulement avec le statut pending", async () => {
    const ctx = env.authenticatedContext("nouveau").firestore();
    await assertFails(setDoc(doc(ctx, "drivers/nouveau"), { name: "X", status: "approved" }));
    await assertSucceeds(setDoc(doc(ctx, "drivers/nouveau"), { name: "X", status: "pending" }));
  });
  test("ne peut pas modifier son statut ni sa note", async () => {
    await assertFails(updateDoc(doc(driver(), `drivers/${DRIVER}`), { status: "approved" }));
    await assertFails(updateDoc(doc(driver(), `drivers/${DRIVER}`), { ratingSum: 500 }));
    await assertSucceeds(updateDoc(doc(driver(), `drivers/${DRIVER}`), { fcmToken: "abc" }));
  });
  test("un passager ne lit pas la fiche complète d'un chauffeur", async () => {
    await assertFails(getDoc(doc(passenger(), `drivers/${DRIVER}`)));
  });
});

describe("Courses (rides)", () => {
  test("le téléphone ne peut jamais créer ni modifier une course", async () => {
    await assertFails(setDoc(doc(passenger(), "rides/fausse"), { passengerId: PASSENGER, price: 25 }));
    await assertFails(updateDoc(doc(passenger(), "rides/r1"), { price: 25 }));
    await assertFails(updateDoc(doc(driver(), "rides/r1"), { status: "completed" }));
  });
  test("chacun ne voit que ses courses", async () => {
    await assertSucceeds(getDoc(doc(passenger(), "rides/r1")));
    await assertSucceeds(getDoc(doc(driver(), "rides/r1")));
    await assertFails(getDoc(doc(other(), "rides/r1")));
    await assertFails(getDoc(doc(otherDriver(), "rides/r1")));
  });
  test("le chauffeur sollicité voit la proposition", async () => {
    await assertSucceeds(getDoc(doc(otherDriver(), "rides/r2")));
    await assertFails(getDoc(doc(driver(), "rides/r2")));
  });
  test("l'admin voit tout", async () => {
    await assertSucceeds(getDoc(doc(admin(), "rides/r1")));
    await assertSucceeds(getDoc(doc(admin(), "rides/r2")));
  });
  test("le PIN n'est lisible que par le passager", async () => {
    await assertSucceeds(getDoc(doc(passenger(), "rides/r1/private/pin")));
    await assertFails(getDoc(doc(driver(), "rides/r1/private/pin")));
  });
});

describe("Chat", () => {
  test("les participants écrivent, les autres non", async () => {
    const msg = (sender: string) => ({ senderId: sender, text: "Je suis sur place", quick: "arrived", createdAt: serverTimestamp() });
    await assertSucceeds(setDoc(doc(driver(), "rides/r1/messages/m1"), msg(DRIVER)));
    await assertSucceeds(setDoc(doc(passenger(), "rides/r1/messages/m2"), msg(PASSENGER)));
    await assertFails(setDoc(doc(other(), "rides/r1/messages/m3"), msg(OTHER)));
  });
  test("impossible d'écrire au nom de l'autre", async () => {
    await assertFails(
      setDoc(doc(passenger(), "rides/r1/messages/m4"), { senderId: DRIVER, text: "faux", quick: null, createdAt: serverTimestamp() }),
    );
  });
});

describe("Tarifs", () => {
  test("lecture par tous, modification par l'admin seulement", async () => {
    await assertSucceeds(getDoc(doc(passenger(), "pricing/moto")));
    await assertFails(setDoc(doc(passenger(), "pricing/moto"), { base: 0, perKm: 0, perMinute: 0, minimum: 0 }));
    await assertSucceeds(setDoc(doc(admin(), "pricing/moto"), { base: 400, perKm: 150, perMinute: 15, minimum: 500 }));
  });
});

describe("Positions GPS (Realtime Database)", () => {
  const loc = { lat: 12.65, lng: -8.0, g: "efr3x0000", online: true, vehicleClass: "moto", ts: Date.now() };

  test("un chauffeur validé écrit sa propre position", async () => {
    const rtdb = env.authenticatedContext(DRIVER, { driver: true }).database();
    await assertSucceeds(set(ref(rtdb, `driverLocations/${DRIVER}`), { ...loc, ts: Date.now() }));
  });
  test("ni la position d'un autre, ni sans être validé", async () => {
    const rtdb = env.authenticatedContext(DRIVER, { driver: true }).database();
    await assertFails(set(ref(rtdb, `driverLocations/${OTHER_DRIVER}`), { ...loc, ts: Date.now() }));
    const notValidated = env.authenticatedContext("pas-valide").database();
    await assertFails(set(ref(notValidated, "driverLocations/pas-valide"), { ...loc, ts: Date.now() }));
  });
  test("refuse une gamme inconnue", async () => {
    const rtdb = env.authenticatedContext(DRIVER, { driver: true }).database();
    await assertFails(set(ref(rtdb, `driverLocations/${DRIVER}`), { ...loc, vehicleClass: "camion", ts: Date.now() }));
  });
});
