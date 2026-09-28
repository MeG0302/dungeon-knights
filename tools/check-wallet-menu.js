#!/usr/bin/env node
/**
 * The wallet menu is on **every** route, because My Portfolio is only reachable through it.
 *
 *     node tools/check-wallet-menu.js
 *
 * The menu is one module attached to each page's own header control, so "the menu is on every
 * page" is a claim about nine separate files — and the way it breaks is by omission: a route is
 * added, it renders its own header, and nothing connects the two. That is what happened here.
 * `/dungeons` shipped an empty `header-actions`, and `/tokenomics` put a token-supply readout in
 * the pill's class, so the module had nothing to attach to and My Portfolio was unreachable from
 * both while every other check stayed green.
 *
 * The route list is therefore not typed in — it is read out of `app/`, which is what decides what
 * a route *is*. A new page fails this until it carries the control, which is the point.
 *
 * Six claims, none of which a screenshot can make:
 *
 *   1. Every route has a wallet control in its own markup.
 *   2. Every route loads the module that turns that control into a menu.
 *   3. Each React route attaches it by hand — hydration beats the module's own DOM scan.
 *   4. The menu stays cheap: it reads nothing from the chain, and its Portfolio link resolves.
 *   5. That control is the *only* one in the header — the pill and its menu, which is the Points
 *      page's chrome, rather than a second injected button beside it in a colour of its own.
 *   6. And the Portfolio hangs off that row as a *visible* link, not only as a row inside a menu
 *      somebody has to know to hover — which is why the module inserts it, on every route.
 *
 * Two routes are exempt, in `tools/wallet-menu-allowlist.json`, and the exemption is printed with its
 * reason rather than applied silently: the public coming-soon page at the apex, which deliberately has
 * no wallet connection because it is for somebody who has never seen the game, and the password screen,
 * which loads nothing the game loads. Everything else still fails until it carries the control — which
 * is the point of reading the route list out of `app/` instead of typing it in.
 */

import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

const menu = read('public/wallet-menu.js');
const { STATIC_PAGES } = await import(pathToFileURL(path.join(ROOT, 'lib', 'static-pages.js')).href);

/**
 * Every route the app serves, from the filesystem: `app/page.js` is `/`, `app/<dir>/page.js` is
 * `/<dir>`. `app/api/**` is not a page — it has no `page.js` — so it drops out by construction.
 */
const routes = [];
if (exists('app/page.js')) routes.push({ route: '/', page: 'app/page.js' });
for (const entry of fs.readdirSync(path.join(ROOT, 'app'), { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'api') continue;
    const page = `app/${entry.name}/page.js`;
    if (exists(page)) routes.push({ route: `/${entry.name}`, page });
    // One level down as well, because a route can be a page *under* another one — `/collab/review`
    // is the owner's half of `/collab`. The claim this file makes is "every route", and a route the
    // list does not contain is a route the claim quietly stopped being about.
    for (const sub of fs.readdirSync(path.join(ROOT, 'app', entry.name), { withFileTypes: true })) {
        if (!sub.isDirectory()) continue;
        const nested = `app/${entry.name}/${sub.name}/page.js`;
        if (exists(nested)) routes.push({ route: `/${entry.name}/${sub.name}`, page: nested });
    }
}
routes.sort((a, b) => (a.route === '/' ? -1 : b.route === '/' ? 1 : a.route.localeCompare(b.route)));

rec('the route list is read out of the app, not typed in', routes.length >= 9,
    routes.map((r) => r.route).join(' '));

// --------------------------------------------------------------------------- the module
// Every rec below reads this file as text, and text cannot fail: the module can be sliced into
// something that throws on load — a line lifted out of its function, a stray brace — and a reader
// that greps for patterns happily reports 18/18 while the browser gets a `ReferenceError` and the
// page has no wallet control at all. That is not hypothetical: a throwaway mutator's revert moved
// one line to the top of the file and this file passed while `public/wallet-menu.js` was dead on
// every route. So it is compiled, not only read. `vm.Script` parses without running anything, which
// is exactly the claim — running the module is the browser's half, in `tools/check-all.js`.
let moduleParses = null;
try {
    new vm.Script(menu, { filename: 'public/wallet-menu.js' });
} catch (error) {
    moduleParses = error.message;
}
rec('and it is still a program a browser can parse, not just text that matches the recs below',
    moduleParses === null,
    moduleParses || `${menu.split('\n').length} lines compile`);

rec('the module knows the pill wherever it is spelled', /'\.wallet-pill'/.test(menu));
rec('and the legacy pill ids beside it',
    ['#walletWidget', '#walletWidgetMenu', '#walletWidgetGame'].every((id) => menu.includes(id)));
rec('one Portfolio link, and it points at a route that exists',
    /PORTFOLIO_HREF = '\/portfolio'/.test(menu) && exists('app/portfolio/page.js'));
rec('the menu reads nothing from the chain, so opening it never costs a round trip',
    !/balanceOf|formatEther|ethers/.test(menu),
    'the reading is /portfolio\'s job');
rec('Escape and an outside click both close it',
    /event\.key === 'Escape'/.test(menu) && /closest\('\.wallet-menu-host'\)/.test(menu));

// ------------------------------------------------------------------------ every route
const PAGE_KEY = /pageKey="([a-z0-9-]+)"/;

/** Routes that are deliberately not the game, each with the reason it is listed. */
const EXEMPT = JSON.parse(read('tools/wallet-menu-allowlist.json'));

/** The `pageKey` a route renders, if it is a legacy page rather than a React component. */
function legacyKeyOf(pageFile) {
    const pageSrc = read(pageFile);
    const direct = pageSrc.match(PAGE_KEY);
    if (direct) return direct[1];
    // `page.js` is usually three lines that render a client; the key lives one hop away.
    //
    // The hop may be a sibling (`./home-client`) **or a parent** (`../landing-client`, which is how
    // `/hub` renders the landing page). Reading only the sibling form made the hub look like a route
    // with no wallet control, no module and no hand-attach — three failures for a page that has all
    // three. Resolved through `path`, so neither spelling is a special case.
    const imported = (pageSrc.match(/from '(\.[^']+)'/) || [])[1];
    if (!imported) return null;
    const target = path.resolve(path.dirname(path.join(ROOT, pageFile)), `${imported}.js`);
    if (!fs.existsSync(target)) return null;
    const hop = fs.readFileSync(target, 'utf8').match(PAGE_KEY);
    return hop ? hop[1] : null;
}

/** The files whose text is the route's markup, and where that markup comes from. */
function sourcesFor(pageFile, key) {
    if (key) {
        const entry = STATIC_PAGES[key];
        return entry
            ? { markup: entry.body || '', scripts: entry.scripts || [], where: `static-pages "${key}"` }
            : null;
    }
    const dir = path.dirname(pageFile);
    const files = fs.readdirSync(path.join(ROOT, dir))
        .filter((f) => f.endsWith('.js'))
        .map((f) => `${dir}/${f}`);
    return { markup: files.map(read).join('\n'), files, where: files.join(', ') };
}

const missingControl = [];
const missingModule = [];
const manual = [];

const exempted = [];

for (const { route, page } of routes) {
    if (EXEMPT[route]) {
        exempted.push(`${route} — ${EXEMPT[route]}`);
        continue;
    }

    const key = legacyKeyOf(page);
    const found = sourcesFor(page, key);
    if (!found) {
        missingControl.push(`${route} — no STATIC_PAGES entry "${key}"`);
        missingModule.push(route);
        continue;
    }

    const { markup, scripts, files, where } = found;
    const loadsModule = scripts
        ? scripts.some((s) => s.startsWith('wallet-menu.js'))
        : markup.includes('/wallet-menu.js');
    // The pill and the legacy ids, and *not* `.wallet-chip`: the module deliberately leaves the
    // chip out of its triggers, because on three routes the chip is already a disconnect button
    // and a second meaning for that click is worse than one affordance fewer. A guard that
    // accepted the chip passed a route whose pill had just been renamed away — which is how the
    // first draft of this file missed the very regression it was written for.
    const hasControl = /class(Name)?="[^"]*wallet-pill\b/.test(markup)
        || ['walletWidget', 'walletWidgetMenu', 'walletWidgetGame'].some((id) => markup.includes(`id="${id}"`));

    if (!hasControl) missingControl.push(`${route} (${where})`);
    if (!loadsModule) missingModule.push(`${route} (${where})`);

    // A React route renders after hydration, so the module's own `scan()` runs against markup
    // that does not exist yet; each one has to call `attach` itself.
    if (files && !/WalletMenu\.attach/.test(markup)) manual.push(route);
}

rec('every route carries a wallet control for the menu to attach to',
    missingControl.length === 0,
    missingControl.length ? missingControl.join('; ') : `${routes.length} routes`);
rec('every route loads the module that turns that control into a menu',
    missingModule.length === 0,
    missingModule.length ? missingModule.join('; ') : `${routes.length} routes`);
rec('each React route attaches the menu by hand, because hydration beats a DOM scan',
    manual.length === 0,
    manual.length ? manual.join(' ') : 'attach(el, { onDisconnect }) in all of them');

// ---------------------------------------------------------------- one control, not two
//
// The pill is the whole control, and that is the Points page's chrome exactly: a bronze pill with
// a caret, and the menu behind it. The app host used to carry a second one — `shared-header.js`
// injected a purple `🔌 Connect Wallet` button in Arial into the header of `/menu`, `/mint` and
// `/game`, beside a pill that already opened the menu. One job done twice, and the loud half
// painted in a colour no other screen on the site uses. The injector is gone, and three separate
// halves of that are checked, because each one alone can come back: no route asks for the module,
// the module is not in `public/`, and no sheet still paints its button.
const appClients = fs.readdirSync(path.join(ROOT, 'app'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `app/${entry.name}/client.js`)
    .filter(exists)
    .map(read);

const wantsSecondBar = [
    ...Object.entries(STATIC_PAGES).flatMap(([key, entry]) =>
        (entry.scripts || []).filter((s) => s.startsWith('shared-header')).map((s) => `${key} loads ${s}`)),
    ...appClients.filter((src) => /shared-header/.test(src)).map(() => 'an app client names it'),
];

rec('no route loads a second wallet bar beside the pill',
    wantsSecondBar.length === 0,
    wantsSecondBar.length ? wantsSecondBar.join('; ') : 'the pill and its menu are the whole control');
rec('and the file that injected it is not in the served tree, so a route this check cannot see cannot bring it back',
    !exists('public/shared-header.js'),
    exists('public/shared-header.js') ? 'public/shared-header.js is back' : 'public/ has no shared-header.js');
rec('no sheet still paints its off-palette button',
    !/shared-wallet-(?:btn|header)/.test(read('public/shared-wallet.css')),
    'the pill keeps its rules in that sheet; the purple button\'s are gone');

// ------------------------------------------------------- and the menu is not the only way in
//
// The menu answers "where is the Portfolio", and a menu is a thing you have to find: it needs a
// hover on a laptop, a tap on a phone, and either way the player has to suspect it is there. So the
// module inserts a *link* into the same header row — which is the whole reason "on every page" is a
// claim about one module rather than fifteen headers. Three halves again: the link exists and points
// at the route, it is in the row rather than inside the panel (a link inside the menu is the thing
// this exists to stop being the only door), and it wears the chrome the header already uses.
rec('the Portfolio is a link in the header row, not only a row inside the menu',
    /function ensurePortfolioLink/.test(menu)
    && /link\.href = PORTFOLIO_HREF/.test(menu)
    && /link\.textContent = PORTFOLIO_LABEL/.test(menu)
    && /row\.insertBefore\(link, row\.firstChild\)/.test(menu),
    'inserted into the trigger\'s own parent, so it is one click and not two');
rec('and it wears the chrome the header already has rather than inventing another',
    /'btn btn-ghost btn-sm wallet-portfolio-link'/.test(menu)
    && Object.values(STATIC_PAGES).some((entry) => /class="btn btn-ghost btn-sm"/.test(entry.body || '')),
    'the same three classes the Kingdom Gate back-link wears');
// The mark is read as *code*, not as the word: the first draft of this rec matched `/aria-current/`
// anywhere in the file and passed on the function's own doc comment after the line itself was
// deleted. A guard that reads prose fails on its own explanation, which is a finding about the
// guard rather than about the page.
rec('and the link marks the page it points at, so it is not a dead one on its own page',
    /link\.setAttribute\('aria-current', 'page'\)/.test(menu) && exists('app/portfolio/page.js'));

// Printed, not silent. An exemption nobody can read is indistinguishable from a check that stopped
// looking at a route.
if (exempted.length) {
    console.log('');
    console.log(`  Deliberately without the menu (${exempted.length}, from tools/wallet-menu-allowlist.json):`);
    for (const line of exempted) console.log(`    ${line}`);
}
rec('only routes with a written reason are skipped',
    exempted.length === 0 || Object.keys(EXEMPT).every((k) => k === '_' || routes.some((r) => r.route === k)),
    Object.keys(EXEMPT).filter((k) => k !== '_').join(' '));
rec('and an exemption without a reason would be an oversight, so there must be one',
    Object.keys(EXEMPT).every((k) => k === '_' || (typeof EXEMPT[k] === 'string' && EXEMPT[k].length > 60)));

// The six legacy routes are served by the module's own scan, so that half has to still exist.
rec('a legacy page is still served by the module\'s own scan',
    /document\.readyState === 'loading'/.test(menu) && /function start\(\)/.test(menu));

console.log('');
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
    console.log('');
    for (const f of failed) console.log(`  FAILED: ${f.label}`);
    process.exitCode = 1;
}
