import { states } from '../../lib/data.ts';

const cell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const columns = ['code', 'name', 'status', 'bill', 'signed_date', 'effective_date', 'watt_cap', 'utility_approval_required',
  'utility_notification', 'certification', 'renter_protection', 'hoa_protection', 'verification', 'last_verified', 'source'] as const;

export const GET = () => {
  const rows = states.map((s) => [
    s.code, s.name, s.status, s.bill?.number, s.signed_date, s.effective_date, s.watt_cap,
    s.utility ? s.utility.approval_required : '', s.utility?.notification, s.certification,
    s.renter_protection, s.hoa_protection, s.verification, s.last_verified,
    (s.sources.find((x) => x.kind === 'primary') ?? s.sources[0])?.url,
  ].map(cell).join(','));
  return new Response([columns.join(','), ...rows].join('\n') + '\n', { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
};
