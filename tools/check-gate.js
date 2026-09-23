#!/usr/bin/env node
/**
 * Can the password be walked around?
 *
 *     node tools/check-gate.js                 # offline, everything
 *     node tools/check-gate.js --against-live   # plus the running dev server, if one is up
 *
 * The private host has three ways to fail, and all three look like nothing in a browser:
 *
 *   1. **The gate is not applied.** The hub is served to a stranger, and it looks exactly like the
 *      site working. This is the one that shipped once already — the hub rewrite was ordered before
 *      the password check, so `app.dungeonknights.io/` answered 200 with the whole game.
 *   2. **The gate is applied too widely.** `dungeon-knights.vercel.app` is where the X webhook for
 *      the +500 follow task is registered, and a gate expressed as "not the apex" would have taken
 *      it out silently. A locked-out webhook reports nothing; it just stops arriving.
 *   3. **The gate is forgeable.** A cookie is the whole session, so an unsigned or shared-secret
 *      cookie is a password that can be typed once and then duplicated by anyone who can read
 *      theirs.
 *
 * So this file tests the two halves separately. `lib/app-gate.js` is asked about passwords and
 * cookies — including tokens minted in **other processes**, which is how a token from a deployment
 * with a different secret is shown to be worthless here. `lib/app-routing.js` is asked which host
 * serves what, path by path, and in particular is asked for the hub **without** a password and
 * required to say `gate` and not `rewrite`.
 *
 * It imports those two modules directly and never `middleware.js`: `next` ships no `exports` map, so
 * `next/server` does not resolve under ESM and importing the middleware dies before reaching a
 * rule. That is the reason the rules were moved out of it — and the source assertions at the end
 * exist so the offline coverage cannot quietly stop being coverage of the real thing.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const MIDDLEWARE = path.join(ROOT, 'middleware.js');

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

/** A section header, so a wall of assertions stays readable. */
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

const PASSWORD = 'harness-gate-password';
process.env.APP_GATE_PASSWORD = PASSWORD;
process.env.APP_HOSTS = 'app.dungeonknights.io';
delete process.env.APP_GATE_SECRET;

/**
 * Run a snippet in a fresh Node process and read one JSON value back.
 *
 * The gate reads `APP_GATE_PASSWORD` and `APP_HOSTS` when the module loads, so the answers that
 * depend on environment have to come from a process that started with that environment. Anything
 * simpler would be testing the harness's own copy of the rule.
 */
function freshProcess(snippet, env = {}) {
    const childEnv = { ...process.env, ...env };
    for (const [key, value] of Object.entries(env)) if (value === null) delete childEnv[key];
    const script = `
        const run = async () => {
            const gate = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'lib', 'app-gate.js')).href)});
            const routing = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'lib', 'app-routing.js')).href)});
            ${snippet}
        };
        run().then((value) => process.stdout.write('@@' + JSON.stringify(value) + '@@'))
             .catch((error) => process.stdout.write('@@' + JSON.stringify({ error: String(error && error.message || error) }) + '@@'));
    `;
    const out = execFileSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], {
        env: childEnv,
        cwd: ROOT,
        encoding: 'utf8',
    });
    const match = out.match(/@@([\s\S]*)@@/);
    if (!match) throw new Error(`fresh process said nothing useful: ${out.slice(0, 400)}`);
    return JSON.parse(match[1]);
}

(async () => {
    console.log('');
    console.log('The private host');

    const Gate = await import(pathToFileURL(path.join(ROOT, 'lib', 'app-gate.js')).href);
    const Routing = await import(pathToFileURL(path.join(ROOT, 'lib', 'app-routing.js')).href);
    const { safeNext } = await import(pathToFileURL(path.join(ROOT, 'lib', 'safe-next.js')).href);

    const now = Math.floor(Date.now() / 1000);

    // ----------------------------------------------------------------------------- the password
    section('The password');
    rec('the configured password opens the door', (await Gate.passwordMatches(PASSWORD)) === true);
    rec('a wrong password of the same length does not', (await Gate.passwordMatches('harness-gate-passwore')) === false);
    rec('a shorter one does not', (await Gate.passwordMatches('harness')) === false);
    rec('a longer one does not', (await Gate.passwordMatches(`${PASSWORD}!`)) === false);
    rec('an empty string does not', (await Gate.passwordMatches('')) === false);
    rec('a non-string does not — rather than being coerced into one', (await Gate.passwordMatches(null)) === false
        && (await Gate.passwordMatches(12345)) === false && (await Gate.passwordMatches({ toString: () => PASSWORD })) === false);
    rec('gateConfigured() is true when one is set', Gate.gateConfigured() === true);

    // ------------------------------------------------------------------------------- the cookie
    section('The cookie');
    const token = await Gate.issueGateToken();
    const read = await Gate.readGateToken(token);
    rec('a token it just issued reads back', read && read.expiresAt > now);
    rec('  … expiring a month out, not a year', read.expiresAt - now <= Gate.GATE_TTL + 5 && Gate.GATE_TTL === 30 * 24 * 60 * 60,
        `${Math.round((read.expiresAt - now) / 86400)} days`);
    rec('the token carries an expiry and a signature, and nothing else', token.split('.').length === 2
        && !/0x|@|wallet/i.test(token));

    // Not a regex over the token: it is random base64url, so `0x` or `wallet` can appear in it by
    // chance and a check like that fails roughly once in a few hundred runs. Decode the payload and
    // test the shape instead.
    const [payload, signature] = token.split('.');
    let payloadNumber = NaN;
    try { payloadNumber = Number(Buffer.from(payload, 'base64url').toString('utf8')); } catch {}
    rec('the payload is an expiry and the signature is base64url, with no padding to mistake for input',
        Number.isFinite(payloadNumber) && payloadNumber > now
        && /^[A-Za-z0-9_-]+$/.test(signature), `${payloadNumber}`);
    const later = Buffer.from(String(now + Gate.GATE_TTL * 12)).toString('base64url').replace(/=+$/, '');
    rec('an expiry edited to a later date is refused — the signature covers it',
        (await Gate.readGateToken(`${later}.${signature}`)) === null);
    rec('a signature edited by one character is refused',
        (await Gate.readGateToken(`${payload}.${signature.slice(0, -1)}${signature.slice(-1) === 'A' ? 'B' : 'A'}`)) === null);
    rec('a token with no signature at all is refused', (await Gate.readGateToken(payload)) === null
        && (await Gate.readGateToken(`${payload}.`)) === null);
    rec('garbage is refused rather than throwing', (await Gate.readGateToken('not-a-token')) === null
        && (await Gate.readGateToken('')) === null && (await Gate.readGateToken(null)) === null);

    const expired = await Gate.issueGateToken(now - Gate.GATE_TTL - 10);
    rec('an expired token is refused', (await Gate.readGateToken(expired)) === null);
    rec('  … and an expiry that is not a number is refused rather than compared as NaN',
        (await Gate.readGateToken(`${Buffer.from('later').toString('base64url')}.${signature}`)) === null);

    // A token from a deployment with a different secret. This is the check that says the cookie is
    // bound to *this* configuration: change the password and every session ends.
    const foreign = freshProcess('return await gate.issueGateToken();', { APP_GATE_SECRET: 'a-different-deployment-secret' });
    rec('a token minted by a deployment with a different secret is refused', (await Gate.readGateToken(foreign)) === null);
    const otherPassword = freshProcess('return await gate.passwordMatches("someone-elses-password");', {
        APP_GATE_PASSWORD: 'someone-elses-password',
        APP_GATE_SECRET: null,
    });
    rec('  … and so is a password from another configuration', otherPassword === true
        ? (await Gate.passwordMatches(PASSWORD)) === true && foreign !== token
        : true, 'each deployment only accepts its own');

    const cookieHeader = Gate.gateCookie(token);
    rec('the cookie is HttpOnly, so script cannot read it', /HttpOnly/.test(cookieHeader));
    rec('  … SameSite=Lax and Path=/, so it travels with navigation and no further',
        /SameSite=Lax/.test(cookieHeader) && /Path=\//.test(cookieHeader));
    rec('  … Secure over https, and not on the local http test',
        /Secure/.test(cookieHeader) && !/Secure/.test(Gate.gateCookie(token, { secure: false })));
    rec('  … named dk_app_gate and carrying the token, not the password',
        cookieHeader.startsWith('dk_app_gate=') && !cookieHeader.includes(PASSWORD));

    rec('the dev-host cookie sets for 1 and clears for 0',
        /dk_app_host=1/.test(Gate.devHostCookie('1')) && /Max-Age=0/.test(Gate.devHostCookie('0')));

    rec('a cookie is found among others',
        Gate.cookieValue({ headers: { get: () => 'a=1; dk_app_gate=THE.token; b=2' } }, 'dk_app_gate') === 'THE.token');
    rec('  … and a prefix of a name is not a match',
        Gate.cookieValue({ headers: { get: () => 'x_dk_app_gate=nope' } }, 'dk_app_gate') === null);

    // --------------------------------------------------------------------------------- the hosts
    section('Which hostname is gated');
    rec('the app hostname is gated', Gate.isAppHost('app.dungeonknights.io') === true);
    rec('  … with a port on it', Gate.isAppHost('app.dungeonknights.io:443') === true);
    rec('  … and in whatever case the header arrives', Gate.isAppHost('APP.DungeonKnights.IO') === true);
    rec('the apex is not', Gate.isAppHost('dungeonknights.io') === false);
    rec('a lookalike hostname is not', Gate.isAppHost('app.dungeonknights.io.evil.com') === false
        && Gate.isAppHost('notapp.dungeonknights.io') === false);
    rec('the vercel hostname is not — the X webhook is registered against it',
        Gate.isAppHost('dungeon-knights.vercel.app') === false);
    rec('an empty Host header is not', Gate.isAppHost('') === false && Gate.isAppHost(null) === false);
    rec('the list is an allowlist, so it can be widened without touching code',
        Gate.APP_HOSTS.includes('app.dungeonknights.io'));

    const widened = freshProcess('return gate.APP_HOSTS;', { APP_HOSTS: ' Preview.DungeonKnights.io:443 , app.dungeonknights.io ' });
    rec('a comma-separated list is parsed, lowercased and stripped of ports',
        JSON.stringify(widened) === JSON.stringify(['preview.dungeonknights.io', 'app.dungeonknights.io']),
        widened.join(', '));

    const unconfigured = freshProcess('return { configured: gate.gateConfigured(), accepts: await gate.passwordMatches("anything") };', {
        APP_GATE_PASSWORD: null,
    });
    rec('with no password set the host is NOT gated — and nothing is accepted',
        unconfigured.configured === false && unconfigured.accepts === false,
        'an unconfigured deployment behaves like today rather than locking the team out');

    rec('the dev escape hatch is read only in development',
        Gate.isAppRequest({ host: 'dungeon-knights.vercel.app', devHostCookie: '1', isProduction: false }) === true
        && Gate.isAppRequest({ host: 'dungeon-knights.vercel.app', devHostCookie: '1', isProduction: true }) === false,
        'the same cookie, two environments');

    // -------------------------------------------------------------------------------- the split
    section('What the apex serves');
    const apex = (pathname, search = '') => Routing.decideRoute({
        isApp: false,
        isApex: true,
        kind: Routing.classify(pathname),
        pathname,
        search,
        passwordConfigured: true,
        gateAllowed: false,
    });

    for (const publicPath of [
        '/', '/points', '/genesis', '/portfolio',
        '/api/points/me', '/api/waitlist', '/api/wallet/balance',
        '/api/staking/holdings', '/api/game/history',
        '/theme.css', '/assets/ui/sword.png',
    ]) {
        rec(`${publicPath} is served on the apex`, apex(publicPath).action === 'next');
    }
    // The portfolio is where a Points player checks what a season of points produced, so the one
    // outcome that must never happen to it is the redirect that puts it behind the password. Named
    // on its own for the same reason `/genesis` is: it is a page the campaign sends strangers to,
    // and the failure would be invisible until somebody clicked the link in a post.
    rec('/portfolio is not redirected to the gated host — the Points campaign links to it',
        apex('/portfolio').action === 'next' && apex('/portfolio').to === undefined,
        JSON.stringify(apex('/portfolio')));
    // The collection page is advertised on the landing page, so the one thing that must never
    // happen to it on the apex is the redirect that would put it behind the password. Named
    // separately from the loop above because this is the failure the feature would ship with, and a
    // message saying so is worth more than an `ok` inside a list of seven paths.
    rec('/genesis is not redirected to the gated host — it is a page strangers are sent to',
        apex('/genesis').action === 'next' && apex('/genesis').to === undefined,
        JSON.stringify(apex('/genesis')));
    rec('/api/x/events is served on the apex too — it is signed, and it is what X calls',
        apex('/api/x/events').action === 'next');

    for (const gamePath of ['/menu', '/mint', '/dungeons', '/game', '/gate']) {
        const decision = apex(gamePath);
        rec(`${gamePath} redirects to the gated host`,
            decision.action === 'redirect' && decision.to === `https://app.dungeonknights.io${gamePath}`,
            decision.to);
    }
    const withQuery = apex('/dungeons', '?map=crypts');
    rec('  … and the query survives the redirect', withQuery.to === 'https://app.dungeonknights.io/dungeons?map=crypts', withQuery.to);
    rec('  … as https with no port on it — the local dev port must not leak into a published redirect',
        !/^https:\/\/app\.dungeonknights\.io:/.test(withQuery.to) && !/localhost/.test(withQuery.to));
    rec('/api/pointsomething is not covered by /api/points — a prefix is a path segment, not a string',
        Routing.classify('/api/pointsomething') === 'other', Routing.classify('/api/pointsomething'));
    rec('/menu is not swallowed by the public list', Routing.classify('/menu') === 'other');

    section('What the gate covers');
    const app = (pathname, { allowed = false, configured = true, search = '' } = {}) => Routing.decideRoute({
        isApp: true,
        isApex: false,
        kind: Routing.classify(pathname),
        pathname,
        search,
        passwordConfigured: configured,
        gateAllowed: allowed,
    });

    for (const openPath of ['/gate', '/api/gate', '/_next/static/chunk.js', '/assets/ui/sword.png', '/theme.css', '/api/x/events']) {
        rec(`${openPath} is reachable without the password — the gate needs its own assets`,
            app(openPath, { allowed: false }).action === 'next');
    }

    for (const gatedPath of ['/', '/menu', '/mint', '/dungeons', '/points', '/genesis', '/portfolio', '/landing.html']) {
        const decision = app(gatedPath, { allowed: false });
        rec(`${gatedPath} asks for the password`,
            decision.action === 'gate' && decision.next === gatedPath,
            decision.action === 'rewrite' ? 'SERVED THE HUB WITHOUT THE PASSWORD' : decision.next);
    }
    const gatedQuery = app('/mint', { allowed: false, search: '?utm=x' });
    rec('  … and remembers where they were going, query and all', gatedQuery.next === '/mint?utm=x', gatedQuery.next);

    section('What the hub does once the password is in');
    for (const hubPath of ['/', '/hub', '/landing', '/landing.html']) {
        const decision = app(hubPath, { allowed: true });
        rec(`${hubPath} serves the Kingdom Gate hub`,
            decision.action === 'rewrite' && decision.pathname === '/hub', JSON.stringify(decision));
    }
    rec('the hub is never served without the password — the two answers, side by side',
        app('/', { allowed: true }).action === 'rewrite' && app('/', { allowed: false }).action === 'gate',
        'this is the bug that shipped: rewrite before the gate');
    rec('everything else on the gated host routes normally once inside',
        app('/menu', { allowed: true }).action === 'next' && app('/portfolio', { allowed: true }).action === 'next');

    // THE PROPERTY THAT WAS BROKEN. The middleware decides *whether to check the cookie* and the
    // routing decides *whether to use it*, and those two must not disagree about which paths the
    // password covers. When they did — the middleware asked only about `other`, the decision treated
    // `apex-public` as gated — the root of the gated host could never be reached: a valid cookie on
    // `/?__app=1` bounced to `307 /gate?next=%2F`. Note that this is a property, not a list: every
    // earlier check in this file passed while the front door was locked.
    section('The check and the decision cover the same paths');
    const REPRESENTATIVE = [
        ['/api/x/events', 'global-open'],
        ['/', 'apex-public'],
        ['/points', 'apex-public'],
        ['/genesis', 'apex-public'],
        ['/theme.css', 'static'],
        ['/gate', 'app-open'],
        ['/menu', 'other'],
    ];
    for (const [sample, expectedKind] of REPRESENTATIVE) {
        const kind = Routing.classify(sample);
        const covered = Routing.gateCovers(kind);
        const locked = Routing.decideRoute({
            isApp: true, isApex: false, kind, pathname: sample, search: '', passwordConfigured: true, gateAllowed: false,
        });
        const unlocked = Routing.decideRoute({
            isApp: true, isApex: false, kind, pathname: sample, search: '', passwordConfigured: true, gateAllowed: true,
        });
        rec(`${sample} (${kind}) — the cookie is checked exactly when the answer depends on it`,
            expectedKind === kind && covered === (locked.action === 'gate'),
            covered ? `gated; locked to ${locked.action}` : `open; would have been ${locked.action}`);
        rec(`  … and a valid cookie is never sent back to the password screen`, unlocked.action !== 'gate',
            unlocked.action === 'gate' ? 'THIS IS THE LOCKOUT: the password cannot get you in' : unlocked.action);
    }

    const open = Routing.decideRoute({
        isApp: true, isApex: false, kind: Routing.classify('/menu'), pathname: '/menu', search: '',
        passwordConfigured: false, gateAllowed: false,
    });
    rec('with no password configured the gated host is open, not locked',
        open.action === 'next', 'the middleware warns about this on every request');

    // ---------------------------------------------------------------------------------------------
    // THE THIRD HOST CLASS — the one that took the live game offline. `dungeon-knights.vercel.app` is
    // neither the apex nor the gated host, and it has to keep serving exactly what it served before
    // this feature existed: the game, no gate, no redirect. Measured on production before the fix:
    // `/menu` and `/game` both answered `308 → https://app.dungeonknights.io/…`, and because the apex
    // redirected there too, the game was unreachable on **every** hostname at once — including the one
    // the X webhook is registered against.
    section('A host that is neither: untouched');
    const other = (pathname) => Routing.decideRoute({
        isApp: false, isApex: false, kind: Routing.classify(pathname), pathname, search: '',
        passwordConfigured: true, gateAllowed: false,
    });
    for (const pathname of ['/', '/menu', '/game', '/dungeons', '/mint', '/hub', '/gate', '/points', '/genesis', '/portfolio']) {
        const decision = other(pathname);
        rec(`${pathname} is served as it was — no gate, no redirect to a hostname that may not exist`,
            decision.action === 'next', JSON.stringify(decision));
    }
    rec('and it is not the apex by accident — the list is names, not "everything else"',
        Gate.isApexHost('dungeon-knights.vercel.app') === false
        && Gate.isApexHost('dungeonknights.io') === true
        && Gate.isApexHost('www.dungeonknights.io') === true
        && Gate.isApexHost('app.dungeonknights.io') === false
        && Gate.isApexHost('dungeonknights.io.evil.com') === false,
        Gate.APEX_HOSTS.join(', '));
    rec('the apex list is configurable without touching code, like the gated one',
        freshProcess('return gate.APEX_HOSTS;', { APEX_HOSTS: ' Example.COM:443 , dungeonknights.io ' })
            .join(',') === 'example.com,dungeonknights.io');
    rec('and the two lists cannot overlap — a hostname cannot be both public and gated',
        Gate.APP_HOSTS.every((h) => !Gate.APEX_HOSTS.includes(h)),
        `app: ${Gate.APP_HOSTS.join(',')} | apex: ${Gate.APEX_HOSTS.join(',')}`);

    // Needs its own process: with `APP_HOSTS` set, the fallback branch is unreachable here, and a
    // check that cannot reach the code it names is worse than no check.
    //
    // Unset *and* empty both mean the default. A list that parses to nothing at all — a stray comma
    // is the way to do that — must not make the apex redirect to `https://undefined/menu`, which is
    // the only reason that branch exists.
    const noAppHost = freshProcess(`
        return {
            hosts: gate.APP_HOSTS,
            decision: routing.decideRoute({ isApp: false, isApex: true, kind: 'other', pathname: '/menu', search: '' }),
        };
    `, { APP_HOSTS: ' , ' });
    rec('an app-host list that parses to nothing does not invent a redirect',
        noAppHost.hosts.length === 0 && noAppHost.decision.action === 'next', JSON.stringify(noAppHost.decision));

    const emptyIsDefault = freshProcess('return gate.APP_HOSTS;', { APP_HOSTS: '' });
    rec('an empty list is the default, not "gate nothing" — a blank variable must not open the host',
        JSON.stringify(emptyIsDefault) === JSON.stringify(['app.dungeonknights.io']), emptyIsDefault.join(', '));

    // -------------------------------------------------------------------------- the dev host switch
    section('The local host switch');
    const params = (value) => ({ get: (name) => (name === '__app' ? value : null) });
    rec('?__app=1 switches the branch locally and remembers it',
        JSON.stringify(Routing.readDevHost({ searchParams: params('1'), cookieValue: null, isProduction: false }))
        === JSON.stringify({ devHost: '1', setDevHost: '1' }));
    rec('?__app=0 switches back', Routing.readDevHost({ searchParams: params('0'), cookieValue: null, isProduction: false }).devHost === '0');
    rec('an unknown value is ignored, and the cookie stands',
        Routing.readDevHost({ searchParams: params('yes'), cookieValue: '1', isProduction: false }).devHost === '1');
    rec('in production the query is ignored', Routing.readDevHost({ searchParams: params('1'), cookieValue: null, isProduction: true }).devHost === null);
    rec('in production the cookie is ignored too — the Host header is the only thing consulted',
        Routing.readDevHost({ searchParams: params(null), cookieValue: '1', isProduction: true }).devHost === null);
    rec('nothing to set when nothing was asked for',
        Routing.readDevHost({ searchParams: params(null), cookieValue: '1', isProduction: false }).setDevHost === null);

    // -------------------------------------------------------------------------------- the ?next=
    section('The password screen\'s ?next=');
    const redirectCases = [
        ['/menu', '/menu'],
        ['/dungeons?map=crypts', '/dungeons?map=crypts'],
        ['//evil.com', '/'],
        ['/\\evil.com', '/'],
        ['https://evil.com', '/'],
        ['javascript:alert(1)', '/'],
        ['menu', '/'],
        ['', '/'],
    ];
    for (const [input, expected] of redirectCases) {
        rec(`next=${JSON.stringify(input)} → ${JSON.stringify(expected)}`, safeNext(input) === expected, safeNext(input));
    }
    rec('and a non-string is a straight no',
        safeNext(null) === '/' && safeNext(undefined) === '/' && safeNext(42) === '/');

    // ------------------------------------------------------------------------- the middleware itself
    section('The middleware does nothing but apply the decision');
    const middlewareSource = code(fs.readFileSync(MIDDLEWARE, 'utf8'));
    rec('it does not keep its own copy of the public-path lists — the tested rules are the live ones',
        !/APEX_PUBLIC|GLOBAL_OPEN|APP_OPEN|HUB_PATHS/.test(middlewareSource));
    rec('  … nor its own hub rewrite', !/'\/hub'/.test(middlewareSource));
    rec('  … nor its own reading of the dev switch', !/__app/.test(middlewareSource));
    rec('it applies a decision and nothing else',
        /decideRoute\(/.test(middlewareSource) && /decision\.action === 'gate'/.test(middlewareSource)
        && /decision\.action === 'rewrite'/.test(middlewareSource));
    rec('the async MAC check asks `gateCovers` — the same question the decision asks',
        /if \(isApp && passwordConfigured && gateCovers\(kind\)\)/.test(middlewareSource)
        && !/kind === 'other'/.test(middlewareSource),
        'written out by hand, the two definitions drifted and locked the front door');
    // Precise on purpose: `!isApp` appears legitimately in the dispatch (`if (!isApp) return apex(...)`),
    // so the property is that the apex is *identified* by hostname and *passed* as its own fact.
    rec('and the public host is identified by name, not as "whatever is not the gated host"',
        /const isApex = isApexHost\(host\)/.test(middlewareSource)
        && /decideRoute\(\{ isApp, isApex,/.test(middlewareSource),
        'the negative reading is what sent the vercel hostname to a hostname that does not resolve');
    rec('and every response on that host is noindex — even the open ones',
        /X-Robots-Tag/.test(middlewareSource) && /stamp\(NextResponse\.next\(\)\)/.test(middlewareSource));

    // ---------------------------------------------------------------------------- against the live one
    if (process.argv.includes('--against-live')) {
        section('Against the running server');
        // `127.0.0.1`, not `localhost`: Node's fetch resolves that name through the OS resolver and
        // fails with ENOTFOUND in this environment while curl on the same machine answers fine. The
        // Host header is not what selects the branch — that is `?__app=1` — so this changes nothing
        // about what is being tested.
        const base = process.env.PREVIEW_URL || 'http://127.0.0.1:3000';
        const ask = async (pathname, headers = {}) => {
            const res = await fetch(`${base}${pathname}`, { redirect: 'manual', headers });
            return { status: res.status, location: res.headers.get('location'), robots: res.headers.get('x-robots-tag') };
        };
        if (!process.env.APP_GATE_LIVE_PASSWORD) {
            rec('the running server was given its password to check against', false,
                'set APP_GATE_LIVE_PASSWORD (development: the value in .env.development.local)');
        }
        try {
            const apexMenu = await ask('/menu');
            rec('a game path on the apex 308s to the gated host',
                (apexMenu.status === 308 || apexMenu.status === 307) && /app\.dungeonknights\.io/.test(apexMenu.location || ''),
                `${apexMenu.status} ${apexMenu.location}`);

            const gated = await ask('/?__app=1');
            rec('the app branch without the cookie lands on the password screen',
                (gated.status === 307 || gated.status === 308) && /\/gate\?next=/.test(gated.location || ''),
                `${gated.status} ${gated.location}`);
            rec('  … and says noindex', (gated.robots || '').includes('noindex'));

            // On the **app branch**: the password endpoint belongs to the gated host, so on the apex
            // it is a 308 to the other hostname — which is correct, and is why this asks with the dev
            // switch that puts this request on the app side.
            const wrong = await fetch(`${base}/api/gate?__app=1`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'definitely-not-it' }),
            });
            rec('a wrong password is refused', wrong.status === 401, String(wrong.status));

            // The server's own password, which is *not* this process's: the unit checks above set
            // `APP_GATE_PASSWORD` to a harness value on purpose. In development it is whatever
            // `.env.development.local` sets (see the run doc); in a deployed environment it is the
            // real one, and it is passed in rather than read from a file here.
            const livePassword = process.env.APP_GATE_LIVE_PASSWORD;
            const right = await fetch(`${base}/api/gate?__app=1`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: livePassword }),
            });
            // Two `Set-Cookie` headers arrive — the gate cookie, and the dev host switch — and
            // `headers.get()` joins them into one string. Taking the first field of that string gave
            // whichever came first, which is not necessarily the one that opens the door.
            const rawCookies = typeof right.headers.getSetCookie === 'function'
                ? right.headers.getSetCookie()
                : [right.headers.get('set-cookie') || ''];
            const gateCookieHeader = rawCookies.find((entry) => entry.startsWith('dk_app_gate=')) || '';
            rec('the right one sets an HttpOnly gate cookie', right.status === 200
                && gateCookieHeader !== '' && /HttpOnly/i.test(gateCookieHeader));
            rec('  … and the password itself is nowhere in it', !rawCookies.join(' ').includes(PASSWORD));

            const cookie = rawCookies.map((entry) => entry.split(';')[0]).filter(Boolean).join('; ');
            const inside = await ask('/?__app=1', { cookie });
            rec('the cookie serves the hub at the root of the gated host',
                inside.status === 200 && !inside.location, `${inside.status} ${inside.location || ''}`);
        } catch (error) {
            rec('the running server answered', false, String(error?.message || error));
        }
    }

    // ---------------------------------------------------------------------------------- the tally
    const failed = results.filter((row) => !row.pass);
    console.log('');
    console.log(`${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length) {
        console.log('');
        for (const row of failed) console.log(`  FAILED  ${row.label}`);
        process.exit(1);
    }
})().catch((error) => {
    console.error('');
    console.error(error?.stack || error);
    process.exit(1);
});
