#!/usr/bin/env node
/**
 * Does a collab registration do what the page says it does?
 *
 *     node tools/check-collab.js
 *
 * Five things are worth checking about `/collab`, and none of them is visible in a browser:
 *
 *   1. **Who an entry belongs to.** The page asks a wallet to *sign* before it registers, and the
 *      route takes the address out of that signature rather than out of the request body. A route
 *      that read `body.address` would look identical on screen and let anybody enter a wallet they
 *      do not hold, so the check is on the route's source — and so is the check that no address ever
 *      comes back in a response.
 *   2. **That a project is its own entry list.** The key is `(project, wallet)`, and the guest list
 *      for one partner must not be a slice of everybody's. With the store's key shape asserted
 *      directly, because the list holds one project today and a test that registered the same wallet
 *      for two of them would be a test about a second project that does not exist.
 *   3. **That the numbers on the page are the contract's.** Every figure is imported from
 *      `lib/collab-content.js`; these checks compare the strings the page renders against the tables
 *      they came from, so a stale supply or a hand-typed odds line fails by name.
 *   4. **That nothing personal is kept.** A registration is a public wallet address. The entry's own
 *      key list is asserted, the same way the waitlist's is — for the opposite reason.
 *   5. **That the page is reachable by the people it is for.** `/collab` and `/api/collab` on the
 *      apex's public list, and the route on the sitemap; a page a partner cannot open is a page that
 *      does not exist.
 *
 * It runs against a **sandbox**: a temp working directory, so the store's own `.data/collab.json` is
 * a throwaway, and with the KV variables deleted so the driver is the file one. Nothing here can
 * reach production and nothing needs cleaning up afterwards.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const STORE_PATH = path.join(ROOT, 'lib', 'collab-store.js');
const CONTENT_PATH = path.join(ROOT, 'lib', 'collab-content.js');
const ROUTE_PATH = path.join(ROOT, 'app', 'api', 'collab', 'route.js');
const CLIENT_PATH = path.join(ROOT, 'app', 'collab', 'client.js');
const PAGE_PATH = path.join(ROOT, 'app', 'collab', 'page.js');
const SHEET_PATH = path.join(ROOT, 'public', 'css', 'collab.css');
const ROUTING_PATH = path.join(ROOT, 'lib', 'app-routing.js');
const SITEMAP_PATH = path.join(ROOT, 'app', 'sitemap.js');
const STAKING_PATH = path.join(ROOT, 'lib', 'staking-config.js');

const read = (file) => {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch {
        return '';
    }
};

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

/**
 * A header-only picture fixture: the right magic number and the right length, and nothing else.
 *
 * That is exactly what the store reads — it checks the declared type against the bytes and never
 * decodes the picture, because the picture is drawn by a browser and not by the server. So a fixture
 * that has the header and not the image is testing the real thing rather than a stand-in.
 */
function photoFixture(mime, size = 64) {
    const magic = {
        'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        'image/jpeg': Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        'image/webp': Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4, 0), Buffer.from('WEBP')]),
    }[mime];
    return `data:${mime};base64,${Buffer.concat([magic, Buffer.alloc(size)]).toString('base64')}`;
}

// ------------------------------------------------------------- the sandbox, before any import
// The store picks its driver and its file path when the module graph loads, so both have to be
// settled first. This process is about to keep the collab registrations in a temp directory.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-collab-'));
process.chdir(sandbox);
for (const key of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
    delete process.env[key];
}

/**
 * Leave no trace.
 *
 * The `chdir` back out is not tidiness: this process is *inside* the sandbox, and Windows refuses to
 * remove a directory that is somebody's working directory (EPERM).
 */
function cleanup() {
    try { process.chdir(ROOT); } catch { /* already back */ }
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* best effort */ }
}

/**
 * A snippet in a fresh process, so a driver — or an allowlist — chosen from the environment can be
 * tested. The module defaults to the store; `lib/collab-owners.js` reads its variable at load time the
 * same way, so it needs the same treatment rather than a mutation of this process's environment.
 */
function freshProcess(snippet, env = {}, modulePath = STORE_PATH) {
    fs.mkdirSync(path.join(sandbox, 'fresh'), { recursive: true });
    const childEnv = { ...process.env, ...env };
    for (const [key, value] of Object.entries(env)) if (value === null) delete childEnv[key];
    const script = `
        const run = async () => {
            const store = await import(${JSON.stringify(pathToFileURL(modulePath).href)});
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
    console.log('The collab giveaway registration');

    const Store = await import(pathToFileURL(STORE_PATH).href);
    const Content = await import(pathToFileURL(CONTENT_PATH).href);
    const Routing = await import(pathToFileURL(ROUTING_PATH).href);
    const Sitemap = await import(pathToFileURL(SITEMAP_PATH).href);
    const Staking = await import(pathToFileURL(STAKING_PATH).href);

    const routeSource = read(ROUTE_PATH);
    const clientSource = read(CLIENT_PATH);

    rec('this harness is on the local file driver, so it cannot touch a real store',
        Store.COLLAB_DRIVER === 'file', Store.COLLAB_DRIVER);

    // ------------------------------------------------------------------- which projects exist
    section('Which projects the store answers for');
    rec('a pinned project is one the store answers for', await Store.isProjectSlug('fabled-chronicle'));
    rec('  … and nothing else is', !(await Store.isProjectSlug('nope'))
        && !(await Store.isProjectSlug(''))
        && !(await Store.isProjectSlug(null))
        && !(await Store.isProjectSlug(42)));
    rec('  … not even a different casing of it, because the slug is a store key',
        !(await Store.isProjectSlug('Fabled-Chronicle')));
    rec('every pinned slug is one the store answers for',
        (await Promise.all(Content.COLLAB_SLUGS.map((slug) => Store.isProjectSlug(slug)))).every(Boolean),
        Content.COLLAB_SLUGS.join(' '));
    // The point of the whole read: a project can be approved into existence, so at this point —
    // before anything has been approved in this sandbox — the slug an approved Fabled Chronicle
    // would take is not a project at all. It becomes one below, by being approved.
    rec('  … and a slug no pinned entry has is not one, until a request is approved',
        !(await Store.isProjectSlug('fabledchronicle'))
        && (await Store.knownProject('fabledchronicle')) === null);

    // ------------------------------------------------------------------------ what an address is
    section('A wallet address');
    const checksum = '0xAbC0000000000000000000000000000000000001';
    rec('a checksummed address is accepted and kept exactly as given',
        Store.normaliseAddress(checksum) === checksum);
    rec('an address with no 0x is not', Store.normaliseAddress('AbC0000000000000000000000000000000000001') === null);
    rec('a short one is not', Store.normaliseAddress('0x1234') === null);
    rec('a non-hex one is not', Store.normaliseAddress('0xZZZ0000000000000000000000000000000000001') === null);
    rec('an empty or missing one is not',
        Store.normaliseAddress('') === null && Store.normaliseAddress(null) === null && Store.normaliseAddress(42) === null);
    rec('surrounding space is trimmed rather than stored',
        Store.normaliseAddress(`  ${checksum}  `) === checksum);

    // ----------------------------------------------------------------------------- the key shape
    section('The key an entry is filed under');
    const entryKey = Store.entryKey('fabled-chronicle', checksum);
    rec('the project is in the key, so one partner is its own entry list',
        entryKey.startsWith('dk:collab:entry:fabled-chronicle:'), entryKey);
    rec('  … and the address is not', !entryKey.toLowerCase().includes(checksum.slice(2).toLowerCase()));
    rec('the same wallet is the same key however its case is spelled',
        Store.entryKey('fabled-chronicle', checksum.toLowerCase()) === entryKey);
    rec('  … and a different wallet is not',
        Store.entryKey('fabled-chronicle', '0xAbC0000000000000000000000000000000000002') !== entryKey);
    // The key is a **shape, not a permission**. Whether a slug is a project is now a question for
    // the store — a request can be approved into one — so that refusal lives on `registerForProject`
    // and on the route, and this builds a key for whatever it is handed rather than quietly deciding
    // against a hand-written list that is no longer the whole truth.
    rec('the key is built for any slug it is handed — the permission lives in the store',
        Store.entryKey('nope', checksum) !== null && Store.entryKey('', checksum) === null
        && Store.entryKey(null, checksum) === null);
    rec('and an address that is not one has no key', Store.entryKey('fabled-chronicle', 'nope') === null);

    // ---------------------------------------------------------------------------- taking an entry
    section('Registering a wallet');
    const first = await Store.registerForProject({ slug: 'fabled-chronicle', address: checksum });
    rec('a registration is accepted and given a position', first.ok === true && first.position === 1, String(first.position));
    rec('  … and filed under the project it asked for', first.entry.project === 'fabled-chronicle');
    rec('  … with the address kept as the chain gives it', first.entry.address === checksum);
    rec('  … and nothing else collected about the request', Object.keys(first.entry).sort().join(',')
        === ['address', 'at', 'handle', 'position', 'project', 'source'].sort().join(','),
        Object.keys(first.entry).join(', '));

    const second = await Store.registerForProject({ slug: 'fabled-chronicle', address: '0xAbC0000000000000000000000000000000000002' });
    rec('a second wallet is second', second.position === 2 && second.alreadyRegistered === false);

    const again = await Store.registerForProject({ slug: 'fabled-chronicle', address: checksum.toUpperCase().replace('0X', '0x') });
    rec('the same wallet again is the same entry, not a second one',
        again.alreadyRegistered === true && again.position === 1, String(again.position));
    rec('  … and the count does not move', (await Store.registrationCount('fabled-chronicle')) === 2,
        String(await Store.registrationCount('fabled-chronicle')));
    rec('the count is the number of wallets', (await Store.registrationCount('fabled-chronicle')) === 2);
    rec('a project nobody registered for counts zero', (await Store.registrationCount('nope')) === 0);
    rec('a position never moves once given',
        (await Store.getRegistration('fabled-chronicle', checksum)).position === 1);

    const unknown = await Store.registerForProject({ slug: 'nope', address: checksum });
    rec('a project that is not in the giveaway is refused with a reason',
        unknown.error && unknown.code === 'unknown-project', unknown.code);
    const badAddress = await Store.registerForProject({ slug: 'fabled-chronicle', address: 'nope' });
    rec('so is an address that is not one', badAddress.code === 'bad-address');
    rec('  … and neither attempt is written', (await Store.registrationCount('fabled-chronicle')) === 2);

    // -------------------------------------------------------------------------- the optional bits
    section('The optional handle');
    const withHandle = await Store.registerForProject({ slug: 'fabled-chronicle', address: '0xAbC0000000000000000000000000000000000003', handle: '@Knight_1' });
    rec('a handle is stored without the @ and in lower case', withHandle.entry.handle === 'knight_1', withHandle.entry.handle);
    rec('a handle that is not one is dropped rather than stored as written',
        (await Store.registerForProject({ slug: 'fabled-chronicle', address: '0xAbC0000000000000000000000000000000000004', handle: 'has space' })).entry.handle === null);

    // -------------------------------------------------------------------------------- the listing
    section('The entry list');
    const list = await Store.listRegistrations({ slug: 'fabled-chronicle' });
    rec('the list is the project\'s, oldest first', list.length === 4 && list[0].position === 1 && list[3].position === 4,
        list.map((row) => row.position).join(' '));
    rec('  … and holds no entry from a project that does not exist',
        (await Store.listRegistrations({ slug: 'nope' })).length === 0);
    rec('a limit takes the first entries, because that is the order a draw reads',
        (await Store.listRegistrations({ slug: 'fabled-chronicle', limit: 2 })).length === 2);

    // --------------------------------------------------------------------------------- the throttle
    section('The rate limit');
    const ip = '203.0.113.9';
    const now = Math.floor(Date.now() / 1000);
    let allowed = 0;
    for (let i = 0; i < 10; i += 1) {
        if ((await Store.countAttempt(ip, now)).allowed) allowed += 1;
    }
    rec('one connection gets a handful of attempts, not an unlimited loop', allowed === 6, String(allowed));
    rec('another connection is not punished for the first one\'s attempts',
        (await Store.countAttempt('198.51.100.4', now)).allowed === true);
    rec('and the window rolls over, so a burst does not lock anybody out for good',
        (await Store.countAttempt(ip, now + 61)).allowed === true);
    rec('the counter is keyed by a hash of the IP, not the IP',
        !Store.rateKeyFor(ip).includes('203.'), Store.rateKeyFor(ip));

    // -------------------------------------------------------------------------------- the removal
    section('Taking an entry back out');
    const purged = await Store.purgeRegistration('fabled-chronicle', checksum);
    rec('an entry can be removed, which is what the draw\'s own tooling will need',
        purged.removed.length === 1 && purged.survived === false);
    rec('  … and the project\'s count falls with it', (await Store.registrationCount('fabled-chronicle')) === 3,
        String(await Store.registrationCount('fabled-chronicle')));
    rec('removing something that is not there is not an error',
        (await Store.purgeRegistration('fabled-chronicle', checksum)).removed.length === 0);

    // ------------------------------------------------------------------- the driver, from the env
    section('Where it keeps the entries');
    rec('with KV configured it uses Redis', freshProcess('return store.COLLAB_DRIVER;', {
        KV_REST_API_URL: 'https://example.upstash.io', KV_REST_API_TOKEN: 'x',
    }) === 'redis');
    rec('with KV and Upstash both unset in production it falls back to memory, and says so',
        freshProcess('return store.COLLAB_DRIVER;', {
            NODE_ENV: 'production', KV_REST_API_URL: null, KV_REST_API_TOKEN: null,
            UPSTASH_REDIS_REST_URL: null, UPSTASH_REDIS_REST_TOKEN: null,
        }) === 'memory');
    rec('and it can describe where this process is writing',
        /local file/.test(Store.storageDescription()), Store.storageDescription());

    // ------------------------------------------------------------------------------- the API route
    section('The route');
    const routeCode = code(routeSource);
    rec('it proves the wallet with a signed session rather than trusting the request',
        /sessionFromRequest\(request\)/.test(routeCode) && /points-session/.test(routeSource));
    rec('  … and so it never reads an address out of the body',
        !/body\?\.address/.test(routeCode) && !/\baddress:\s*body/.test(routeCode));
    rec('it refuses an unsigned caller with a code the page switches on',
        /'signed-out'/.test(routeCode) && /401/.test(routeCode));
    rec('it requires a project on both verbs, by asking the store rather than a constant',
        (routeCode.match(/await knownProject\(/g) || []).length >= 2 && !/isProjectSlug/.test(routeCode));
    rec('  … and refuses one the store does not hold', /'unknown-project'/.test(routeCode));
    rec('it is throttled per connection', /countAttempt\(clientIp\(request\)\)/.test(routeCode));
    rec('a store that is down is a 503, not a crash the visitor reads as a bad address',
        /'store-unavailable'/.test(routeCode) && /503/.test(routeCode));
    rec('nothing personal travels back — no address in any response', !/\baddress:/.test(routeCode));
    rec('it runs on the Node runtime, because the session MAC does',
        /runtime\s*=\s*'nodejs'/.test(routeCode));

    // ------------------------------------------------------------------------------------ the copy
    section('What the page promises');
    const capsuleOffer = Content.OFFERS.find((offer) => offer.key === 'capsules');
    const genesisOffer = Content.OFFERS.find((offer) => offer.key === 'genesis');
    rec('there is an offer of free Knight capsules', !!capsuleOffer && /capsule/i.test(capsuleOffer.title));
    rec('  … and one of Genesis NFT whitelist places',
        !!genesisOffer && /whitelist/i.test(genesisOffer.title));
    rec('the capsule odds are the table\'s, not a retyped line',
        Content.CAPSULE_ODDS_LINE === Content.CAPSULE_ODDS.map((row) => `${row.pct}% ${row.tier}`).join(' · ')
        && capsuleOffer.points.join(' ').includes(Content.CAPSULE_ODDS_LINE),
        Content.CAPSULE_ODDS_LINE);
    rec('  … and the open price is named rather than hidden from the winner',
        capsuleOffer.points.join(' ').includes(Content.CAPSULE_OPEN_PRICE.floor.toLocaleString('en-US'))
        && capsuleOffer.points.join(' ').includes(Content.CAPSULE_OPEN_PRICE.top.toLocaleString('en-US'))
        && /free/i.test(capsuleOffer.points.join(' ')));
    rec('the Genesis offer quotes the real supply',
        genesisOffer.summary.includes(Content.fmtInt(Staking.GENESIS_SUPPLY)), genesisOffer.summary.slice(0, 80));
    // The raffle is described, and the count is *not* stated — the owner's correction: the prize is
    // Knight capsules, and "200 capsules" was never a promise anybody had made. Neither offer states
    // a capsule count now, and the raffle's own count is TBA on `/genesis`.
    rec('  … and the raffle it is entered into, with no capsule count attached to it',
        /weekly Knight-capsule raffle|weekly draw/.test(genesisOffer.points.join(' '))
        && !genesisOffer.points.join(' ').includes(Content.fmtInt(Staking.CAPSULES_PER_WEEK)));
    rec('the prize named is the Knight capsule, and no line promises a Genesis capsule',
        /Knight capsules/.test(capsuleOffer.title)
        && !/Genesis capsule/i.test(JSON.stringify([Content.OFFERS, Content.NFT_USE, Content.HERO])));
    rec('both prizes say what a place costs, rather than implying it is free',
        /not a free one/.test(genesisOffer.fine));
    rec('the NFT utility has a side for each collection',
        Content.NFT_USE.length === 2 && Content.NFT_USE.map((use) => use.key).join(',') === 'knights,genesis');
    rec('  … and every block says what the NFT is actually for',
        Content.NFT_USE.every((use) => use.points.length >= 3 && use.lede.length > 40));
    rec('the reward table on the page is the game\'s own table',
        Content.KNIGHT_LADDER.length === 5
        && Content.NFT_USE[0].points.some((point) => point.text.includes(Content.fmtInt(Content.KNIGHT_LADDER[0].perRun))));
    rec('the partner\'s side is written down, and it is the X post',
        Content.PARTNER_TERMS.items.some((item) => /on your X/.test(item.title))
        && Content.PARTNER_TERMS.items.some((item) => /we share/i.test(item.title) || /we share/i.test(item.text)));
    rec('  … and that the post runs in both directions',
        Content.PARTNER_TERMS.items.some((item) => /quote it from @DNGrobinhood/.test(item.text)));
    rec('the steps cover the registration tab and the shared post',
        Content.COLLAB_STEPS.length >= 4
        && Content.COLLAB_STEPS.some((step) => /register/i.test(step.title))
        && Content.COLLAB_STEPS.some((step) => /post, we share/i.test(step.title)));
    rec('there is a way to ask to be a project', Content.CONTACT.x === 'https://x.com/DNGrobinhood' && !!Content.CONTACT.discord);

    // ---------------------------------------------------------------------------------- the projects
    section('The project tab, read from the store');
    const project = Content.COLLAB_PROJECTS[0];
    rec('the pinned project is the one the owner named',
        project.slug === 'fabled-chronicle' && project.handle === 'FabledChronicle'
        && project.url === 'https://x.com/FabledChronicle', `${project.name} @${project.handle}`);
    rec('every pinned project carries what the tab renders',
        Content.COLLAB_PROJECTS.every((entry) => entry.slug && entry.name && entry.handle && entry.url
            && entry.avatar && entry.prize && entry.blurb && entry.status));
    rec('their pictures are ours, not hotlinked from X',
        Content.COLLAB_PROJECTS.every((entry) => entry.avatar.startsWith('/assets/collab/')
            && !/^https?:/.test(entry.avatar)));
    rec('  … and they are actually on disk, because a missing picture is a broken tab',
        Content.COLLAB_PROJECTS.every((entry) => fs.existsSync(path.join(ROOT, 'public', entry.avatar.replace(/^\//, '')))),
        Content.COLLAB_PROJECTS.map((entry) => entry.avatar).join(' '));
    rec('there is room for the next one — the tab is a list, not a card',
        Array.isArray(Content.COLLAB_PROJECTS) && typeof Content.projectBySlug === 'function'
        && Content.projectBySlug('fabled-chronicle') === project && Content.projectBySlug('nope') === null);

    // ...and now the half that is in no file at all. A project is on this tab by being approved, so
    // four things have to hold: a pending row is not on it, an approved one is, one that is turned
    // down or removed leaves it, and a request for an account that is *also* pinned does not become
    // a second tab for the same X account.
    const A = '0x4444444444444444444444444444444444444444';
    const B = '0x5555555555555555555555555555555555555555';
    const slugs = (rows) => rows.map((row) => `${row.slug}${row.approved ? '*' : ''}`).join(' ');
    rec('with nothing approved the tab is the pinned list',
        (await Store.listedProjects()).length === Content.COLLAB_PROJECTS.length);

    await Store.putRequest({ address: A, name: 'Fabled Chronicle', handle: '@FabledChronicle', prize: '4 capsules', dates: 'Late October' });
    rec('a request that is only pending is not on the tab',
        (await Store.listedProjects()).length === Content.COLLAB_PROJECTS.length);
    rec('  … and its slug is not a project yet either, so nothing can register for it',
        !(await Store.isProjectSlug(Store.projectSlugFor('FabledChronicle'))));

    await Store.setRequestStatus(A, 'approved');
    const merged = await Store.listedProjects();
    rec('approving it puts it on the tab, with no file edited and nothing deployed',
        merged.length === 1 && merged[0].approved === true && merged[0].slug === 'fabledchronicle', slugs(merged));
    rec('  … and what is shown is the request, not the pinned entry it matches on the handle',
        merged[0].prize === '4 capsules' && merged[0].blurb === 'Open until Late October.');
    rec('  … so one X account is one tab rather than two',
        merged.filter((row) => String(row.handle).toLowerCase() === 'fabledchronicle').length === 1);
    rec('a project with no picture yet has no picture URL, so the tab shows its initial',
        merged[0].avatar === null);

    await Store.putRequest({ address: B, name: 'Second Project', handle: 'secondproject', prize: '1 capsule' });
    await Store.setRequestStatus(B, 'approved');
    const both = await Store.listedProjects();
    rec('a second approved project is a second tab, and the pinned one keeps its place',
        both.length === 2 && both[0].slug === 'fabledchronicle' && both[1].slug === 'secondproject', slugs(both));
    rec('  … with its own registration namespace, so one partner is its own entry list',
        await Store.isProjectSlug('secondproject'));
    rec('  … and it carries the request\'s own words and its own account',
        both[1].prize === '1 capsule' && both[1].url === 'https://x.com/secondproject'
        && both[1].name === 'Second Project');

    await Store.attachRequestPhoto(B, photoFixture('image/jpeg'));
    const pictured = (await Store.listedProjects()).find((row) => row.slug === 'secondproject');
    rec('uploading the picture gives the tab a URL for it on our own route, not a data URL in the page',
        String(pictured.avatar).startsWith(`${Content.PROJECT_PHOTO_ROUTE}?project=secondproject&v=`), pictured.avatar);
    rec('  … carrying the upload time, so a replaced picture is a different address',
        /[?&]v=\d{10,}/.test(pictured.avatar) && !/^data:/.test(pictured.avatar));

    await Store.setRequestStatus(B, 'rejected');
    rec('turning a project down takes it off the tab',
        (await Store.listedProjects()).every((row) => row.slug !== 'secondproject'));
    await Store.setRequestStatus(B, 'approved');
    await Store.purgeRequest(B);
    rec('and removing the request takes it off the tab with it',
        (await Store.listedProjects()).every((row) => row.slug !== 'secondproject'));
    await Store.purgeRequest(A);
    const backToPinned = await Store.listedProjects();
    rec('with the store empty the tab is the pinned list again, file picture and all',
        backToPinned.length === 1 && backToPinned[0].slug === 'fabled-chronicle'
        && backToPinned[0].avatar === project.avatar);
    rec('  … and the same answer comes back every time it is asked',
        JSON.stringify(await Store.listedProjects()) === JSON.stringify(backToPinned));

    // The picture a store project shows. It is bytes somebody uploaded, served over a public route,
    // so the three things that matter are that approval is what publishes it, that the bytes are
    // checked again on the way out, and that the versioned URL is what lets it be cached hard.
    const pfpRoutePath = path.join(ROOT, 'app', 'api', 'collab', 'photo', 'route.js');
    const pfpRouteSource = read(pfpRoutePath);
    const pfpRouteCode = code(pfpRouteSource);
    rec('the picture is served by a route of ours, so nothing hotlinks X and nothing inlines base64',
        fs.existsSync(pfpRoutePath) && /approvedRequestForSlug/.test(pfpRouteCode));
    rec('  … which answers for an approved project and for nothing else',
        /approvedRequestForSlug/.test(pfpRouteCode) && !/putRequest|attachRequestPhoto/.test(pfpRouteCode));
    rec('  … re-checking the bytes rather than trusting the stored row',
        /readPhotoDataUrl/.test(pfpRouteCode) && /nosniff/.test(pfpRouteSource));
    rec('  … and caching hard, which the version in the URL is what makes honest',
        /immutable/.test(pfpRouteSource) && /31536000/.test(pfpRouteSource));
    rec('  … on the Node runtime, because the store it reads does',
        /runtime\s*=\s*'nodejs'/.test(pfpRouteCode));

    // ------------------------------------------------------------------------------------- the page
    section('The page');
    const sheet = read(SHEET_PATH);
    rec('the route exists and is the client the metadata wraps',
        fs.existsSync(PAGE_PATH) && /CollabClient/.test(read(PAGE_PATH)));
    rec('it links the theme and its own sheet',
        /\/theme\.css/.test(clientSource) && /\/css\/collab\.css/.test(clientSource) && sheet.length > 1000);
    rec('it carries the wallet control every route has', /className="wallet-pill/.test(clientSource)
        && /\/wallet-menu\.js/.test(clientSource) && /WalletMenu\.attach/.test(clientSource));
    rec('it connects a wallet and signs, so an entry is proven rather than typed',
        /connectWallet/.test(clientSource) && /ensureSession/.test(clientSource));
    rec('the entry state is asked of the store, not remembered in the browser',
        /\/api\/collab\?project=/.test(clientSource) && !/localStorage/.test(code(clientSource)));
    rec('and no running total is printed, the way no other public page prints one',
        !/\bcount\b/.test(code(clientSource)));
    rec('the button says what it does at every step',
        /Connect wallet & register/.test(clientSource) && /Register this wallet/.test(clientSource)
        && /Registered ✓/.test(clientSource));
    rec('and the figures it prints are imported rather than typed into the page',
        /from '\.\.\/\.\.\/lib\/collab-content'/.test(clientSource)
        && !/1,024|1024|toLocaleString/.test(code(clientSource)));
    rec('the giveaway list is read on the server, out of the store',
        /listedProjects/.test(read(PAGE_PATH)) && /force-dynamic/.test(read(PAGE_PATH)));
    rec('  … and handed to the client rather than written into a constant',
        /CollabClient projects=\{projects\}/.test(read(PAGE_PATH))
        && !/COLLAB_PROJECTS/.test(code(read(PAGE_PATH))));
    rec('so the tab renders the list it is given, pinned and approved alike',
        /projects\.map\(/.test(clientSource) && !/COLLAB_PROJECTS/.test(code(clientSource)));
    rec('a project with no picture yet shows its initial rather than somebody else\'s face',
        /collab-tab-initials/.test(clientSource) && /collab-project-initials/.test(clientSource));
    rec('and an empty store says so rather than showing an empty tab',
        /PROJECTS_EMPTY/.test(clientSource) && /collab-projects-empty/.test(sheet));

    // ------------------------------------------------------------------------------ the scroll box
    // The bug this guards, because it is invisible in every source-level check above: `theme.css`
    // clips `html, body` to one viewport (`height: 100%; overflow: hidden`) because the game's
    // routes are fixed-height apps that scroll inside themselves — so a route that does *not*
    // scroll in a box of its own is a route whose lower half cannot be reached at all. `/collab` and
    // `/collab/review` were written without one: ~4,100px of terms, a three-field form and the
    // contact block sat below a clipped fold with no scrollbar anywhere on the page.
    const reviewClientSource = read(path.join(ROOT, 'app', 'collab', 'review', 'client.js'));
    const theme = read(path.join(ROOT, 'public', 'theme.css'));
    const boxCount = (source) => (source.match(/className="collab-scroll"/g) || []).length;
    const sheetLink = (source) => (source.match(/\/css\/collab\.css\?v=\d+/) || [])[0] || '';
    rec('the document is clipped at the viewport, which is why a route must scroll inside itself',
        /html,\s*body\s*\{[^}]*overflow:\s*hidden/.test(theme));
    rec('the shell is the window, not a column allowed to grow past it',
        /\.collab-page\s*\{[^}]*height:\s*100vh/.test(sheet) && !/\.collab-page\s*\{[^}]*min-height/.test(sheet));
    rec('  … and its body scrolls in a box of its own, the way `/docs` does',
        /\.collab-scroll\s*\{[^}]*flex:\s*1[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/.test(sheet));
    rec('both collab routes have exactly one such box', boxCount(clientSource) === 1 && boxCount(reviewClientSource) === 1);
    rec('  … wrapping the reading column instead of being it, so the scrollbar lands at the window edge',
        /collab-scroll[^>]*>\s*<main className="collab-main"/.test(clientSource)
        && /collab-scroll[^>]*>\s*<main className="collab-main"/.test(reviewClientSource));
    rec('  … and the head stays outside it, so a form\'s error cannot scroll out of sight',
        clientSource.indexOf('collab-head') < clientSource.indexOf('collab-scroll'));
    rec('both link the same stamped sheet, so neither can be served the other\'s rules',
        !!sheetLink(clientSource) && sheetLink(clientSource) === sheetLink(reviewClientSource));

    // ------------------------------------------------------------------------------- the reachability
    section('Where the page lives');
    rec('the apex serves it, rather than sending a partner to the password',
        Routing.classify('/collab') === 'apex-public'
        && Routing.decideRoute({
            isApp: false, isApex: true, kind: Routing.classify('/collab'),
            pathname: '/collab', search: '', passwordConfigured: true, gateAllowed: false,
        }).action === 'next',
        Routing.classify('/collab'));
    rec('and so does the endpoint it registers through',
        Routing.classify('/api/collab') === 'apex-public'
        && Routing.classify('/api/collab/anything') === 'apex-public',
        Routing.classify('/api/collab'));
    rec('the owner\'s page is reachable without the password too — it holds nothing to protect',
        Routing.classify('/collab/review') === 'apex-public'
        && Routing.classify('/api/collab/review') === 'apex-public',
        Routing.classify('/collab/review'));
    rec('neither is on a list that would open it on the game host as well',
        !Routing.GLOBAL_OPEN.includes('/collab') && !Routing.APP_OPEN.includes('/collab')
        && !Routing.GLOBAL_OPEN.includes('/api/collab') && !Routing.APP_OPEN.includes('/api/collab'),
        `GLOBAL_OPEN has ${Routing.GLOBAL_OPEN.length} paths, APP_OPEN ${Routing.APP_OPEN.length}`);
    rec('and the sitemap does not promise a URL the apex would redirect',
        Sitemap.default().some((entry) => entry.url.endsWith('/collab')),
        Sitemap.default().map((entry) => entry.url.replace(/^https?:\/\/[^/]+/, '')).join(' '));

    // =============================================================== the project's own request
    section('A project asking in');

    const requester = '0x1111111111111111111111111111111111111111';
    const otherWallet = '0x2222222222222222222222222222222222222222';

    rec('a project name is collapsed and trimmed',
        Store.normaliseProjectName('  Fabled   Chronicle  ') === 'Fabled Chronicle',
        String(Store.normaliseProjectName('  Fabled   Chronicle  ')));
    rec('an empty or over-long name is refused',
        Store.normaliseProjectName('') === null && Store.normaliseProjectName('   ') === null
        && Store.normaliseProjectName('x'.repeat(49)) === null && Store.normaliseProjectName(7) === null);
    rec('a handle keeps its case, because it is printed on a card',
        Store.normaliseDisplayHandle('@FabledChronicle') === 'FabledChronicle'
        && Store.normaliseDisplayHandle('Fabled_1') === 'Fabled_1');
    rec('  … and a handle that is not one is refused',
        Store.normaliseDisplayHandle('has space') === null && Store.normaliseDisplayHandle('abcdefghijklmnop') === null);
    rec('the slug is minted from the handle, lower-cased and dash-separated',
        Store.projectSlugFor('Fabled_Knights') === 'fabled-knights' && Store.projectSlugFor('@FabledKnights') === 'fabledknights',
        String(Store.projectSlugFor('Fabled_Knights')));
    rec('  … and there is no slug for a handle that is not one', Store.projectSlugFor('!!!') === null);

    const requestKey = Store.requestKey(requester);
    rec('a request is filed under the **wallet**, not the handle it typed',
        requestKey.startsWith('dk:collab:request:') && !requestKey.toLowerCase().includes(requester.slice(2)),
        requestKey);
    rec('  … so the same wallet in a different case is the same request',
        Store.requestKey(requester.toUpperCase().replace('0X', '0x')) === requestKey);
    rec('  … and two wallets cannot be one row', Store.requestKey(otherWallet) !== requestKey);
    rec('a request with no wallet to file it under has no key', Store.requestKey('nope') === null);

    const empty = await Store.putRequest({ address: requester });
    rec('a request with no name is refused with a reason about the name', empty.code === 'bad-name', empty.code);
    rec('  … one with no handle about the handle',
        (await Store.putRequest({ address: requester, name: 'A', prize: 'x' })).code === 'bad-handle');
    rec('  … one with no prize about the prize',
        (await Store.putRequest({ address: requester, name: 'A', handle: 'a', prize: '  ' })).code === 'bad-prize');
    rec('  … and one with no wallet at all, before any of it is looked at',
        (await Store.putRequest({ name: 'A', handle: 'a', prize: 'x' })).code === 'bad-address');
    rec('  … and none of them was written', (await Store.getRequest(requester)) === null);

    const sent = await Store.putRequest({
        address: requester,
        name: 'Fabled Chronicle',
        handle: '@FabledChronicle',
        prize: '3 Knight capsules + 2 Genesis whitelist spots',
        dates: 'Early October, one week',
        note: 'We can post on the day you announce.',
    });
    rec('a good request is stored and is born pending',
        sent.ok === true && sent.request.status === 'pending', sent.request?.status);
    rec('  … with the handle as the project writes it', sent.request.handle === 'FabledChronicle');
    rec('  … with no slug until it is approved', sent.request.slug === null);
    rec('  … with no picture on it', sent.request.photo === null);
    rec('a second call from the same wallet is an edit, not a second row',
        (await Store.putRequest({ address: requester, name: 'Fabled Chronicle', handle: 'FabledChronicle', prize: '4 capsules' }))
            .request.revisions === 2);
    rec('  … and it keeps its place in the queue', (await Store.getRequest(requester)).at === sent.request.at);
    rec('reading it back finds the same row whatever the case of the address',
        (await Store.getRequest(requester.toUpperCase().replace('0X', '0x')))?.name === 'Fabled Chronicle');

    const approved = await Store.setRequestStatus(requester, 'approved', { note: 'On the list.' });
    rec('the owner\'s tool approves it', approved.ok === true && approved.request.status === 'approved');
    rec('  … and mints the slug the project will take', approved.request.slug === 'fabledchronicle', String(approved.request.slug));
    rec('  … with the decision recorded rather than implied',
        !!approved.request.decidedAt && approved.request.decidedNote === 'On the list.');
    rec('an approved request cannot be rewritten by the browser',
        (await Store.putRequest({ address: requester, name: 'Something Else', handle: 'FabledChronicle', prize: 'nope' })).code === 'already-approved');
    rec('  … and its name is untouched', (await Store.getRequest(requester)).name === 'Fabled Chronicle');
    rec('an approved request cannot be withdrawn from the page either',
        (await Store.removeRequest(requester)).code === 'already-approved');
    rec('a status that is not one is refused',
        (await Store.setRequestStatus(requester, 'nearly')).code === 'bad-status');
    rec('and a wallet with no request cannot be approved',
        (await Store.setRequestStatus(otherWallet, 'approved')).code === 'not-found');

    // The two halves meeting. Before this approval `fabledchronicle` was not a project at all
    // (asserted above); approval is what makes it one, and it is the fact the giveaway tab reads.
    rec('approving a request is what makes its slug a project',
        (await Store.isProjectSlug('fabledchronicle'))
        && (await Store.knownProject('fabledchronicle'))?.name === 'Fabled Chronicle');
    rec('  … described from the store\'s own row rather than from the pinned entry it matches',
        (await Store.knownProject('fabledchronicle')).prize === '4 capsules'
        && (await Store.knownProject('fabledchronicle')).approved === true);
    const storeEntry = await Store.registerForProject({ slug: 'fabledchronicle', address: checksum });
    rec('a wallet can register for a project that exists only as an approved request',
        storeEntry.ok === true && storeEntry.entry.project === 'fabledchronicle');
    rec('  … and that project is its own entry list, not the pinned slug\'s',
        (await Store.getRegistration('fabledchronicle', checksum)) !== null
        && (await Store.getRegistration('fabled-chronicle', checksum)) === null);

    // ------------------------------------------------------------------- the picture
    section('The picture the card is made from');

    rec('a PNG is read as a PNG', Store.readPhotoDataUrl(photoFixture('image/png')).mime === 'image/png');
    rec('a JPEG is read as a JPEG', Store.readPhotoDataUrl(photoFixture('image/jpeg')).mime === 'image/jpeg');
    rec('a WebP is read as a WebP', Store.readPhotoDataUrl(photoFixture('image/webp')).mime === 'image/webp');
    rec('a file that only claims to be a PNG is refused',
        Store.readPhotoDataUrl(photoFixture('image/jpeg').replace('image/jpeg', 'image/png'))
            .reason === 'that file is not the picture its name says it is');
    rec('a data URL that is not an image at all is refused',
        Store.readPhotoDataUrl('data:text/plain;base64,aGVsbG8=').ok === false);
    rec('so is a bare URL, an empty string and nothing at all',
        Store.readPhotoDataUrl('https://example.com/a.png').ok === false
        && Store.readPhotoDataUrl('').ok === false && Store.readPhotoDataUrl(null).ok === false);
    rec('an empty picture is refused with its own reason',
        Store.readPhotoDataUrl('data:image/png;base64,').ok === false);
    const huge = Store.readPhotoDataUrl(photoFixture('image/png', Store.PFP_MAX_BYTES + 1024));
    rec('a picture over the cap is refused, and the reason names the cap',
        huge.ok === false && /the limit is 256 KB/.test(huge.reason), huge.reason);
    rec('the cap is a size the page can reach — a resized portrait is a fraction of it',
        Store.PFP_MAX_BYTES === 256 * 1024);

    rec('a pending request may not upload a picture',
        (await Store.attachRequestPhoto(otherWallet, photoFixture('image/png'))).code === 'not-found');
    rec('an approved one may',
        (await Store.attachRequestPhoto(requester, photoFixture('image/jpeg'))).ok === true);
    const withPhoto = await Store.getRequest(requester);
    rec('  … and it is stored with what it is, not just the bytes',
        withPhoto.photoMime === 'image/jpeg' && withPhoto.photoBytes > 4 && !!withPhoto.photoAt,
        `${withPhoto.photoMime} ${withPhoto.photoBytes}B`);
    rec('a bad picture does not rub out the good one',
        (await Store.attachRequestPhoto(requester, 'not-a-picture')).code === 'bad-photo'
        && (await Store.getRequest(requester)).photo === withPhoto.photo);
    const pfp = Store.readPhotoDataUrl(photoFixture('image/jpeg'));
    rec('  … and the stored bytes are the bytes that were sent', pfp.bytes === withPhoto.photoBytes);
    rec('and the reader hands back the bytes themselves, so a route can serve them',
        Store.readPhotoDataUrl(withPhoto.photo).buffer.length === withPhoto.photoBytes);
    rec('the approved project now has a picture URL of its own, on a route of ours',
        String((await Store.knownProject('fabledchronicle'))?.avatar)
            .startsWith('/api/collab/photo?project=fabledchronicle&v='),
        (await Store.knownProject('fabledchronicle'))?.avatar);

    // ----------------------------------------------------------- the request's own lifecycle
    section('Rejection is not the end of it');
    await Store.setRequestStatus(otherWallet, 'pending');
    await Store.putRequest({ address: otherWallet, name: 'Second Project', handle: 'second', prize: '1 capsule' });
    await Store.setRequestStatus(otherWallet, 'rejected', { note: 'Too close to launch.' });
    const rejected = await Store.getRequest(otherWallet);
    rec('a rejected request keeps the reason, so the page can print it',
        rejected.status === 'rejected' && rejected.decidedNote === 'Too close to launch.');
    const resent = await Store.putRequest({ address: otherWallet, name: 'Second Project', handle: 'second', prize: '2 capsules' });
    rec('and it can be sent again, which puts it back in the queue',
        resent.ok === true && resent.request.status === 'pending' && resent.resubmitted === true);
    rec('  … with the new details', (await Store.getRequest(otherWallet)).prize === '2 capsules');
    rec('a project can withdraw its own request while it is pending',
        (await Store.removeRequest(otherWallet)).removed === true);
    rec('  … and nothing of it is kept', (await Store.getRequest(otherWallet)) === null);
    rec('withdrawing one that is not there is not an error',
        (await Store.removeRequest(otherWallet)).removed === false);

    const listed = await Store.listRequests();
    rec('the owner\'s tool can list them, oldest first',
        listed.length === 1 && listed[0].name === 'Fabled Chronicle', listed.map((r) => r.name).join(' '));
    rec('  … and filter by the only status that needs attention',
        (await Store.listRequests({ status: 'pending' })).length === 0
        && (await Store.listRequests({ status: 'approved' })).length === 1);
    rec('a request carries no email and no IP — a wallet, a plan and a picture',
        !('email' in withPhoto) && !('ip' in withPhoto));
    rec('purging takes the row and the picture with it',
        (await Store.purgeRequest(requester)).removed.length === 1 && (await Store.getRequest(requester)) === null);

    // ------------------------------------------------------------- the two new routes
    section('The two new endpoints');
    const submissionRoute = read(path.join(ROOT, 'app', 'api', 'collab', 'submission', 'route.js'));
    const photoRoute = read(path.join(ROOT, 'app', 'api', 'collab', 'submission', 'photo', 'route.js'));
    const submissionCode = code(submissionRoute);
    const photoCode = code(photoRoute);
    rec('both read the wallet from a signed session',
        /sessionFromRequest\(request\)/.test(submissionCode) && /sessionFromRequest\(request\)/.test(photoCode));
    rec('  … and neither reads an address out of the body',
        !/body\?\.address/.test(submissionCode) && !/body\?\.address/.test(photoCode));
    rec('a request cannot approve itself — no route can move a status',
        !/setRequestStatus/.test(submissionCode) && !/setRequestStatus/.test(photoCode)
        && !/'approved'/.test(submissionCode));
    rec('the upload is refused for anything but an approved request',
        /attachRequestPhoto/.test(photoCode) && /'not-approved'/.test(photoCode) && /403/.test(photoCode));
    rec('  … and it keeps its own size cap rather than trusting the page', /PFP_MAX_BYTES/.test(photoRoute));
    rec('the text route is throttled per connection', /countAttempt\(/.test(submissionCode));
    rec('and both run on the Node runtime, because the session MAC does',
        /runtime\s*=\s*'nodejs'/.test(submissionCode) && /runtime\s*=\s*'nodejs'/.test(photoCode));
    rec('the picture route is its own route, not a field on the submission',
        fs.existsSync(path.join(ROOT, 'app', 'api', 'collab', 'submission', 'photo', 'route.js')));

    // ------------------------------------------------------------------ the owner's page
    // The other half of asking: a request becomes a decision. That used to be the CLI and nothing
    // else, so the interesting claims are about **who the route listens to** — a signed wallet on a
    // list, and nothing else — and about what it cannot do.
    section('The owner\'s page');

    const OWNERS_PATH = path.join(ROOT, 'lib', 'collab-owners.js');
    const REVIEW_PATH = path.join(ROOT, 'app', 'api', 'collab', 'review', 'route.js');
    const REVIEW_PAGE = path.join(ROOT, 'app', 'collab', 'review', 'page.js');
    const REVIEW_CLIENT = path.join(ROOT, 'app', 'collab', 'review', 'client.js');
    const ownersSource = read(OWNERS_PATH);
    const reviewCode = code(read(REVIEW_PATH));
    const reviewClient = read(REVIEW_CLIENT);
    const Owners = await import(pathToFileURL(OWNERS_PATH).href);

    rec('the owner list is a list in the environment, not an address in the code',
        /process\.env\.COLLAB_OWNERS/.test(ownersSource));
    rec('a checksummed address and a lower-cased one are the same owner',
        Owners.parseOwners('0xAbC0000000000000000000000000000000000001, 0xabc0000000000000000000000000000000000001').length === 1);
    rec('separators are tolerated, and junk does not take the addresses around it with it',
        Owners.parseOwners('0xAbC0000000000000000000000000000000000001; nope\n0xAbC0000000000000000000000000000000000002')
            .length === 2,
        Owners.parseOwners('0xAbC0000000000000000000000000000000000001; nope\n0xAbC0000000000000000000000000000000000002').join(' '));
    rec('with no variable there is no owner at all, so the page fails closed',
        Owners.ownerCount() === 0 && !Owners.isOwner(checksum) && !Owners.isOwner('nope') && !Owners.isOwner(null));
    rec('and with the variable set, exactly the wallets on it are owners',
        JSON.stringify(freshProcess(
            'return [store.isOwner("0xAbC0000000000000000000000000000000000001"),'
            + ' store.isOwner("0xabc0000000000000000000000000000000000001"),'
            + ' store.isOwner("0xAbC0000000000000000000000000000000000002"), store.ownerCount()];',
            { COLLAB_OWNERS: '0xAbC0000000000000000000000000000000000001' },
            OWNERS_PATH
        )) === JSON.stringify([true, true, false, 1]),
        'case-insensitive, and nobody else');

    rec('the opposite half of the form is a route of its own', fs.existsSync(REVIEW_PATH));
    rec('an unsigned caller is refused with a 401 and no rows',
        /sessionFromRequest\(request\)/.test(reviewCode) && /'signed-out'/.test(reviewCode) && /401/.test(reviewCode));
    rec('a signed-in stranger is refused with a 403 and no rows',
        /isOwner\(/.test(reviewCode) && /'not-an-owner'/.test(reviewCode) && /403/.test(reviewCode));
    rec('  … and told how many owners are configured, so an unset variable is not a mystery',
        /ownerCount\(\)/.test(reviewCode));
    rec('the wallet in the body is the subject; the session is the authority',
        /body\?\.wallet/.test(reviewCode) && /sessionFromRequest/.test(reviewCode) && !/body\?\.address/.test(reviewCode));
    rec('it decides and nothing else: approved or rejected, never pending',
        /DECISIONS = \['approved', 'rejected'\]/.test(reviewCode) && /DECISIONS\.includes\(status\)/.test(reviewCode));
    rec('  … it cannot edit, attach or delete a request',
        !/putRequest|attachRequestPhoto|purgeRequest|removeRequest/.test(reviewCode));
    rec('  … and cannot change who is an owner', !/parseOwners|COLLAB_OWNERS\s*=/.test(reviewCode));
    rec('it answers with rows that carry no picture bytes', /reviewRow/.test(reviewCode));
    rec('a note longer than the store takes is refused rather than cut',
        /REQUEST_LIMITS\.note/.test(reviewCode) && /'bad-note'/.test(reviewCode));
    rec('it is not throttled, because a stranger cannot reach it at all', !/countAttempt/.test(reviewCode));
    rec('and it runs on the Node runtime, because the session MAC does',
        /runtime\s*=\s*'nodejs'/.test(reviewCode));

    const stored = {
        wallet: checksum, name: 'A Project', handle: 'aproject', prize: '1 capsule', status: 'approved',
        slug: 'aproject', photo: 'data:image/jpeg;base64,AAAA', photoMime: 'image/jpeg',
        photoBytes: 4, photoAt: '2026-09-28T06:00:00.000Z',
    };
    const ownerRow = Store.reviewRow(stored);
    rec('a row handed to a browser carries no picture bytes', !('photo' in ownerRow) && ownerRow.hasPhoto === true);
    rec('  … and offers a URL for the picture instead, on the route that serves it',
        ownerRow.photoUrl.startsWith('/api/collab/photo?project=aproject&v='), ownerRow.photoUrl);
    rec('  … but not for a request that is not approved, whose picture that route will not serve',
        Store.reviewRow({ ...stored, status: 'rejected' }).photoUrl === null
        && Store.reviewRow({ ...stored, status: 'rejected' }).hasPhoto === true);
    rec('and a request with no picture says so',
        Store.reviewRow({ ...stored, status: 'pending', photo: null }).hasPhoto === false);

    rec('the owner has a page, and it is its own route', fs.existsSync(REVIEW_PAGE) && fs.existsSync(REVIEW_CLIENT));
    rec('  … which is not offered to search engines, and not in the sitemap',
        /index: false/.test(read(REVIEW_PAGE))
        && !Sitemap.default().some((entry) => entry.url.includes('/collab/review')));
    rec('  … and is not linked from the page a partner reads', !/collab\/review/.test(clientSource));
    rec('it signs with the one way in the rest of the page uses', /ensureSession/.test(reviewClient));
    rec('  … and carries the wallet control every route has',
        /className="wallet-pill/.test(reviewClient) && /wallet-menu\.js/.test(reviewClient)
        && /WalletMenu\.attach/.test(reviewClient));
    // Read as code, because the client's own doc comment explains that it does *not* import this —
    // and a guard that reads prose fails on its own explanation, which is a finding about the guard.
    rec('the owner list is not in the browser bundle',
        !/collab-owners/.test(code(reviewClient)) && !/COLLAB_OWNERS/.test(code(reviewClient)));
    rec('the words the owner reads at each state are in the content module',
        ['needsWallet', 'notOwner', 'approve', 'reject', 'empty', 'footnote']
            .every((key) => typeof Content.REVIEW[key] === 'string')
        && typeof Content.REVIEW.approvedHint === 'function');
    rec('  … and the note limit is the store\'s own number, not a second copy of it',
        Content.REVIEW.noteLimit === Store.REQUEST_LIMITS.note, String(Content.REVIEW.noteLimit));
    rec('the page says what it cannot do, rather than leaving it to be discovered',
        /--remove/.test(Content.REVIEW.footnote) && /cannot do/.test(Content.REVIEW.footnote));

    // ------------------------------------------------------------------------ the card
    section('The announcement card');
    const Card = await import(pathToFileURL(path.join(ROOT, 'lib', 'collab-card.js')).href);
    const cardSource = read(path.join(ROOT, 'lib', 'collab-card.js'));

    // There is one crop, because the owner's painting is 1.79:1 and a 1:1 card would have to cut the
    // two portraits — which are the entire card. The size is the painting's own shape.
    rec('the card is one crop: the post, at the painting\'s own shape',
        Card.CARD_SIZE_KEYS.join(',') === 'post'
        && Card.CARD_SIZES.post.width === 1600 && Card.CARD_SIZES.post.height === 900);
    const layout = Card.cardLayout('post');
    rec('the layout is the same every time it is asked for',
        JSON.stringify(Card.cardLayout('post')) === JSON.stringify(layout));
    rec('  … because nothing in it is random', !/Math\.random/.test(code(cardSource)));
    rec('and an unknown size falls back to the post crop',
        JSON.stringify(Card.cardLayout('nonsense')) === JSON.stringify(layout));

    // The heart of it: the card does not draw its own medallions, it replaces the two portraits the
    // painting already has. So the layout has to be the painting's geometry, carried through the one
    // transform that puts the painting on the canvas — and that is recomputed here from the owner's
    // 2752x1536 original rather than taken on trust.
    const painted = Card.PAINTED_PORTRAITS;
    rec('the two painted portraits are recorded as fractions of the artwork',
        Object.keys(painted).join(',') === 'knight,lion'
        && Object.values(painted).every((p) => p.u > 0.05 && p.u < 0.95 && p.v > 0.05 && p.v < 0.95
            && p.r > 0.12 && p.r < 0.3 && p.fill > 0.8 && p.fill < 1),
        Object.entries(painted).map(([k, p]) => `${k} r${p.r} ×${p.fill}`).join(', '));
    rec('  … the knight is left of the middle and the lion is right of it',
        painted.knight.u < 0.5 && painted.lion.u > 0.5);
    const scale = Math.max(layout.width / Card.PAINTING.width, layout.height / Card.PAINTING.height);
    const artW = Card.PAINTING.width * scale;
    const artH = Card.PAINTING.height * scale;
    const place = (p) => ({ x: (layout.width - artW) / 2 + p.u * artW, y: (layout.height - artH) / 2 + p.v * artH, radius: p.r * artH });
    const at = (v) => Math.round(v * 10) / 10;
    rec('the painting is covered onto the card, not stretched — one uniform scale',
        Math.abs(layout.art.width - at(artW)) < 0.11 && Math.abs(layout.art.height - at(artH)) < 0.11
        && Math.abs(layout.art.width / layout.art.height - Card.PAINTING.width / Card.PAINTING.height) < 0.002,
        `${layout.art.width}x${layout.art.height}`);
    rec('and the painting covers the card — no bars, no letterboxing',
        layout.art.width >= layout.width - 0.2 && layout.art.height >= layout.height - 0.2);
    rec('the portraits land exactly where the painting painted them',
        [['knight', layout.left], ['lion', layout.right]].every(([key, circle]) => {
            const want = place(painted[key]);
            return Math.abs(circle.x - at(want.x)) < 0.11 && Math.abs(circle.y - at(want.y)) < 0.11
                && Math.abs(circle.radius - at(want.radius)) < 0.11;
        }), `${layout.left.x},${layout.left.y} r${layout.left.radius}`);
    rec('  … the two are not forced to the same size, because the painting\'s rims are not',
        layout.left.radius !== layout.right.radius
        && Math.abs(layout.left.radius - layout.right.radius) < layout.left.radius * 0.05);
    rec('  … and both are wholly inside the frame, so neither face is cut off',
        [layout.left, layout.right].every((c) => c.x - c.radius > 0 && c.x + c.radius < layout.width
            && c.y - c.radius > 0 && c.y + c.radius < layout.height));
    rec('each picture fills its own circle but stops short of the painted rim',
        [['knight', layout.left], ['lion', layout.right]].every(([key, c]) => c.portrait < c.radius
            && Math.abs(c.portrait - c.radius * painted[key].fill) < 0.11
            && c.radius - c.portrait > 8),
        `rims left showing: ${Math.round(layout.left.radius - layout.left.portrait)}px and ${Math.round(layout.right.radius - layout.right.portrait)}px`);
    rec('the palette is the page\'s, in the one place a canvas can read it',
        Card.CARD_PALETTE.gold === '#D4AF37' && Card.CARD_PALETTE.stone === '#0D0A08'
        && Card.CARD_PALETTE.bronze === '#B08D57');

    // The two lines of type go in the band along the floor of the painting, below the portraits and
    // below everything the artwork itself says: the whole point of using the owner's picture is that
    // the picture is not painted over.
    rec('the type sits in a band along the bottom of the card',
        layout.band.y >= layout.height * 0.85 && layout.band.y + layout.band.height <= layout.height + 0.5);
    rec('  … under the portraits rather than across them',
        layout.band.y > Math.max(layout.left.y + layout.left.radius, layout.right.y + layout.right.radius));
    rec('  … the prize line above the signature, both inside the card',
        layout.prize.y < layout.signature.y && layout.prize.y > layout.band.y
        && layout.signature.y < layout.height - 4);
    rec('  … and each line is capped at the card\'s width, so it shrinks instead of running off',
        [layout.prize, layout.signature].every((line) => line.maxWidth <= layout.width - 2 * layout.pad && line.maxWidth > layout.width * 0.8));
    rec('the shade behind the type starts transparent, so the painting is not darkened above it',
        layout.scrim > 0.3 && layout.scrim < 0.9);

    rec('the file is named for the partner, and names the crop it is',
        Card.cardFilename('FabledChronicle') === 'dungeon-knights-collab-fabledchronicle-post.png'
        && Card.cardFilename('@Fabled Chronicle!') === 'dungeon-knights-collab-fabled-chronicle-post.png',
        Card.cardFilename('@Fabled Chronicle!'));
    rec('  … with a name that a filesystem will take',
        !/[^a-z0-9.-]/.test(Card.cardFilename('@Fabled Chronicle!')));
    rec('a handle is printed with exactly one @',
        Card.cardHandle('FabledChronicle') === '@FabledChronicle' && Card.cardHandle('@FabledChronicle') === '@FabledChronicle');
    rec('the prize line is the project\'s own words, from the request that was approved',
        Card.prizeLineFor({ prize: '3 Knight capsules' }) === '3 Knight capsules');
    rec('  … and there is a line on the card even if the request had none',
        Card.prizeLineFor(null) === Card.CARD_WORDS.fallbackPrize);

    // A context that records instead of drawing. The card is asserted on what it *did*: which
    // pictures went in, which words came out, and what size the fitting settled on.
    const fakeCtx = () => {
        const calls = [];
        const record = (name) => (...callArgs) => { calls.push({ name, args: callArgs }); };
        const ctx = { calls };
        for (const name of ['save', 'restore', 'beginPath', 'closePath', 'clip', 'fill', 'stroke', 'fillRect', 'strokeRect', 'moveTo', 'lineTo', 'arc', 'ellipse', 'drawImage', 'fillText', 'setLineDash']) {
            ctx[name] = record(name);
        }
        ctx.createRadialGradient = () => ({ addColorStop: record('addColorStop') });
        ctx.createLinearGradient = () => ({ addColorStop: record('addColorStop') });
        ctx.measureText = (text) => {
            const px = Number((String(ctx.font).match(/(\d+(?:\.\d+)?)px/) || [])[1] || 16);
            return { width: String(text).length * px * 0.55 };
        };
        return ctx;
    };

    const left = { width: 400, height: 400, naturalWidth: 400, naturalHeight: 400, tag: 'ours' };
    const right = { width: 512, height: 512, naturalWidth: 512, naturalHeight: 512, tag: 'theirs' };
    const paint = { width: 1600, height: 893, naturalWidth: 1600, naturalHeight: 893, tag: 'the painting' };
    const drawCtx = fakeCtx();
    const drawReport = Card.drawCard(drawCtx, {
        layout,
        left,
        right,
        art: paint,
        handle: 'FabledChronicle',
        prize: '3 Knight capsules + 2 Genesis whitelist spots',
    });
    const imagesDrawn = drawCtx.calls.filter((call) => call.name === 'drawImage').map((call) => call.args[0]);
    rec('the painting goes down first, and the two pictures go on top of it',
        imagesDrawn.length === 3 && imagesDrawn[0] === paint && imagesDrawn[1] === left && imagesDrawn[2] === right);
    rec('  … so the card is the artwork rather than an overlay drawn on it',
        drawReport.painting === true && imagesDrawn.indexOf(left) > imagesDrawn.indexOf(paint));
    const arcs = drawCtx.calls.filter((call) => call.name === 'arc');
    rec('each picture is clipped to its own circle, inside its own rim',
        drawCtx.calls.filter((call) => call.name === 'clip').length === 2
        && arcs.length === 2 && arcs[0].args[2] === layout.left.portrait && arcs[1].args[2] === layout.right.portrait,
        `${arcs.length} circles drawn`);
    rec('  … and nothing else round is drawn — no chain, no links, no embers, no plate',
        drawCtx.calls.filter((call) => call.name === 'ellipse').length === 0
        && !/ember|chain|plaque|medallion/i.test(code(cardSource)));
    const words = drawCtx.calls.filter((call) => call.name === 'fillText').map((call) => String(call.args[0])).join('');
    rec('our wordmark and the partner\'s handle are on it',
        words.includes('DUNGEON KNIGHTS') && words.includes('@FabledChronicle'));
    rec('  … joined, so the card names the pair rather than the two of us separately',
        words.includes(`${Card.CARD_WORDS.ours}${Card.CARD_WORDS.joiner}@FabledChronicle`));
    rec('  … and the prize line from the request is on it', words.includes('3 Knight capsules'));
    rec('no word is drawn above the band, so the painting\'s own lettering stays visible',
        drawCtx.calls.filter((call) => call.name === 'fillText').every((call) => call.args[2] >= layout.band.y));
    rec('the fitting left the prize line at its designed size rather than shrinking it',
        drawReport.prizePx === layout.prize.px, `${drawReport.prizePx} of ${layout.prize.px}`);

    // Fitting has to earn its keep on the signature line, which is our wordmark plus theirs. A handle
    // long enough not to fit at the design size is not hypothetical — `@kingdomofnothing` is already
    // two thirds of the way there — so the type shrinks; it never truncates the name.
    const longHandle = 'A'.repeat(60);
    const longCtx = fakeCtx();
    const longReport = Card.drawCard(longCtx, { layout, left, right, art: paint, handle: longHandle, prize: 'x' });
    rec('a handle too long for the card shrinks the type rather than being cut off',
        longReport.signaturePx < layout.signature.px, `${longReport.signaturePx} of ${layout.signature.px}`);
    rec('  … and the name is still whole on the card',
        longCtx.calls.filter((call) => call.name === 'fillText').map((call) => String(call.args[0])).join('').includes(`@${longHandle}`));
    rec('a card drawn at the post size is the post size', longReport.layout === 'post');
    rec('the drawing helpers a browser needs are exported, and none of them run offline',
        typeof Card.renderCard === 'function' && typeof Card.loadImage === 'function' && typeof Card.canvasToPng === 'function');

    // .............................................................. the painted ground
    // The painting the owner supplied *is* the card, so three things about the file matter: that it
    // is there at the weight worth serving, that it is the painting's own proportion — the portraits
    // are placed by that proportion, so a file with a different one would put both of them off their
    // rims — and that it is wide enough to be drawn without being upscaled.

    /** The size of a WebP, from whichever of its three headers it carries. */
    const webpSize = (buffer) => {
        const chunk = buffer.slice(12, 16).toString('ascii');
        if (chunk === 'VP8 ') {
            return [buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff];
        }
        if (chunk === 'VP8L') {
            const bits = buffer.readUInt32LE(21);
            return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
        }
        if (chunk === 'VP8X') {
            return [1 + buffer.readUIntLE(24, 3), 1 + buffer.readUIntLE(27, 3)];
        }
        return [0, 0];
    };

    const artwork = (() => {
        const rel = Card.CARD_ART.replace(/^\//, '');
        const file = path.join(ROOT, 'public', rel);
        return { rel, file, bytes: fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0) };
    })();

    rec('the painting is one file, named where the module says it is',
        Card.CARD_ART.endsWith('collab-card-art.webp') && /CARD_ART/.test(cardSource) && artwork.bytes.length > 1000, artwork.rel);
    rec('  … and it is on disk, as WebP by its own header',
        artwork.bytes.slice(8, 12).toString('ascii') === 'WEBP');
    const artworkSize = webpSize(artwork.bytes);
    rec('  … at the painting\'s own proportion, which is what puts the portraits on their rims',
        Math.abs(artworkSize[0] / artworkSize[1] - Card.PAINTING.width / Card.PAINTING.height) < 0.002,
        `${artworkSize.join('×')} against ${Card.PAINTING.width}×${Card.PAINTING.height}`);
    rec('  … 1600 wide, the card\'s own width, so nothing is upscaled',
        artworkSize[0] === 1600 && artworkSize[1] > 880 && artworkSize[1] < 900, artworkSize.join('×'));
    rec('and it is at a weight worth serving — the original was 5.6 MB',
        artwork.bytes.length < 400 * 1024, `${Math.round(artwork.bytes.length / 1024)} KB`);

    const bare = fakeCtx();
    const bareReport = Card.drawCard(bare, { layout, left, right, handle: 'FabledChronicle', prize: '3 Knight capsules' });
    rec('a missing painting is tolerated by the renderer, a missing profile picture is not',
        /\.catch\(\(\) => null\)/.test(code(cardSource)) && /loadImage\(rightSrc\)/.test(cardSource));
    rec('  … and with no painting it is still a card: flat stone, the same two pictures and words',
        bareReport.painting === false && drawReport.painting === true
        && bare.calls.filter((call) => call.name === 'drawImage').length === 2
        && bare.calls.some((call) => call.name === 'fillRect' && call.args[0] === 0 && call.args[1] === 0
            && call.args[2] === layout.width && call.args[3] === layout.height));
    rec('the shade behind the words is the only thing drawn over the painting',
        drawReport.scrim > 0.3 && drawReport.scrim < 0.9
        && drawCtx.calls.filter((call) => call.name === 'addColorStop').length === 2);
    const artworkFiles = fs.readdirSync(path.join(ROOT, 'public', 'assets', 'collab'));
    rec('no stray original is left in the folder — the 5.6 MB source is not shipped',
        !artworkFiles.some((name) => name.startsWith('_')), artworkFiles.join(' '));
    rec('  … and the two drawn cards the painting replaced are gone, not merely unused',
        !artworkFiles.includes('collab-card-post.webp') && !artworkFiles.includes('collab-card-square.webp'));

    const ourPfpPath = path.join(ROOT, 'public', Content.OUR_PFP.replace(/^\//, ''));
    rec('our own profile picture is a local file, not a hotlink', String(Content.OUR_PFP).startsWith('/assets/collab/') && fs.existsSync(ourPfpPath));
    rec('  … and it is a picture, by its own header',
        fs.readFileSync(ourPfpPath).slice(0, 3).toString('hex') === 'ffd8ff'
        || fs.readFileSync(ourPfpPath).slice(0, 4).toString('hex') === '89504e47');
    rec('the card draws that file and no other source of ours', /OUR_PFP/.test(cardSource) && !/https?:\/\/(?!x\.com)/.test(code(cardSource)));
    rec('the submission is the only thing that puts a picture on it',
        /prizeLineFor/.test(cardSource) && /cardHandle/.test(cardSource));

    // ------------------------------------------------------------------- the submission UI
    section('The section on the page');
    const subSource = read(path.join(ROOT, 'app', 'collab', 'submission.js'));
    rec('the page renders it', /CollabSubmission/.test(read(path.join(ROOT, 'app', 'collab', 'client.js')))
        && fs.existsSync(path.join(ROOT, 'app', 'collab', 'submission.js')));
    rec('it sends a request to its own endpoint', /\/api\/collab\/submission'/.test(subSource));
    rec('  … uploads the picture to the photo endpoint', /\/api\/collab\/submission\/photo'/.test(subSource));
    rec('  … and can withdraw what it sent', /method: 'DELETE'/.test(subSource));
    rec('it signs before it sends, like registration does', /ensureSession/.test(subSource));
    rec('it never sets a status of its own', !/setRequestStatus/.test(subSource) && !/status:\s*'approved'/.test(subSource));
    rec('the picture is shrunk before it is sent, so the cap is reachable',
        /512/.test(subSource) && /toBlob/.test(subSource) && /PHOTO_DATA_URL_MAX/.test(subSource));
    rec('the card is downloadable, and it is made fresh for the download',
        /cardFilename/.test(subSource) && /canvasToPng/.test(subSource) && /Download the PNG/.test(subSource)
        && !/collab-ratios/.test(subSource));
    rec('the copy a project reads at each step is in the content module',
        ['pendingTitle', 'approvedTitle', 'rejectedTitle', 'needsWallet', 'cardNote'].every((key) => typeof Content.SUBMISSION[key] === 'string'));
    // The card is one file of the artwork with the two portraits replaced, and the note said otherwise
    // for two sections after that was true — "Both sizes are the same pieces … the banner" described
    // the first design. Copy that outlives the thing it describes is the failure this catches.
    rec('the card note describes the card that is actually made, at one size',
        /1600×900/.test(Content.SUBMISSION.cardNote) && !/both sizes|the banner/i.test(Content.SUBMISSION.cardNote));
    rec('  … and it names the account that answers', Content.SUBMISSION.pendingBody.includes('hear back from us'));

    // ------------------------------------------------------------------------ the owner's tool
    section('The owner\'s half');
    const toolPath = path.join(ROOT, 'tools', 'collab-requests.js');
    const toolSource = read(toolPath);
    rec('there is still a tool, for the jobs the browser deliberately does not have', fs.existsSync(toolPath));
    rec('  … and approving is its job, not the page\'s',
        /--approve/.test(toolSource) && /--reject/.test(toolSource) && /setRequestStatus/.test(toolSource));
    rec('  … and approving no longer prints an object for anybody to paste',
        !/projectObject/.test(code(toolSource)) && !/COLLAB_PROJECTS/.test(code(toolSource))
        && /nothing to paste/.test(toolSource));
    rec('  … instead it prints the slug the project takes, and what the tab shows',
        /result\.request\.slug/.test(toolSource) && /--projects/.test(toolSource)
        && /listedProjects/.test(toolSource));
    rec('  … and it says where the picture is uploaded, so the two halves meet',
        /#submit/.test(toolSource));
    rec('  … and where the browser half of the same job is, with the wallet that can open it',
        /\/collab\/review/.test(toolSource) && /owner wallet/.test(toolSource));
    rec('  … keeping the one thing the page must never offer, a delete button',
        /--remove/.test(toolSource) && !/purgeRequest/.test(code(read(path.join(ROOT, 'app', 'api', 'collab', 'review', 'route.js')))));

    console.log('');
    const failed = results.filter((r) => !r.pass);
    console.log(`${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length) {
        console.log('');
        for (const f of failed) console.log(`  FAILED: ${f.label}`);
    }
    cleanup();
    process.exitCode = failed.length ? 1 : 0;
})().catch((error) => {
    console.error(error);
    cleanup();
    process.exitCode = 1;
});
