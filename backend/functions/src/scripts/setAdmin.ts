/**
 * Donne le rôle administrateur à un compte (pour le tableau de bord).
 * Émulateur : FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run set-admin -- <uid>
 */
if (!process.env.GCLOUD_PROJECT) process.env.GCLOUD_PROJECT = "demo-vtc-bamako";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { auth } = require("../shared/firebase") as typeof import("../shared/firebase");

async function main() {
  const uid = process.argv[2];
  if (!uid) {
    console.error("Usage : npm run set-admin -- <uid>");
    process.exit(1);
  }
  const user = await auth.getUser(uid);
  await auth.setCustomUserClaims(uid, { ...(user.customClaims ?? {}), admin: true });
  console.log(`${uid} est maintenant administrateur (se reconnecter pour l'activer).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
