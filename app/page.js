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
 */

export const metadata = {
    title: {
        absolute: 'Dungeon Knights — Coming soon to Robinhood Chain',
    },
    description:
        'Dungeon Knights is a play-to-earn NFT idle RPG on Robinhood Chain. The game is in private build; '
        + 'the Points Program is open now, and the 1,024 Genesis Knights are next.',
    alternates: { canonical: '/' },
    openGraph: {
        url: '/',
        title: `${SITE_NAME} — Coming soon to Robinhood Chain`,
        description:
            'Join the Points Program today, and the Genesis waitlist for the 1,024 Genesis Knights.',
    },
};

const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: SITE_NAME,
    url: SITE_URL,
    description:
        'Play-to-earn NFT idle RPG on Robinhood Chain: recruit knights, clear five themed dungeons and earn $DNG.',
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
