#!/usr/bin/env node
/**
 * Checks the map gate — the screen between a cleared dungeon and the next one.
 *
 *     node tools/check-map-gate.js
 *
 * The gate began life as a one-shot cover for the *first* load: `loading-gate.js` looked
 * for the engine once, collected the chosen dungeon's art, and removed itself from the
 * DOM. The sixty-second auto-progress then rebuilt the map and swapped the background
 * video underneath the player with no screen at all, which is the bug this checks the
 * fix for.
 *
 * What it can see is the wiring, and the wiring is where this broke: a one-shot module
 * cannot be raised twice, an `is-open` gate that has been removed cannot be raised at
 * all, and a run that starts before the art lands is a run fought behind a loading
 * screen. What it cannot see is the timing — whether the gate really lifts when the
 * monsters have arrived — and that is measured in the browser instead (see the
 * September 26 section of `.freebuff/run.md`).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

function section(name) {
    console.log('');
    console.log(name);
}

const gate = read('public/loading-gate.js');
const game = read('public/game.js');
const pages = read('lib/static-pages.js');
const arya = read('public/arya.js');

/** Source order: is `first` before `second`? Both must be present. */
function before(source, first, second) {
    const a = source.indexOf(first);
    const b = source.indexOf(second);
    return a !== -1 && b !== -1 && a < b;
}

/**
 * One function's source, from its first line to the `}` that closes it at method indent.
 *
 * The wiring checks have to look *inside* a function. A whole-file test for
 * `failsafe = setTimeout(` passes on the boot line at the bottom of loading-gate.js even
 * when `raise()` has stopped re-arming anything — and that mutation was tried, which is
 * how this helper got here.
 */
function body(source, marker) {
    const at = source.indexOf(marker);
    if (at === -1) return '';
    const end = source.indexOf('\n    }', at);
    return end === -1 ? source.slice(at) : source.slice(at, end);
}

const raiser = body(gate, 'function raise(name)');
const mapChanger = body(game, 'withMapGate(type, onReady)');
const squadPlacer = body(game, 'moveSquad(deployedKnights)');

section('The module a second map needs');

rec('the gate is an API, not a one-shot script',
    /window\.MapGate = \{ raise, follow, open, isUp/.test(gate),
    'raise / follow / open / isUp');
rec('  \u2026 and it is never removed from the page',
    !/gate\.remove\(\)/.test(gate),
    'a removed node cannot be raised again — the lifted state is `is-open` instead');
rec('a re-raise resets what the last one counted',
    /generation \+= 1;/.test(raiser) && /total = 0;/.test(raiser) && /settled = 0;/.test(raiser),
    'settled and total are per-raising, not per-page');
rec('  \u2026 and re-arms the failsafe it just cancelled',
    /clearTimeout\(failsafe\);/.test(raiser)
    && /failsafe = setTimeout\(\(\) => open\('timeout'\), MAX_MS\)/.test(raiser)
    && !/const failsafe/.test(gate),
    'a `const` timer cannot be re-armed, which is exactly how this broke once');
rec('an image that lands late cannot push the next map\u2019s counter',
    (gate.match(/if \(opened \|\| gen !== generation\) return;/g) || []).length === 2,
    'both watchers carry the generation guard');
rec('the fade-in is switched off for a raise, then handed back',
    /gate\.style\.transition = 'none';[\s\S]*?gate\.classList\.remove\('is-open'\);[\s\S]*?void gate\.offsetHeight;[\s\S]*?gate\.style\.transition = '';/.test(gate),
    'otherwise the gate fades in over the map it is covering');
rec('the gate cannot trap the player',
    /MAX_MS = 15000/.test(gate)
    && /failsafe = setTimeout\(\(\) => open\('timeout'\), MAX_MS\)/.test(gate)
    && /const held = Math\.max\(0, MIN_MS - \(Date\.now\(\) - started\)\)/.test(gate),
    'a held request ends in an open gate, and a cached one still shows for MIN_MS');

section('Where the engine uses it');

rec('the map change raises the gate before it rebuilds the dungeon',
    before(mapChanger, 'gate.raise(type)', 'this.createDungeon(type)'),
    'the cover goes up first, so the new map is never drawn in the open');
rec('  \u2026 and nothing fights behind it',
    before(mapChanger, 'this.isRunning = false;', 'gate.raise(type)'),
    'isRunning is down for the whole rebuild');
rec('the squad gets its run when the gate lifts, not before',
    /gate\.follow\(this, start\)/.test(mapChanger)
    && /const start = \(\) => \{/.test(mapChanger) && /onReady\(\)/.test(mapChanger)
    && /this\.isRunning = true;/.test(squadPlacer)
    && /this\.beginRun\(deployedKnights\)/.test(squadPlacer),
    'beginRun lives in moveSquad, which the gate calls');
rec('a page without the gate still plays',
    /if \(gate\) gate\.follow\(this, start\);/.test(mapChanger)
    && /else start\(\);/.test(mapChanger),
    'the engine degrades to the old behaviour rather than stalling');
rec('both ways of changing the map go through it',
    /this\.withMapGate\(/.test(body(game, 'async nextDungeon()'))
    && /this\.withMapGate\(/.test(body(game, 'async replayDungeon()')),
    'the auto-progress and the Replay button');
rec('  \u2026 and the replay is gated on the same budget as the map change',
    /await this\.squadBudget\(deployedKnights\)/.test(body(game, 'async replayDungeon()')),
    'a rebuild is a run, so it is not a way around the daily cap');

section('The page it hangs on');

rec('the game route still paints the gate in its markup',
    /id=\\"mapLoadingGate\\"/.test(pages) && /id=\\"mapGateBar\\"/.test(pages)
    && /id=\\"mapGateName\\"/.test(pages),
    'the gate is on screen from the first frame, not after the engine boots');
rec('  \u2026 and the module loads before the engine that calls it',
    before(pages, '"loading-gate.js?v=2"', '"game.js?v='),
    'loading-gate.js first in the game route\u2019s script list');
rec('  \u2026 and it is versioned, so a browser cannot keep the one-shot copy',
    /"loading-gate\.js\?v=2"/.test(pages),
    'the cached v=1 had no MapGate at all');
rec('Arya has a line for the hold, which is what she says while it is up',
    /hold: \{/.test(arya) && /window\.Arya\.say\('hold'/.test(gate),
    'the gate speaks through the character, not a spinner');

const failed = results.filter((r) => !r.pass);
console.log('');
if (!results.length) {
    console.log('nothing was checked');
    process.exitCode = 1;
    return;
}
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
    console.log('');
    for (const f of failed) console.log(`  FAILED  ${f.label}`);
    process.exitCode = 1;
}
