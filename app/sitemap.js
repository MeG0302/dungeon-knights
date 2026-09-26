import { SITE_URL } from '../lib/site';
import { REDEEM_LIVE } from '../lib/points-config';

/**
 * Only what the apex serves to the public.
 *
 * This used to list the game's routes too. It cannot any more: `/menu`, `/mint`, `/dungeons`, `/game`
 * and `/tokenomics` now live behind the password on `app.dungeonknights.io`, so listing them here
 * would either advertise a redirect or hand a crawler a login screen. `/points` and `/genesis` stay
 * because they are the things being advertised.
 *
 * `/redeem` is the third, and it is listed **only while the wheel is published** — the same
 * `REDEEM_LIVE` the footer link and the routing table read. A sitemap entry is a promise to a
 * crawler that the URL is public, and while the wheel is held back `/redeem` is not: the apex
 * redirects it to the password. Advertising a redirect is the exact failure this list exists to
 * avoid, so the entry arrives with the wheel rather than before it.
 */
export default function sitemap() {
  const routes = [
    { path: '/', priority: 1.0, changeFrequency: 'weekly' },
    { path: '/points', priority: 0.9, changeFrequency: 'daily' },
    { path: '/genesis', priority: 0.9, changeFrequency: 'weekly' },
    // On this list for the same reason `/points` is: a player who won something should be able to
    // find the page that pays it without knowing a URL.
    ...(REDEEM_LIVE ? [{ path: '/redeem', priority: 0.9, changeFrequency: 'weekly' }] : []),
  ];
  return routes.map((r) => ({
    url: `${SITE_URL}${r.path}`,
    lastModified: new Date(),
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
