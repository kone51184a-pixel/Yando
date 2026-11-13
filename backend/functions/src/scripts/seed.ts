/**
 * Remplit la base avec les tarifs de test, la config et les repères de Bamako.
 * Par défaut UNIQUEMENT sur l'émulateur :
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run seed
 * Sur le vrai projet (après validation des tarifs) : npm run seed -- --prod
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const isProd = process.argv.includes("--prod");
if (!isProd && !process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("FIRESTORE_EMULATOR_HOST n'est pas défini. Lancez les émulateurs ou ajoutez --prod.");
  process.exit(1);
}
if (!process.env.GCLOUD_PROJECT) process.env.GCLOUD_PROJECT = "demo-vtc-bamako";

// Import après la configuration de l'environnement.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { db } = require("../shared/firebase") as typeof import("../shared/firebase");

const seedDir = resolve(__dirname, "../../../../seed");
const read = <T>(file: string): T => JSON.parse(readFileSync(resolve(seedDir, file), "utf8")) as T;

async function main() {
  const pricing = read<Record<string, unknown>>("pricing.json");
  const config = read<Record<string, unknown>>("config.json");
  const landmarks = read<{ id: string; name: string; type: string; lat: number; lng: number }[]>("landmarks.json");

  const batch = db.batch();
  for (const [cls, values] of Object.entries(pricing)) {
    if (cls.startsWith("_")) continue; // commentaires du JSON
    batch.set(db.doc(`pricing/${cls}`), values as Record<string, unknown>);
  }
  batch.set(db.doc("config/app"), config);
  for (const l of landmarks) {
    batch.set(db.doc(`landmarks/${l.id}`), { name: l.name, type: l.type, lat: l.lat, lng: l.lng });
  }
  await batch.commit();
  console.log(`OK : ${Object.keys(pricing).length - 1} tarifs, config, ${landmarks.length} repères.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
