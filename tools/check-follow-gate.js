#!/usr/bin/env node
/**
 * Does the +500 actually wait for X — refused before the follow is known, paid after, once, and
 * never paid for a delivery we did not sign?
 *
 *     node tools/check-follow-gate.js http://localhost:3100
 *     X_CONSUMER_SECRET=… node tools/check-follow-gate.js https://dungeon-knights.vercel.app
 *     node --env-file=<pulled.env> tools/check-follow-gate.js https://dungeon-knights.vercel.app --against-live
 *
 * WHY THIS IS NOT PART OF THE OFFLINE HARNESS
 * -------------------------------------------
 * `check-x-webhook.js` proves the parser and the two HMACs, offline, against payloads this repo
 * wrote. That is a different claim from the one that matters here: that a **running deployment**
 * wires those rules to a wallet's points. So this file talks to a real server over HTTP, with a real
 * signed session, and pays attention to the two things a unit test cannot see — that a refusal
 * happens *before* the once-only guard is taken (a player refused for our timing must still be able
 * to claim once X catches up), and that a forged delivery buys nothing.
 *
 * It signs its own deliveries because X cannot be asked to follow us on demand. That makes the
 * deliveries synthetic and the *transport* real: the same route, the same raw-body signature check,
 * the same store. What it cannot prove is that X sends the envelope we parse — only a real follow
 * does that, which is why the run doc keeps that as the last step rather than this file.
 *
 * Every wallet is generated here, so nothing of anybody's is touched and a rerun is a rerun — and what
 * the run *makes* it also un-makes. Against a loopback server on the file driver the store file is
 * snapshotted and restored; against a shared store every wallet the run created is taken back out by
 * address — `purgeWallet` deletes whatever `walletKeys` names, then asks it again — and it is
 * **read for** a second time through the store's own API, so a cleanup that did nothing is a failed
 * check rather than a pending claim nobody notices until it pays.
 *
 * That requires this process to be able to reach the store the server is using, and it refuses to
 * write when it cannot — `--against-live` from a shell with no credentials is exactly the shape in
 * which a harness has to leave its test wallets behind, so it stops instead.
 *
 * Needs one thing of the server: the same `X_CONSUMER_SECRET` it verifies deliveries with, and
 * `FOLLOW_PROOF_MODE=webhook` (a deployment in `claim` mode is measured for exactly that instead —
 * see the first scenario).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
    const index = args.indexOf(`--${name}`);
    if (index === -1) return fallback;
    const next = args[index + 1];
    return next && !next.startsWith('--') ? next : true;
};

const BASE = String(flag('url', args.find((a) => !a.startsWith('--')) || 'http://localhost:3000')).replace(/\/+$/, '');
const SECRET = String(process.env.X_CONSUMER_SECRET || flag('secret', '') || '').trim();
const TARGET = String(process.env.X_FOLLOW_TARGET_ID || flag('target', '') || '').trim();
const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(BASE);
// The scenarios below bind accounts and pay points, which is fine on a store of your own and a
// change to somebody else's. `--read-only` stops after the one question that costs nothing.
const READ_ONLY = args.includes('--read-only');
const STORE_FILE = path.join(process.cwd(), '.data', 'points.json');

// Declared out here because the `finally` below cleans up after the whole run, and the wallets are
// created inside it.
let snapshot = null;
let Store = null;
// Set the moment this run writes anything to the store. Nothing is written before a binding, so a run
// that refuses — read-only, or a store it cannot reach — leaves this false and skips the whole
// cleanup, which would otherwise be deletions with nothing behind them.
let wrote = false;
// Set the first time a claim is submitted, which is what makes the server take its once-only guard
// slot — the one piece of the cleanup that does not show up in a wallet read, and so needs its own
// assertion (`residueOf` cannot see a guard: it is a key with a TTL, not a record about a wallet).
let claimMade = false;
// Every wallet this run signs in, with the X identities it fabricates for it. The cleanup works from
// this list: `signIn()` adds the wallet, and each scenario adds its own handle and account id.
const created = [];

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}
function note(text) {
    console.log(`        ${text}`);
}

const { Wallet } = require('ethers');

/* ------------------------------------------------------------------------------- the plumbing */

async function api(pathname, { method = 'GET', body, token } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE}${pathname}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* an HTML error page is still an answer */ }
    return { status: res.status, ok: res.ok, body: parsed, text };
}

/** A fresh wallet, signed in the way the page does it — a real signature over a real challenge. */
async function signIn() {
    const wallet = new Wallet(crypto.randomBytes(32).toString('hex'));
    const challenge = await api(`/api/points/session?address=${wallet.address}`);
    if (!challenge.ok || !challenge.body?.message) {
        throw new Error(`could not get a challenge (HTTP ${challenge.status}) — is anything listening at ${BASE}?`);
    }
    const signature = await wallet.signMessage(challenge.body.message);
    const session = await api('/api/points/session', {
        method: 'POST',
        body: { message: challenge.body.message, signature },
    });
    if (!session.ok || !session.body?.token) throw new Error(`could not start a session (HTTP ${session.status})`);
    const token = session.body.token;
    // Recorded before anything can be written, so an abort halfway through still leaves a wallet the
    // cleanup knows about.
    const record = { address: wallet.address, ids: [], handles: [] };
    created.push(record);
    return {
        address: wallet.address,
        token,
        record,
        state: async () => (await api('/api/points/me', { token })).body?.state || null,
        bind: async (handle) => api('/api/points/x', {
            token,
            method: 'POST',
            body: { action: 'bind', identity: { id: '', username: handle } },
        }),
        claim: async (task = 'follow') => {
            claimMade = true;
            return api('/api/points/task', {
                token,
                method: 'POST',
                body: { action: 'claim', task },
            });
        },
    };
}

function handle(prefix = 'dnge2e') {
    return `${prefix}${crypto.randomBytes(3).toString('hex')}`;
}

/**
 * Bind an account for a wallet, remembering the handle so the cleanup knows what to take back.
 *
 * The first write of any scenario, which is why `wrote` is set here: past this point the run has
 * something in the store that has to come out again.
 */
async function bindX(who, handleName) {
    wrote = true;
    if (handleName) who.record.handles.push(handleName);
    return who.bind(handleName);
}

/**
 * Everything the store still says about a wallet this run created, asked through the store's *own*
 * reads — the same questions the review tool would ask. Deliberately not a key scan: a verification
 * that shares the cleanup's idea of where things live goes blind in exactly the same way it does.
 */
async function residueOf(wallet) {
    const address = Store.normaliseAddress(wallet.address);
    const left = [];
    if (await Store.getWallet(address)) left.push('the wallet record');
    if ((await Store.rankOf(address)) !== null) left.push('a leaderboard entry');
    if ((await Store.pendingList()).some((row) => row.address === address)) left.push('a pending claim');
    for (const handleName of wallet.handles) {
        if (await Store.xBindingOwner(`handle:${handleName}`)) left.push(`the binding on @${handleName}`);
        if (await Store.followFact({ username: handleName })) left.push(`a follow fact for @${handleName}`);
    }
    for (const id of wallet.ids) {
        if (await Store.xBindingOwner(id)) left.push(`the binding on account ${id}`);
        if (await Store.followFact({ id })) left.push(`a follow fact for account ${id}`);
    }
    return left;
}

function sign(rawBody) {
    return `sha256=${crypto.createHmac('sha256', SECRET).update(rawBody, 'utf8').digest('base64')}`;
}

/**
 * One delivery into the receiver.
 *
 * `body` is the exact string sent — either the JSON of a payload, or a mutated string for the
 * forgery case. The signature is always computed over `signedBody` (the JSON), so passing a
 * different `body` is precisely "signature does not cover these bytes".
 */
async function deliver(signedBody, { body = signedBody, signature = null } = {}) {
    // A delivery can write a follow fact, so the run has something to take back from here on — set
    // before the request, since a rejected forgery is only rejected on the server's side of it.
    wrote = true;
    const headers = { 'Content-Type': 'application/json' };
    if (signature !== null) headers['x-twitter-webhooks-signature'] = signature;
    else headers['x-twitter-webhooks-signature'] = sign(signedBody);
    const res = await fetch(`${BASE}/api/x/events`, { method: 'POST', headers, body });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* see api() */ }
    return { status: res.status, ok: res.ok, body: parsed };
}

/** The deprecated Account Activity envelope: a list of typed events. */
function listEnvelope({ id, username, verb, targetId = TARGET, forUser = TARGET }) {
    return {
        for_user_id: forUser,
        follow_events: [{
            type: verb,
            created_at: new Date().toISOString(),
            source: { id, screen_name: username },
            target: { id: targetId },
        }],
    };
}

/** The current X Activity envelope: one event with a dotted name. */
function eventEnvelope({ id, username, verb, targetId = TARGET, filterUser = TARGET }) {
    return {
        data: {
            event_type: verb === 'follow' ? 'follow.follow' : 'follow.unfollow',
            filter: { user_id: filterUser },
            tag: 'points-follow',
            payload: {
                created_at: new Date().toISOString(),
                follower: { id, username },
                followed: { id: targetId },
            },
        },
    };
}

const pointsOf = (state) => (state && typeof state.points === 'number' ? state.points : null);
const recordOf = (state, id = 'follow') => (state?.oneTime || []).find((task) => task.id === id) || null;

/* ------------------------------------------------------------------------------- the checks */

(async () => {
    console.log('');
    console.log(`Follow gate — ${BASE}`);

    // The store module itself, so this run can put back what it takes: this file is CommonJS and the
    // store is an ES module, so it is a dynamic import. The driver it reports is read from *this*
    // process's environment, and that is the basis of the guard below.
    Store = await import('../lib/points-store.js');

    // The secret is only needed to *sign deliveries*, which is a webhook-mode scenario — so it is
    // demanded below, once the mode is known, rather than here where a `claim` deployment would be
    // asked for something it has no use for.

    // The store file is only ours to move when the server is on this machine. Taken before the first
    // write, restored in the `finally` below, so a rerun starts from the same place it began.
    if (LOOPBACK && fs.existsSync(STORE_FILE)) snapshot = fs.readFileSync(STORE_FILE);

    const first = await signIn();
    const opening = await first.state();
    const mode = opening?.followProof?.mode;

    console.log('');
    console.log(`  mode: ${mode}${TARGET ? `   our account id: ${TARGET}` : '   (X_FOLLOW_TARGET_ID not passed)'}`);
    rec(`the server publishes its follow-proof mode (${mode})`, mode === 'webhook' || mode === 'claim');

    if (READ_ONLY) {
        console.log('');
        console.log('  --read-only: stopping before anything is bound or paid.');
        note(`the card on /points is written from this mode, so it ${mode === 'webhook' ? 'says the follow is checked' : 'says the follow is taken on the player\u2019s word'}.`);
        return;
    }

    /* ------------------------------------------------------- can this run put the store back?
     * Everything below writes to the **server's** store, and a harness that cannot reach that same
     * store afterwards cannot undo itself. That is not a hypothetical: pointed at the live domain from
     * a shell without the KV credentials, this file leaves a real pending claim and a real binding
     * behind, and on a Redis store there is no file to restore.
     *
     * So the rule is a comparison rather than a promise: the driver the *server* reports has to be the
     * driver *this process* would use. If they differ, this is not a store it can clean, and it does
     * not write. `--read-only` asks the same question without writing anything.
     */
    const serverDriver = opening?.storage?.driver || null;
    const localDriver = Store.STORAGE_DRIVER;
    rec(`this shell reaches the store the server uses (${serverDriver || 'unreported'})`,
        serverDriver !== null && serverDriver === localDriver,
        `server ${serverDriver || 'unknown'} · this process ${localDriver}`);

    if (serverDriver !== localDriver) {
        console.log('');
        console.log(`  Stopping before any write: the server is on the "${serverDriver || 'unknown'}" store and`);
        console.log(`  this process would use "${localDriver}", so nothing here could take its test wallets back out.`);
        console.log('');
        console.log('  Point this process at the deployment\u2019s store first — for production:');
        console.log('    npx vercel env pull <file> --environment=production --yes --scope meglast320-1694');
        console.log(`    node --env-file=<file> tools/check-follow-gate.js ${BASE} --against-live`);
        console.log('  …or add --read-only, which asks the same question and writes nothing.');
        process.exitCode = 1;
        return;
    }

    /* ---------------------------------------------------------- when the gate is off: the review
     * `claim` is not a broken `webhook` — it is the honest default for a deployment with no consumer
     * secret, where nothing can tell a forgery from a delivery. A claim is therefore *recorded*
     * rather than paid: it waits out a window, and what the window is for is a claim that can still
     * be turned down before it pays.
     *
     * This branch writes to the store, so a deployment somebody else is using is off limits unless
     * it is asked for in so many words — the point of a harness is to be safe to run.
     */
    if (mode !== 'webhook' && !LOOPBACK && !args.includes('--against-live')) {
        console.log('');
        console.log('  The gate is off here, and this branch claims a reward — which is a write to a store');
        console.log('  that is not on this machine. Stopping. Pass --against-live to do it anyway; the run');
        console.log('  then removes every wallet it created, and fails a check if it cannot.');
        return;
    }

    if (mode !== 'webhook') {
        console.log('');
        console.log('  The gate is OFF on this deployment, so the refusal cannot be exercised here.');
        console.log('  A server in webhook mode needs: X_CONSUMER_SECRET + FOLLOW_PROOF_MODE=webhook.');

        const claimant = await signIn();
        rec('a binding succeeds without a Privy proof', (await bindX(claimant, handle())).ok);

        const claimed = await claimant.claim();
        const windowView = recordOf(claimed.body?.state);
        rec('the claim is recorded rather than paid, and given a window',
            claimed.ok && claimed.body?.credited === 0 && windowView?.pending === true,
            `HTTP ${claimed.status} credited ${claimed.body?.credited} pending ${windowView?.pending}`);
        rec('  … and the balance is untouched while it waits',
            pointsOf(claimed.body?.state) === 0, `points ${pointsOf(claimed.body?.state)}`);

        const declared = windowView?.reviewWindow;
        const minutes = windowView?.settleAt ? Math.round((Date.parse(windowView.settleAt) - Date.now()) / 60_000) : null;
        rec('  … and the deadline is inside the window the task declares',
            declared && minutes !== null
            && minutes >= declared.minMinutes - 1 && minutes <= declared.maxMinutes + 1,
            `${minutes} min of ${declared?.minMinutes}\u2013${declared?.maxMinutes}`);

        const againClaim = await claimant.claim();
        rec('a second claim repeats that deadline and pays nothing',
            againClaim.body?.pending === true
            && recordOf(againClaim.body?.state)?.settleAt === windowView?.settleAt
            && againClaim.body?.credited === 0,
            `HTTP ${againClaim.status} pending ${againClaim.body?.pending}`);

        // Closing the window by hand: the wait is real, but forty minutes is not something a harness
        // can spend, and the file driver re-reads on every request so a rewritten record is a closing
        // window as far as the server is concerned. Only reachable on loopback with the file store.
        let closed = false;
        if (LOOPBACK && fs.existsSync(STORE_FILE)) {
            const db = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
            // Lower-case: the store keys wallets by the normalised address, and a wallet from
            // `ethers` comes back checksummed.
            const record = db.wallets?.[claimant.address.toLowerCase()]?.tasks?.['one:follow'];
            if (record) {
                record.settleAfter = new Date(Date.now() - 60_000).toISOString();
                fs.writeFileSync(STORE_FILE, JSON.stringify(db, null, 2));
                closed = true;
            }
        }

        if (!closed) {
            console.log('  .     window not closed by hand — the store is not the local file, so the');
            console.log('        claim stays pending. That is the honest half of this branch.');
            return;
        }

        const settled = await claimant.claim();
        rec('closing the window pays it exactly once',
            settled.ok && settled.body?.credited === 500,
            `HTTP ${settled.status} credited ${settled.body?.credited} points ${pointsOf(settled.body?.state)}`);
        const settledView = recordOf(settled.body?.state);
        rec('  … and the card reads as reviewed, never as checked by X',
            settledView?.claimed === true && settledView?.claimedProof === 'claim'
            && /credited after review/.test(settledView?.claimedNote || '')
            && !/own follow record/.test(settledView?.claimedNote || ''),
            settledView?.claimedNote);

        const afterSettle = await claimant.claim();
        rec('  … and a further claim pays nothing',
            afterSettle.body?.credited === 0 && pointsOf(afterSettle.body?.state) === 500,
            `credited ${afterSettle.body?.credited}, points ${pointsOf(afterSettle.body?.state)}`);
        return;
    }

    if (!SECRET) {
        console.error('');
        console.error('X_CONSUMER_SECRET must be set here — the scenarios below sign their own deliveries');
        console.error('with it, and it has to be the same value the server verifies them with.');
        process.exit(1);
    }

    /* ------------------------------------------------------- scenario A: the follower, end to end
     * The whole point of the gate: refused while X has said nothing, paid once X has, and the refusal
     * must not have consumed the once-only guard — otherwise a player who clicks early is locked out
     * for the guard's TTL and punished for our own timing.
     */
    console.log('');
    console.log('  scenario A — a follower');
    const follower = await signIn();
    const followerHandle = handle();
    const followedId = String(BigInt(`0x${crypto.randomBytes(6).toString('hex')}`));
    follower.record.ids.push(followedId);

    rec('binding succeeds before any follow is known', (await bindX(follower, followerHandle)).ok);

    const beforeFact = await follower.claim();
    rec('the claim is REFUSED while X has said nothing',
        beforeFact.status === 400 && beforeFact.body?.code === 'follow-required',
        `HTTP ${beforeFact.status} ${beforeFact.body?.code || ''}`);
    rec('and nothing was paid for it', pointsOf(beforeFact.body?.state) === 0, `points ${pointsOf(beforeFact.body?.state)}`);
    rec('and no claim was recorded — the refusal did not spend the once-only guard',
        recordOf(beforeFact.body?.state)?.claimed !== true);

    const delivered = await deliver(JSON.stringify(eventEnvelope({ id: followedId, username: followerHandle, verb: 'follow' })));
    rec('a signed follow event is accepted and recorded',
        delivered.ok && delivered.body?.recorded === 1,
        `HTTP ${delivered.status} recorded ${delivered.body?.recorded}`);

    const afterFact = await follower.claim();
    rec('the claim is PAID once X\u2019s own record says so',
        afterFact.ok && afterFact.body?.credited === 500,
        `HTTP ${afterFact.status} credited ${afterFact.body?.credited}`);
    rec('the record says it was checked, and when the follow happened',
        recordOf(afterFact.body?.state)?.claimedProof === 'webhook'
        && recordOf(afterFact.body?.state)?.claimedNote === 'checked against X\u2019s own follow record');

    const followerAgain = await follower.claim();
    rec('and a second claim pays nothing', followerAgain.body?.credited === 0, `credited ${followerAgain.body?.credited}`);
    rec('the balance is 500', pointsOf(followerAgain.body?.state) === 500, `points ${pointsOf(followerAgain.body?.state)}`);

    /* ------------------------------------------------------ scenario B: the latest fact is the one
     * An unfollow has to be able to take the reward away again for anybody who has not claimed yet.
     * This is the half a "does A follow B" poll could never express, and the reason a *fact* is stored
     * rather than a boolean set once.
     */
    console.log('');
    console.log('  scenario B — followed, then unfollowed (the deprecated envelope, which is also read)');
    const leaver = await signIn();
    const leaverHandle = handle('dngleft');
    const leaverId = String(BigInt(`0x${crypto.randomBytes(6).toString('hex')}`));
    leaver.record.ids.push(leaverId);

    await bindX(leaver, leaverHandle);
    await deliver(JSON.stringify(listEnvelope({ id: leaverId, username: leaverHandle, verb: 'follow' })));
    const unfollowed = await deliver(JSON.stringify(listEnvelope({ id: leaverId, username: leaverHandle, verb: 'unfollow' })));
    rec('a signed unfollow is recorded too', unfollowed.ok && unfollowed.body?.recorded === 1,
        `HTTP ${unfollowed.status} recorded ${unfollowed.body?.recorded}`);

    const leftClaim = await leaver.claim();
    rec('and the claim is refused again — the latest fact is what counts',
        leftClaim.status === 400 && leftClaim.body?.code === 'follow-required',
        `HTTP ${leftClaim.status} ${leftClaim.body?.code || ''}`);

    /* --------------------------------------------------------- scenario C: a forged delivery pays 0
     * The signature is over the bytes, so the check that matters is that those bytes are the ones we
     * read. Two ways to get it wrong: no signature at all, and a signature that covered a different
     * body than the one delivered.
     */
    console.log('');
    console.log('  scenario C — a delivery we did not sign');
    const forger = await signIn();
    const forgerHandle = handle('dngfake');
    const forgerId = String(BigInt(`0x${crypto.randomBytes(6).toString('hex')}`));
    forger.record.ids.push(forgerId);
    const honest = JSON.stringify(eventEnvelope({ id: forgerId, username: forgerHandle, verb: 'follow' }));
    const swapped = JSON.stringify(eventEnvelope({ id: forgerId, username: forgerHandle, verb: 'follow', targetId: '1' }));

    await bindX(forger, forgerHandle);

    const unsigned = await deliver(honest, { signature: '' });
    rec('an unsigned delivery is refused', unsigned.status === 401, `HTTP ${unsigned.status}`);

    const tampered = await deliver(honest, { body: swapped });
    rec('a delivery whose body changed after signing is refused', tampered.status === 401, `HTTP ${tampered.status}`);

    const forgedClaim = await forger.claim();
    rec('and a forged delivery buys no points', forgedClaim.status === 400 && forgedClaim.body?.code === 'follow-required',
        `HTTP ${forgedClaim.status} ${forgedClaim.body?.code || ''}`);

    /* ------------------------------------------------- scenario D: shapes we do not understand
     * Every accepted delivery is billable and X retries anything that is not a 2xx, so an unknown
     * shape must cost one log line — not a retry storm. Signed, therefore ours: 200, recorded 0.
     */
    const unknown = await deliver(JSON.stringify({ data: { event_type: 'tweet.create', payload: {} } }));
    rec('a signed delivery of an event we have no rule for is accepted with nothing recorded',
        unknown.ok && unknown.body?.recorded === 0,
        `HTTP ${unknown.status} recorded ${unknown.body?.recorded}`);

    /* ------------------------------------------------------------- the direction, when we can see it
     * `follow.follow` fires for both directions. With our own account id known, an event where **we**
     * did the following must not be read as somebody following us.
     */
    if (TARGET) {
        const otherId = String(BigInt(`0x${crypto.randomBytes(6).toString('hex')}`));
        // `TARGET` is deliberately **not** registered with any wallet's cleanup identities: it is our
        // own account, and a cleanup that could ever delete a fact about it would be telling real
        // followers they are not following.
        const outward = await deliver(JSON.stringify(eventEnvelope({
            id: TARGET, username: 'DNGrobinhood', verb: 'follow', targetId: otherId, filterUser: TARGET,
        })));
        rec('an event where WE followed somebody is not somebody following us',
            outward.ok && outward.body?.recorded === 0,
            `HTTP ${outward.status} recorded ${outward.body?.recorded}`);
    } else {
        console.log('  .     direction check skipped — pass X_FOLLOW_TARGET_ID (or --target) to exercise it');
    }
})()
    .catch((error) => {
        console.log('');
        console.error(`harness stopped: ${error.message || error}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        /* ------------------------------------------------------------- leave the store as it was
         * The local file is restored whole where there is one — the strongest undo, and it needs no
         * credentials. Otherwise every wallet this run created is taken back out of the server's
         * store by address, and then **read for** again through the store's own API: a cleanup that
         * quietly did nothing has to fail a check, or the next person finds a test claim in the
         * review queue and has no idea it is ours.
         */
        let cleanupError = null;
        let guardsRemoved = null;   // null where the local file was put back instead of purging
        // Whatever the purge could not get rid of, measured by asking the store again rather than by
        // trusting what the purge said it removed.
        const stillNamed = [];
        try {
            if (!wrote) {
                // Nothing was written, so there is nothing to undo — and saying so is worth a line,
                // because "it cleaned up" and "it never touched anything" look identical otherwise.
                if (created.length) note('nothing was written, so nothing needed removing');
            } else if (snapshot) {
                fs.writeFileSync(STORE_FILE, snapshot);
                note(`restored ${path.relative(process.cwd(), STORE_FILE)} (this run's wallets are gone)`);
            } else if (Store) {
                guardsRemoved = 0;
                for (const wallet of created) {
                    const summary = await Store.purgeWallet(wallet.address, { ids: wallet.ids, handles: wallet.handles });
                    guardsRemoved += summary.removed.filter((label) => label.includes(':guard:')).length;
                    stillNamed.push(...summary.survived);
                    // `removed` is every label that named the wallet, so the two member sets are
                    // counted out of the total rather than alongside it.
                    const plainKeys = summary.removed.length - summary.pending.length - (summary.board ? 1 : 0);
                    note(`purged ${wallet.address} from the ${summary.driver} store — ${plainKeys} key(s), `
                        + `${summary.pending.length} queue member(s), ${summary.facts.length} follow fact(s)`
                        + `${summary.board ? ', and its board entry' : ''}`
                        + `${summary.survived.length ? ` — BUT ${summary.survived.length} SURVIVED` : ''}`);
                }
            }
        } catch (error) {
            cleanupError = error.message || String(error);
        }

        if (wrote && created.length) {
            if (cleanupError !== null) {
                rec('the run cleaned up after itself', false, cleanupError);
            } else {
                // Two lenses, because they fail differently: the purge's own read-back catches a
                // deletion that did not happen (a no-op DEL, a renamed key it never matched), and the
                // store's public reads catch a record that is still answering questions even though
                // every key it was filed under is gone.
                const residue = stillNamed.slice();
                try {
                    for (const wallet of created) residue.push(...await residueOf(wallet));
                } catch (error) {
                    residue.push(`the store could not be re-read (${error.message || error})`);
                }
                rec(`${created.length} wallet(s) this run created: nothing of them is left in the store`,
                    residue.length === 0,
                    residue.length ? residue.join('; ')
                        : 'no key names it, no record, no binding, no follow fact, not queued, not on the board');
            }
        }

        // The guard slot is the one thing the read-back above cannot see, so it is asserted from what
        // the purge removed — which fails if the key layout moves out from under its scan.
        //
        // Only on the redis driver, though: on `file` and `memory` the guard is a slot in the *server's*
        // own process (`memoryGuards`), not a key in the store, so there is nothing for a store purge to
        // find and no assertion to make. Claiming one there would fail for being right — measured: the
        // first version of this check reported "the guard scan matched nothing" on a clean file run.
        if (guardsRemoved !== null && claimMade) {
            if (Store.STORAGE_DRIVER === 'redis') {
                rec('  … and the once-only guard slot the claim took',
                    guardsRemoved > 0,
                    guardsRemoved ? `${guardsRemoved} guard key(s) removed`
                        : 'the guard scan matched nothing — the key layout and the cleanup have drifted apart');
            } else {
                note(`the guard slot is held in the server's process on the ${Store.STORAGE_DRIVER} driver — no key to remove`);
            }
        }

        const failed = results.filter((r) => !r.pass);
        console.log('');
        if (!results.length) {
            console.log('nothing was checked');
            process.exitCode = 1;
            return;
        }
        console.log(`${results.length - failed.length}/${results.length} checks passed`);
        if (failed.length) {
            process.exitCode = 1;
            for (const f of failed) console.log(`  FAIL  ${f.label}`);
        }
    });
