import DocsClient from './client';
import { ART, artOf } from '../../lib/docs-content';
import { SITE_NAME } from '../../lib/site';

const TITLE = 'Docs · Dungeon Knights';
const DESCRIPTION =
    'How Dungeon Knights works: the loop, the published reward table, the vault that funds it, the Points Program with its nightly draw, and the nine contract addresses to check it against.';

export const metadata = {
    // `absolute`, because the root layout's template would otherwise read "Docs · Dungeon Knights |
    // Dungeon Knights" — the wordmark twice, which is what every page that sets its own name here
    // would say.
    title: { absolute: TITLE },
    description: DESCRIPTION,
    alternates: { canonical: '/docs' },
    openGraph: {
        url: '/docs',
        title: `${SITE_NAME} · Docs`,
        description: DESCRIPTION,
        // The unfurl card, and the one image on this page that is not drawn by the body: it is worn
        // by the metadata, so it is named here rather than in the content module's markup. It reads
        // `artOf('og')` — the new card if it has landed, the points share card until then — so a
        // file arriving at `public/assets/docs/docs-og.jpg` is a one-line change and not a hunt.
        images: [{ url: artOf('og'), width: 1200, height: 630, alt: ART.og.note }],
    },
    twitter: {
        card: 'summary_large_image',
        title: `${SITE_NAME} · Docs`,
        description: DESCRIPTION,
        images: [artOf('og')],
    },
};

export default function DocsPage() {
    return <DocsClient />;
}
