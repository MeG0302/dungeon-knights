#!/usr/bin/env node
/**
 * Who does a wallet end up bound to — and is that binding being called proof?
 *
 *     node tools/check-x-bind.js
 *
 * The page promises two ways in: *Link X*, and typing your handle. The typed one was broken for
 * everyone who signed in with Privy: the route verified their token, saw no X account linked to it,
 * and refused with a sentence telling them to link X first — a wall behind the words "or type your
 * handle", in exactly the case the app's own login creates. This file is about that decision, so it
 * drives the real rule (`resolveXIdentity`) with **real ES256 tokens** and a stubbed Privy rather
 * than asserting the sentence it used to print.
 *
 * THE CLAIMS UNDER TEST
 * ---------------------
 *   1. A proved handle wins — even over a different typed one, and the disagreement is recorded.
 *   2. An unusable proof never becomes proof: no token, an expired one, a bad signature, a token
 *      whose user has no X linked, and a linked account with no username are all provisional.
 *   3. No proof is a *stopping* condition only when the player also typed nothing — then there is
 *      genuinely no handle, and the route's own `bad-identity` refusal is the correct answer.
 *   4. The word for a binding is never `ok`. A token proving *who the player is* has said nothing
 *      about a handle, and a log line that reads `ok` next to an unproved binding is a lie.
 *
 * The rule lives in `lib/x-binding.js` because the route imports `next/server`, which does not
 * resolve outside Next — so the source assertions at the end are what keep the offline coverage
 * pointed at the real thing: the route must call this rule, and the page must offer the way to
 * prove a typed binding instead of leaving the player with nothing to press.
 *
 * Runs entirely offline: a throwaway store, no network, a Privy stubbed at the JWKS and `/users/me`
 * boundary. Nothing to clean up afterwards.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

const ROOT = path.join(__dirname, '..');

// ------------------------------------------------------------------ the sandbox, before imports
// The store picks its driver and its file path when the module graph loads, so both are settled
// first: this process runs against a throwaway `.data/points.json` in a temp directory.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-x-bind-'));
process.chdir(sandbox);
process.env.POINTS_SESSION_SECRET = 'check-x-bind';
process.env.PRIVY_APP_ID = 'cmu9rk7lo034q0cl24jlo2mr7';
for (const key of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
    delete process.env[key];
}

// --------------------------------------------------------------------------- the Privy stub
// A real P-256 keypair published as this app's JWKS, with tokens signed by it — so "verified" in
// these cases means a signature was actually checked, not that a flag was set.
const APP_ID = process.env.PRIVY_APP_ID;
const KEYS = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const KID = 'x-bind-key-1';
const JWK = { ...KEYS.publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'ES256' };

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

function signToken(claims, { kid = KID } = {}) {
    const input = `${b64url({ alg: 'ES256', typ: 'JWT', kid })}.${b64url(claims)}`;
    const signature = crypto.sign('sha256', Buffer.from(input), { key: KEYS.privateKey, dsaEncoding: 'ieee-p1363' });
    return `${input}.${signature.toString('base64url')}`;
}

const privyClaims = (overrides = {}) => {
    const now = Math.floor(Date.now() / 1000);
    return { iss: 'privy.io', aud: APP_ID, sub: 'did:privy:harness', sid: 'sess-1', iat: now, exp: now + 3600, ...overrides };
};

/** What `GET /users/me` answers. `linked` is the player's X account, or null for a bare Privy user. */
const privyUser = { linked: { type: 'twitter', subject: '4242', username: 'AliceW' } };

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

let networkCalls = 0;
globalThis.fetch = async (url, options = {}) => {
    networkCalls += 1;
    const target = String(url);
    if (target.includes('/jwks.json')) return jsonResponse(200, { keys: [JWK] });
    if (target.endsWith('/api/v1/users/me') && options?.headers?.authorization) {
        return jsonResponse(200, { id: 'did:privy:harness', linked_accounts: privyUser.linked ? [privyUser.linked] : [] });
    }
    throw new Error(`the harness must not reach the network: ${target}`);
};

(async () => {
    console.log('');
    console.log('Points Program — which X handle a wallet binds');

    const { resolveXIdentity, describeBinding } = await import(
        pathToFileURL(path.join(ROOT, 'lib', 'x-binding.js')).href
    );
    const Privy = await import(pathToFileURL(path.join(ROOT, 'lib', 'privy-verify.js')).href);

    const fresh = () => `0x${crypto.randomBytes(20).toString('hex')}`;

    // ------------------------------------------------------------------- 1. proof, when there is one
    console.log('');
    console.log('A proved handle wins');

    privyUser.linked = { type: 'twitter', subject: '4242', username: 'AliceW' };
    const proved = await Privy.privyIdentityFromToken(signToken(privyClaims()));
    // Privy hands the handle back as X stores it — lower case — so the comparisons here are on the
    // spelling the binding will actually carry, not on how the player typed it.
    const same = resolveXIdentity({ claimed: { id: '4242', username: '@AliceW' }, proof: proved });
    rec('the Privy-linked account is what gets bound',
        same.verified === true && same.identity.username === 'alicew' && same.proofCode === 'privy',
        `${same.identity.username} · verified ${same.verified} · ${same.proofCode}`);
    rec('a typed @ and a case difference are the same account, not a replacement',
        same.replacedClaim === false, `replacedClaim ${same.replacedClaim}`);

    const disagreeing = resolveXIdentity({ claimed: { id: '99', username: 'BobTheFarmer' }, proof: proved });
    rec('a typed handle that disagrees loses to the proved one, and it is logged',
        disagreeing.verified === true && disagreeing.identity.username === 'alicew' && disagreeing.replacedClaim === true,
        `bound ${disagreeing.identity.username}, replacedClaim ${disagreeing.replacedClaim}`);

    // ---------------------------------------------------- 2. the case that used to be a wall
    console.log('');
    console.log('No proof is provisional, never a wall');

    privyUser.linked = null;
    const unlinkedToken = signToken(privyClaims());
    const bare = await Privy.privyIdentityFromToken(unlinkedToken);
    rec('a Privy user with no X link reports no X link, not a failure',
        bare.ok === true && !bare.twitter, `ok ${bare.ok} · twitter ${bare.twitter}`);

    const typed = resolveXIdentity({ claimed: { username: 'myownhandle' }, proof: bare });
    rec('signed in with Privy and no X linked, a typed handle still binds',
        typed.identity.username === 'myownhandle' && typed.verified === false,
        `${typed.identity.username} · verified ${typed.verified}`);
    rec('and the record says exactly why it is provisional',
        typed.proofCode === 'privy-no-x', typed.proofCode);
    rec('the word is never `ok` — a token proves a person, not a handle',
        typed.proofCode !== 'ok' && typed.proofCode !== 'privy', typed.proofCode);
    rec('the log line reads as a sentence, not a code',
        /signed in with Privy, which has no X account linked/.test(describeBinding(typed)),
        describeBinding(typed));

    // Nothing typed either: the one case where there is genuinely no handle to bind.
    const nothing = resolveXIdentity({ claimed: {}, proof: bare });
    rec('nothing typed and nothing linked leaves no handle to bind',
        nothing.identity.username === '' && nothing.verified === false,
        `"${nothing.identity.username}" · ${nothing.proofCode}`);
    rec('which is the route\'s bad-identity refusal, not a provisional binding',
        !nothing.identity.username, 'the route refuses on an empty username');

    // An X account Privy knows about but cannot name a handle for is not proof either.
    privyUser.linked = { type: 'twitter', subject: '4242' };
    const nameless = await Privy.privyIdentityFromToken(signToken(privyClaims()));
    const namelessBound = resolveXIdentity({ claimed: { username: 'typedfallback' }, proof: nameless });
    rec('a linked X account with no username is not proof of a handle',
        namelessBound.verified === false && namelessBound.identity.username === 'typedfallback',
        `verified ${namelessBound.verified} · bound ${namelessBound.identity.username}`);

    // ------------------------------------------------------------ 3. every other way proof fails
    console.log('');
    console.log('The other ways a proof fails');

    const noToken = resolveXIdentity({ claimed: { username: 'typed' }, proof: { ok: false, code: 'no-token' } });
    rec('no token at all is provisional, with no-token as the reason',
        noToken.verified === false && noToken.identity.username === 'typed' && noToken.proofCode === 'no-token',
        noToken.proofCode);

    const expired = await Privy.privyIdentityFromToken(signToken(privyClaims({ exp: Math.floor(Date.now() / 1000) - 60 })));
    const expiredBound = resolveXIdentity({ claimed: { username: 'typed' }, proof: expired });
    rec('an expired token still binds the typed handle, and says the token expired',
        expired.ok === false && expiredBound.verified === false && expiredBound.proofCode === 'expired',
        expiredBound.proofCode);

    // Corrupted in the middle of the *signature*, not at its last character: the final base64unit of a
    // 64-byte ES256 signature carries bits that decode to nothing, so flipping it can leave the
    // signature byte-identical — a mutation that looks like a test and is not one.
    const parts = signToken(privyClaims()).split('.');
    parts[2] = `${parts[2].slice(0, 20)}${parts[2][20] === 'A' ? 'B' : 'A'}${parts[2].slice(21)}`;
    const badSig = await Privy.privyIdentityFromToken(parts.join('.'));
    const badSigBound = resolveXIdentity({ claimed: { username: 'typed' }, proof: badSig });
    rec('a token edited after signing proves nothing, and the handle still binds',
        badSig.ok === false && badSig.code === 'bad-signature' && badSigBound.verified === false,
        `${badSig.code} → ${badSigBound.proofCode}`);

    const garbage = await Privy.privyIdentityFromToken('not-a-token-at-all');
    const garbageBound = resolveXIdentity({ claimed: { username: 'typed' }, proof: garbage });
    rec('a token that is not a token proves nothing either',
        garbage.ok === false && garbageBound.identity.username === 'typed' && garbageBound.proofCode === 'malformed-token',
        garbageBound.proofCode);

    const outage = resolveXIdentity({ claimed: { username: 'typed' }, proof: { ok: false, code: 'jwks-unreachable', retryable: true } });
    rec('a Privy outage is not the player\'s problem',
        outage.verified === false && outage.identity.username === 'typed' && outage.proofCode === 'jwks-unreachable',
        outage.proofCode);

    const blank = resolveXIdentity({ claimed: { username: '   ' }, proof: { ok: false, code: 'no-token' } });
    rec('a blank typed handle is not a handle',
        blank.identity.username === '' && blank.verified === false, `"${blank.identity.username}"`);

    // ------------------------------------------------------------------- 4. the real bindX agrees
    console.log('');
    console.log('The binding itself still holds one handle to one wallet');

    const Store = await import(pathToFileURL(path.join(ROOT, 'lib', 'points-store.js')).href);
    const Program = await import(pathToFileURL(path.join(ROOT, 'lib', 'points-program.js')).href);

    const first = fresh();
    const marker = `handle${crypto.randomBytes(3).toString('hex')}`;
    const bound = await Program.bindX(first, { username: marker }, { verified: false });
    const again = await Program.bindX(fresh(), { username: marker });
    rec('a provisional handle cannot be bound by a second wallet',
        bound.ok === true && again.code === 'x-taken', again.code);
    rec('a provisional binding opens the earning gate',
        (await Program.stateFor(first)).canEarn === true, 'canEarn');
    rec('and no points were minted by binding alone',
        ((await Store.getWallet(first))?.points || 0) === 0, `${(await Store.getWallet(first))?.points || 0} PTS`);

    // ------------------------------------------------------------------- the source assertions
    console.log('');
    console.log('The route and the page still do what this rule assumes');

    const read = (relative) => fs.readFileSync(path.join(ROOT, ...relative.split('/')), 'utf8');
    const routeSource = read('app/api/points/x/route.js');
    rec('the route decides the binding with this rule, not its own copy',
        /resolveXIdentity\(\{\s*claimed,\s*proof\s*\}\)/.test(routeSource), 'resolveXIdentity({ claimed, proof })');
    rec('and the code that refused an unlinked Privy user is gone',
        !/'no-x-link'/.test(routeSource), "'no-x-link' absent");
    rec('the response still reports which proof was used',
        /proof:\s*proofCode/.test(routeSource), 'proof: proofCode');

    const pageSource = read('app/points/client.js');
    rec('the page tells a provisional binding apart from a proved one',
        /result\.proof === 'privy-no-x'/.test(pageSource), "proof === 'privy-no-x'");
    rec('the promise next to the typed field matches what the server does',
        /A typed handle binds just as\s*\n?\s*well/.test(pageSource) || /A typed handle binds just as/.test(pageSource),
        'the footnote promises the typed path');
    rec('and a typed binding is offered a way to become provable',
        /'Link X to prove it'/.test(pageSource), "'Link X to prove it'");
    rec('the prove action is no longer gated on an X account already being linked',
        !/!state\.x\.verified && privyX && xProof !== false/.test(pageSource),
        'the old condition is gone');
    rec('nothing about the proof path is reported to the player as ok',
        !/proof === 'ok'/.test(pageSource), "no 'ok' branch");

    // ----------------------------------------------------------------------------- the summary
    const failed = results.filter((r) => !r.pass);
    console.log('');
    console.log(`  ${results.length - failed.length}/${results.length} checks passed · ${networkCalls} stubbed request(s)`);
    console.log('');
    if (failed.length) {
        console.log('  failures:');
        for (const f of failed) console.log(`    - ${f.label}`);
        process.exit(1);
    }
    process.exit(0);
})().catch((error) => {
    console.error('');
    console.error('  the harness itself threw:', error);
    process.exit(1);
});
