import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateYear, estimateSavings, climateAt } from '../src/lib/solar.ts';

// Approximate long-term monthly climate for four cities
// (kWh/m2/day horizontal, deg C), hard-coded so tests run offline.
const CITIES = {
  phoenix: { latitude: 33.45, ghi: [3.2, 4.1, 5.5, 6.9, 7.7, 8.0, 7.2, 6.6, 5.8, 4.6, 3.5, 2.9], tempC: [12, 14, 17, 21, 26, 31, 34, 33, 30, 23, 16, 11] },
  seattle: { latitude: 47.6, ghi: [1.0, 1.8, 2.9, 4.2, 5.3, 5.9, 6.3, 5.4, 3.9, 2.2, 1.2, 0.8], tempC: [5, 6, 8, 10, 14, 16, 19, 19, 16, 11, 7, 4] },
  boston: { latitude: 42.36, ghi: [1.9, 2.7, 3.8, 4.7, 5.6, 6.1, 6.1, 5.4, 4.3, 3.0, 1.9, 1.6], tempC: [-2, -1, 3, 9, 14, 19, 23, 22, 18, 12, 6, 1] },
  denver: { latitude: 39.74, ghi: [2.4, 3.3, 4.5, 5.6, 6.4, 7.1, 6.9, 6.1, 5.2, 3.8, 2.6, 2.1], tempC: [-1, 0, 5, 9, 14, 20, 23, 22, 17, 10, 3, -1] },
};

const kit = (overrides = {}) => ({ dcWatts: 1000, acLimitWatts: 1000, tiltDeg: 30, azimuthDeg: 180, ...overrides });
const yieldOf = (city, overrides) => simulateYear(CITIES[city], kit(overrides)).annualKwh;

test('annual yield of a tilted south-facing kW lands near published PVWatts values', () => {
  // PVWatts (14% losses, fixed open rack, moderate tilt) reports roughly
  // these kWh per kW-DC per year. We accept +/-10%: this is a screening model.
  const expected = { phoenix: 1750, seattle: 1150, boston: 1330, denver: 1620 };
  for (const [city, target] of Object.entries(expected)) {
    const got = yieldOf(city);
    assert.ok(Math.abs(got - target) / target < 0.1, `${city}: ${got.toFixed(0)} vs ~${target}`);
  }
});

test('a vertical railing mount makes roughly 60-75% of a tilted one', () => {
  for (const city of Object.keys(CITIES)) {
    const ratio = yieldOf(city, { tiltDeg: 90 }) / yieldOf(city);
    assert.ok(ratio > 0.55 && ratio < 0.8, `${city}: ${ratio.toFixed(2)}`);
  }
});

test('orientation ranks south > east/west > north, and east equals west', () => {
  const at = (azimuthDeg) => yieldOf('denver', { tiltDeg: 90, azimuthDeg });
  assert.ok(at(180) > at(90) && at(90) > at(0));
  assert.ok(Math.abs(at(90) - at(270)) / at(90) < 0.01);
  assert.ok(at(0) > 0, 'north-facing panels still collect diffuse light');
});

test('vertical panels peak in the shoulder seasons or winter, tilted ones in summer', () => {
  const monthly = (tiltDeg) => simulateYear(CITIES.boston, kit({ tiltDeg })).monthlyKwh;
  const tilted = monthly(30);
  const vertical = monthly(90);
  assert.ok(tilted[6] > tilted[0] * 1.5);
  assert.ok(vertical[6] / vertical[0] < tilted[6] / tilted[0]);
});

test('output scales with panel size until the inverter clips', () => {
  const small = simulateYear(CITIES.phoenix, kit({ dcWatts: 400, acLimitWatts: 400 }));
  const big = simulateYear(CITIES.phoenix, kit({ dcWatts: 800, acLimitWatts: 800 }));
  assert.ok(Math.abs(big.annualKwh / small.annualKwh - 2) < 0.01);

  const oversized = simulateYear(CITIES.phoenix, kit({ dcWatts: 1600, acLimitWatts: 800 }));
  assert.ok(oversized.clippedKwh > 0);
  assert.ok(oversized.annualKwh < small.annualKwh * 4);
  const peak = Math.max(...oversized.months.flatMap((m) => m.profiles.flatMap((p) => p.acWatts)));
  assert.ok(peak <= 800 + 1e-9, 'never exceeds the AC limit');
});

test('shading and losses only ever reduce output', () => {
  assert.ok(yieldOf('boston', { shading: 0.3 }) < yieldOf('boston'));
  assert.ok(yieldOf('boston', { shading: 1 }) > 0, 'full shade still leaves diffuse light');
  assert.ok(yieldOf('boston', { systemLosses: 0.3 }) < yieldOf('boston'));
});

test('day-type weights sum to one and monthly totals add up', () => {
  const r = simulateYear(CITIES.seattle, kit());
  for (const m of r.months) {
    assert.ok(Math.abs(m.profiles.reduce((s, p) => s + p.weight, 0) - 1) < 1e-9);
  }
  assert.ok(Math.abs(r.monthlyKwh.reduce((a, b) => a + b, 0) - r.annualKwh) < 1e-9);
});

test('savings: without export credit only self-used energy is worth anything', () => {
  const production = simulateYear(CITIES.denver, kit({ dcWatts: 800, acLimitWatts: 800, tiltDeg: 90 }));
  const low = estimateSavings(production, { rateCents: 15, baseloadWatts: 100, kitCost: 900 });
  const high = estimateSavings(production, { rateCents: 15, baseloadWatts: 5000, kitCost: 900 });

  assert.ok(low.selfUseShare < high.selfUseShare);
  assert.ok(Math.abs(high.selfUseShare - 1) < 1e-9, 'a huge load absorbs everything');
  assert.ok(Math.abs(high.annualSavings - production.annualKwh * 0.15) < 1e-6);
  assert.ok(Math.abs(low.selfUsedKwh + low.exportedKwh - production.annualKwh) < 1e-9);
  assert.ok(low.paybackYears > high.paybackYears);

  const credited = estimateSavings(production, { rateCents: 15, baseloadWatts: 100, exportCreditCents: 15 });
  assert.ok(Math.abs(credited.annualSavings - production.annualKwh * 0.15) < 1e-6);
});

test('savings: zero production does not divide by zero', () => {
  const dark = simulateYear({ latitude: 40, ghi: Array(12).fill(0), tempC: Array(12).fill(10) }, kit());
  const s = estimateSavings(dark, { rateCents: 15, baseloadWatts: 200, kitCost: 500 });
  assert.equal(dark.annualKwh, 0);
  assert.equal(s.paybackYears, null);
  assert.equal(s.selfUseShare, 0);
});

test('high latitudes with polar night do not produce NaN', () => {
  const r = simulateYear({ latitude: 71.3, ghi: [0, 0.4, 1.8, 4.2, 5.4, 5.6, 4.8, 2.9, 1.5, 0.5, 0.02, 0], tempC: Array(12).fill(-10) }, kit({ tiltDeg: 90 }));
  assert.ok(Number.isFinite(r.annualKwh) && r.annualKwh > 0);
  assert.ok(r.monthlyKwh.every((v) => Number.isFinite(v) && v >= 0));
});

test('climateAt blends neighbouring cells and reports missing coverage', () => {
  const cell = (ghi, t) => [Array(12).fill(ghi * 100), Array(12).fill(t * 10)];
  const grid = { '40.5,-105.5': cell(4, 10), '40.5,-104.5': cell(6, 20) };
  const mid = climateAt(grid, 40.5, -105);
  assert.ok(Math.abs(mid.ghi[0] - 5) < 1e-9);
  assert.ok(Math.abs(mid.tempC[0] - 15) < 1e-9);
  assert.ok(Math.abs(climateAt(grid, 40.5, -105.5).ghi[0] - 4) < 1e-9);
  assert.equal(climateAt(grid, 10, 10), null);
});
