import { logger } from "firebase-functions/v2";
import { db, messaging } from "./firebase";

/**
 * Envoie une notification push (FCM) à un utilisateur.
 * Le token FCM est stocké par l'app dans users/{uid}.fcmToken ou drivers/{uid}.fcmToken.
 * Les "data" sont toujours des chaînes (contrainte FCM).
 */
export async function notify(
  collection: "users" | "drivers",
  uid: string,
  data: Record<string, string>,
  notification?: { title: string; body: string },
): Promise<void> {
  try {
    const snap = await db.doc(`${collection}/${uid}`).get();
    const token = snap.get("fcmToken") as string | undefined;
    if (!token) return;
    await messaging.send({
      token,
      data,
      notification,
      android: { priority: "high" },
    });
  } catch (err) {
    // Une notification ratée ne doit jamais bloquer la course.
    logger.warn("Notification non envoyée", { collection, uid, err: String(err) });
  }
}
