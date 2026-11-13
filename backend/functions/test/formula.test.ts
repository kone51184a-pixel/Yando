import assert from "node:assert/strict";
import { test } from "node:test";
import { applyPromo, clampSurge, computeCommission, computeFare, roundTo25 } from "../src/pricing/formula";
import { estimateRoute } from "../src/pricing/route";

const standard = { base: 500, perKm: 250, perMinute: 25, minimum: 1000 };

test("arrondi à 25 FCFA", () => {
  assert.equal(roundTo25(1012), 1000);
  assert.equal(roundTo25(1013), 1025);
  assert.equal(roundTo25(1037.5), 1050);
});

test("prix standard : (500 + 6 km × 250 + 18 min × 25) = 2450", () => {
  assert.equal(computeFare(standard, 6, 18, 1), 2450);
});

test("le prix minimum s'applique sur les très petites courses", () => {
  assert.equal(computeFare(standard, 0.5, 2, 1), 1000);
});

test("majoration appliquée puis arrondie", () => {
  // 2450 × 1.3 = 3185 → 3175
  assert.equal(computeFare(standard, 6, 18, 1.3), 3175);
});

test("majoration bornée entre 1.0 et 2.5", () => {
  assert.equal(clampSurge(0.5), 1);
  assert.equal(clampSurge(4), 2.5);
  assert.equal(clampSurge(NaN), 1);
});

test("code promo en pourcentage et montant fixe", () => {
  assert.deepEqual(applyPromo(2450, { type: "percent", value: 20 }), { price: 1950, discount: 500 });
  assert.deepEqual(applyPromo(2450, { type: "fixed", value: 300 }), { price: 2150, discount: 300 });
  assert.deepEqual(applyPromo(800, { type: "fixed", value: 5000 }), { price: 0, discount: 800 });
  assert.deepEqual(applyPromo(2450, null), { price: 2450, discount: 0 });
});

test("commission de 15 %", () => {
  assert.deepEqual(computeCommission(2450, 0.15), { commission: 368, driverEarnings: 2082 });
});

test("estimation de secours si OSRM ne répond pas", () => {
  // Grand Marché → ACI 2000 : quelques km
  const r = estimateRoute({ lat: 12.6497, lng: -8.0003 }, { lat: 12.623, lng: -8.023 });
  assert.equal(r.source, "estimation");
  assert.ok(r.distanceKm > 3 && r.distanceKm < 8, `distance ${r.distanceKm}`);
  assert.ok(r.durationMin >= 1);
});
