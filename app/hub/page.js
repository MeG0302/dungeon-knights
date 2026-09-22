import LandingClient from '../landing-client';

/**
 * The Kingdom Gate hub — what `/` used to be.
 *
 * It moved for one reason: the apex is now the public coming-soon page, and this hub is the front
 * door of the *game* — knight roster, mint, vault, dungeons — so it belongs on the host the game
 * lives on. `middleware.js` rewrites `app.dungeonknights.io/` to this route, so the hub still
 * answers at the root of the app host even though its file lives at `/hub`.
 *
 * `noindex` twice over (here and in the middleware's `X-Robots-Tag`): the same product under two
 * hostnames should not be two search results.
 */

export const metadata = {
    title: 'Kingdom Gate — Dungeon Knights',
    robots: { index: false, follow: false },
};

export default function HubPage() {
    return <LandingClient />;
}
