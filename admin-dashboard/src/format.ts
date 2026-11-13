import { Timestamp } from "firebase/firestore";

export const VEHICLE_CLASSES = ["moto", "standard", "confort"] as const;
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];

export const VEHICLE_LABELS: Record<string, string> = {
  moto: "Moto Express",
  standard: "Standard",
  confort: "Confort",
};

export const VEHICLE_COLORS: Record<string, string> = {
  moto: "#e8833a",
  standard: "#2f6fdb",
  confort: "#7a3fd1",
};

export const STATUS_LABELS: Record<string, string> = {
  searching: "Recherche",
  driver_assigned: "Chauffeur en route",
  driver_arrived: "Chauffeur arrivé",
  in_progress: "En cours",
  completed: "Terminée",
  cancelled: "Annulée",
  no_driver: "Aucun chauffeur",
};

export const ACTIVE_STATUSES = ["searching", "driver_assigned", "driver_arrived", "in_progress"];

export const PAYMENT_LABELS: Record<string, string> = {
  cash: "Espèces",
  orange_money: "Orange Money",
  moov_money: "Moov Money",
};

const nf = new Intl.NumberFormat("fr-FR");
export const fcfa = (n: number | null | undefined) => (n == null ? "—" : `${nf.format(n)} FCFA`);

export function toDate(v: unknown): Date | null {
  if (v instanceof Timestamp) return v.toDate();
  if (v instanceof Date) return v;
  return null;
}

export function dateTime(v: unknown): string {
  const d = toDate(v);
  return d ? d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—";
}

export function time(v: unknown): string {
  const d = toDate(v);
  return d ? d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—";
}

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function minutesBetween(a: unknown, b: unknown): number | null {
  const da = toDate(a);
  const dbb = toDate(b);
  if (!da || !dbb) return null;
  return (dbb.getTime() - da.getTime()) / 60000;
}

export function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}
