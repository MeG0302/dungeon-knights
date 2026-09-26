#!/usr/bin/env node
/**
 * The board's backdrop — the map clip playing behind the Points Program's rankings pane.
 *
 *     node tools/check-board-map.js
 *
 * A background is the easiest kind of thing to ship broken, because every way it can go wrong still
 * renders: a clip that never autoplays is a black rectangle, one placed in the wrong layer paints
 * *over* the table, and one with no scrim leaves ten rows of figures unreadable on a candle-lit
 * table. None of those throws, and none shows up in a diff review. So the parts that can be wrong
 * are asserted here instead:
 *
 *   - **Where it lives.** One layer, inside the board `<main>`, and nowhere else — not the page, not
 *     the left pane, not the vault mini-game (which has a map clip of its own, and they are two
 *     different files for a reason).
 *   - **That it plays.** `muted` + `autoPlay` + `playsInline` in the same tag, and `loop`: a browser
 *     blocks an unprompted clip with sound, and a blocked clip is a hole in the panel.
 *   - **That it stays behind the content.** The layer is a positioned sibling, so it sits *above*
 *     the pane's in-flow children in the paint order unless they are raised — the single most likely
 *     way to ship this and see nothing but the video.
 *   - **That the rows stay readable.** The scrim is parsed as numbers, not as text: its two stops
 *     have to actually be dark enough, top and bottom.
 *   - **That the fallbacks are real.** Reduced motion hides the clip, every phone skips it, and in
 *     both cases the scrim and the flat panel are what is left.
 *   - **That the file is the one that was handed over**, and not a master: a size budget, and the
 *     vault's own `background.mp4` untouched beside it.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}
function section(title) {
    console.log('');
    console.log(title);
}

const CLIENT = read(path.join('app', 'points', 'client.js'));
const DUNGEON = read(path.join('app', 'points', 'dungeon.js'));
const CSS = read(path.join('public', 'css', 'points.css'));

// ---------------------------------------------------------------------- css reading
//
// Every rule is read as a selector list plus a body, and every declaration is anchored to the start
// of its own line. Both of those are lessons rather than taste: a looser reader has already certified
// the exact bug it was written to catch once ( `max-width: 94%` *contains* `width: 94%` ), and a
// selector list has to be compared item by item, because `.board-map` is a prefix of
// `.board-map-video` and `.board-map-scrim`.
//
// Comments are removed before anything is read. They are prose, and this file's prose contains
// commas — which, split on, glue a whole paragraph to the selector that follows it. That is not a
// hypothetical: the first version of this reader reported `.points-page .board-map-panel` as having
// no `position` at all, because the item it compared was "*\u2026 so a negative layer would be painted
// behind the panel's own opaque background\n */\n.points-page .board-map-panel".
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, ' ');
const RULE_RE = /([^{}]+)\{([^{}]*)\}/g;
function rulesFor(source, selector) {
    const out = [];
    for (const m of stripComments(source).matchAll(RULE_RE)) {
        const selectors = m[1].split(',').map((s) => s.trim());
        if (selectors.includes(selector)) out.push(m[2]);
    }
    return out;
}
function ruleFor(css, selector) {
    return rulesFor(css, selector)[0] ?? null;
}
/** The declaration lines of a body that set `prop`, trimmed. Anchored at the line start. */
function decls(body, prop) {
    if (!body) return [];
    return body.split('\n').map((l) => l.trim())
        .filter((l) => new RegExp(`^${prop}\\s*:`).test(l));
}
function decl(body, prop) {
    const line = decls(body, prop)[0] ?? null;
    return line === null ? null : line.slice(line.indexOf(':') + 1).trim().replace(/;$/, '');
}
/** The bodies of every `@media (…)` block whose condition matches. */
function mediaBlocks(source, condition) {
    const css = stripComments(source);
    const out = [];
    const re = /@media\s*\(([^)]*)\)\s*\{/g;
    for (const m of css.matchAll(re)) {
        if (!new RegExp(condition).test(m[1])) continue;
        // Brace-counted to the end of the block, so a nested rule cannot end it early.
        let depth = 1;
        let i = m.index + m[0].length;
        while (i < css.length && depth > 0) {
            if (css[i] === '{') depth++;
            else if (css[i] === '}') depth--;
            i++;
        }
        out.push(css.slice(m.index + m[0].length, i - 1));
    }
    return out;
}

console.log('');
console.log('The board\u2019s backdrop \u2014 the rankings pane');

// ------------------------------------------------------------------------ where it lives
section('Where it lives');

// `-1` has to be tested for before it is used as an index. It was not, and the sweep found it: with
// `data-arya="board"` renamed, `slice(-1, paneEnd)` reads the *last character* of the file and
// returns "" rather than a pane — so every check scoped to the pane quietly passed on nothing.
// `lastIndexOf`, because `data-arya="board"` is also the Arya walkthrough's target selector and
// that one is written a thousand lines earlier, in the tour's step list. Anchored on the first
// occurrence, the "pane" this file measures starts inside the tour and ends at the page's own
// `</main>` — a slice that contains the layer and proves nothing about where it is.
const boardAt = CLIENT.lastIndexOf('data-arya="board"');
// The pane, from its opening tag to the `</main>` that closes it. Nested `<main>`s do not exist on
// this page, so the first closing tag after the marker is the pane's.
const paneEnd = boardAt === -1 ? -1 : CLIENT.indexOf('</main>', boardAt);
const pane = boardAt === -1 || paneEnd === -1 ? null : CLIENT.slice(boardAt, paneEnd);

rec('the board pane is still findable, and the slice below is a real one',
    pane !== null && pane.length > 0,
    pane === null ? 'no `data-arya="board"` / `</main>` pair' : `${pane.length} characters of pane`);

rec('and the pane wears the class the stylesheet hangs the backdrop on',
    /className={`side-panel board-map-panel/.test(CLIENT),
    'the sheet is dead weight without it — `.board-map-panel` would match nothing');

const layers = (CLIENT.match(/className="board-map"/g) || []).length;
rec('there is exactly one backdrop layer on the route', layers === 1, `${layers} layers`);

rec('and it is inside the board pane, not on the page',
    pane !== null && pane.includes('className="board-map"'),
    'the left pane and the header are out of scope by construction');

rec('the left pane does not carry one of its own',
    (CLIENT.slice(0, boardAt).match(/className="board-map/g) || []).length === 0,
    'the task cards sit on a flat panel');

rec('the vault mini-game is untouched, and keeps its own map',
    !/board-map/.test(DUNGEON) && /background\.mp4/.test(DUNGEON),
    'app/points/dungeon.js still plays `background.mp4`');

rec('the two clips are two different files, and the pane names the second one',
    exists('public/assets/points/background.mp4') && exists('public/assets/points/board-map.mp4')
    && fs.readFileSync(path.join(ROOT, 'public/assets/points/background.mp4')).length
    !== fs.readFileSync(path.join(ROOT, 'public/assets/points/board-map.mp4')).length
    && !/background\.mp4/.test(CLIENT.match(/const BOARD_MAP = `([^`]*)`/)?.[1] ?? 'background.mp4'),
    'the panel\u2019s art cannot have overwritten the mini-game\u2019s');

// --------------------------------------------------------------------------- the file
section('The file');

const src = (CLIENT.match(/const BOARD_MAP = `\$\{ASSETS\}([^`]+)`/) || [])[1] ?? null;
rec('the clip is named once, in a const the markup reads',
    src !== null && new RegExp(`src=\\{BOARD_MAP\\}`).test(CLIENT),
    src === null ? 'no `const BOARD_MAP`' : `BOARD_MAP = ${src}`);

rec('it is an mp4 under the points assets, and the file is on disk',
    src !== null && /^[\w.-]+\.mp4$/.test(src) && exists(path.join('public/assets/points', src || '')),
    src === null ? 'no source' : `public/assets/points/${src}`);

{
    const bytes = src && exists(path.join('public/assets/points', src))
        ? fs.statSync(path.join(ROOT, 'public/assets/points', src)).size : 0;
    // 3.5MB is the clip that was handed over. The budget is headroom above it, not a target: it is
    // here to catch a master — the 4K original was a different file entirely.
    rec('it is the delivered clip, not a master',
        bytes > 0 && bytes <= 6 * 1024 * 1024,
        `${(bytes / 1024 / 1024).toFixed(2)}MB (budget 6MB)`);
}

// ------------------------------------------------------------------------- it plays
section('It plays');

// Anchored on the element's own class rather than on the first `<video` in the file. It was the
// first version, and a new comment explaining that a hidden video still plays put the words
// "<video autoPlay>" into the source — after which the guard read the *comment* as the tag and
// reported `muted`, `loop` and `playsInline` missing from a tag that has all three.
const videoTag = (CLIENT.match(/<video\s+className="board-map-video"[\s\S]*?\/>/) || [])[0] ?? '';
for (const attr of ['muted', 'autoPlay', 'loop', 'playsInline']) {
    rec(`the tag carries \`${attr}\``, new RegExp(`\\b${attr}\\b`).test(videoTag),
        'without muted+playsInline a browser refuses to start it at all');
}

rec('the layer is decoration, and says so to a screen reader',
    /<div className="board-map" aria-hidden="true">/.test(CLIENT),
    'aria-hidden on the wrapper that holds the clip and the scrim');

rec('and it is inert, so it can never eat a click meant for a row',
    decl(ruleFor(CSS, '.points-page .board-map'), 'pointer-events') === 'none',
    decl(ruleFor(CSS, '.points-page .board-map'), 'pointer-events'));

rec('the clip fills the layer, cropped rather than letterboxed',
    decl(ruleFor(CSS, '.points-page .board-map-video'), 'object-fit') === 'cover'
    && decl(ruleFor(CSS, '.points-page .board-map-video'), 'width') === '100%'
    && decl(ruleFor(CSS, '.points-page .board-map-video'), 'height') === '100%',
    'the pane is tall and narrow; black bars behind a leaderboard read as a bug');

// ---------------------------------------------------------- it stays behind the content
section('It stays behind the content');

rec('the pane is a containing block, so `inset: 0` is the pane and not the window',
    decl(ruleFor(CSS, '.points-page .board-map-panel'), 'position') === 'relative',
    decl(ruleFor(CSS, '.points-page .board-map-panel'), 'position'));

rec('the layer is anchored to it, and clipped by it',
    decl(ruleFor(CSS, '.points-page .board-map'), 'inset') === '0'
    && decl(ruleFor(CSS, '.points-page .board-map'), 'overflow') === 'hidden',
    'an unclipped layer would paint the clip over the footer');

rec('the layer paints over the pane\u2019s in-flow children, so they are raised past it',
    decl(ruleFor(CSS, '.points-page .board-map-panel > .side-panel-header'), 'z-index') === '1'
    && decl(ruleFor(CSS, '.points-page .board-map-panel > .side-panel-body'), 'z-index') === '1'
    && decl(ruleFor(CSS, '.points-page .board-map-panel > .side-panel-body'), 'position') === 'relative',
    'both, because a video is a positioned sibling \u2014 paint order alone would bury the table');

rec('and the layer itself is at the bottom of that order',
    decl(ruleFor(CSS, '.points-page .board-map'), 'z-index') === '0',
    'not -1: the pane creates no stacking context, so a negative layer would hide behind its background');

// Read as a property of that rule, not as a substring of the sheet: `/background: var(--bg-dark)/`
// anywhere in theme.css satisfied the first version of this, which is exactly the looser matching
// that has certified a real bug here before.
const themeHeader = ruleFor(read(path.join('public', 'theme.css')), '.side-panel-header');
rec('the header is skipped rather than covered, which is why the clip starts at the table',
    decl(themeHeader, 'background') === 'var(--bg-dark)',
    `the header paints its own opaque strip (background: ${decl(themeHeader, 'background')})`);

// ------------------------------------------------------------------- the rows stay readable
section('The rows stay readable');

// Alpha out of an `rgba(…)`, parsed rather than matched, so "a scrim somewhere" cannot stand in
// for an actual figure.
const alphaOf = (value) => Number((value || '').match(/rgba\([^)]*?([\d.]+)\s*\)/)?.[1]);
function floorCheck(label, selector, note) {
    const value = decl(ruleFor(CSS, selector), 'background');
    const alpha = alphaOf(value);
    rec(label, Number.isFinite(alpha) && alpha >= 0.5 && alpha < 1,
        value === null ? `no \`background\` on ${note}` : `${value} (translucent, so the art still reads)`);
}

{
    // These surfaces have no background of their own: on the flat panel the page's dark surface is
    // their floor, and over a clip that floor is gone exactly where the art is brightest.
    floorCheck('the board gets a floor of its own, because the panel’s is gone',
        '.points-page .board-map-panel.has-map .leaderboard-table', 'the board under the backdrop');
    rec('  … and the referrals list, which is the other board in that pane',
        ruleFor(CSS, '.points-page .board-map-panel.has-map .referrals-list') !== null,
        'the two share a container rule on purpose');
    floorCheck('  … and the tray the one-time cards are laid out in',
        '.points-page .board-map-panel.has-map .one-task-grid', 'the task grid');

    // Scoped to the backdrop and not to the pane, which is the difference between a floor that
    // answers the clip and a darkening a phone pays for nothing.
    const onThePane = ['leaderboard-table', 'referrals-list', 'one-task-grid']
        .filter((cls) => ruleFor(CSS, `.points-page .board-map-panel .${cls}`) !== null);
    rec('and every floor is the backdrop’s, so a phone with no clip is unchanged',
        onThePane.length === 0 && /has-map/.test(CLIENT),
        onThePane.length ? `unscoped: ${onThePane.join(', ')}` : 'all three hang off `.has-map`');
}


const scrim = decl(ruleFor(CSS, '.points-page .board-map-scrim'), 'background');
const alphas = (scrim || '').match(/rgba?\(([^)]*)\)/g)
    ?.map((c) => Number(c.match(/([\d.]+)\s*\)$/)?.[1])) ?? [];
rec('the scrim is a two-stop gradient, parsed as numbers rather than matched as text',
    alphas.length === 2 && alphas.every((a) => Number.isFinite(a)),
    scrim === null ? 'no `background` on `.board-map-scrim`' : alphas.join(' \u2192 '));

// The clip's own measurement is in the sheet's comment: mean luma 77 of 255, flat across the run
// (76.2\u201377.8 over 240 frames). The halls' recipe (0.45 \u2192 0.82) is tuned against art at 51\u201374, so
// anything at or below that is not enough here \u2014 which is what these thresholds assert.
rec('both stops are darker than the halls\u2019 recipe, and the bottom more than the top',
    alphas.length === 2 && alphas[0] >= 0.5 && alphas[1] >= 0.8 && alphas[1] > alphas[0],
    'lit from above: the brightest part of the clip is where the rows are');

rec('and the scrim is a layer of its own, over the clip',
    /<div className="board-map-scrim" \/>/.test(CLIENT)
    && CLIENT.indexOf('board-map-video') < CLIENT.indexOf('board-map-scrim'),
    'a second background layer would paint behind the panel\u2019s own content, not over the video');

// -------------------------------------------------------------------------- the fallbacks
section('The fallbacks');

{
    const blocks = mediaBlocks(CSS, 'prefers-reduced-motion');
    const hides = blocks.some((b) => /\.points-page \.board-map-video\s*\{[^}]*display:\s*none/.test(b));
    rec('reduced motion hides the clip outright', hides,
        blocks.length ? `${blocks.length} reduced-motion block(s)` : 'no reduced-motion block at all');
    rec('  \u2026 and hides the clip, not the pane it sits behind', hides && !/\.points-page \.board-map\b\s*\{[^}]*display:\s*none/.test(blocks.join('\n')),
        'the flat panel and its scrim are what is left');
}

{
    // Every tab of the pane keeps the clip, the tasks tab included. What that tab needed over the
    // art was not less art but a floor, which is the check above this one.
    rec('no tab switches the clip off — the tasks tab keeps it too',
        !/is-plain/.test(CLIENT) && !/is-plain/.test(CSS)
        && /\{boardMapOn && \(\s*<div className="board-map"/.test(CLIENT),
        'one pane, one backdrop, four tabs — the layer is inside the pane, not inside a tab');

    // `has-map` is worn from the same state the layer is mounted from, so "the clip is up" and
    // "the floors are on" cannot drift apart.
    rec('and `has-map` is that one fact, not a second guess at it',
        /className={`side-panel board-map-panel\$\{boardMapOn \? ' has-map' : ''\}`}/.test(CLIENT)
        && /\{boardMapOn && \(/.test(CLIENT),
        'the pane and the layer read the same state');
}

{
    const blocks = mediaBlocks(CSS, 'max-width:\\s*860px');
    rec('every phone skips the clip', blocks.some((b) => /\.points-page \.board-map\s*\{[^}]*display:\s*none/.test(b)),
        `${blocks.length} block(s) at the layout breakpoint`);
}

rec('the flat panel is still the fallback the page was built on',
    /background:\s*var\(--bg-panel\)/.test(ruleFor(read(path.join('public', 'theme.css')), '.side-panel') || ''),
    '.side-panel keeps its own background under the clip');

// ------------------------------------------------------------------------------ the gate
section('What is even loaded');

rec('the layer is not rendered unless the screen is one that will show it',
    /\{boardMapOn && \(\s*<div className="board-map"/.test(CLIENT),
    'a hidden `<video autoPlay>` still downloads and still plays \u2014 measured on this page');

rec('the decision is made in an effect, not during render',
    /const \[boardMapOn, setBoardMapOn\] = useState\(false\)/.test(CLIENT)
    && /useEffect\(\(\) => \{[\s\S]{0,400}setBoardMapOn\(/.test(CLIENT),
    '`matchMedia` does not exist on the server; `false` is what both paints agree on');

rec('it asks both the width and the motion preference',
    /matchMedia\('\(min-width: 861px\)'\)/.test(CLIENT)
    && /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(CLIENT),
    'the same two answers the sheet gives');

// 861 against the sheet's 860 is the whole point: `min-width: 861px` is exactly "not `max-width:
// 860px`". A pair like 900/860 would leave a band of widths where the clip is loaded and then
// hidden by the sheet, which is the cost this gate exists to avoid.
rec('and its breakpoint tiles the sheet\u2019s, with no gap and no overlap',
    /min-width: 861px/.test(CLIENT)
    && mediaBlocks(CSS, 'max-width:\\s*860px').some((b) => /\.points-page \.board-map\s*\{[^}]*display:\s*none/.test(b)),
    'min-width 861 is exactly not max-width 860');

rec('and a flipped setting is noticed without a reload',
    /addEventListener\('change', sync\)/.test(CLIENT) && /addListener\(sync\)/.test(CLIENT),
    'modern listeners, with the legacy pair for older Safari');

// ---------------------------------------------------------------------------- the sheet
section('The sheet');

rec('the sheet is versioned, so the change reaches a returning player',
    /\/css\/points\.css\?v=\d+/.test(CLIENT), (CLIENT.match(/\/css\/points\.css\?v=\d+/) || [])[0]);

rec('every class the layer uses is defined in it',
    ['.board-map-panel', '.board-map', '.board-map-video', '.board-map-scrim']
        .every((sel) => ruleFor(CSS, `.points-page ${sel}`) !== null),
    'an undefined class is how a backdrop becomes a black rectangle');

// The argument the layer ordering above rests on: the clip is a video *element*, and a video cannot
// be a `background-image`. Stated as a check so a later tidy-up cannot decide otherwise in silence.
rec('and the clip is a video element, which is why the layer exists at all',
    /<div className="board-map" aria-hidden="true">\s*<video\b/.test(CLIENT)
    && decl(ruleFor(CSS, '.points-page .board-map'), 'background') === null,
    'a video cannot be a `background-image`');

const failed = results.filter((r) => !r.pass);
console.log('');
if (!results.length) {
    console.log('nothing was checked');
    process.exitCode = 1;
} else {
    console.log(`${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length) {
        console.log('');
        for (const f of failed) console.log(`  FAILED  ${f.label}`);
        process.exitCode = 1;
    }
}
