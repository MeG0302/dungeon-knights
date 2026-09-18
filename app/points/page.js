import PointsClient from './client';

export const metadata = {
  title: { absolute: 'Points Program — Dungeon Knights' },
  description: 'Earn points, refer friends, climb the leaderboard.',
};

export default function PointsPage() {
  return <PointsClient />;
}
