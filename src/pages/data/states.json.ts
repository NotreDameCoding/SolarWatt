// The public dataset, as one file. Anyone may fetch, mirror, or embed it (CC0).
import { states, lastVerified } from '../../lib/data.ts';
import { SITE } from '../../config.ts';

export const GET = () =>
  new Response(JSON.stringify({
    license: 'CC0-1.0',
    source: SITE.repo,
    last_verified: lastVerified,
    disclaimer: 'General information, not legal advice. Check the cited sources.',
    states,
  }), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' } });
