#!/usr/bin/env node
/**
 * Does the Points Program pay only for points that were earned?
 *
 *     node tools/check-points-x.js
 *
 * Points are a liability, and the two things this file is about are the two ways to hand one out
 * for nothing: paying a wallet that never bound an X account, and paying a share on the strength of
 * the client saying it shared. Both are now decided server-side against a post that exists, so
 * both are testable — and the whole harness runs **in this process**, against a stubbed X and a
 * stubbed Privy, in a throwaway working directory. No network, no key, no rate limit, nothing to
 * clean up afterwards.
 *
 * The stub is not a convenience: it is how the awkward answers become testable at all. X returning
 * 404 for a post it has not indexed yet, Privy answering with a bare token but no X link, a post
 * that exists and is written by somebody else — every one of those arrives as a real response here
 * rather than as a comment claiming it is handled.
 *
 * The Privy half uses **real crypto**: a P-256 keypair generated here, published as this app's
 * JWKS, and tokens signed with it. So the signature check is genuinely exercised — including the
 * two failures that matter, a payload edited after signing and an `alg` that asks for a symmetric
 * check against a public key (the classic JWT confusion bug).
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

const CAMPAIGN = 'https://x.com/dungeonknights/status/1900000000000000001';

// ------------------------------------------------------------------ the sandbox, before imports
// The store picks its driver and its file path when the module graph loads, so both have to be
// settled first: this process is about to run with its own `.data/points.json` in a temp directory.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-points-x-'));
process.chdir(sandbox);
process.env.POINTS_SESSION_SECRET = 'check-points-x';
process.env.PRIVY_APP_ID = 'cmu9rk7lo034q0cl24jlo2mr7';
process.env.X_CAMPAIGN_POST = CAMPAIGN;
for (const key of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
    delete process.env[key];
}

// ----------------------------------------------------------------------------- the stubs
const APP_ID = process.env.PRIVY_APP_ID;
const PRIVY = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const KID = 'harness-key-1';
const JWK = { ...PRIVY.publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'ES256' };

function b64url(value) {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** A real ES256 signature over the real signing input — the JWS form, raw r‖s. */
function signToken(claims, { kid = KID, alg = 'ES256' } = {}) {
    const input = `${b64url({ alg, typ: 'JWT', kid })}.${b64url(claims)}`;
    const signature = crypto.sign('sha256', Buffer.from(input), {
        key: PRIVY.privateKey,
        dsaEncoding: 'ieee-p1363',
    });
    return `${input}.${signature.toString('base64url')}`;
}

function privyClaims(overrides = {}) {
    const now = Math.floor(Date.now() / 1000);
    return { iss: 'privy.io', aud: APP_ID, sub: 'did:privy:harness', sid: 'sess-1', iat: now, exp: now + 3600, ...overrides };
}

const stub = {
    oembed: 0,
    usersMe: 0,
    jwks: 0,
    /** What the oEmbed endpoint answers next: a response, a 404, or a 500. */
    x: { kind: 'ok', author: 'alice', text: null },
    /** What `GET /users/me` answers, and what the player's Privy user has linked. */
    privy: { status: 200, body: { id: 'did:privy:harness', linked_accounts: [{ type: 'twitter', subject: '4242', username: 'AliceW' }] } },
};

function jsonResponse(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function embedFor(url, postId) {
    const author = stub.x.author;
    const text = stub.x.text !== null ? stub.x.text : `Vault cleared, 900 points banked — https://${global.__SITE_HOST__}`;
    return {
        url: `https://twitter.com/${author}/status/${postId}`,
        author_name: author,
        author_url: `https://twitter.com/${author}`,
        html: `<blockquote class="twitter-tweet"><p lang="en">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`
            + `&mdash; ${author} (@${author}) <a href="https://twitter.com/${author}/status/${postId}">September 21, 2026</a></blockquote>`,
    };
}

let networkCalls = 0;
globalThis.fetch = async (url, options = {}) => {
    networkCalls += 1;
    const target = String(url);
    const asked = options?.headers?.authorization ? String(options.headers.authorization) : '';

    if (target.startsWith('https://publish.twitter.com/oembed')) {
        stub.oembed += 1;
        if (stub.x.kind === '404') return jsonResponse(404, { error: 'not found' });
        if (stub.x.kind === '500') return jsonResponse(500, { error: 'boom' });
        const postId = new URL(target).searchParams.get('url').match(/status\/(\d+)/)?.[1];
        return jsonResponse(200, embedFor(target, postId));
    }
    if (target.includes('/jwks.json')) {
        stub.jwks += 1;
        return jsonResponse(200, { keys: [JWK] });
    }
    if (target.endsWith('/api/v1/users/me') && asked) {
        stub.usersMe += 1;
        return jsonResponse(stub.privy.status, stub.privy.status === 200 ? stub.privy.body : { error: 'unauthorised' });
    }
    throw new Error(`the harness must not reach the network: ${target}`);
};

(async () => {
    console.log('');
    console.log('Points Program — earning on X');

    const Config = await import('../lib/points-config.js');
    const Store = await import('../lib/points-store.js');
    const Program = await import('../lib/points-program.js');
    const Privy = await import('../lib/privy-verify.js');
    global.__SITE_HOST__ = Config.SITE_LINK_HOST;

    const fresh = () => `0x${crypto.randomBytes(20).toString('hex')}`;
    const points = async (address) => (await Store.getWallet(address))?.points || 0;
    const stateOf = (address) => Program.stateFor(address);
    const tasksOf = async (address) => (await stateOf(address)).tasks;
    // The throttle's own key, built the way the program builds it — an address, the task, the post.
    const submitGuard = (address, taskId, url) =>
        `submit:${address}:${taskId}:${url.match(/status\/(\d+)/)[1]}`;
    const campaignId = Config.campaignTaskId();
    const today = Config.todayKey();
    const yesterday = Config.todayKey(new Date(Date.now() - 86400000));

    // ------------------------------------------------------------------------- the gate
    console.log('');
    console.log('The earning gate');

    const gate = fresh();
    const refused = await Program.clearLevel(gate, 0);
    rec('a wallet with no X account cannot clear a floor for points',
        refused.code === Program.X_REQUIRED, `${refused.code}: ${refused.error}`);
    rec('and it was paid nothing', (await points(gate)) === 0, `${await points(gate)} PTS`);

    const bad = await Program.bindX(gate, { username: 'not a handle' });
    rec('a binding needs a usable handle', bad.code === 'bad-identity', bad.error);

    // Without Privy there is no account id to key on, so the handle is the key. That is what keeps
    // "one name, one wallet" true for a player whose Privy app has Twitter switched off.
    const typed = fresh();
    const handleOnly = await Program.bindX(typed, { username: '@Carol' });
    rec('a binding with only a handle still binds',
        handleOnly.ok === true && handleOnly.x.id === 'handle:carol', handleOnly.x?.id);
    rec('  … and it is provisional', handleOnly.x.verified === false, '');
    const secondCarol = await Program.bindX(fresh(), { username: 'carol' });
    rec('  … and a second wallet cannot take the name either', secondCarol.code === 'x-taken', secondCarol.error);

    const unprovedId = await Program.bindX(fresh(), { username: 'carol' }, { verified: true });
    rec('a proved binding must carry the account id it proves',
        unprovedId.code === 'bad-identity', unprovedId.code);

    const prover = fresh();
    const provedCarol = await Program.bindX(prover, { id: '7000', username: 'carol' }, { verified: true });
    rec('a proved binding takes the name off the provisional holder',
        provedCarol.ok === true && (await Store.getWallet(typed)).x === null, '');

    const bound = await Program.bindX(gate, { id: '4242', username: '@Alice' });
    rec('binding records the handle lowercased', bound.ok === true && bound.x.username === 'alice', bound.x?.username);
    rec('an unproved binding says so', bound.x.verified === false, `verified=${bound.x.verified}`);
    rec('and the state exposes it as earnable-but-unproved',
        (await stateOf(gate)).canEarn === true && (await stateOf(gate)).x.verified === false, '');

    const claim = await Program.clearLevel(gate, 0);
    rec('once bound, floor 1 pays', claim.credited === 100, `${claim.credited} PTS`);
    const again = await Program.clearLevel(gate, 0);
    rec('and pays only once', again.credited === 0 && again.alreadyCleared === true, `${again.credited} PTS`);
    rec('floors still have to be cleared in order',
        (await Program.clearLevel(gate, 2)).error?.includes('floor 2') === true, (await Program.clearLevel(gate, 2)).error);

    // ------------------------------------------------------------ one account, one wallet
    console.log('');
    console.log('One X account, one wallet');

    const thief = fresh();
    const stolen = await Program.bindX(thief, { id: '4242', username: 'alice' });
    rec('a second wallet cannot bind the same account',
        stolen.code === 'x-taken' && stolen.owner.includes('…'), stolen.error);
    rec('and the first wallet still holds it', (await Store.getWallet(gate)).x.id === '4242', 'still bound');

    // The hand-off. A *proved* binding beats a provisional one, which is the only direction it can
    // go: two proved bindings for one account would mean two Privy users claiming one X account,
    // and Privy does not allow that — so whoever proved it is the one who really holds it.
    const taker = fresh();
    const proved = await Program.bindX(taker, { id: '4242', username: 'alice' }, { verified: true });
    rec('a proved binding takes over a provisional one', proved.ok === true, `ok=${proved.ok}`);
    rec('and the wallet it was taken from is left unbound', (await Store.getWallet(gate)).x === null, 'x=null');
    rec('so its earning stops', (await Program.clearLevel(gate, 0)).code === Program.X_REQUIRED, 'refused');
    const twoProved = await Program.bindX(fresh(), { id: '4242', username: 'alice' }, { verified: true });
    rec('but two proved bindings cannot both hold it', twoProved.code === 'x-taken', twoProved.error);

    // The wallet the rest of this file uses gets a *different* account id, which is what a player
    // whose handle was taken over would have to do too. The handle is deliberately the same: the
    // handle is not the key, the account id is.
    const rebound = await Program.bindX(gate, { id: '4243', username: 'alice' });
    rec('a wallet can bind a different account with the same handle', rebound.ok === true, `ok=${rebound.ok}`);
    rec('  … and is earnable again', (await stateOf(gate)).canEarn === true, '');

    // ------------------------------------------------------------------------ the share
    console.log('');
    console.log('The daily share, verified');

    const beforeShare = await points(gate);
    const nothing = await Program.submitTask(gate, 'share', '');
    rec('a share with no link is refused', nothing.code === 'missing', `${nothing.code}: ${nothing.error}`);

    stub.x.author = 'someoneelse';
    const wrongAuthor = await Program.submitTask(gate, 'share', CAMPAIGN);
    rec('a post written by somebody else never pays', wrongAuthor.credited === 0, `${wrongAuthor.credited} PTS`);
    rec('  … and the state says whose post it was',
        (await tasksOf(gate)).share.state === 'failed'
        && (await tasksOf(gate)).share.reason.includes('someoneelse'),
        (await tasksOf(gate)).share.reason);
    rec('  … and no points moved', (await points(gate)) === beforeShare, `${await points(gate)} PTS`);

    stub.x.author = 'alice';
    stub.x.text = 'a post with no link in it at all';
    const noLink = await Program.submitTask(gate, 'share', anotherPost());
    rec('a post without our link never pays',
        noLink.credited === 0 && (await tasksOf(gate)).share.state === 'failed',
        (await tasksOf(gate)).share.reason);

    // The throttle is what makes "check again" honest rather than free: the same link cannot be
    // re-checked on demand. The rest of this section moves past it the way a minute would.
    const againSoon = await Program.submitTask(gate, 'share', CAMPAIGN);
    rec('the same link cannot be re-checked on demand',
        againSoon.code === 'throttled' && againSoon.retryInSeconds > 0, `retry in ${againSoon.retryInSeconds}s`);
    await Store.releaseGuard(submitGuard(gate, Config.shareTaskId(), CAMPAIGN));

    stub.x.text = null;
    const good = await Program.submitTask(gate, 'share', CAMPAIGN);
    rec('a post by the bound handle that carries our link doubles the run',
        good.credited === 100, `credited ${good.credited} (floor 1 = 100)`);
    rec('  … and the doubling is exactly that, no more',
        (await points(gate)) === beforeShare + 100, `${await points(gate)} PTS`);
    rec('  … and only for that day',
        (await stateOf(gate)).sharedToday === true, `sharedToday=${(await stateOf(gate)).sharedToday}`);

    const twice = await Program.submitTask(gate, 'share', 'https://x.com/alice/status/1900000000000000002');
    rec('a second share the same day does not pay again',
        twice.credited === 0 && twice.alreadyCredited === true, `credited ${twice.credited}`);
    rec('  … and the balance is untouched', (await points(gate)) === beforeShare + 100, `${await points(gate)} PTS`);

    // ----------------------------------------------------------------- pending, then paid
    console.log('');
    console.log('A post X has not indexed yet');

    const patient = fresh();
    await Program.bindX(patient, { id: '777', username: 'alice' });
    await Program.clearLevel(patient, 0);
    const patientBefore = await points(patient);

    stub.x.kind = '404';
    const pending = await Program.submitTask(patient, 'share', 'https://x.com/alice/status/1900000000000000003');
    rec('a post X cannot see yet is remembered as pending, not paid',
        pending.credited === 0 && pending.pending === true, `pending=${pending.pending}`);
    rec('  … and nothing is paid while it is pending', (await points(patient)) === patientBefore, `${await points(patient)} PTS`);
    rec('  … and the page is told it can ask again',
        (await tasksOf(patient)).share.state === 'pending'
        && (await tasksOf(patient)).share.canCheck === true, '');

    const tooSoon = await Program.checkTask(patient, 'share');
    rec('asking again immediately is rate-limited, not ignored',
        tooSoon.code === 'throttled' && tooSoon.retryInSeconds > 0, `retry in ${tooSoon.retryInSeconds}s`);

    // A check a minute later: the same record, with the clock moved past the gap.
    await Store.updateWallet(patient, (w) => {
        w.tasks.share.lastCheckedAt = new Date(Date.now() - 61_000).toISOString();
        return w;
    });
    stub.x.kind = 'ok';
    const settled = await Program.checkTask(patient, 'share');
    rec('once X can see it, the pending share pays', settled.credited === 100, `${settled.credited} PTS`);
    rec('  … and the task reads as verified', (await tasksOf(patient)).share.state === 'verified', '');
    rec('  … and only once: a further check pays nothing',
        (await Program.checkTask(patient, 'share')).credited === 0, '');

    // A failed post is a real answer from X, and it is never re-asked.
    await Store.updateWallet(patient, (w) => {
        w.tasks = {
            ...w.tasks,
            [campaignId]: {
                state: 'failed',
                url: 'https://x.com/alice/status/1900000000000000004',
                day: today,
                attempts: 1,
                credited: 0,
                reason: 'That post was written by @someoneelse.',
            },
        };
        return w;
    });
    const asksBefore = stub.oembed;
    const stillFailed = await Program.checkTask(patient, 'campaign');
    rec('a failed post is not re-checked',
        stillFailed.code === 'failed' && stub.oembed === asksBefore, `oembed calls unchanged (${stub.oembed})`);

    // ------------------------------------------------------------- the attempt ceiling
    console.log('');
    console.log('When X never answers');

    const silent = fresh();
    await Program.bindX(silent, { id: '888', username: 'alice' });
    await Store.updateWallet(silent, (w) => {
        w.tasks = {
            [campaignId]: {
                state: 'pending', url: CAMPAIGN, day: today, credited: 0,
                attempts: Config.X_VERIFY_MAX_ATTEMPTS,
                submittedAt: new Date(Date.now() - 600_000).toISOString(),
                lastCheckedAt: new Date(Date.now() - 600_000).toISOString(),
            },
        };
        return w;
    });
    const exhausted = await Program.checkTask(silent, 'campaign');
    rec('the attempt ceiling stops asking X', exhausted.code === 'attempts-exhausted', exhausted.code);
    rec('  … and the page shows it as expired, never paid',
        (await tasksOf(silent)).campaign.state === 'expired', (await tasksOf(silent)).campaign.state);
    rec('  … and nothing was credited', (await points(silent)) === 0, `${await points(silent)} PTS`);

    // ---------------------------------------------------------------- the day that ended
    console.log('');
    console.log('A share whose day ended first');

    await Store.updateWallet(patient, (w) => {
        w.tasks.share = {
            ...w.tasks.share,
            state: 'pending',
            day: yesterday,
            credited: 0,
            attempts: 1,
            lastCheckedAt: new Date(Date.now() - 600_000).toISOString(),
        };
        // Today's own floors, so nothing else in the config can be what refuses it.
        w.levelsCleared = { [today]: [0] };
        return w;
    });
    const patientPoints = await points(patient);
    const asksBeforeDay = stub.oembed;
    const dayOver = await Program.checkTask(patient, 'share');
    rec('yesterday\'s pending share is expired, not paid',
        dayOver.code === 'day-over' && dayOver.credited === 0, `${dayOver.code}: ${dayOver.error}`);
    rec('  … without asking X about a run that is over', stub.oembed === asksBeforeDay, 'no oembed call');
    rec('  … and today\'s share task is back to unsubmitted',
        (await tasksOf(patient)).share.state === 'none', (await tasksOf(patient)).share.state);
    rec('  … and nothing was credited', (await points(patient)) === patientPoints, `${await points(patient)} PTS`);

    // -------------------------------------------------------------------- the campaign
    console.log('');
    console.log('The campaign reward');

    const player = fresh();
    await Program.bindX(player, { id: '999', username: 'alice' });
    const campaignTask = (await tasksOf(player)).campaign;
    rec('the campaign is published with its reward',
        campaignTask.id === campaignId && campaignTask.reward === Config.X_ENGAGEMENT_REWARD,
        `${campaignTask.id} → ${campaignTask.reward} PTS`);
    rec('  … and it starts unsubmitted', campaignTask.state === 'none', campaignTask.state);

    stub.x.author = 'alice';
    stub.x.text = null;
    const engaged = await Program.submitTask(player, 'campaign', CAMPAIGN);
    rec('an engagement post by the bound handle pays once',
        engaged.credited === Config.X_ENGAGEMENT_REWARD, `${engaged.credited} PTS`);
    rec('  … and a second one does not pay again',
        (await Program.submitTask(player, 'campaign', 'https://x.com/alice/status/1900000000000000005')).credited === 0, '0 PTS');

    // ------------------------------------------------------------- concurrency
    console.log('');
    console.log('Two taps at once');

    stub.x.author = 'alice';
    const racer = fresh();
    await Program.bindX(racer, { id: '1000', username: 'alice' });
    const raceUrl = 'https://x.com/alice/status/1900000000000000006';
    const [a, b] = await Promise.all([
        Program.submitTask(racer, 'campaign', raceUrl),
        Program.submitTask(racer, 'campaign', raceUrl),
    ]);
    const racePaid = (a.credited || 0) + (b.credited || 0);
    rec('the same link submitted twice pays exactly one reward',
        racePaid === Config.X_ENGAGEMENT_REWARD, `${racePaid} PTS between two requests`);
    rec('  … and the balance agrees', (await points(racer)) === Config.X_ENGAGEMENT_REWARD, `${await points(racer)} PTS`);

    // Two *different* links, same task, at the same moment. The submit throttle cannot be what
    // saves us here — different posts, different guards — so this is the one-credit guard's own
    // test, and it is the shape a player with two tabs open actually produces.
    const racer2 = fresh();
    await Program.bindX(racer2, { id: '1001', username: 'alice' });
    const [c, d] = await Promise.all([
        Program.submitTask(racer2, 'campaign', 'https://x.com/alice/status/1900000000000000008'),
        Program.submitTask(racer2, 'campaign', 'https://x.com/alice/status/1900000000000000009'),
    ]);
    const twoAtOnce = (c.credited || 0) + (d.credited || 0);
    rec('two different links racing for one reward pay it once',
        twoAtOnce === Config.X_ENGAGEMENT_REWARD, `${twoAtOnce} PTS between two requests`);
    rec('  … and the balance agrees again',
        (await points(racer2)) === Config.X_ENGAGEMENT_REWARD, `${await points(racer2)} PTS`);

    // ----------------------------------------------------------------------- Privy
    console.log('');
    console.log('Proving the link with Privy');

    Privy.resetPrivyKeyCache();
    const token = signToken(privyClaims());
    const verified = await Privy.verifyPrivyAccessToken(token);
    rec('a token Privy signed is accepted', verified.ok === true, verified.ok ? verified.userId : verified.code);

    const identity = await Privy.privyIdentityFromToken(token);
    rec('and its linked X account is read from Privy, not from the client',
        identity.ok === true && identity.twitter?.username === 'alicew' && identity.twitter?.id === '4242',
        JSON.stringify(identity.twitter || identity.code));

    const forged = signToken(privyClaims({ sub: 'did:privy:someone-else' }));
    const [h, p, s] = forged.split('.');
    const editedPayload = Buffer.from(JSON.stringify({ ...privyClaims(), sub: 'did:privy:attacker' })).toString('base64url');
    const edited = await Privy.verifyPrivyAccessToken(`${h}.${editedPayload}.${s}`);
    rec('editing the payload after signing breaks it',
        edited.ok === false && edited.code === 'bad-signature', edited.code);

    const confused = await Privy.verifyPrivyAccessToken(
        `${b64url({ alg: 'HS256', typ: 'JWT', kid: KID })}.${editedPayload}.${s}`,
    );
    rec('and a token that asks for a symmetric check is refused outright',
        confused.ok === false && confused.code === 'unexpected-alg', confused.code);
    rec('  … without fetching any key for it', stub.jwks === 1, `${stub.jwks} jwks fetch(es)`);

    const wrongApp = await Privy.verifyPrivyAccessToken(signToken(privyClaims({ aud: 'someone-elses-app' })));
    rec('a token minted for another Privy app is refused',
        wrongApp.ok === false && wrongApp.code === 'bad-audience', wrongApp.code);

    const expired = await Privy.verifyPrivyAccessToken(signToken(privyClaims({ exp: Math.floor(Date.now() / 1000) - 60 })));
    rec('an expired token is refused', expired.ok === false && expired.code === 'expired', expired.code);

    const unsigned = await Privy.verifyPrivyAccessToken('not.a.jwt');
    rec('and so is something that is not a JWT at all',
        unsigned.ok === false && unsigned.code === 'malformed-token', unsigned.code);

    rec('a Privy user with no X link reports no X link, not a failure',
        Privy.twitterFromUser({ linked_accounts: [{ type: 'email', address: 'a@b.c' }] }) === null, '');

    stub.privy = { status: 401, body: {} };
    const unreadable = await Privy.privyIdentityFromToken(token);
    rec('when Privy cannot be read, the answer is "unverified" — never a guess',
        unreadable.ok === false && unreadable.code === 'user-unreadable', unreadable.code);

    // ------------------------------------------------------------------- the last mile
    console.log('');
    console.log('The route layer');

    const Routes = {
        x: fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'points', 'x', 'route.js'), 'utf8'),
        task: fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'points', 'task', 'route.js'), 'utf8'),
        vault: fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'points', 'vault', 'route.js'), 'utf8'),
    };
    const AddressOf = (source) => /sessionFromRequest\(request\)/.test(source);
    rec('every earning route takes the wallet from the signed session',
        AddressOf(Routes.x) && AddressOf(Routes.task) && AddressOf(Routes.vault), '');
    rec('the vault share passes the post link through',
        /shareEntry\(address, body\?\.url/.test(Routes.vault), '');
    rec('the share is the same verified path as the campaign',
        /export async function shareEntry\(address, url\) \{\s*return submitTask\(address, 'share', url\);\s*\}/.test(
            fs.readFileSync(path.join(__dirname, '..', 'lib', 'points-program.js'), 'utf8'),
        ), '');

    // ------------------------------------------- with no campaign configured, it hides
    // A child process, because this module reads the environment once at import time — the only
    // honest way to ask "what does this deployment do with no campaign configured?" is to ask a
    // process that was actually started without one.
    const configUrl = pathToFileURL(path.join(__dirname, '..', 'lib', 'points-config.js')).href;
    const hidden = execFileSync(process.execPath, ['--input-type=module', '-e', `
        const c = await import(${JSON.stringify(configUrl)});
        console.log(JSON.stringify({ id: c.campaignTaskId(), configured: c.X_CAMPAIGN_POST }));
    `], { env: { ...process.env, X_CAMPAIGN_POST: '' }, encoding: 'utf8' }).trim();
    const hiddenState = JSON.parse(hidden);
    rec('with no campaign post configured, the task does not exist',
        hiddenState.id === null, JSON.stringify(hiddenState));

    console.log('');
    const failed = results.filter((r) => !r.pass);
    console.log(`${results.length - failed.length}/${results.length} checks passed`);
    for (const f of failed) console.log(`  FAILED: ${f.label}`);
    console.log('');
    process.exit(failed.length ? 1 : 0);
})().catch((error) => {
    console.error('Harness failed:', error);
    process.exit(1);
});

/**
 * A distinct post URL for the cases that need one which is *not* the campaign post — so a check
 * cannot pass on a URL that has already been accepted elsewhere in this file.
 */
function anotherPost() {
    return 'https://x.com/alice/status/1900000000000000007';
}
