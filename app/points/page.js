import PointsClient from './client';
import { SHARE_OG_IMAGE, SHARE_OG_SIZE } from '../../lib/points-config';
import { SITE_NAME } from '../../lib/site';

const DESCRIPTION = 'Clear three Points Vault dungeons every day, double the run by sharing it on X, and climb the referral leaderboard.';

export const metadata = {
  title: { absolute: 'Points Program — Dungeon Knights' },
  description: DESCRIPTION,
  alternates: { canonical: '/points' },
  openGraph: {
    url: '/points',
    title: `${SITE_NAME} — Points Program`,
    description: DESCRIPTION,
    // The card a shared post unfurls into, and the reason the picture gets into that post at all:
    // X's composer link cannot attach a file (only the paid API can post one on a player's behalf),
    // so the photo travels on the invite link the post has to carry. The crop is ours rather than
    // X's — 1.91:1, made from the same photo the share kit offers for download.
    images: [
      {
        url: SHARE_OG_IMAGE,
        width: SHARE_OG_SIZE.width,
        height: SHARE_OG_SIZE.height,
        alt: 'A knight of Dungeon Knights in the Points Vault',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — Points Program`,
    description: DESCRIPTION,
    images: [SHARE_OG_IMAGE],
  },
};

export default function PointsPage() {
  return <PointsClient />;
}
