import { onCall } from "firebase-functions/v2/https";
import { getAllPricing, getAppConfig } from "../shared/config";
import { VEHICLE_CLASSES } from "../shared/types";
import { parseLatLng, requireAuth } from "../shared/validate";
import { clampSurge, computeFare } from "./formula";
import { getRoute } from "./route";

/**
 * Estimation du prix pour les 3 gammes, avant la commande.
 * Entrée : { pickup: {lat,lng}, dropoff: {lat,lng} }
 */
export const estimatePrice = onCall(async (request) => {
  requireAuth(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const pickup = parseLatLng(data.pickup, "pickup");
  const dropoff = parseLatLng(data.dropoff, "dropoff");

  const [route, config, pricing] = await Promise.all([getRoute(pickup, dropoff), getAppConfig(), getAllPricing()]);
  const surge = clampSurge(config.surge);

  return {
    distanceKm: route.distanceKm,
    durationMin: route.durationMin,
    routeSource: route.source,
    surge,
    currency: "XOF",
    estimates: VEHICLE_CLASSES.map((vehicleClass) => ({
      vehicleClass,
      price: computeFare(pricing[vehicleClass], route.distanceKm, route.durationMin, surge),
    })),
  };
});
