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
 * The decision is pure (`decideOauthReturn`), the stripping is faked, and the source assertions at
 * the end are what keep the guard where it has to be: **module scope in `app/providers.js`**, not an
 * effect. Effects run after children mount, which is after Privy has already opened its modal.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const NOW = 1_700_000_000_000;
const TTL = 20 * 60 * 1000;

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

/** The smallest browser the guard can be driven in. */
function fakeWindow({ search = '', stored = {} } = {}) {
    const store = new Map(Object.entries(stored));
    const writes = { replaced: [], warnings: [] };
    return {
        writes,
        store,
        location: { search, pathname: '/points', hash: '' },
        history: { replaceState: (a, b, url) => writes.replaced.push(url) },
        storage: {
            getItem: (k) => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: (k) => store.delete(k),
        },
    };
}

(async () => {
    console.log('');
    console.log('Points Program — a Privy callback may only resume our own flow');

    const M = await import(pathToFileURL(path.join(ROOT, 'lib', 'privy-oauth-return.js')).href);
    const { decideOauthReturn, withoutOauthParams, installOauthReturnGuard, markPrivyFlowStarted, STARTED_KEY, SEEN_KEY } = M;

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

    // --------------------------------------------------------------- 2. ours, and only ours
    console.log('');
    console.log('Ours is resumed, anyone else’s is stripped');

    const ours = decide({ startedAt: String(NOW - 60_000) });
    rec('a return this browser started is handed to Privy',
        ours.action === 'keep' && ours.reason === 'ours', `${ours.action}/${ours.reason}`);

    const foreign = decide({ startedAt: null });
    rec('a callback URL nobody here asked for is stripped',
        foreign.action === 'strip' && foreign.reason === 'not-started-here', `${foreign.action}/${foreign.reason}`);
    rec('and the code it carried is remembered, so it cannot be replayed',
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

    // ------------------------------------------------------------------- 3. the stripping
    console.log('');
    console.log('Stripping leaves everything else where it was');

    rec('the invite code survives, the OAuth parameters do not',
        withoutOauthParams('?privy_oauth_code=a&ref=AB12C&privy_oauth_state=b&utm_source=x') === '?ref=AB12C&utm_source=x',
        withoutOauthParams('?privy_oauth_code=a&ref=AB12C&privy_oauth_state=b&utm_source=x'));
    rec('nothing left means no question mark',
        withoutOauthParams(CALLBACK) === '', `"${withoutOauthParams(CALLBACK)}"`);
    rec('an empty query is an empty query', withoutOauthParams('') === '', '""');

    // ------------------------------------------------------- 4. the guard, as the page runs it
    console.log('');
    console.log('The guard, wired the way the page runs it');

    let win = fakeWindow({ search: CALLBACK, stored: {} });
    let decision = installOauthReturnGuard({ ...win, now: NOW });
    rec('a foreign callback closes before Privy can see it',
        decision.action === 'strip' && win.writes.replaced.length === 1, win.writes.replaced[0] || 'nothing replaced');
    rec('the address bar is rewritten without the OAuth parameters',
        win.writes.replaced[0] === '/points', win.writes.replaced[0]);

    win = fakeWindow({ search: '?privy_oauth_code=a&ref=AB12C', stored: {} });
    installOauthReturnGuard({ ...win, now: NOW });
    rec('and a referral in the same URL is kept',
        win.writes.replaced[0] === '/points?ref=AB12C', win.writes.replaced[0]);

    win = fakeWindow({ search: CALLBACK, stored: { [STARTED_KEY]: String(NOW - 5000) } });
    decision = installOauthReturnGuard({ ...win, now: NOW });
    rec('our own return is left for Privy to finish',
        decision.action === 'keep' && win.writes.replaced.length === 0, decision.action);
    rec('the mark is spent, so the same URL reopened later is not',
        win.store.get(STARTED_KEY) === undefined && win.store.get(SEEN_KEY) === 'abc123',
        `started ${win.store.get(STARTED_KEY)}, seen ${win.store.get(SEEN_KEY)}`);

    // Reopening the very same callback URL, which is the behaviour that was complained about.
    win = fakeWindow({ search: CALLBACK, stored: { [SEEN_KEY]: 'abc123' } });
    decision = installOauthReturnGuard({ ...win, now: NOW });
    rec('reopening the same callback URL opens nothing',
        decision.action === 'strip' && win.writes.replaced.length === 1, decision.reason);

    // Storage that throws is a browser with storage off, which must not become a broken page.
    const hostile = {
        location: { search: CALLBACK, pathname: '/points', hash: '' },
        history: { replaceState: () => {} },
        storage: {
            getItem: () => { throw new Error('storage disabled'); },
            setItem: () => { throw new Error('storage disabled'); },
            removeItem: () => { throw new Error('storage disabled'); },
        },
        now: NOW,
    };
    rec('a browser with storage switched off is still guarded, not crashed',
        installOauthReturnGuard(hostile).action === 'strip', 'no memory means nothing is trusted');

    const noBrowser = installOauthReturnGuard({ location: null, storage: null, history: null, now: NOW });
    rec('and being called with no browser at all is not an error',
        noBrowser.action === 'ignore' && noBrowser.reason === 'no-browser', noBrowser.reason);

    // The mark the bridge leaves, through the real function.
    win = fakeWindow({ search: '', stored: {} });
    markPrivyFlowStarted({ storage: win.storage, now: NOW });
    rec('the bridge’s mark is what the guard reads back',
        win.store.get(STARTED_KEY) === String(NOW), win.store.get(STARTED_KEY));
    const afterMark = installOauthReturnGuard({ ...fakeWindow({ search: CALLBACK, stored: { [STARTED_KEY]: win.store.get(STARTED_KEY) } }), now: NOW + 1000 });
    rec('so a flow started a second before the return is resumed',
        afterMark.action === 'keep', afterMark.action);

    // ------------------------------------------------------------------- 5. where it runs
    console.log('');
    console.log('The guard runs before Privy can act');

    const providers = fs.readFileSync(path.join(ROOT, 'app', 'providers.js'), 'utf8');
    rec('app/providers.js installs it',
        /installOauthReturnGuard\(\)/.test(providers), 'installOauthReturnGuard()');
    rec('at module scope, not inside the component or an effect',
        /^if \(typeof window !== 'undefined'\) \{\n\s+installOauthReturnGuard\(\);\n\}$/m.test(providers),
        'top-level, before render');
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
