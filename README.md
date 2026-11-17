# SolarWatt

**Can you plug a solar panel into your wall?** A free, open-source guide to plug-in (balcony) solar in the US, by ZIP code.

Type a ZIP code and get:

- **The law where you live**: legal now, signed and starting soon, bill pending, or nothing yet, with the wattage cap, effective date, utility rules, and what renters and HOA residents can expect.
- **What it would save**: a production and savings estimate for your location, panel direction, mounting, shade, and your utility's price.
- **Which products are certified**: what each maker claims versus what a public certificate shows.
- **A landlord or HOA letter**: a formal notice where state law protects you, a permission request where it does not.
- **Alerts**: a feed of every signing and effective date.

Everything is static files. There is no server, no database, no API key, and nothing a visitor types leaves their browser.

## Run it

Needs Node 22.18 or newer.

```bash
npm install
npm run dev        # http://localhost:4321
npm test           # unit tests for the solar model, law logic, letters, ZIP lookup
npm run validate   # checks every record in data/
npm run build      # validates, then writes the site to dist/
```

## Deploy it

It is a plain Astro static site, so Vercel, Netlify, Cloudflare Pages, and GitHub Pages all work with the defaults (build command `npm run build`, output `dist`).

### GitHub Pages

`.github/workflows/deploy.yml` builds and publishes the site on every push to `main` and once a day. One setting is needed first: **Settings → Pages → Build and deployment → Source: GitHub Actions**. (The default, "Deploy from a branch", runs Jekyll over the source and fails.) The workflow sets `SITE_URL` and `BASE_PATH` by itself, so the site works at `https://<owner>.github.io/<repo>/`.

### Other hosts

Set one environment variable on the host:

| Variable | Why |
| --- | --- |
| `SITE_URL` | Your real address, e.g. `https://solarwatt.org`. Used for canonical links, the feed, and the embed snippet. |

Schedule a daily rebuild (a deploy hook plus a cron). If the site is served from a sub-path, also set `BASE_PATH` (for example `/SolarWatt`). Laws with a future start date flip to "legal" in the visitor's browser on the day, but the pre-rendered state pages and the feed only update when the site is rebuilt.

## Turn on email alerts

The site publishes an Atom feed at `/feed.xml`. An entry appears on the day an event happens.

1. Create a free newsletter at [Buttondown](https://buttondown.com).
2. Put its username in `src/config.ts` (`buttondownUsername`). The signup form appears on every page, tagged with the subscriber's state.
3. In Buttondown, add an RSS-to-email automation pointed at `https://your-site/feed.xml`.

Until step 2 is done the site offers the feed and GitHub watch instead of a form.

## Keeping the data right

This is the part that matters. A wrong date here could get someone in trouble with their utility or landlord.

```
data/
  states/XX.json    one record per state and DC
  products.json     certification claims
  changelog.json    dated events; drives the timeline and the feed
```

Every state record carries:

- `sources`, each marked `primary` (the enacted text or the legislature's own page) or `secondary` (news, trackers)
- `verification`: `primary`, `mixed`, or `secondary`, shown to readers on the page
- `last_verified`: the date someone last checked it
- `open_questions`: points where sources disagree or nobody has read the enacted text yet

**When sources disagree, record the disagreement in `open_questions` and show the more cautious reading** (the later effective date, the stricter rule). Never pick the convenient one.

To update a record: edit the JSON, add the source you read, set `last_verified` to today, add an entry to `changelog.json` if something happened (signed, vetoed, took effect), and run `npm run validate`. See [CONTRIBUTING.md](CONTRIBUTING.md).

### What still needs a human

The first dataset was assembled on November 16, 2026 from legislature pages where they could be read and from news and tracker sites where they could not. Of the ten states with a signed law, none is fully verified against the enacted text yet. The state pages list the open points; the biggest are:

- **Virginia**: in force since July 1, 2026, or starting January 1, 2027? Shown as the later date.
- **Colorado**: the legislature's page says the act took effect August 12, 2026. Several trackers say January 1, 2027, which is when the condo and HOA provision starts.
- **Maryland**: effective on signing (emergency bill) or July 1, 2026? And does it limit landlords?
- **Maine**: exact effective date, and whether small systems must notify the utility.
- **Products**: no certificate could be linked for any of the three products that claim UL 3700.

## How the estimate works

`src/lib/solar.ts` is a small solar model that runs in the browser. It takes monthly sunshine and temperature from NASA POWER, splits each month into clear and overcast days, spreads the light across the day, and transposes it onto a panel at any tilt and direction (Erbs, Collares-Pereira and Rabl, Hay and Davies). Then it applies temperature, system losses, and the inverter limit.

Savings count only the power the home uses as it is made, because no plug-in solar law pays for exports.

The tests hold the model to within 10% of typical PVWatts results for tilted south-facing systems in Phoenix, Seattle, Boston, and Denver, and check the physics that matters for balconies (vertical panels, east and west faces, clipping). It is a screening estimate and it does not know about shade you do not tell it about.

## Regenerating the bundled data

ZIP locations, utilities, rates, and the sunshine grid are committed under `public/` and `src/data/`. To rebuild them from the original sources:

```bash
npm run fetch-data
```

| Data | Source |
| --- | --- |
| ZIP centroids | US Census Bureau, 2024 ZCTA Gazetteer |
| Utilities and residential rates by ZIP | NREL / OpenEI, U.S. Electric Utility Companies and Rates (2023) |
| Sunshine and temperature | NASA POWER climatology (CERES SYN1deg, MERRA-2) |

## Project layout

```
data/                 the open dataset (CC0)
public/zip/           ZIP lookup shards, one small file per 3-digit prefix
public/solar-grid.json
scripts/              fetch-data.mjs, validate-data.mjs (no dependencies)
src/lib/              solar.ts, law.ts, letter.ts, zip.ts (pure, tested)
src/pages/            home, one page per state, products, letter, about, embed, feed
tests/
```

## Affiliate links

`data/products.json` has an `affiliate_url` field per product, empty by default. If any is filled in, the products page shows a disclosure automatically. Certification status never depends on it.

## License

Code: MIT. Data in `data/`: CC0 (public domain). Not legal advice.
