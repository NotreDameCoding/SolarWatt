#!/usr/bin/env node
// Checks every record in /data before a build or merge. Zero dependencies.
// A bad record fails the build: wrong legal data should never ship quietly.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const fail = (where, message) => errors.push(`${where}: ${message}`);

const STATUSES = ['legal', 'legal_soon', 'awaiting_signature', 'in_progress', 'stalled', 'none'];
const VERIFICATION = ['primary', 'mixed', 'secondary'];
const CODES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const isUrl = (v) => { try { return new URL(v).protocol === 'https:'; } catch { return false; } };
const isText = (v) => typeof v === 'string' && v.trim().length > 0;
const today = new Date().toISOString().slice(0, 10);

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (err) { fail(path, `not valid JSON (${err.message})`); return null; }
}

// ---- states
const dir = join(root, 'data', 'states');
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const seen = new Set();
const slugs = new Set();
for (const file of files) {
  const s = readJson(join(dir, file));
  if (!s) continue;
  const at = `data/states/${file}`;
  if (!CODES.includes(s.code)) fail(at, `unknown state code "${s.code}"`);
  if (file !== `${s.code}.json`) fail(at, `file name must match code (${s.code}.json)`);
  if (seen.has(s.code)) fail(at, 'duplicate state code');
  seen.add(s.code);
  if (!isText(s.name)) fail(at, 'name is required');
  if (!/^[a-z-]+$/.test(s.slug ?? '') || slugs.has(s.slug)) fail(at, 'slug must be unique lowercase-with-dashes');
  slugs.add(s.slug);
  if (!STATUSES.includes(s.status)) fail(at, `status must be one of ${STATUSES.join(', ')}`);
  if (!VERIFICATION.includes(s.verification)) fail(at, `verification must be one of ${VERIFICATION.join(', ')}`);
  if (!isText(s.summary)) fail(at, 'summary is required');
  if (!isDate(s.last_verified)) fail(at, 'last_verified must be a YYYY-MM-DD date');
  else if (s.last_verified > today) fail(at, 'last_verified is in the future');

  for (const key of ['signed_date', 'effective_date']) {
    if (s[key] != null && !isDate(s[key])) fail(at, `${key} must be a YYYY-MM-DD date or null`);
  }
  if (s.signed_date && s.effective_date && s.effective_date < s.signed_date) fail(at, 'effective_date is before signed_date');

  const enacted = s.status === 'legal' || s.status === 'legal_soon';
  if (enacted) {
    if (!s.bill || !isText(s.bill.number)) fail(at, 'an enacted law needs bill.number');
    if (!isDate(s.effective_date)) fail(at, 'an enacted law needs effective_date');
    if (!Number.isInteger(s.watt_cap) || s.watt_cap < 100 || s.watt_cap > 5000) fail(at, 'an enacted law needs a plausible watt_cap');
    if (!s.utility || typeof s.utility.approval_required !== 'boolean') fail(at, 'an enacted law needs utility.approval_required');
    for (const key of ['notification', 'fees', 'net_metering']) if (!isText(s.utility?.[key])) fail(at, `an enacted law needs utility.${key}`);
    if (!isText(s.renters) || !isText(s.hoa)) fail(at, 'an enacted law needs renters and hoa text (say "Not addressed" if so)');
    if (s.status === 'legal' && s.effective_date > today) fail(at, 'status is "legal" but effective_date is in the future: use "legal_soon"');
    if (!s.sources?.some((x) => x.kind === 'primary') && s.verification !== 'secondary') {
      fail(at, 'verification above "secondary" needs at least one primary source');
    }
  } else {
    if (s.effective_date) fail(at, 'only enacted laws have an effective_date');
    if (s.renter_protection || s.hoa_protection) fail(at, 'protections can only be true for an enacted law');
  }
  if (s.bill?.url != null && !isUrl(s.bill.url)) fail(at, 'bill.url must be an https URL or null');
  if (!Array.isArray(s.tiers)) fail(at, 'tiers must be a list');
  else {
    let last = 0;
    for (const t of s.tiers) {
      if (!Number.isInteger(t.max_watts) || !isText(t.rule)) fail(at, 'each tier needs max_watts and rule');
      if (t.max_watts <= last) fail(at, 'tiers must be in increasing order');
      if (s.watt_cap && t.max_watts > s.watt_cap) fail(at, 'a tier exceeds watt_cap');
      last = t.max_watts;
    }
  }
  if (s.renter_notice_days != null && (!Number.isInteger(s.renter_notice_days) || s.renter_notice_days < 0)) fail(at, 'renter_notice_days must be a whole number');
  for (const key of ['notes', 'open_questions']) {
    if (!Array.isArray(s[key]) || s[key].some((x) => !isText(x))) fail(at, `${key} must be a list of sentences`);
  }
  if (!Array.isArray(s.sources) || s.sources.length === 0) fail(at, 'at least one source is required');
  for (const src of s.sources ?? []) {
    if (!isText(src.title) || !isUrl(src.url)) fail(at, 'each source needs a title and an https url');
    if (!['primary', 'secondary'].includes(src.kind)) fail(at, 'source.kind must be "primary" or "secondary"');
  }
}
for (const code of CODES) if (!seen.has(code)) fail('data/states', `missing ${code}.json`);

// ---- products
const products = readJson(join(root, 'data', 'products.json'));
if (products) {
  if (!isDate(products.last_checked)) fail('data/products.json', 'last_checked must be a date');
  const ids = new Set();
  for (const p of products.products ?? []) {
    const at = `data/products.json (${p.id})`;
    if (!isText(p.id) || ids.has(p.id)) fail(at, 'id must be unique');
    ids.add(p.id);
    for (const key of ['maker', 'model', 'kind', 'claim']) if (!isText(p[key])) fail(at, `${key} is required`);
    if (!['component', 'system'].includes(p.scope)) fail(at, 'scope must be "component" or "system"');
    if (!['claimed', 'verified'].includes(p.status)) fail(at, 'status must be "claimed" or "verified"');
    if (p.status === 'verified' && !isUrl(p.certificate_url)) fail(at, 'a verified product must link its certificate');
    for (const key of ['certificate_url', 'affiliate_url']) if (p[key] != null && !isUrl(p[key])) fail(at, `${key} must be an https URL or null`);
    if (!p.sources?.length || p.sources.some((s) => !isText(s.title) || !isUrl(s.url))) fail(at, 'needs at least one source with title and url');
  }
}

// ---- changelog
const changelog = readJson(join(root, 'data', 'changelog.json'));
if (changelog) {
  changelog.forEach((e, i) => {
    const at = `data/changelog.json [${i}]`;
    if (!isDate(e.date)) fail(at, 'date must be YYYY-MM-DD');
    if (!seen.has(e.state)) fail(at, `unknown state "${e.state}"`);
    if (!['signed', 'effective', 'passed', 'vetoed', 'deadline', 'changed'].includes(e.type)) fail(at, `unknown type "${e.type}"`);
    if (!isText(e.title)) fail(at, 'title is required');
  });
}

if (errors.length) {
  console.error(`Data validation failed (${errors.length}):\n` + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}
console.log(`Data OK: ${files.length} states, ${products.products.length} products, ${changelog.length} changelog entries.`);
