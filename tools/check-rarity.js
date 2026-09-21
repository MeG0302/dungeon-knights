#!/usr/bin/env node
/**
 * Is there still exactly one rarity economy?
 *
 *     node tools/check-rarity.js
 *
 * The same five tiers were once written down in four places — `public/config.js`,
 * `public/characters.js`, `lib/knights.js` and the constructor of every reward contract —
 * and they had already drifted apart. The mint page advertised six tiers ending in
 * Mythic at 0.3%; the engine rolled five, and because `rollRarity()` accumulates those
 * `dropRate`s and falls through to `Common` for anything past the last entry, the sixth
 * tier could not be rolled at all. A player was being sold odds the game did not honour.
 *
 * Nothing here needs a browser or a chain: `config.js` and `characters.js` are loaded into
 * a throwaway `vm` context with a stub `window`, and the contracts are read as text. What
 * is being pinned down:
 *
 *   - all four tables name the same five tiers, in the on-chain enum's order
 *   - they agree on every field a player can see (odds, multiplier, colour, reward, cap)
 *   - the odds sum to exactly 1, so no roll can fall past the last tier
 *   - each contract's `rarityReward`/`dailyCap` defaults match the tier at the same index
 *   - `Mythic` does not exist anywhere in the economy
 *   - every tier's artwork actually resolves, and the mint page has the container its
 *     odds table is drawn into (otherwise the whole table silently disappears)
 */

import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { RARITY, knightPortrait } from '../lib/knights.js';
import { CAPSULE_TYPES, HASH_POWER_BANDS } from '../lib/staking-config.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

// ---------------------------------------------------------------- browser-ish sandbox
function loadBrowserScripts(...files) {
    const noop = () => {};
    const fakeEl = {
        style: {}, dataset: {}, classList: { add: noop, remove: noop },
        addEventListener: noop, appendChild: noop, setAttribute: noop,
        querySelector: () => null, querySelectorAll: () => [],
    };
    const document = {
        createElement: () => ({ ...fakeEl }),
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: noop,
        head: fakeEl,
        body: fakeEl,
    };
    const window = {
        document,
        localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
        location: { href: 'http://localhost/' },
        addEventListener: noop,
    };
    window.window = window;

    const context = vm.createContext({
        window, document, console: { log: noop, warn: noop, error: noop },
        Math, JSON, Date, Number, String, Object, Array, setTimeout, clearTimeout,
    });

    for (const file of files) {
        vm.runInContext(fs.readFileSync(path.join(PUBLIC, file), 'utf8'), context, { filename: file });
    }
    return window;
}

// ------------------------------------------------------------------- contract reading
function contractEconomy(file) {
    const sol = fs.readFileSync(path.join(ROOT, 'contracts', file), 'utf8');
    const index = (pattern) => {
        const table = [];
        for (const [, i, value] of sol.matchAll(pattern)) table[Number(i)] = Number(value);
        return table;
    };
    return {
        file,
        rarityCount: Number(/RARITY_COUNT\s*=\s*(\d+)/.exec(sol)[1]),
        // `10 ether` is 10 DNG at 18 decimals; the tier table stores plain DNG.
        rewards: index(/rarityReward\[(\d+)\]\s*=\s*(\d+)\s*ether/g),
        caps: index(/dailyCap\[(\d+)\]\s*=\s*(\d+)/g),
    };
}

const CONTRACTS = [
    'DungeonKnightsGameV2.sol',
    'DungeonKnightsGameV3.sol',
    'DungeonKnightsGameV3.1-RewardsOnly.sol',
    'DungeonKnightsGameV3-Simple.sol',
    'DungeonKnightsGameV4.sol',
].map(contractEconomy);

// ---------------------------------------------------------------------------- assertions
const window = loadBrowserScripts('config.js', 'characters.js');
const config = window.RARITY_CONFIG || {};
const tiers = window.RARITY_TIERS || [];
const engine = window.RARITY || {};
const page = window.DUNGEON_CONFIG;

const ON_CHAIN = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'];

// Derived from the shared table rather than typed, so this harness cannot disagree with
// `lib/knights.js` about the economy it is supposed to be pinning.
const EXPECTED_REWARDS = ON_CHAIN.map((t) => RARITY[t].dungeonReward);
const EXPECTED_CAPS = ON_CHAIN.map((t) => RARITY[t].dailyRuns);
const EXPECTED_HASH = ON_CHAIN.map((t) => RARITY[t].hashPower);

/**
 * The contracts whose tables are *not* the published one, and why.
 *
 * All four are history: V2 and the two V3s were superseded, and `V3-Simple` is what is
 * deployed on testnet today. Their sources are deliberately left describing what they were
 * written with rather than being edited to match the plan, because a repo whose contract
 * source disagrees with the bytecode it produced is worse than one that admits the gap — and
 * rewriting a drained contract's reward table would be rewriting history.
 *
 * The published table (12 / 20 / 36 / 60 / 100, and the third-revision economy around it)
 * takes effect with `DungeonKnightsGameV4`, which is why V4 alone is asserted against it and
 * why this file also checks that the divergence is written down in the whitepaper.
 */
const LEGACY_TABLE = { rewards: [10, 17, 30, 75, 150], caps: [5, 5, 4, 3, 4] };
const LEGACY = [
    'DungeonKnightsGameV2.sol',
    'DungeonKnightsGameV3.sol',
    'DungeonKnightsGameV3.1-RewardsOnly.sol',
    'DungeonKnightsGameV3-Simple.sol',
];
const CANDIDATE = 'DungeonKnightsGameV4.sol';
/** The one deployed address, named so the whitepaper check below cannot drift from it. */
const DEPLOYED_LEGACY = { file: 'DungeonKnightsGameV3-Simple.sol', ...LEGACY_TABLE };

console.log('');
console.log('One economy, four places');

rec('config.js declares the five on-chain tiers, in enum order',
    JSON.stringify(tiers) === JSON.stringify(ON_CHAIN.map((t) => t.toLowerCase())),
    tiers.join(' → '));

rec('the engine (characters.js) knows the same five',
    JSON.stringify(Object.keys(engine)) === JSON.stringify(ON_CHAIN),
    Object.keys(engine).join(', '));

rec('lib/knights.js knows the same five',
    JSON.stringify(Object.keys(RARITY)) === JSON.stringify(ON_CHAIN),
    Object.keys(RARITY).join(', '));

// Hash power is only consistent across the three tables if it is a function of capacity;
// a hand-typed set (5/8/15/40/100 once was) breaks the 90% staking rule this way.
rec('hash power is capacity / 4 in every published table',
    ON_CHAIN.every((t) => RARITY[t].hashPower === RARITY[t].dungeonReward * RARITY[t].dailyRuns / 4),
    ON_CHAIN.map((t) => `${RARITY[t].hashPower}`).join('/'));
rec('the engine and the page carry the same hash power as the shared table',
    ON_CHAIN.every((t) => engine[t]?.hashPower === RARITY[t].hashPower
        && config[t.toLowerCase()]?.hashPower === RARITY[t].hashPower),
    ON_CHAIN.map((t) => `${engine[t]?.hashPower}/${config[t.toLowerCase()]?.hashPower}`).join(' '));

const economyText = ['config.js', 'characters.js']
    .map((f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8'))
    .concat(fs.readFileSync(path.join(ROOT, 'lib', 'knights.js'), 'utf8'))
    .join('\n');
rec('no Mythic tier survives in the economy',
    !/mythic/i.test(economyText),
    /mythic/i.test(economyText) ? 'still mentioned in a rarity table' : 'config, engine and React helpers are clean');

console.log('');
console.log('Every field agrees across the three tables');

for (const tier of ON_CHAIN) {
    const key = tier.toLowerCase();
    const fromConfig = config[key] || {};
    const fromEngine = engine[tier] || {};
    const fromLib = RARITY[tier] || {};

    const fields = ['name', 'multiplier', 'color', 'dropRate', 'dungeonReward', 'dailyRuns', 'hashPower'];
    const mismatched = fields.filter((field) =>
        fromConfig[field] !== fromEngine[field] || fromConfig[field] !== fromLib[field]);

    rec(`${tier}: ${fields.join(', ')}`,
        mismatched.length === 0,
        mismatched.length
            ? mismatched.map((f) => `${f} ${fromConfig[f]} / ${fromEngine[f]} / ${fromLib[f]}`).join(', ')
            : `${fromConfig.name}, ${fromConfig.dungeonReward} DNG, ${fromConfig.dailyRuns} runs/day`);
}

const odds = tiers.reduce((sum, t) => sum + config[t].dropRate, 0);
rec('the odds sum to exactly 1, so no roll falls past the last tier',
    Math.abs(odds - 1) < 1e-9,
    `${tiers.map((t) => `${config[t].name} ${(config[t].dropRate * 100).toFixed(0)}%`).join(' + ')} = ${(odds * 100).toFixed(2)}%`);

console.log('');
console.log('The contracts pay what the page advertises');

for (const contract of CONTRACTS) {
    const isLegacy = LEGACY.includes(contract.file);
    const wantRewards = isLegacy ? LEGACY_TABLE.rewards : EXPECTED_REWARDS;
    const wantCaps = isLegacy ? LEGACY_TABLE.caps : EXPECTED_CAPS;
    const sameTierCount = contract.rarityCount === ON_CHAIN.length;
    const rewardsMatch = contract.rewards.every((value, i) => value === wantRewards[i]);
    const capsMatch = contract.caps.every((value, i) => value === wantCaps[i]);
    const pass = sameTierCount && rewardsMatch && capsMatch;
    const what = isLegacy ? 'the historical table' : 'the published table';

    rec(`${contract.file}: RARITY_COUNT, rewards and caps — ${what}`, pass,
        pass
            ? `${contract.rarityCount} tiers, ${contract.rewards.join('/')} DNG, ${contract.caps.join('/')} runs`
            : `RARITY_COUNT ${contract.rarityCount}, rewards ${contract.rewards.join('/')} `
              + `(want ${wantRewards.join('/')}), caps ${contract.caps.join('/')} `
              + `(want ${wantCaps.join('/')})`);
}

// The published table is what the site advertises, so the contract that will pay it has to
// carry it. A candidate that quietly kept the old numbers would make the mint page a lie.
{
    const candidate = CONTRACTS.find((c) => c.file === CANDIDATE);
    rec('the deployment candidate (V4) is asserted against the published table, not a legacy one',
        JSON.stringify(candidate.rewards) === JSON.stringify(EXPECTED_REWARDS)
        && JSON.stringify(candidate.caps) === JSON.stringify(EXPECTED_CAPS),
        `${candidate.rewards.join('/')} DNG, ${candidate.caps.join('/')} runs`);
}

// And the gap between the plan and the chain has to be written down, because on testnet the
// live contract still pays the older table until V4 is deployed.
{
    const white = fs.readFileSync(path.join(ROOT, 'WHITEPAPER.md'), 'utf8');
    rec('the deployed-vs-published divergence is recorded in the whitepaper',
        white.includes(DEPLOYED_LEGACY.rewards.join(' / '))
        || white.includes(DEPLOYED_LEGACY.rewards.join('/')),
        white.includes('10/17/30/75/150') || white.includes('10 / 17 / 30 / 75 / 150')
            ? 'the live table is named'
            : 'WHITEPAPER.md must name the table the deployed contract still pays');
}

rec('config.js reports the rewards in the contract\'s index order',
    JSON.stringify(page.getRarityRewards()) === JSON.stringify(EXPECTED_REWARDS),
    page.getRarityRewards().join(' / '));

const weighted = tiers.reduce((sum, t) => sum + config[t].dungeonReward * config[t].dropRate, 0);
rec('the expected DNG per run is the drop-rate weighted sum, quoted to the player',
    Math.abs(page.averageDungeonReward() - weighted) < 1e-9,
    `${page.averageDungeonReward().toFixed(2)} DNG per clear`);

console.log('');
console.log('The art and the placeholder are there');

for (const tier of tiers) {
    const image = path.join(PUBLIC, config[tier].image);
    rec(`${tier}: the card art resolves`, fs.existsSync(image),
        fs.existsSync(image) ? config[tier].image : `missing: ${config[tier].image}`);
}

// The dungeon draws its own copy of this table (it is a page script, not a module), so it
// has to be checked against the config rather than assumed to follow it.
const dungeonJs = fs.readFileSync(path.join(PUBLIC, 'dungeon.js'), 'utf8');
const staleArt = tiers.filter((t) => !dungeonJs.includes(config[t].image));
rec('the dungeon draws the same knight for each tier', staleArt.length === 0,
    staleArt.length
        ? `dungeon.js still maps ${staleArt.join(', ')} to other art`
        : `${tiers.length} tiers agree with config.js`);
rec('the dungeon has no art for a tier that cannot be rolled',
    !/'(MYTHIC)'\s*:/.test(dungeonJs),
    /'(MYTHIC)'\s*:/.test(dungeonJs) ? "dungeon.js still loads a MYTHIC knight" : 'no phantom tier');

// ------------------------------------------------------------------- the portraits
// A tier now carries two pictures: `image` is the sprite the map draws, `pfp` the portrait the
// screens that *list* knights draw (the Hall's roster, the Summoning Chamber, the vault). The
// four checks below are the whole contract of that split: the files exist, the modules agree
// about which one is which, the pages that list knights use the portrait, and the map does not.

console.log('');
console.log('Two pictures per tier, and each one used where it belongs');

for (const tier of tiers) {
    const pfp = config[tier].pfp;
    const onDisk = pfp && fs.existsSync(path.join(PUBLIC, pfp));
    rec(`${tier}: the portrait resolves`, !!onDisk,
        onDisk ? pfp : pfp ? `missing: ${pfp}` : 'no pfp for this tier');
}

const knightsLib = fs.readFileSync(path.join(ROOT, 'lib', 'knights.js'), 'utf8');
const libDisagrees = tiers.filter((t) => !knightsLib.includes(config[t].pfp));
rec('lib/knights.js and config.js name the same portrait for every tier', libDisagrees.length === 0,
    libDisagrees.length
        ? `lib/knights.js disagrees on ${libDisagrees.join(', ')}`
        : `${tiers.length} tiers agree`);
rec('and the Genesis collection has a portrait of its own, which is a real file',
    /GENESIS_PFP = '([^']+)'/.test(knightsLib)
    && fs.existsSync(path.join(PUBLIC, knightsLib.match(/GENESIS_PFP = '([^']+)'/)[1])),
    knightsLib.match(/GENESIS_PFP = '([^']+)'/)?.[1] || 'GENESIS_PFP is not defined');

// The pages that *list* knights. A page that quietly went back to `image` would still render a
// knight — just the wrong one, on the screen the split exists for — so it is checked by name.
const menuJs = fs.readFileSync(path.join(PUBLIC, 'menu.js'), 'utf8');
rec('the Knight’s Hall roster shows the portrait', /\.pfp\s*\|\|\s*[^)]*\.image/.test(menuJs),
    /\.pfp\s*\|\|/.test(menuJs) ? 'menu.js reads entry.pfp' : 'menu.js still reads entry.image');
const mintJs = fs.readFileSync(path.join(PUBLIC, 'mint-page.js'), 'utf8');
rec('the Summoning Chamber shows the portrait', /rarityConfig\.pfp/.test(mintJs)
    && !/<img src="\$\{rarityConfig\.image\}"/.test(mintJs),
    /rarityConfig\.pfp/.test(mintJs) ? 'mint-page.js reads rarityConfig.pfp' : 'mint-page.js still reads rarityConfig.image');

// Which picture a *record* wears, which is the decision the vault makes on every card and the one
// place the two sides genuinely differ: Genesis has no tiers, a Knight does.
const legendaryPortrait = knightPortrait({ rarity: 'legendary' }, true);
rec('a tiered Knight is drawn with its own tier’s portrait',
    legendaryPortrait === config.legendary.pfp, legendaryPortrait || 'null');
rec('a Genesis Knight is drawn with the collection’s portrait',
    knightPortrait({}, false) === knightsLib.match(/GENESIS_PFP = '([^']+)'/)[1],
    knightPortrait({}, false));
rec('and a Knight whose tier did not come back falls back rather than inventing one',
    knightPortrait({}, true) === null && knightPortrait({ rarity: 'mythic' }, true) === null,
    'null → the drawn glyph');

// And the rule the split exists to protect: the map is not a gallery. If the dungeon ever draws
// a portrait, the sprite in `image` has become dead weight and the tileset is unreadable at 32px.
//
// Swept across *every* page script rather than the handful that draw the map today, because the
// failure mode is a new file quietly reaching for the portrait — config.js is the table that
// names them, and menu.js/mint-page.js are the two screens allowed to show one.
const PFP_PAGES = new Set(['config.js', 'menu.js', 'mint-page.js']);
const pageScripts = [
    ...fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.js')),
    ...['js/core'].flatMap((d) => (fs.existsSync(path.join(PUBLIC, d))
        ? fs.readdirSync(path.join(PUBLIC, d)).filter((f) => f.endsWith('.js')).map((f) => `${d}/${f}`)
        : [])),
];
const portraitsElsewhere = pageScripts.filter((f) => !PFP_PAGES.has(f)
    && /assets\/pfp\//.test(fs.readFileSync(path.join(PUBLIC, f), 'utf8')));
rec('the dungeon still draws the sprite, not the portrait', portraitsElsewhere.length === 0,
    portraitsElsewhere.length
        ? `${portraitsElsewhere.join(', ')} draws a portrait on the map`
        : `${pageScripts.length} page scripts swept, portraits confined to the roster and the Chamber`);

// dungeon-session.js used to carry its own copy of the ladder, commented "matches V3/V4
// contracts". It is the one place that reads the rarity *enum* off the chain and indexes
// by it, so drift there misstates a real payout. It must read the config instead.
const sessionJs = fs.readFileSync(path.join(PUBLIC, 'dungeon-session.js'), 'utf8');
rec('the run session reads the ladder from config rather than keeping a copy',
    sessionJs.includes('getRarityRewards()') && !/\[\s*10\s*,\s*17\s*,/.test(sessionJs),
    /\[\s*10\s*,\s*17\s*,/.test(sessionJs)
        ? 'dungeon-session.js still inlines a reward ladder'
        : 'dungeon-session.js → config.getRarityRewards()');

// The old fallback was `knightIds.length * 15` — a magic number that disagreed with the
// drop-rate weighted average the rest of the UI quotes (19.10 DNG).
const bareAverage = /return\s+knightIds\.length\s*\*\s*\d/.test(sessionJs);
rec('the session derives its average from config instead of hard-coding one',
    !bareAverage && sessionJs.includes('averageKnightReward()')
        && sessionJs.includes('averageDungeonReward()'),
    bareAverage
        ? 'dungeon-session.js still returns knightIds.length * <literal>'
        : 'averageKnightReward() → config.averageDungeonReward()');

// Same guard for every other page script, so a fourth copy cannot quietly appear. Built
// from EXPECTED_REWARDS, so it follows the economy instead of pinning today's numbers.
const ladderLiteral = new RegExp(`\\[\\s*${EXPECTED_REWARDS.join('\\s*,\\s*')}\\s*\\]`);
const inlinedLadders = ['config.js', 'characters.js', 'dungeon.js', 'game.js', 'ui.js', 'menu.js',
    'mint-page.js', 'dungeon-session.js']
    .filter((f) => ladderLiteral.test(fs.readFileSync(path.join(PUBLIC, f), 'utf8')));
rec('no page script inlines the reward ladder', inlinedLadders.length === 0,
    inlinedLadders.length
        ? `${inlinedLadders.join(', ')} carries a literal [${EXPECTED_REWARDS.join(', ')}]`
        : `${EXPECTED_REWARDS.length} rewards, one home`);

const theme = fs.readFileSync(path.join(PUBLIC, 'theme.css'), 'utf8');
const missingDots = tiers.filter((t) => !theme.includes(`.dot-${t} `));
rec('every tier has a swatch for the odds table', missingDots.length === 0,
    missingDots.length ? `no rule for .dot-${missingDots.join(', .dot-')}` : `${tiers.length} swatches`);

const staticPages = fs.readFileSync(path.join(ROOT, 'lib', 'static-pages.js'), 'utf8');

// ----------------------------------------------------------------- the hall art
//
// The Knight's Hall and the Summoning Chamber carry the map art behind their right-hand
// panel, and it is asserted here for the same reason the portraits are: the rule is *where*
// the picture is allowed to appear, and that is invisible from any single file. The panel
// class lives in `lib/static-pages.js`, the picture and its scrim in `theme.css`, and the
// two have to agree or the panel is simply its old flat colour.
const HALL_ART = ['knight-hall', 'summon-hall'];
const missingArt = HALL_ART.flatMap((name) => [`${name}.webp`, `${name}-mobile.webp`])
    .filter((file) => !fs.existsSync(path.join(PUBLIC, 'assets', 'hall', file)));
rec('both halls have their art, at both sizes', missingArt.length === 0,
    missingArt.length
        ? `missing: ${missingArt.join(', ')}`
        : 'knight-hall / summon-hall, desktop and phone variants');

const countOf = (needle) => staticPages.split(needle).length - 1;
const knightAt = staticPages.indexOf('hall-bg-knight');
const summonAt = staticPages.indexOf('hall-bg-summon');
rec('the Knight’s Hall panel is the one that gets the hall art',
    knightAt > staticPages.indexOf('RIGHT: Knight Roster')
    && knightAt - staticPages.indexOf('RIGHT: Knight Roster') < 220,
    knightAt === -1 ? 'no panel carries it' : 'on the roster panel');
rec('the Summoning Chamber gets the summon art',
    summonAt > staticPages.indexOf('RIGHT: Knights Gallery')
    && summonAt - staticPages.indexOf('RIGHT: Knights Gallery') < 220,
    summonAt === -1 ? 'no panel carries it' : 'on the gallery panel');
rec('and neither is worn by a third panel', countOf('hall-bg-knight') === 1 && countOf('hall-bg-summon') === 1,
    `${countOf('hall-bg-knight')} knight / ${countOf('hall-bg-summon')} summon`);

const artInCss = HALL_ART.flatMap((name) => [`${name}.webp`, `${name}-mobile.webp`])
    .filter((file) => !theme.includes(`/assets/hall/${file}`));
rec('theme.css resolves every one of them', artInCss.length === 0,
    artInCss.length ? `not referenced: ${artInCss.join(', ')}` : 'four files, four references');

// The phone variant swaps over at the same width the mobile sheets use, so the art and the
// layout change together rather than the picture arriving early or late.
const mobileBreak = /@media \(max-width: (\d+)px\)/.exec(
    fs.readFileSync(path.join(PUBLIC, 'menu-mobile.css'), 'utf8'),
);
const themeMobile = theme.slice(theme.indexOf('@media (max-width: 860px)'));
rec('the phone art swaps at the breakpoint the mobile sheets use',
    !!mobileBreak && mobileBreak[1] === '860'
    && themeMobile.includes('knight-hall-mobile.webp') && themeMobile.includes('summon-hall-mobile.webp'),
    `mobile sheets: ${mobileBreak ? mobileBreak[1] : '?'}px, hall art: ${themeMobile.includes('knight-hall-mobile.webp') ? 'same block' : 'no phone variant'}`);

// The art is presented by CSS and chosen by the page, never injected by a script — a background
// set from JS is one refactor away from appearing on the map.
const artFromScripts = pageScripts.filter((f) => /assets\/hall\//.test(fs.readFileSync(path.join(PUBLIC, f), 'utf8')));
rec('no page script paints it', artFromScripts.length === 0,
    artFromScripts.length ? `${artFromScripts.join(', ')} references the hall art` : 'CSS only');
rec('the Summoning Chamber has the container its odds are drawn into',
    staticPages.includes('id=\\"rarityChances\\"') && staticPages.includes('id=\\"cost-per-knight\\"'),
    !staticPages.includes('id=\\"rarityChances\\"')
        ? 'mint-page.js would render the table into nothing'
        : 'rarityChances + cost-per-knight present');

const mintPrice = page.getMintPrice();
rec('the mint price comes from the config, not a literal in the controller',
    Number.isFinite(mintPrice) && mintPrice > 0,
    `${mintPrice} DNG on ${page.getCurrentNetwork()}`);

console.log('');
console.log('The Staking Vault may only hand out tiers the contracts can pay');

// A capsule mints a knight, so its outcomes are bounded by the same five slots. The spec's
// fourth capsule was named after a Mythic tier that has no reward slot — the one place the
// phantom tier could have come back.
const tierIndex = new Map(ON_CHAIN.map((tier, i) => [tier, i]));
const outcomeIndex = (row) => tierIndex.get(String(row.rarity).toUpperCase());

const unpayable = [];
for (const capsule of CAPSULE_TYPES) {
    for (const row of capsule.odds) {
        if (outcomeIndex(row) === undefined) unpayable.push(`${capsule.name} → ${row.rarity}`);
    }
}
rec('every capsule outcome is a tier the reward contracts pay', unpayable.length === 0,
    unpayable.length ? `no reward slot for: ${unpayable.join(', ')}` : `${CAPSULE_TYPES.length} capsules, all payable`);

for (const capsule of CAPSULE_TYPES) {
    const total = capsule.odds.reduce((sum, row) => sum + row.pct, 0);
    rec(`${capsule.name} odds sum to exactly 100`, total === 100, `${total}%`);
}

// A rung is only worth more if it raises the floor, so the floors have to climb.
const floors = CAPSULE_TYPES.map((c) => Math.min(...c.odds.map(outcomeIndex)));
const floorsClimb = floors.every((floor, i) => i === 0 || floor > floors[i - 1]);
rec('each rarer capsule raises the floor', floorsClimb,
    floorsClimb
        ? CAPSULE_TYPES.map((c, i) => `${c.name.split(' ')[0]}: ${ON_CHAIN[floors[i]]}`).join(' → ')
        : `floors are ${floors.join(', ')}`);

// `dungeonReward x dailyRuns` is a knight's earning power, so it is what a capsule is worth.
const yieldOf = (tier) => config[tier].dungeonReward * config[tier].dailyRuns;
const expected = CAPSULE_TYPES.map((c) =>
    c.odds.reduce((sum, row) => sum + (yieldOf(String(row.rarity).toLowerCase()) * row.pct) / 100, 0));
const yieldsClimb = expected.every((value, i) => i === 0 || value > expected[i - 1]);
rec('each rarer capsule is worth more to a player', yieldsClimb,
    CAPSULE_TYPES.map((c, i) => `${c.name.split(' ')[0]} ${expected[i].toFixed(1)}`).join(' → ') + ' DNG/day');

// The capsule's own label is a colour key in the UI, so it must name something real.
const bandKeys = HASH_POWER_BANDS.map((b) => b.key);
const badLabels = CAPSULE_TYPES
    .filter((c) => !tierIndex.has(String(c.rarity).toUpperCase()) && !bandKeys.includes(c.rarity))
    .map((c) => `${c.name}: ${c.rarity}`);
rec('every capsule label names a tier or a published band', badLabels.length === 0,
    badLabels.length ? badLabels.join(', ') : CAPSULE_TYPES.map((c) => c.rarity).join(', '));

// ------------------------------------------------- the served pages count the tiers too
//
// The landing hero draws a stat card whose number is a literal: `<div>6</div>` over
// `<div>RARITIES</div>`. It went on saying **6** for a while after Mythic was removed, and
// nothing caught it — the served bodies are machine-written strings inside
// `lib/static-pages.js`, so no compiler sees them and no harness was reading them. It is the
// one place on the live site that advertised a sixth tier.
const pages = (await import('../lib/static-pages.js')).STATIC_PAGES;
const tierCount = Object.keys(RARITY).length;
const claims = [];
for (const [key, page] of Object.entries(pages)) {
    const body = page?.body || '';
    for (const match of body.matchAll(/>\s*(\d+)\s*<\/div>\s*<div[^>]*>\s*RARITIES\s*<\/div>/gi)) {
        if (Number(match[1]) !== tierCount) claims.push(`${key} says ${match[1]}`);
    }
    // Prose counts are the other way this drifts.
    for (const pattern of [/six rarity/i, /six tiers?/i, /6 rarity tiers/i]) {
        if (pattern.test(body)) claims.push(`${key}: "${body.match(pattern)[0]}"`);
    }
}
rec('no served page advertises a tier count the economy does not have',
    claims.length === 0,
    claims.length ? claims.join(', ') : `${tierCount} tiers everywhere`);

// The same literal is drawn on every page that has the card, so this must actually match
// something — a regex that stops matching would otherwise pass silently forever.
const cardsFound = Object.values(pages)
    .filter((page) => />\s*\d+\s*<\/div>\s*<div[^>]*>\s*RARITIES\s*<\/div>/i.test(page?.body || '')).length;
rec('and the tier-count card was actually found to check', cardsFound > 0, `${cardsFound} page(s)`);

console.log('');
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
for (const f of failed) console.log(`  FAILED: ${f.label}`);
console.log('');
process.exit(failed.length ? 1 : 0);
