#!/usr/bin/env node
/**
 * Do the invite codes credit exactly the wallet they name, and only ever once?
 *
 *     node tools/check-refs.js
 *
 * Points are a liability, and a referral is the one place where *another* wallet's total moves as a
 * side effect of an award. That makes every rule here a way to hand somebody points for something
 * that did not happen, or to move a commission that has already been paid. So the suite runs
 * **offline**, in a throwaway working directory, against the file driver — no network, no key, no
 * rate limit, nothing left behind — and each rule was falsified by mutation before it was trusted
 * (see the table in `.freebuff/run.md`).
 *
 * Three of these checks exist because of the change this file was written for: referrals could
 * previously only be recorded *at arrival* (a wallet came in through a link), and this feature lets
 * one be recorded *later*. A later claim is what makes a loop possible — A attaches B, who had
 * attached A — and a loop pays A a commission on A's own points through `credit`'s second-degree
 * walk. Two guards are asserted for that, in two places: the chain walk in `attachRef`, and the
 * payment itself in `credit`.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

// -------------------------------------------------------------- the sandbox, before imports
// The store picks its driver and its file when the module graph loads, so both are settled first.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-points-refs-'));
const origin = process.cwd();
process.chdir(sandbox);
for (const key of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
    delete process.env[key];
}

(async () => {
    console.log('');
    console.log('Points Program — invite codes');

    const Config = await import('../lib/points-config.js');
    const { SITE_URL } = await import('../lib/site.js');
    const Store = await import('../lib/points-store.js');
    const Program = await import('../lib/points-program.js');

    const fresh = () => `0x${crypto.randomBytes(20).toString('hex')}`;
    const codeOf = async (address) => (await Store.getWallet(address))?.refCode || null;
    const points = async (address) => (await Store.getWallet(address))?.points || 0;
    const short = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;

    // ------------------------------------------------------------------------- the shape
    console.log('');
    console.log('The code itself');

    const alice = fresh();
    await Program.registerVisit(alice);
    const aliceCode = await codeOf(alice);

    rec('arriving mints a code of the published length',
        typeof aliceCode === 'string' && aliceCode.length === Config.REF_CODE_LENGTH, aliceCode);
    rec('  … and every character is in the alphabet',
        [...(aliceCode || '')].every((c) => Config.REF_CODE_ALPHABET.includes(c)), aliceCode);
    rec('the alphabet cannot be misread: no 0/O and no 1/I/L',
        ['0', 'O', '1', 'I', 'L'].every((c) => !Config.REF_CODE_ALPHABET.includes(c)),
        Config.REF_CODE_ALPHABET);
    rec('the code is stable across reads — a link that worked keeps working',
        (await Program.stateFor(alice)).refCode === aliceCode, aliceCode);

    rec('a code typed in lowercase, or with the spaces a screenshot invites, is the same code',
        Config.normaliseRefCode(`  ${aliceCode.toLowerCase()} `) === aliceCode
        && Config.normaliseRefCode(aliceCode.split('').join(' ')) === aliceCode,
        `${aliceCode} ← "${aliceCode.toLowerCase()}"`);
    rec('and a code-shaped string that cannot be one is refused, not guessed at',
        Config.normaliseRefCode('ABCD') === null
        && Config.normaliseRefCode('ABCDEF') === null
        && Config.normaliseRefCode('ABC0E') === null
        && Config.normaliseRefCode('ABCLE') === null
        && Config.normaliseRefCode(null) === null, 'four chars, six chars, a 0 and an L');

    const invite = `${SITE_URL}/points?ref=${aliceCode}`;
    rec('a whole pasted invite link is unwrapped to the code inside it',
        Config.refTokenFromInput(invite) === aliceCode, invite);
    rec('  … including one with other query parameters',
        Config.refTokenFromInput(`${SITE_URL}/points?utm=x&ref=${aliceCode}&y=2`) === aliceCode, '');
    rec('a bare code or a bare address are both left alone',
        Config.refTokenFromInput(aliceCode) === aliceCode
        // A checksummed address is mixed case and must survive: lower-casing is the store's job,
        // and it only accepts the lowercase form.
        && Config.refTokenFromInput(`0x${alice.slice(2).toUpperCase()}`) === alice, alice);
    rec('a link with no `ref=` is not a referral',
        Config.refTokenFromInput(`${SITE_URL}/points`) === null
        && Config.refTokenFromInput('') === null
        && Config.refTokenFromInput('hello there') === null, '');

    // -------------------------------------------------------------------- one code, one wallet
    console.log('');
    console.log('One code, one wallet');

    const taken = fresh();
    const first = await Store.claimRefCode(aliceCode, taken);
    rec('the store refuses to hand one wallet a code another already holds',
        first.ok === false && first.owner === alice, `ok=${first.ok} owner=${short(first.owner || '')}`);
    rec('  … and re-claiming its own code is not an error',
        (await Store.claimRefCode(aliceCode, alice)).ok === true, '');

    // A hundred and twenty wallets: every code distinct, and every code resolvable back to its owner.
    // A collision is not asserted away — it is retried, which is what the count below measures.
    const crowd = [fresh(), ...Array.from({ length: 119 }, fresh)];
    for (const address of crowd) await Program.registerVisit(address);
    const codes = await Promise.all(crowd.map(codeOf));
    const distinct = new Set(codes);
    rec(`${crowd.length} wallets hold ${crowd.length} distinct codes`,
        distinct.size === crowd.length, `${distinct.size} distinct`);
    const resolved = await Promise.all(codes.map((code) => Store.refCodeOwner(code)));
    rec('  … and every one of them resolves back to its owner',
        resolved.every((owner, i) => owner === crowd[i]), '');

    // The two reconciliation branches: the index is the authority, the record is not.
    const drift = fresh();
    await Program.registerVisit(drift);
    const orphan = Config.REF_CODE_ALPHABET.slice(0, 5);
    await Store.updateWallet(drift, (w) => { w.refCode = orphan; return w; });
    rec('a record whose code the index has lost reclaims the same code',
        (await Store.assignRefCode(drift)) === orphan && (await Store.refCodeOwner(orphan)) === drift, orphan);

    const thief = fresh();
    await Program.registerVisit(thief);
    await Store.updateWallet(thief, (w) => { w.refCode = aliceCode; return w; });
    const reclaimed = await Store.assignRefCode(thief);
    rec('a record holding somebody else’s code is given a fresh one instead',
        reclaimed !== aliceCode && reclaimed.length === Config.REF_CODE_LENGTH,
        `${reclaimed} — ${aliceCode} is still ${short(await Store.refCodeOwner(aliceCode))}`);

    // -------------------------------------------------------------------- arriving through a link
    console.log('');
    console.log('Arriving through a link');

    const viaCode = fresh();
    await Program.registerVisit(viaCode, aliceCode);
    rec('a link carrying a code attaches the wallet that opened it',
        (await Store.getWallet(viaCode)).referrer === alice, '');
    rec('  … and the referrer lists them',
        (await Store.getWallet(alice)).referrals.includes(viaCode), '');

    const bob = fresh();
    await Program.registerVisit(bob, alice);
    rec('a link carrying an address still works — every link already posted keeps counting',
        (await Store.getWallet(bob)).referrer === alice, '');

    const junk = fresh();
    await Program.registerVisit(junk, 'NOT-A-CODE');
    rec('a garbage `?ref=` attaches nothing, and does not throw',
        (await Store.getWallet(junk)).referrer === null, '');

    const selfRef = fresh();
    await Program.registerVisit(selfRef);
    await Program.registerVisit(selfRef, await codeOf(selfRef));
    rec('opening your own link does not refer yourself',
        (await Store.getWallet(selfRef)).referrer === null, '');

    const stranger = await Program.registerVisit(fresh(), 'ZZZZZ');
    rec('a code nobody holds credits nobody',
        stranger.referrer === null, '');

    // ------------------------------------------------------------------- adding one later
    console.log('');
    console.log('Adding a code later');

    const late = fresh();
    const inviter = fresh();
    await Program.registerVisit(late);
    await Program.registerVisit(inviter);
    const inviterCode = await codeOf(inviter);

    const attached = await Program.attachRef(late, inviterCode);
    rec('a wallet that played first can add a code afterwards',
        attached.ok === true && (await Store.getWallet(late)).referrer === inviter, '');
    rec('  … the referrer lists them, and the record says when',
        (await Store.getWallet(inviter)).referrals.includes(late)
        && typeof (await Store.getWallet(late)).referredAt === 'string',
        (await Store.getWallet(late)).referredAt);
    rec('  … and the state tells the page who it was',
        (await Program.stateFor(late)).referrer === inviter, '');

    const again = await Program.attachRef(late, await codeOf(alice));
    rec('a second code is refused — the referrer a wallet has is the one it keeps',
        again.code === 'already-referred' && (await Store.getWallet(late)).referrer === inviter,
        again.code);

    const unknown = await Program.attachRef(fresh(), 'ZZZZZ');
    rec('a code nobody holds is refused by name', unknown.code === 'unknown-code', unknown.error);

    const own = await Program.attachRef(inviter, inviterCode);
    rec('a wallet cannot add its own code', own.code === 'own-code', own.error);

    const malformed = await Program.attachRef(fresh(), 'oops!');
    rec('junk is refused before anything is looked up', malformed.code === 'bad-code', malformed.error);
    rec('  … and an empty box is a refusal, not a visit',
        (await Program.attachRef(fresh(), '')).code === 'bad-code', '');

    // ------------------------------------------------------------------------------ the loop
    console.log('');
    console.log('The loop this feature made possible');

    // Carol arrived through Dana's link. Dana then tries to add Carol's code — which, if it were
    // allowed, would set Dana.referrer = Carol *and* Carol.referrer = Dana.
    const dana = fresh();
    const carol = fresh();
    await Program.registerVisit(dana);
    await Program.registerVisit(carol, await codeOf(dana));
    rec('the arrival itself is fine (this is the setup, not the check)',
        (await Store.getWallet(carol)).referrer === dana, '');

    const loop = await Program.attachRef(dana, await codeOf(carol));
    rec('the wallet a code owner is downstream of cannot attach it',
        loop.code === 'cycle' && (await Store.getWallet(dana)).referrer === null, loop.error);

    // And the payment path refuses on its own terms, because a chain written by anything else —
    // an older deployment, a repair, a race — must not be able to pay a wallet out of its own
    // earning. Written straight into the store, past every guard above.
    const looped = fresh();
    const partner = fresh();
    await Program.registerVisit(looped);
    await Program.registerVisit(partner);
    await Program.bindX(looped, { id: '9001', username: 'looped' });
    await Store.updateWallet(looped, (w) => { w.referrer = partner; return w; });
    await Store.updateWallet(partner, (w) => { w.referrer = looped; return w; });

    const earned = await Program.clearLevel(looped, 0);
    rec('a wallet in a loop is paid its floor and not a commission on it',
        (await points(looped)) === 100, `${await points(looped)} PTS for a ${earned.credited}-point floor`);
    rec('  … while the other half of the loop still earns its 15%',
        (await points(partner)) === 15, `${await points(partner)} PTS`);

    const selfReferrer = fresh();
    await Program.registerVisit(selfReferrer);
    await Program.bindX(selfReferrer, { id: '9002', username: 'selfreferrer' });
    await Store.updateWallet(selfReferrer, (w) => { w.referrer = w.address; return w; });
    await Program.clearLevel(selfReferrer, 0);
    rec('a wallet that is its own referrer is paid nothing extra either',
        (await points(selfReferrer)) === 100, `${await points(selfReferrer)} PTS`);

    // ------------------------------------------------------------------- the money rule
    console.log('');
    console.log('What a late code does and does not pay for');

    const played = fresh();
    const friend = fresh();
    await Program.registerVisit(played);
    await Program.registerVisit(friend);
    await Program.bindX(played, { id: '9003', username: 'played' });
    await Program.clearLevel(played, 0);                       // 100 points, referred by nobody
    const before = await points(friend);

    const lateCode = await Program.attachRef(played, await codeOf(friend));
    rec('a code added later is recorded', lateCode.ok === true, '');
    rec('  … and the 100 points already earned are not backdated into a commission',
        (await points(friend)) === before, `${await points(friend)} PTS`);
    rec('  … so the inviter has been paid nothing yet',
        (await Store.getWallet(friend)).referralEarned === 0, '');
    await Program.clearLevel(played, 1);                       // 300 points, now referred
    rec('  … and from here it counts: the next floor pays 15% to the inviter',
        (await points(friend)) === Config.commission(300, Config.REFERRAL_1ST_PCT),
        `${await points(friend)} PTS of 300`);

    // ------------------------------------------------------------------------ the invite link
    console.log('');
    console.log('The link the page hands out');

    const state = await Program.stateFor(alice);
    rec('the invite link carries the code, not a 42-character address',
        state.inviteUrl === `${SITE_URL}/points?ref=${aliceCode}`, state.inviteUrl);
    rec('  … and so does the text the player posts, so the two cannot disagree',
        state.share.text.includes(`ref=${aliceCode}`), '');
    rec('the link resolves back to the wallet that owns the code',
        Config.refTokenFromInput(state.inviteUrl) === aliceCode, '');

    // ------------------------------------------------------------------------ leaving nothing
    console.log('');
    console.log('A test wallet leaves nothing behind');

    const leaving = fresh();
    await Program.registerVisit(leaving, aliceCode);
    await Program.bindX(leaving, { id: '9004', username: 'leaving' });
    const leavingCode = await codeOf(leaving);
    const named = await Store.walletKeys(leaving);
    rec('the store can name the code index for a wallet before a purge',
        named.some((label) => label.startsWith('dk:points:refcode:')), `${named.length} label(s)`);

    await Store.purgeWallet(leaving, { ids: ['9004'] });
    rec('after a purge nothing names the wallet any more',
        (await Store.walletKeys(leaving)).length === 0, '');
    rec('  … and its code credits nobody',
        (await Store.refCodeOwner(leavingCode)) === null, `${leavingCode} → nobody`);

    // ------------------------------------------------------------------------------ the tally
    // Back out of the sandbox before removing it: Windows will not delete a directory that is the
    // process's working directory, and a harness that fails at the last line reads as a broken suite.
    try {
        process.chdir(origin);
        fs.rmSync(sandbox, { recursive: true, force: true });
    } catch {
        // A temp directory left behind is not a reason to fail every check that passed.
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
        console.log('');
        for (const f of failed) console.log(`  FAILED  ${f.label}`);
        process.exitCode = 1;
    }
})().catch((error) => {
    console.error(`harness stopped: ${error.message || error}`);
    process.exitCode = 1;
});
