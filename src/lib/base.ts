// The site's root path: "/" normally, "/SolarWatt/" on a GitHub Pages project
// site. Read from a <link> in the layout that the post-build step rewrites.
export const basePath = (): string => document.getElementById('base')?.getAttribute('href') ?? '/';
