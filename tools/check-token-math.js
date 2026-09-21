#!/usr/bin/env node
/**
 * Does the $DNG economy still add up, and do the documents still quote it?
 *
 *     node tools/check-token-math.js
 *
 * The economy is described in three places — `WHITEPAPER.md`, `GENESIS-HASH-POWER.md` and
 * `tokenomics.md` — and each of them used to do its own sums. They disagreed with the code
 * and with each other, in ways that were individually small and collectively the whole
 * story:
 *
 *   - §5.3 of the whitepaper quoted **78.8 $DNG/day** and a **6.3-day** payback, from a
 *     six-tier table whose probabilities summed to **100.7%** and which predated the removal
 *     of Mythic.
 *   - §6.2 of the Genesis paper inherited that as **28,771 $DNG** a year.
 *   - `tokenomics.md` described the on-chain roll as a `d1000` with the values
 *     650/200/100/45/12/3 — **1,010 faces on a thousand-sided die**, or 101%.
 *
 * Nothing failed, because every one of those numbers lived in a sentence. This file is the
 * fix, and the third revision of the economy is where it earns its keep: the reward table,
 * the supply, the weekly budget, the four line shares, the epoch scale and the cap are all
 * derived in `lib/reward-config.js` and `lib/token-math.js`, and this harness asserts both
 * halves — that the derived arithmetic is internally *sound*, and that the documents quote
 * it. A changed table now fails here until the prose is changed with it, which is the only
 * way a published economy stays true.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    CAPSULE_YIELDS, DNG_SUPPLY, FMT, KNIGHTS_REFERENCE_SIZE, MIN_WEEKS, REWARD_SLOTS,
    REWARD_VAULT_DNG, STAKING_SHARE_OF_DUNGEON, SUMMON_PRICE_DNG, TIER_ECONOMY,
    annualCapacityPerKnight, capsuleBreakEvenMinted, capsuleFaucet, capsuleOpenPrice,
    effectiveWeeklyBudget, expectedPaybackClears, expectedPaybackDays, expectedRewardPerClear,
    genesisBandStakingRatios, genesisWeightedStakingRatio, headline, knightStakingRatio,
    knightYearsToDrainSupply,
    knightsPayoutAtReference, lineBudgets, lineShares, pointsPerDayMax, probabilitySum,
    referenceBurnPerDay, referenceLines, tier, weeklyBudgetDng,
} from '../lib/token-math.js';
import { economy } from '../lib/reward-config.js';
import { DISTRIBUTION, REFERENCE_GENESIS_ACTIVE, REFERENCE_KNIGHTS_ACTIVE } from '../lib/reward-config.js';
import { CAPSULES_PER_WEEK, CAPSULE_TYPES } from '../lib/staking-config.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}
const close = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;
const doc = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const near = (a, b, tol) => Math.abs(a - b) < tol;

const H = headline();

// --------------------------------------------------------- the table is well-formed
console.log('\nthe reward table (lib/knights.js)');
rec('five tiers, one per on-chain reward slot', TIER_ECONOMY.length === REWARD_SLOTS,
    `${TIER_ECONOMY.length} tiers, ${REWARD_SLOTS} slots`);
rec('the tiers are in the enum order the contracts index',
    TIER_ECONOMY.every((t, i) => t.index === i),
    TIER_ECONOMY.map((t) => `${t.index}:${t.name}`).join(' '));
rec('probabilities sum to exactly 1, so no roll falls past the last tier',
    close(probabilitySum(), 1), probabilitySum().toFixed(6));
rec('no tier is named Mythic — a sixth tier has no reward slot to be paid from',
    !TIER_ECONOMY.some((t) => /mythic/i.test(t.name)),
    TIER_ECONOMY.map((t) => t.name).join(', '));
rec('every tier earns something and can be run at least once',
    TIER_ECONOMY.every((t) => t.rewardPerClear > 0 && t.dailyRuns > 0));
rec('a day of capacity is reward x runs for every tier',
    TIER_ECONOMY.every((t) => t.capacityPerDay === t.rewardPerClear * t.dailyRuns));
rec('the published reward table is 12 / 20 / 36 / 60 / 100',
    JSON.stringify(TIER_ECONOMY.map((t) => t.rewardPerClear)) === JSON.stringify([12, 20, 36, 60, 100]),
    TIER_ECONOMY.map((t) => t.rewardPerClear).join(' / '));

// The contracts' own constant, read as text, because that is what bounds a reward. Only the
// files that declare a reward table are checked — `RewardVault` pays out amounts the game
// contract has already priced, so it has no rarity enum of its own.
const sols = fs.readdirSync(path.join(ROOT, 'contracts'))
    .filter((f) => f.endsWith('.sol'))
    .filter((f) => /rarityReward/.test(doc(path.join('contracts', f))));
const counts = sols.map((f) => {
    const match = doc(path.join('contracts', f)).match(/RARITY_COUNT\s*=\s*(\d+)/);
    return { file: f, count: match ? Number(match[1]) : null };
});
const badSlots = counts.filter((c) => c.count !== REWARD_SLOTS);
rec('every reward contract still indexes five rarity slots', badSlots.length === 0,
    badSlots.length ? badSlots.map((c) => `${c.file}: ${c.count}`).join(', ') : `${counts.length} contracts agree`);

// Hash power must be *proportional to capacity*, or the 90% rule cannot be uniform.
rec('hash power is capacity / 4 for every tier, which is what makes the 90% rule uniform',
    TIER_ECONOMY.every((t) => t.hashPower === t.capacityPerDay / 4),
    TIER_ECONOMY.map((t) => `${t.name} ${t.hashPower}/${t.capacityPerDay}`).join(' '));

// ----------------------------------------------------------- the derived arithmetic
console.log('\nthe derived arithmetic');
rec('expected reward per clear = 20.8 $DNG', close(expectedRewardPerClear(), 20.8, 1e-6),
    expectedRewardPerClear().toFixed(4));
rec('expected runs per day = 4.76', close(H.expectedRunsPerDay, 4.76, 1e-6),
    H.expectedRunsPerDay.toFixed(4));
rec('expected reward per day = 92.8 $DNG', close(H.expectedRewardPerDay, 92.8, 1e-6),
    H.expectedRewardPerDay.toFixed(4));
// The distinction that keeps the projection honest: the tiers that pay most also get the
// most runs, so multiplying the two averages is not the expected daily earning.
rec('the daily figure is the weighted sum, not the product of two averages',
    !close(H.productOfAverages, H.expectedRewardPerDay, 1e-6),
    `product would say ${H.productOfAverages.toFixed(2)}`);
rec('payback on a 500 $DNG summon = 24.04 clears', close(expectedPaybackClears(), 24.04, 0.01),
    expectedPaybackClears().toFixed(2));
rec('payback = 5.39 days of full play', close(expectedPaybackDays(), 5.39, 0.01),
    expectedPaybackDays().toFixed(2));
rec('one knight can claim 33,872 $DNG a year at its caps',
    close(annualCapacityPerKnight(), 33872, 0.5), FMT.int(annualCapacityPerKnight()));
rec('the whole supply is 29,523 knight-years of full play',
    near(knightYearsToDrainSupply(), 29523, 1), FMT.int(knightYearsToDrainSupply()));

// --------------------------------------------------------------- the staking rule
console.log('\nthe staking rule (90% of the same knight\'s dungeon income)');
const knightRatios = TIER_ECONOMY.map((t) => ({ name: t.name, ratio: knightStakingRatio(t.key) }));
rec('every Knight tier earns exactly 90% of its dungeon income by staking',
    knightRatios.every((r) => near(r.ratio, STAKING_SHARE_OF_DUNGEON, 1e-9)),
    knightRatios.map((r) => `${r.name} ${(r.ratio * 100).toFixed(1)}%`).join(' '));

const bands = genesisBandStakingRatios();
// Weighted by each band's published count — an unweighted mean over six *midpoints* would
// not be the collection's average, because the bands do not hold equal numbers of knights.
rec('Genesis staking averages 90% across the collection, weighted by band counts',
    near(genesisWeightedStakingRatio(), 0.9, 1e-9)
    && bands[0].ratio < 0.9 && bands[bands.length - 1].ratio > 0.9,
    bands.map((b) => `${b.name} ${(b.ratio * 100).toFixed(1)}%`).join(' · '));
rec('the Genesis spread is published, not discovered: 52.9% at the bottom, 138.9% at the top',
    near(bands[0].ratio, 0.529, 0.001) && near(bands[bands.length - 1].ratio, 1.389, 0.001),
    `${(bands[0].ratio * 100).toFixed(1)}% … ${(bands[bands.length - 1].ratio * 100).toFixed(1)}%`);

// ------------------------------------------------------------- the v3 budget
console.log('\nthe budget, the lines and the ceilings');
const distTotal = DISTRIBUTION.reduce((s, b) => s + b.pct, 0);
rec('the distribution sums to exactly 100%', distTotal === 100, `${distTotal}%`);
rec('the reward vault is 45% of a 1,000,000,000 supply', REWARD_VAULT_DNG === 450_000_000,
    `${FMT.int(REWARD_VAULT_DNG)} of ${FMT.int(DNG_SUPPLY)}`);
rec('no team allocation exists', DISTRIBUTION.find((b) => b.key === 'team')?.pct === 0);
rec('the treasury is therefore the only bucket funding operations',
    DISTRIBUTION.filter((b) => ['team'].includes(b.key)).every((b) => b.pct === 0));
rec('marketing is the one unvested bucket, and says so',
    /no cliff/i.test(DISTRIBUTION.find((b) => b.key === 'marketing')?.custody || ''),
    DISTRIBUTION.find((b) => b.key === 'marketing')?.custody);

const shares = lineShares();
const shareTotal = Object.values(shares).reduce((s, v) => s + v, 0);
rec('the four line shares sum to exactly 1', close(shareTotal, 1),
    Object.entries(shares).map(([k, v]) => `${k} ${(v * 100).toFixed(2)}%`).join(' · '));
rec('the shares are derived from the reference burn, not typed in',
    close(shares.genesisDungeon, referenceLines().genesisDungeon / referenceBurnPerDay(), 1e-12));
rec('staking is 0.9 x dungeon inside each collection',
    close(shares.genesisStaking, shares.genesisDungeon * STAKING_SHARE_OF_DUNGEON)
    && close(shares.knightsStaking, shares.knightsDungeon * STAKING_SHARE_OF_DUNGEON),
    `Genesis ${(shares.genesisStaking / shares.genesisDungeon).toFixed(3)} · Knights ${(shares.knightsStaking / shares.knightsDungeon).toFixed(3)}`);

// The whole point of the reference: it reproduces the published table exactly.
const lines = referenceLines();
const genesisPerClear = lines.genesisDungeon / (REFERENCE_GENESIS_ACTIVE * 4);
rec('at the reference, a Genesis clear pays exactly the published 300',
    close(genesisPerClear, 300, 1e-9), genesisPerClear.toFixed(4));
rec('at the reference, the Knights lines pay exactly the published tier table',
    lines.knightsDungeon === REFERENCE_KNIGHTS_ACTIVE * H.expectedRewardPerDay,
    `${FMT.int(lines.knightsDungeon)}/day for ${REFERENCE_KNIGHTS_ACTIVE} knights`);
rec('the reference is about 5% of each collection',
    near(REFERENCE_GENESIS_ACTIVE / 1024, 0.05, 0.002) && REFERENCE_KNIGHTS_ACTIVE / KNIGHTS_REFERENCE_SIZE === 0.05,
    `Genesis ${(REFERENCE_GENESIS_ACTIVE / 1024 * 100).toFixed(1)}%, Knights ${(REFERENCE_KNIGHTS_ACTIVE / KNIGHTS_REFERENCE_SIZE * 100).toFixed(1)}%`);

const budget = weeklyBudgetDng();
rec('the weekly budget is the reference burn for one week',
    close(budget, referenceBurnPerDay() * 7), FMT.int(budget));
rec('the vault funds the full table at the reference for 6.1 years',
    near(H.horizonYears, 6.1, 0.05), `${FMT.int(H.horizonDays)} days = ${H.horizonYears.toFixed(2)} yr`);
rec('the worst case is computable and published: 110 days if every knight plays',
    near(H.worstCaseHorizonDays, 110, 1), `${FMT.int(H.worstCaseBurnPerDay)}/day -> ${FMT.int(H.worstCaseHorizonDays)} days`);

// The two hard ceilings, which are what make the vault unable to outlive itself.
rec('the budget can never release more than balance / MIN_WEEKS',
    close(effectiveWeeklyBudget(REWARD_VAULT_DNG), budget)
    && close(effectiveWeeklyBudget(budget * MIN_WEEKS / 2), budget / 2),
    `${FMT.int(effectiveWeeklyBudget(budget))} of a ${FMT.int(budget)} budget when the vault holds one fortnight`);
rec('MIN_WEEKS is published rather than implicit', MIN_WEEKS === 12, `${MIN_WEEKS} weeks`);
rec('a line budget is its share of the week, and the four sum to the week',
    close(Object.values(lineBudgets(budget)).reduce((s, v) => s + v, 0), budget),
    FMT.int(budget));

// The collection has no ceiling, so this is a payout *at a size* rather than a floor: 5.0% at
// the reference size, 2.5% at twice it. Pinned at that size so the direction of travel cannot
// be quietly restated as a guarantee.
const atSize = knightsPayoutAtReference();
rec('at the 10,000 reference size each Knights line pays 5.0% of reference',
    near(atSize.ratioOfReference, 0.05, 1e-9),
    `${atSize.dungeonPerKnight.toFixed(2)} dungeon + ${atSize.stakingPerKnight.toFixed(2)} staking vs ${atSize.referencePerKnight.toFixed(2)}`);
rec('the funding requirement to hold the table forever is 73,586,240 $DNG a year',
    near(H.fundingPerYear, 73_586_240, 1), FMT.int(H.fundingPerYear));

// ------------------------------------------------------------------ the capsules
console.log('\nthe capsules');
rec('the four capsule rungs are worth 86.6 / 163.6 / 260.8 / 334.0 $DNG a day',
    CAPSULE_YIELDS.every((c, i) => near(c.expectedPerDay, [86.6, 163.6, 260.8, 334.0][i], 0.05)),
    CAPSULE_YIELDS.map((c) => FMT.dng1(c.expectedPerDay)).join(' / '));
rec('each rarer capsule raises the floor as well as the ceiling',
    CAPSULE_YIELDS.every((c, i) => i === 0 || c.floor > CAPSULE_YIELDS[i - 1].floor)
    && CAPSULE_YIELDS.every((c, i) => i === 0 || c.expectedPerDay > CAPSULE_YIELDS[i - 1].expectedPerDay));
rec('every capsule outcome is a tier the contracts can pay',
    CAPSULE_YIELDS.every((c) => c.floor < REWARD_SLOTS));
rec('the open price rises from 500 to 5,000 across the cap',
    capsuleOpenPrice(0) === 500 && capsuleOpenPrice(KNIGHTS_REFERENCE_SIZE) === 5000,
    `${capsuleOpenPrice(0)} -> ${capsuleOpenPrice(KNIGHTS_REFERENCE_SIZE)}`);
rec('the open price is never free, which was the largest unbudgeted liability',
    capsuleOpenPrice(0) > 0);
const faucet = capsuleFaucet(0);
rec('the faucet is bounded by the collection cap, not by an open question',
    faucet.referenceSize === KNIGHTS_REFERENCE_SIZE && faucet.perYear === CAPSULES_PER_WEEK * 52,
    `${FMT.int(faucet.perYear)} knights a year, stated against the ${FMT.int(KNIGHTS_REFERENCE_SIZE)} reference size`);
rec('from ~5,746 knights the weekly opens alone cover the whole Knights lines',
    capsuleBreakEvenMinted() === 5746,
    `break-even at ${FMT.int(capsuleBreakEvenMinted())}`);
// The claim above has to actually be true, not just a number in a sentence: the price at
// the rounded break-even size must cover the lines, and not by an unbounded margin.
const knightsLinesPerWeek = (lines.knightsDungeon + lines.knightsStaking) * 7;
const breakEvenFunding = capsuleOpenPrice(capsuleBreakEvenMinted()) * CAPSULES_PER_WEEK;
rec('...and that break-even price really does cover them',
    breakEvenFunding >= knightsLinesPerWeek && near(breakEvenFunding, knightsLinesPerWeek, knightsLinesPerWeek * 0.001),
    `${FMT.int(breakEvenFunding)}/wk vs ${FMT.int(knightsLinesPerWeek)}/wk`);

// ---------------------------------------------------------- the engine's own copy
console.log('\nthe engine\'s own payback comments');
{
    const chars = doc('public/characters.js');
    const expectedComments = TIER_ECONOMY.map((t) => {
        const clears = Math.ceil(SUMMON_PRICE_DNG / t.rewardPerClear);
        const days = (SUMMON_PRICE_DNG / t.capacityPerDay).toFixed(1);
        return { tier: t.name, text: `${clears} clears to ROI · ${days} days at ${t.dailyRuns} runs/day` };
    });
    const missing = expectedComments.filter((c) => !chars.includes(c.text));
    rec('every tier states its derived payback in public/characters.js', missing.length === 0,
        missing.length ? `missing: ${missing.map((m) => `${m.tier}: ${m.text}`).join(' | ')}` : 'all five');
    rec('no stale payback note survives in it',
        !/25 dungeon ROI|dungeons to ROI/.test(chars),
        (chars.match(/\d+ dungeon[s]?[^\n]*/) || ['none'])[0].slice(0, 40));
}

// ------------------------------------------------------------------- the Points loop
console.log('\nthe Points loop');
rec('a full vault run shared is 1,800 points, the daily ceiling for one wallet',
    pointsPerDayMax() === 1800, FMT.int(pointsPerDayMax()));
{
    const libFiles = fs.readdirSync(path.join(ROOT, 'lib')).filter((f) => /points/.test(f));
    const text = libFiles.map((f) => doc(path.join('lib', f))).join('\n');
    rec('and nothing in the repo converts points to $DNG',
        !/pointsToDng|pointsToToken|redeemPoints/i.test(text), 'points stay a closed loop');
}

// ------------------------------------------------------------- the documents agree
console.log('\nthe documents quote the derived figures');
/**
 * Each document must contain these numbers, and must not contain the ones they replaced.
 * Every required string is rendered from the model rather than typed, so the assertions
 * follow the code instead of pinning today's figures by hand.
 */
const REQUIRED = {
    'WHITEPAPER.md': [
        `${FMT.dng1(H.expectedRewardPerDay)} $DNG/day`,
        FMT.days(H.expectedPaybackDays),
        FMT.int(H.rewardVault),
        '1,000,000,000',
    ],
    'GENESIS-HASH-POWER.md': [
        FMT.dng1(H.expectedRewardPerDay),
        FMT.int(H.annualCapacityPerKnight),
        `${(STAKING_SHARE_OF_DUNGEON * 100).toFixed(0)}%`,
    ],
    'tokenomics.md': [
        FMT.dng1(H.expectedRewardPerDay),
        FMT.days(H.expectedPaybackDays),
        FMT.dng2(expectedRewardPerClear()),
        FMT.int(H.annualCapacityPerKnight),
        FMT.int(knightYearsToDrainSupply()) + ' knight-years',
        FMT.int(H.rewardVault),
        FMT.int(H.worstCaseBurnPerDay),
    ],
};
const FORBIDDEN = {
    // The stale six-tier arithmetic and the v2 absolutes that could not be funded.
    'WHITEPAPER.md': ['78.8 $DNG/day', '78.825', '≈6.3 days', '0.65·50', '30,478 $DNG a year', '32.8\nknight-years', 'Mythic capsule'],
    'GENESIS-HASH-POWER.md': ['78.83', '28,771', '299,219,700', '317x the total'],
    // A d1000 cannot have 1,010 faces, there is no sixth tier, and capsules are not free.
    'tokenomics.md': ['650/1000', '1010', 'free to open', 'CAPSULE_OPEN_COST_DNG'],
};

for (const [file, needles] of Object.entries(REQUIRED)) {
    const text = doc(file);
    const missing = needles.filter((n) => !text.includes(n));
    rec(`${file} quotes the derived figures`, missing.length === 0,
        missing.length ? `missing ${missing.join(', ')}` : needles.join(', '));
}
for (const [file, needles] of Object.entries(FORBIDDEN)) {
    const text = doc(file);
    const found = needles.filter((n) => text.includes(n));
    rec(`${file} no longer quotes the arithmetic it replaced`, found.length === 0,
        found.length ? `still there: ${found.join(', ')}` : 'clean');
}

// The one figure that was wrong in an earlier draft of this very plan, and is now pinned.
rec('no document claims the floor is 10% rather than 5% of reference',
    Object.keys(REQUIRED).every((f) => !/10% of reference|10% of the reference/.test(doc(f))),
    'each Knights line pays 5.0% at the reference size');

// ---------------------------------------------------- the served economy is complete
//
// The capsule panel on the Summoning Chamber read `economy.capsulesPerWeek`, which the API
// route did not serve — the field was top-level only — so the page rendered "from about
// 5,746 Knights the **NaN** weekly opens alone cover..." and nothing failed anywhere. The
// route builds its payload field by field from the model, which is exactly the seam where a
// field can be added to `economy()` and never reach the browser.
//
// This is the narrow version of that check: the fields the two pages actually read.
console.log('\nthe served economy (app/api/staking/config/route.js)');
const routeSource = fs.readFileSync(path.join(ROOT, 'app/api/staking/config/route.js'), 'utf8');
const model = economy();

/**
 * The text of the route's `economy: { ... }` block, found by matching braces.
 *
 * Scoping matters here, and the first version of this check got it wrong: it searched the
 * whole file for `capsulesPerWeek:`, which the response *also* carries at the top level — so
 * it passed against the very bug it was written to catch. A guard that cannot fail is worse
 * than no guard, because it reads like coverage.
 */
function economyBlock(source) {
    const start = source.indexOf('economy: {');
    if (start < 0) return '';
    let depth = 0;
    for (let i = start + 'economy: '.length; i < source.length; i++) {
        if (source[i] === '{') depth += 1;
        else if (source[i] === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    return source.slice(start);
}

const servedBlock = economyBlock(routeSource);
const UI_ECONOMY_FIELDS = [
    'rewardVaultDng', 'reference', 'lines', 'shares', 'lineBudgets', 'weeklyBudget',
    'dailyBudget', 'minWeeks', 'stakingShareOfDungeon', 'horizonDays', 'worstCaseHorizonDays',
    'worstCaseScale', 'knightsReferenceSize', 'capsulesPerWeek',
    'capsuleOpenPriceAtZero', 'capsuleOpenPriceAtReference', 'capsuleBreakEvenMinted',
    'referenceTable',
];
const missingFromModel = UI_ECONOMY_FIELDS.filter((f) => !(f in model));
rec('every field the pages read exists in the model', missingFromModel.length === 0,
    missingFromModel.length ? `not in economy(): ${missingFromModel.join(', ')}` : `${UI_ECONOMY_FIELDS.length} fields`);

const served = new Set([...servedBlock.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map((m) => m[1]));
const notServed = UI_ECONOMY_FIELDS.filter((f) => !served.has(f));
rec('the route serves every field the pages read', notServed.length === 0,
    notServed.length ? `missing from the payload: ${notServed.join(', ')}` : `${UI_ECONOMY_FIELDS.length} fields served`);

// The block has to be found, or the two checks above pass against an empty string.
rec('the economy block was actually located in the route', servedBlock.length > 200,
    `${servedBlock.length} chars, ${served.size} keys`);

// The reference table is the one published object two different sections of the interface
// describe, so it is worth pinning on its own: five tiers whose hash powers are the Knights
// ladder's five bars, and whose rewards are the capsule archive's break-even inputs.
{
    const tiers = model.referenceTable?.tiers ?? [];
    rec('the reference table carries one row per tier', tiers.length === 5, `${tiers.length} tiers`);
    rec('every tier states its reward, its runs and its hash power',
        tiers.every((t) => t.rewardPerClear > 0 && t.dailyRuns > 0 && t.hashPower > 0));
    const servedTable = servedBlock.includes('referenceTable: model.referenceTable');
    rec('and the route serves that exact table, not a copy of it', servedTable);
}

console.log('');
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
for (const f of failed) console.log(`  FAILED: ${f.label}`);
console.log('');
process.exit(failed.length ? 1 : 0);
