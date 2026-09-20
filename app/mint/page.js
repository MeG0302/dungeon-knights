import MintClient from './client';

export const metadata = {
  title: 'Summon Knights',
  description:
    'Summon knight NFTs on Robinhood Chain. Five rarity tiers from Common to Legendary — forge your squad and start earning $DNG.',
  alternates: { canonical: '/mint' },
  openGraph: {
    url: '/mint',
    title: 'Summon Knights | Dungeon Knights',
    description:
      'Mint knight NFTs in 5 rarity tiers, from Common to Legendary.',
  },
};

export default function MintPage() {
  return <MintClient />;
}
