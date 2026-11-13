import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectDatabaseEmulator, getDatabase } from "firebase/database";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { connectStorageEmulator, getStorage } from "firebase/storage";

const env = import.meta.env;
const projectId = env.VITE_FIREBASE_PROJECT_ID || "demo-vtc-bamako";
export const useEmulators = env.VITE_USE_EMULATORS !== "false";

const app = initializeApp({
  projectId,
  apiKey: env.VITE_FIREBASE_API_KEY || "fake-api-key",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
  databaseURL: env.VITE_FIREBASE_DATABASE_URL || `https://${projectId}-default-rtdb.firebaseio.com`,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`,
  appId: env.VITE_FIREBASE_APP_ID || undefined,
});

export const auth = getAuth(app);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, "europe-west1");

if (useEmulators) {
  const host = "127.0.0.1";
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8085); // 8085 : le 8080 est souvent pris sous Windows
  connectDatabaseEmulator(rtdb, host, 9000);
  connectStorageEmulator(storage, host, 9199);
  connectFunctionsEmulator(functions, host, 5001);
}

export async function callFn<T = unknown>(name: string, data: unknown): Promise<T> {
  const res = await httpsCallable(functions, name)(data);
  return res.data as T;
}
