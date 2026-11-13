import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

if (getApps().length === 0) {
  if (process.env.FIREBASE_CONFIG) {
    // Dans Cloud Functions (et l'émulateur), Firebase fournit la configuration.
    // Sur un projet de démo (émulateurs), la config n'a pas de databaseURL : sans elle, la
    // base temps réel est ouverte sous un autre nom que celui des règles (index "g" introuvable).
    const config = JSON.parse(process.env.FIREBASE_CONFIG) as { projectId?: string; databaseURL?: string };
    const projectId = config.projectId ?? process.env.GCLOUD_PROJECT ?? "demo-vtc-bamako";
    // Avec l'émulateur, on force le nom "…-default-rtdb" (celui où les règles sont chargées).
    const databaseURL = process.env.FIREBASE_DATABASE_EMULATOR_HOST || !config.databaseURL
      ? `https://${projectId}-default-rtdb.firebaseio.com`
      : config.databaseURL;
    initializeApp({ ...config, databaseURL });
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
