import PortfolioClient from './client';
import { SITE_NAME, SITE_URL } from '../../lib/site';

export const metadata = {
  title: { absolute: 'My Portfolio — Dungeon Knights' },
  description: 'Your $DNG balance, both knight collections, staking rewards and Points Program standing in one place.',
  alternates: { canonical: '/portfolio' },
  openGraph: {
    url: '/portfolio',
    title: `${SITE_NAME} — My Portfolio`,
    description: 'Your $DNG balance, both knight collections, staking rewards and Points Program standing in one place.',
  },
};

export default function PortfolioPage() {
  return <PortfolioClient />;
}
