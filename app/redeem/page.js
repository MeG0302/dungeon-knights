import RedeemClient from './client';
import { SITE_NAME } from '../../lib/site';
import { REDEEM_SPIN_COST, redeemOdds } from '../../lib/points-config';

const DESCRIPTION = `Spend ${REDEEM_SPIN_COST.toLocaleString('en-US')} points on the knights' wheel: three reels, three outcomes, and a gift card one time in three.`;

export const metadata = {
  title: { absolute: 'Redeem · Dungeon Knights' },
  description: DESCRIPTION,
  alternates: { canonical: '/redeem' },
  openGraph: {
    url: '/redeem',
    title: `${SITE_NAME} · Redeem`,
    description: DESCRIPTION,
  },
};

export default function RedeemPage() {
  return <RedeemClient />;
}
