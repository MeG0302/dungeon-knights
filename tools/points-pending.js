#!/usr/bin/env node
/**
 * The review queue for the one-time tasks — the thing behind the word "review" on the card.
 *
 *     node tools/points-pending.js                              # what is waiting
 *     node tools/points-pending.js --approve 0xabc…             # pay it now, early
 *     node tools/points-pending.js --reject 0xabc… --reason "no follow visible"
 *     node tools/points-pending.js --settle                     # pay everything whose window closed
 *
 * WHY THIS EXISTS
 * ---------------
 * A follow cannot be checked for free, so the +500 claim waits out a window and is credited at the
 * end of it — and the card says the claim is reviewed. That sentence is worth exactly as much as
 * this tool: without it, "reviewed" would be a word the page says about nothing. Here is what the
 * window is for — a claim that looks farmed can be turned down **before** it pays, and a real
 * follower can be paid early instead of made to wait.
 *
 * The store is the one the deployment uses, so this reads and writes the same records the site does:
 * the local file in development (`STORAGE_DRIVER=file`), and Redis when `KV_REST_API_URL` and
 * `KV_REST_API_TOKEN` are in the environment — which for production means pulling them into the shell
 * for one command, **never** into `.env.local`:
 *
 *     npx vercel env pull /tmp/prod.env --environment=production
 *     node --env-file=/tmp/prod.env tools/points-pending.js
 *
 * A rejection is final. `rejectPendingClaim` writes `state: 'rejected'`, and `claimOneTime` refuses a
 * rejected record before it looks at anything else — so the wallet cannot simply claim again, and
 * the card says the claim was reviewed and not approved.
 *
 * Arguments are checked against the live queue rather than trusted: approving an address that is not
 * waiting says so instead of inventing a claim.
 */

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
    const index = args.indexOf(`--${name}`);
    if (index === -1) return fallback;
    const next = args[index + 1];
    return next && !next.startsWith('--') ? next : true;
};

const address = String(flag('approve', '') || flag('reject', '') || '').trim();
const approving = args.includes('--approve');
const rejecting = args.includes('--reject');
const settling = args.includes('--settle');
const reason = String(flag('reason', '') || '').trim();
const taskId = String(flag('task', 'follow') || 'follow').trim();

if (approving && rejecting) {
    console.error('--approve and --reject are different decisions — pass one of them.');
    process.exit(1);
}

(async () => {
    const Store = await import('../lib/points-store.js');
    const Program = await import('../lib/points-program.js');

    console.log('');
    console.log(`Points review queue — store: ${Store.storageDescription()}`);

    // A window that has already closed is paid on the player's next visit anyway; settling here just
    // means it is paid now, including for somebody who never comes back.
    if (settling || approving || rejecting) {
        const before = await Program.reviewQueue();
        for (const row of before) await Program.settleDueClaims(row.address);
    }

    // One decision, if one was asked for. Reported first so its output is not buried under a listing.
    if (approving || rejecting) {
        const key = Store.normaliseAddress(address);
        if (!key) {
            console.error('');
            console.error(`That is not a wallet address: ${address || '(none given)'}`);
            process.exit(1);
        }

        const waiting = (await Program.reviewQueue()).find((row) => row.address === key);
        if (!waiting) {
            console.error('');
            console.error(`${key} has no claim waiting — nothing to approve or turn down.`);
            console.error('(Run without flags to see what is actually in the queue.)');
            process.exit(1);
        }

        console.log('');
        if (approving) {
            const result = await Program.approvePendingClaim(key, waiting.taskId);
            if (result.error) {
                console.error(`could not approve: ${result.error}`);
                process.exit(1);
            }
            console.log(`approved — @${waiting.handle || '?'} (${key}) credited ${result.credited} PTS early`);
        } else {
            const result = await Program.rejectPendingClaim(key, waiting.taskId, reason);
            if (result.error) {
                console.error(`could not reject: ${result.error}`);
                process.exit(1);
            }
            console.log(`turned down — @${waiting.handle || '?'} (${key}) will never be credited for ${waiting.taskId}`);
            if (reason) console.log(`reason recorded on the claim: ${reason}`);
        }
    }

    // What is left, which is also what a plain run shows.
    const queue = await Program.reviewQueue();

    console.log('');
    if (!queue.length) {
        console.log('Nothing is waiting. Every claim has either been credited or turned down.');
        return;
    }

    console.log(`${queue.length} claim(s) waiting:`);
    for (const row of queue) {
        console.log('');
        console.log(`  @${row.handle || '(no handle)'}${row.verifiedBinding ? '' : ' (unproved binding)'}`);
        console.log(`    wallet    ${row.address}`);
        console.log(`    task      ${row.taskId} — ${row.title}, ${row.reward} PTS`);
        console.log(`    claimed   ${row.claimedAt || '?'}`);
        console.log(`    closes    ${row.settleAfter || '?'}  (${row.minutesLeft} min left)`);
    }

    console.log('');
    console.log('  --approve <address>   pay it now, without waiting the window out');
    console.log('  --reject <address>    refuse it for good (--reason "…" is recorded on the claim)');
    console.log('  --settle              pay everything whose window has already closed');
    console.log('');
    console.log('  Unproved bindings are worth a second look: a handle that was typed rather than proved');
    console.log('  by Privy is the cheapest thing for a farmer to mint, and nothing about the claim checks');
    console.log('  whether the account is real beyond that.');
})().catch((error) => {
    console.error('');
    console.error(error.message || error);
    process.exit(1);
});
