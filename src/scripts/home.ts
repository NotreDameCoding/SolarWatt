// Home page: ZIP lookup, verdict, and the savings calculator. Everything runs
// in the browser against static JSON; nothing the visitor types is sent anywhere.

import { isZip, lookupZip, pickRate, type ZipInfo } from '../lib/zip.ts';
import { basePath } from '../lib/base.ts';
import {
  circuitLoad, effectiveStatus, formatDate, todayIso, verdictFor, VERIFICATION_LABEL, type StateRecord,
} from '../lib/law.ts';
import { climateAt, estimateSavings, simulateYear, type Climate, type SolarGrid } from '../lib/solar.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, attrs: Record<string, string> = {}) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};
const fmt = (n: number, digits = 0) => n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });

const stateRates: Record<string, number> = JSON.parse($('state-rates').textContent!);
const rateYear: number = JSON.parse($('rate-year').textContent!);
const BASE = basePath();
const KIT_PRICE: Record<string, number> = { 400: 450, 800: 800, 1200: 1200, 1920: 1900 };

let statesPromise: Promise<StateRecord[]> | null = null;
let gridPromise: Promise<SolarGrid> | null = null;
const loadStates = () => (statesPromise ??= fetch(`${BASE}data/states.json`).then((r) => r.json()).then((d) => d.states));
const loadGrid = () => (gridPromise ??= fetch(`${BASE}solar-grid.json`).then((r) => r.json()).then((d) => d.cells));

let current: { info: ZipInfo; state: StateRecord; climate: Climate | null } | null = null;
let costEdited = false;

const form = $<HTMLFormElement>('zip-form');
const zipInput = $<HTMLInputElement>('zip');
const errorBox = $('zip-error');
const calcForm = $<HTMLFormElement>('calc-form');

function showError(message: string) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  zipInput.setAttribute('aria-invalid', 'true');
}

async function run(zip: string, scroll: boolean) {
  errorBox.hidden = true;
  zipInput.removeAttribute('aria-invalid');
  if (!isZip(zip)) return showError('Enter a 5-digit US ZIP code.');

  const [info, states, grid] = await Promise.all([lookupZip(zip, BASE), loadStates(), loadGrid()]).catch(() => [null, null, null] as const);
  if (!states || !grid) return showError('Could not load the data. Check your connection and try again.');
  if (!info) return showError(`We do not have ZIP code ${zip}. Check the number, or pick your state from the map below.`);
  const state = states.find((s) => s.code === info.state);
  if (!state) return showError(`ZIP code ${zip} is in ${info.state}, which this guide does not cover yet.`);

  current = { info, state, climate: climateAt(grid, info.latitude, info.longitude) };
  renderVerdict();
  setupCalculator();
  renderSteps();
  $('result').hidden = false;
  history.replaceState(null, '', `?zip=${zip}`);
  if (scroll) $('result').scrollIntoView({ block: 'start' });
}

function renderVerdict() {
  const { info, state } = current!;
  const today = todayIso();
  const v = verdictFor(state, today);
  const box = $('verdict');
  box.className = `verdict tone-${v.tone}`;
  $('v-where').textContent = `ZIP ${info.zip} · ${state.name}`;
  $('v-headline').textContent = v.headline;
  $('v-detail').textContent = v.detail;
  $('v-summary').textContent = v.tone === 'yes' || v.tone === 'soon' ? '' : state.summary;
  $('v-summary').hidden = !$('v-summary').textContent;
  const ver = VERIFICATION_LABEL[state.verification];
  $('v-verification').textContent = ver.label;
  $('v-verification').title = ver.explain;
  $('v-checked').textContent = `Last checked ${formatDate(state.last_verified)}`;
  $<HTMLAnchorElement>('v-link').href = `${BASE}${state.slug}/`;

  const facts = $('facts');
  facts.replaceChildren();
  const add = (term: string, value: string | null | undefined, big = false) => {
    if (!value) return;
    const row = el('div');
    row.append(el('dt', term));
    const dd = el('dd', value);
    if (big) dd.className = 'big';
    row.append(dd);
    facts.append(row);
  };
  const hasLaw = v.tone === 'yes' || v.tone === 'soon';
  if (hasLaw) {
    add('Most you can plug in', state.watt_cap ? `${fmt(state.watt_cap)} watts` : null, true);
    add(v.tone === 'soon' ? 'Starts' : 'In effect since', formatDate(state.effective_date), true);
    add('The law', [state.bill?.number, state.bill?.name].filter(Boolean).join(' · '));
    add('Utility approval', state.utility ? (state.utility.approval_required ? 'Required' : 'Not required') : null);
    add('Telling your utility', state.utility?.notification);
    add('Certification', state.certification);
    add('If you rent', state.renters);
    add('HOAs and condos', state.hoa);
    for (const tier of state.tiers) add(`Up to ${fmt(tier.max_watts)} W`, tier.rule);
  } else {
    add('The bill', state.bill ? [state.bill.number, state.bill.name].filter(Boolean).join(' · ') : 'None introduced in 2026');
    add('What it would do', state.proposed);
    add('Today', 'Ask your utility whether it will approve a small plug-in system under its interconnection rules.');
  }
  facts.hidden = facts.childElementCount === 0;
}

function setupCalculator() {
  const { info, state } = current!;
  const cap = effectiveStatus(state, todayIso()) === 'legal' || state.status === 'legal_soon' ? state.watt_cap ?? 1200 : 1200;
  for (const label of document.querySelectorAll<HTMLLabelElement>('#size-options label')) {
    const min = Number(label.dataset.minCap ?? 0);
    label.hidden = min > cap;
    const input = label.querySelector('input')!;
    if (label.hidden && input.checked) calcForm.querySelector<HTMLInputElement>('input[value="800"]')!.checked = true;
  }

  const select = $<HTMLSelectElement>('utility');
  select.replaceChildren();
  info.utilities.forEach((u, i) => {
    const price = u.cents != null ? `${fmt(u.cents, 1)}¢${u.deliveryOnly ? ' delivery only' : ''}` : 'rate unknown';
    select.append(el('option', `${u.name} (${price})`, { value: String(i) }));
  });
  $('utility-field').hidden = info.utilities.length < 2;

  const picked = pickRate(info, stateRates);
  if (picked.utility) select.value = String(info.utilities.indexOf(picked.utility));
  $<HTMLInputElement>('rate').value = picked.cents.toFixed(1);
  calcForm.dataset.rateSource = picked.source;
  costEdited = false;
  syncCost();

  $('calc-intro').textContent = current!.climate
    ? `Based on about 20 years of satellite sunshine data for ${info.zip} and what you tell us about your setup.`
    : 'We have no sunshine data for this location, so we cannot estimate production here.';
  recalc();
}

function syncCost() {
  if (costEdited) return;
  const watts = new FormData(calcForm).get('watts') as string;
  $<HTMLInputElement>('cost').value = String(KIT_PRICE[watts] ?? 800);
}

function recalc() {
  if (!current) return;
  const { info, state, climate } = current;
  const data = new FormData(calcForm);
  const watts = Number(data.get('watts'));
  const rate = Number(data.get('rate'));
  const cost = Number(data.get('cost'));
  const notes = $('calc-notes');
  notes.replaceChildren();
  if (!climate || !(rate > 0)) {
    for (const id of ['n-savings', 'n-payback', 'n-kwh', 'n-self']) $(id).textContent = '–';
    $('chart').replaceChildren();
    if (climate) notes.append(el('li', 'Enter your electricity rate in cents per kWh to see savings.'));
    return;
  }

  const production = simulateYear(climate, {
    dcWatts: watts, acLimitWatts: watts,
    tiltDeg: Number(data.get('tilt')), azimuthDeg: Number(data.get('facing')), shading: Number(data.get('shade')),
  });
  const savings = estimateSavings(production, { rateCents: rate, baseloadWatts: Number(data.get('baseload')), kitCost: cost });

  $('n-savings').textContent = `$${fmt(savings.annualSavings)}`;
  $('n-kwh').textContent = fmt(production.annualKwh);
  $('n-self').textContent = `${fmt(savings.selfUseShare * 100)}%`;
  $('n-payback').textContent = savings.paybackYears == null ? '–'
    : savings.paybackYears > 25 ? '25+ years' : `${fmt(savings.paybackYears, 1)} years`;

  drawChart(production.monthlyKwh, savings.monthlySavings.map((dollars) => (dollars * 100) / rate));

  const source = calcForm.dataset.rateSource;
  const utility = info.utilities[Number(data.get('utility') ?? 0)];
  notes.append(el('li',
    source === 'utility' && utility
      ? `Rate starts at ${utility.name}'s ${rateYear} average residential price. Rates have risen since, so use the per-kWh price on your own bill.`
      : source === 'state'
        ? `We could not find a full retail rate for your utility, so this starts at the ${state.name} average for ${rateYear}. Use the per-kWh price on your own bill.`
        : 'Using a rough national average rate. Use the per-kWh price on your own bill.'));
  if (savings.exportedKwh / production.annualKwh > 0.05) {
    notes.append(el('li', `About ${fmt(savings.exportedKwh)} kWh a year flows to the grid unpaid, because it is made when your home is not using it. A smaller kit, or running the dishwasher and laundry at midday, wastes less.`));
  }
  if (savings.tenYearNet != null) {
    notes.append(el('li', savings.tenYearNet >= 0
      ? `Over 10 years that is about $${fmt(savings.tenYearNet)} ahead after paying for the kit, at today's rate.`
      : `At today's rate the kit would not pay for itself within 10 years (about $${fmt(-savings.tenYearNet)} short). Rate increases would shorten that.`));
  }
  const load = circuitLoad(watts);
  notes.append(el('li', `In full sun, ${fmt(watts)} watts adds ${fmt(load.amps, 1)} amps to one circuit. `
    + (load.fits15A ? 'That is within the 12-amp continuous limit of a standard 15-amp circuit, but keep heaters and air conditioners off that circuit.'
      : 'That is more than a standard 15-amp circuit should carry continuously: it needs a 20-amp circuit, ideally a dedicated one.')));
  if (production.clippedKwh / production.annualKwh > 0.01) {
    notes.append(el('li', `About ${fmt(production.clippedKwh)} kWh a year is lost to the inverter's output limit.`));
  }
  if (info.approximate) notes.append(el('li', 'This ZIP has no mapped area (it may be PO boxes only), so we used the surrounding area for sunshine.'));
  notes.append(el('li', 'This is a screening estimate. Expect your real numbers to land within about 15% for an unshaded panel; shade is the biggest unknown.'));
}

function drawChart(totalKwh: number[], usedKwh: number[]) {
  const svg = $('chart') as unknown as SVGSVGElement;
  const NS = 'http://www.w3.org/2000/svg';
  const title = svg.querySelector('title')!;
  svg.replaceChildren(title);
  const W = 600, H = 220, left = 34, bottom = 22, top = 8;
  const max = Math.max(...totalKwh, 1);
  const step = [5, 10, 20, 25, 50, 100, 200].find((s) => max / s <= 5) ?? 500;
  const yMax = Math.ceil(max / step) * step;
  const y = (v: number) => top + (H - top - bottom) * (1 - v / yMax);
  const make = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    if (text != null) node.textContent = text;
    svg.append(node);
    return node;
  };
  for (let v = 0; v <= yMax; v += step) {
    make('line', { x1: left, x2: W, y1: y(v), y2: y(v), class: 'axis' });
    make('text', { x: left - 6, y: y(v) + 4, 'text-anchor': 'end' }, String(v));
  }
  const slot = (W - left) / 12;
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  totalKwh.forEach((total, m) => {
    const x = left + m * slot + slot * 0.16;
    const w = slot * 0.68;
    const used = Math.min(usedKwh[m], total);
    const tip = `${names[m]}: ${fmt(total)} kWh made, ${fmt(used)} used at home`;
    const exportedBar = make('rect', { x, y: y(total), width: w, height: Math.max(0, y(used) - y(total)), class: 'exported', rx: 2 });
    const usedBar = make('rect', { x, y: y(used), width: w, height: Math.max(0, y(0) - y(used)), class: 'used', rx: 2 });
    for (const bar of [exportedBar, usedBar]) bar.append(Object.assign(document.createElementNS(NS, 'title'), { textContent: tip }));
    make('text', { x: x + w / 2, y: H - 6, 'text-anchor': 'middle' }, names[m]);
  });
  title.textContent = `Monthly production in kWh. Best month ${fmt(Math.max(...totalKwh))}, worst ${fmt(Math.min(...totalKwh))}.`;
}

function renderSteps() {
  const { state } = current!;
  const v = verdictFor(state, todayIso());
  const list = $('steps');
  list.replaceChildren();
  const step = (text: string, link?: [string, string]) => {
    const li = el('li', text);
    if (link) { li.append(' '); li.append(el('a', link[1], { href: link[0] })); }
    list.append(li);
  };
  if (v.tone === 'yes' || v.tone === 'soon') {
    if (v.tone === 'soon') step(`Wait for ${formatDate(state.effective_date)}. You can buy a kit now, but plugging it in before then is not covered by the new law.`);
    step(`Choose a kit of ${fmt(state.watt_cap ?? 1200)} watts or less that carries the certification ${state.name} asks for.`, [`${BASE}products/`, 'See which products are certified.']);
    if (state.utility?.notification && !/^none/i.test(state.utility.notification)) step(`Tell your utility: ${state.utility.notification}`);
    step(state.renter_protection
      ? 'Renting? The law is on your side, but you still have to give written notice.'
      : 'Renting, or in an HOA or condo? Get permission in writing before you buy.', [`${BASE}letter/?state=${state.code}`, 'Write the letter.']);
    step('Mount it so it cannot fall, and plug it into an outlet on a circuit without heavy appliances.');
  } else {
    step('Call your utility and ask whether it approves small plug-in solar under its interconnection rules. A few do.');
    step('Want it anyway? A portable power station charged by a panel never touches your wiring, so no approval is needed.');
    step(v.tone === 'wait' ? 'Follow the bill. We record every vote and signature.' : 'Laws are moving fast: about 30 states saw bills in 2026.', [`${BASE}${state.slug}/`, `${state.name} details.`]);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  run(zipInput.value.trim(), true);
});
zipInput.addEventListener('input', () => { zipInput.value = zipInput.value.replace(/\D/g, '').slice(0, 5); });
calcForm.addEventListener('submit', (event) => event.preventDefault());
calcForm.addEventListener('input', (event) => {
  const target = event.target as HTMLInputElement;
  if (target.name === 'cost') costEdited = true;
  if (target.name === 'rate') calcForm.dataset.rateSource = 'custom';
  if (target.name === 'watts') syncCost();
  if (target.name === 'utility' && current) {
    const u = current.info.utilities[Number(target.value)];
    if (u?.cents != null && !u.deliveryOnly) {
      $<HTMLInputElement>('rate').value = u.cents.toFixed(1);
      calcForm.dataset.rateSource = 'utility';
    }
  }
  recalc();
});

const initial = new URLSearchParams(location.search).get('zip');
if (initial) { zipInput.value = initial; run(initial, false); }
