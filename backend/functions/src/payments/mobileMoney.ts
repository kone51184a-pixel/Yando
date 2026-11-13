import { timingSafeEqual } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { db } from "../shared/firebase";
import { parseRideId, requireAuth } from "../shared/validate";

/**
 * Paiement Orange Money / Moov Money : À BRANCHER quand l'agrégateur sera choisi
 * (CinetPay, PayDunya, ou accord direct avec l'opérateur — point à valider avec le professeur).
 *
 * Principe (cahier des charges, section 7) : le paiement n'est JAMAIS validé par le téléphone.
 * 1. L'app appelle initiateMobileMoneyPayment → le serveur demande un lien/USSD à l'agrégateur.
 * 2. Le passager valide sur son téléphone (code secret Orange/Moov).
 * 3. L'agrégateur appelle mobileMoneyWebhook → on vérifie auprès de lui, puis payments/{rideId}.status = "paid".
 */
export const initiateMobileMoneyPayment = onCall(async (request) => {
  const uid = requireAuth(request);
  const rideId = parseRideId((request.data as { rideId?: unknown })?.rideId);
  const payment = (await db.doc(`payments/${rideId}`).get()).data();
  if (!payment || payment.passengerId !== uid) throw new HttpsError("not-found", "Paiement introuvable.");
  if (payment.status === "paid") return { status: "paid" };

  // TODO : appeler l'API de l'agrégateur ici et renvoyer { paymentUrl } ou les instructions USSD.
  throw new HttpsError("unimplemented", "Paiement Mobile Money pas encore disponible. Payez en espèces.");
});

export const mobileMoneyWebhook = onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }
  const secret = process.env.MOBILE_MONEY_WEBHOOK_SECRET ?? "";
  const received = String(req.get("x-webhook-secret") ?? "");
  if (!secret || !safeEqual(secret, received)) {
    res.status(401).send("Unauthorized");
    return;
  }

  const { rideId, transactionId, status } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof rideId !== "string" || typeof transactionId !== "string") {
    res.status(400).send("Bad Request");
    return;
  }

  // TODO : revérifier le statut de transactionId via l'API de l'agrégateur avant d'y croire.
  if (status === "SUCCESS") {
    await db.doc(`payments/${rideId}`).update({
      status: "paid",
      transactionId,
      paidAt: FieldValue.serverTimestamp(),
    });
  } else {
    logger.info("Paiement Mobile Money non abouti", { rideId, transactionId, status });
    await db.doc(`payments/${rideId}`).update({ status: "failed", transactionId });
  }
  res.status(200).send("OK");
});

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
