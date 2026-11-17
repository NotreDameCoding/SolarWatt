// Atom feed of law changes. Feed readers and RSS-to-email services (Buttondown,
// Mailchimp, IFTTT) turn this into alerts with no backend of our own.
import type { APIContext } from 'astro';
import { changelog, stateByCode, BUILD_DATE } from '../lib/data.ts';
import { SITE, absoluteUrl } from '../config.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const GET = ({ site }: APIContext) => {
  // Only things that have happened: an entry appears on the day it takes place.
  const entries = changelog.filter((e) => e.date <= BUILD_DATE);
  const url = (path: string) => absoluteUrl(path, site);
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${SITE.name}: plug-in solar law changes</title>
  <subtitle>Signings, vetoes, and effective dates for US balcony solar laws.</subtitle>
  <link href="${url('/feed.xml')}" rel="self"/>
  <link href="${url('/')}"/>
  <id>${url('/')}</id>
  <updated>${entries[0]?.date ?? BUILD_DATE}T12:00:00Z</updated>
${entries.map((e) => {
    const state = stateByCode.get(e.state)!;
    const link = url(`/${state.slug}/`);
    return `  <entry>
    <title>${esc(e.title)}</title>
    <link href="${link}"/>
    <id>${link}#${e.date}-${e.type}</id>
    <updated>${e.date}T12:00:00Z</updated>
    <category term="${e.state}"/>
    <category term="${e.type}"/>
    <summary>${esc(state.summary)}</summary>
    <author><name>${SITE.name}</name></author>
  </entry>`;
  }).join('\n')}
</feed>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' } });
};
