#!/usr/bin/env node
// Runs after `astro build`. When the site is served from a sub-path (GitHub
// Pages project sites live at /<repo>/), prefix every root-relative link in the
// built HTML. With BASE_PATH unset this does nothing.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = (process.env.BASE_PATH ?? '').replace(/\/+$/, '');
if (!base) process.exit(0);
if (!/^\/[\w.-]+(\/[\w.-]+)*$/.test(base)) throw new Error(`BASE_PATH must look like /repo-name, got "${base}"`);

let count = 0;
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.name.endsWith('.html')) {
      const html = readFileSync(path, 'utf8');
      const out = html.replace(/\b(href|src|action)="\/(?!\/)/g, `$1="${base}/`);
      if (out !== html) { writeFileSync(path, out); count++; }
    }
  }
};
walk(fileURLToPath(new URL('../dist', import.meta.url)));
console.log(`Applied base path ${base} to ${count} pages.`);
