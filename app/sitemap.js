import { SITE_URL } from '../lib/site';

/**
 * Only what the apex serves to the public.
 *
 * This used to list the game's routes too. It cannot any more: `/menu`, `/mint`, `/dungeons`, `/game`
 * and `/tokenomics` now live behind the password on `app.dungeonknights.io`, so listing them here
 * would either advertise a redirect or hand a crawler a login screen. `/points` and `/genesis` stay
 * because they are the two things being advertised.
 */
export default function sitemap() {
  const routes = [
    { path: '/', priority: 1.0, changeFrequency: 'weekly' },
    { path: '/points', priority: 0.9, changeFrequency: 'daily' },
    { path: '/genesis', priority: 0.9, changeFrequency: 'weekly' },
  ];
  return routes.map((r) => ({
    url: `${SITE_URL}${r.path}`,
    lastModified: new Date(),
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
