#!/usr/bin/env node
/**
 * Which classes does a route use that none of its sheets define?
 *
 *     node tools/check-styles.js            # the report, and a non-zero exit on anything unlisted
 *     node tools/check-styles.js --list      # the same report, exit 0 — for reading, not for CI
 *
 * This exists because of a specific failure, and the failure was invisible. `public/menu.js` writes
 * four classes into `#knightRoster` — `.empty-state`, `-icon`, `-title`, `-text` — and **no sheet in
 * the project defined any of them**. The block therefore fell back to browser defaults: the title
 * rendered in the browser's sans while every other label on that panel is Cinzel, and because
 * `#knightRoster` is a grid (`minmax(130px, 1fr)`), the sentence wrapped after three words. It was
 * reported as "this font doesn't match", which is a description of the symptom; the cause was that
 * there was no rule at all. Nothing in the project could catch it: no compiler sees a class name,
 * `next build` is happy, and every Node harness reads values rather than stylesheets.
 *
 * So this walks the same ground a browser does:
 *
 *   1. for each route, the **class tokens it can emit** — the served body, plus the scripts that
 *      page loads (they build markup at runtime, which is where the empty state came from), plus
 *      a React route's own client and the `lib/` modules it imports;
 *   2. the **selectors its sheets define** — the sheets `lib/static-pages.js` lists, the `<link>`s
 *      a React route renders, and `theme.css`, which every route loads;
 *   3. the difference. A token a route uses that none of its sheets defines is unstyled on that
 *      route, whatever any other page does with it.
 *
 * It is deliberately a *report* as well as a check. A class name can legitimately be nothing: a
 * token built by concatenation cannot be read from source, and some are hooks a script toggles
 * rather than styles. Those go in `tools/style-allowlist.json` with the reason, so the next person
 * sees a decision instead of a mystery — and so a *new* unstyled class fails the run by name.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportOnly = process.argv.includes('--list');

const read = (rel) => {
    try {
        return fs.readFileSync(path.join(ROOT, rel), 'utf8');
    } catch {
        return '';
    }
};

// `pathToFileURL`, not the bare path: on Windows an absolute path is a drive letter to the ESM
// loader, not a URL, and "d:" is not a supported scheme.
const { STATIC_PAGES } = await import(pathToFileURL(path.join(ROOT, 'lib', 'static-pages.js')).href);

/** Tokens that are not class names, or cannot be judged from source. */
const IGNORE = new Set([
    // React passes these through; they are strings, not classes on this page.
    'className', 'class',
]);

/** A class token: what a `class="…"` attribute can legally hold. */
const TOKEN_RE = /[A-Za-z][\w-]*/g;

/** Stands in for an interpolation while a value is being read. */
const HOLE = '\u0000';

/**
 * Every class token a piece of source can produce.
 *
 * Only *literal* attributes are read: `class="card is-open"`, `className={'btn btn-sm'}`,
 * `` className={`chip ${kind}`} `` contributes `chip` and nothing from the interpolation, because
 * the interpolated half is a runtime value and guessing it is how a report fills with fiction.
 */
/**
 * Replace every `${…}` with a marker, counting braces.
 *
 * Counting matters and a regex cannot do it: the real markup contains
 * `` `lb-row ${entry.isYou ? 'is-you' : ''} ${entry.rank <= 3 ? `top-${entry.rank}` : ''}` ``,
 * where the inner `${entry.rank}`'s closing brace is the *first* one a non-counting reader finds.
 * It then carries on inside the hole, and reports `entry` and `rank` — the names of variables — as
 * class names a page forgot to style. Every finding this file makes has to be about the page.
 */
function markHoles(value) {
    const text = String(value);
    let out = '';
    let index = 0;
    while (index < text.length) {
        if (text[index] === '$' && text[index + 1] === '{') {
            let depth = 1;
            index += 2;
            while (index < text.length && depth > 0) {
                if (text[index] === '{') depth += 1;
                else if (text[index] === '}') depth -= 1;
                index += 1;
            }
            out += HOLE;
        } else {
            out += text[index];
            index += 1;
        }
    }
    return out;
}

function tokensIn(source) {
    const found = new Set();
    const add = (value) => {
        // A class name glued to an interpolation is half a name, and reporting `rarity-` from
        // `"rarity-${tier}"` as unstyled would be a report about the tool rather than the page.
        // A word touching a hole on either side is dropped; the rest is kept.
        const pieces = markHoles(value).split(HOLE);
        pieces.forEach((piece, index) => {
            const words = piece.match(TOKEN_RE) || [];
            // "Touching" is the whole test, and it is whitespace that decides it. `rarity-${tier}`
            // glues the word to the hole, so the word is half a name. `notice ${kind} is-open` does
            // not — both are complete classes standing either side of a runtime value, and an
            // earlier version of this dropped both, which is a false *negative*: the sweep going
            // quiet about a real class that no sheet defines.
            if (index < pieces.length - 1 && words.length && !/\s$/.test(piece)) words.pop();
            if (index > 0 && words.length && !/^\s/.test(piece)) words.shift();
            for (const token of words) {
                if (!IGNORE.has(token)) found.add(token);
            }
        });
    };
    const patterns = [
        /\bclass\s*=\s*"([^"]*)"/g,
        /\bclass\s*=\s*'([^']*)'/g,
        /\bclassName\s*=\s*"([^"]*)"/g,
        /\bclassName\s*=\s*'([^']*)'/g,
        /\bclassName\s*=\s*\{\s*"([^"]*)"\s*\}/g,
        /\bclassName\s*=\s*\{\s*'([^']*)'\s*\}/g,
        /\bclassName\s*=\s*\{\s*`([^`$]*)`\s*\}/g,
        /\bclass\s*=\s*\{\s*`([^`$]*)`\s*\}/g,
    ];
    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) add(match[1]);
    }
    // Template-literal attributes, where the interpolation is the rule rather than the exception.
    for (const match of source.matchAll(/\bclass(?:Name)?\s*=\s*\{?\s*`([^`]*)`/g)) add(match[1]);
    return found;
}

/**
 * Every class a sheet mentions in a selector.
 *
 * Deliberately loose, and the loose part is the *compound* form: the project styles its state
 * classes that way — `.modal.hidden`, `.modal-backdrop.hidden`, `.loader.is-active` — so `hidden`
 * is a class this site styles even though `.hidden` appears nowhere on its own. A stricter reader
 * that only counted `\.hidden` would report every one of those as unstyled, and a reader that only
 * checked the compound form would miss the case this file exists for. `.5em` and friends cannot be
 * mistaken for a class because the first character after the dot has to be a letter.
 */
function selectorsIn(css) {
    const found = new Set();
    for (const match of css.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) found.add(match[1]);
    return found;
}

/** Strip a loader suffix so `theme.css?v=3` reads `theme.css`. */
const sheetPath = (href) => {
    const clean = String(href).split('?')[0].replace(/^\//, '');
    if (clean.startsWith('css/') || clean.includes('/')) return `public/${clean}`;
    // Legacy sheets live in two places; prefer the served one.
    return fs.existsSync(path.join(ROOT, 'public', clean)) ? `public/${clean}` : `public/css/${clean}`;
};

/** The `<link rel="stylesheet" href="…">` a React route renders, plus theme.css. */
function reactSheets(source) {
    const hrefs = [...source.matchAll(/<link[^>]*href="([^"]+\.css)(?:\?[^"]*)?"/g)].map((m) => m[1]);
    return [...new Set(['theme.css', ...hrefs])];
}

/** The `lib/` modules a route's client imports, one level deep. */
function importedLibs(source) {
    const libs = [];
    for (const match of source.matchAll(/from\s+'\.\.\/\.\.\/lib\/([\w-]+)'/g)) {
        libs.push(read(`lib/${match[1]}.js`));
    }
    return libs;
}

// ----------------------------------------------------------------------- collect
const routes = [];

for (const [key, page] of Object.entries(STATIC_PAGES)) {
    if (!page?.body) continue;
    const sources = [page.body];
    const sheets = [...(page.styles || []).map(sheetPath), ...(page.inlineStyles || [])];
    for (const script of page.scripts || []) {
        if (script.endsWith('.css')) continue;
        const code = read(sheetPath(script));
        sources.push(code);
        // A script can bring its own sheet, and `arya.js` does exactly that — it injects
        // `/css/arya.css` on load so her popup is styled on a page that never listed it. Reading
        // the injected href out of the script is not a guess about intent: it is what the route
        // loads, and without it every `arya-*` class reads as unstyled on five routes.
        for (const match of code.matchAll(/["'`](\/css\/[\w-]+\.css)(?:\?[^"'`]*)?["'`]/g)) {
            sheets.push(sheetPath(match[1]));
        }
    }
    if (key === 'landing') sheets.push('public/landing-mobile.css');
    if (key === 'menu') sheets.push('public/menu-mobile.css');
    if (key === 'mint') sheets.push('public/mint-mobile.css');
    routes.push({ name: `/${key === 'landing' ? '' : key}`, sources, sheets, key, page });
}

for (const dir of fs.readdirSync(path.join(ROOT, 'app'), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const clientRel = `app/${dir.name}/client.js`;
    const client = read(clientRel);
    if (!client) continue;
    routes.push({
        name: `/${dir.name}`,
        sources: [client, ...importedLibs(client)],
        sheets: reactSheets(client).map(sheetPath),
    });
}

// ------------------------------------------- a script's runtime dependency, which nothing implies
//
// The sweep below reads a route's scripts into `sources`, so it *does* see markup those scripts
// build — but only for scripts the route actually loads. That is the blind spot this section
// closes, and it hid a real bug: the landing page's markup holds the "Hall of Fame" card, and
// `landing.js` drives it by calling `window.leaderboardManager`, but the file that *builds* that
// modal is a third thing — `leaderboard.js`, which the landing page did not load. So the route had
// a card, no module, no `leaderboard-modal` class in anything readable, and the sweep reported
// "all styled". Pressing the card said "Leaderboard is loading..." permanently.
//
// Each entry is a claim with three falsifiable halves: a named script is on the route, that script
// reads a named global, and the route's own markup carries the element the global serves. When all
// three hold, the file that provides the global — and the sheet it needs — must be loaded too.
const RUNTIME_DEPS = [
    {
        route: '/',
        script: 'landing.js',
        global: 'leaderboardManager',
        markup: 'leaderboardLandingBtn',
        needs: ['leaderboard.js', 'leaderboard.css'],
    },
];

// ------------------------------------------------------------------------- report
const allowlist = JSON.parse(read('tools/style-allowlist.json') || '{}');
const globalAllow = allowlist['*'] || {};
const findings = [];
const depFindings = [];

console.log('');
for (const route of routes) {
    const used = new Set();
    for (const source of route.sources) for (const token of tokensIn(source)) used.add(token);

    const defined = new Set();
    for (const sheet of route.sheets) for (const token of selectorsIn(read(sheet))) defined.add(token);

    const missing = [...used].filter((token) => !defined.has(token)).sort();
    const unlisted = missing.filter((token) => !(token in globalAllow) && !(token in (allowlist[route.name] || {})));
    const listed = missing.filter((token) => !unlisted.includes(token));

    console.log(`${route.name}  —  ${used.size} class token(s), ${missing.length} with no rule in ${route.sheets.length} sheet(s)`);
    if (unlisted.length) {
        console.log(`  UNSTYLED  ${unlisted.join(', ')}`);
        findings.push({ route: route.name, tokens: unlisted });
    }
    // Allowed tokens print with the reason they are allowed. A bare name in a list is how a
    // suppression becomes permanent: nobody can tell a decision from an oversight.
    const reasons = { ...globalAllow, ...(allowlist[route.name] || {}) };
    for (const token of listed) console.log(`  allowed   ${token} — ${reasons[token]}`);
    if (!unlisted.length && !listed.length) console.log('  all styled');
}

console.log('');
for (const dep of RUNTIME_DEPS) {
    const route = routes.find((r) => r.name === dep.route);
    const scripts = ((route?.page?.scripts) || []).map((s) => String(s).split('?')[0]);
    const sheets = ((route?.page?.styles) || []).map((s) => String(s).split('?')[0]);
    const drives = read(`public/${dep.script}`).includes(`window.${dep.global}`);
    const card = String(route?.page?.body || '').includes(dep.markup);
    const onRoute = scripts.includes(dep.script);
    const missing = dep.needs.filter((n) => !scripts.includes(n) && !sheets.includes(n));

    if (!route || !onRoute || !drives || !card) {
        console.log(`  skip    ${dep.route} — ${dep.script} does not drive ${dep.markup}`);
        continue;
    }
    if (missing.length) {
        console.log(`  MISSING  ${dep.route} — ${dep.script} calls ${dep.global}, and its markup has ${dep.markup}`);
        console.log(`           but the route does not load: ${missing.join(', ')}`);
        depFindings.push({ route: dep.route, missing });
    } else {
        console.log(`  ok      ${dep.route} — ${dep.script} drives ${dep.markup}, and ${dep.needs.join(' + ')} are loaded`);
    }
}

console.log('');
if (allowlist['*']) {
    console.log(`Allow-listed everywhere: ${Object.keys(globalAllow).join(', ')}`);
    console.log('');
}

if (!findings.length && !depFindings.length) {
    console.log('Every class each route uses is defined by a sheet that route loads.');
    console.log('And every script a route runs finds the module it calls for.');
    console.log('');
    process.exit(0);
}

// A missing module is the louder failure — the control is dead on screen, not merely unstyled — so
// it is reported first and on its own line.
for (const dep of depFindings) {
    console.log(`${dep.route} runs a script whose dependency is not loaded: ${dep.missing.join(', ')}`);
}
if (depFindings.length) console.log('');

const total = findings.reduce((sum, f) => sum + f.tokens.length, 0);
console.log(`${total} class(es) with no rule behind them on the route that uses them:`);
for (const finding of findings) console.log(`  ${finding.route}: ${finding.tokens.join(', ')}`);
console.log('');
console.log('Fix the rule, or add the token to tools/style-allowlist.json with the reason it is');
console.log('deliberate — a class name nobody styles is a screen nobody has looked at.');
console.log('');
process.exit(reportOnly ? 0 : 1);
