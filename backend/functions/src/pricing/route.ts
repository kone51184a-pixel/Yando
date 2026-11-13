import { logger } from "firebase-functions/v2";
import { distanceBetween } from "geofire-common";
import { LatLng } from "../shared/types";

export interface RouteInfo {
  distanceKm: number;
  durationMin: number;
  source: "osrm" | "estimation";
}

// Serveur OSRM public : OK pour le développement et la démo, pas pour la production.
const OSRM_URL = process.env.OSRM_URL ?? "https://router.project-osrm.org";

// Si OSRM ne répond pas, on estime : distance à vol d'oiseau × 1,35 et 20 km/h en moyenne.
const DETOUR_FACTOR = 1.35;
const AVERAGE_SPEED_KMH = 20;

export function estimateRoute(a: LatLng, b: LatLng): RouteInfo {
  const straightKm = distanceBetween([a.lat, a.lng], [b.lat, b.lng]);
  const distanceKm = round1(straightKm * DETOUR_FACTOR);
  const durationMin = Math.max(1, Math.round((distanceKm / AVERAGE_SPEED_KMH) * 60));
  return { distanceKm, durationMin, source: "estimation" };
}

export async function getRoute(a: LatLng, b: LatLng): Promise<RouteInfo> {
  const url = `${OSRM_URL}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    const body = (await res.json()) as { code: string; routes?: { distance: number; duration: number }[] };
    const route = body.routes?.[0];
    if (body.code !== "Ok" || !route) throw new Error(`OSRM code ${body.code}`);
    return {
      distanceKm: round1(route.distance / 1000),
      durationMin: Math.max(1, Math.round(route.duration / 60)),
      source: "osrm",
    };
  } catch (err) {
    logger.warn("OSRM indisponible, estimation utilisée", { err: String(err) });
    return estimateRoute(a, b);
  }
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
