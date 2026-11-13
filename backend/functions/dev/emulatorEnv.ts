// À importer EN PREMIER dans les scripts de développement :
// pointe le SDK Admin vers les émulateurs locaux (sauf si --prod).
export const PROJECT_ID = process.env.GCLOUD_PROJECT ?? "demo-vtc-bamako";
export const EMULATOR_HOST = "127.0.0.1";
// Port 8080 souvent pris sous Windows (Apache/XAMPP) : Firestore écoute sur 8085.
export const FIRESTORE_PORT = 8085;

if (!process.argv.includes("--prod")) {
  process.env.GCLOUD_PROJECT ??= PROJECT_ID;
  process.env.FIRESTORE_EMULATOR_HOST ??= `${EMULATOR_HOST}:${FIRESTORE_PORT}`;
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= `${EMULATOR_HOST}:9099`;
  process.env.FIREBASE_DATABASE_EMULATOR_HOST ??= `${EMULATOR_HOST}:9000`;
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= `${EMULATOR_HOST}:9199`;
}
