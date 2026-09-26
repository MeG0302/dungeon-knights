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
const http = require('http');
const os = require('os');
const path = require('path');

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

/**
 * A stand-in for the owner's Google Form.
 *
 * The filing path is a real POST to a real page, so the only honest way to check it is against one:
 * this serves a page shaped the way Google's is — a `formResponse` action, the hidden fields a
 * browser would post back, and the `FB_PUBLIC_LOAD_DATA_` blob that names the questions — and keeps
 * every submission it receives.
 *
 * It is deliberately **not** docs.google.com. A harness that wrote a row into the owner's sheet every
 * time it ran would be worse than no harness, so every claim in this file is pointed at one of these.
 */
function startForm({ questions = [
    { title: 'Wallet address', entryId: 111 },
    { title: 'Date won', entryId: 222 },
], status = 200 } = {}) {
    const state = { posts: [], gets: 0, url: null, close: null };
    const load = [null, questions.map((q, index) => [100 + index, q.title, null, index === 0 ? 0 : 1, [[q.entryId, null, 0]]])];
    const server = http.createServer((req, res) => {
        if (req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
                state.posts.push(body);
                res.writeHead(status, { 'content-type': 'text/html' });
                res.end(`<html><title>${status === 200 ? 'Your response has been recorded' : 'Error'}</title></html>`);
            });
            return;
        }
        state.gets += 1;
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end([
            '<html><head><title>daily capsule winners </title></head><body>',
            `<!-- a shape only a walk can read: the questions are nested arrays -->`,
            `<form action="${state.url ? state.url.replace('/viewform', '/formResponse') : '/formResponse'}" method="POST" id="mG61Hd">`,
            '<input type="hidden" name="fvv" value="1">',
            '<input type="hidden" name="pageHistory" value="0">',
            '<input type="hidden" name="fbzx" value="4321987650123456789">',
            '</form>',
            `<script>var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify(load)};</script>`,
            '</body></html>',
        ].join(''));
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            state.url = `http://127.0.0.1:${port}/viewform`;
            state.close = () => new Promise((done) => server.close(() => done()));
            resolve(state);
        });
    });
}

/** An address nothing is listening on, for the "the form is a typo" case. */
async function closedPort() {
    const probe = await startForm();
    const { port, hostname } = new URL(probe.url);
    await probe.close();
    return `http://${hostname}:${port}/viewform`;
}

/** One field out of a submission body, the way Google would read it. */
function posted(body, entryId) {
    return new URLSearchParams(body || '').get(`entry.${entryId}`);
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

    // Before any module reads it: a claim files its win, and no claim in this file may file into the
    // owner's real sheet. The shipped default link is checked separately, by reading the config.
    const form = await startForm();
    process.env.CAPSULE_FORM_URL = form.url;

    const { Wallet } = await import('ethers');
    const Config = await import('../lib/points-config.js');
    const Store = await import('../lib/points-store.js');
    const Session = await import('../lib/points-session.js');
    const Claims = await import('../lib/capsule-claims.js');
    const Capsules = await import('../lib/points-capsules.js');
    const Form = await import('../lib/capsule-form.js');

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

    // --------------------------------------------------------------- the form the win is filed in
    console.log('');
    console.log('Filing the win into the form');

    // Alice's claim above ran against the configured form, which is this fake one: the whole point is
    // that nobody pastes anything any more, so the claim itself has to be the submission.
    rec('a claim posts the winner\u2019s wallet and the day it won, with nobody opening a form',
        posted(form.posts[0], 111) === alice.address && posted(form.posts[0], 222) === settledToday,
        `${posted(form.posts[0], 111)} \u00b7 ${posted(form.posts[0], 222)}`);
    rec('  \u2026 and it is a real form submission, hidden fields and all, not just the answers',
        posted(form.posts[0], 111) !== null
        && new URLSearchParams(form.posts[0] || '').get('fvv') === '1'
        && new URLSearchParams(form.posts[0] || '').get('fbzx') === '4321987650123456789',
        'fvv and the page marker ride along');
    const aliceWin = (await Store.getWallet(alice.address)).capsules[settledToday];
    rec('  \u2026 and the record says the *server* filed it, which is a different fact from \u201cthe player says so\u201d',
        Boolean(aliceWin.formSubmittedAt) && aliceWin.formSubmittedVia === 'server'
        && Capsules.capsuleView(aliceWin).formVia === 'server',
        `via ${aliceWin.formSubmittedVia}`);
    rec('  \u2026 and a win marked by hand still reads as the player\u2019s own word',
        Capsules.capsuleView({ ...aliceWin, formSubmittedVia: null }).formVia === 'player',
        'server and player are not the same claim');

    rec('filing the same win again is not a second entry',
        (await Capsules.fileCapsuleWin(alice.address, settledToday)).already === true
        && form.posts.length === 1,
        'idempotent, so a backfill run twice cannot double a day');
    rec('and the form itself is read once, not once per claim',
        form.gets === 1,
        `${form.gets} page load(s) for ${form.posts.length} submission(s)`);

    // The owner's form has a single paragraph box called `knight capsule`. The wallet and the date
    // still have to reach him — dropping the date because there was no question for it would be the
    // quiet kind of data loss.
    const single = await startForm({ questions: [{ title: 'knight capsule', entryId: 663715722 }] });
    Form.forgetCapsuleForms();
    const erin = await player();
    await winOn(erin.address, settledToday);
    const erinMessage = Claims.challengeFor(erin.address, 'claim', settledToday).message;
    const erinClaim = await Capsules.claimCapsule(erin.address, {
        day: settledToday,
        message: erinMessage,
        signature: await erin.wallet.signMessage(erinMessage),
        formUrl: single.url,
    });
    rec('a one-question form gets one line: the wallet and the date together, nothing dropped',
        erinClaim.filed === true
        && posted(single.posts[0], 663715722) === Form.capsuleEntryLine({ address: erin.address, day: settledToday })
        && /\u00b7/.test(posted(single.posts[0], 663715722) || ''),
        posted(single.posts[0], 663715722));

    // A form that is down. The claim is the fact; the note about it is not allowed to be the reason a
    // player loses a capsule.
    const broken = await startForm({ status: 500 });
    Form.forgetCapsuleForms();
    const frank = await player();
    await winOn(frank.address, settledToday);
    const frankMessage = Claims.challengeFor(frank.address, 'claim', settledToday).message;
    const frankClaim = await Capsules.claimCapsule(frank.address, {
        day: settledToday,
        message: frankMessage,
        signature: await frank.wallet.signMessage(frankMessage),
        formUrl: broken.url,
    });
    const frankWin = (await Store.getWallet(frank.address)).capsules[settledToday];
    rec('a form that refuses the entry does not refuse the claim',
        frankClaim.ok === true && frankClaim.filed === false && Boolean(frankWin.claimedAt),
        'claimed either way');
    rec('  \u2026 and the win is left looking unfiled, with the reason on it, so it can be retried',
        !frankWin.formSubmittedAt && frankWin.formSubmittedVia === undefined
        && typeof frankWin.formError === 'string' && frankWin.formError.length > 0,
        frankWin.formError);
    rec('  \u2026 and handing it over by hand still works, and reads as the player\u2019s word',
        (await Capsules.markFormSubmitted(frank.address, settledToday)).ok === true
        && (await Store.getWallet(frank.address)).capsules[settledToday].formSubmittedVia === 'player',
        'the fallback the card offers');

    // A form that is not there at all — a typo, or a link that was edited. Same shape of answer.
    Form.forgetCapsuleForms();
    const unreachable = await closedPort();
    const grace = await player();
    await winOn(grace.address, settledToday);
    const graceMessage = Claims.challengeFor(grace.address, 'claim', settledToday).message;
    const graceClaim = await Capsules.claimCapsule(grace.address, {
        day: settledToday,
        message: graceMessage,
        signature: await grace.wallet.signMessage(graceMessage),
        formUrl: unreachable,
    });
    rec('a form that cannot be reached at all gives the same answer \u2014 the claim stands, the entry does not',
        graceClaim.ok === true && graceClaim.filed === false
        && typeof graceClaim.filedError === 'string'
        && /could not be reached|could not be read|did not answer/.test(graceClaim.filedError),
        graceClaim.filedError);
    rec('and a form link that is not a link is refused, never thrown on',
        await (async () => {
            try {
                const result = await Form.submitCapsuleEntry({
                    formUrl: 'not a url', address: alice.address, day: settledToday,
                });
                return result.ok === false && typeof result.error === 'string';
            } catch {
                return false;
            }
        })(), 'refusals, not exceptions');

    // ----------------------------------------------------------- reading a form, without a network
    console.log('');
    console.log('Reading the form\u2019s own page');

    const page = [
        '<html><head><title>daily capsule winners </title></head><body>',
        '<form action="/forms/d/e/ABC/formResponse" method="POST"><input type="hidden" name="fvv" value="1"></form>',
        '<script>var FB_PUBLIC_LOAD_DATA_ = [null,[[1,"Wallet address",null,0,[[11,null,0]]],[2,"Date won",null,1,[[22,null,0]]]]];</script>',
        '</body></html>',
    ].join('');
    const parsed = Form.parseCapsuleForm(page, 'https://docs.google.com/forms/d/e/ABC/viewform');
    rec('the questions come out of the page\u2019s own data, titles and entry ids together',
        parsed?.questions.length === 2 && parsed.questions[0].entryId === '11'
        && parsed.questions[1].title === 'Date won' && parsed.questions[1].entryId === '22',
        parsed?.questions.map((q) => `${q.title}\u2192${q.entryId}`).join(', '));
    rec('  \u2026 and the POST target is resolved against the page it was found on',
        parsed?.actionUrl === 'https://docs.google.com/forms/d/e/ABC/formResponse',
        parsed?.actionUrl);
    rec('  \u2026 with the hidden fields a browser would have sent back',
        parsed?.hidden?.fvv === '1', 'the page marker is captured, not invented');
    rec('a wallet question takes the address and a date question takes the day',
        JSON.stringify(Form.capsuleEntryValues({ questions: parsed.questions, address: alice.address, day: settledToday }).values)
        === JSON.stringify({ 'entry.11': alice.address, 'entry.22': settledToday }),
        'typing the wallet into the date box is the bug this prevents');
    rec('  \u2026 and a wallet question with no date question keeps both in one cell',
        Form.capsuleEntryValues({
            questions: [{ title: 'Wallet address', entryId: 7 }], address: alice.address, day: settledToday,
        }).values['entry.7'] === Form.capsuleEntryLine({ address: alice.address, day: settledToday }),
        'the date is never dropped');
    rec('a form with nothing to fill is refused rather than posted into nothing',
        Form.capsuleEntryValues({ questions: [], address: alice.address, day: settledToday }).error === 'the form asks for nothing',
        'asks for nothing');
    rec('and a page that is not a form is not mistaken for one',
        Form.parseCapsuleForm('<html><body>hello</body></html>') === null
        && Form.parseCapsuleForm('') === null, '');

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
        view.formUrl === Config.CAPSULE_FORM_URL,
        view.formUrl.replace(/^https?:\/\//, '').slice(0, 46) + '\u2026');
    // This file points the configured link at its own fake form, so the *shipped* default is checked
    // where it actually lives — in the source — rather than where the harness made it point.
    const configSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'points-config.js'), 'utf8');
    rec('  \u2026 and the shipped default is the owner\u2019s own form, and a fill link at that',
        /forms\.gle\/sJk6MEta7BpEsTeY9/.test(configSource)
        && Config.capsuleFormNeedsSignIn('https://forms.gle/sJk6MEta7BpEsTeY9') === false,
        'forms.gle/sJk6MEta7BpEsTeY9 \u2014 published, so nobody meets a sign-in');
    rec('  \u2026 and it is a *published* form, not the editor link only its owner can open',
        Config.capsuleFormNeedsSignIn('https://docs.google.com/forms/d/18i-Zn5UxiycTdTVak0H9U8p2H0TIm3fFftEwntkCbqs/edit') === true
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
        && /it asks for the wallet address printed below/.test(panel)
        && /may ask for a Google sign-in/.test(panel),
        'one sentence per kind of form');
    // The one sentence a winner reads before they sign. The claim registers the wallet and the capsule
    // arrives when the chain does, and all three states of the card say it the same way — a promise
    // that is true on the waiting branch and stale on the filed one is worse than no promise.
    rec('the claim card promises registration and a delivery with a date on it',
        /Claim your capsule, and we will register your wallet\./.test(panel)
        && /When the mainnet goes live your knight capsule will be sent to you\./.test(panel)
        && (panel.match(/\$\{CAPSULE_DELIVERY\}/g) || []).length === 3,
        'the owner\u2019s sentence, said the same way in all three states');
    rec('  \u2026 and there is no copy-my-address option left on the card to ask for',
        !/Copy my address/i.test(panel) && !/handleCopyWallet/.test(panel) && !/capsuleCopied/.test(panel),
        'nothing to copy, because the server files it and nothing is pasted');
    rec('  \u2026 and the address is still printed on the card where a form has to ask for it',
        /data-arya="claim-address"/.test(panel) && /state\?\.address \|\| address/.test(panel)
        && /data-arya="capsule-unfiled-form"/.test(panel),
        'the wallet that goes in by hand, on the unfiled-win card alone');
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

    // The filing is a network call, and the one way it could go wrong is by being part of the write:
    // a store mutation that waits on Google is a claim that a slow form can lose.
    const claimSource = lib.slice(lib.indexOf('export async function claimCapsule'), lib.indexOf('export async function fileCapsuleWin'));
    rec('the claim is written first and filed second, never the other way round',
        claimSource.indexOf('updateWallet(') > -1
        && claimSource.indexOf('updateWallet(') < claimSource.indexOf('fileCapsuleWin('),
        'the record is the claim; the form is a note about it');
    rec('  \u2026 and the card only offers the form when the filing did not happen',
        /formVia === 'server'/.test(panel) && /capsuleOpen\.formError/.test(panel)
        && /data-arya="capsule-unfiled-form"/.test(panel),
        'nothing to paste \u2014 with the link kept for the day it fails');
    rec('  \u2026 and one filing function serves both the claim and the catch-up tool',
        /from '\.\/capsule-form\.js'/.test(lib)
        && /Capsules\.fileCapsuleWin\(/.test(fs.readFileSync(path.join(__dirname, '..', 'tools', 'points-capsules.js'), 'utf8')),
        'the same code path, so the backfill cannot drift from the claim');
    rec('and nothing here writes into the owner\u2019s real form: every claim is pointed at a fake',
        form.url.startsWith('http://127.0.0.1:') && Config.CAPSULE_FORM_URL === form.url
        && form.posts.length > 0,
        `${form.posts.length} submission(s), all to ${form.url.replace(/\/viewform$/, '')}`);

    // ------------------------------------------------------------------------------ the tally
    // The fake forms are real listeners, and an open one keeps Node alive for ever — the tally would
    // never print. Nothing here asserts on them after this point.
    for (const server of [form, single, broken]) {
        try {
            await server.close();
        } catch {
            // A socket left in the pool is not a reason to fail a check that already passed.
        }
    }

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
