import CollabReviewClient from './client';
import { SITE_NAME } from '../../../lib/site';

/**
 * `/collab/review` — the owner's half of the collab requests, and the page `tools/collab-requests.js`
 * points at for the part a browser is better at.
 *
 * **It is a public URL on purpose, and it holds nothing.** The page itself is a shell: the list comes
 * from `/api/collab/review`, which answers only a signed wallet on `COLLAB_OWNERS`
 * (`lib/collab-owners.js`), so a stranger who opens this address gets a sentence about signing in and
 * an empty page. Putting it behind the site password instead would mean the owner needed the password
 * *and* the wallet, which is one more thing to keep to hand than the authority actually requires — and
 * the gate is a door for players, not for the person the players are writing to.
 *
 * Two things follow from that, and both are deliberate:
 *
 *   - **It is not in the sitemap**, and it is `noindex`, because it is nobody's search result. The
 *     sitemap is the list of pages the site is *offering*.
 *   - **It is not linked from `/collab`.** The team that has to find it is the one holding the wallet,
 *     and it is printed by the CLI and documented in `.freebuff/run.md`. A link on the partner-facing
 *     page would only invite people to a door they cannot open.
 *
 * It reads `metadata` rather than anything from the store, so it stays a static shell: the dynamic
 * half is the endpoint, which is where the decision belongs.
 */

export const metadata = {
  title: { absolute: `Collab review · ${SITE_NAME}` },
  description: 'The collab requests, and the two decisions there are. Readable only by the owner wallet.',
  robots: { index: false, follow: false },
};

export default function CollabReviewPage() {
  return <CollabReviewClient />;
}
