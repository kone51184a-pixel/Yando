import { setGlobalOptions } from "firebase-functions/v2";

// Région la plus proche de Bamako parmi les régions courantes de Firebase.
setGlobalOptions({ region: "europe-west1", maxInstances: 10 });

export { estimatePrice } from "./pricing/estimatePrice";
export { createRide } from "./rides/createRide";
export { dispatchRide } from "./matching/dispatch";
export { acceptRide, declineRide, driverArrived, startRide, completeRide } from "./rides/driverActions";
export { cancelRide, rateRide, createShareLink, sharedTrip } from "./rides/passengerActions";
export { initiateMobileMoneyPayment, mobileMoneyWebhook } from "./payments/mobileMoney";
export { validateDriver } from "./admin/adminActions";
