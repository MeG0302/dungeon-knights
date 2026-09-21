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
 * Four claims, none of which a screenshot can make:
 *
 *   1. Every route has a wallet control in its own markup.
 *   2. Every route loads the module that turns that control into a menu.
 *   3. Each React route attaches it by hand — hydration beats the module's own DOM scan.
 *   4. The menu stays cheap: it reads nothing from the chain, and its Portfolio link resolves.
 */

import fs from 'fs';
import path from 'path';
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
}
routes.sort((a, b) => (a.route === '/' ? -1 : b.route === '/' ? 1 : a.route.localeCompare(b.route)));

rec('the route list is read out of the app, not typed in', routes.length >= 9,
    routes.map((r) => r.route).join(' '));

// --------------------------------------------------------------------------- the module
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

/** The `pageKey` a route renders, if it is a legacy page rather than a React component. */
function legacyKeyOf(pageFile) {
    const pageSrc = read(pageFile);
    const direct = pageSrc.match(PAGE_KEY);
    if (direct) return direct[1];
    // `page.js` is usually three lines that render a client; the key lives one hop away.
    const imported = (pageSrc.match(/from '\.\/([A-Za-z0-9._-]+)'/) || [])[1];
    if (!imported) return null;
    const sibling = path.join(path.dirname(pageFile), `${imported}.js`);
    if (!exists(sibling)) return null;
    const hop = read(sibling).match(PAGE_KEY);
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

for (const { route, page } of routes) {
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
