import GameClient from './client';

export const metadata = {
  title: 'Play — Idle Dungeon Battle',
  description:
    'Deploy your knights and watch them auto-battle through the dungeon in this idle RPG. Earn gold per kill and clear loot nodes.',
  alternates: { canonical: '/game' },
  openGraph: {
    url: '/game',
    title: 'Play | Dungeon Knights',
    description: 'Idle dungeon battles — deploy knights, earn gold, clear dungeons.',
  },
};

export default function GamePage() {
  return <GameClient />;
}
