#!/usr/bin/env node
/**
 * Can a forged follow delivery buy 500 points?
 *
 *     node tools/check-x-webhook.js
 *
 * `check-points-x.js` covers what the program pays once X has told us who followed. This file
 * covers the half that decides *whether X told us anything at all* — and it is the half where a
 * mistake is silent rather than loud. A verifier that accepts a wrongly signed delivery pays a
 * reward for a fact nobody reported; a verifier that accepts only re-serialised bodies rejects every
 * genuine event and looks like an outage instead of a bug. Neither failure shows up in a browser,
 * and neither is caught by testing the paid path.
 *
 * So everything here runs **offline against real HMACs**: no network, no key, no rate limit. The
 * signature is the deployment's own `X_CONSUMER_SECRET`, synthesised here, and the signature check
 * is exercised the way the endpoint does it — over the exact bytes of the body as read from the
 * request, never over a parsed object that was turned back into JSON.
 *
 * The last section reads the **route source** rather than calling it, because the order of its two
 * statements is the security property: read the raw body, verify it, and only then look inside. That
 * order cannot be observed from a unit test on this side of `NextResponse`, so it is asserted where
 * it lives.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const ROUTE_PATH = path.join(ROOT, 'app', 'api', 'x', 'events', 'route.js');

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

/** Source with comments stripped — a guard that reads prose fails on its own explanation. */
function code(source) {
    return String(source)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
}

(async () => {
    console.log('');
    console.log('X follow deliveries');

    const Webhook = await import(pathToFileURL(path.join(ROOT, 'lib', 'x-webhook.js')).href);
    const Config = await import(pathToFileURL(path.join(ROOT, 'lib', 'points-config.js')).href);
    const moduleSource = fs.readFileSync(path.join(ROOT, 'lib', 'x-webhook.js'), 'utf8');
    const routeSource = fs.readFileSync(ROUTE_PATH, 'utf8');

    const SECRET = 'harness-consumer-secret';
    const sign = (body, secret = SECRET) =>
        `sha256=${crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64')}`;
    const OUR_ID = '42424242';

    // ------------------------------------------------------------------- the CRC handshake
    // X asks once, before it will deliver anything, and expects this exact token. Getting it wrong
    // does not produce an error anywhere a developer would look — the webhook is simply never
    // subscribed, and every later question ("why are no events arriving?") is asked about a URL that
    // was never wired up.
    console.log('The CRC handshake');

    const crcToken = 'the-crc-token-x-sends';
    const expectedCrc = `sha256=${crypto.createHmac('sha256', SECRET).update(crcToken, 'utf8').digest('base64')}`;
    rec('the CRC answer is sha256=<base64 hmac> over the token it was given',
        Webhook.crcResponseToken(crcToken, SECRET) === expectedCrc,
        Webhook.crcResponseToken(crcToken, SECRET));
    rec('  … and it is the token that is signed, not the URL or a constant',
        Webhook.crcResponseToken('a-different-token', SECRET) !== expectedCrc);
    rec('  … so a different secret gives a different answer',
        Webhook.crcResponseToken(crcToken, 'another-secret') !== expectedCrc);
    rec('no token, no answer — rather than an answer computed from nothing',
        Webhook.crcResponseToken('', SECRET) === null && Webhook.crcResponseToken(null, SECRET) === null);
    rec('and no secret is an admission, not an empty-string HMAC',
        Webhook.crcResponseToken(crcToken, '') === null,
        'a token HMACd with "" would verify for anyone who guessed there was no secret');

    // ----------------------------------------------------------------------- the signature
    // Every delivery carries `sha256=<base64 hmac>` of the **raw body** in one header. This is the
    // only thing standing between the store and a stranger posting whatever facts they like.
    console.log('');
    console.log('The delivery signature');

    const body = JSON.stringify({
        for_user_id: OUR_ID,
        follow_events: [{
            type: 'follow',
            created_at: '2026-09-21T10:00:00.000Z',
            source: { id: '99001', screen_name: 'KnightFan' },
            target: { id: OUR_ID, screen_name: 'DNGrobinhood' },
        }],
    });
    const goodHeader = sign(body);

    rec('a delivery signed with our own secret is trusted',
        Webhook.verifyWebhookSignature(body, goodHeader, SECRET) === true);
    rec('  … and the header it is read from is X\u2019s own name',
        Webhook.SIGNATURE_HEADER === 'x-twitter-webhooks-signature', Webhook.SIGNATURE_HEADER);

    rec('a body edited after it was signed is refused',
        Webhook.verifyWebhookSignature(body.replace('99001', '99002'), goodHeader, SECRET) === false);
    rec('a signature from another secret is refused',
        Webhook.verifyWebhookSignature(body, sign(body, 'not-our-secret'), SECRET) === false);
    rec('an absent, empty or non-string header is refused',
        Webhook.verifyWebhookSignature(body, undefined, SECRET) === false
        && Webhook.verifyWebhookSignature(body, '', SECRET) === false
        && Webhook.verifyWebhookSignature(body, 12345, SECRET) === false);
    rec('a wrong-length header is refused instead of throwing',
        Webhook.verifyWebhookSignature(body, 'sha256=short', SECRET) === false,
        'timingSafeEqual throws on a length mismatch — a forged delivery must not be an unhandled 500');
    rec('an unconfigured deployment accepts nothing, even a signature that matches ""',
        Webhook.verifyWebhookSignature(body, sign(body, ''), '') === false,
        'the failure this guards is a deployment that treats "no secret" as "no check"');
    rec('a trailing newline on the header is tolerated, a different value is not',
        Webhook.verifyWebhookSignature(body, ` ${goodHeader}\n`, SECRET) === true
        && Webhook.verifyWebhookSignature(body, `${goodHeader}x`, SECRET) === false);

    // The reason the route reads `request.text()`: a parsed-then-re-serialised body is different
    // bytes, so a signature checked against it fails for every delivery, including the genuine ones.
    const respaced = JSON.stringify(JSON.parse(body));
    const reordered = JSON.stringify({
        follow_events: JSON.parse(body).follow_events,
        for_user_id: OUR_ID,
    });
    rec('the signature is over the raw bytes, not a re-encoding of the parsed body',
        respaced === body
        && Webhook.verifyWebhookSignature(reordered, goodHeader, SECRET) === false,
        'the same JSON in a different key order fails the check, which is exactly why the route never re-serialises');

    // -------------------------------------------------------------------------- the payload
    console.log('');
    console.log('Reading a delivery');

    const parsed = Webhook.parseFollowEvents(JSON.parse(body), { targetId: OUR_ID });
    rec('a follow is read as one, with the id as the key and the handle normalised',
        parsed.ok && parsed.events.length === 1
        && parsed.events[0].id === '99001'
        && parsed.events[0].username === 'knightfan'
        && parsed.events[0].following === true,
        JSON.stringify(parsed.events[0]));

    const unfollow = Webhook.parseFollowEvents({
        for_user_id: OUR_ID,
        follow_events: [{ type: 'unfollow', source: { id: '99001', screen_name: 'KnightFan' }, target: { id: OUR_ID } }],
    }, { targetId: OUR_ID });
    rec('an unfollow is a fact too, and it is not read as a follow',
        unfollow.ok && unfollow.events[0].following === false,
        'otherwise a wallet that unfollowed keeps its 500 points forever');

    const mixed = Webhook.parseFollowEvents({
        for_user_id: OUR_ID,
        follow_events: [
            { type: 'Follow', source: { id: '99002', screen_name: 'cased' }, target: { id: OUR_ID } },
            { type: 'like', source: { id: '99003', screen_name: 'liker' }, target: { id: OUR_ID } },
            { type: 'follow', source: { id: 'not-a-number', screen_name: 'weird' }, target: { id: OUR_ID } },
            { type: 'follow', source: { id: '99004' }, target: { id: OUR_ID } },
            { type: 'follow', source: { id: '99005', screen_name: 'someoneelse' }, target: { id: '99999999' } },
        ],
    }, { targetId: OUR_ID });
    rec('only the two verbs this program has an opinion about are acted on',
        mixed.ok && mixed.events.length === 2
        && mixed.events.some((e) => e.id === '99002'),
        `${mixed.events.length} of 5 events recognised, ${mixed.skipped} skipped`);
    rec('  … an unrecognised type is skipped, never guessed into a follow',
        !mixed.events.some((e) => e.id === '99003'), 'defaulting to "follow" would pay for a misread event');
    rec('  … a source without a usable id is skipped',
        !mixed.events.some((e) => e.username === 'weird'), 'an event keyed on nothing cannot be recorded');
    rec('  … an event about somebody else\u2019s followers is not ours to pay for',
        !mixed.events.some((e) => e.id === '99005'), `targetId ${OUR_ID}`);
    rec('  … and an event with no handle still carries the id it will be filed under',
        mixed.events.some((e) => e.id === '99004' && e.username === null));

    const notOurs = Webhook.parseFollowEvents(JSON.parse(body).follow_events
        ? { for_user_id: '11111111', follow_events: JSON.parse(body).follow_events }
        : {}, { targetId: OUR_ID });
    rec('a delivery addressed to another account is refused outright',
        notOurs.ok === false && notOurs.code === 'not-ours' && notOurs.events.length === 0,
        notOurs.reason);

    const shapes = [
        [null, 'null'],
        ['a string', 'a string'],
        [[], 'an array'],
        [{}, 'an object with nothing in it'],
        [{ follow_events: 'nope' }, 'follow_events that is not a list'],
    ];
    rec('a payload of an unexpected shape is answered, not thrown at',
        shapes.every(([payload]) => {
            try {
                const r = Webhook.parseFollowEvents(payload, { targetId: OUR_ID });
                return r.ok === false && r.code === 'unrecognised';
            } catch {
                return false;
            }
        }),
        shapes.map(([, why]) => why).join(', '));
    rec('  … and whether an unreadable delivery is accepted is the route’s call, not this parser’s',
        /retries anything that is not a 2xx/.test(moduleSource),
        'the module reports a verdict; 200-with-a-log versus a retry storm is decided at the route');

    // ---------------------------------------------------------- the other envelope
    // X has delivered activity to webhooks two ways: the Account Activity API's list of typed events,
    // and the X Activity API's single dotted event. The first is documented as deprecated in favour
    // of the second, and the second's payload schema could not be read offline — so both are parsed,
    // and every event has to resolve to "this actor started following us". An event that cannot be
    // resolved is skipped and counted, which is the direction that refuses a claim rather than
    // inventing one.
    console.log('');
    console.log('The X Activity envelope');

    const xaa = (payload) => Webhook.parseFollowEvents(
        { data: { event_type: 'follow.follow', ...payload } },
        { targetId: OUR_ID },
    );

    const dotted = xaa({
        filter: { user_id: OUR_ID },
        payload: { source: { id: '99010', screen_name: 'NewFan' }, target: { id: OUR_ID, screen_name: 'DNGrobinhood' } },
    });
    rec('a dotted `follow.follow` is read as a follow of ours',
        dotted.ok && dotted.events.length === 1 && dotted.events[0].id === '99010'
        && dotted.events[0].username === 'newfan' && dotted.events[0].following === true,
        JSON.stringify(dotted.events[0]));
    rec('  … and it says which envelope it read, so the log can tell them apart',
        dotted.code === 'activity-events', dotted.code);

    const dottedUnfollow = xaa({
        event_type: 'follow.unfollow',
        payload: { source: { id: '99010', screen_name: 'NewFan' }, target: { id: OUR_ID } },
    });
    rec('an unfollow is the same envelope with the other verb',
        dottedUnfollow.events[0]?.following === false, JSON.stringify(dottedUnfollow.events[0]));

    rec('  … and the other party names are understood too',
        xaa({ payload: { follower: { id: '99012', username: 'NamedDifferently' }, followed: { id: OUR_ID } } })
            .events[0]?.username === 'nameddifferently',
        'the ids decide it, not the key names — a rename on X\u2019s side must not silently stop the reward');

    // The direction this has to get right. `follow.follow` fires for **both** directions, so an event
    // where our own account did the following is not somebody following us — and paying it would be
    // 500 points for the opposite of what the task asks.
    const ourOwnFollow = xaa({
        payload: { source: { id: OUR_ID, screen_name: 'DNGrobinhood' }, target: { id: '99013', screen_name: 'SomebodyElse' } },
    });
    rec('an event where OUR account did the following is not a follower',
        ourOwnFollow.ok && ourOwnFollow.events.length === 0 && ourOwnFollow.skipped === 1,
        `${ourOwnFollow.events.length} events, ${ourOwnFollow.skipped} skipped`);

    const dottedList = Webhook.parseFollowEvents({ data: [
        { event_type: 'follow.follow', payload: { source: { id: '99014', screen_name: 'fan2' }, target: { id: OUR_ID } } },
        { event_type: 'post.create', payload: { id: '1919191919' } },
        { event_type: 'follow.follow', payload: { target: { id: OUR_ID } } },
    ] }, { targetId: OUR_ID });
    rec('a list of dotted events is read event by event',
        dottedList.events.length === 1 && dottedList.events[0].id === '99014' && dottedList.skipped === 2,
        `${dottedList.events.length} events, ${dottedList.skipped} skipped`);
    rec('  … and an event type that is not a follow is never counted as one',
        !dottedList.events.some((e) => e.id === '1919191919'), 'post.create is not a follower');

    rec('a dotted event with nobody identifiable is skipped rather than guessed at',
        xaa({ payload: { source: { screen_name: 'no-id' }, target: { id: OUR_ID } } }).events.length === 0,
        'an event keyed on nothing cannot be recorded, and must not be paid');

    // --------------------------------------------------------------------------- the mode
    // Which of the two sentences the card uses, and whether a claim is checked at all, hangs off
    // this function. It is one env var and one secret, and it must never report a check that cannot
    // run — a deployment that says "verified" while nothing verifies is worse than one that admits
    // it cannot tell.
    console.log('');
    console.log('What this deployment can prove');

    const saved = {
        mode: process.env.FOLLOW_PROOF_MODE,
        secret: process.env.X_CONSUMER_SECRET,
        target: process.env.X_FOLLOW_TARGET_ID,
    };
    const restore = () => {
        for (const [key, value] of [['FOLLOW_PROOF_MODE', saved.mode], ['X_CONSUMER_SECRET', saved.secret], ['X_FOLLOW_TARGET_ID', saved.target]]) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    };

    delete process.env.FOLLOW_PROOF_MODE;
    delete process.env.X_CONSUMER_SECRET;
    rec('with nothing configured, a follow is a claim and the page will say so',
        Webhook.followProofMode() === 'claim', Webhook.followProofMode());

    process.env.FOLLOW_PROOF_MODE = 'webhook';
    rec('asking for the webhook without a secret does not turn it on',
        Webhook.followProofMode() === 'claim',
        'there would be no way to tell a delivery from a forgery');

    process.env.X_CONSUMER_SECRET = SECRET;
    rec('  … and with the secret it is on',
        Webhook.followProofMode() === 'webhook', Webhook.followProofMode());
    rec('  … tolerating the way env vars actually get typed',
        (process.env.FOLLOW_PROOF_MODE = ' WebHook ', Webhook.followProofMode() === 'webhook'));
    rec('  … and anything else means the honest default',
        (process.env.FOLLOW_PROOF_MODE = 'true', Webhook.followProofMode() === 'claim'));
    rec('the mode is read when it is asked for, not frozen when the module loaded',
        (process.env.FOLLOW_PROOF_MODE = 'webhook', Webhook.followProofMode() === 'webhook'));

    rec('our own account id is configuration, not a constant in the code',
        Webhook.followTargetId() === '' || /^\d+$/.test(Webhook.followTargetId()),
        `read from X_FOLLOW_TARGET_ID, currently "${Webhook.followTargetId()}"`);

    restore();

    // ------------------------------------------------------------------------ the route
    // The order of two statements in the route is the security property, and it is invisible from a
    // test on this side of the handler — so it is asserted against the source.
    console.log('');
    console.log('The receiver route, as written');

    const routeCode = code(routeSource);
    rec('the route exists and is never cached',
        fs.existsSync(ROUTE_PATH) && /export const dynamic = 'force-dynamic'/.test(routeCode));
    rec('the body is read as text — a re-serialised body fails every signature',
        /await request\.text\(\)/.test(routeCode) && !/request\.json\(\)/.test(routeCode));
    rec('  … and it is verified before anything inside it is looked at',
        routeCode.indexOf('isTrustedDelivery(') > -1
        && routeCode.indexOf('isTrustedDelivery(') < routeCode.indexOf('JSON.parse('),
        'parsing first would mean trusting the payload to decide whether to trust the payload');
    rec('a delivery that is not signed by us is refused and never recorded',
        /status: 401/.test(routeCode) && routeCode.indexOf('status: 401') < routeCode.indexOf('recordFollowFact('),
        'the 401 comes back before the store is touched');
    rec('the handshake is answered with the module that holds the secret, not a second implementation',
        /answerCrcChallenge\(/.test(routeCode) && !/createHmac/.test(routeCode));
    rec('every recognised event is recorded through the store',
        /recordFollowFact\(/.test(routeCode) && /for \(const event of parsed\.events\)/.test(routeCode));
    rec('  … and one malformed event does not cost the whole delivery',
        /try \{[\s\S]*recordFollowFact[\s\S]*\} catch/.test(routeCode),
        'X has already billed the delivery and will not re-send the rest of it');
    rec('the secret is read in a module no browser bundle imports',
        !/X_CONSUMER_SECRET/.test(code(fs.readFileSync(path.join(ROOT, 'lib', 'points-config.js'), 'utf8'))),
        'points-config is imported by the vault mini-game, which ships to a browser');

    // --------------------------------------------------------------- what the page is told
    // Two tasks, two truths: the deployment decides which sentence the card uses, and the client is
    // never allowed to decide it. The proof mode is reported in state for exactly that reason.
    console.log('');
    console.log('What the page is allowed to claim');

    // Both sentences live in the registry so the *server* can pick one; a client that chose between
    // them could advertise a check nothing is running. What each says is now the interesting part:
    // the unverified one must describe the review window (a real wait, credited at the end of it) and
    // must not borrow the claim that X checked anything.
    //
    // Only the **claimed** tasks have two sentences to pick between. A task X settles itself is
    // checked the same way in every mode, so it carries one sentence and no `blurbChecked` at all —
    // and one appearing there would be copy no deployment could ever show.
    const claimTasks = Config.ONE_TIME_TASKS.filter((t) => t.proof === 'claim');
    rec('the claimed tasks carry both sentences, so the mode picks rather than writes',
        claimTasks.length > 0 && claimTasks.every((t) => {
            const unanswered = !t.blurb || !t.blurbChecked;
            if (unanswered) return false;
            return t.blurb !== t.blurbChecked
                && /short review/i.test(t.blurb)
                && !/own record|checked|X tells us/i.test(t.blurb)
                && /X tells us|own record|checked against/i.test(t.blurbChecked)
                && !/review|30\u201345 minutes/i.test(t.blurbChecked);
        }),
        'one promises a review, the other lets X settle it — and neither borrows the other’s claim');

    rec('and the unverified sentence promises the window the claims are actually given',
        Config.ONE_TIME_TASKS.every((t) => !t.review
            || (/short review/i.test(t.blurb) && /30\u201345 minutes/.test(t.blurb)
                && !/30\u201345 minutes/.test(t.blurbChecked))),
        'the card’s wait and review.minMinutes/maxMinutes are written in one file for this reason');

    // The quote-reposts are the same principle from the other side: their copy is an ask — what to do,
    // and that it is paid once — and never a paragraph about our plumbing. The blurb rule above is
    // what keeps a claim honest, and this is what keeps a *task* readable, so a word the card would
    // never say (a check it cannot run) must not creep back into the hint either.
    const postTasks = Config.ONE_TIME_TASKS.filter((t) => t.proof === 'verify');
    rec('the quote-repost cards ask for the post, and claim nothing about the check',
        postTasks.length === Config.ONE_TIME_POSTS.length && postTasks.every((t) =>
            !t.blurb && !t.blurbChecked
            && /tag[s]? @\{handle\}/.test(t.hint)
            && !/cannot see|no check|on your word|verified/i.test(t.hint)),
        `${postTasks.length} quote task(s), each one sentence: what to post and the tag`);

    rec('and each one quotes its own post, addressed by the kind the page sends back',
        new Set(postTasks.map((t) => t.url)).size === postTasks.length
        && postTasks.every((t) => t.kind === `onetime:${t.id}` && /\/status\/\d{5,25}$/.test(t.url)),
        'a task id, a kind and a post each — no two posts the same');

    console.log('');
    const failed = results.filter((r) => !r.pass);
    console.log(`${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length) {
        console.log('');
        for (const f of failed) console.log(`  FAILED: ${f.label}`);
        process.exit(1);
    }
})();
