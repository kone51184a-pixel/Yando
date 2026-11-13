import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

if (getApps().length === 0) {
  if (process.env.FIREBASE_CONFIG) {
    // Dans Cloud Functions (et l'émulateur), Firebase fournit la configuration.
    initializeApp();
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
