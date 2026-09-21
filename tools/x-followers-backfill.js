#!/usr/bin/env node
/**
 * The follows the webhook was never told about.
 *
 *     node tools/x-followers-backfill.js                  # what it would read, and what that costs
 *     node tools/x-followers-backfill.js --yes            # one page (up to 100 accounts)
 *     node tools/x-followers-backfill.js --yes --max-pages 5
 *
 * A webhook only knows what happens **after** it is subscribed. Everyone who followed @DNGrobinhood
 * before that — which, for a campaign that ran with the follow task in `claim` mode, is everybody —
 * has no fact in the store, so their 500-point claim is refused by a deployment running in `webhook`
 * mode. This walks X's own follower list once and writes those facts down.
 *
 * IT COSTS MONEY, SO IT WILL NOT RUN BY ITSELF
 * -------------------------------------------
 * `/2/users/:id/followers` is billed **per account row returned** — $0.010 on X's 2026 pay-per-use
 * card — so reading 2,000 followers is about $20, and the second run costs the same as the first
 * because there is nothing to skip. That is why the default is a dry run which reads no rows at all,
 * prints the arithmetic, and exits; the reading only happens with `--yes`, and `--max-pages` keeps
 * even that bounded. This is the opposite of the rest of the suite, where a check that cannot fail
 * is worthless: here the safe default is not to spend.
 *
 * WHAT IT CANNOT DO
 * -----------------
 * It adds follows; it cannot see an unfollow that happened before the subscription either, because
 * the two are the same absence. So an account that followed, left, and never came back still ends up
 * with a follow fact — for as long as it takes the webhook to report the next unfollow (which it
 * will, the moment one happens) or for the run doc's manual sweep to correct it. Said plainly here
 * rather than discovered by somebody looking at the points later.
 *
 * Needs `X_BEARER_TOKEN` (app-only) and `X_FOLLOW_TARGET_ID` (the numeric id of our own account —
 * the same variable the delivery filter uses).
 */

import { recordFollowFact } from '../lib/points-store.js';

const API = 'https://api.x.com/2/users';
const PER_ROW_USD = 0.01;

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
    const index = args.indexOf(`--${name}`);
    if (index === -1) return fallback;
    const value = args[index + 1];
    return value && !value.startsWith('--') ? value : true;
};

const confirmed = args.includes('--yes');
const maxPages = Number(flag('max-pages', 1)) || 1;
const pageSize = Math.min(Number(flag('page-size', 100)) || 100, 1000);
const targetId = String(process.env.X_FOLLOW_TARGET_ID || '').trim();
const bearer = String(process.env.X_BEARER_TOKEN || '').trim();

if (!/^\d{1,25}$/.test(targetId)) {
    console.error('X_FOLLOW_TARGET_ID is missing or is not a numeric account id.');
    console.error('It is the id of our own account — the same variable the webhook uses to filter deliveries.');
    process.exit(1);
}

const budget = maxPages * pageSize;

console.log('');
console.log('Followers of account id', targetId);
console.log(`  reading up to ${maxPages} page(s) of ${pageSize} — ${budget} rows`);
console.log(`  billed at $${PER_ROW_USD.toFixed(3)}/row on X's pay-per-use card → up to $${(budget * PER_ROW_USD).toFixed(2)}`);
console.log('');

if (!confirmed) {
    console.log('Dry run — nothing was read and nothing was charged.');
    console.log('Re-run with --yes to page the follower list and file the facts.');
    process.exit(0);
}

if (!bearer) {
    console.error('X_BEARER_TOKEN is required to read followers with --yes.');
    process.exit(1);
}

/**
 * Page the follower list.
 *
 * The read is deliberately minimal — `user.fields=username` and nothing else. Every field costs the
 * same per row, so a request for a bigger profile buys nothing this tool uses, and the id comes back
 * whether or not it is asked for.
 */
async function readPage(cursor) {
    const url = new URL(`${API}/${targetId}/followers`);
    url.searchParams.set('max_results', String(pageSize));
    url.searchParams.set('user.fields', 'username');
    if (cursor) url.searchParams.set('pagination_token', cursor);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` } });
    const body = await res.json().catch(() => null);

    if (!res.ok) {
        const why = body?.detail || body?.title || body?.errors?.[0]?.detail || `HTTP ${res.status}`;
        throw new Error(`the followers read failed: ${why}`);
    }
    return body || {};
}

let cursor = null;
let read = 0;
let written = 0;
let pages = 0;

try {
    do {
        const page = await readPage(cursor);
        const rows = Array.isArray(page.data) ? page.data : [];
        pages += 1;
        read += rows.length;

        for (const row of rows) {
            const fact = await recordFollowFact({
                id: row?.id,
                username: row?.username,
                following: true,
                // Dated now: we know the account follows us *as of this read*, and when it started
                // following is not something this endpoint says.
                at: new Date().toISOString(),
                source: 'backfill',
            });
            if (fact) written += 1;
        }

        cursor = page?.meta?.next_token || null;
        console.log(`page ${pages}: ${rows.length} accounts, ${written} written so far`);
    } while (cursor && pages < maxPages);
} catch (error) {
    console.error('');
    console.error(error.message || error);
    console.error(`Stopped after ${pages} page(s): ${read} rows read (about $${(read * PER_ROW_USD).toFixed(2)}), ${written} facts written.`);
    console.error('Facts already written are kept — re-running costs the rows again, so finish the pages you meant to read.');
    process.exit(1);
}

console.log('');
console.log(`${read} rows read across ${pages} page(s) — about $${(read * PER_ROW_USD).toFixed(2)} — ${written} follow facts written.`);
console.log('Those accounts can now claim the follow task under FOLLOW_PROOF_MODE=webhook.');
if (cursor) {
    console.log(`There is another page waiting — about $${(pageSize * PER_ROW_USD).toFixed(2)} more: re-run with --max-pages ${maxPages + 1}.`);
}
console.log('');
console.log('Caveat, repeated on purpose: this cannot see an unfollow that happened before the webhook was');
console.log('subscribed. Those are corrected by the next unfollow event, or by hand in the store.');
