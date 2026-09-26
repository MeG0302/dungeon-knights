#!/usr/bin/env node
/**
 * Does the wheel pay what it says it pays — and only once?
 *
 *     node tools/check-redeem.js
 *
 * `/redeem` is the first thing in this project that *spends* points, and the first that hands over
 * something with money behind it. Neither is visible from a page:
 *
 *   - **The odds are printed on the page.** "1 in 3 spins wins a gift card" is a sentence a player
 *     reads before paying for a spin, so it is checked twice: the table has to *say* 1 in 3, and a
 *     hundred thousand real draws have to *land* within a percent of it. A weight edit that turns
 *     the wheel into 1-in-6 fails here by name rather than in a player's hands.
 *   - **A code must not leak.** The pool never reaches a browser: `redeemView` carries counts and
 *     this wallet's own rows. That is proved with sentinel codes planted in the pool — if one of
 *     them appears anywhere in a view payload, the run fails.
 *   - **Nothing may be charged that was not paid for.** A retried spin, a spin with too few points,
 *     a spin with an empty pool: each is asserted to leave the balance exactly where it was. And the
 *     one that *is* charged has to be charged exactly once — a second request with the same spin id
 *     hands back the same code and moves no points.
 *   - **The spend writes itself down.** A row in the wallet's activity log with a negative figure,
 *     and no touch of the day's board — the capsule draw ranks points *earned* today, and redeeming
 *     yesterday's balance must not cost a player their place in it.
 *
 * **It writes to the local store, and refuses to run against Redis.** The fixtures are eight wallet
 * records in `.data/points.json` and a pool of sentinel codes; the file is backed up before the first
 * write and restored after the last, so a development machine is left exactly as it was found. If
 * `KV_REST_API_URL` is in the environment the harness stops before it touches anything — the codes in
 * production are real money, and no test has any business near them.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const lib = (name) => pathToFileURL(path.join(ROOT, 'lib', name)).href;

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

function section(title) {
    console.log('');
    console.log(title);
}

console.log('');
console.log('The knights\u2019 wheel \u2014 /redeem');

// ------------------------------------------------------------------ the pool is not production's
if (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) {
    console.log('');
    console.log('  REFUSING TO RUN: KV_* variables are set in this environment.');
    console.log('  This harness writes fake codes and spends fake points. Unset them and run it again.');
    process.exitCode = 1;
} else {
    const DATA = path.join(ROOT, '.data', 'points.json');
    const backup = exists(path.join('.data', 'points.json')) ? fs.readFileSync(DATA, 'utf8') : null;

    try {
        await run();
    } finally {
        // Restored whatever happened: a harness that leaves its fixtures behind is a harness that
        // breaks the *next* run's numbers, and the numbers here are balances.
        if (backup === null) {
            if (exists(path.join('.data', 'points.json'))) fs.rmSync(DATA);
        } else {
            fs.mkdirSync(path.dirname(DATA), { recursive: true });
            fs.writeFileSync(DATA, backup);
        }
    }
}

async function run() {
    const Redeem = await import(lib('points-redeem.js'));
    const Config = await import(lib('points-config.js'));
    const Store = await import(lib('points-store.js'));
    const Program = await import(lib('points-program.js'));
    const History = await import(lib('points-history.js'));
    const Routing = await import(lib('app-routing.js'));
    const Trail = await import(lib('back-trail.js'));
    const Knights = await import(lib('knights.js'));
    const Reels = await import(lib('points-redeem-reels.js'));

    const COST = Config.REDEEM_SPIN_COST;
    const day = Config.todayKey();

    // ----------------------------------------------------------------- the odds
    section('The odds, which are a sentence on the page and a table on the server');

    const odds = Config.redeemOdds();
    rec('a spin costs what the page says it costs, from one constant',
        COST === 1000 && odds.line.startsWith('1,000 points a spin'),
        odds.line);
    rec('the prize rate is exactly one in three, computed from the weights',
        Math.abs(odds.prize - 1 / 3) < 1e-12,
        `${odds.prize.toFixed(6)} = ${Config.REDEEM_PRIZES.map((p) => Config.REDEEM_WEIGHTS[p]).join('+')}/${odds.total}`);
    rec('and the two cards are a coin flip between them',
        Math.abs(odds.each - 1 / 6) < 1e-12,
        `each ${odds.each.toFixed(6)}`);
    rec('the page prints the line the table produced, and no number of its own',
        /ODDS\.line/.test(read('app/redeem/client.js'))
        && /REDEEM_SPIN_COST\.toLocaleString\('en-US'\)/.test(read('app/redeem/client.js'))
        && !/\b1000\b/.test(read('app/redeem/client.js')),
        'no 1000 typed into the component');

    // A hundred thousand real draws. 6 sigma on 100,000 is 0.15%, so a one-point band cannot flake
    // — and a wheel whose real rate is 1-in-6 is 10,000 draws away from passing.
    const draws = 100000;
    const counts = { tryAgain: 0, amazon: 0, google: 0 };
    for (let i = 0; i < draws; i += 1) counts[Redeem.pickOutcome()] += 1;
    const prizeRate = (counts.amazon + counts.google) / draws;
    rec(`  … and ${draws.toLocaleString('en-US')} real draws land within a percent of it`,
        Math.abs(prizeRate - odds.prize) < 0.01,
        `${(prizeRate * 100).toFixed(2)}% against ${(odds.prize * 100).toFixed(2)}%`);
    // The band on the *difference* was 0.005 and that is 3 sigma — it failed once, during a mutation
    // sweep, on a tree where nothing was wrong: with p = 1/6 and 100,000 draws the standard
    // deviation of the difference is 0.167%, so a 0.5% band is passed by luck 99.7% of the time.
    // 0.008 is ~4.8 sigma, and it still catches the bug this is for by two orders of magnitude: a
    // wheel that drew amazon twice as often as google would differ by ~16 points, not 0.8.
    rec('with both cards drawn at the same rate, so neither pool drains first',
        Math.abs(counts.amazon - counts.google) / draws < 0.008
        && Math.abs(counts.amazon / draws - odds.each) < 0.01
        && Math.abs(counts.google / draws - odds.each) < 0.01,
        `amazon ${counts.amazon} · google ${counts.google} · miss ${counts.tryAgain}`);
    rec('the draw can only ever return an outcome the table names',
        Config.redeemTable().length === Object.keys(counts).length
        && Config.redeemTable().every((row) => row.weight > 0),
        Config.redeemTable().map((row) => `${row.key}:${row.weight}`).join(' '));

    // ----------------------------------------------------------------- the fixtures
    section('A wallet, a pool of sentinel codes, and no Redis in sight');

    const wallet = '0x' + '7e'.repeat(20);
    const other = '0x' + '3c'.repeat(20);
    const AMAZON = ['AMZN-SENTINEL-0001', 'AMZN-SENTINEL-0002', 'AMZN-SENTINEL-0003'];
    const GOOGLE = ['GOOG-SENTINEL-0001', 'GOOG-SENTINEL-0002'];
    const POOL = { amazon: [...AMAZON], google: [...GOOGLE], given: [] };

    // Five spins' worth, because this run plays four of them and each one is charged: the balances
    // asserted below are only meaningful if the wallet can afford every step. (The first version of
    // this file started at 2,500 and the third spin was refused as unaffordable — which is the
    // *right* behaviour and a harness bug, and exactly the kind of thing these numbers exist to
    // catch.)
    const START = 5000;
    await Redeem.writePool(POOL);
    await Store.putWallet({ ...Store.blankWallet(wallet), points: START });

    rec('the store the harness writes to is the local file, not a deployment',
        Store.STORAGE_DRIVER !== 'redis', Store.storageDescription());
    rec('a new wallet record carries a `redeems` list, so an old one hydrates into one',
        Array.isArray(Store.blankWallet(wallet).redeems) && Store.blankWallet(wallet).redeems.length === 0,
        'blankWallet().redeems');
    const stored = await Redeem.readPool();
    rec('and the pool reads back exactly as it was written',
        stored.amazon.length === AMAZON.length && stored.google.length === GOOGLE.length && stored.given.length === 0,
        `${stored.amazon.length} amazon · ${stored.google.length} google`);
    rec('the pool refuses anything that is not the shape of a code',
        Redeem.looksLikeCode('AB12-CD34-EF56') && Redeem.looksLikeCode('ABCD1234EFGH5678')
        && !Redeem.looksLikeCode('') && !Redeem.looksLikeCode('a'.repeat(60))
        && !Redeem.looksLikeCode('not a code at all!'),
        'shape check for the tool that loads them');

    // ----------------------------------------------------------------- the charge
    section('What one spin costs, and what it hands over');

    const win = await Redeem.spin(wallet, { randomInt: () => 4 });
    rec('a stubbed draw lands on the outcome its roll points at',
        win.outcome === 'amazon' && win.prize === 'amazon',
        `roll 4 → ${win.outcome}`);
    rec('the spin is charged exactly the cost, once',
        win.points === START - COST,
        `${START.toLocaleString('en-US')} → ${win.points.toLocaleString('en-US')}`);
    rec('a win hands over one code, and it comes out of the pool it belongs to',
        AMAZON.includes(win.code), win.code);
    rec('  … and that code is now on the winner\u2019s wallet, not in the pool',
        (await Redeem.readPool()).amazon.length === AMAZON.length - 1
        && (await Store.getWallet(wallet)).redeems.some((row) => row.code === win.code && row.id === win.spinId),
        `pool ${(await Redeem.readPool()).amazon.length} left`);
    rec('  … and the ledger records who it went to',
        (await Redeem.readPool()).given.at(-1)?.address === wallet
        && (await Redeem.readPool()).given.at(-1)?.code === win.code,
        'the pool document is the ledger');
    rec('the spend is written into the activity log as a negative row',
        ((await Store.getWallet(wallet)).activity || []).at(-1)?.points === -COST
        && ((await Store.getWallet(wallet)).activity || []).at(-1)?.reason === 'redeem_spin',
        History.describeEarn('redeem_spin'));

    const loss = await Redeem.spin(wallet, { randomInt: () => 0 });
    rec('a miss is charged too — the spin is what was bought, not the card',
        loss.outcome === 'tryAgain' && loss.code === null && loss.points === START - COST * 2,
        `${loss.outcome}, ${loss.points} left`);
    rec('  … and it consumes no code, so a miss cannot quietly drain the pool',
        (await Redeem.readPool()).amazon.length === AMAZON.length - 1
        && (await Redeem.readPool()).google.length === GOOGLE.length
        && (await Redeem.readPool()).given.length === 1,
        'nothing left the pool');

    // The second win is the *same* card on purpose. Two wins of different cards take different
    // arrays and cannot collide however the pool is read; the failure worth catching is a pool that
    // hands out its first element and never removes it, which only shows when the same card is won
    // twice. (This check used to win amazon then google, and that mutation passed it.)
    const second = await Redeem.spin(wallet, { randomInt: () => 4 });
    rec('a second win of the same card draws a different code — one code, one winner',
        second.outcome === 'amazon' && AMAZON.includes(second.code) && second.code !== win.code
        && second.points === START - COST * 3,
        `${win.code} then ${second.code}`);
    rec('  … and it really is gone from the pool, not just absent from this answer',
        (await Redeem.readPool()).amazon.length === AMAZON.length - 2,
        `${(await Redeem.readPool()).amazon.join(', ')} left`);
    rec('every spin of one wallet is a row on its record, newest last',
        (await Store.getWallet(wallet)).redeems.length === 3
        && (await Store.getWallet(wallet)).redeems.at(-1).code === second.code,
        '3 rows: amazon, miss, amazon');

    // ----------------------------------------------------------------- the refusals
    section('Every refusal is free');

    const before = (await Store.getWallet(wallet)).points;
    const replay = await Redeem.spin(wallet, { spinId: win.spinId, randomInt: () => 0 });
    rec('a spin id that has already been played is answered from the record, not replayed',
        replay.replay === true && replay.code === win.code && replay.outcome === 'amazon',
        'the same code, not a second one');
    rec('  … and it charges nothing: a lost response costs a retry, never a second buy',
        (await Store.getWallet(wallet)).points === before
        && (await Redeem.readPool()).amazon.length === AMAZON.length - 2,
        `${before} points, unchanged`);

    await Store.putWallet({ ...Store.blankWallet(other), points: 999 });
    const short = await Redeem.spin(other, { randomInt: () => 4 });
    rec('a wallet that cannot afford a spin is refused with its balance attached',
        short.error === 'not_enough_points' && short.points === 999 && short.needed === COST,
        `999 of ${COST}`);
    rec('  … and nothing was taken: the balance is still 999 and no code left the pool',
        (await Store.getWallet(other)).points === 999
        && (await Store.getWallet(other)).redeems.length === 0
        && (await Redeem.readPool()).amazon.length === AMAZON.length - 2,
        'refused before the pool was touched');

    await Redeem.writePool({ ...POOL, amazon: [...AMAZON], google: [], given: [] });
    const dry = await Redeem.spin(wallet, { randomInt: () => 4 });
    rec('an empty card closes the wheel rather than changing the odds behind the player\u2019s back',
        dry.error === 'out_of_stock' && dry.stock?.google === 0,
        JSON.stringify(dry.stock));
    rec('  … and that refusal is free as well',
        (await Store.getWallet(wallet)).points === before
        && (await Redeem.readPool()).amazon.length === AMAZON.length
        && (await Redeem.readPool()).given.length === 0,
        'both pools untouched');

    // ----------------------------------------------------------------- the day's board
    const spinsToday = await Store.dailyPointsFor(wallet, day);
    rec('a spend does not rewrite the day\u2019s board — the capsule draw ranks what a player earned',
        !spinsToday,
        `daily points for ${day}: ${spinsToday || 0}`);

    // ----------------------------------------------------------------- the view
    section('What the page is handed, and what it is not');

    // The wallet's own codes, before the view is asked for anything: what the payload is allowed to
    // contain is exactly this set and nothing else. The pool is re-stocked first, so every other
    // sentinel in it is a code this wallet has not won — which is what a leak would look like.
    await Store.putWallet({ ...Store.blankWallet(wallet), points: 5000, redeems: (await Store.getWallet(wallet)).redeems });
    await Redeem.writePool({ ...POOL, amazon: [...AMAZON], google: [...GOOGLE], given: [] });
    const view = await Redeem.redeemView(wallet);
    const own = new Set((await Store.getWallet(wallet)).redeems.map((row) => row.code).filter(Boolean));
    const serialised = JSON.stringify(view);
    const leaked = [...AMAZON, ...GOOGLE].filter((code) => serialised.includes(code) && !own.has(code));
    rec('the view carries no code the wallet did not win — sentinels prove it',
        leaked.length === 0,
        leaked.length ? `LEAKED ${leaked.join(', ')}` : `${own.size} owned, ${AMAZON.length + GOOGLE.length - own.size} not in the payload`);
    rec('  … and it does carry this wallet\u2019s own codes, so a winner can always read them back',
        view.spins.some((row) => row.code === win.code) && view.spins.some((row) => row.code === second.code),
        `${view.spins.filter((row) => row.code).length} codes of its own`);
    rec('  … and a code it won once is listed once, however many times the page is read',
        view.spins.filter((row) => row.code === win.code).length === 1,
        'one row per spin');
    rec('it carries counts, not contents, for the pools',
        view.prizes.every((row) => typeof row.left === 'number')
        && view.prizes.length === Config.REDEEM_PRIZES.length
        && Object.keys(view).includes('weights'),
        view.prizes.map((row) => `${row.short} ${row.left}`).join(' · '));
    rec('a wallet\u2019s spins are listed newest first',
        view.spins[0].code === second.code && view.spins.at(-1).code === win.code,
        `${view.spinCount} spins on the record`);
    rec('an unsigned address gets nothing at all',
        (await Redeem.redeemView('not an address')) === null,
        'redeemView(null)');

    // ----------------------------------------------------------------- the wiring
    section('The route, the page and the wiring between them');

    const route = read('app/api/points/redeem/route.js');
    const client = read('app/redeem/client.js');
    const css = read('public/css/redeem.css');
    rec('the API refuses anything that is not a spin, and needs a session first',
        /sessionFromRequest/.test(route) && /action !== 'spin'/.test(route)
        && /status: 401/.test(route),
        '401 without a session, 400 for another action');
    rec('the route never returns the pool — the only codes in an answer are the winner\u2019s',
        !/readPool|REDEEM_POOL/.test(route),
        'the route talks to spin() and redeemView(), nothing else');
    rec('the page never imports the server module, so no bundle can carry a pool',
        // The specifier has to *end* at `points-redeem`, because `points-redeem-reels` — the pure
        // rule module the page is supposed to import — begins with those characters. Plain
        // `/points-redeem/` failed on the correct tree and would have passed on nothing.
        !/['"][^'"]*\/points-redeem['"]/.test(client) && /points-config/.test(client),
        'config in, server out');
    rec('the browser asks for the state it needs and no more',
        /fetchRedeem/.test(client) && /requestSpin/.test(client)
        && /requestSpin/.test(read('lib/points-client.js')),
        'two helpers in points-client.js');

    // ------------------------------------------------------- held back, until it is turned on
    //
    // The wheel is finished and **unpublished** — a decision, not an unfinished state: it is where
    // points are spent and where a real gift card leaves the building, and a card with an empty
    // pool is a prize that cannot be paid. So the surface is asserted to be *off*, in every place
    // that could leak it, and `REDEEM_LIVE` is asserted to be the one thing that turns all of them
    // on together — a half-published wheel (a link with no route, a sitemap entry with no page) is
    // the failure this block exists to catch.
    const config = read('lib/points-config.js');
    const live = Config.REDEEM_LIVE;
    rec('the wheel is held back, and the switch says so in one place',
        live === false && /export const REDEEM_LIVE = false/.test(config),
        `REDEEM_LIVE = ${live}`);

    rec('so nothing on the apex reaches the page or its endpoint',
        Routing.classify('/redeem') === 'other'
        && Routing.classify('/api/points/redeem') === 'other'
        && Routing.decideRoute({
            isApp: true, kind: Routing.classify('/redeem'), pathname: '/redeem', passwordConfigured: true, gateAllowed: false,
        }).action === 'gate',
        'the game host still gates them; the apex redirects them, and `check-gate` asserts that');

    rec('the routing reads the switch rather than repeating the decision',
        /REDEEM_LIVE/.test(read('lib/app-routing.js'))
        && /\.\.\.\(REDEEM_LIVE \? \['\/redeem'\] : \[\]\)/.test(read('lib/app-routing.js'))
        && /HELD_BACK = REDEEM_LIVE \? \[\] : \['\/api\/points\/redeem'\]/.test(read('lib/app-routing.js')),
        'the page and its endpoint together, from the same constant');

    rec('and so do the sitemap and the Points footer link',
        /\.\.\.\(REDEEM_LIVE \? \[\{ path: '\/redeem'/.test(read('app/sitemap.js'))
        && /\{REDEEM_LIVE && \(/.test(read('app/points/client.js')),
        'a sitemap entry is a promise to a crawler; a link is a promise to a player');

    // Both halves of the pair, because a switch that only ever turns things on is a switch nobody
    // has tested off: these are the same two files, read for the *published* shape they carry.
    rec('and each one is a switch rather than a deletion — the published branch is still written',
        /\{ path: '\/redeem', priority: 0\.9, changeFrequency: 'weekly' \}/.test(read('app/sitemap.js'))
        && /href="\/redeem"/.test(read('app/points/client.js'))
        && /Redeem points/.test(read('app/points/client.js')),
        'flipping the constant publishes the link and the entry, with nothing else to edit');

    rec('the back arrow knows what to call it either way',
        Trail.backLabel('/redeem') === 'Redeem', Trail.backLabel('/redeem'));
    rec('the portfolio prints a spend as a minus, not as `+-1000`',
        /entry\.points < 0/.test(read('app/portfolio/client.js'))
        && /Math\.abs\(entry\.points\)/.test(read('app/portfolio/client.js'))
        && !/\+{fmtInt\(entry\.points\)/.test(read('app/portfolio/client.js'))
        && /\.pf-act-reward\.is-spend\s*\{/.test(read('public/css/portfolio.css')),
        'signed row, muted colour');

    // ----------------------------------------------------------------- the pictures
    section('The reels, which are knights');

    const faces = Config && Object.keys(Knights.KNIGHT_PFP);
    rec('the wheel turns on the same five portraits the roster uses',
        faces.length === 5 && faces.every((tier) => exists(path.join('public', Knights.KNIGHT_PFP[tier].replace(/^\/+/, '')))),
        faces.join(' '));
    rec('  … and it draws them from that one table rather than listing paths of its own',
        /KNIGHT_PFP/.test(read('lib/points-redeem-reels.js'))
        && !/\/assets\/pfp\//.test(client) && !/\/assets\/pfp\//.test(read('lib/points-redeem-reels.js')),
        'lib/knights.js is the source');
    rec('every outcome has a sentence to say and a name to file it under',
        Config.REDEEM_PRIZES.every((prize) => Config.REDEEM_OUTCOMES[prize].name && Config.REDEEM_OUTCOMES[prize].line)
        && Boolean(Config.REDEEM_OUTCOMES.tryAgain.line)
        && Config.REDEEM_PRIZES.every((prize) => RegExp(Config.REDEEM_OUTCOMES[prize].short, 'i').test(Config.REDEEM_OUTCOMES[prize].line)),
        Config.REDEEM_PRIZES.map((prize) => Config.REDEEM_OUTCOMES[prize].short).join(' · '));
    rec('no symbol on the strip names a card — the card is named under the reels',
        Reels.LIST.every((tile) => tile.kind === 'knight')
        && !/GOOGLE PLAY|AMAZON PAY|gift card/i.test(Reels.LIST.map((tile) => tile.label).join(' '))
        && !/prizeTile|redeem-tile-tag/.test(client),
        Reels.LIST.map((tile) => tile.label).join(' · '));
    rec('  … and the rule of the game lives where this file can run it, not in a client component',
        exists('lib/points-redeem-reels.js') && /points-redeem-reels/.test(client)
        && !/function landedKeys/.test(client),
        'lib/points-redeem-reels.js');

    // ------------------------------------------------------------------- the rule
    section('Three of a kind, which is the whole game');

    rec('a win lands the same portrait in all three columns, and nothing else',
        Config.REDEEM_PRIZES.every((prize) => {
            const keys = Reels.landedKeys(prize, { at: 1 });
            return keys.length === 3 && new Set(keys).size === 1
                && Reels.tileOf(keys[0])?.kind === 'knight' && Reels.threeOfAKind(keys);
        }),
        'both cards, three of a kind each');
    rec('  … and the winning face is one of the five, not a symbol reserved for paying',
        new Set([...Array(200).keys()].map((i) => Reels.landedKeys('amazon', { at: 1758800000000 + i * 7919 })[0])).size === Reels.TIERS.length,
        `all ${Reels.TIERS.length} tiers can land three times`);

    // The failure this exists for: three matching knights on a spin that paid nothing. Asserted over
    // a run of real timestamps *and* a sweep of every pair/oddreel residue, because a seed that
    // happens to be a multiple of something is exactly how this kind of bug ships.
    const seeds = [...Array(600).keys()].map((i) => 1758800000000 + i * 997)
        .concat([...Array(200).keys()].map((i) => i), [0, -1, NaN, undefined, null, 'x']);
    const losses = seeds.map((at) => ({ at, keys: Reels.landedKeys('tryAgain', { at }) }));
    const threeOfAKindLosses = losses.filter((row) => Reels.threeOfAKind(row.keys));
    rec('a loss is never three of a kind — no spin pays nothing and looks like it paid',
        threeOfAKindLosses.length === 0,
        `${losses.length} seeds, ${threeOfAKindLosses.length} look-alikes`);
    rec('  … and every loss is a pair with one odd reel, and every reel a knight',
        losses.every((row) => {
            const distinct = [...new Set(row.keys)];
            const counts = distinct.map((key) => row.keys.filter((k) => k === key).length).sort((a, b) => b - a);
            return distinct.length === 2 && counts[0] === 2 && counts[1] === 1
                && distinct.every((key) => Reels.tileOf(key)?.kind === 'knight');
        })
        && Reels.LIST.every((tile) => tile.kind === 'knight'),
        'two knights, one of them twice');
    rec('  … so the marquee\u2019s promise is exactly what the wheel can produce',
        /three of a kind/.test(Config.REDEEM_RULE) && /gift card/.test(Config.REDEEM_RULE)
        && Config.REDEEM_PRIZES.every((prize) => Reels.threeOfAKind(Reels.landedKeys(prize, { at: 42 })))
        && !Reels.threeOfAKind(Reels.landedKeys('tryAgain', { at: 42 })),
        Config.REDEEM_RULE);
    rec('the same spin replays onto the same tiles, and two spins differ',
        JSON.stringify(Reels.landedKeys('tryAgain', { at: 1758811222333 })) === JSON.stringify(Reels.landedKeys('tryAgain', { at: 1758811222333 }))
        && JSON.stringify(Reels.landedKeys('tryAgain', { at: 1758811222333 })) !== JSON.stringify(Reels.landedKeys('tryAgain', { at: 1758811222334 })),
        'seeded by the record, not by a second roll');
    rec('the heartbreak is on the last reel more often than not',
        losses.filter((row) => row.keys[2] !== row.keys[0]).length > losses.length / 3,
        `${losses.filter((row) => row.keys[2] !== row.keys[0]).length} of ${losses.length}`);
    rec('the payline is lit by the tiles, not by the answer that caused them',
        Reels.threeOfAKind(['prize-amazon', 'prize-amazon', 'prize-amazon'])
        && !Reels.threeOfAKind(['knight-RARE', 'knight-RARE', 'knight-COMMON'])
        && !Reels.threeOfAKind([null, null, null])
        && /threeOfAKind\(landed\)/.test(client) && /trio \?/.test(client),
        'the lights follow the reels');
    rec('a machine at rest shows three different knights, for the same reason',
        Reels.IDLE.length === 3 && new Set(Reels.IDLE).size === 3
        && Reels.IDLE.every((key) => Reels.tileOf(key)?.kind === 'knight'),
        Reels.IDLE.map((key) => Reels.tileOf(key).label).join(' · '));
    rec('and the cabinet has a payline to light',
        /\.redeem-payline/.test(css) && /is-win/.test(css) && /redeem-machine\.is-win/.test(client + css),
        'dim in motion, lit on three of a kind');
    rec('and the two lines Arya has for the wheel exist, with art that is on disk',
        /redeem_win:/.test(read('public/arya.js')) && /redeem_lose:/.test(read('public/arya.js'))
        && exists('public/assets/arya/arya-clear.png') && exists('public/assets/arya/arya-alarm.png'),
        'clear for a win, alarm for a miss');
    rec('the page is styled by a sheet of its own, and it is versioned',
        /\/css\/redeem\.css\?v=\d+/.test(client) && exists('public/css/redeem.css')
        && ['.redeem-reel', '.redeem-strip', '.redeem-tile', '.redeem-howto', '.redeem-codes', '.redeem-banner']
            .every((selector) => css.includes(selector)),
        'public/css/redeem.css');
    // The portraits in `assets/pfp` are all 512×512 and a reel is 132×104, so a percentage on both
    // axes of the face makes a 90×71 box and `object-fit: cover` quietly shaves the top and bottom
    // off the one thing on the page a player is meant to read. The first screenshots of `/redeem`
    // showed it: the horned knight's helm and the rarest knight's crest, both decapitated.
    const faceRule = (css.match(/\.redeem-tile img\s*\{([^}]*)\}/) || [, ''])[1];
    // Anchored to the start of a declaration, because `max-width: 94%` *contains* `width: 94%` —
    // matched loosely, the guard certified the very bug it was written to catch.
    const faceSays = (prop) => faceRule.split('\n')
        .some((line) => new RegExp(`^${prop}\\s*:\\s*\\d+%`).test(line.trim()));
    rec('the face box is square, so `cover` cannot crop the top off a knight',
        /aspect-ratio:\s*1\b/.test(faceRule) && !(faceSays('width') && faceSays('height')),
        'one `aspect-ratio`, not a percentage an axis');
    rec('the roll is decoration: with motion reduced, the reels simply rest on the drawn tile',
        /prefers-reduced-motion/.test(css) && /animation: none/.test(css),
        'no spin, same answer');
    rec('the instructions panel is four rows and comes from the config, not from markup',
        Config.REDEEM_HOWTO.length === 4 && /REDEEM_HOWTO/.test(client)
        && /amazon\.in/.test(Config.REDEEM_HOWTO[0].how) && /play\.google\.com\/redeem/.test(Config.REDEEM_HOWTO[1].how),
        Config.REDEEM_HOWTO.map((row) => row.what).join(' · '));

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
}
