import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { circuitLoad, daysBetween, effectiveStatus, formatDate, verdictFor } from '../src/lib/law.ts';
import { buildLetter } from '../src/lib/letter.ts';
import { isZip, parseShard, pickRate } from '../src/lib/zip.ts';

const dir = new URL('../data/states/', import.meta.url);
const states = Object.fromEntries(readdirSync(dir).map((f) => {
  const s = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
  return [s.code, s];
}));

test('dates format without timezone drift', () => {
  assert.equal(formatDate('2027-01-01'), 'January 1, 2027');
  assert.equal(formatDate(null), '');
  assert.equal(daysBetween('2026-11-16', '2027-01-01'), 46);
  assert.equal(daysBetween('2027-01-01', '2027-01-01'), 0);
});

test('a signed law flips to legal on its effective date, not before', () => {
  const ca = states.CA;
  assert.equal(effectiveStatus(ca, '2026-12-31'), 'legal_soon');
  assert.equal(effectiveStatus(ca, '2027-01-01'), 'legal');

  const before = verdictFor(ca, '2026-12-31');
  assert.equal(before.tone, 'soon');
  assert.equal(before.daysUntil, 1);
  assert.match(before.detail, /another 1 day\b/);
  assert.match(before.headline, /January 1, 2027/);

  const after = verdictFor(ca, '2027-01-01');
  assert.equal(after.tone, 'yes');
  assert.match(after.detail, /1,200 watts/);
});

test('every state produces a verdict that never overstates legality', () => {
  for (const s of Object.values(states)) {
    const v = verdictFor(s, '2026-11-16');
    assert.ok(v.headline.includes(s.name), s.code);
    const enactedNow = s.status === 'legal';
    assert.equal(v.tone === 'yes', enactedNow, `${s.code} tone ${v.tone}`);
    if (!enactedNow) assert.doesNotMatch(v.headline, /^Yes/, s.code);
  }
  assert.equal(verdictFor(states.NY, '2026-11-16').tone, 'wait');
  assert.equal(verdictFor(states.TX, '2026-11-16').tone, 'no');
});

test('circuit loading follows the 80% continuous rule', () => {
  assert.equal(circuitLoad(1200).amps, 10);
  assert.ok(circuitLoad(1200).fits15A);
  assert.ok(!circuitLoad(1920).fits15A && circuitLoad(1920).fits20A);
});

const letter = (overrides) => buildLetter({
  recipientType: 'landlord', senderName: 'Sam Rivera', senderAddress: '12 Elm St, Apt 4', recipientName: 'Oak Property Management',
  device: 'Two 400 W panels with a plug-in microinverter', watts: 800, location: 'Inside the balcony railing, clamped and cabled',
  certification: 'UL 3700', date: '2027-03-10', state: null, ...overrides,
});

test('letter: a notice where the law protects renters, a request where it does not', () => {
  const nj = letter({ state: states.NJ });
  assert.equal(nj.kind, 'notice');
  assert.match(nj.body, /Garden State Balcony Solar Act/);
  assert.match(nj.body, /at least 7 days/);
  assert.match(nj.body, /Received by:/);

  const ut = letter({ state: states.UT });
  assert.equal(ut.kind, 'request');
  assert.match(ut.body, /HB 340/);
  assert.match(ut.body, /Approved by:/);
  assert.doesNotMatch(ut.body, /written notice under that law/);
});

test('letter: HOA protection is judged separately from renter protection', () => {
  assert.equal(letter({ state: states.CO, recipientType: 'hoa' }).kind, 'notice');
  assert.equal(letter({ state: states.CO, recipientType: 'landlord' }).kind, 'request');
});

test('letter: no law means a request that promises utility approval', () => {
  const tx = letter({ state: states.TX });
  assert.equal(tx.kind, 'request');
  assert.match(tx.body, /does not yet have a plug-in solar law/);
  assert.match(tx.body, /approval my electric utility requires/);
});

test('letter: before the effective date it says when the law starts', () => {
  const early = letter({ state: states.NJ, date: '2026-12-01' });
  assert.match(early.body, /takes effect March 1, 2027/);
  assert.doesNotMatch(letter({ state: states.NJ }).body, /takes effect/);
});

test('letter: blanks become visible placeholders, never "undefined"', () => {
  const empty = letter({ senderName: '', senderAddress: '', recipientName: '', device: '', location: '', certification: '' });
  assert.match(empty.body, /\[Your name\]/);
  assert.match(empty.body, /\[make and model\]/);
  assert.doesNotMatch(empty.body, /undefined|null|NaN/);
  assert.match(empty.body, /6\.7 amps/);
});

test('zip: parsing, ordering and rate fallback', () => {
  assert.ok(isZip('84101') && !isZip('8410') && !isZip('84101-1234') && !isZip('abcde'));
  const shard = {
    u: [['Wires Co', 'Investor Owned', 6.1, 1], ['Full Power', 'Municipal', 14.2, 0], ['Mystery Coop', 'Cooperative', null, 0]],
    z: { '12345': [40.1, -75.2, 'PA', [0, 2, 1]], '12346': [40.2, -75.3, 'PA', [0]], '12347': [40.2, -75.3, 'PA', [], 1] },
  };
  const info = parseShard(shard, '12345');
  assert.deepEqual(info.utilities.map((u) => u.name), ['Full Power', 'Mystery Coop', 'Wires Co']);
  assert.deepEqual(pickRate(info, { PA: 17.5 }), { cents: 14.2, source: 'utility', utility: info.utilities[0] });

  const deliveryOnly = parseShard(shard, '12346');
  assert.deepEqual(pickRate(deliveryOnly, { PA: 17.5 }), { cents: 17.5, source: 'state' });
  assert.equal(pickRate(deliveryOnly, {}).source, 'national');

  assert.equal(parseShard(shard, '12347').approximate, true);
  assert.equal(parseShard(shard, '99999'), null);
});

test('shipped ZIP shards resolve well-known ZIP codes to the right state', () => {
  const load = (zip) => parseShard(JSON.parse(readFileSync(new URL(`../public/zip/${zip.slice(0, 3)}.json`, import.meta.url), 'utf8')), zip);
  const expected = { '84101': 'UT', '80202': 'CO', '10001': 'NY', '94110': 'CA', '04101': 'ME', '99501': 'AK', '96813': 'HI', '20001': 'DC', '05401': 'VT', '07030': 'NJ' };
  for (const [zip, state] of Object.entries(expected)) {
    const info = load(zip);
    assert.ok(info, `missing ${zip}`);
    assert.equal(info.state, state, zip);
    assert.ok(info.latitude > 17 && info.latitude < 72 && info.longitude < -64, zip);
  }
});
