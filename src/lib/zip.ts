// ZIP code lookup against the static shards in public/zip/. No server, no API key.

export interface Utility {
  name: string;
  ownership: string;
  /** Average residential price in cents/kWh, or null if unknown. */
  cents: number | null;
  /** True when the figure covers delivery only (deregulated markets), so it understates the bill. */
  deliveryOnly: boolean;
}

export interface ZipInfo {
  zip: string;
  latitude: number;
  longitude: number;
  state: string;
  utilities: Utility[];
  /** True when the location is borrowed from neighbouring ZIPs (PO-box-only codes). */
  approximate: boolean;
}

type Shard = {
  u: Array<[string, string, number | null, 0 | 1]>;
  z: Record<string, [number, number, string, number[], 1?]>;
};

export const isZip = (value: string): boolean => /^\d{5}$/.test(value);

export function parseShard(shard: Shard, zip: string): ZipInfo | null {
  const row = shard.z[zip];
  if (!row) return null;
  const utilities = row[3]
    .map((i) => shard.u[i])
    .map(([name, ownership, cents, deliveryOnly]) => ({ name, ownership, cents, deliveryOnly: deliveryOnly === 1 }))
    // A utility listed with both a full price and a delivery-only price: keep the full one.
    .filter((u, _, all) => !u.deliveryOnly || !all.some((other) => other.name === u.name && !other.deliveryOnly))
    // Full-price utilities first, then the ones with a known rate.
    .sort((a, b) => Number(a.deliveryOnly) - Number(b.deliveryOnly) || Number(b.cents != null) - Number(a.cents != null));
  return { zip, latitude: row[0], longitude: row[1], state: row[2], utilities, approximate: row[4] === 1 };
}

const cache = new Map<string, Promise<Shard | null>>();

export async function lookupZip(zip: string, base = '/'): Promise<ZipInfo | null> {
  if (!isZip(zip)) return null;
  const prefix = zip.slice(0, 3);
  if (!cache.has(prefix)) {
    cache.set(prefix, fetch(`${base}zip/${prefix}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  }
  const shard = await cache.get(prefix)!;
  return shard ? parseShard(shard, zip) : null;
}

/**
 * The price to put in the calculator: the first utility with a full (bundled)
 * rate, otherwise the state average.
 */
export function pickRate(info: ZipInfo, stateAverages: Record<string, number>): { cents: number; source: 'utility' | 'state' | 'national'; utility?: Utility } {
  const utility = info.utilities.find((u) => !u.deliveryOnly && u.cents != null);
  if (utility) return { cents: utility.cents!, source: 'utility', utility };
  const state = stateAverages[info.state];
  if (state != null) return { cents: state, source: 'state' };
  return { cents: 16, source: 'national' };
}
