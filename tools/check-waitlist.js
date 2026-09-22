#!/usr/bin/env node
/**
 * Does the waitlist keep what it says it keeps — and only that?
 *
 *     node tools/check-waitlist.js
 *
 * This is the one place in the project that collects **personal data**: an email address, and
 * optionally a handle and a wallet. Everything else in this repository is public information about
 * public wallets. That changes what a bug costs, so the checks are about three different things:
 *
 *   1. **What is stored.** One entry per address, filed under `sha256(email)` rather than the
 *      address itself, so a dump of the store is not an address book. Lower-case and upper-case
 *      spellings of one address are the same person, not two places in the queue.
 *   2. **What is said.** The follow is a claim, not a fact — X's free API has no view of who follows
 *      whom, which the Points Program already learned the hard way. So the field is `followClaimed`,
 *      the landing page says in words that it cannot be checked, and this file asserts both. A page
 *      that implied a check would be the single dishonest thing on it.
 *   3. **What is exposed.** `GET /api/waitlist` answers with one number and nothing else. The check
 *      for that reads the route source, because that is where the leak would be written, and a
 *      count is the only thing on the page worth showing and worth nothing to forge.
 *
 * It runs entirely against a **sandbox**: a temp working directory, so the store's own
 * `.data/waitlist.json` is a throwaway, and with the KV variables deleted so the driver is the file
 * one. Nothing here can reach production, and nothing needs cleaning up afterwards.
 *
 * The email check is deliberately described as pragmatic rather than RFC-exact: the only complete
 * validation of an address is sending mail to it, which this project does not do yet.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const ROUTE_PATH = path.join(ROOT, 'app', 'api', 'waitlist', 'route.js');
const PAGES_PATH = path.join(ROOT, 'lib', 'static-pages.js');
// The form itself. It moved off the landing page to `/genesis`, which is where the collection is
// explained — so the assertions about what a person reads have to follow it there.
const GENESIS_PATH = path.join(ROOT, 'app', 'genesis', 'client.js');
const STORE_PATH = path.join(ROOT, 'lib', 'waitlist-store.js');
const FORMS_PATH = path.join(ROOT, 'lib', 'waitlist-forms.js');

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

function section(title) {
    console.log('');
    console.log(title);
}

/** Source with comments stripped — a guard that reads prose fails on its own explanation. */
function code(source) {
    return String(source)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
}

// ---------------------------------------------------------------- the sandbox, before any import
// The store picks its driver and its file path when the module graph loads, so both have to be
// settled first. This process is about to keep its waitlist in a temp directory.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-waitlist-'));
process.chdir(sandbox);
for (const key of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
    delete process.env[key];
}

/**
 * Leave no trace.
 *
 * The `chdir` back out is not tidiness: this process is *inside* the sandbox, and Windows refuses to
 * remove a directory that is somebody's working directory (EPERM) — so the first version of this
 * file reported every check passing and then died on its own cleanup.
 */
function cleanup() {
    try { process.chdir(ROOT); } catch {}
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch {}
}

/** A snippet in a fresh process, so a driver chosen from the environment can be tested. */
function freshProcess(snippet, env = {}) {
    // Its own directory: a production-mode child would otherwise share this process's file store.
    fs.mkdirSync(path.join(sandbox, 'fresh'), { recursive: true });
    const childEnv = { ...process.env, ...env };
    for (const [key, value] of Object.entries(env)) if (value === null) delete childEnv[key];
    const script = `
        const run = async () => {
            const store = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'lib', 'waitlist-store.js')).href)});
            ${snippet}
        };
        run().then((value) => process.stdout.write('@@' + JSON.stringify(value) + '@@'))
             .catch((error) => process.stdout.write('@@' + JSON.stringify({ error: String(error && error.message || error) }) + '@@'));
    `;
    const out = execFileSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], {
        env: childEnv,
        cwd: path.join(sandbox, 'fresh'),
        encoding: 'utf8',
    });
    const match = out.match(/@@([\s\S]*)@@/);
    if (!match) throw new Error(`fresh process said nothing useful: ${out.slice(0, 400)}`);
    return JSON.parse(match[1]);
}

(async () => {
    console.log('');
    console.log('The Genesis waitlist');

    const Store = await import(pathToFileURL(path.join(ROOT, 'lib', 'waitlist-store.js')).href);

    rec('this harness is on the local file driver, so it cannot touch a real store',
        Store.WAITLIST_DRIVER === 'file', Store.WAITLIST_DRIVER);

    // -------------------------------------------------------------------------- what an address is
    section('An email address');
    const good = ['a@b.co', 'first.last@sub.domain.io', 'a+tag@example.com', 'UPPER@EXAMPLE.COM'];
    for (const value of good) {
        rec(`${value} is accepted`, Store.normaliseEmail(value) !== null, String(Store.normaliseEmail(value)));
    }
    const bad = [
        ['no at sign', 'nope'],
        ['no dot in the domain', 'a@b'],
        ['a space', 'a b@example.com'],
        ['a trailing dot', 'a@example.'],
        ['a leading dot', '.a@example.com'],
        ['two dots in a row', 'a..b@example.com'],
        ['nothing at all', ''],
        ['only whitespace', '   '],
        ['not a string', 42],
    ];
    for (const [why, value] of bad) {
        rec(`rejected: ${why}`, Store.normaliseEmail(value) === null);
    }
    rec('an over-long address is rejected rather than stored',
        Store.normaliseEmail(`${'a'.repeat(250)}@example.com`) === null);
    rec('case and surrounding space are normalised, so one person is one entry',
        Store.normaliseEmail('  Alice@Example.COM ') === 'alice@example.com');

    // ------------------------------------------------------------------------------ what is stored
    section('What is stored, and under what key');
    const key = Store.emailKey('alice@example.com');
    rec('the key is a sha256 hex digest', /^[0-9a-f]{64}$/.test(key));
    rec('  … and it does not contain the address', !key.includes('alice') && !key.includes('example'));
    rec('  … and the same address always gives the same key', Store.emailKey('ALICE@example.com') === key);
    rec('  … and a different address does not', Store.emailKey('bob@example.com') !== key);
    rec('an address that cannot be normalised has no key', Store.emailKey('nope') === null);

    // ------------------------------------------------------------------------------- what it takes
    section('Taking a signup');
    const first = await Store.addToWaitlist({ email: 'alice@example.com', followClaimed: true, source: 'landing' });
    rec('a signup is accepted and given a position', first.ok === true && first.position === 1, String(first.position));
    rec('  … and stored with the case-normalised address', first.entry.email === 'alice@example.com');
    rec('  … and the follow recorded as a claim, under a name that says so',
        first.entry.followClaimed === true && !('following' in first.entry));
    rec('  … with nothing else collected about the request — no IP, no user agent',
        !('ip' in first.entry) && !('agent' in first.entry) && Object.keys(first.entry).sort().join(',')
            === ['address', 'at', 'email', 'followClaimed', 'handle', 'position', 'source'].sort().join(','),
        Object.keys(first.entry).join(', '));

    const second = await Store.addToWaitlist({ email: 'bob@example.com' });
    rec('a second person is second in line', second.position === 2 && second.alreadyRegistered === false);
    rec('  … and the follow defaults to false rather than being assumed',
        second.entry.followClaimed === false);

    const again = await Store.addToWaitlist({ email: 'ALICE@Example.com ' });
    rec('the same address again is the same place in the queue, not a new one',
        again.alreadyRegistered === true && again.position === 1, String(again.position));
    rec('  … and it does not move anybody', (await Store.waitlistSize()) === 2, String(await Store.waitlistSize()));

    const third = await Store.addToWaitlist({ email: 'carol@example.com' });
    rec('a position never moves once given', first.entry.position === 1 && second.entry.position === 2 && third.position === 3);
    rec('the count is the number of entries', (await Store.waitlistSize()) === 3);

    const noEmail = await Store.addToWaitlist({ email: 'nope' });
    rec('an address that is not one is refused with a reason', noEmail.error && noEmail.code === 'bad-email', noEmail.code);
    rec('  … and nothing is written for it', (await Store.waitlistSize()) === 3);
    const empty = await Store.addToWaitlist({});
    rec('so is no address at all', empty.code === 'bad-email');

    // ------------------------------------------------------------------------------ the optional bits
    section('The optional handle and wallet');
    const withHandle = await Store.addToWaitlist({ email: 'dave@example.com', handle: '@Dave_1' });
    rec('a handle is stored without the @ and in lower case', withHandle.entry.handle === 'dave_1', withHandle.entry.handle);
    rec('a handle that is not one is dropped, not stored as written',
        (await Store.addToWaitlist({ email: 'eve@example.com', handle: 'has space' })).entry.handle === null);
    rec('  … and an over-long handle too',
        (await Store.addToWaitlist({ email: 'frank@example.com', handle: 'abcdefghijklmnop' })).entry.handle === null);

    const checksum = '0xAbC0000000000000000000000000000000000001';
    const withWallet = await Store.addToWaitlist({ email: 'grace@example.com', address: checksum });
    rec('a wallet is kept exactly as given, checksum and all', withWallet.entry.address === checksum, withWallet.entry.address);
    const junkWallet = await Store.addToWaitlist({ email: 'heidi@example.com', address: 'not-an-address' });
    rec('  … and something that is not an address is dropped', junkWallet.entry.address === null);
    rec('a very long source string is truncated rather than stored whole',
        (await Store.addToWaitlist({ email: 'ivan@example.com', source: 'x'.repeat(200) })).entry.source.length <= 40);

    // ---------------------------------------------------- the shape the collection page posts
    // The form moved to `/genesis`; the fields it asks for are asserted against the store rather
    // than against the markup, because the question that matters is whether the endpoint accepts
    // what the page sends — an address kept as given, and a signup with no address at all.
    section('A signup from the collection page');
    const genesisCountBefore = await Store.waitlistSize();
    const withAddress = await Store.addToWaitlist({
        email: 'genesis@example.com',
        address: '0xAbC0000000000000000000000000000000000002',
        followClaimed: true,
        source: 'genesis',
    });
    rec('an email and an EVM address arrive as one entry', withAddress.ok === true && withAddress.position > 0);
    rec('  … and the address is kept exactly as given, checksum and all',
        withAddress.entry.address === '0xAbC0000000000000000000000000000000000002');
    rec('  … and the entry records which page asked', withAddress.entry.source === 'genesis');
    const withoutAddress = await Store.addToWaitlist({ email: 'noaddress@example.com', address: null, source: 'genesis' });
    rec('an email on its own is still a place in the queue — the address is optional',
        withoutAddress.ok === true && withoutAddress.entry.address === null);
    rec('  … and it takes the next place in the same queue',
        withoutAddress.position === withAddress.position + 1, `#${withAddress.position} then #${withoutAddress.position}`);
    await Store.purgeEntry('genesis@example.com');
    await Store.purgeEntry('noaddress@example.com');
    rec('  … and both come back out again, leaving the queue as it was',
        (await Store.waitlistSize()) === genesisCountBefore, `${genesisCountBefore} → ${await Store.waitlistSize()}`);

    // -------------------------------------------------------------------------------- the rate limit
    section('The rate limit');
    const ip = '203.0.113.7';
    const tries = [];
    for (let i = 0; i < 7; i += 1) tries.push((await Store.countAttempt(ip)).allowed);
    rec('five attempts are allowed', tries.slice(0, 5).every(Boolean));
    rec('  … and the sixth is not', tries[5] === false && tries[6] === false);
    rec('  … and another connection is unaffected', (await Store.countAttempt('198.51.100.9')).allowed === true);

    const windowNow = Math.floor(Date.now() / 1000);
    const rolled = await Store.countAttempt(ip, windowNow + 120);
    rec('a new window starts counting from scratch', rolled.allowed === true && rolled.count === 1);

    const rateKey = Store.rateKeyFor(ip);
    rec('the counter is keyed by a hash of the address, not the address',
        !rateKey.includes(ip) && rateKey.startsWith('dk:waitlist:rate:'), rateKey);
    rec('  … and the same address in the same window lands on the same counter',
        Store.rateKeyFor(ip) === rateKey);
    rec('  … and a different window does not', Store.rateKeyFor(ip, 60, windowNow + 120) !== rateKey);

    // ------------------------------------------------------------------------------- the drivers
    section('Where it is actually kept');
    rec('the local description names the file it uses',
        /local file/.test(Store.storageDescription()) && Store.storageDescription().includes('.data'), Store.storageDescription());

    const prod = freshProcess('return store.storageDescription();', {
        NODE_ENV: 'production',
        KV_REST_API_URL: null,
        KV_REST_API_TOKEN: null,
        UPSTASH_REDIS_REST_URL: null,
        UPSTASH_REDIS_REST_TOKEN: null,
    });
    rec('with no store configured in production it says so, rather than looking durable',
        typeof prod === 'string' && /NOT PERSISTENT/.test(prod), prod);

    // -------------------------------------------------------------------------- the route itself
    // Read rather than called: the route imports `next/server`, which does not resolve outside the
    // bundler, and the properties being checked here are properties of the source.
    section('What the endpoint exposes');
    const routeSource = code(fs.readFileSync(ROUTE_PATH, 'utf8'));
    const getBody = routeSource.slice(routeSource.indexOf('export async function GET'), routeSource.indexOf('export async function POST'));
    rec('GET answers with a count and nothing else',
        /count:/.test(getBody) && !/email|handle|address|entries/i.test(getBody), getBody.trim().replace(/\s+/g, ' '));
    rec('  … so the queue is never enumerable through the public endpoint',
        !/listWaitlist/.test(getBody));
    rec('POST validates through the store rather than writing its own record',
        /addToWaitlist\(/.test(routeSource) && !/ENTRY_PREFIX/.test(routeSource));
    // Presence *and* order: an earlier version of this check only compared the two positions, so
    // deleting the call outright moved its index to -1 and the assertion passed on the absence of the
    // thing it was asserting. Measured with a mutation that replaced the call with `{ allowed: true }`.
    rec('the rate limit is applied, and before the store is touched',
        routeSource.includes('countAttempt(')
        && routeSource.indexOf('countAttempt(') < routeSource.indexOf('addToWaitlist('),
        'otherwise a loop writes before it is refused');
    rec('a throttled request is a 429, which a client can act on', /status: 429/.test(routeSource));
    rec('an unreachable store is a 503 and does not claim to have saved anything',
        /status: 503/.test(routeSource) && /could not be saved/.test(routeSource));
    rec('the field is named followClaimed, not following',
        /followClaimed/.test(routeSource) && !/\bfollowing\b/.test(routeSource));

    // ------------------------------------------------------------------------------- the page copy
    section('What the pages promise');
    const pages = fs.readFileSync(PAGES_PATH, 'utf8');
    const landing = pages.slice(pages.indexOf('"home"'), pages.indexOf('"home"') + 6000);
    const genesis = code(fs.readFileSync(GENESIS_PATH, 'utf8'));
    const storeSource = code(fs.readFileSync(STORE_PATH, 'utf8'));

    rec('the landing page has both calls to action',
        /Join the Points Program/.test(landing) && /Join the Genesis Waitlist/.test(landing));
    rec('  … and the points one goes to the public page', /href=\\?"\/points\\?"/.test(landing));
    rec('  … and the second one goes to the collection page',
        /href=\\?"\/genesis\\?"/.test(landing));
    rec('  … and neither promises a finished game', /Coming soon/.test(landing) && !/Play now|Enter the dungeon/i.test(landing));

    // The form lives in one place, and this is the check that says so. It was on the landing page
    // and is now on `/genesis`; a copy left behind here would be a second form to keep in step, and
    // the one a stranger's browser actually renders is the one that would rot.
    rec('the landing page no longer carries a form of its own', !/<form/.test(landing),
        'the form moved to /genesis with the collection');
    rec('  … and none of its fields are left behind either',
        !/waitlistEmail|waitlistSubmit|waitlistFollowed|waitlistCard/.test(landing));
    rec('  … and the queue count is what this page still reads',
        /id=\\?"genesisCount\\?"/.test(landing) && /home\.js/.test(landing) && /home\.css/.test(landing));

    rec('the collection page carries the one form', /<form/.test(genesis) && /id="waitlist"/.test(genesis));
    rec('the email field is typed as an email so phones offer the right keyboard',
        /id="waitlistEmail"/.test(genesis) && /type="email"/.test(genesis));
    rec('an EVM address is asked for too, and marked optional in words',
        /id="waitlistAddress"/.test(genesis) && /optional/i.test(genesis));
    rec('the address is checked before it is sent, against the same rule the store enforces',
        /\^0x\[0-9a-fA-F\]\{40\}\$/.test(genesis) && /\^0x\[0-9a-fA-F\]\{40\}\$/.test(storeSource),
        'otherwise a typo is accepted and then silently stored as null');
    rec('  … and it posts to the same endpoint, tagged as coming from this page',
        /\/api\/waitlist/.test(genesis) && /source: 'genesis'/.test(genesis));
    // The box is the player's own statement about X, and it claims no verification — the sentence
    // that used to explain what it does not prove was removed on the owner's instruction. A box the
    // person ticks must not read like a field something checked, which is what this asserts.
    rec('the follow box is the player\u2019s own statement, and claims no verification',
        /I follow/.test(genesis) && !/verified|checked against|on your word|cannot check/i.test(genesis));
    rec('  … and it links to the account it is about', /x\.com\/DNGrobinhood/.test(genesis));
    rec('the page says no wallet is needed to join', /no wallet/i.test(genesis));

    // ------------------------------------------------------------------------------ the form copy
    // Every signup is mirrored into the owner's Google Form. The route is the published one — no
    // API key — so these checks run against a stubbed fetch: what is being pinned down is *what we
    // send*, and the one failure mode that would otherwise be invisible, which is a submission that
    // comes back "recorded as nothing" with a 200.
    section("The owner's Google Form");
    const Forms = await import(pathToFileURL(FORMS_PATH).href);
    const formHtml = `<input type="hidden" name="fbzx" value="1234567890">`;

    /** A fetch that plays the form: a view page carrying a token, and a response that records. */
    function stubForm({ recordsWith = 'Your response has been recorded', token = '1234567890', tokenHtml = formHtml, failView = false } = {}) {
        const calls = { views: 0, posts: [] };
        const fetchImpl = async (url, options = {}) => {
            if (!options.method) {
                calls.views += 1;
                if (failView) throw new Error('network down');
                return { status: 200, text: async () => tokenHtml };
            }
            calls.posts.push({ url, body: String(options.body) });
            return { status: 200, text: async () => (recordsWith ? `<div>${recordsWith}</div>` : '<div>the blank form again</div>') };
        };
        return { fetchImpl, calls };
    }

    const twoAnswers = (calls) => new URLSearchParams(calls.posts[calls.posts.length - 1].body);

    {
        Forms.resetFormTokenCache();
        const { fetchImpl, calls } = stubForm();
        const sent = await Forms.forwardToForm({ email: 'alice@example.com', address: '0xAbC0000000000000000000000000000000000042' }, { fetchImpl });
        rec('a signup is written to the form', sent.ok === true, JSON.stringify(sent));
        rec('  … and it posts to the published formResponse URL, not to an API',
            calls.posts[0].url.endsWith('/formResponse'), calls.posts[0].url);
        const body = twoAnswers(calls);
        const answer = body.get(`entry.${Forms.formEntryId()}`);
        rec('  … carrying the email and the address in the one question the form has',
            answer === 'alice@example.com\n0xAbC0000000000000000000000000000000000042', JSON.stringify(answer));
        rec('  … with the token Google requires, because a post without it records nothing',
            body.get('fbzx') === '1234567890' && body.get('fvv') === '1');
        rec('the token is read off the form rather than guessed', calls.views === 1);

        // The trap this module exists to avoid: Google answers a bad or stale token with the blank
        // form and a 200. Treated as success it would look fine forever.
        Forms.resetFormTokenCache();
        const { fetchImpl: blank, calls: blankCalls } = stubForm({ recordsWith: null });
        const unrecorded = await Forms.forwardToForm({ email: 'bob@example.com' }, { fetchImpl: blank });
        rec('a form that answers without recording is a failure, not a success',
            unrecorded.ok === false, JSON.stringify(unrecorded));
        rec('  … and it is retried once, against a freshly fetched token',
            blankCalls.posts.length === 2 && blankCalls.views === 2, `${blankCalls.posts.length} posts`);

        // A signup is one row. With no address there is no second line to read as a missing answer.
        Forms.resetFormTokenCache();
        const { fetchImpl: noAddr, calls: noAddrCalls } = stubForm();
        await Forms.forwardToForm({ email: 'carol@example.com' }, { fetchImpl: noAddr });
        rec('an address-less signup sends the email alone',
            twoAnswers(noAddrCalls).get(`entry.${Forms.formEntryId()}`) === 'carol@example.com');

        // The visitor's place is already written by the time this runs, so nothing here may throw.
        Forms.resetFormTokenCache();
        const { fetchImpl: down } = stubForm({ failView: true });
        const survived = await Forms.forwardToForm({ email: 'dave@example.com' }, { fetchImpl: down });
        rec('a form that is unreachable is reported, never thrown',
            survived.ok === false && typeof survived.reason === 'string', JSON.stringify(survived));
        const noEmail = await Forms.forwardToForm({ address: '0xabc' }, { fetchImpl: down });
        rec('  … and a signup with no email is skipped rather than posted',
            noEmail.skipped === true, JSON.stringify(noEmail));

        rec('an off-switch exists, so a branch can refuse to write into the live form',
            /WAITLIST_FORM_DISABLED/.test(code(fs.readFileSync(FORMS_PATH, 'utf8'))),
            'read before any request is made');

        // The map from signup to answer is pure, so it is checked directly as well.
        rec('the question format is the one the form is titled for',
            Forms.formAnswer('a@b.co', '0x1') === 'a@b.co\n0x1' && Forms.formAnswer('a@b.co') === 'a@b.co');
        rec('a renamed field would be caught rather than silently sending nothing',
            Forms.parseFormToken('<input type="hidden" name="fb-token" value="9">') === null
            && Forms.parseFormToken('<input type="hidden" name="fbzx" value="9">') === '9'
            && Forms.parseFormToken('') === null,
            'the token reader is the fragile part, so it is asserted on its own');

        // And the route has to use it in the way that cannot cost anybody their place.
        const forwardSource = code(fs.readFileSync(ROUTE_PATH, 'utf8'));
        rec('the route forwards after the entry is stored, and never instead of storing it',
            forwardSource.indexOf('addToWaitlist') < forwardSource.indexOf('forwardToForm'));
        rec('  … only for a new signup, so a repeat does not make a duplicate row',
            /alreadyRegistered[\s\S]{0,120}forwardToForm/.test(forwardSource));
        rec('  … and the outcome is stated in the response rather than left to be guessed',
            /formForwarded/.test(forwardSource));
        rec('  … and a form that fails only warns — it cannot throw the signup away',
            /console\.warn/.test(forwardSource) && !/throw[^]*forwardToForm/.test(forwardSource));
    }

    // ----------------------------------------------------------------------------------- removal
    section('Taking it back out');
    const beforeRemoval = await Store.waitlistSize();
    const purged = await Store.purgeEntry('alice@example.com');
    rec('an entry can be removed, and the removal is confirmed rather than assumed',
        purged.removed.length > 0 && purged.survived === false, purged.removed.join(', '));
    rec('  … and it is really gone', (await Store.getEntry('alice@example.com')) === null);
    rec('  … and the others are not', (await Store.getEntry('bob@example.com')) !== null);
    // The number on the landing page is a claim, so it has to fall when somebody leaves the queue.
    // Measured before this was split into two counters: after clearing three test entries the page
    // still advertised five knights in line.
    rec('  … and the queue the page advertises gets shorter',
        (await Store.waitlistSize()) === beforeRemoval - 1, `${beforeRemoval} → ${await Store.waitlistSize()}`);
    const afterRemoval = await Store.addToWaitlist({ email: 'returning@example.com' });
    rec('  … while a position is never reissued — it goes up, not back down',
        afterRemoval.position > beforeRemoval, `#${afterRemoval.position} after removing #1`);
    await Store.purgeEntry('returning@example.com');
    const nothing = await Store.purgeEntry('nobody@example.com');
    rec('removing something that is not there says so', nothing.removed.length === 0);

    const listed = await Store.listWaitlist();
    rec('the export reads oldest first — the order people joined', listed.length === 8
        && listed[0].position <= listed[listed.length - 1].position, `${listed.length} entries`);
    rec('and the advertised number is the number of entries, not the sequence',
        (await Store.waitlistSize()) === listed.length, `${await Store.waitlistSize()} vs ${listed.length}`);

    // ----------------------------------------------------------------------------------- the tally
    const failed = results.filter((row) => !row.pass);
    console.log('');
    console.log(`${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length) {
        console.log('');
        for (const row of failed) console.log(`  FAILED  ${row.label}`);
        process.exit(1);
    }
    cleanup();
})().catch((error) => {
    console.error('');
    console.error(error?.stack || error);
    cleanup();
    process.exit(1);
});
