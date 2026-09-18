import DungeonSelectClient from './client';

export const metadata = {
  title: 'Choose Your Dungeon',
  description:
    'Five themed dungeons await: Forgotten Crypts, Goblin Mines, Overgrown Temple, Magma Chambers and the Void Rift. Pick your battleground.',
  alternates: { canonical: '/dungeons' },
  openGraph: {
    url: '/dungeons',
    title: 'Choose Your Dungeon | Dungeon Knights',
    description:
      'Forgotten Crypts, Goblin Mines, Overgrown Temple, Magma Chambers, Void Rift.',
  },
};

export default function DungeonsPage() {
  return <DungeonSelectClient />;
}
