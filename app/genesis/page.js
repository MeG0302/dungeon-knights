import GenesisClient from './client';
import { readShots } from '../../lib/genesis-shots';
import { SITE_NAME } from '../../lib/site';
import { GENESIS_SUPPLY, HASH_POWER_MAX, HASH_POWER_MIN } from '../../lib/staking-config';

/**
 * `/genesis` — the collection page the landing page's second button opens.
 *
 * A server component for one reason: the screenshot frames are driven by what is actually in
 * `public/assets/genesis/`, and that question can only be asked on the server. Everything else on
 * the page is static markup around numbers imported from the modules that own them.
 *
 * `force-dynamic` rather than a prerendered snapshot, because "drop the capture in and it appears"
 * is the whole point of the folder reader: a build-time list would freeze the frames at whatever
 * existed when the deploy was made, and the next person to add a screenshot would be told it works
 * when it does not. The cost is one `readdir` per request.
 */

export const dynamic = 'force-dynamic';

// No capsule figure and no date in the description either: the weekly Knight-capsule raffle has no
// published count or schedule yet, and a meta description is quoted by search engines and chat
// cards long after it stops being true. The page itself says TBA for both.
const DESCRIPTION = `The ${GENESIS_SUPPLY.toLocaleString('en-US')} Genesis Knights. Fixed supply, ${HASH_POWER_MIN}–${HASH_POWER_MAX} hash power, a weekly Knight-capsule raffle, and a share of the weekly $DNG pool.`;

export const metadata = {
    title: { absolute: `Genesis Knights · ${SITE_NAME}` },
    description: DESCRIPTION,
    alternates: { canonical: '/genesis' },
    openGraph: {
        url: '/genesis',
        title: `${SITE_NAME} · Genesis Knights`,
        description: DESCRIPTION,
    },
    twitter: {
        card: 'summary_large_image',
        title: `${SITE_NAME} · Genesis Knights`,
        description: DESCRIPTION,
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

export default async function GenesisPage() {
    const shots = await readShots();
    return <GenesisClient shots={shots} />;
}
