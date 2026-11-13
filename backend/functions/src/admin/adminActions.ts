import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { auth, db } from "../shared/firebase";
import { notify } from "../shared/notify";
import { requireAdmin } from "../shared/validate";

/**
 * Validation d'un chauffeur par l'admin après vérification des documents.
 * Entrée : { driverId, approve: boolean, reason? }
 * Donne le "custom claim" driver:true, nécessaire pour toutes les fonctions chauffeur.
 * Le chauffeur doit rafraîchir son token (getIdToken(true)) pour en profiter.
 */
export const validateDriver = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const data = (request.data ?? {}) as { driverId?: unknown; approve?: unknown; reason?: unknown };
  if (typeof data.driverId !== "string" || typeof data.approve !== "boolean") {
    throw new HttpsError("invalid-argument", "driverId et approve sont obligatoires.");
  }
  const driverId = data.driverId;
  const approve = data.approve;
  const reason = typeof data.reason === "string" ? data.reason.slice(0, 300) : null;

  const driverRef = db.doc(`drivers/${driverId}`);
  if (!(await driverRef.get()).exists) throw new HttpsError("not-found", "Chauffeur introuvable.");

  const user = await auth.getUser(driverId).catch((err: { code?: string }) => {
    if (err.code === "auth/user-not-found") {
      throw new HttpsError("failed-precondition", "Ce chauffeur n'a pas de compte de connexion.");
    }
    throw err;
  });
  await auth.setCustomUserClaims(driverId, { ...(user.customClaims ?? {}), driver: approve });
  await driverRef.update({
    status: approve ? "approved" : "rejected",
    rejectionReason: approve ? null : reason,
    reviewedBy: adminUid,
    reviewedAt: FieldValue.serverTimestamp(),
  });

  await notify(
    "drivers",
    driverId,
    { type: approve ? "driver_approved" : "driver_rejected" },
    approve
      ? { title: "Compte validé", body: "Vous pouvez passer en ligne." }
      : { title: "Compte refusé", body: reason ?? "Vérifiez vos documents." },
  );
  return { ok: true };
});
