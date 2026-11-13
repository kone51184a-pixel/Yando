import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./firebase";
import { AppConfig, DEFAULT_APP_CONFIG, PricingConfig, VEHICLE_CLASSES, VehicleClass } from "./types";

export async function getAppConfig(): Promise<AppConfig> {
  const snap = await db.doc("config/app").get();
  return { ...DEFAULT_APP_CONFIG, ...(snap.data() as Partial<AppConfig> | undefined) };
}

export async function getAllPricing(): Promise<Record<VehicleClass, PricingConfig>> {
  const refs = VEHICLE_CLASSES.map((c) => db.doc(`pricing/${c}`));
  const snaps = await db.getAll(...refs);
  const result = {} as Record<VehicleClass, PricingConfig>;
  snaps.forEach((snap, i) => {
    const cls = VEHICLE_CLASSES[i];
    if (!snap.exists) {
      throw new HttpsError("failed-precondition", `Tarif manquant pour la gamme "${cls}". Lancer le seed.`);
    }
    result[cls] = snap.data() as PricingConfig;
  });
  return result;
}
