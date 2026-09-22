'use client';

import LegacyPage from './legacy-page';

/**
 * The public landing at the apex.
 *
 * Same mechanism as every other legacy page in this app: the body, stylesheets and scripts come from
 * `STATIC_PAGES.home`, so the page people land on first has no hydration and one sheet of its own.
 */
export default function HomeClient() {
    return <LegacyPage pageKey="home" />;
}
