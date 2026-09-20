import { SITE_URL } from '../lib/site';

export default function sitemap() {
  const routes = [
    { path: '/', priority: 1.0, changeFrequency: 'weekly' },
    { path: '/mint', priority: 0.9, changeFrequency: 'weekly' },
    // The economy page is reference material, and it is the one page whose numbers a
    // reader is most likely to want to check later — hence the same priority as the mint.
    { path: '/tokenomics', priority: 0.9, changeFrequency: 'weekly' },
    { path: '/menu', priority: 0.8, changeFrequency: 'weekly' },
    { path: '/dungeons', priority: 0.8, changeFrequency: 'weekly' },
    { path: '/game', priority: 0.6, changeFrequency: 'weekly' },
  ];
  return routes.map((r) => ({
    url: `${SITE_URL}${r.path}`,
    lastModified: new Date(),
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
