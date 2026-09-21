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
    // The default is a *share* as the program writes one: the site link the campaign requires, and
    // the tag the share requires. A post that satisfies only one of the two tasks is what the
    // individual cases set explicitly.
    const text = stub.x.text !== null
        ? stub.x.text
        : `I cleared the Points Vault — 1800 points @${global.__SHARE_TAG__} https://${global.__SITE_HOST__}/points?ref=0x0`;
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
    global.__SHARE_TAG__ = Config.X_SHARE_TAG;

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

    // The hand-off, and its limit. A *proved* binding beats a provisional one — the only direction
    // it can go, since two proved bindings for one account would mean two Privy users claiming one X
    // account and Privy does not allow that. It may not beat a claim that has already **earned**:
    // `gate` has been paid under @alice, so the wallet proving @alice now is not the wallet those
    // points went to, and handing the claim over would pay one X account on two wallets.
    const taker = fresh();
    const proved = await Program.bindX(taker, { id: '4242', username: 'alice' }, { verified: true });
    rec('a proved binding cannot take over a claim that has already earned',
        proved.code === 'x-taken' && String(proved.error).includes('already earned'),
        `${proved.code}: ${proved.error}`);
    rec('  … and the wallet that earned keeps the account',
        (await Store.getWallet(gate)).x.id === '4242', 'still bound');
    rec('  … and the wallet that was refused is left completely unbound',
        ((await Store.getWallet(taker))?.x ?? null) === null, 'x=null');
    rec('  … and it is still not earning', (await stateOf(taker)).canEarn === false, '');
    rec('  … and the claim never moved', (await Store.xBindingOwner('4242')) === gate, '');

    const twoProved = await Program.bindX(fresh(), { id: '7000', username: 'carol' }, { verified: true });
    rec('and two proved bindings cannot both hold one account',
        twoProved.code === 'x-taken', twoProved.error);

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
    stub.x.text = 'a post with no tag in it at all';
    const noTag = await Program.submitTask(gate, 'share', anotherPost());
    rec('a post that does not tag us never pays',
        noTag.credited === 0 && (await tasksOf(gate)).share.state === 'failed',
        (await tasksOf(gate)).share.reason);
    rec('  … and the refusal names the account it had to tag',
        (await tasksOf(gate)).share.reason.includes(`@${Config.X_SHARE_TAG}`),
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

    // ------------------------------------------------------------------ what the post says
    console.log('');
    console.log('What the share hands the player');

    const kit = (await stateOf(gate)).share;
    rec('the tag the verifier looks for is the tag the post was written with',
        kit.tag === Config.X_SHARE_TAG && kit.text.includes(`@${Config.X_SHARE_TAG}`), kit.tag);
    rec('the text claims the doubled total, not the run total',
        kit.text.includes(String((await stateOf(gate)).entryTotalToday * 2)), kit.text);
    rec('and it carries this wallet\u2019s own invite link',
        kit.text.includes(`/points?ref=${gate}`), kit.text);
    rec('the composer link is prefilled with exactly that text',
        kit.intentUrl.includes(encodeURIComponent(kit.text)), '');
    rec('and the card picture is the one the page offers for download',
        kit.cardImage === Config.SHARE_CARD_IMAGE && kit.ogImage === Config.SHARE_OG_IMAGE,
        `${kit.cardImage} / ${kit.ogImage}`);

    // ----------------------------------------------------------------------- the picture
    console.log('');
    console.log('The picture that goes out with a share');

    const root = path.join(__dirname, '..');
    for (const [label, asset] of [
        ['the card X unfurls', Config.SHARE_OG_IMAGE],
        ['the picture the kit saves', Config.SHARE_CARD_IMAGE],
    ]) {
        rec(`${label} is where the config says it is`, fs.existsSync(path.join(root, 'public', asset)), asset);
    }
    // The crop is ours rather than X's: `summary_large_image` renders at 1.91:1, and handing it the
    // photo's own shape would let X decide which part of the knight to cut off.
    const ogSize = jpegSize(path.join(root, 'public', Config.SHARE_OG_IMAGE));
    rec('and it is already the shape X renders link cards at',
        ogSize?.width === Config.SHARE_OG_SIZE.width && ogSize?.height === Config.SHARE_OG_SIZE.height,
        ogSize ? `${ogSize.width}\u00d7${ogSize.height}` : 'unreadable');
    const pointsPage = fs.readFileSync(path.join(root, 'app', 'points', 'page.js'), 'utf8');
    rec('/points declares it as its own link card, which is what puts it in the post',
        pointsPage.includes('SHARE_OG_IMAGE') && /card: 'summary_large_image'/.test(pointsPage), '');

    // ------------------------------------------------------------------- the one-way door
    console.log('');
    console.log('A binding cannot be handed back');

    const locked = await Program.unbindX(gate);
    rec('unbinding is refused, with the code the page switches on',
        locked.code === 'x-locked' && String(locked.error).includes('one wallet'),
        `${locked.code}: ${locked.error}`);
    rec('  … and the binding is untouched', (await Store.getWallet(gate)).x.id === '4242', 'still bound');
    rec('  … and the account is still claimed by that wallet',
        (await Store.xBindingOwner('4242')) === gate, '');
    rec('  … and earning still works', (await Program.clearLevel(gate, 1)).credited === 300, 'floor 2 paid');

    const switcher = fresh();
    await Program.bindX(switcher, { id: '5001', username: 'bob' });
    await Program.bindX(switcher, { id: '5002', username: 'bob' });
    rec('a wallet can move to a different account id under the same handle',
        (await Store.getWallet(switcher)).x.id === '5002', String((await Store.getWallet(switcher)).x.id));
    rec('  … and the account it left stays claimed by it',
        (await Store.xBindingOwner('5001')) === switcher, String(await Store.xBindingOwner('5001')));
    const hijack = await Program.bindX(fresh(), { id: '5001', username: 'bob' });
    rec('  … so the next wallet cannot bind it, handle in hand or not',
        hijack.code === 'x-taken', hijack.code);

    // The one hand-over that survives: claimed, never earned under, handed to the wallet that can
    // prove it — and the wallet giving it up keeps whatever it holds now.
    const proverBob = fresh();
    const handed = await Program.bindX(proverBob, { id: '5001', username: 'bob' }, { verified: true });
    rec('an account claimed but never earned under goes to the wallet that proves it',
        handed.ok === true, handed.code || `ok=${handed.ok}`);
    rec('  … and the wallet that gave it up keeps the account it holds now',
        (await Store.getWallet(switcher)).x?.id === '5002', String((await Store.getWallet(switcher)).x?.id));

    // The gap the two index keys left: one wallet binds by account id, another types the same
    // handle. With only the id claimed, the typed binding found the handle free and *both* earned
    // for one X account — no unbinding required. Every binding now claims its handle as well.
    const byId = fresh();
    await Program.bindX(byId, { id: '6001', username: 'dave' });
    rec('binding by account id also claims the handle',
        (await Store.xBindingOwner('handle:dave')) === byId, '');
    const typedToo = await Program.bindX(fresh(), { username: 'dave' });
    rec('so a second wallet cannot take the same account by typing the handle',
        typedToo.code === 'x-taken', typedToo.code);

    // ----------------------------------------------------------------- pending, then paid
    console.log('');
    console.log('A post X has not indexed yet');

    // Its own handle, and its own name in the stub: one X account earns for one wallet, so a second
    // wallet cannot bind @alice at all any more — which is the rule working, and the reason every
    // wallet from here on has a handle of its own.
    const patient = fresh();
    await Program.bindX(patient, { id: '777', username: 'patient' });
    await Program.clearLevel(patient, 0);
    const patientBefore = await points(patient);

    stub.x.author = 'patient';
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
    await Program.bindX(silent, { id: '888', username: 'silent' });
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
    await Program.bindX(player, { id: '999', username: 'player' });
    const campaignTask = (await tasksOf(player)).campaign;
    rec('the campaign is published with its reward',
        campaignTask.id === campaignId && campaignTask.reward === Config.X_ENGAGEMENT_REWARD,
        `${campaignTask.id} → ${campaignTask.reward} PTS`);
    rec('  … and it starts unsubmitted', campaignTask.state === 'none', campaignTask.state);

    stub.x.author = 'player';
    stub.x.text = null;
    const engaged = await Program.submitTask(player, 'campaign', CAMPAIGN);
    rec('an engagement post by the bound handle pays once',
        engaged.credited === Config.X_ENGAGEMENT_REWARD, `${engaged.credited} PTS`);
    rec('  … and a second one does not pay again',
        (await Program.submitTask(player, 'campaign', 'https://x.com/alice/status/1900000000000000005')).credited === 0, '0 PTS');

    // ------------------------------------------------------------- concurrency
    console.log('');
    console.log('Two taps at once');

    stub.x.author = 'racer';
    const racer = fresh();
    await Program.bindX(racer, { id: '1000', username: 'racer' });
    const raceUrl = 'https://x.com/racer/status/1900000000000000006';
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
    stub.x.author = 'racer2';
    const racer2 = fresh();
    await Program.bindX(racer2, { id: '1001', username: 'racer2' });
    const [c, d] = await Promise.all([
        Program.submitTask(racer2, 'campaign', 'https://x.com/racer2/status/1900000000000000008'),
        Program.submitTask(racer2, 'campaign', 'https://x.com/racer2/status/1900000000000000009'),
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

    // --------------------------------------------------------------- the one-time tab
    // The one reward in this program that nothing checks. What is testable is everything *around*
    // that: who may claim, how many times, and whether the card can even be rendered correctly.
    console.log('');
    console.log('The one-time tasks');

    const taskIds = Config.ONE_TIME_TASKS.map((t) => t.id);
    rec('the registry is a list of ids with a reward each',
        taskIds.length > 0
        && Config.ONE_TIME_TASKS.every((t) => /^[a-z][a-z0-9-]*$/.test(t.id) && Number.isInteger(t.reward) && t.reward > 0),
        taskIds.join(', '));
    rec('  … and an unknown id is refused rather than guessed at',
        (await Program.claimOneTime(gate, 'no-such-task')).code === 'unknown-task', 'unknown-task');

    const unfunded = fresh();
    const unbindRefusal = await Program.claimOneTime(unfunded, taskIds[0]);
    rec('a wallet with no X account cannot claim one',
        unbindRefusal.code === Program.X_REQUIRED, `${unbindRefusal.code}: ${unbindRefusal.error}`);
    rec('  … and it was paid nothing', (await points(unfunded)) === 0, `${await points(unfunded)} PTS`);

    // Ids of its own: an account id is global here, and re-using one that an earlier case already
    // claimed would make this section fail for a reason that has nothing to do with one-time tasks.
    const claimant = fresh();
    await Program.bindX(claimant, { id: '5101', username: 'follower' });
    const claimed = await Program.claimOneTime(claimant, taskIds[0]);
    rec('a bound wallet claims it once',
        claimed.credited === Config.ONE_TIME_TASKS[0].reward,
        `${claimed.credited} PTS`);
    rec('  … and the balance agrees',
        (await points(claimant)) === Config.ONE_TIME_TASKS[0].reward, `${await points(claimant)} PTS`);

    const afterOneTime = (await stateOf(claimant)).oneTime;
    rec('the state reports it as claimed, with what was paid',
        afterOneTime.length === taskIds.length
        && afterOneTime[0].claimed === true
        && afterOneTime[0].credited === Config.ONE_TIME_TASKS[0].reward,
        JSON.stringify(afterOneTime[0]));
    rec('  … and claims it on the player\'s word rather than implying a check',
        afterOneTime[0].proof === 'claim', afterOneTime[0].proof);

    const secondClaim = await Program.claimOneTime(claimant, taskIds[0]);
    rec('and a second claim pays nothing',
        secondClaim.credited === 0 && secondClaim.alreadyCredited === true, `${secondClaim.credited} PTS`);
    rec('  … and the balance did not move',
        (await points(claimant)) === Config.ONE_TIME_TASKS[0].reward, `${await points(claimant)} PTS`);

    // The guard is a TTL, not a fact — it lapses after ten minutes, on purpose, so a crash between
    // claiming and recording cannot lock a player out of a task they were never paid for. What
    // makes the claim *permanent* is the record, so this releases the guard by hand and asks again:
    // exactly what the clock would do, without waiting for it.
    await Store.releaseGuard(`one-time:${claimant}:${taskIds[0]}`);
    const afterGuardLapses = await Program.claimOneTime(claimant, taskIds[0]);
    rec('the claim outlives its guard — the record is what makes it permanent',
        afterGuardLapses.credited === 0 && afterGuardLapses.alreadyCredited === true,
        `${afterGuardLapses.credited} PTS after the guard lapsed`);

    // Two taps at once, the shape a player with two tabs actually produces. The record check is a
    // read and the write is a second step, so the atomic guard is the only thing standing here.
    const racer3 = fresh();
    await Program.bindX(racer3, { id: '5102', username: 'onetimeracer' });
    const raced = await Promise.all([
        Program.claimOneTime(racer3, taskIds[0]),
        Program.claimOneTime(racer3, taskIds[0]),
    ]);
    const raceTotal = (raced[0].credited || 0) + (raced[1].credited || 0);
    rec('two claims at once pay exactly one reward',
        raceTotal === Config.ONE_TIME_TASKS[0].reward, `${raceTotal} PTS between two requests`);
    rec('  … and the balance agrees',
        (await points(racer3)) === Config.ONE_TIME_TASKS[0].reward, `${await points(racer3)} PTS`);

    // The task record shares a map with the X tasks (`share`, `x:<status id>`), so a one-time claim
    // must not be able to land on one of their ids — or be read as one of them.
    rec('a one-time claim does not masquerade as the daily share',
        (await tasksOf(claimant)).share.state === 'none', (await tasksOf(claimant)).share.state);

    // It goes through the same credit path as every other award, commission and all — a bespoke
    // payout here would be a second place for the referral rules to be wrong.
    const inviter = fresh();
    const invited = fresh();
    await Store.updateWallet(inviter, (w) => w);
    await Program.registerVisit(invited, inviter);
    await Program.bindX(invited, { id: '5103', username: 'invited' });
    await Program.claimOneTime(invited, taskIds[0]);
    rec('a one-time reward pays the referral commission like any other',
        (await points(inviter)) === Math.floor(Config.ONE_TIME_TASKS[0].reward * Config.REFERRAL_1ST_PCT),
        `${await points(inviter)} PTS to the inviter`);

    // The card is rendered from `state.oneTime`, which the server fills in. The tag lives in that
    // copy as `{handle}`, and a client cannot read the value it is replaced with — so a leftover
    // placeholder here is a page telling players to follow @undefined.
    const copy = afterOneTime[0];
    rec('the server fills the handle into every string the card renders',
        [copy.cta, copy.url, copy.blurb].every((s) => !s.includes('{handle}'))
        && copy.blurb.includes(`@${Config.X_SHARE_TAG}`)
        && copy.url === `https://x.com/${Config.X_SHARE_TAG}`,
        `${copy.cta} → ${copy.url}`);
    rec('  … and a wallet that has not claimed one is told so',
        (await stateOf(fresh())).oneTime.every((t) => t.claimed === false), 'none claimed');

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
    rec('the unbind action is answered with the refusal rather than served',
        /unbindX\(address\)/.test(Routes.x) && /x-locked/.test(Routes.x), '');
    rec('the one-time claim goes through the same route as the verified tasks',
        /claimOneTime\(address, kind\)/.test(Routes.task)
        && /body\?\.action === 'claim'/.test(Routes.task), '');

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

/**
 * The pixel dimensions out of a JPEG's start-of-frame marker.
 *
 * Read rather than assumed: the point of the share card being 1200×630 is that X does not crop the
 * photo itself, and no amount of looking at it can tell 630 from 670.
 */
function jpegSize(file) {
    const bytes = fs.readFileSync(file);
    let i = 2;
    while (i < bytes.length - 9) {
        if (bytes[i] !== 0xff) { i += 1; continue; }
        const marker = bytes[i + 1];
        const length = bytes.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
        }
        i += 2 + length;
    }
    return null;
}
