#!/usr/bin/env node
/**
 * May a Privy sign-in open itself? Only if this browser asked for it.
 *
 *     node tools/check-oauth-return.js
 *
 * Privy completes an OAuth flow by reading `privy_oauth_code`, `privy_oauth_state` and
 * `privy_oauth_provider` out of the address bar, and it **opens its own modal to do it — with no
 * click**. Measured on production: that URL shows Privy's UI by itself, a clean one never does.
 *
 * Right for the flow the player just started; wrong for the same URL arriving as a pasted link, a
 * restored tab, or a reload — which looks to a player like *the site asked me to sign in on its
 * own*. So a return is resumed only when this browser left a mark saying it started one, and every
 * other callback URL is stripped before the SDK can read it.
 *
 * WHERE THE STRIPPING HAS TO HAPPEN is the part that took two measurements to get right. Module
 * scope in `app/providers.js` ran too late on production — the modal still opened — and an inline
 * `beforeInteractive` script was placed *after* the app's chunk scripts in the document (byte 9758
 * against 1018), so it can lose the race too. `middleware.js` is the only placement with no race,
 * which is what sections 4 and 7 below are about: the server-side decision, and the middleware
 * actually calling it before it serves anything.
 *
 * The rule is one pure function (`decideOauthReturn`) called by both halves, so neither half has a
 * private opinion about when a callback is ours.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const NOW = 1_700_000_000_000;
const TTL = 20 * 60 * 1000;
const COOKIE = 'dk_privy_flow';

const DROPPED = 'dk_privy_dropped';

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

/** A full callback query, the way X sends the browser back. */
const CALLBACK = '?privy_oauth_code=abc123&privy_oauth_state=state456&privy_oauth_provider=twitter';

function paramsFrom(search) {
    const query = new URLSearchParams(search);
    return {
        privy_oauth_code: query.get('privy_oauth_code') || '',
        privy_oauth_state: query.get('privy_oauth_state') || '',
        privy_oauth_provider: query.get('privy_oauth_provider') || '',
    };
}

/**
 * The smallest browser either half can be driven in: a `document` whose cookie is a plain string and
 * a `window.location` / `window.history` that record what the guard does to them.
 */
function fakeBrowser({ search = '', cookies = {}, protocol = 'https:' } = {}) {
    const jar = new Map(Object.entries(cookies));
    const writes = { replaced: [], warnings: [], cookies: [], navigated: [] };
    let cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    return {
        writes,
        jar,
        get cookie() {
            return cookie;
        },
        set cookie(value) {
            // Recorded raw as well as parsed: the attributes are the point (`Path`, `SameSite`,
            // `Secure`), and a jar that keeps only name and value would hide them.
            writes.cookies.push(String(value));
            const [pair] = String(value).split(';');
            const [name, val] = pair.split('=');
            if (val === '') jar.delete(name);
            else jar.set(name, val);
            cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
        },
        location: {
            search,
            pathname: '/points',
            hash: '',
            protocol,
            replace: (url) => writes.navigated.push(url),
        },
        history: { replaceState: (a, b, url) => writes.replaced.push(url) },
    };
}

/** Drive the guard the way the page does: a browser and a clock we control. */
function guard(browser, now = NOW) {
    return installOauthReturnGuard({
        document: browser ? { cookie: browser.cookie } : null,
        location: browser ? browser.location : null,
        history: browser ? browser.history : null,
        now,
    });
}

let installOauthReturnGuard = null;

(async () => {
    console.log('');
    console.log('Points Program — a Privy callback may only resume our own flow');

    const M = await import(pathToFileURL(path.join(ROOT, 'lib', 'privy-oauth-return.js')).href);
    const {
        decideOauthReturn,
        withoutOauthParams,
        oauthParamsFrom,
        readMarkerCookie,
        callbackStripTarget,
        markPrivyFlowStarted,
        installOauthReturnGuard: install,
        MARKER_COOKIE,
    } = M;
    installOauthReturnGuard = install;

    const decide = (over = {}) => decideOauthReturn({
        now: NOW, ttlMs: TTL, params: paramsFrom(CALLBACK), ...over,
    });

    // ------------------------------------------------------------------ 1. the ordinary load
    console.log('');
    console.log('An ordinary visit');

    rec('a URL with no OAuth parameters is left alone',
        decideOauthReturn({ params: paramsFrom('?ref=AB12C'), now: NOW }).action === 'ignore',
        decideOauthReturn({ params: paramsFrom('?ref=AB12C'), now: NOW }).reason);
    rec('blank parameters are not parameters',
        decideOauthReturn({ params: { privy_oauth_code: '', privy_oauth_state: '   ' }, now: NOW }).action === 'ignore',
        'whitespace ignored');
    rec('the rule does not carry a private copy of the parameter names',
        MARKER_COOKIE === COOKIE, MARKER_COOKIE);

    // --------------------------------------------------------------- 2. ours, and only ours
    console.log('');
    console.log('Ours is resumed, anyone else’s is stripped');

    const ours = decide({ startedAt: String(NOW - 60_000) });
    rec('a return this browser started is handed to Privy',
        ours.action === 'keep' && ours.reason === 'ours', `${ours.action}/${ours.reason}`);

    const foreign = decide({ startedAt: null });
    rec('a callback URL nobody here asked for is stripped',
        foreign.action === 'strip' && foreign.reason === 'not-started-here', `${foreign.action}/${foreign.reason}`);
    rec('and the code it carried is named in the decision, for the log',
        foreign.code === 'abc123', foreign.code);

    rec('a mark from an hour ago is not a reason to open anything',
        decide({ startedAt: String(NOW - 61 * 60 * 1000) }).action === 'strip',
        decide({ startedAt: String(NOW - 61 * 60 * 1000) }).reason);
    rec('a mark with a timestamp in the future is not either',
        decide({ startedAt: String(NOW + 60_000) }).action === 'strip', 'clock skew refused');
    rec('a mark that is not a number is not a mark',
        decide({ startedAt: 'yesterday' }).action === 'strip', 'unparseable');

    rec('a code already handled is stripped even if a mark is present',
        decide({ startedAt: String(NOW - 1000), seenCode: 'abc123' }).action === 'strip',
        decide({ startedAt: String(NOW - 1000), seenCode: 'abc123' }).reason);
    rec('a different code is still ours to finish',
        decide({ startedAt: String(NOW - 1000), seenCode: 'other' }).action === 'keep', 'ours');

    rec('a partial callback is stripped too — the SDK needs all three, but the URL still lies',
        decide({ params: paramsFrom('?privy_oauth_code=abc123'), startedAt: null }).action === 'strip',
        'one of three present');

    // ---------------------------------------------------------------- 3. reading the query
    console.log('');
    console.log('Reading the query, and putting it back without the parameters');

    rec('the invite code survives, the OAuth parameters do not',
        withoutOauthParams('?privy_oauth_code=a&ref=AB12C&privy_oauth_state=b&utm_source=x') === '?ref=AB12C&utm_source=x',
        withoutOauthParams('?privy_oauth_code=a&ref=AB12C&privy_oauth_state=b&utm_source=x'));
    rec('nothing left means no question mark',
        withoutOauthParams(CALLBACK) === '', `"${withoutOauthParams(CALLBACK)}"`);
    rec('an empty query is an empty query', withoutOauthParams('') === '', '""');
    rec('and the three parameters are read out whole, not by prefix',
        oauthParamsFrom(CALLBACK).privy_oauth_code === 'abc123', oauthParamsFrom(CALLBACK).privy_oauth_code);

    // ------------------------------------------------------------- 4. the server-side decision
    console.log('');
    console.log('The server’s half — what the middleware strips');

    const strip = (over = {}) => callbackStripTarget({ pathname: '/points', search: CALLBACK, now: NOW, ...over });

    rec('a callback with no marker cookie becomes a redirect with the parameters gone',
        strip().strip === true && strip().to === '/points', `${strip().strip} → ${strip().to}`);
    rec('and the reason says why, so production logs are readable',
        strip().reason === 'not-started-here', strip().reason);
    rec('an invite code beside it survives the redirect',
        strip({ search: '?privy_oauth_code=a&ref=AB12C' }).to === '/points?ref=AB12C',
        strip({ search: '?privy_oauth_code=a&ref=AB12C' }).to);
    rec('a URL with nothing OAuth-shaped is never touched',
        strip({ search: '?ref=AB12C' }).strip === false, 'no strip');
    rec('and neither is a clean load of the page itself',
        strip({ search: '' }).strip === false, 'no strip');

    const freshCookie = `other=1; ${COOKIE}=${NOW - 30_000}; dk_gate=x`;
    rec('a fresh marker cookie means this return is ours to finish',
        strip({ cookieHeader: freshCookie }).strip === false && strip({ cookieHeader: freshCookie }).reason === 'ours',
        strip({ cookieHeader: freshCookie }).reason);
    rec('a stale marker cookie does not count as having started anything',
        strip({ cookieHeader: `${COOKIE}=${NOW - 45 * 60 * 1000}` }).strip === true, 'stale');
    rec('a marker with junk in it does not count either',
        strip({ cookieHeader: `${COOKIE}=not-a-time` }).strip === true, 'unparseable');
    rec('an empty marker is not a marker',
        strip({ cookieHeader: `${COOKIE}=` }).strip === true, 'empty value');
    rec('and a cookie header with no marker at all is the ordinary foreign case',
        strip({ cookieHeader: 'a=1; b=2' }).strip === true, 'absent');

    rec('the cookie is found among others, not by position',
        readMarkerCookie(`a=1; ${COOKIE}=123; b=2`) === '123', readMarkerCookie(`a=1; ${COOKIE}=123; b=2`));
    rec('a cookie whose value contains an equals sign is still read',
        readMarkerCookie(`${COOKIE}=a=b`) === 'a=b', readMarkerCookie(`${COOKIE}=a=b`));
    rec('a missing header is null, not a crash',
        readMarkerCookie('') === null && readMarkerCookie(undefined) === null, 'null');
    rec('and a cookie *name* that merely starts the same way is not the marker',
        readMarkerCookie(`${COOKIE}_x=1`) === null, 'no prefix match');

    // -------------------------------------------------------- 5. the mark, and the client guard
    console.log('');
    console.log('The browser’s half — the mark the bridge leaves, and the fallback guard');

    let browser = fakeBrowser();
    const marked = markPrivyFlowStarted({ document: browser, location: browser.location, now: NOW });
    const setCookie = browser.writes.cookies[0] || '';
    rec('the bridge’s mark is written as a first-party cookie the server can read',
        marked === true && browser.jar.get(COOKIE) === String(NOW), setCookie);
    rec('with a path of / so it is sent on the redirect back from X',
        /Path=\/;/.test(setCookie), setCookie);
    rec('SameSite=Lax, which is what a top-level return navigation carries',
        /SameSite=Lax/.test(setCookie), setCookie);
    rec('and Secure on https, so it is not sent in the clear',
        /; Secure/.test(setCookie), setCookie);

    const local = fakeBrowser({ protocol: 'http:' });
    markPrivyFlowStarted({ document: local, location: local.location, now: NOW });
    rec('but not on http://localhost, where a Secure cookie is dropped — dev returns must still work',
        !/; Secure/.test(local.writes.cookies[0] || ''), local.writes.cookies[0]);

    // The mark the bridge leaves is what the server reads back.
    const serverSees = callbackStripTarget({
        pathname: '/points',
        search: CALLBACK,
        cookieHeader: browser.cookie,
        now: NOW + 1000,
    });
    rec('so the return that follows a click reaches Privy',
        serverSees.strip === false && serverSees.reason === 'ours', serverSees.reason);

    browser = fakeBrowser({ search: CALLBACK });
    let decision = guard(browser);
    rec('a foreign callback closes before Privy can see it',
        decision.action === 'strip' && browser.writes.replaced.length === 1, browser.writes.replaced[0] || 'nothing replaced');
    rec('the address bar is rewritten without the OAuth parameters',
        browser.writes.replaced[0] === '/points', browser.writes.replaced[0]);

    browser = fakeBrowser({ search: '?privy_oauth_code=a&ref=AB12C' });
    guard(browser);
    rec('and a referral in the same URL is kept',
        browser.writes.replaced[0] === '/points?ref=AB12C', browser.writes.replaced[0]);

    browser = fakeBrowser({ search: CALLBACK, cookies: { [COOKIE]: String(NOW - 5000) } });
    decision = guard(browser);
    rec('our own return is left for Privy to finish',
        decision.action === 'keep' && browser.writes.replaced.length === 0, decision.action);

    browser = fakeBrowser({ search: CALLBACK });
    browser.history.replaceState = () => { throw new Error('history is locked'); };
    decision = guard(browser);
    rec('a browser that refuses history.replaceState still gets the parameters out of the URL',
        decision.action === 'strip' && browser.writes.navigated[0] === '/points',
        browser.writes.navigated[0] || 'nothing navigated');
    rec('and it does not throw on the way out',
        browser.writes.replaced.length === 0, 'replaceState failed, replace used');

    rec('and being called with no browser at all is not an error',
        guard(null).action === 'ignore' && guard(null).reason === 'no-browser', guard(null).reason);

    // ---------------------------------------- 6. leftovers from the version before this one
    console.log('');
    console.log('What the previous guard left behind, and the note a dropped callback leaves');

    // The old marker lived in sessionStorage, which the server cannot read — the reason the
    // marker is a cookie now. Nothing may still depend on those keys.
    const legacyStore = new Map([
        ['dk:privy:flow-started', String(NOW - 60_000)],
        ['dk:privy:oauth-seen', 'oldcode'],
    ]);
    const legacyStorage = {
        getItem: (k) => (legacyStore.has(k) ? legacyStore.get(k) : null),
        setItem: (k, v) => legacyStore.set(k, String(v)),
        removeItem: (k) => legacyStore.delete(k),
    };
    const legacyBrowser = fakeBrowser();
    const migration = M.migrateLegacyMarker({ storage: legacyStorage, document: legacyBrowser, now: NOW });
    rec('a flow the old version started is carried over rather than dropped',
        migration.promoted === true && legacyBrowser.jar.get(COOKIE) === String(NOW),
        legacyBrowser.jar.get(COOKIE) || 'no cookie');
    rec('and the old keys are cleared, so nothing reads them again',
        migration.cleared === true
        && legacyStore.get('dk:privy:flow-started') === undefined
        && legacyStore.get('dk:privy:oauth-seen') === undefined,
        `started=${legacyStore.get('dk:privy:flow-started')} seen=${legacyStore.get('dk:privy:oauth-seen')}`);

    const alreadyMarked = fakeBrowser({ cookies: { [COOKIE]: String(NOW - 1000) } });
    const staleStore = new Map([['dk:privy:flow-started', String(NOW - 45 * 60 * 1000)]]);
    M.migrateLegacyMarker({
        storage: {
            getItem: (k) => (staleStore.has(k) ? staleStore.get(k) : null),
            setItem: (k, v) => staleStore.set(k, String(v)),
            removeItem: (k) => staleStore.delete(k),
        },
        document: alreadyMarked,
        now: NOW,
    });
    rec('a stale legacy marker is not promoted over a live one',
        alreadyMarked.jar.get(COOKIE) === String(NOW - 1000), alreadyMarked.jar.get(COOKIE));
    rec('and no storage at all is not an error',
        M.migrateLegacyMarker({ storage: null, document: null, now: NOW }).cleared === false, 'no storage');

    const noted = fakeBrowser({ cookies: { [DROPPED]: 'not-started-here' } });
    const notice = M.consumeDroppedNotice({ document: noted });
    rec('a dropped callback is read back with its reason',
        notice?.dropped === true && notice.reason === 'not-started-here', JSON.stringify(notice));
    rec('and it is taken once, not on every page afterwards',
        !noted.jar.has(DROPPED) && M.consumeDroppedNotice({ document: noted }) === null, 'cleared');
    rec('no note is not a note',
        M.consumeDroppedNotice({ document: fakeBrowser() }) === null, 'null');

    // A browser will not let a non-secure Set-Cookie clobber a secure one, and the middleware
    // always sets this one Secure. Measured on the live-equivalent: without this the note came
    // back on every page load, which is worse than never showing it.
    const secureDelete = fakeBrowser({ cookies: { [DROPPED]: 'not-started-here' } });
    M.consumeDroppedNotice({ document: secureDelete, location: { protocol: 'https:' }, isSecureContext: true });
    rec('the deletion is marked Secure where the cookie was',
        /; Secure/.test(secureDelete.writes.cookies[0] || ''), secureDelete.writes.cookies[0]);
    const localDelete = fakeBrowser({ cookies: { [DROPPED]: 'not-started-here' } });
    M.consumeDroppedNotice({ document: localDelete, location: { protocol: 'http:' }, isSecureContext: true });
    rec('and on http://localhost too, which is a secure context',
        /; Secure/.test(localDelete.writes.cookies[0] || ''), localDelete.writes.cookies[0]);

    const providersSource = fs.readFileSync(path.join(ROOT, 'app', 'providers.js'), 'utf8');
    rec('the app publishes the note where a page can find it',
        /window\.DKPrivyNotice = dropped/.test(providersSource)
        && /privyCallbackDropped/.test(providersSource), 'global and event');

    const pointsSource = fs.readFileSync(path.join(ROOT, 'app', 'points', 'client.js'), 'utf8');
    rec('the Points page says so, conditionally — a pasted URL leaves the same evidence',
        /If you were linking X, that did not finish/.test(pointsSource), 'conditional sentence');
    rec('and clears the flag rather than repeating itself',
        /delete window\.DKPrivyNotice/.test(pointsSource), 'deleted once read');

    const middlewareSource = fs.readFileSync(path.join(ROOT, 'middleware.js'), 'utf8');
    rec('the middleware leaves the note when it strips one',
        /stripped\.cookies\.set\(DROPPED_COOKIE/.test(middlewareSource), 'cookie set on the redirect');

    // ------------------------------------------------------------- 7. where it is installed
    console.log('');
    console.log('The middleware is the first line, and it runs before anything is served');

    const middleware = fs.readFileSync(path.join(ROOT, 'middleware.js'), 'utf8');
    rec('the middleware asks the shared rule, rather than re-deciding for itself',
        /^import \{[^}]*\bcallbackStripTarget\b[^}]*\} from '\.\/lib\/privy-oauth-return';$/m.test(middleware),
        'imported from lib/privy-oauth-return');
    rec('it consults it before it decides anything else about the request',
        middleware.indexOf('callbackStripTarget(') < middleware.indexOf('decideRoute('),
        'strip asked first');
    rec('and it redirects to the stripped URL, 307, on the same host',
        /NextResponse\.redirect\(new URL\(callback\.to, request\.url\), 307\)/.test(middleware),
        '307 to a relative target');
    rec('only when the rule said to strip',
        /if \(callback\.strip\)/.test(middleware), 'guarded by the decision');
    rec('the marker cookie reaches the rule from the request headers',
        /cookieHeader: request\.headers\.get\('cookie'\)/.test(middleware), 'request cookie header');
    rec('the three parameter names live in one place, not in the middleware too',
        !/['"]privy_oauth/.test(middleware) && !/OAUTH_PARAMS/.test(middleware),
        'no private list of names, comments aside');

    const layout = fs.readFileSync(path.join(ROOT, 'app', 'layout.js'), 'utf8');
    rec('the root layout no longer ships an inline guard script',
        !/beforeInteractive/.test(layout) && !/oauthGuardSource/.test(layout),
        'removed: it was placed after the app chunks');

    const providers = fs.readFileSync(path.join(ROOT, 'app', 'providers.js'), 'utf8');
    rec('app/providers.js still installs the fallback guard',
        /installOauthReturnGuard\(\)/.test(providers), 'installOauthReturnGuard()');
    // Module scope, because an effect runs after children mount — which is after Privy has
    // already opened its modal. Asserted on what matters (the call sits above the component, and
    // is not reached from an effect) rather than on the exact shape of the block.
    const moduleScope = providers.slice(0, providers.indexOf('export default function'));
    rec('at module scope, not inside the component or an effect',
        /^if \(typeof window !== 'undefined'\) \{/m.test(moduleScope)
        && /installOauthReturnGuard\(\);/.test(moduleScope),
        'top-level, before render');
    rec('and never from an effect',
        !/useEffect\([\s\S]{0,240}?installOauthReturnGuard/.test(providers), 'no effect');
    rec('and the provider is still mounted after it',
        providers.indexOf('installOauthReturnGuard()') < providers.indexOf('<PrivyProvider'),
        'guard first, provider second');

    const bridge = fs.readFileSync(path.join(ROOT, 'app', 'privy-bridge.js'), 'utf8');
    rec('the bridge marks the login it opens',
        /login: \(\) => \{\n\s+markPrivyFlowStarted\(\);/.test(bridge), 'login marked');
    rec('and the X link, both of its flows',
        (bridge.match(/markPrivyFlowStarted\(\)/g) || []).length === 3,
        `${(bridge.match(/markPrivyFlowStarted\(\)/g) || []).length} marks (login, linkTwitter, startXLink login)`);

    const failed = results.filter((r) => !r.pass);
    console.log('');
    console.log(`  ${results.length - failed.length}/${results.length} checks passed`);
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
