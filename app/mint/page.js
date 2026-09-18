import MintClient from './client';

export const metadata = {
  title: 'Summon Knights',
  description:
    'Summon knight NFTs on Robinhood Chain. Six rarity tiers from Common to Mythic — forge your squad and start earning $DNG.',
  alternates: { canonical: '/mint' },
  openGraph: {
    url: '/mint',
    title: 'Summon Knights | Dungeon Knights',
    description:
      'Mint knight NFTs in 6 rarity tiers, from Common to Mythic.',
  },
};

export default function MintPage() {
  return <MintClient />;
}
