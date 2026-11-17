// Site-wide settings. Edit these, not the pages.
/** Absolute URL for a site path, honouring SITE_URL and BASE_PATH. */
export const absoluteUrl = (path: string, site: URL | undefined): string =>
  (site?.origin ?? 'https://example.com') + (process.env.BASE_PATH ?? '').replace(/\/+$/, '') + path;

export const SITE = {
  name: 'SolarWatt',
  tagline: 'Can you plug a solar panel into your wall?',
  description:
    'Free, open-source guide to whether you can legally plug a balcony solar panel into your outlet, by ZIP code: state law, wattage caps, utility rules, savings, certified products, and landlord letters.',
  repo: 'https://github.com/NotreDameCoding/SolarWatt',

  // Email alerts. Create a free newsletter at buttondown.com, put its username
  // here, and point its "RSS to email" automation at /feed.xml. While this is
  // empty the site offers the RSS feed and GitHub watch instead of a form.
  buttondownUsername: '',
};
