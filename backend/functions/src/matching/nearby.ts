import { distanceBetween, geohashQueryBounds } from "geofire-common";
import { rtdb } from "../shared/firebase";
import { LatLng, VehicleClass } from "../shared/types";

/**
 * Format écrit par l'app chauffeur dans Realtime Database :
 * driverLocations/{driverId} = { lat, lng, g (geohash), heading, online, vehicleClass, ts (ms) }
 */
export interface DriverLocation {
  lat: number;
  lng: number;
  g: string;
  heading?: number;
  online: boolean;
  vehicleClass: VehicleClass;
  ts: number;
}

export interface NearbyDriver {
  driverId: string;
  distanceKm: number;
}

// Une position plus vieille que ça est ignorée (chauffeur sans réseau ou app fermée).
const MAX_LOCATION_AGE_MS = 90_000;

export async function findNearbyDrivers(
  center: LatLng,
  vehicleClass: VehicleClass,
  radiusKm: number,
  exclude: string[] = [],
): Promise<NearbyDriver[]> {
  const bounds = geohashQueryBounds([center.lat, center.lng], radiusKm * 1000);
  const snaps = await Promise.all(
    bounds.map(([start, end]) => rtdb.ref("driverLocations").orderByChild("g").startAt(start).endAt(end).get()),
  );

  const now = Date.now();
  const found = new Map<string, number>();
  for (const snap of snaps) {
    snap.forEach((child) => {
      const loc = child.val() as DriverLocation;
      const id = child.key;
      if (!id || exclude.includes(id)) return;
      if (!loc.online || loc.vehicleClass !== vehicleClass) return;
      if (now - loc.ts > MAX_LOCATION_AGE_MS) return;
      const d = distanceBetween([loc.lat, loc.lng], [center.lat, center.lng]);
      if (d <= radiusKm) found.set(id, d);
    });
  }

  return [...found.entries()]
    .map(([driverId, distanceKm]) => ({ driverId, distanceKm }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}
