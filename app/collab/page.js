import CollabClient from './client';
import { listedProjects } from '../../lib/collab-store';
import { SITE_NAME } from '../../lib/site';
import { GENESIS_SUPPLY } from '../../lib/staking-config';

/**
 * `/collab` — the page a partner is sent to, which is why it is public on the apex.
 *
 * Its two sentences are built from the same modules the collection is built from, so the description
 * a search engine quotes cannot describe a supply the contracts do not have.
 *
 * It is a **server component** for the same reason `/genesis` is: the giveaway list is not a list in
 * a file, it is a store the browser cannot read. `listedProjects` hands back the pinned projects plus
 * every request the owner has approved, and the tab renders exactly that — so approving a project on
 * `tools/collab-requests.js` is the whole of adding it, picture, prize and dates included.
 *
 * `force-dynamic` is the other half of that promise. A prerendered page would freeze the giveaway
 * list at whatever the store held when the deploy was made, and a partner would be told their
 * approval had gone through by an owner whose page disagreed. The cost is one store read per request,
 * on a page that gets a handful — the same bargain `/genesis` makes for one `readdir`.
 */

export const dynamic = 'force-dynamic';

// The prize named here and in the offers below is what it actually is: **Knight capsules**, handed to
// the partner's community. There is no such thing as a Genesis capsule, and no capsule count belongs
// in this description — how many capsules a collab carries is agreed per collaboration, and the
// weekly raffle's own count is not published yet (see `/genesis`, which says TBA).
const DESCRIPTION =
  `Partner with ${SITE_NAME}: free Knight capsules and Genesis NFT whitelist spots for your community, `
  + `a collab post we share, and a registration tab on this page. ${GENESIS_SUPPLY.toLocaleString('en-US')} `
  + `Genesis Knights, and a weekly Knight-capsule raffle.`;

export const metadata = {
  title: { absolute: `Collab · ${SITE_NAME}` },
  description: DESCRIPTION,
  alternates: { canonical: '/collab' },
  openGraph: {
    url: '/collab',
    title: `${SITE_NAME} · Collab`,
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} · Collab`,
    description: DESCRIPTION,
  },
};

export default async function CollabPage() {
  const projects = await listedProjects();
  return <CollabClient projects={projects} />;
}
