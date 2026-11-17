#!/usr/bin/env node
// Rebuilds the three generated datasets the site ships with. Zero dependencies.
//
//   public/zip/<first 3 digits>.json   ZIP -> centroid, state, utilities + residential rates
//   public/solar-grid.json             1-degree monthly sunshine + temperature climatology
//   src/data/state-rates.json          fallback average residential rate per state
//
// Sources (all public domain / open):
//   - US Census Bureau 2024 ZCTA Gazetteer (ZIP centroids)
//   - NREL / OpenEI "U.S. Electric Utility Companies and Rates: Look-up by Zipcode (2023)"
//   - NASA POWER climatology API (CERES SYN1deg all-sky surface irradiance, MERRA-2 T2M)
//
// Usage: node scripts/fetch-data.mjs     (downloads are cached in .cache/)
// The output is committed to the repo, so normal builds never hit the network.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, '.cache');
mkdirSync(cache, { recursive: true });

const SOURCES = {
  zcta: 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_zcta_national.zip',
  iou: 'https://data.openei.org/files/6225/iou_zipcodes_2023.csv',
  noniou: 'https://data.openei.org/files/6225/non_iou_zipcodes_2023.csv',
};
const RATE_YEAR = 2023;

async function download(url, file) {
  const path = join(cache, file);
  if (existsSync(path)) return path;
  process.stdout.write(`  fetching ${url}\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  return path;
}

// Minimal RFC 4180 parser (utility names contain commas and quotes).
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const mode = (items) => {
  const counts = new Map();
  for (const x of items) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
};

// ---------------------------------------------------------------- ZIP centroids
async function loadCentroids() {
  const zip = await download(SOURCES.zcta, 'zcta.zip');
  const txt = join(cache, '2024_Gaz_zcta_national.txt');
  if (!existsSync(txt)) {
    // tar on Windows 10+/macOS/Linux (bsdtar) reads zip archives; fall back to unzip.
    try { execFileSync('tar', ['-xf', zip, '-C', cache]); }
    catch { execFileSync('unzip', ['-o', '-q', zip, '-d', cache]); }
  }
  const out = new Map();
  for (const line of readFileSync(txt, 'utf8').split('\n').slice(1)) {
    const cols = line.split('\t').map((s) => s.trim());
    if (cols.length < 7) continue;
    out.set(cols[0], [Number(cols[5]), Number(cols[6])]);
  }
  return out;
}

// ---------------------------------------------------------------- utilities
async function loadUtilities() {
  const rows = [];
  for (const key of ['iou', 'noniou']) {
    rows.push(...parseCsv(readFileSync(await download(SOURCES[key], `${key}.csv`), 'utf8')));
  }
  const byZip = new Map();
  for (const r of rows) {
    const zip = r.zip.padStart(5, '0');
    const rate = Number(r.res_rate);
    const entry = {
      name: r.utility_name.trim(),
      state: r.state,
      ownership: r.ownership,
      // "Delivery" rows are wires-only charges in deregulated markets: not a full price.
      deliveryOnly: r.service_type === 'Delivery',
      cents: rate > 0 ? Math.round(rate * 1000) / 10 : null,
    };
    if (!byZip.has(zip)) byZip.set(zip, []);
    const list = byZip.get(zip);
    const dupe = list.find((u) => u.name === entry.name && u.deliveryOnly === entry.deliveryOnly);
    if (!dupe) list.push(entry);
  }
  return byZip;
}

// ---------------------------------------------------------------- solar grid
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

async function loadSolarTile(param, latMin, latMax, lonMin, lonMax) {
  const file = `power_${param}_${latMin}_${latMax}_${lonMin}_${lonMax}.json`;
  const url = 'https://power.larc.nasa.gov/api/temporal/climatology/regional'
    + `?parameters=${param}&community=RE&format=JSON`
    + `&latitude-min=${latMin}&latitude-max=${latMax}&longitude-min=${lonMin}&longitude-max=${lonMax}`;
  for (let attempt = 1; ; attempt++) {
    try {
      return JSON.parse(readFileSync(await download(url, file), 'utf8')).features;
    } catch (err) {
      rmSync(join(cache, file), { force: true });
      if (attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

async function loadSolarGrid(centroids) {
  // Only request 1-degree cells that have a ZIP in or next to them.
  const wanted = new Set();
  for (const [lat, lon] of centroids.values()) {
    for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) {
      wanted.add(`${Math.floor(lat) + dy},${Math.floor(lon) + dx}`);
    }
  }
  const tiles = new Map(); // 10-degree tiles (API maximum) keyed by their SW corner
  for (const key of wanted) {
    const [la, lo] = key.split(',').map(Number);
    tiles.set(`${Math.floor(la / 10) * 10},${Math.floor(lo / 10) * 10}`, true);
  }
  const cells = {};
  for (const key of tiles.keys()) {
    const [la, lo] = key.split(',').map(Number);
    if (la < -60 || la >= 80 || lo < -180 || lo >= 180) continue;
    // The API accepts one parameter per regional request.
    const sun = await loadSolarTile('ALLSKY_SFC_SW_DWN', la, la + 10, lo, lo + 10);
    // Temperature comes on a finer grid (MERRA-2), so take the nearest point.
    const temp = (await loadSolarTile('T2M', la, la + 10, lo, lo + 10))
      .map((f) => ({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], t: f.properties.parameter.T2M }));
    for (const f of sun) {
      const [lon, lat] = f.geometry.coordinates;
      if (!wanted.has(`${Math.floor(lat)},${Math.floor(lon)}`)) continue;
      let tm = null, best = Infinity;
      for (const p of temp) {
        const d = (p.lat - lat) ** 2 + (p.lon - lon) ** 2;
        if (d < best) { best = d; tm = p.t; }
      }
      if (!tm) continue;
      const ghi = MONTHS.map((m) => f.properties.parameter.ALLSKY_SFC_SW_DWN[m]);
      const t = MONTHS.map((m) => tm[m]);
      if (ghi.some((v) => v == null || v < 0) || t.some((v) => v == null || v < -90)) continue;
      // [12 x kWh/m2/day * 100, 12 x deg C * 10] keyed by cell centre
      cells[`${lat},${lon}`] = [ghi.map((v) => Math.round(v * 100)), t.map((v) => Math.round(v * 10))];
    }
  }
  return cells;
}

// ---------------------------------------------------------------- assemble
console.log('1/3 ZIP centroids + utilities');
const centroids = await loadCentroids();
const utilities = await loadUtilities();

const allZips = new Set([...centroids.keys(), ...utilities.keys()]);
const zipState = new Map();
for (const zip of allZips) {
  const state = mode((utilities.get(zip) ?? []).map((u) => u.state));
  if (state) zipState.set(zip, state);
}
// ZIPs with no utility row inherit the most common state of their 3-digit prefix.
const prefixState = new Map();
for (const p3 of new Set([...allZips].map((z) => z.slice(0, 3)))) {
  const s = mode([...zipState].filter(([z]) => z.startsWith(p3)).map(([, st]) => st));
  if (s) prefixState.set(p3, s);
}

const shards = new Map();
for (const zip of [...allZips].sort()) {
  const p3 = zip.slice(0, 3);
  const state = zipState.get(zip) ?? prefixState.get(p3);
  if (!state) continue;
  if (!shards.has(p3)) shards.set(p3, { u: [], z: {}, index: new Map() });
  const shard = shards.get(p3);
  const ids = (utilities.get(zip) ?? []).map((u) => {
    const key = `${u.name}|${u.deliveryOnly}`;
    if (!shard.index.has(key)) {
      shard.index.set(key, shard.u.length);
      shard.u.push([u.name, u.ownership, u.cents, u.deliveryOnly ? 1 : 0]);
    }
    return shard.index.get(key);
  });
  const c = centroids.get(zip);
  shard.z[zip] = [c ? Math.round(c[0] * 1000) / 1000 : null, c ? Math.round(c[1] * 1000) / 1000 : null, state, ids];
}

const zipDir = join(root, 'public', 'zip');
rmSync(zipDir, { recursive: true, force: true });
mkdirSync(zipDir, { recursive: true });
let zipCount = 0;
for (const [p3, shard] of shards) {
  // PO-box-only ZIPs have no Census centroid: borrow the average of their neighbours.
  const known = Object.values(shard.z).filter((v) => v[0] != null);
  const avg = (i) => Math.round((known.reduce((s, v) => s + v[i], 0) / known.length) * 1000) / 1000;
  for (const v of Object.values(shard.z)) {
    if (v[0] == null) { if (!known.length) continue; v[0] = avg(0); v[1] = avg(1); v.push(1); }
  }
  for (const [zip, v] of Object.entries(shard.z)) if (v[0] == null) delete shard.z[zip];
  zipCount += Object.keys(shard.z).length;
  writeFileSync(join(zipDir, `${p3}.json`), JSON.stringify({ u: shard.u, z: shard.z }));
}
console.log(`  ${zipCount} ZIP codes in ${shards.size} shards`);

console.log('2/3 state average rates');
const stateRates = {};
const perState = new Map();
for (const [zip, list] of utilities) {
  for (const u of list) {
    if (u.deliveryOnly || u.cents == null || u.state !== zipState.get(zip)) continue;
    if (!perState.has(u.state)) perState.set(u.state, []);
    perState.get(u.state).push(u.cents);
  }
}
for (const [state, cents] of [...perState].sort()) {
  stateRates[state] = Math.round((cents.reduce((a, b) => a + b, 0) / cents.length) * 10) / 10;
}
mkdirSync(join(root, 'src', 'data'), { recursive: true });
writeFileSync(join(root, 'src', 'data', 'state-rates.json'),
  JSON.stringify({ year: RATE_YEAR, unit: 'cents/kWh', source: SOURCES.iou, rates: stateRates }, null, 1));

console.log('3/3 solar climatology grid (NASA POWER)');
const cells = await loadSolarGrid(new Map([...centroids].filter(([z]) => zipState.has(z) || prefixState.has(z.slice(0, 3)))));
writeFileSync(join(root, 'public', 'solar-grid.json'), JSON.stringify({
  source: 'NASA POWER climatology (CERES SYN1deg ALLSKY_SFC_SW_DWN, MERRA-2 T2M)',
  format: 'cells["lat,lon"] = [12 x GHI kWh/m2/day x100, 12 x mean temp C x10], 1-degree cell centres',
  cells,
}));
console.log(`  ${Object.keys(cells).length} grid cells`);
console.log('done');
