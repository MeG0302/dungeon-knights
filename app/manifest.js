import { SITE_DESCRIPTION, SITE_NAME } from '../lib/site';

export default function manifest() {
  return {
    name: `${SITE_NAME} — Blockchain Idle RPG`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: '/',
    display: 'standalone',
    background_color: '#1a1a2e',
    theme_color: '#1a1a2e',
    icons: [
      {
        src: '/assets/images/capsule.png',
        sizes: '500x500',
        type: 'image/png',
      },
    ],
  };
}
