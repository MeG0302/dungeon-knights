#!/usr/bin/env node
/**
 * Is one source of truth still one source of truth?
 *
 *     node tools/check-copies.js
 *
 * This project accumulated copies of the engine next to the real ones: `dungeon.js`,
 * `menu.js`, `leaderboard.js` and others sat at the repository root while the browser
 * fetched `public/<same name>`. Only `public/` is served, so the root copies were dead —
 * but they were *there*, with the same names, drifting (81 lines in `dungeon.js`, 688 in
 * `leaderboard.js`), and one of them cost real time: `dungeon.js` was loaded with a `?v=`
 * cache-bust that had never been bumped, so a fix would never have reached a returning
 * player no matter how many times it was deployed.
 *
 * Two checks, both of which have failed in this repository's real history:
 *
 *   - no root-level script may share its name with a served one
 *   - every script a page loads must exist at the path it is loaded from
 *
 * and one report, because it is a judgement rather than a rule: served scripts loaded
 * without a version, which the browser is entitled to keep serving from cache after they
 * change.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

(async () => {
    // -------------------------------------------- root copies of served files
    const served = new Set(fs.readdirSync(PUBLIC));
    const rootScripts = fs.readdirSync(ROOT).filter((f) => f.endsWith('.js'));
    const duplicates = rootScripts.filter((f) => served.has(f));

    // -------------------------------------------- scripts the pages actually load
    const { STATIC_PAGES } = await import('../lib/static-pages.js');
    const referenced = new Set();
    for (const page of Object.values(STATIC_PAGES)) {
        for (const src of page.scripts || []) referenced.add(src);
    }
    // The Points page is a React route and appends its own scripts, so it is not in the
    // static page list above.
    const pointsClient = fs.readFileSync(path.join(ROOT, 'app', 'points', 'client.js'), 'utf8');
    for (const match of pointsClient.matchAll(/<Script\s+src="([^"]+)"/g)) referenced.add(match[1]);

    const missing = [...referenced].filter((src) => {
        const clean = src.split('?')[0].replace(/^\//, '');
        return !fs.existsSync(path.join(PUBLIC, clean));
    });

    console.log('');
    console.log('One source of truth');
    rec('no root-level script duplicates a served one', duplicates.length === 0,
        duplicates.length
            ? `dead copies to delete: ${duplicates.join(', ')}`
            : `${rootScripts.length} root scripts, none of them served`);
    rec('every script a page loads exists', missing.length === 0,
        missing.length ? `missing: ${missing.join(', ')}` : `${referenced.size} scripts resolved`);

    // ------------------------------------------------- the cache-bust report
    const VENDORED = /ethers-|polyfill/;
    const unversioned = [...referenced]
        .filter((src) => !src.includes('?') && !VENDORED.test(src))
        .sort();

    console.log('');
    console.log(`  ${unversioned.length} served script(s) load without a ?v= — fine until one is edited,`);
    console.log('  at which point a returning player keeps the old copy until its URL changes:');
    for (const src of unversioned) console.log(`    ${src}`);

    console.log('');
    const failed = results.filter((r) => !r.pass);
    console.log(`${results.length - failed.length}/${results.length} checks passed`);
    for (const f of failed) console.log(`  FAILED: ${f.label}`);
    console.log('');
    process.exit(failed.length ? 1 : 0);
})().catch((error) => {
    console.error('Harness failed:', error);
    process.exit(1);
});
