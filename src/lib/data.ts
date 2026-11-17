// Build-time access to the datasets in /data.
import type { StateRecord } from './law.ts';
import productsFile from '../../data/products.json';
import changelogFile from '../../data/changelog.json';
import rateFile from '../data/state-rates.json';

const modules = import.meta.glob<{ default: StateRecord }>('../../data/states/*.json', { eager: true });

export const states: StateRecord[] = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => a.name.localeCompare(b.name));

export const stateByCode = new Map(states.map((s) => [s.code, s]));

export const products = productsFile;
export interface ChangelogEntry { date: string; state: string; type: string; title: string }
export const changelog = (changelogFile as ChangelogEntry[]).slice().sort((a, b) => b.date.localeCompare(a.date));
export const stateRates = rateFile;

/** Build date, overridable so builds are reproducible in tests. */
export const BUILD_DATE = process.env.BUILD_DATE ?? new Date().toISOString().slice(0, 10);

export const lastVerified = states.map((s) => s.last_verified).sort().at(-1)!;
