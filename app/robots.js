import { SITE_URL } from '../lib/site';

/**
 * One indexable site, and it is the apex.
 *
 * The gated app host carries its own `X-Robots-Tag: noindex` from the middleware — this file only
 * has to keep the door to it, and the password screen, out of the crawl. Everything the sitemap
 * lists is a page the apex actually serves to the public; the game routes are deliberately not
 * advertised, because they redirect to a host that asks for a password.
 */
export default function robots() {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/gate', '/api/'] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
