// Types partagés entre toutes les fonctions.
// Le front Flutter doit utiliser exactement les mêmes valeurs (voir docs/API.md).

export const VEHICLE_CLASSES = ["moto", "standard", "confort"] as const;
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];

export const PAYMENT_METHODS = ["cash", "orange_money", "moov_money"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type RideStatus =
  | "searching" // on cherche un chauffeur
  | "driver_assigned" // un chauffeur a accepté, il vient
  | "driver_arrived" // le chauffeur est au point de départ
  | "in_progress" // PIN validé, course en cours
  | "completed" // course terminée
  | "cancelled" // annulée par le passager ou le chauffeur
  | "no_driver"; // aucun chauffeur n'a accepté

export const ACTIVE_STATUSES: RideStatus[] = [
  "searching",
  "driver_assigned",
  "driver_arrived",
  "in_progress",
];

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Place extends LatLng {
  label: string; // ex. "Grand Marché" ou "Point sur la carte"
  landmarkId?: string; // id du repère dans la collection landmarks
}

/** Tarif d'une gamme, en FCFA. Document pricing/{vehicleClass}. */
export interface PricingConfig {
  base: number;
  perKm: number;
  perMinute: number;
  minimum: number;
}

/** Réglages généraux modifiables par l'admin. Document config/app. */
export interface AppConfig {
  surge: number; // majoration de 1.0 à 2.5
  commissionRate: number; // 0.15 = 15 %
  freeCancelSeconds: number; // annulation gratuite pendant ce délai après l'attribution
  cancelFee: number; // frais d'annulation en FCFA
  offerTimeoutSeconds: number; // temps laissé au chauffeur pour accepter
  searchRadiusKm: number; // rayon de recherche des chauffeurs
  maxOffers: number; // nombre de chauffeurs sollicités avant "no_driver"
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  surge: 1,
  commissionRate: 0.15,
  freeCancelSeconds: 120,
  cancelFee: 500,
  offerTimeoutSeconds: 15,
  searchRadiusKm: 5,
  maxOffers: 5,
};

export type OfferResult = "accepted" | "declined" | "timeout" | "cancelled";
