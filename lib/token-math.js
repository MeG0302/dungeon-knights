/**
 * The $DNG economics, derived rather than retyped.
 *
 * Every number the project publishes about its own token is computed here from the tables
 * in code, so a figure cannot be right in one document and stale in another:
 *
 *   - `lib/knights.js` (`RARITY`) — the five tiers: roll probabilities, reward per clear,
 *     daily runs and hash power.
 *   - `lib/staking-config.js` — the Genesis hash-power distribution, the capsule types and
 *     the collection cap.
 *   - `lib/reward-config.js` — supply, distribution, the reference population, the four
 *     reward lines, the weekly budget and the epoch scale.
 *
 * `tools/check-token-math.js` asserts two things: that the arithmetic below is internally
 * sound, and that the three documents quote it. An earlier revision had all three of them
 * doing their own sums in prose, and they disagreed — a `d1000` roll with 1,010 faces, a
 * daily expectation three per cent low, and a reward table one document over from the one
 * the contracts paid. Nothing failed, because every one of those numbers lived in a
 * sentence. That is what this module exists to prevent.
 */

import { RARITY, expectedClearsPerDay, expectedHashPower, expectedRewardPerDay } from './knights.js';
import {
    CAPSULES_PER_WEEK, CAPSULE_TYPES, HASH_POWER_BANDS, KNIGHTS_REFERENCE_SIZE,
} from './staking-config.js';
import {
    DNG_SUPPLY, GENESIS_DAILY_CAPACITY, GENESIS_DAILY_RUNS, GENESIS_REWARD_PER_CLEAR,
    MIN_WEEKS, REWARD_VAULT_DNG, STAKING_SHARE_OF_DUNGEON, SUMMON_PRICE_DNG,
    capsuleBreakEvenMinted, capsuleFundingPerWeek, capsuleOpenPrice, dailyBudgetDng, economy,
    effectiveWeeklyBudget, fundingPerYearDng, genesisMaximumBurnPerDay, horizonDays,
    knightsMaximumBurnPerDay, knightsPayoutAtReference, lineBudgets, lineShares, referenceBurnPerDay,
    referenceLines, weeklyBudgetDng, worstCaseBurnPerDay,
} from './reward-config.js';
import { VAULT_ENTRY_TOTAL } from './points-config.js';

// --------------------------------------------------------------------- the tier table
export const REWARD_SLOTS = 5;

export const TIER_ECONOMY = Object.entries(RARITY).map(([key, tier], index) => ({
    index,
    key,
    name: tier.name,
    probability: tier.dropRate,
    rewardPerClear: tier.dungeonReward,
    dailyRuns: tier.dailyRuns,
    capacityPerDay: tier.dungeonReward * tier.dailyRuns,
    hashPower: tier.hashPower,
}));

export function probabilitySum() {
    return TIER_ECONOMY.reduce((sum, tier) => sum + tier.probability, 0);
}

/**
 * Look a tier up by its enum name, in either case.
 *
 * `TIER_ECONOMY[].key` stays in the on-chain enum's upper case (`COMMON` … `LEGENDARY`) because
 * that is the order and spelling the contracts index by; the capsule tables and prose use
 * lower case. Normalising here rather than storing a second spelling is what keeps one list.
 */
export function tier(key) {
    const wanted = String(key ?? '').toUpperCase();
    return TIER_ECONOMY.find((t) => t.key === wanted) || null;
}

// -------------------------------------------------------------------- the arithmetic
export function expectedRewardPerClear() {
    return TIER_ECONOMY.reduce((sum, t) => sum + t.probability * t.rewardPerClear, 0);
}

/**
 * `expectedRewardPerDay` and `expectedClearsPerDay` come straight from `lib/knights.js`,
 * where the table they are derived from lives — re-exported rather than recomputed, so there
 * is exactly one implementation of the sum.
 *
 * The daily figure is `Σ p · reward · runs`, a single weighted total. It is deliberately
 * **not** `E[reward/clear] x E[runs/day]`, which would say 99.0 instead of 92.8, because the
 * tiers that pay most also get the most runs: the two are correlated, and the product of the
 * averages is not the average of the product. The harness asserts that the two really do
 * differ, so staying with the weighted sum is a decision rather than an accident.
 */
export { expectedRewardPerDay, expectedClearsPerDay, expectedHashPower };

/** An alias for the same sum, named for how the documents quote it. */
export const expectedRunsPerDay = expectedClearsPerDay;

/** Clears to recoup a cost at a tier's per-clear reward. */
export function clearsToPayback(tierKey, costDng = SUMMON_PRICE_DNG) {
    const row = tier(tierKey);
    return row ? costDng / row.rewardPerClear : null;
}

export function expectedPaybackClears(costDng = SUMMON_PRICE_DNG) {
    return costDng / expectedRewardPerClear();
}

export function expectedPaybackDays(costDng = SUMMON_PRICE_DNG) {
    return costDng / expectedRewardPerDay();
}

// ------------------------------------------------------------------ the liability side
export function annualCapacity(tierKey) {
    const row = tier(tierKey);
    return row ? row.capacityPerDay * 365 : null;
}

export function annualCapacityPerKnight() {
    return expectedRewardPerDay() * 365;
}

export function knightYearsToDrainSupply() {
    return DNG_SUPPLY / annualCapacityPerKnight();
}

// ------------------------------------------------------------------- the Genesis path
export function genesisAnnualCapacityPerKnight() {
    return GENESIS_DAILY_CAPACITY * 365;
}

export function genesisKnightYearsToDrainSupply() {
    return DNG_SUPPLY / genesisAnnualCapacityPerKnight();
}

// ----------------------------------------------------------------------- the capsules
/**
 * What each capsule rung is worth, in DNG a day: `dungeonReward x dailyRuns` per outcome,
 * weighted by that rung's own odds. Every rung must raise the floor as well as the ceiling,
 * or a rarer capsule would not be a better one.
 */
export const CAPSULE_YIELDS = CAPSULE_TYPES.map((type) => ({
    key: type.key,
    name: type.name,
    expectedPerDay: type.odds.reduce((sum, row) => {
        const row_tier = tier(row.rarity);
        return sum + (row_tier ? row_tier.capacityPerDay * row.pct : 0) / 100;
    }, 0),
    floor: Math.min(...type.odds.map((row) => (tier(row.rarity)?.index ?? 99))),
}));

/**
 * The capsule faucet, now that opens are paid for.
 *
 * This is the number that made free capsules the project's largest unbudgeted liability:
 * 200 a week is 10,400 knights a year, and each one carries a full year of claim capacity.
 * Under a funded budget the liability does not disappear — extra knights still split the
 * lines — but it becomes *published*: the open price is a schedule against the collection's
 * size and the per-knight payout at any size is a computed figure rather than an open
 * question.
 *
 * **What it is not is bounded by a ceiling.** The collection has no supply limit, so
 * `perYear` is a rate and not an endpoint: at 200 a week this is 10,400 knights a year for
 * as long as the draw runs, and the two Knights lines divide among all of them. The field
 * that used to be called `cap` is `referenceSize` now, because it never was one — it is the
 * size the price ramp is stated against (`capsuleOpenPrice`).
 */
export function capsuleFaucet(minted = 0) {
    const perYear = CAPSULES_PER_WEEK * 52;
    const price = capsuleOpenPrice(minted);
    return {
        capsulesPerWeek: CAPSULES_PER_WEEK,
        openPriceAtThisSize: price,
        perYear,
        fundingPerWeek: capsuleFundingPerWeek(minted),
        breakEvenMinted: capsuleBreakEvenMinted(),
        capacityPerYear: perYear * annualCapacityPerKnight(),
        referenceSize: KNIGHTS_REFERENCE_SIZE,
    };
}

// ------------------------------------------------------------------ the staking 90%
/**
 * The realised staking-to-dungeon ratio for one Knight tier.
 *
 * Staking pays `0.9 x dungeon` **per collection**, not per tier, so an individual tier's
 * ratio depends on how its hash power compares to its earning power. Deriving hash power as
 * `capacity / 4` is what makes every tier come out at exactly 0.9; the old hand-typed table
 * did not, and the spread it produced is why it was replaced.
 */
export function knightStakingRatio(tierKey) {
    const row = tier(tierKey);
    if (!row) return null;
    const knightsDaily = expectedRewardPerDay();
    const knightsHash = expectedHashPower();
    return STAKING_SHARE_OF_DUNGEON * (knightsDaily / knightsHash) * (row.hashPower / row.capacityPerDay);
}

/**
 * The collection's mean hash power, taken from the band table itself rather than typed in.
 *
 * An earlier version of this function carried `630_320 / 1024` as a literal, which is the
 * right answer for the published bands and a stale one the moment a count moves — exactly
 * the class of number this module exists to stop repeating.
 */
export function genesisMeanHashPower() {
    const count = HASH_POWER_BANDS.reduce((sum, band) => sum + band.count, 0);
    const total = HASH_POWER_BANDS.reduce((sum, band) => sum + ((band.lo + band.hi) / 2) * band.count, 0);
    return total / count;
}

/**
 * The same ratio for a Genesis Knight at a given hash power.
 *
 * Genesis pays *flat* per clear, so an individual knight's ratio varies with its hash power
 * while the collection's average sits on 90%. That spread is deliberate — hash power is the
 * only thing that moves passive income — and it is published rather than hidden.
 */
export function genesisStakingRatio(hashPower) {
    return (STAKING_SHARE_OF_DUNGEON * hashPower) / genesisMeanHashPower();
}

/** The count-weighted mean across the published bands. Exactly 0.9, by construction. */
export function genesisWeightedStakingRatio() {
    const count = HASH_POWER_BANDS.reduce((sum, band) => sum + band.count, 0);
    return HASH_POWER_BANDS.reduce(
        (sum, band) => sum + band.count * genesisStakingRatio((band.lo + band.hi) / 2), 0,
    ) / count;
}

/** Band midpoints, so the published spread is stated in the collection's own labels. */
export function genesisBandStakingRatios() {
    return HASH_POWER_BANDS.map((band) => ({
        key: band.key,
        name: band.name,
        midpoint: (band.lo + band.hi) / 2,
        ratio: genesisStakingRatio((band.lo + band.hi) / 2),
    }));
}

// ------------------------------------------------------------------- the economy, v3
export {
    DNG_SUPPLY, GENESIS_DAILY_CAPACITY, GENESIS_DAILY_RUNS, GENESIS_REWARD_PER_CLEAR,
    KNIGHTS_REFERENCE_SIZE, MIN_WEEKS, REWARD_VAULT_DNG, STAKING_SHARE_OF_DUNGEON, SUMMON_PRICE_DNG,
    capsuleOpenPrice, dailyBudgetDng, effectiveWeeklyBudget, fundingPerYearDng, horizonDays,
    lineBudgets, lineShares, referenceBurnPerDay, referenceLines, weeklyBudgetDng,
    worstCaseBurnPerDay, knightsPayoutAtReference, capsuleBreakEvenMinted,
    genesisMaximumBurnPerDay, knightsMaximumBurnPerDay,
};

/** Every derived figure the documents quote, in one call. */
export function headline() {
    return {
        // the table
        tiers: TIER_ECONOMY.length,
        probabilitySum: probabilitySum(),
        expectedRewardPerClear: expectedRewardPerClear(),
        expectedRunsPerDay: expectedRunsPerDay(),
        expectedRewardPerDay: expectedRewardPerDay(),
        productOfAverages: expectedRewardPerClear() * expectedRunsPerDay(),
        expectedPaybackClears: expectedPaybackClears(),
        expectedPaybackDays: expectedPaybackDays(),
        annualCapacityPerKnight: annualCapacityPerKnight(),
        knightYearsToDrainSupply: knightYearsToDrainSupply(),

        // the Genesis path
        genesisRewardPerClear: GENESIS_REWARD_PER_CLEAR,
        genesisDailyRuns: GENESIS_DAILY_RUNS,
        genesisDailyCapacity: GENESIS_DAILY_CAPACITY,
        genesisAnnualCapacityPerKnight: genesisAnnualCapacityPerKnight(),
        genesisKnightYearsToDrainSupply: genesisKnightYearsToDrainSupply(),

        // the v3 budget
        supply: DNG_SUPPLY,
        rewardVault: REWARD_VAULT_DNG,
        summonPrice: SUMMON_PRICE_DNG,
        minWeeks: MIN_WEEKS,
        referenceBurnPerDay: referenceBurnPerDay(),
        weeklyBudget: weeklyBudgetDng(),
        lineShares: lineShares(),
        horizonDays: horizonDays(REWARD_VAULT_DNG),
        horizonYears: horizonDays(REWARD_VAULT_DNG) / 365,
        worstCaseBurnPerDay: worstCaseBurnPerDay(),
        worstCaseHorizonDays: horizonDays(REWARD_VAULT_DNG, worstCaseBurnPerDay()),
        fundingPerYear: fundingPerYearDng(),
        knightsPayoutAtReference: knightsPayoutAtReference(),
        knightsPayoutAtReferenceRatio: knightsPayoutAtReference().ratioOfReference,

        // the capsules
        capsulesPerWeek: CAPSULES_PER_WEEK,
        capsuleBreakEvenMinted: capsuleBreakEvenMinted(),
        capsuleOpenPriceAtZero: capsuleOpenPrice(0),
        capsuleOpenPriceAtReference: capsuleOpenPrice(KNIGHTS_REFERENCE_SIZE),
        capsuleYearsToFill: KNIGHTS_REFERENCE_SIZE / (CAPSULES_PER_WEEK * 52),
    };
}

// ------------------------------------------------------------------- the Points side
export function pointsPerDayMax() {
    return VAULT_ENTRY_TOTAL * 2;
}

// ------------------------------------------------------------------------- formatting
export const FMT = {
    dng1: (n) => Number(n).toFixed(1),
    dng2: (n) => Number(n).toFixed(2),
    int: (n) => Math.round(n).toLocaleString('en-US'),
    days: (n) => Number(n).toFixed(2),
    pct1: (n) => `${(Number(n) * 100).toFixed(1)}%`,
    pct2: (n) => `${(Number(n) * 100).toFixed(2)}%`,
};

/** The full economy object, for the API route and the page. */
export { economy };
