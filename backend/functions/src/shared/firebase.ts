import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

if (getApps().length === 0) {
  if (process.env.FIREBASE_CONFIG) {
    // Dans Cloud Functions (et l'émulateur), Firebase fournit la configuration.
    const config = JSON.parse(process.env.FIREBASE_CONFIG) as { projectId?: string; databaseURL?: string };
    if (process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
      // Émulateur uniquement : la base temps réel doit s'appeler "…-default-rtdb", le nom sous
      // lequel les règles (index "g") sont chargées. Sinon l'index est introuvable.
      const projectId = config.projectId ?? process.env.GCLOUD_PROJECT ?? "demo-vtc-bamako";
      initializeApp({ ...config, databaseURL: `https://${projectId}-default-rtdb.firebaseio.com` });
    } else {
      // Production : configuration Firebase inchangée.
      initializeApp();
    }
  } else {
    // Scripts lancés à la main (seed, setAdmin, faux chauffeur, tests).
    const projectId = process.env.GCLOUD_PROJECT ?? "demo-vtc-bamako";
    initializeApp({ projectId, databaseURL: `https://${projectId}-default-rtdb.firebaseio.com` });
  }
}

export const db = getFirestore();
export const rtdb = getDatabase();
export const auth = getAuth();
export const messaging = getMessaging();
