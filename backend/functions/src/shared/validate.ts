import { CallableRequest, HttpsError } from "firebase-functions/v2/https";
import { LatLng, PAYMENT_METHODS, PaymentMethod, Place, VEHICLE_CLASSES, VehicleClass } from "./types";

// Zone de Bamako (large, pour inclure Kati, Senou, Kalaban Coro...). À ajuster si besoin.
const BAMAKO_BOUNDS = { minLat: 12.45, maxLat: 12.8, minLng: -8.2, maxLng: -7.8 };

export function requireAuth(request: CallableRequest<unknown>): string {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Connexion requise.");
  }
  return request.auth.uid;
}

export function requireDriver(request: CallableRequest<unknown>): string {
  const uid = requireAuth(request);
  if (request.auth?.token.driver !== true) {
    throw new HttpsError("permission-denied", "Compte chauffeur non validé.");
  }
  return uid;
}

export function requireAdmin(request: CallableRequest<unknown>): string {
  const uid = requireAuth(request);
  if (request.auth?.token.admin !== true) {
    throw new HttpsError("permission-denied", "Réservé à l'administrateur.");
  }
  return uid;
}

export function isInBamako(p: LatLng): boolean {
  return (
    p.lat >= BAMAKO_BOUNDS.minLat &&
    p.lat <= BAMAKO_BOUNDS.maxLat &&
    p.lng >= BAMAKO_BOUNDS.minLng &&
    p.lng <= BAMAKO_BOUNDS.maxLng
  );
}

export function parseLatLng(value: unknown, field: string): LatLng {
  const v = value as Partial<LatLng> | undefined;
  if (!v || typeof v.lat !== "number" || typeof v.lng !== "number" || !isFinite(v.lat) || !isFinite(v.lng)) {
    throw new HttpsError("invalid-argument", `${field} : latitude/longitude invalides.`);
  }
  if (!isInBamako({ lat: v.lat, lng: v.lng })) {
    throw new HttpsError("out-of-range", `${field} : en dehors de la zone de Bamako.`);
  }
  return { lat: v.lat, lng: v.lng };
}

export function parsePlace(value: unknown, field: string): Place {
  const { lat, lng } = parseLatLng(value, field);
  const v = value as Partial<Place>;
  const label = typeof v.label === "string" && v.label.trim() ? v.label.trim().slice(0, 120) : "Point sur la carte";
  const place: Place = { lat, lng, label };
  if (typeof v.landmarkId === "string" && v.landmarkId) place.landmarkId = v.landmarkId;
  return place;
}

export function parseVehicleClass(value: unknown): VehicleClass {
  if (typeof value !== "string" || !(VEHICLE_CLASSES as readonly string[]).includes(value)) {
    throw new HttpsError("invalid-argument", `vehicleClass doit être : ${VEHICLE_CLASSES.join(", ")}.`);
  }
  return value as VehicleClass;
}

export function parsePaymentMethod(value: unknown): PaymentMethod {
  if (typeof value !== "string" || !(PAYMENT_METHODS as readonly string[]).includes(value)) {
    throw new HttpsError("invalid-argument", `paymentMethod doit être : ${PAYMENT_METHODS.join(", ")}.`);
  }
  return value as PaymentMethod;
}

export function parseRideId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new HttpsError("invalid-argument", "rideId invalide.");
  }
  return value;
}
