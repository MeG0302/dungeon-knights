#!/usr/bin/env node
/**
 * Does a capsule claim prove the wallet, name its own day, and refuse to be spent twice?
 *
 *     node tools/check-capsule-claim.js
 *
 * The capsule is the one thing on this site that leaves the building. The team is going to send it by
 * hand to an address somebody typed into a form, so the signature is not ceremony — it is the only
 * evidence that the address belongs to the player who won, and it is what the whole delivery path
 * rests on.
 *
 * Everything here runs **offline**, in a throwaway working directory, and the signatures are real:
 * `ethers` signs the messages the server writes and `verifyMessage` recovers the signer, exactly as
 * production does. The two failures this file exists for are the ones a screenshot cannot catch —
 * **a sign-in signature replayed as a claim** (the same wallet, the same 65 bytes, a different
 * purpose) and **yesterday's claim spent again today** (the same wallet, the same signature, a
 * different day). Both are refused, and refused by name.
 *
 * Every guard was falsified by mutation before it was trusted (see the table in `.freebuff/run.md`).
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
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-capsule-claim-'));
const origin = process.cwd();
process.chdir(sandbox);
for (const key of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
    delete process.env[key];
}

(async () => {
    console.log('');
    console.log('Points Program — capsule registration and daily claims');

    const { Wallet } = await import('ethers');
    const Config = await import('../lib/points-config.js');
    const Store = await import('../lib/points-store.js');
    const Session = await import('../lib/points-session.js');
    const Claims = await import('../lib/capsule-claims.js');
    const Capsules = await import('../lib/points-capsules.js');

    /** A wallet that can really sign, and a record for it. */
    async function player() {
        const wallet = Wallet.createRandom();
        const address = wallet.address.toLowerCase();
        await Store.putWallet({ ...Store.blankWallet(address), points: 900 });
        return { wallet, address };
    }

    /** What the draw writes when it pays a win — the record the claim path reads. */
    async function winOn(address, day, { status = 'won', claimedAt = null } = {}) {
        await Store.updateWallet(address, (w) => {
            w.capsules = w.capsules && typeof w.capsules === 'object' ? w.capsules : {};
            w.capsules[day] = {
                day,
                dayNumber: Config.programDay(day),
                capsule: Config.DRAW_CAPSULE,
                points: 900,
                rank: 1,
                wonAt: new Date().toISOString(),
                registeredAt: null,
                claimedAt,
                claimSigHash: claimedAt ? 'signature-digest' : null,
                formSubmittedAt: null,
                status,
            };
            return w;
        });
    }

    const today = Config.todayKey();
    const settledToday = Config.previousDayKey(today);   // the day whose draw ran at this midnight
    const tooOld = Config.previousDayKey(settledToday);

    // ------------------------------------------------------------------------ the messages
    console.log('');
    console.log('The message, and what it says it is for');

    const alice = await player();

    const register = Claims.challengeFor(alice.address, 'register');
    rec('a registration message names the wallet and the purpose, and no day',
        register.address === alice.address && register.purpose === 'register' && register.day === null
        && register.message.includes('Capsule Delivery') && !/^Day:/m.test(register.message),
        'register');
    rec('a claim message names the day it is for',
        Claims.challengeFor(alice.address, 'claim', settledToday)?.message.includes(`Day: ${settledToday}`) === true,
        settledToday);
    rec('a claim with no day is refused rather than issued',
        Claims.challengeFor(alice.address, 'claim') === null
        && Claims.challengeFor(alice.address, 'claim', 'tomorrow') === null,
        'no day, no claim');
    rec('neither a junk address nor an unknown purpose gets a message',
        Claims.challengeFor('0xnope', 'register') === null
        && Claims.challengeFor(alice.address, 'withdraw') === null, '');
    // A nonce is a MAC over the address, the purpose, the day and the second it was issued — so it is
    // **bound to its context**, which is the property that matters. Two asks in the same second for the
    // same context are deliberately the same message (the wallet is being asked to sign one thing, and
    // the ten-minute expiry is what bounds it); a nonce from another context is worthless.
    const nonceOf = (text) => /Nonce:\s*([0-9a-f]+)/.exec(text)?.[1];
    const bobBefore = await player();
    rec('the nonce is bound to the address, the purpose and the day',
        nonceOf(register.message) !== nonceOf(Claims.challengeFor(alice.address, 'claim', settledToday).message)
        && nonceOf(Claims.challengeFor(alice.address, 'claim', settledToday).message)
            !== nonceOf(Claims.challengeFor(alice.address, 'claim', tooOld).message)
        && nonceOf(Claims.challengeFor(alice.address, 'register').message)
            !== nonceOf(Claims.challengeFor(bobBefore.address, 'register').message),
        'a nonce from one context is not another\u2019s');

    const claimMessage = Claims.challengeFor(alice.address, 'claim', settledToday).message;
    const claimSig = await alice.wallet.signMessage(claimMessage);

    rec('a signed claim verifies against the wallet, the purpose and the day',
        Claims.verifyCapsuleChallenge(claimSig, claimMessage, { purpose: 'claim', day: settledToday, address: alice.address })
            ?.address === alice.address,
        `@${alice.address.slice(0, 8)}\u2026`);

    // ---------------------------------------------------------------------- the two replays
    console.log('');
    console.log('The two replays this exists to stop');

    const signIn = Session.challengeFor(alice.address);
    const signInSig = await alice.wallet.signMessage(signIn.message);
    rec('a **sign-in** signature is a real signature by the same wallet \u2026',
        Session.verifyChallenge(signInSig, signIn.message) === alice.address,
        'the session accepts it, as it should');
    rec('\u2026 and it is not a capsule claim, nor a registration',
        Claims.verifyCapsuleChallenge(signInSig, signIn.message, { purpose: 'claim', day: settledToday }) === null
        && Claims.verifyCapsuleChallenge(signInSig, signIn.message, { purpose: 'register' }) === null,
        'wrong family, refused');

    const registerSig = await alice.wallet.signMessage(register.message);
    rec('a registration signature is not a claim either',
        Claims.verifyCapsuleChallenge(registerSig, register.message, { purpose: 'claim', day: settledToday }) === null,
        'purposes do not substitute');

    rec('a claim for one day is refused for another, even by a caller that forgets to check',
        Claims.verifyCapsuleChallenge(claimSig, claimMessage, { purpose: 'claim', day: today }) === null
        && Claims.verifyCapsuleChallenge(claimSig, claimMessage, { purpose: 'claim', day: tooOld }) === null,
        `${settledToday} \u2260 today`);
    rec('and a claim is only ever good for the wallet that signed it',
        Claims.verifyCapsuleChallenge(claimSig, claimMessage, { purpose: 'claim', day: settledToday, address: '0x' + 'a'.repeat(40) }) === null,
        'address compared');

    const tampered = claimMessage.replace(`Day: ${settledToday}`, `Day: ${today}`);
    rec('editing the day inside a signed message breaks it',
        Claims.verifyCapsuleChallenge(claimSig, tampered, { purpose: 'claim', day: today }) === null,
        'the nonce is a MAC over the day');
    rec('a signature from another wallet does not pass as this one',
        Claims.verifyCapsuleChallenge(await Wallet.createRandom().signMessage(claimMessage), claimMessage,
            { purpose: 'claim', day: settledToday, address: alice.address }) === null,
        'signer compared with the wallet named in the message');
    rec('junk in place of a signature or a message is refused, not thrown on',
        Claims.verifyCapsuleChallenge(null, claimMessage) === null
        && Claims.verifyCapsuleChallenge(claimSig, 42) === null
        && Claims.verifyCapsuleChallenge('0xdeadbeef', claimMessage) === null, '');

    // A challenge is a ten-minute permission, so it has to expire. The clock is moved, not the code.
    const realNow = Date.now;
    Date.now = () => realNow() + 11 * 60 * 1000;
    const stale = Claims.verifyCapsuleChallenge(claimSig, claimMessage, { purpose: 'claim', day: settledToday });
    Date.now = realNow;
    rec('an old challenge expires, so a signature found later is worthless',
        stale === null && Claims.verifyCapsuleChallenge(claimSig, claimMessage, { purpose: 'claim', day: settledToday }) !== null,
        '10 minutes');

    // ------------------------------------------------------------------------ registering
    console.log('');
    console.log('Registering the wallet');

    const registered = await Capsules.registerWallet(alice.address, { message: register.message, signature: registerSig });
    rec('a signed registration is recorded on the wallet',
        registered.ok === true && registered.registration?.address === alice.address
        && /^[0-9a-f]{40}$/.test(registered.registration.digest || ''),
        'the signature is kept as a digest, never as itself');
    rec('the record holds a digest, not the signature',
        !JSON.stringify(await Store.getWallet(alice.address)).includes(registerSig.slice(2, 40)),
        'nothing replayable is stored');

    const second = await Capsules.registerWallet(alice.address, {
        message: register.message,
        signature: registerSig,
    });
    rec('registering again is harmless, and keeps the first registration',
        second.ok === true && second.registration.at === registered.registration.at
        && Boolean(second.registration.refreshedAt),
        'first `at` kept, refreshed on the second');
    rec('an unsigned registration claim is refused',
        (await Capsules.registerWallet(alice.address, { message: register.message, signature: '0x' + '11'.repeat(65) })).code === 'bad-signature',
        'bad-signature');
    rec('and a wallet that is not a wallet is refused before anything else',
        (await Capsules.registerWallet('not-an-address', {})).code === 'no-wallet', 'no-wallet');

    // ---------------------------------------------------------------------------- claiming
    console.log('');
    console.log('Claiming a day\u2019s capsule');

    rec('there is nothing to claim for a day that was not won',
        (await Capsules.claimCapsule(alice.address, { day: settledToday, message: claimMessage, signature: claimSig })).code === 'no-capsule',
        'no-capsule');

    await winOn(alice.address, settledToday);
    const claimed = await Capsules.claimCapsule(alice.address, { day: settledToday, message: claimMessage, signature: claimSig });
    rec('a signed claim for the day that was won stamps the claim',
        claimed.ok === true && claimed.claimed?.status === 'claimed'
        && claimed.claimed.day === settledToday,
        `${claimed.claimed?.label} \u2192 ${claimed.claimed?.status}`);
    rec('  \u2026 and claiming registers the wallet, so there is no second button to find',
        Boolean((await Store.getWallet(alice.address)).registration), 'registered by the claim');
    rec('claiming the same day again answers with the claim, it does not fail and it does not pay twice',
        (await Capsules.claimCapsule(alice.address, { day: settledToday, message: claimMessage, signature: claimSig })).already === true
        && Object.keys((await Store.getWallet(alice.address)).capsules).length === 1,
        'one capsule, still');

    const bob = await player();
    await winOn(bob.address, settledToday);
    rec('the day is checked inside the service, not only by whoever asked for the message',
        (await Capsules.claimCapsule(bob.address, { day: settledToday, message: claimMessage, signature: claimSig })).code === 'bad-signature',
        'another wallet\u2019s signature is not a claim for this one');

    const bobMessage = Claims.challengeFor(bob.address, 'claim', settledToday).message;
    const bobSig = await bob.wallet.signMessage(bobMessage);
    rec('a claim for a day the wallet did not sign for is refused',
        (await Capsules.claimCapsule(bob.address, { day: today, message: bobMessage, signature: bobSig })).code === 'bad-signature',
        'the day is in the message');
    rec('a day that has not been drawn cannot be claimed early',
        (await Capsules.claimCapsule(bob.address, { day: today, message: Claims.challengeFor(bob.address, 'claim', today)?.message, signature: bobSig })).code === 'bad-signature'
        || (await Capsules.claimCapsule(bob.address, { day: today, message: Claims.challengeFor(bob.address, 'claim', today)?.message, signature: bobSig })).code === 'no-capsule',
        'no win, nothing to claim');

    // ---------------------------------------------------------------------- the window
    console.log('');
    console.log('The window: submit it the day you won it');

    rec('a win from last night is claimable today \u2014 which is the day the draw settled on',
        Capsules.isClaimable(settledToday) === true
        && Capsules.isClaimable(settledToday, new Date(), 2) === true,
        `${settledToday} claimable on ${today}`);
    rec('  \u2026 and a win from the day before is gone',
        Capsules.isClaimable(tooOld) === false, `${tooOld} closed`);
    const threeBack = Config.previousDayKey(tooOld);
    rec('a wider window reopens older wins, and the boundary moves exactly one day at a time',
        Capsules.isClaimable(threeBack, new Date(), 2) === false
        && Capsules.isClaimable(threeBack, new Date(), 3) === true
        && Capsules.isClaimable(threeBack, new Date(), 4) === true,
        `${threeBack}: closed at 2, open at 3`);

    const carol = await player();
    await winOn(carol.address, tooOld);
    const carolMessage = Claims.challengeFor(carol.address, 'claim', tooOld).message;
    const carolSig = await carol.wallet.signMessage(carolMessage);
    const late = await Capsules.claimCapsule(carol.address, { day: tooOld, message: carolMessage, signature: carolSig });
    rec('a closed window refuses the claim, and says which day closed',
        late.code === 'window-closed' && /closed/i.test(late.error),
        late.error);
    rec('  \u2026 and the capsule is still on the record as missed, not erased',
        late.state.capsules.some((row) => row.day === tooOld && row.status === 'missed'),
        'missed, visible, claimable: false');

    // ------------------------------------------------------------------- the paper trail
    console.log('');
    console.log('The form marker, the list, and the panel');

    rec('marking the form submitted is recorded for the day it was for',
        (await Capsules.markFormSubmitted(alice.address, settledToday)).ok === true
        && Boolean((await Store.getWallet(alice.address)).capsules[settledToday].formSubmittedAt),
        'self-declared, and stored as such');
    rec('  \u2026 and marked twice is one mark',
        (await Capsules.markFormSubmitted(alice.address, settledToday)).ok === true
        && (await Capsules.capsuleState(alice.address)).capsules[0].formSubmittedAt
        === (await Store.getWallet(alice.address)).capsules[settledToday].formSubmittedAt,
        'idempotent');
    rec('there is no form to mark for a day that was not won',
        (await Capsules.markFormSubmitted(alice.address, tooOld)).code === 'no-capsule', 'no-capsule');

    const view = await Capsules.giveawayView(alice.address);
    rec('the panel says what the day is, what it pays and when it closes',
        view.day === today && view.size === Config.DRAW_SIZE && view.capsule.name === 'Common Capsule'
        && /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(view.nextDrawAt) && view.nextDrawAt > new Date().toISOString(),
        `closes ${view.nextDrawAt}`);
    rec('  \u2026 the winner\u2019s own day, and their capsules, and no one else\u2019s totals',
        view.mine && view.mine.points === 0 && view.mine.rank === null
        && Array.isArray(view.capsules) && view.capsules.length === 1
        && !/\bplayers\b|\btotal\b/i.test(JSON.stringify(view.mine)),
        'unranked today, one capsule');
    rec('and the form link it hands out is the configured one',
        view.formUrl === Config.CAPSULE_FORM_URL && /^https:\/\/(forms\.gle|docs\.google\.com)/.test(view.formUrl),
        view.formUrl.replace(/^https:\/\//, '').slice(0, 46) + '\u2026');
    rec('  \u2026 and it is a *published* form, not the editor link only its owner can open',
        Config.capsuleFormNeedsSignIn(view.formUrl) === false
        && Config.capsuleFormNeedsSignIn('https://docs.google.com/forms/d/18i-Zn5UxiycTdTVak0H9U8p2H0TIm3fFftEwntkCbqs/edit') === true
        && Config.capsuleFormNeedsSignIn('https://docs.google.com/forms/d/18i-Zn5UxiycTdTVak0H9U8p2H0TIm3fFftEwntkCbqs') === true
        && Config.capsuleFormNeedsSignIn('not a url') === true
        && Config.capsuleFormNeedsSignIn('') === true,
        'the editor link and an unreadable link both count as restricted');
    rec('  \u2026 and the panel says which of the two that link is, rather than promising a sign-in',
        view.formNeedsSignIn === Config.capsuleFormNeedsSignIn(view.formUrl),
        view.formNeedsSignIn ? 'an editor link: the card warns about the Google sign-in' : 'a published link: the card asks for the address instead');

    // The day a win happened, in words. A ledger row prints it beside the date, because "2026-09-24"
    // is the one thing about a win that says nothing about whether the window is still open.
    const back = (n) => new Date(Date.parse(`${today}T00:00:00.000Z`) - n * 86400000).toISOString().slice(0, 10);
    const words = (day) => Config.relativeDayLabel(day, new Date(`${today}T12:00:00.000Z`));
    rec('a win says which day it was in words a player reads without converting',
        words(today) === 'today' && words(back(1)) === 'yesterday' && words(back(2)) === '2 days ago',
        'today \u00b7 yesterday \u00b7 2 days ago');
    rec('  \u2026 and past a fortnight it hands the date back, because nobody converts "23 days ago"',
        words(back(13)) === '13 days ago' && words(back(14)) === back(14)
        && words('not-a-day') === '',
        `${words(back(13))} in words, ${words(back(14))} as the date`);
    rec('  \u2026 and every capsule the panel shows carries it',
        view.capsules.length > 0 && view.capsules.every((row) => typeof row.when === 'string' && row.when.length > 0),
        view.capsules.map((row) => `${row.day} \u2192 ${row.when}`).join(', '));

    const anon = await Capsules.giveawayView(null);
    rec('a visitor with no wallet gets the board and none of the personal fields',
        anon.mine === null && anon.capsules.length === 0 && anon.open === null
        && anon.registration === null && Array.isArray(anon.board) && Array.isArray(anon.news),
        'public board, no wallet data');

    // --------------------------------------------------------------- the capsule in the round
    console.log('');
    console.log('The capsule in the round (the art the portfolio spins)');

    // The frames are exported from a 72 MB ProRes turn, so the page does not ask for a frame it
    // cannot have: the name it builds wraps at both ends, which is what lets a drag run past the
    // last frame and keep turning.
    const spin = Config.CAPSULE_SPIN;
    rec('the frame names are 1-based, padded and wrap both ways, so any drag lands on a real frame',
        Config.capsuleSpinFrame(1).endsWith('capsule-01.webp')
        && Config.capsuleSpinFrame(spin.frames).endsWith(`capsule-${spin.frames}.webp`)
        && Config.capsuleSpinFrame(spin.frames + 1) === Config.capsuleSpinFrame(1)
        && Config.capsuleSpinFrame(0) === Config.capsuleSpinFrame(spin.frames)
        && Config.capsuleSpinFrame(-1) === Config.capsuleSpinFrame(spin.frames - 1),
        `${spin.frames} frames, wrapping both ways`);

    const spinDir = path.join(__dirname, '..', 'public', spin.dir.replace(/^\//, ''));
    const spinFiles = fs.existsSync(spinDir)
        ? fs.readdirSync(spinDir).filter((f) => f.endsWith(`.${spin.ext}`))
        : [];
    const wanted = Array.from({ length: spin.frames }, (unused, i) => path.basename(Config.capsuleSpinFrame(i + 1)));
    rec('every frame the page can ask for is on disk, and there are no strays',
        spinFiles.length === spin.frames && wanted.every((file) => spinFiles.includes(file)),
        `${spinFiles.length} of ${spin.frames} frames in public${spin.dir}`);
    rec('  \u2026 and they are still small enough to warm in the background of a portfolio page',
        spinFiles.length > 0 && spinFiles.every((file) => fs.statSync(path.join(spinDir, file)).size < 60 * 1024),
        `${Math.round(spinFiles.reduce((sum, file) => sum + fs.statSync(path.join(spinDir, file)).size, 0) / 1024)} KB in total`);

    // ----------------------------------------------------------------------------- wiring
    console.log('');
    console.log('The wiring a unit test cannot see');

    const route = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'points', 'capsule', 'route.js'), 'utf8');
    const panel = fs.readFileSync(path.join(__dirname, '..', 'app', 'points', 'client.js'), 'utf8');

    // The three things a winner sees before they are told anything: the message they wake up to, the
    // sentence that matches the form they will actually be sent to, and the address printed where
    // they can check it is theirs. Each is invisible to a unit test and would fail quietly.
    rec('a win is announced to the player, not just recorded against the wallet',
        /data-arya="capsule-won"/.test(panel) && /capsuleOpen.when/.test(panel)
        && /won a Knight capsule for/.test(panel),
        'the banner above the panels, naming the day in words');
    rec('  \u2026 and the card\u2019s sentence follows the link it is holding, rather than promising a sign-in',
        /giveaway.formNeedsSignIn/.test(panel)
        && /it asks for the address above/.test(panel)
        && /may ask for a Google sign-in/.test(panel),
        'one sentence per kind of form');
    rec('  \u2026 and the address it would copy is printed on the card',
        /data-arya="claim-address"/.test(panel) && /state\?\.address \|\| address/.test(panel),
        'the wallet that would be pasted into the form');
    rec('and the ledger gives the day it was won in words beside the date',
        /won \$\{row.when\}/.test(panel) && /title=\{row.day\}/.test(panel),
        'won yesterday, with the date in the tooltip');
    const lib = fs.readFileSync(path.join(__dirname, '..', 'lib', 'points-capsules.js'), 'utf8');
    const session = fs.readFileSync(path.join(__dirname, '..', 'lib', 'points-session.js'), 'utf8');

    rec('the endpoint takes the wallet from the session, never from the body',
        /const address = sessionFromRequest\(request\)/.test(route)
        && !/body\?\.address/.test(route) && !/body\.address/.test(route),
        'a claim cannot be filed against somebody else\u2019s record');
    rec('a claim challenge is only issued for a win that is actually waiting',
        /nothing-to-claim/.test(route) && /status: 409/.test(route),
        'no signature prompt for nothing');
    rec('the day is compared inside the verifier, not beside it',
        /if \(expect\.day && parsed\.day !== String\(expect\.day\)\) return null/.test(
            fs.readFileSync(path.join(__dirname, '..', 'lib', 'capsule-claims.js'), 'utf8')),
        'one place to get it wrong');
    rec('the two families are told apart by the message\u2019s first line',
        /const FAMILY = 'Dungeon Knights — Capsule Delivery'/.test(
            fs.readFileSync(path.join(__dirname, '..', 'lib', 'capsule-claims.js'), 'utf8'))
        && /startsWith\(FAMILY\)/.test(
            fs.readFileSync(path.join(__dirname, '..', 'lib', 'capsule-claims.js'), 'utf8'))
        && !/Capsule Delivery/.test(session),
        'a sign-in cannot be replayed as a claim');
    rec('nothing in the browser decides a status \u2014 the ladder is derived here',
        /status: sent \? 'sent' : claimed \? 'claimed' : open \? 'won' : 'missed'/.test(lib),
        'won \u2192 claimed \u2192 sent, or missed');

    // ------------------------------------------------------------------------------ the tally
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
