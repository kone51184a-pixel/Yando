// Validation des chauffeurs par l'admin (fonction validateDriver), avec les vraies Cloud Functions.
// Lancer avec : npm run test:emulator
import "../dev/emulatorEnv";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { deleteApp } from "firebase/app";
import { FunctionsError } from "firebase/functions";
import { FieldValue } from "firebase-admin/firestore";
import { deleteApp as deleteAdminApp, getApp as getAdminApp } from "firebase-admin/app";
import { auth as adminAuth, db as adminDb } from "../src/shared/firebase";
import { signInAs, TestClient } from "../dev/client";

let admin: TestClient;
let passenger: TestClient;

async function expectError(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof FunctionsError, `erreur inattendue : ${String(err)}`);
    assert.equal(err.code, `functions/${code}`);
    return true;
  });
}

const pendingDriver = (name: string) => ({
  name,
  vehicleClass: "moto",
  vehicle: { model: "Jakarta 125", color: "Bleu", plate: "CD-5678-MD" },
  documents: {},
  status: "pending",
  createdAt: FieldValue.serverTimestamp(),
});

before(async () => {
  admin = await signInAs("test-admin", { admin: true });
  passenger = await signInAs("test-passager-admin");
});

after(async () => {
  await Promise.all([deleteApp(admin.app), deleteApp(passenger.app)]);
  await deleteAdminApp(getAdminApp());
});

test("un non-admin ne peut pas valider un chauffeur", async () => {
  await adminDb.doc("drivers/cand-1").set(pendingDriver("Candidat 1"));
  await expectError(passenger.call("validateDriver", { driverId: "cand-1", approve: true }), "permission-denied");
  assert.equal((await adminDb.doc("drivers/cand-1").get()).get("status"), "pending");
});

test("l'admin valide un chauffeur : statut approved et droit driver", async () => {
  await adminAuth.createUser({ uid: "cand-2" });
  await adminDb.doc("drivers/cand-2").set(pendingDriver("Candidat 2"));
  await admin.call("validateDriver", { driverId: "cand-2", approve: true });
  const doc = (await adminDb.doc("drivers/cand-2").get()).data()!;
  assert.equal(doc.status, "approved");
  assert.equal(doc.reviewedBy, "test-admin");
  assert.equal((await adminAuth.getUser("cand-2")).customClaims?.driver, true);
});

test("l'admin refuse un chauffeur avec un motif", async () => {
  await adminAuth.createUser({ uid: "cand-3" });
  await adminDb.doc("drivers/cand-3").set(pendingDriver("Candidat 3"));
  await admin.call("validateDriver", { driverId: "cand-3", approve: false, reason: "Documents illisibles" });
  const doc = (await adminDb.doc("drivers/cand-3").get()).data()!;
  assert.equal(doc.status, "rejected");
  assert.equal(doc.rejectionReason, "Documents illisibles");
  assert.equal((await adminAuth.getUser("cand-3")).customClaims?.driver, false);
});

test("chauffeur sans compte de connexion : erreur claire, pas de 500", async () => {
  await adminDb.doc("drivers/sans-compte").set(pendingDriver("Sans compte"));
  await expectError(admin.call("validateDriver", { driverId: "sans-compte", approve: true }), "failed-precondition");
  assert.equal((await adminDb.doc("drivers/sans-compte").get()).get("status"), "pending");
});

test("chauffeur inconnu : not-found", async () => {
  await expectError(admin.call("validateDriver", { driverId: "n-existe-pas", approve: true }), "not-found");
});
