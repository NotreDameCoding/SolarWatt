// Plug-in solar production model. Pure functions, no dependencies, runs in the
// browser and under `node --test`.
//
// Why not just call PVWatts? Three reasons: no API key to leak from a static
// site, it works offline, and balcony panels are usually vertical or steeply
// tilted and facing whatever direction the building faces, so we need the
// hour-by-hour shape of the day (for self-consumption and inverter clipping),
// not only an annual total.
//
// Method, per month:
//   1. Start from the long-term mean daily sunshine on a horizontal surface
//      (GHI, kWh/m2/day) and mean air temperature.
//   2. Split the month into "clear" and "overcast" days whose mix reproduces
//      the monthly mean. Real months are not 30 identical hazy days, and a
//      single average day badly underestimates midday peaks.
//   3. For each day type, split daily GHI into beam and diffuse (Erbs et al.
//      1982), spread both across the day (Collares-Pereira & Rabl 1979; Liu &
//      Jordan 1960), and transpose onto the tilted panel (Hay & Davies 1980).
//   4. Convert to DC power with a cell-temperature derate, apply system
//      losses, then inverter efficiency and the AC clip.
//
// References: Duffie & Beckman, "Solar Engineering of Thermal Processes", 4th ed.

const RAD = Math.PI / 180;
const SOLAR_CONSTANT = 1.367; // kW/m2
export const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
// Day of year whose extraterrestrial radiation is closest to the monthly mean (Klein 1977).
const MEAN_DAY = [17, 47, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344];
export const STEPS_PER_DAY = 96; // 15-minute resolution
const STEP_HOURS = 24 / STEPS_PER_DAY;

const CLEAR_KT = 0.72;
const OVERCAST_KT = 0.2;

export interface SystemConfig {
  /** Sum of panel nameplate ratings, watts DC. */
  dcWatts: number;
  /** Inverter AC output limit in watts (what the law's cap applies to). */
  acLimitWatts: number;
  /** Panel tilt from horizontal in degrees. 0 = flat, 90 = vertical on a railing. */
  tiltDeg: number;
  /** Compass direction the panel faces, degrees clockwise from north. 180 = south. */
  azimuthDeg: number;
  /** Fraction of sunlight lost to shade, 0..1. */
  shading?: number;
  /** Wiring, soiling, mismatch, etc. PVWatts' default total is 14%. */
  systemLosses?: number;
  inverterEfficiency?: number;
  /** Fraction of light the ground/street reflects back up. */
  albedo?: number;
}

export interface Climate {
  latitude: number;
  /** 12 values, kWh/m2/day on a horizontal surface. */
  ghi: number[];
  /** 12 values, mean air temperature in deg C. */
  tempC: number[];
}

export interface DayProfile {
  /** Share of the month's days this profile stands for, 0..1. */
  weight: number;
  /** AC watts for each of STEPS_PER_DAY slots, in local solar time. */
  acWatts: number[];
}

export interface MonthResult {
  kwh: number;
  profiles: DayProfile[];
}

export interface ProductionResult {
  annualKwh: number;
  monthlyKwh: number[];
  months: MonthResult[];
  /** kWh per year lost because the inverter clips at its AC limit. */
  clippedKwh: number;
}

/** Daily extraterrestrial radiation on a horizontal surface, kWh/m2. */
function extraterrestrial(latRad: number, decl: number, dayOfYear: number, sunset: number): number {
  const ecc = 1 + 0.033 * Math.cos((2 * Math.PI * dayOfYear) / 365);
  return (24 / Math.PI) * SOLAR_CONSTANT * ecc *
    (Math.cos(latRad) * Math.cos(decl) * Math.sin(sunset) + sunset * Math.sin(latRad) * Math.sin(decl));
}

/** Erbs daily diffuse fraction as a function of daily clearness index. */
function diffuseFraction(kt: number, sunsetDeg: number): number {
  if (sunsetDeg <= 81.4) {
    return kt < 0.715
      ? 1 - 0.2727 * kt + 2.4495 * kt ** 2 - 11.9514 * kt ** 3 + 9.3879 * kt ** 4
      : 0.143;
  }
  return kt < 0.722 ? 1 + 0.2832 * kt - 2.5557 * kt ** 2 + 0.8448 * kt ** 3 : 0.175;
}

/** One day's AC output profile for a given daily horizontal irradiation. */
function simulateDay(
  dailyGhi: number, climate: Climate, month: number, sys: Required<SystemConfig>,
): { acWatts: number[]; clippedWh: number } {
  const lat = climate.latitude * RAD;
  const n = MEAN_DAY[month];
  const decl = 23.45 * RAD * Math.sin((2 * Math.PI * (284 + n)) / 365);
  const cosSunset = Math.max(-1, Math.min(1, -Math.tan(lat) * Math.tan(decl)));
  const ws = Math.acos(cosSunset);
  const acWatts = new Array<number>(STEPS_PER_DAY).fill(0);
  if (ws <= 0.01 || dailyGhi <= 0) return { acWatts, clippedWh: 0 };

  const h0 = extraterrestrial(lat, decl, n, ws);
  const kt = Math.min(0.8, dailyGhi / h0);
  const dailyDiffuse = dailyGhi * Math.min(1, diffuseFraction(kt, ws / RAD));

  const tilt = sys.tiltDeg * RAD;
  // Internal convention: surface azimuth 0 = south, west positive.
  const gamma = (sys.azimuthDeg - 180) * RAD;
  const a = 0.409 + 0.5016 * Math.sin(ws - 60 * RAD);
  const b = 0.6609 - 0.4767 * Math.sin(ws - 60 * RAD);
  const denom = Math.sin(ws) - ws * Math.cos(ws);
  const ecc = 1 + 0.033 * Math.cos((2 * Math.PI * n) / 365);
  // Afternoons are warmer than the 24-hour mean the climatology reports.
  const daytimeTemp = climate.tempC[month] + 3;
  let clippedWh = 0;

  for (let i = 0; i < STEPS_PER_DAY; i++) {
    const solarHour = (i + 0.5) * STEP_HOURS;
    const w = (solarHour - 12) * 15 * RAD;
    if (Math.abs(w) >= ws) continue;
    const cosZenith = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(w);
    if (cosZenith <= 0.01) continue;

    // Hourly-equivalent irradiance (kW/m2) from the daily totals.
    const rd = (Math.PI / 24) * (Math.cos(w) - Math.cos(ws)) / denom;
    const rt = Math.max(0, (a + b * Math.cos(w)) * rd);
    const global = dailyGhi * rt;
    const diffuse = Math.min(global, dailyDiffuse * rd);
    const beam = global - diffuse;

    const cosIncidence =
      Math.sin(decl) * Math.sin(lat) * Math.cos(tilt)
      - Math.sin(decl) * Math.cos(lat) * Math.sin(tilt) * Math.cos(gamma)
      + Math.cos(decl) * Math.cos(lat) * Math.cos(tilt) * Math.cos(w)
      + Math.cos(decl) * Math.sin(lat) * Math.sin(tilt) * Math.cos(gamma) * Math.cos(w)
      + Math.cos(decl) * Math.sin(tilt) * Math.sin(gamma) * Math.sin(w);
    const facing = Math.max(0, cosIncidence);
    // Cap the geometric gain near sunrise/sunset where cosZenith -> 0.
    const rb = Math.min(facing / cosZenith, 8);
    // Glass reflects more at glancing angles (ASHRAE incidence-angle modifier).
    const iam = facing > 0.05 ? Math.max(0, 1 - 0.05 * (1 / facing - 1)) : 0;

    const anisotropy = Math.min(1, beam / (SOLAR_CONSTANT * ecc * cosZenith));
    const poa = (1 - sys.shading) * (beam + diffuse * anisotropy) * rb * iam
      + diffuse * (1 - anisotropy) * (1 + Math.cos(tilt)) / 2
      + global * sys.albedo * (1 - Math.cos(tilt)) / 2;
    if (poa <= 0) continue;

    const cellTemp = daytimeTemp + poa * 31.25; // NOCT 45 C => (45-20)/0.8 per kW/m2
    const dc = sys.dcWatts * poa * (1 - 0.0037 * (cellTemp - 25)) * (1 - sys.systemLosses);
    const ac = dc * sys.inverterEfficiency;
    acWatts[i] = Math.min(ac, sys.acLimitWatts);
    clippedWh += Math.max(0, ac - sys.acLimitWatts) * STEP_HOURS;
  }
  return { acWatts, clippedWh };
}

const sumWh = (acWatts: number[]) => acWatts.reduce((s, w) => s + w, 0) * STEP_HOURS;

export function simulateYear(climate: Climate, config: SystemConfig): ProductionResult {
  const sys: Required<SystemConfig> = {
    shading: 0, systemLosses: 0.14, inverterEfficiency: 0.96, albedo: 0.2, ...config,
  };
  const lat = climate.latitude * RAD;
  const months: MonthResult[] = [];
  let clippedKwh = 0;

  for (let m = 0; m < 12; m++) {
    const n = MEAN_DAY[m];
    const decl = 23.45 * RAD * Math.sin((2 * Math.PI * (284 + n)) / 365);
    const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(lat) * Math.tan(decl))));
    const h0 = ws > 0.01 ? extraterrestrial(lat, decl, n, ws) : 0;
    const kt = h0 > 0 ? climate.ghi[m] / h0 : 0;

    // Mix of clear and overcast days that preserves the monthly mean.
    const dayTypes: Array<{ weight: number; ghi: number }> =
      kt >= CLEAR_KT || kt <= OVERCAST_KT || h0 === 0
        ? [{ weight: 1, ghi: climate.ghi[m] }]
        : (() => {
            const clear = (kt - OVERCAST_KT) / (CLEAR_KT - OVERCAST_KT);
            return [
              { weight: clear, ghi: CLEAR_KT * h0 },
              { weight: 1 - clear, ghi: OVERCAST_KT * h0 },
            ];
          })();

    const profiles: DayProfile[] = [];
    let kwh = 0;
    for (const day of dayTypes) {
      const { acWatts, clippedWh } = simulateDay(day.ghi, climate, m, sys);
      profiles.push({ weight: day.weight, acWatts });
      kwh += (day.weight * DAYS_IN_MONTH[m] * sumWh(acWatts)) / 1000;
      clippedKwh += (day.weight * DAYS_IN_MONTH[m] * clippedWh) / 1000;
    }
    months.push({ kwh, profiles });
  }

  const monthlyKwh = months.map((x) => x.kwh);
  return { annualKwh: monthlyKwh.reduce((a, b) => a + b, 0), monthlyKwh, months, clippedKwh };
}

export interface SavingsInput {
  /** What you pay per kWh, in cents. */
  rateCents: number;
  /** Power your home draws all day regardless (fridge, router, standby), watts. */
  baseloadWatts: number;
  /** Cents per kWh credited for power pushed to the grid. Usually 0 for plug-in solar. */
  exportCreditCents?: number;
  kitCost?: number;
}

export interface SavingsResult {
  selfUsedKwh: number;
  exportedKwh: number;
  selfUseShare: number;
  annualSavings: number;
  monthlySavings: number[];
  paybackYears: number | null;
  /** Total saved over the period minus kit cost, with 0.5%/yr panel degradation. */
  tenYearNet: number | null;
}

/**
 * Plug-in solar is not net-metered in any state that has legalised it so far:
 * power you do not use the instant it is made flows to the grid for free. So
 * the money saved depends on how much of the output your home soaks up.
 */
export function estimateSavings(production: ProductionResult, input: SavingsInput): SavingsResult {
  const exportCredit = input.exportCreditCents ?? 0;
  let selfUsedKwh = 0;
  const monthlySavings: number[] = [];
  production.months.forEach((month, m) => {
    let used = 0;
    for (const p of month.profiles) {
      const dayWh = p.acWatts.reduce((s, w) => s + Math.min(w, input.baseloadWatts), 0) * STEP_HOURS;
      used += (p.weight * DAYS_IN_MONTH[m] * dayWh) / 1000;
    }
    selfUsedKwh += used;
    monthlySavings.push((used * input.rateCents + (month.kwh - used) * exportCredit) / 100);
  });
  const exportedKwh = production.annualKwh - selfUsedKwh;
  const annualSavings = monthlySavings.reduce((a, b) => a + b, 0);
  const cost = input.kitCost;
  let tenYearNet: number | null = null;
  if (cost != null) {
    let total = 0;
    for (let y = 0; y < 10; y++) total += annualSavings * (1 - 0.005) ** y;
    tenYearNet = total - cost;
  }
  return {
    selfUsedKwh,
    exportedKwh,
    selfUseShare: production.annualKwh > 0 ? selfUsedKwh / production.annualKwh : 0,
    annualSavings,
    monthlySavings,
    paybackYears: cost != null && annualSavings > 0 ? cost / annualSavings : null,
    tenYearNet,
  };
}

export type SolarGrid = Record<string, [number[], number[]]>;

/**
 * Inverse-distance blend of the 1-degree climatology cells around a point.
 * Returns null if we have no data nearby (e.g. a remote island).
 */
export function climateAt(grid: SolarGrid, latitude: number, longitude: number): Climate | null {
  const ghi = new Array<number>(12).fill(0);
  const tempC = new Array<number>(12).fill(0);
  let total = 0;
  const baseLat = Math.floor(latitude - 0.5) + 0.5;
  const baseLon = Math.floor(longitude - 0.5) + 0.5;
  for (const lat of [baseLat, baseLat + 1]) {
    for (const lon of [baseLon, baseLon + 1]) {
      const cell = grid[`${lat},${lon}`];
      if (!cell) continue;
      const weight = Math.max(0, 1 - Math.abs(latitude - lat)) * Math.max(0, 1 - Math.abs(longitude - lon));
      if (weight <= 0) continue;
      total += weight;
      for (let m = 0; m < 12; m++) {
        ghi[m] += (weight * cell[0][m]) / 100;
        tempC[m] += (weight * cell[1][m]) / 10;
      }
    }
  }
  if (total === 0) return null;
  return { latitude, ghi: ghi.map((v) => v / total), tempC: tempC.map((v) => v / total) };
}
