import TokenomicsClient from './client';
import { SITE_NAME } from '../../lib/site';

export const metadata = {
    title: { absolute: '$DNG Economy — Dungeon Knights' },
    description:
        'The full $DNG tokenomics: one fixed 1,000,000,000 supply, a funded weekly reward vault split four ways, the reward table at scale 1.00, and the capsule faucet that mints every Knight.',
    alternates: { canonical: '/tokenomics' },
    openGraph: {
        url: '/tokenomics',
        title: `${SITE_NAME} — $DNG Economy`,
        description:
            'Supply, distribution, the weekly reward vault and the reward table — every published number, derived from the same module the contracts are deployed from.',
    },
};

export default function TokenomicsPage() {
    return <TokenomicsClient />;
}
