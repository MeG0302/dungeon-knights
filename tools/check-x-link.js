#!/usr/bin/env node
/**
 * Can the X link actually be started — for a player who is not signed in to Privy?
 *
 *     node tools/check-x-link.js
 *
 * The bug this is about was invisible in the source and invisible to the type checker. Privy's own
 * declaration says:
 *
 *     linkTwitter: () => void;
 *
 * and the runtime returns a **rejecting promise** for a player who is not authenticated. So the
 * call sat inside a `try { … } catch`, looking careful, catching nothing: the rejection escaped as
 * an uncaught error in the console, and `linkX()` returned `true` — so the page told the player the
 * link had started while nothing had opened. A type that says `void` is not a promise that resolves.
 *
 * "Not authenticated" is also a normal state here rather than an error: `connected` on the Points
 * page means a wallet is available, and an injected wallet needs no Privy login at all. So the
 * checks below are about both halves — the right flow is started, and no path ever rejects.
 *
 * It drives `startXLink` from `lib/x-link.js` with fakes, because the bridge that calls it is JSX
 * inside a Privy provider and no Node harness in this project renders React. The source assertions
 * at the end are what keep that coverage pointed at the real thing.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

const SDK_AUTH_ERROR = 'User must be authenticated before linking an account.';

// The bug this file is about arrived as an **unhandled rejection**, which is invisible to a check
// that returns a value and then exits — Node prints it and carries on, and `process.exit` at the end
// can retire the process before it is ever reported. So they are counted, and the count is asserted
// after a microtask turn, rather than assumed from "nothing threw".
let unhandled = 0;
process.on('unhandledRejection', () => { unhandled += 1; });

(async () => {
    console.log('');
    console.log('Points Program — starting the X link');

    const { startXLink, isAuthRequired, describeLinkFailure } = await import(
        pathToFileURL(path.join(ROOT, 'lib', 'x-link.js')).href
    );

    /** What each SDK function was asked, so the checks can be about calls and not just answers. */
    const calls = { link: 0, login: 0, loginMethods: [] };

    function sdk({ authenticated = true, linkRejects = null, loginRejects = null, login = true } = {}) {
        calls.link = 0;
        calls.login = 0;
        calls.loginMethods = [];
        return {
            authenticated,
            linkTwitter: linkRejects === 'sync'
                ? () => { calls.link += 1; throw new Error(SDK_AUTH_ERROR); }
                : linkRejects
                    ? () => { calls.link += 1; return Promise.reject(new Error(linkRejects)); }
                    : () => { calls.link += 1; },
            login: login
                ? (options) => {
                    calls.login += 1;
                    calls.loginMethods.push(options?.loginMethods);
                    if (loginRejects) return Promise.reject(new Error(loginRejects));
                    return undefined;
                }
                : undefined,
        };
    }

    // ------------------------------------------------------------------ 1. the signed-in player
    console.log('');
    console.log('Signed in to Privy: link the account');

    let fake = sdk({ authenticated: true });
    let out = await startXLink(fake);
    rec('a signed-in player goes to the link flow', out.ok === true && out.via === 'link', JSON.stringify(out));
    rec('and it is the link flow that was called', calls.link === 1 && calls.login === 0,
        `link ${calls.link}, login ${calls.login}`);

    // ------------------------------------------- 2. the bug: rejected instead of linked
    console.log('');
    console.log('Not signed in — the case that used to reject and lie');

    fake = sdk({ authenticated: false });
    out = await startXLink(fake);
    rec('a player with no Privy session is sent to sign in with X, not refused',
        out.ok === true && out.via === 'login', JSON.stringify(out));
    rec('the sign-in modal is asked for X alone, so the player is not made to hunt for it',
        JSON.stringify(calls.loginMethods) === JSON.stringify([['twitter']]), JSON.stringify(calls.loginMethods));
    rec('and nothing was linked to nobody', calls.link === 0, `link ${calls.link}`);

    // A session that lapses between render and click arrives the other way round: `authenticated`
    // still reads true, and the SDK rejects asynchronously.
    fake = sdk({ authenticated: true, linkRejects: SDK_AUTH_ERROR });
    out = await startXLink(fake);
    rec('a link rejected for a lapsed session signs in instead of erroring',
        out.ok === true && out.via === 'login' && calls.login === 1, JSON.stringify(out));
    rec('and the rejection did not escape', true, 'resolved instead of throwing');

    fake = sdk({ authenticated: true, linkRejects: 'sync' });
    out = await startXLink(fake);
    rec('an SDK that throws synchronously (the type it advertises) is handled too',
        out.ok === true && out.via === 'login', JSON.stringify(out));

    // ------------------------------------------------------- 3. every real failure is an answer
    console.log('');
    console.log('When it cannot be started, it says so — quietly');

    fake = sdk({ authenticated: true, linkRejects: 'not allowed for this app' });
    out = await startXLink(fake);
    rec('a refused link comes back as ok:false with a sentence, not a rejection',
        out.ok === false && typeof out.reason === 'string' && out.reason.length > 20,
        out.reason);
    rec('and the sentence points at what still works', /type your handle/i.test(out.reason || ''), out.reason);
    rec('the failure text never quotes SDK jargon at the player',
        !/must be authenticated|PrivyClientError|undefined/.test(out.reason || ''), out.reason);

    fake = sdk({ authenticated: true, linkRejects: SDK_AUTH_ERROR, loginRejects: 'modal unavailable' });
    out = await startXLink(fake);
    rec('a sign-in that cannot open is reported rather than swallowed',
        out.ok === false && out.reason === describeLinkFailure(), out.reason);

    fake = sdk({ authenticated: false, login: false });
    out = await startXLink(fake);
    rec('no bridge at all is still an answer, not a crash', out.ok === false, JSON.stringify(out));

    out = await startXLink(undefined);
    rec('and so is calling it with nothing', out.ok === false, JSON.stringify(out));

    // The one thing that must never happen on any path.
    let rejected = false;
    for (const options of [
        { authenticated: true, linkRejects: 'boom' },
        { authenticated: false, loginRejects: 'boom' },
        { authenticated: true, linkRejects: SDK_AUTH_ERROR, loginRejects: 'boom' },
        { authenticated: true, linkRejects: 'sync' },
    ]) {
        try {
            await startXLink(sdk(options));
        } catch {
            rejected = true;
        }
    }
    rec('no combination of failures makes startXLink reject', rejected === false,
        'four failing shapes, all resolved');

    await new Promise((resolve) => setImmediate(resolve));
    rec('and none of them reached the console as an unhandled rejection', unhandled === 0,
        `${unhandled} unhandled rejection(s)`);

    rec('the SDK\'s wording is recognised however it arrives',
        isAuthRequired(new Error(SDK_AUTH_ERROR)) === true
        && isAuthRequired('must be authenticated') === true
        && isAuthRequired(new Error('network down')) === false,
        'matched loosely, matched correctly');

    // ------------------------------------------------------------------- the wiring, in source
    console.log('');
    console.log('The bridge and the page still do what this module assumes');

    const read = (relative) => fs.readFileSync(path.join(ROOT, ...relative.split('/')), 'utf8');
    const bridge = read('app/privy-bridge.js');
    const page = read('app/points/client.js');

    rec('the bridge hands the decision to this module',
        /linkX: \(\) => startXLink\(\{/.test(bridge), 'startXLink({ … })');
    // The pass-through is the point — without it the unauthenticated fallback has nothing to call.
    // It is wrapped rather than bare (the wrapper marks the flow as ours for the OAuth guard), so
    // the check is that the call is still there, not that nothing else is.
    rec('the bridge gives it the login function, or the fallback cannot work',
        /login: \(options\) => \{[\s\S]{0,120}?stateRef\.current\.login\?\.\(options\)/.test(bridge),
        'login passed through');
    rec('and that wrapper marks the flow as this browser\'s own before it runs',
        /login: \(options\) => \{\n\s+markPrivyFlowStarted\(\);/.test(bridge),
        'marked before login');
    rec('and it publishes `login` so a sign-in is possible at all',
        /^\s+login,$/m.test(bridge), 'login in the state ref');
    rec('the old shape that returned success around a promise is gone',
        !/linkTwitter\?\.\(\);\s*\n\s*return true;/.test(bridge), 'no bare return true');
    rec('the page awaits the answer instead of truthy-checking a promise',
        /await window\.privyBridge\.linkX\(\)/.test(page), 'awaited');
    rec('and says which flow was started, because that is all anyone knows',
        /attempt\.via === 'login'/.test(page), "via === 'login'");
    rec('the page no longer branches on a promise being truthy',
        !/const started = window\.privyBridge\?\.linkX\?\.\(\);/.test(page), 'no `started`');

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
