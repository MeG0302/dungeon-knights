import PitchClient from './client';

export const metadata = {
    title: { absolute: 'Pitch Deck — Dungeon Knights' },
    description:
        'Dungeon Knights, as eleven slides: a canvas idle-RPG whose rewards are signed by a server on its own clock and re-derived by the contract that pays them, an economy funded before it pays, and the list of what is still missing.',
    alternates: { canonical: '/pitch' },
    // The game host answers this route behind the Kingdom Gate password, and the hub next door is
    // `noindex` for the same reason: the same product under two hostnames should not be two search
    // results. `robots.js` and the middleware's `X-Robots-Tag` also refuse it — this is the copy that
    // a crawler reads from the page itself.
    robots: { index: false, follow: false },
};

export default function PitchPage() {
    return <PitchClient />;
}
