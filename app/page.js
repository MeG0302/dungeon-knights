import HomeClient from './home-client';
import { SITE_NAME, SITE_URL } from '../lib/site';

/**
 * `dungeonknights.io` — the public page.
 *
 * It is a coming-soon page by design: the game itself lives on `app.dungeonknights.io` behind a
 * password while it is early, and the two things this page is for are the Points Program (open now)
 * and the Genesis waitlist. The copy says exactly that rather than implying a finished game — the
 * descriptor in `lib/site.js` still describes the product, and this page describes the present.
 *
 * The old Kingdom Gate hub is at `/hub` now, which the middleware rewrites to on the app host only.
 *
 * `viewport` is exported here rather than left to the root layout because the game wants the opposite
 * of it: every screen inside the app is a fixed canvas with its own zoom, while this page is text a
 * stranger may want to enlarge — so the zoom block `app/layout.js` sets for the game is lifted on
 * this route alone. Double-tap zoom, which is the one that actually interferes with tapping a
 * button, is suppressed in `home.css` instead, with `touch-action: manipulation`.
 */

export const metadata = {
    title: {
        absolute: 'Dungeon Knights · Coming soon to Robinhood Chain',
    },        description:
            'Dungeon Knights is an idle RPG on Robinhood Chain. The game is in private build. '
            + 'The Points Program is open now, and the 1,024 Genesis Knights are next.',
    alternates: { canonical: '/' },
    openGraph: {
        url: '/',
        title: `${SITE_NAME} · Coming soon to Robinhood Chain`,
        description:
            'Join the Points Program today, and the Genesis waitlist for the 1,024 Genesis Knights.',
    },
};

export const viewport = {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 5,
    userScalable: true,
    viewportFit: 'cover',
    themeColor: '#12100E',
};

const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: SITE_NAME,
    url: SITE_URL,
    description:
        'Idle RPG on Robinhood Chain. Recruit knights, clear five themed dungeons, and earn $DNG.',
    genre: ['Role-Playing', 'Idle', 'Strategy'],
    gamePlatform: 'Web browser',
    applicationCategory: 'Game',
    operatingSystem: 'Any (Web)',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
};

export default function HomePage() {
    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
            />
            <HomeClient />
        </>
    );
}
