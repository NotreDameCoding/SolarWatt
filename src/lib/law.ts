// Turns a state record from data/states/*.json into a plain-language answer.
// Pure functions: used at build time, in the browser, and in tests.

export type Status = 'legal' | 'legal_soon' | 'awaiting_signature' | 'in_progress' | 'stalled' | 'none';

export interface Source { title: string; url: string; kind: 'primary' | 'secondary' }
export interface Tier { max_watts: number; rule: string }

export interface StateRecord {
  code: string;
  name: string;
  slug: string;
  status: Status;
  summary: string;
  bill: { number: string; name: string | null; citation?: string; url: string | null } | null;
  signed_date: string | null;
  effective_date: string | null;
  watt_cap: number | null;
  watt_cap_note: string | null;
  tiers: Tier[];
  certification: string | null;
  utility: { approval_required: boolean; notification: string; fees: string; net_metering: string } | null;
  renters: string | null;
  renter_protection: boolean;
  renter_notice_days: number | null;
  hoa: string | null;
  hoa_protection: boolean;
  proposed: string | null;
  notes: string[];
  open_questions: string[];
  sources: Source[];
  verification: 'primary' | 'mixed' | 'secondary';
  last_verified: string;
}

/** yes = plug in today, soon = signed with a future start date, wait = a bill exists, no = nothing. */
export type Tone = 'yes' | 'soon' | 'wait' | 'no';

export interface Verdict {
  tone: Tone;
  /** One word for badges and the map legend. */
  label: string;
  headline: string;
  detail: string;
  /** Whole days until the law starts; only for tone "soon". */
  daysUntil: number | null;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2027-01-01" -> "January 1, 2027". Works on the date string, so no timezone drift. */
export function formatDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export const todayIso = (now = new Date()): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

export function daysBetween(fromIso: string, toIso: string): number {
  const utc = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((utc(toIso) - utc(fromIso)) / 86_400_000);
}

/**
 * A signed law with a future start date becomes "legal" by itself once that
 * date arrives, so the site stays right on January 1 without a data edit.
 */
export function effectiveStatus(state: StateRecord, today: string): Status {
  if (state.status === 'legal_soon' && state.effective_date && state.effective_date <= today) return 'legal';
  return state.status;
}

const NO_LAW_DETAIL =
  'Without a plug-in solar law, anything that feeds power into your home\'s wiring falls under your utility\'s '
  + 'interconnection rules, which means applying for approval first. Some utilities will approve a small system; many have no process for one.';

export function verdictFor(state: StateRecord, today: string): Verdict {
  const status = effectiveStatus(state, today);
  const cap = state.watt_cap ? `up to ${state.watt_cap.toLocaleString('en-US')} watts` : null;
  // "in the District of Columbia", "The District of Columbia has no..."
  const place = state.code === 'DC' ? `the ${state.name}` : state.name;
  const Place = place[0].toUpperCase() + place.slice(1);
  switch (status) {
    case 'legal':
      return {
        tone: 'yes', label: 'Legal', daysUntil: null,
        headline: `Yes. Plug-in solar is legal in ${place}.`,
        detail: [cap ? `You can plug in ${cap}` : 'You can plug in a qualifying device',
          state.utility && !state.utility.approval_required ? ' without asking your utility for approval.' : '.'].join(''),
      };
    case 'legal_soon': {
      const days = daysBetween(today, state.effective_date!);
      return {
        tone: 'soon', label: 'Starts soon', daysUntil: days,
        headline: `Almost. ${Place}'s law starts ${formatDate(state.effective_date)}.`,
        detail: `The law is signed${cap ? ` and allows ${cap}` : ''}, but it is not in force for another ${days} day${days === 1 ? '' : 's'}. Until then the old rules apply.`,
      };
    }
    case 'awaiting_signature':
      return {
        tone: 'wait', label: 'On governor\'s desk', daysUntil: null,
        headline: `Not yet. ${Place}'s bill is waiting for the governor.`,
        detail: `The legislature passed it, but it is not law until signed. ${NO_LAW_DETAIL}`,
      };
    case 'in_progress':
      return {
        tone: 'wait', label: 'Bill pending', daysUntil: null,
        headline: `Not yet. A bill is moving in ${place}.`,
        detail: NO_LAW_DETAIL,
      };
    case 'stalled':
      return {
        tone: 'no', label: 'Bill stalled', daysUntil: null,
        headline: `Not yet. ${Place} has no plug-in solar law.`,
        detail: `A bill was introduced in 2026 but did not pass. ${NO_LAW_DETAIL}`,
      };
    default:
      return {
        tone: 'no', label: 'No law', daysUntil: null,
        headline: `Not yet. ${Place} has no plug-in solar law.`,
        detail: NO_LAW_DETAIL,
      };
  }
}

export const VERIFICATION_LABEL: Record<StateRecord['verification'], { label: string; explain: string }> = {
  primary: { label: 'Checked against the law', explain: 'Every fact here was read in the enacted text.' },
  mixed: { label: 'Partly checked against the law', explain: 'Key facts were read in official sources; the rest come from news and trackers.' },
  secondary: { label: 'From news and trackers', explain: 'Not yet checked against the enacted text. Treat details as provisional.' },
};

/** Amps a plug-in system puts on a 120 V circuit, and whether that fits a standard 15 A breaker's 80% continuous limit. */
export function circuitLoad(acWatts: number) {
  const amps = acWatts / 120;
  return { amps, fits15A: amps <= 12, fits20A: amps <= 16 };
}
