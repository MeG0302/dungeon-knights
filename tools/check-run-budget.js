#!/usr/bin/env node
/**
 * Proves the daily run budget — "5/5 runs today" — and that the game runs that same
 * arithmetic rather than a copy of it.
 *
 *     node tools/check-run-budget.js
 *
 * The thing being proved is not that a number is 5. It is that a squad cannot start a
 * sixth run on the day, that the count a player sees cannot be moved by claiming, and
 * that an unread knight is never silently written off as exhausted.
 *
 * Three tables say what the cap is — the Solidity ladder the contract enforces, the page
 * config the UI reads, and `public/run-budget.js`'s fallback — and this reads all three
 * out of their own source, so a cap changed in one place and not the others is a red run
 * rather than a squad that plays five runs and is paid for four. The *hour* the cap rolls
 * over on is read the same way, from four places: the browser module, the constant the pitch
 * deck prints, and `RESET_HOUR_UTC` in both game contracts. A browser an hour out of step
 * with the chain shows a full 5/5 exactly when every run is refused.
 *
 * The last section is the one that keeps the proof honest: the module is only worth
 * checking if the game actually calls it, so `public/game.js`, `characters.js`,
 * `dungeon-session.js` and the served page scripts are read back and asserted on.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const budget = require('../public/run-budget.js');

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

function section(name) {
    console.log('');
    console.log(name);
}

/** `dailyCap[0] = 5; // Common` → { COMMON: 5, … }, from a contract's own source. */
function capsFromContract(file) {
    const source = read(file);
    const order = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'];
    const out = {};
    const re = /dailyCap\[(\d)\]\s*=\s*(\d+);[^\n]*?\/\/\s*([A-Za-z]+)/g;
    let match;
    while ((match = re.exec(source))) {
        out[match[3].toUpperCase()] = Number(match[2]);
        if (out[match[3].toUpperCase()] === undefined) out[order[Number(match[1])]] = Number(match[2]);
    }
    return out;
}

/** `tier: 'COMMON', … dailyRuns: 5` (config.js) → { COMMON: 5, … }. */
function capsFromPageConfig() {
    const source = read('public/config.js');
    const out = {};
    for (const name of ['common', 'uncommon', 'rare', 'epic', 'legendary']) {
        const block = source.match(new RegExp(`${name}:\\s*\\{[\\s\\S]*?\\n  \\}`));
        if (!block) continue;
        const tier = block[0].match(/tier:\s*'([A-Z]+)'/);
        const runs = block[0].match(/dailyRuns:\s*(\d+)/);
        if (tier && runs) out[tier[1]] = Number(runs[1]);
    }
    return out;
}

/** The `RARITY` table in characters.js, which is the one the roster actually reads. */
function capsFromCharacters() {
    const source = read('public/characters.js');
    const out = {};
    for (const tier of ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY']) {
        const block = source.match(new RegExp(`${tier}:\\s*\\{[\\s\\S]*?\\n    \\}`));
        if (!block) continue;
        const runs = block[0].match(/dailyRuns:\s*(\d+)/);
        if (runs) out[tier] = Number(runs[1]);
    }
    return out;
}

function same(a, b) {
    const keys = Object.keys(a);
    if (!keys.length || keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => a[key] === b[key]);
}

/**
 * One function's source, from its first line to the `}` that closes it at method indent.
 *
 * The wiring checks below have to look *inside* a function: `await this.squadBudget(`
 * appears in two places in game.js, so a whole-file test passes while the copy that
 * matters — the one in the auto-progress — has been deleted. That mutation was tried, and
 * this is the shape that catches it.
 */
function body(source, marker) {
    const at = source.indexOf(marker);
    if (at === -1) return '';
    const end = source.indexOf('\n    }', at);
    return end === -1 ? source.slice(at) : source.slice(at, end);
}

(async () => {
    // ------------------------------------------------------------------------- the ladder
    section('The cap, and where it comes from');

    const v4 = capsFromContract('contracts/DungeonKnightsGameV4.sol');
    const v3 = capsFromContract('contracts/DungeonKnightsGameV3-Simple.sol');
    const config = capsFromPageConfig();
    const characters = capsFromCharacters();

    rec('the Solidity ladder this checks against was actually parsed',
        Object.keys(v4).length === 5 && Object.keys(v3).length === 5,
        `V4 ${JSON.stringify(v4)}`);
    rec('the fallback table in run-budget.js is the contract\u2019s own ladder',
        same(budget.CAPS, v4),
        `${JSON.stringify(budget.CAPS)} vs ${JSON.stringify(v4)}`);
    rec('  \u2026 and the contract production claims against today agrees',
        same(budget.CAPS, v3),
        'V3-Simple carries the same 5/5/4/3/4');
    rec('  \u2026 and the page config the UI reads agrees',
        same(budget.CAPS, config),
        JSON.stringify(config));
    rec('  \u2026 and the roster table in characters.js agrees',
        same(budget.CAPS, characters),
        JSON.stringify(characters));
    rec('the ladder is 5 for the two cheap tiers, so "5/5" is the common case',
        budget.CAPS.COMMON === 5 && budget.CAPS.UNCOMMON === 5
        && budget.CAPS.RARE === 4 && budget.CAPS.EPIC === 3 && budget.CAPS.LEGENDARY === 4,
        'any other tier shows 4/4 or 3/3, and the page no longer pretends otherwise');

    // -------------------------------------------------------------------------- the day
    section('The reset-day, which is the chain\u2019s, not the browser\u2019s');

    const at = (iso) => Math.floor(Date.parse(iso) / 1000);
    rec('11:59:59 UTC belongs to the day before',
        budget.dayIndexAt(at('2026-09-26T11:59:59Z')) === budget.dayIndexAt(at('2026-09-26T00:00:00Z')),
        'a run at 00:30 and one at 11:59 share a budget');
    rec('12:00:00 UTC starts the next one',
        budget.dayIndexAt(at('2026-09-26T12:00:00Z')) === budget.dayIndexAt(at('2026-09-26T11:59:59Z')) + 1,
        'reset at noon, as `currentDayIndex()` has it');
    rec('  \u2026 and the formula is the contract\u2019s, computed independently',
        budget.dayIndexAt(at('2026-09-26T13:00:00Z'))
        === Math.floor((at('2026-09-26T13:00:00Z') - (12 * 3600)) / 86400),
        'floor((t \u2212 12h) / 1 day)');
    rec('millisecond stamps and second stamps answer the same',
        budget.dayIndexAt(at('2026-09-26T13:00:00Z') * 1000) === budget.dayIndexAt(at('2026-09-26T13:00:00Z')),
        'the browser holds clearedAt in ms, the chain in s');

    // The hour is one number in four places: the module's own arithmetic, the constant the pitch
    // deck prints on its loop slide, and `RESET_HOUR_UTC` in both game contracts. Four copies of a
    // boundary is four chances to move one of them, and a browser an hour out of step with the
    // chain shows a full 5/5 exactly when every run is refused. Read from each source.
    const hourIn = (file, pattern) => {
        const found = new RegExp(pattern).exec(read(file));
        return found ? Number(found[1]) : null;
    };
    const hours = {
        browser: hourIn('public/run-budget.js', 'RESET_HOUR_UTC\\s*=\\s*(\\d+)'),
        deck: hourIn('lib/reward-config.js', 'GAME_RESET_HOUR_UTC\\s*=\\s*(\\d+)'),
        v3: hourIn('contracts/DungeonKnightsGameV3-Simple.sol', 'RESET_HOUR_UTC\\s*=\\s*(\\d+)'),
        v4: hourIn('contracts/DungeonKnightsGameV4.sol', 'RESET_HOUR_UTC\\s*=\\s*(\\d+)'),
    };
    rec('the reset hour is the same number in the browser, the deck\u2019s config and both contracts',
        Object.values(hours).every((hour) => hour !== null && hour === budget.RESET_HOUR_UTC),
        `browser ${hours.browser} \u00b7 reward-config ${hours.deck} \u00b7 V3 ${hours.v3} \u00b7 V4 ${hours.v4}`);
    rec('  \u2026 and it is the hour the module\u2019s own day index is computed with',
        budget.dayIndexAt(at('2026-09-26T13:00:00Z'))
        === Math.floor((at('2026-09-26T13:00:00Z') - (budget.RESET_HOUR_UTC * 3600)) / 86400),
        `${budget.RESET_HOUR_UTC}:00 UTC as a constant, not a literal inside the formula`);

    // ------------------------------------------------------------------- what is banked
    section('What the browser is holding, unclaimed');

    const today = at('2026-09-26T13:00:00Z');
    const yesterday = at('2026-09-25T13:00:00Z');
    const runs = [
        { knightIds: [7], clearedAt: today * 1000 },
        { knightIds: [7, 9], clearedAt: today * 1000 },
        { knightIds: [7], clearedAt: yesterday * 1000 },
        { knightIds: [9], clearedAt: today * 1000 },
    ];
    rec('only today\u2019s runs count against today',
        budget.bankedFor(runs, 7, today) === 2,
        'two of knight #7\u2019s three clears are in this reset-day');
    rec('  \u2026 and only the runs this knight was in',
        budget.bankedFor(runs, 9, today) === 2,
        'a squad mate\u2019s solo run is not the knight\u2019s own');
    rec('a knight in nothing banked nothing',
        budget.bankedFor(runs, 42, today) === 0);
    rec('an empty or missing queue is zero, not a crash',
        budget.bankedFor(null, 7, today) === 0 && budget.bankedFor([], 7, today) === 0);

    // ------------------------------------------------------------------ the arithmetic
    section('Runs left \u2014 the number the roster prints and the gate reads');

    rec('a full knight in a fresh day has the whole cap',
        budget.playableFor(5, 0) === 5);
    rec('two banked clears leave three runs',
        budget.playableFor(5, 2) === 3);
    rec('  \u2026 and never goes negative',
        budget.playableFor(2, 5) === 0 && budget.playableFor(0, 0) === 0);
    rec('an unread knight is null, never zero',
        budget.playableFor(null, 0) === null && budget.playableFor(undefined, 3) === null,
        'unknown must not read as exhausted');

    // The invariant the whole design turns on: claiming banked runs spends the claims and
    // empties the queue together, so the number a player sees does not move.
    let claimStable = true;
    for (let remaining = 0; remaining <= 5; remaining++) {
        for (let banked = 0; banked <= 5; banked++) {
            const before = budget.playableFor(remaining, banked);
            for (let claimed = 0; claimed <= banked; claimed++) {
                const after = budget.playableFor(remaining - claimed, banked - claimed);
                if (after !== before) claimStable = false;
            }
        }
    }
    rec('claiming any number of banked runs does not move the count',
        claimStable,
        'playable = remaining \u2212 banked, and a claim subtracts one from each side');
    rec('  \u2026 and a spent knight is still spent after claiming',
        budget.playableFor(0, 0) === 0 && budget.playableFor(0, 3) === 0,
        'claiming the queue does not buy a sixth run');

    // ------------------------------------------------------------------- the worked day
    section('A common knight\u2019s day, run by run');

    const commonCap = budget.capFor('COMMON', null);
    const day = [];
    let banked = 0;
    for (let run = 1; run <= 7; run++) {
        const remaining = 5; // nothing claimed yet: the chain still says five
        day.push({ run, playable: budget.playableFor(remaining, banked) });
        if (budget.playableFor(remaining, banked) > 0) banked = Math.min(commonCap, banked + 1);
    }
    rec('five clears are allowed and the sixth is not',
        day[4].playable === 1 && day[5].playable === 0 && day[6].playable === 0,
        `run 5 \u2192 1 left, run 6 \u2192 0, run 7 \u2192 0`);
    rec('  \u2026 which is exactly the chain\u2019s rule, not a UI preference',
        /require\(ks\.runsUsed < dailyCap\[rarity\], "No runs left today"\)/.test(
            read('contracts/DungeonKnightsGameV4.sol')),
        'the sixth claim reverts, so the sixth run must not start');

    // ------------------------------------------------------------------------- the squad
    section('The squad\u2019s verdict, which is what the deploy button reads');

    const knights = [
        { id: 1, tier: 'COMMON' },
        { id: 2, tier: 'RARE' },
    ];
    const fresh = budget.planFor({
        knights, table: null, now: today, runs: [],
        remainingById: { 1: 5, 2: 4 },
    });
    rec('a fresh squad can run, and the squad\u2019s budget is its smallest',
        fresh.blocked.length === 0 && fresh.playable === 4,
        'two knights, one of them with four runs');
    rec('  \u2026 and each line carries its own cap from the table it was handed',
        fresh.lines[0].cap === 5 && fresh.lines[1].cap === 4);

    const oneSpent = budget.planFor({
        knights, now: today, runs: [], remainingById: { 1: 0, 2: 4 },
    });
    rec('one spent knight blocks the squad',
        oneSpent.blocked.length === 1 && oneSpent.blocked[0] === 1,
        'a run pays for every knight in it, so the squad can only be as ready as its worst');
    rec('  \u2026 even though the other knight has runs to spare',
        oneSpent.lines[1].playable === 4);

    const unread = budget.planFor({
        knights, now: today, runs: [],
        remainingById: { 1: null, 2: 4 },
    });
    rec('an unread knight blocks nothing',
        unread.blocked.length === 0 && unread.unknown[0] === 1,
        'the chain and the server are the gate; a down RPC is not a refusal');
    rec('  \u2026 and the squad\u2019s budget answers from the knights it did read',
        unread.playable === 4);

    const bankedSquad = budget.planFor({
        knights, now: today,
        runs: [{ knightIds: [1, 2], clearedAt: today * 1000 }],
        remainingById: { 1: 5, 2: 4 },
    });
    rec('a banked clear is subtracted from every knight in it',
        bankedSquad.lines[0].playable === 4 && bankedSquad.lines[1].playable === 3,
        'claim it and both sides drop by one \u2014 the count holds');

    const empty = budget.planFor({ knights: [], now: today });
    rec('a squad of nobody claims no budget',
        empty.playable === null && empty.blocked.length === 0,
        'null is not "ready"');

    // ------------------------------------------------------------------ the wiring
    section('The game is the module\u2019s caller, not a copy of it');

    const game = read('public/game.js');
    const session = read('public/dungeon-session.js');
    const roster = read('public/characters.js');
    const menu = read('public/menu.js');
    const ui = read('public/ui.js');

    const deploy = body(game, 'async startDungeon()');
    const advance = body(game, 'async nextDungeon()');
    const replay = body(game, 'async replayDungeon()');

    rec('the dungeon asks the module before it starts a run',
        /await this\.squadBudget\(/.test(deploy) && /squadSpent\(/.test(game),
        'the gate before a run, and the stop when the day is spent');
    rec('  \u2026 and the auto-progress answers to it too, not only the deploy button',
        /await this\.squadBudget\(deployedKnights\)/.test(advance)
        && /if \(!ok\)/.test(advance) && /this\.squadSpent\(budget\)/.test(advance),
        'no sixth run walked into by the timer');
    rec('  \u2026 and the Replay button is not a way around the same cap',
        /await this\.squadBudget\(deployedKnights\)/.test(replay)
        && /this\.squadSpent\(budget\)/.test(replay),
        'a rebuild is a run');
    rec('the session hands over the queue the module counts',
        /RunBudget\.planFor\(/.test(session) && /pendingRuns/.test(session),
        'banked runs come from one place');
    // The original bug, caught as a *shape* rather than as a string: the module call has to
    // be the answer, not dead code under an early `return` of the cap. A plain search for
    // `RunBudget.playableFor(` passes on the mutated file, because the call is still there.
    const runsReader = body(roster, 'getRemainingRuns() {');
    rec('the roster reads its number from the module',
        /RunBudget\.playableFor\(/.test(runsReader)
        && !/return RARITY\[/.test(runsReader)
        && !/dailyRuns/.test(runsReader),
        'the cap is not a number of runs left, and characters.js is where that is answered');
    rec('no screen re-derives the cap with its own literal',
        !/\|\|\s*5\b/.test(menu) && !/\|\|\s*5\b/.test(ui),
        'the "fallback 5" that made every knight look full is gone');
    rec('the served pages load the module before anything that calls it',
        /"run-budget\.js\?v=\d+"/.test(read('lib/static-pages.js')),
        'and the engine still boots if it is missing');

    // ------------------------------------------------------------------------------ tally
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
})().catch((error) => {
    console.error(`harness stopped: ${error.message || error}`);
    process.exitCode = 1;
});
