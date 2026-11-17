import { defineConfig } from 'astro/config';

// Set SITE_URL in your host's environment (Vercel/Netlify/GitHub Pages) so the
// alert feed and canonical links point at the real domain.
export default defineConfig({
  site: process.env.SITE_URL ?? 'https://example.com',
  trailingSlash: 'always',
  build: { format: 'directory' },
});
