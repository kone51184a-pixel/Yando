// Client Firebase "comme une vraie app" (SDK web), connecté aux émulateurs.
// Sert aux tests de bout en bout et au faux chauffeur.
import { EMULATOR_HOST, FIRESTORE_PORT, PROJECT_ID } from "./emulatorEnv";
import { FirebaseApp, initializeApp } from "firebase/app";
import { Auth, connectAuthEmulator, getAuth, signInWithCustomToken } from "firebase/auth";
import { connectDatabaseEmulator, Database, getDatabase } from "firebase/database";
import { connectFirestoreEmulator, Firestore, getFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, Functions, getFunctions, httpsCallable } from "firebase/functions";
import { auth as adminAuth } from "../src/shared/firebase";

export interface TestClient {
  uid: string;
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  rtdb: Database;
  functions: Functions;
  call<T = Record<string, unknown>>(name: string, data?: unknown): Promise<T>;
}

/** Crée l'utilisateur s'il n'existe pas, lui donne des claims et se connecte avec lui. */
export async function signInAs(uid: string, claims: Record<string, unknown> = {}): Promise<TestClient> {
  try {
    await adminAuth.getUser(uid);
  } catch {
    await adminAuth.createUser({ uid });
  }
  await adminAuth.setCustomUserClaims(uid, claims);

  const app = initializeApp(
    {
      projectId: PROJECT_ID,
      apiKey: "fake-api-key",
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      databaseURL: `https://${PROJECT_ID}-default-rtdb.firebaseio.com`,
    },
    `client-${uid}-${Date.now()}`,
  );
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, EMULATOR_HOST, FIRESTORE_PORT);
  const rtdb = getDatabase(app);
  connectDatabaseEmulator(rtdb, EMULATOR_HOST, 9000);
  const functions = getFunctions(app, "europe-west1");
  connectFunctionsEmulator(functions, EMULATOR_HOST, 5001);

  const token = await adminAuth.createCustomToken(uid, claims);
  await signInWithCustomToken(auth, token);

  return {
    uid,
    app,
    auth,
    db,
    rtdb,
    functions,
    async call<T>(name: string, data?: unknown): Promise<T> {
      const res = await httpsCallable(functions, name)(data);
      return res.data as T;
    },
  };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Attend qu'une condition devienne vraie (vérifiée toutes les 300 ms). */
export async function waitFor<T>(check: () => Promise<T | null | undefined | false>, timeoutMs = 20_000, what = "condition"): Promise<T> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await check();
    if (v) return v;
    await sleep(300);
  }
  throw new Error(`Délai dépassé en attendant : ${what}`);
}
