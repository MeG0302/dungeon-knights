#!/usr/bin/env node
/**
 * The Portfolio page reads, and only reads.
 *
 *     node tools/check-portfolio.js
 *
 * Five things have to stay true for this page to be worth trusting, and four of them are
 * invisible in a screenshot:
 *
 *   1. **Every endpoint it reads exists.** A hand-typed `/api/…` path that is off by a
 *      word does not fail loudly — `readJson` throws, the section says "the read failed",
 *      and the page looks like a chain outage forever. This checks each path against the
 *      filesystem, which is the only place a typo shows up before a player finds it.
 *   2. **It cannot move a token.** The page is read-only by design; one `sendTransaction`
 *      added later would turn a viewer into a spender without anyone noticing.
 *   3. **The Genesis supply comes from the collection, not from a second band table.**
 *      Importing `HASH_POWER_BANDS` here would compile, render, and disagree with the
 *      contract the moment a band changes — the exact drift the vault's own table is
 *      published once to prevent.
 *   4. **The menu is the way in.** A route nobody links to is a route nobody opens, and
 *      the wallet menu is where "My Portfolio" was promised.
 *   5. **Nothing invents a number.** Each section is allowed to fail on its own; what it
 *      is not allowed to do is show a zero it did not read. That is asserted at runtime in
 *      `tools/check-all.js`, and here by requiring that a failed read has a sentence.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

const client = read('app/portfolio/client.js');
const program = read('lib/points-program.js');
const page = read('app/portfolio/page.js');
const menu = read('public/wallet-menu.js');
const css = read('public/css/portfolio.css');

/**
 * The client's **code**, with its comments removed.
 *
 * Every check below is a claim about what the page does, and this file's own comments explain
 * what the page deliberately does not do — "no `eth_call`, the obvious thing" sits three lines
 * above the code that avoids one. A guard that reads prose fails on its own explanation, which is
 * how the first draft of this harness reported a chain call that did not exist. Block comments
 * and whole-line `//` comments go; nothing else is touched, so a URL inside a string survives.
 */
function code(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');
}
const body = code(client);
// The sheet gets the same treatment, for the same reason: `portfolio.css` explains that it used to
// borrow the Hall's picture, and naming that file in the comment made the first draft of the check
// below report the very thing it was proving absent.
const cssCode = code(css);

// --------------------------------------------------------------------- 1. the route
rec('the route exists as a page and a client', exists('app/portfolio/page.js') && exists('app/portfolio/client.js'));
rec('the page renders the client rather than its own markup',
    /return <PortfolioClient \/>/.test(page));
rec('and it carries its own title, so a shared link is not "Dungeon Knights"',
    /title: \{ absolute: 'My Portfolio — Dungeon Knights' \}/.test(page));

// ------------------------------------------------------------------ 2. every endpoint
const paths = new Set();
for (const match of client.matchAll(/['"`](\/api\/[A-Za-z0-9/_-]+)/g)) paths.add(match[1]);
for (const match of client.matchAll(/`(\/api\/[^`]+?)`/g)) {
    const clean = match[1].split('?')[0];
    if (/^\/api\/[A-Za-z0-9/_-]+$/.test(clean)) paths.add(clean);
}

const wanted = [...paths].sort();
rec('the client reads at least the four sources it is built around', wanted.length >= 4,
    wanted.join(', '));

for (const route of wanted) {
    const file = path.join(ROOT, 'app', ...route.split('/').filter(Boolean), 'route.js');
    rec(`  ${route} has a route file`, fs.existsSync(file),
        fs.existsSync(file) ? '' : 'a typo here reads as a chain outage, not as a bug');
}

// ---------------------------------------------------------------- 3. read-only, truly
const writers = ['sendTransaction', 'writeContract', 'personal_sign', 'eth_sendTransaction', 'Signer', 'signMessage'];
const found = writers.filter((token) => body.includes(token));
rec('the page never signs or sends anything', found.length === 0, found.join(', '));

// The page contributes an address and nothing else. This was the first version's bug: it asked
// the wallet's own provider for the balance, so four sections showed real chain data while the
// headline said the wallet was unavailable — the normal state of a browser with a saved address
// and no extension. A chain library back in this file is how that comes back.
rec('the page itself never touches the chain',
    !/ethers-5\.7\.2/.test(body) && !/window\.ethereum/.test(body) && !/eth_call/.test(body),
    'no chain library, no provider, no raw call');
rec('the balance is a server read like the other four',
    /\/api\/wallet\/balance\?address=/.test(client),
    'the browser sends an address, the server asks the token');
rec('and that route delegates to the one reader that knows how',
    exists('app/api/wallet/balance/route.js')
        && /readDngBalance/.test(read('app/api/wallet/balance/route.js'))
        && /export async function readDngBalance/.test(read('lib/staking-chain.js')),
    'one implementation, no second copy of the token ABI');
rec('the reader asks the token for its own decimals rather than assuming 18',
    /encodeFunctionData\('decimals'/.test(read('lib/staking-chain.js'))
        && /encodeFunctionData\('symbol'/.test(read('lib/staking-chain.js')),
    'a balance scaled by a guessed decimal count is wrong by a billion');

// ------------------------------------------------- 4. one source for the published bands
rec('the chain label comes from the provider\'s own chain definition, not a typed-out name',
    /DEFAULT_CHAIN\.name/.test(client) && /from '\.\.\/\.\.\/lib\/privy-chains'/.test(client),
    'a deployment that moves to mainnet moves this line with it');
rec('the Genesis bands come back from the collection, not from a second table',
    !/HASH_POWER_BANDS/.test(body) && /supply\.bands/.test(body),
    'no import of the vault\'s table');
// Comments stripped, so the file header listing `/api/points/me` as a source does not read as a
// second way of asking. The status codes on that route are the shared helper's business.
const pointsFetch = /\/api\/points\/me/.test(body);
rec('the Points section asks through the shared session helper',
    /fetchMe\(\)/.test(body) && !pointsFetch,
    pointsFetch ? 'a hand-rolled fetch of /api/points/me is back' : 'one place decides what a 401 means');

// -------------------------------------------------------------- 5. the way in, the way out
rec('the wallet menu offers My Portfolio', /PORTFOLIO_HREF = '\/portfolio'/.test(menu));
rec('and actually renders it as a menu item',
    /PORTFOLIO_HREF/.test(menu) && /My Portfolio/.test(menu));
rec('each section links to the page that owns its action',
    ['href="/staking"', 'href="/game"', 'href="/mint"', 'href="/menu"', 'href="/points"']
        .every((link) => client.includes(link)),
    'read-only here, do-it-there');

// ------------------------------------------------------------------- 6. the honest states
rec('a failed read prints a reason instead of a number', /pf-warn/.test(client) && /dng\.error/.test(client));
rec('the sections settle independently', /Promise\.allSettled/.test(client),
    'one dead read must not blank the other three');
rec('an unsigned browser is told apart from a failed read',
    /'anon'/.test(body) && /status === 401/.test(body),
    'never signed in and session expired are different sentences');

// A 30-day session outlives a wallet: switch wallets in the extension and `/api/points/me` still
// answers for whoever signed. Printing that under the connected wallet's knights is the same lie
// the holdings route refuses, so the session's address is checked against the one on screen.
rec('a session belonging to another wallet is refused, not printed',
    /session\.address\)\.toLowerCase\(\) !== String\(who\)\.toLowerCase\(\)/.test(body)
        && /'other'/.test(body),
    'the mismatch is a sentence, not a silent number');
rec('and the refusal names the wallet it belongs to',
    /shortAddress\(points\.sessionAddress\)/.test(body),
    'so the player can tell which sign-in to redo');

// The chip says who, the pill says what: printing the address in both read as a stutter, and the
// vault and Points page both use the pill for the figure the page is about.
rec('the header pill shows the balance, not the address twice',
    /balance=\{dng\.phase === 'ready' \?/.test(body) && /\{shortAddress\(address\)\}/.test(body),
    'chip = who is connected, pill = the figure');
rec('a failed balance cannot render as zero',
    /dng\.phase === 'ready' \? fmtDng\(dng\.value\) : '—'/.test(client),
    "'—' until it is read");

// --------------------------------------------------------------------- 7. the styling
// The stamp has to be *some* number, not a specific one: pinning `?v=1` here made this check fail
// every time the sheet legitimately changed, which trains you to edit the assertion instead of
// reading it. What matters is that an edit to the sheet can actually reach a browser.
rec('the sheet exists and the client asks for it, with a version stamp',
    exists('public/css/portfolio.css') && /\/css\/portfolio\.css\?v=\d+/.test(client));
rec('it styles the four cards and the empty state',
    ['.pf-card', '.pf-tier-strip', '.pf-rows', '.pf-activity', '.pf-empty'].every((sel) => css.includes(sel)));
rec('and it has a phone layout', /@media \(max-width: 560px\)/.test(css) && /@media \(max-width: 900px\)/.test(css));
// The page has its own room. It used to borrow `knight-hall.webp` — the roster's — so a check that
// only asked "does some hall art resolve" passed on the wrong picture for as long as that lasted.
rec('the background art is the Portfolio\'s own, not the Hall\'s',
    /url\('\/assets\/hall\/portfolio\.webp'\)/.test(cssCode)
    && !/knight-hall\.webp|summon-hall\.webp/.test(cssCode)
    && exists('public/assets/hall/portfolio.webp'));
rec('and a phone still gets the room, from the small file',
    /url\('\/assets\/hall\/portfolio-mobile\.webp'\)/.test(cssCode)
    && exists('public/assets/hall/portfolio-mobile.webp'));

// ------------------------------------- 8. the two panels that are not live yet
// The campaign sends Points players here, so the page is public — but two of its panels read
// things that are not open to players yet. They are blurred with a label rather than emptied,
// which means each of these has to hold or the blur becomes decoration: the body hidden from
// assistive tech, the buttons inside genuinely inert, and the label saying what is coming.
const SOON = ['$DNG', 'Genesis'];
for (const name of SOON) {
    rec(`the ${name} panel is marked as not live yet`,
        new RegExp(`pf-card pf-soon[\\s\\S]{0,400}?${name.replace('$', '\\$')}`).test(client)
        || new RegExp(`${name.replace('$', '\\$')}[\\s\\S]{0,400}?pf-card pf-soon`).test(client),
        'pf-soon on the card');
}
rec('both panels carry the same chip',
    (client.match(/pf-soon-chip/g) || []).length === SOON.length,
    `${(client.match(/pf-soon-chip/g) || []).length} chips`);
rec('each says what will read there, rather than only "coming soon"',
    (client.match(/pf-soon-note/g) || []).length === SOON.length,
    `${(client.match(/pf-soon-note/g) || []).length} notes`);
// ------------------------------------------------- 9. the wallet it boots from
// A Points player who signed in with an email address has a wallet in the seam and nothing in
// localStorage. Reading the saved key alone put "Connect a wallet" in front of a page about the
// wallet they were already using — measured on the live apex, with a session, at 390×844. So the
// seam is asked first, and a sign-in that lands while the page is open re-asks.
rec('the wallet is read from the seam, not only from the saved key',
    /walletCapabilities\(\)/.test(client) && /caps\?\.address \|\| savedAddress\(\)/.test(client),
    'seam first, saved key as the fallback');
rec('and a sign-in that lands while the page is open is picked up',
    /addEventListener\('privyAuthChanged', read\)/.test(client)
        && /addEventListener\('privyBridgeReady', read\)/.test(client),
    'both events');
rec('the listeners are removed, and the read cannot land after unmount',
    /removeEventListener\('privyAuthChanged', read\)/.test(client) && /if \(!alive\) return;/.test(client),
    'cleanup + aliveness guard');
rec('the blurred body is hidden from a screen reader, which would read it as figures',
    (client.match(/pf-soon-body" aria-hidden="true"/g) || []).length === SOON.length,
    `${(client.match(/pf-soon-body" aria-hidden="true"/g) || []).length} aria-hidden bodies`);
rec('the stylesheet blurs it and makes its controls inert',
    /\.pf-soon-body[^{]*\{[^}]*filter:\s*blur\(/.test(css)
        && /\.pf-soon-body[^{]*\{[^}]*pointer-events:\s*none/.test(css),
    'blur + pointer-events: none');

// The same treatment without the chip, for things that are not "coming soon" — just not for a
// visitor: the chain and read stamp, and the two buttons that lead into the gated game. Both are
// on the public host, so both are furniture a stranger should not be handed.
rec('the chain, read stamp and refresh control are blurred too',
    /pf-identity-meta pf-blur/.test(client) && /\.pf-blur[^{]*\{/.test(css),
    'pf-blur on the identity meta');
rec('and the two buttons that lead into the gated game',
    /pf-actions pf-blur/.test(client),
    'pf-blur on the Knights actions');
rec('the blur is inert as well as blurred, so nothing behind it can be clicked',
    /\.pf-soon-body,\s*\n\.pf-blur\s*\{[^}]*pointer-events:\s*none/.test(css),
    'shared rule');

// ------------------------------------------------------------------ 10. what the panels print
// The tier tiles are photos and names now: the reward line under each one was a per-run figure
// printed on a page that cannot see the contract's table, which is the drift the vault exists to
// avoid. The page reads the numbers it shows; it does not restate the economy.
rec('the tier tiles carry no reward or runs-per-day line',
    !/pf-tier-econ/.test(client) && !/[0-9]+ DNG · [0-9]+\/day/.test(client),
    'photo, name and count only');
// A *price*, not the word `$DNG`. The needle here used to be `\$DNG\.` — a figure followed by a
// full stop, which was a stand-in for "a sentence that quotes a price" and is really a stand-in for
// "a sentence that mentions $DNG and then ends". The empty state the showcase cards added says
// *"earn $DNG. Five tiers from Common to Legendary"*, which is the token's name in a sentence rather
// than a figure, and it failed this check. The pattern is now what the sentence it was written for
// actually contains: a number in front of the token, the same shape `tools/check-docs.js` uses for
// the same reason.
const prose = client.replace(/\/\*[\s\S]*?\*\//g, '');
rec('and the knights panel does not advertise a price either',
    !/forges one for 500 \$DNG/.test(prose) && !/\d[\d,.]*\s*\$DNG\b/.test(prose),
    'no price tag on the panel');

// -------------------------------------------------------- 11. recent activity is points now
// The dungeon-run list is gone from this panel: runs and their $DNG claims happen in the vault and
// the game, both gated on this host, so a public page whose main panel is empty for every visitor
// is a page nobody comes back to. What it shows instead is the server's own log of what it paid.
rec('recent activity reads the points log, not the run history',
    /points\.data\?\.recent/.test(client) && /describeEarn\(entry\.reason\)/.test(client),
    'recent + describeEarn');
rec('and the log is written where points are paid, so a row and the balance agree',
    /return logEarn\(w, value, reason\)/.test(program),
    'inside credit()');
rec('every credit path is logged, commissions included',
    (program.match(/logEarn\(/g) || []).length === 4,
    `${(program.match(/logEarn\(/g) || []).length} call sites (definition is separate)`);
// The one direction the log did not have until `/redeem`: a spend. It goes through the same writer
// (`logPoints`), so a redeemed card is a row on the same list the earnings are on — which is what
// keeps a balance that fell explainable.
rec('  … and the one path that spends writes a row of its own, negative',
    /function logSpend\(w, points, reason\)/.test(program)
    && /return logSpend\(w, value, reason\)/.test(program)
    && /return logPoints\(w, points, reason\)/.test(program),
    'logPoints is the writer, logEarn and logSpend are the two ways in');
rec('the log is capped, because it is per wallet in a shared store',
    /ACTIVITY_LOG_LIMIT = \d+/.test(program) && /slice\(-ACTIVITY_LOG_LIMIT\)/.test(program),
    'bounded');
rec('a wallet that earned before the log existed is told the list starts now',
    /not itemised/.test(client), 'rather than shown an empty list as if nothing was earned');
rec('the panel says why it is empty when there is no session',
    /Sign in on the Points Program, and every point you earn is listed here/.test(client),
    'anon case');
rec('and the chip is styled, so it does not render as loose text',
    /\.pf-soon-chip\s*\{/.test(css) && /\.pf-soon-note\s*\{/.test(css));
// The panels are marked, the other three are not — otherwise this could pass by blurring the page.
rec('the panels that do work are not blurred',
    (client.match(/pf-card pf-soon/g) || []).length === SOON.length,
    `${(client.match(/pf-card pf-soon/g) || []).length} marked cards`);

// --------------------------------------------------- 12. My capsules, and the turn itself
// The one card on this page whose subject is a picture, and the only control here the reader
// touches. What it must not become is a second opinion about capsules: the count is the server's
// list, counted, and every rung in it is the rung the server worked out.
rec('My capsules counts what the server says the wallet holds, rather than re-deriving it',
    /points\.data\?\.giveaway\?\.capsules/.test(body) && /const capsuleTally = \{/.test(body)
    && !/doc\.capsules/.test(body),
    'one source, counted');
rec('  and the rungs it reports are the rungs of the claim ladder',
    ["'won'", "'claimed'", "'sent'", "'missed'"].every((status) => body.includes(`countOf(${status})`)),
    'won \u00b7 claimed \u00b7 sent \u00b7 missed');
rec('a win is given as a deadline here, not as a trophy on a shelf',
    /claim(ed)? on the day it is drawn/i.test(client),
    'the same rule the draw panel states');
rec('the turn is built from the exported frames, never from a path typed into the page',
    /capsuleSpinFrame\(/.test(body) && /CAPSULE_SPIN/.test(body) && !/capsule-spin\//.test(body),
    'the naming lives in points-config, and the page reads it');
rec('  and it answers to a pointer, to the arrow keys, and to a reader who asked for less motion',
    /onPointerDown=/.test(body) && /ArrowRight/.test(body) && /prefers-reduced-motion/.test(body),
    'drag, keys, and no arrival turn under reduced motion');
// The throw, in its two halves.
//
//   - The **browser** half stays a source check: an animation frame at all (a release that drops the
//     wheel where it is), momentum smoothed from the hand, a friction that multiplies per millisecond
//     rather than a step that adds, and a page that reads the shared curve instead of keeping a
//     private copy of the numbers — the last one is the bug that wears a constant.
//   - The **feel** half is now walkable. The decay moved into `lib/points-config.js` as a pure
//     function — a release speed in, a duration and a distance out — so "it coasts for a while" is
//     asserted as seconds and turns rather than pattern-matched as text. The bounds below are
//     deliberately loose: what must not happen is a flick that is over instantly, or one that
//     outlives the flick by a minute, and everything between those two is the owner's taste.
rec('  and a flick is thrown rather than dropped: it keeps turning and slows to a stop',
    /requestAnimationFrame/.test(body) && /cancelAnimationFrame/.test(body)
    && /velocity\.current \* 0\.6/.test(body)
    && /speed \*= Math\.pow\(CAPSULE_FLING\.friction, dt\)/.test(body)
    && /Math\.abs\(speed\) < CAPSULE_FLING\.stop/.test(body),
    'momentum from the hand, smoothed, decayed per millisecond, and interruptible by a new grab');
rec('  and the throw is the shared curve, not a second copy of the numbers in the page',
    /capsuleFling\(velocity\.current\)/.test(body) && /if \(thrown\.speed\) fling\(thrown\.speed\)/.test(body)
    && !/FLING_FRICTION/.test(body) && !/MIN_FLING/.test(body),
    'CAPSULE_FLING and capsuleFling, imported from points-config');
rec('and the section is styled, the frame included and no caption under it',
    /\.pf-capsules\s*\{/.test(css) && /\.pf-spin\s*\{/.test(css) && !/pf-spin-hint/.test(css),
    'pf-capsules, pf-spin, and deliberately no pf-spin-hint');

(async () => {
    const Config = await import('../lib/points-config.js');
    const fling = Config.CAPSULE_FLING;
    const flick = Config.capsuleFling(0.05);
    const nudge = Config.capsuleFling(0.02);
    const hardest = Config.capsuleFling(50);

    rec('  and a flick coasts for seconds rather than a moment — the point of handing it momentum',
        flick.durationMs > 4000 && flick.turns > 1.5,
        `0.05 frames/ms coasts ${(flick.durationMs / 1000).toFixed(2)}s over ${flick.turns.toFixed(2)} turns`);
    rec('  and even a gentle nudge keeps turning for a beat, because the wheel has weight',
        nudge.durationMs > 1000 && nudge.durationMs < flick.durationMs,
        `0.02 frames/ms coasts ${(nudge.durationMs / 1000).toFixed(2)}s, under the flick's ${(flick.durationMs / 1000).toFixed(2)}s`);
    rec('  and no release, however hard, spins for ever: the launch speed is capped',
        hardest.durationMs < 8000 && hardest.frames < 250 && hardest.speed === fling.max,
        `capped at ${fling.max} frames/ms → ${(hardest.durationMs / 1000).toFixed(2)}s, ${hardest.turns.toFixed(2)} turns`);
    rec('  and the friction is a decay and not a constant: some fraction lost every millisecond',
        fling.friction > 0 && fling.friction < 1 && fling.stop > 0 && fling.stop < fling.min,
        `friction ${fling.friction}, stop ${fling.stop} under min ${fling.min}`);
    rec('  and a careful placement is not thrown at all, because a release is not always a flick',
        Config.capsuleFling(0.003).speed === 0 && Config.capsuleFling(0.003).durationMs === 0
        && Config.capsuleFling(0.02).speed !== 0,
        `under ${fling.min} frames/ms the capsule stays where it was put`);
    rec('  and nothing gets past it: a non-number, a zero and a wild speed all answer a real coast',
        [NaN, undefined, null, 0, -3, 1e9].every((v) => {
            const out = Config.capsuleFling(v);
            return Number.isFinite(out.durationMs) && out.durationMs >= 0
                && Number.isFinite(out.frames) && out.frames >= 0;
        }),
        'NaN · undefined · null · 0 · -3 · 1e9');

    console.log('');
    const failed = results.filter((r) => !r.pass);
    console.log(`${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length) {
        console.log('');
        for (const f of failed) console.log(`  FAILED: ${f.label}`);
        process.exitCode = 1;
    }
})();
