import LandingClient from './landing-client';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '../lib/site';

export const metadata = {
  title: {
    absolute: 'Dungeon Knights — Blockchain Idle RPG | Enter the Dungeon',
  },
  description: SITE_DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    url: '/',
    title: `${SITE_NAME} — Enter the Dungeon`,
    description: SITE_DESCRIPTION,
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'VideoGame',
  name: SITE_NAME,
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  genre: ['Role-Playing', 'Idle', 'Strategy'],
  gamePlatform: 'Web browser',
  applicationCategory: 'Game',
  operatingSystem: 'Any (Web)',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
};

export default function LandingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <LandingClient />
    </>
  );
}
