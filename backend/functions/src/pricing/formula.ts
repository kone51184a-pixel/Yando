import { PricingConfig } from "../shared/types";

// Formule du cahier des charges (section 6) :
// Prix = max(Prix minimum ; (Base + km × Prix/km + minutes × Prix/minute) × Majoration)
// arrondi à 25 FCFA. Ces fonctions sont pures pour pouvoir être testées facilement.

export const MIN_SURGE = 1;
export const MAX_SURGE = 2.5;

export function roundTo25(amount: number): number {
  return Math.round(amount / 25) * 25;
}

export function clampSurge(surge: number): number {
  if (!isFinite(surge)) return MIN_SURGE;
  return Math.min(MAX_SURGE, Math.max(MIN_SURGE, surge));
}

export function computeFare(p: PricingConfig, distanceKm: number, durationMin: number, surge: number): number {
  const raw = (p.base + distanceKm * p.perKm + durationMin * p.perMinute) * clampSurge(surge);
  return roundTo25(Math.max(p.minimum, raw));
}

export interface PromoRule {
  type: "percent" | "fixed";
  value: number;
}

export function applyPromo(fare: number, promo: PromoRule | null): { price: number; discount: number } {
  if (!promo) return { price: fare, discount: 0 };
  const rawDiscount = promo.type === "percent" ? (fare * promo.value) / 100 : promo.value;
  const discount = roundTo25(Math.min(Math.max(rawDiscount, 0), fare));
  return { price: fare - discount, discount };
}

export function computeCommission(price: number, rate: number): { commission: number; driverEarnings: number } {
  const commission = Math.round(price * rate);
  return { commission, driverEarnings: price - commission };
}
