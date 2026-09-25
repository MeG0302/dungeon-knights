#!/usr/bin/env node
/**
 * The ← in the header goes back to the page you were on.
 *
 *     node tools/check-back.js
 *
 * A back button is only worth having if both of these are true, and either one failing makes it worse
 * than not having one at all:
 *
 *   1. **It goes where it says.** The page you came from — not the copy of this page further up the
 *      list, not a page of somebody else's site (which is exactly where `history.back()` lands for
 *      anyone who arrived from a bookmark, a Discord link or a search result), and not the front door,
 *      which is the button standing next to it.
 *   2. **Every page has one**, in the same place, on the left of the way home. A control that appears
 *      on the vault and not on the portfolio is a control the reader has to learn twice.
 *
 * The rule is pure — `lib/back-trail.js` is an array in and an array out, with no browser in it — so
 * the first half walks it with real trails. The second half reads the pages, the one shared control
 * and the one shared sheet, because the failure it is guarding against (a header that quietly did not
 * get the arrow) is invisible to the rule.
 *
 * Every guard here was falsified by mutation before it was trusted; `.freebuff/run.md` lists the
 * mutations and what caught each one.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

/**
 * A file's **code**, with its comments removed.
 *
 * Every check below is a claim about what the component does, and this file's comments explain what
 * it deliberately does not do — and they name the very things being tested for (`sessionStorage`,
 * `history.back()`). The first run of this harness reported the effect check as passing while the
 * only `sessionStorage` above the effect was a sentence about it; stripping comments is what makes
 * the check about the code. Block comments and whole-line `//` comments go, nothing else is touched.
 */
function code(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');
}

/** Every page that wears the house header, which is where the arrow has to be. */
const PAGE_FILES = ['genesis', 'pitch', 'points', 'portfolio', 'staking', 'tokenomics'];
const pages = PAGE_FILES.map((name) => ({ name, src: read(`app/${name}/client.js`) }));
const legacy = read('lib/static-pages.js');
const component = code(read('app/back-link.js'));
const theme = read('public/theme.css');

console.log('the rule, walked:');

(async () => {
    const Back = await import('../lib/back-trail.js');

    // ---------------------------------------------------------------- the rule, walked
    const one = Back.rememberPage(['/points'], '/portfolio');
    rec('the page you are on joins the trail', one.length === 2 && one[0] === '/points' && one[1] === '/portfolio',
        one.join(' → '));

    const two = Back.rememberPage(one, '/portfolio');
    rec('  and loading it again is not a second visit, so the arrow cannot point at itself',
        two.length === 2 && Back.previousPage(two, '/portfolio') === '/points', two.join(' → '));

    const three = Back.rememberPage(two, '/points');
    rec('  and returning to a page you have already seen is still a visit',
        three.length === 3 && Back.previousPage(three, '/points') === '/portfolio', three.join(' → '));

    rec('and with nothing behind you there is no arrow, rather than one that goes nowhere',
        Back.previousPage(['/points'], '/points') === null && Back.previousPage([], '/points') === null
        && Back.previousPage(null, '/points') === null && Back.previousPage(undefined, undefined) === null
        && Back.previousPage(['/points', '/points'], '/points') === null,
        'a copy of this page is not a previous page');

    const deep = Array.from({ length: 30 }, (_, i) => `/p${i}`)
        .reduce((trail, page) => Back.rememberPage(trail, page, 24), []);
    rec('  and the trail is capped from the tail, because the recent pages are the useful ones',
        deep.length === 24 && deep[0] === '/p6' && deep[23] === '/p29',
        `${deep.length} kept, oldest ${deep[0]}, newest ${deep[23]}`);

    rec('and junk left in storage is dropped rather than becoming a destination',
        JSON.stringify(Back.rememberPage(['/a', 5, null, 'https://x/y', '/b'], '/c')) === JSON.stringify(['/a', '/b', '/c']),
        'only paths that start at the root survive');

    rec('and only a referrer from our own origin is trusted',
        Back.sameOriginPath('https://dungeonknights.io/points?ref=ABC', 'https://dungeonknights.io') === '/points?ref=ABC'
        && Back.sameOriginPath('https://evil.example/points', 'https://dungeonknights.io') === null
        && Back.sameOriginPath('http://localhost:3000/portfolio', 'http://localhost:3000') === '/portfolio'
        && Back.sameOriginPath('', 'https://dungeonknights.io') === null
        && Back.sameOriginPath('not a url', 'https://dungeonknights.io') === null
        && Back.sameOriginPath('https://dungeonknights.io/points', '') === null,
        'the query is kept, another site is not, a mangled string is not');

    rec('  and the arrow names where it goes, in the site\'s own words',
        Back.backLabel('/points?ref=X#tab') === 'Points Program' && Back.backLabel('/hub') === 'Kingdom Gate'
        && Back.backLabel('/portfolio/') === 'My Portfolio' && Back.backLabel('/staking') === 'Staking Vault'
        && Back.backLabel('/new-page') === '/new-page' && Back.backLabel(null) === 'the last page',
        'a title for every page we know, the path itself for the rest');

    // ---------------------------------------------------------------- the control, and where it sits
    const HEADER = /<header className="header">/g;
    const ORDER = /<header className="header">\s*<div className="header-left">\s*<BackLink \/>\s*<(?:button|a)\b/g;
    const perPage = pages.map(({ name, src }) => ({
        name,
        headers: (src.match(HEADER) || []).length,
        ordered: (src.match(ORDER) || []).length,
        imported: /import BackLink from '\.\.\/back-link';/.test(src),
    }));

    rec('every page header renders the arrow, and it is the first control in the bar',
        perPage.every((p) => p.headers > 0 && p.ordered === p.headers),
        perPage.map((p) => `${p.name} ${p.ordered}/${p.headers}`).join(' · '));

    rec('  and it comes before the way home rather than after it, inside one left-hand group',
        perPage.every((p) => p.ordered === p.headers && /<div className="header-left">/.test(pages.find((x) => x.name === p.name).src)),
        'header-left wraps the arrow and the Kingdom Gate button');

    rec('and there is one control, not a copy of it pasted into six pages',
        perPage.every((p) => p.imported) && /export default function BackLink/.test(component),
        'every header imports ../back-link');

    rec('  and it navigates to the trail rather than handing the decision to the browser',
        /router\.push\(back\)/.test(component) && !/history\.back\(/.test(component) && !/router\.back\(/.test(component),
        'router.push, because history.back() leaves the app from a deep link');

    rec('  and it reads this tab\'s trail in an effect, never during render',
        /useEffect\(/.test(component) && /useState\(null\)/.test(component)
        && component.indexOf('sessionStorage') > component.indexOf('useEffect('),
        'the server has no tab, so the first paint must not read one');

    rec('  and a browser that refuses storage gets no arrow instead of a crash',
        (component.match(/catch \{/g) || []).length >= 2 && /if \(!back\) return null;/.test(component),
        'both storage calls are guarded, and no destination means no button');

    rec('  and it is a labelled control, not a bare glyph',
        /aria-label=\{`Back to \$\{label\}`\}/.test(component) && /title=\{`Back to \$\{label\}`\}/.test(component)
        && /className="btn btn-ghost btn-sm back-link"/.test(component) && /data-arya="back"/.test(component),
        'aria-label, title, the house ghost button, and a handle for the preview');

    // ---------------------------------------------------------------- it has to be visible, too
    rec('and the arrow and its group are styled in the shared sheet',
        /\.header-left\s*\{/.test(theme) && /\.header \.back-link\s*\{/.test(theme),
        '.header-left and .header .back-link');

    // A rule only exists once the browser fetches the sheet that carries it. `.header-left` and
    // `.header .back-link` went into the sheet at v8, so a page still asking for v7 gets an arrow
    // with no style at all — an unstyled button in the bar, which reads as a bug rather than as a
    // control. (The first version of this check read the *legacy* pages by mistake, and a page left
    // on v7 sailed straight through it. The mutation table in `.freebuff/run.md` records that.)
    const linking = [...pages, { name: 'legacy', src: legacy }].filter(({ src }) => /theme\.css\?v=/.test(src));
    const versions = linking.flatMap(({ src }) => [...src.matchAll(/theme\.css\?v=(\d+)/g)].map((m) => m[1]));
    rec('  and the sheet that carries the rule is the one every page asks for',
        linking.length === pages.length + 1 && versions.length >= linking.length
        && versions.every((v) => v === versions[0] && Number(v) >= 8),
        `${linking.length} pages, ${versions.length} links, v${versions[0]} and nothing older`);

    rec('  and a phone keeps the arrow a glyph a thumb can find',
        /@media \(max-width: 520px\)[\s\S]*?\.header \.back-link\s*\{/.test(theme)
        && /\.header \.back-link\s*\{/.test(theme.slice(theme.indexOf('@media (max-width: 520px)'))),
        'the phone block sets its own padding and size');

    void PAGE_FILES;

    console.log('');
    const failed = results.filter((r) => !r.pass);
    console.log(`${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length) {
        console.log('');
        for (const f of failed) console.log(`  FAILED: ${f.label}`);
        process.exitCode = 1;
    }
})();
