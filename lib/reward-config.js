/**
 * The $DNG economy, third revision.
 *
 * The first two revisions published **absolute reward promises** — "a Legendary clear pays
 * 100 DNG, a Genesis clear pays 300" — and never bounded the total. The bound was the token
 * supply, and it did not fit: at those rates the whole 1,000,000 supply was 29.5 knight-years
 * of play, and all 1,024 Genesis Knights playing for a single day would have claimed 123% of
 * it. Nothing in the design said what would happen when more players arrived than the table
 * had been sized for, because nothing in the design could.
 *
 * This revision fixes that with one idea: **a funded weekly budget, a reference table, and a
 * scale**. The vault releases `W` per week; four lines partition it; every payout is
 * `table x epochScale`. When the vault is thin or the crowd is large, one scale moves every
 * published number down together, so the *relationships* the project promises — the tier
 * ratios, the 90% staking rule, the split between the two collections — survive at whatever
 * level is actually fundable. Absolute numbers are published for the week; the ratios are
 * permanent.
 *
 * Two things are worth understanding before changing a number here.
 *
 * **Why the reference population matters.** It is what sets `W`, and therefore the whole
 * scale of the economy. At a reference of 250 Genesis and 1,000 Knights the published table
 * would only have been affordable for 1.3 years on a 1,000,000,000 vault. At 5% of each
 * collection it is affordable for 6.1 years, with the same table and the same vault. The
 * reference is published precisely because it is the honest way to state which population
 * the table is sized for: *the full table is payable to about 5% of each collection playing
 * daily, and above that the scale falls in proportion.*
 *
 * **Why the staking lines are ratios, not amounts.** 90% of dungeon income was the requested
 * rule, and stating it as `staking = 0.9 x dungeon` inside each collection is what makes it
 * true at every participation level rather than only at the one used to size it. At matched
 * participation both ratios come out at exactly 90.0%; when the two diverge — everyone
 * stakes and nobody plays — the realised ratio moves and the interface shows it, which is
 * the honest behaviour rather than a hidden one.
 *
 * Kept free of storage and browser imports, like `points-config.js` and `staking-config.js`,
 * so the page, the API route, the contracts' deployment inputs and the Node harness all read
 * exactly these numbers. `tools/check-token-math.js` asserts them against the documents.
 */

import { RARITY, expectedClearsPerDay, expectedRewardPerDay } from './knights.js';
import { CAPSULES_PER_WEEK, KNIGHTS_REFERENCE_SIZE } from './staking-config.js';

// ------------------------------------------------------------------- the token
export const DNG_SUPPLY = 1_000_000_000;
export const DNG_DECIMALS = 18;

/**
 * Where the supply goes. Two deliberate choices, both of which have to be published rather
 * than discovered:
 *
 *   - **No team allocation at all.** The 15% treasury is therefore the only bucket funding
 *     operations and development, which is worth saying out loud so it is not a surprise
 *     when someone looks for the team vesting schedule and finds there isn't one.
 *   - **Marketing is not cliffed or vested.** It is consequently the one bucket that can
 *     reach the market freely from day one. Since there is no lock to point at, the spend
 *     cadence has to be disclosed instead — see `WHITEPAPER.md` §5.2.
 */
export const DISTRIBUTION = [
    { key: 'reward', name: 'Reward vault', pct: 45, custody: 'RewardVault, spent on claims' },
    { key: 'liquidity', name: 'Liquidity', pct: 30, custody: 'DEX LP, 12-month LP lock' },
    { key: 'treasury', name: 'Treasury', pct: 15, custody: 'Multisig, quarterly release' },
    { key: 'marketing', name: 'Marketing / community', pct: 10, custody: 'Multisig, no cliff, no vesting' },
    { key: 'team', name: 'Team', pct: 0, custody: 'none' },
];

export function distributionDng(key) {
    const bucket = DISTRIBUTION.find((b) => b.key === key);
    return bucket ? (DNG_SUPPLY * bucket.pct) / 100 : null;
}

/** The one bucket that gets spent, and therefore the only real bound on the reward table. */
export const REWARD_VAULT_PCT = 45;
export const REWARD_VAULT_DNG = distributionDng('reward');

/** A summon still costs the same 500 $DNG it always did — it is the funding gate. */
export const SUMMON_PRICE_DNG = 500;

// -------------------------------------------------------------- the Genesis rewards
/** Flat, so every Genesis Knight is equally valuable for *playing*. Hash power moves its
 * *passive* income only, which is the whole point of the collection's design. */
export const GENESIS_REWARD_PER_CLEAR = 300;
export const GENESIS_DAILY_RUNS = 4;
export const GENESIS_DAILY_CAPACITY = GENESIS_REWARD_PER_CLEAR * GENESIS_DAILY_RUNS;

/**
 * The hour the daily run caps roll over, in UTC.
 *
 * It is `RESET_HOUR_UTC` in both game contracts and the `12` inside their
 * `currentDayIndex()`, so a claim at 11:59 and one at 12:01 are a day apart — the cap is a
 * lunchtime boundary rather than a midnight one. It lives here, next to the caps it
 * governs and in a module the pitch deck already imports, because the deck prints it:
 * `tools/check-run-budget.js` reads this, `public/run-budget.js`'s browser copy and the
 * contract's own constant, and fails if the three ever disagree.
 */
export const GAME_RESET_HOUR_UTC = 12;

// ------------------------------------------------------------------ the reference week
/**
 * The population the published table is sized for: **about 5% of each collection playing on
 * a given day.** Deliberately stated as a utilisation of each collection rather than as a
 * headcount, so it stays meaningful as the Knights collection grows toward its cap.
 */
export const REFERENCE_GENESIS_ACTIVE = 50;
export const REFERENCE_KNIGHTS_ACTIVE = 500;

export const REFERENCE_UTILISATION = {
    genesis: REFERENCE_GENESIS_ACTIVE / 1024,
    knights: REFERENCE_KNIGHTS_ACTIVE / KNIGHTS_REFERENCE_SIZE,
};

/** Staking pays 90% of what playing does, per collection — the requested rule. */
export const STAKING_SHARE_OF_DUNGEON = 0.9;

/**
 * How long the vault must stay funded at its current budget. The budget is capped by
 * `balance / MIN_WEEKS`, so the vault can never outlive itself and no bug can drain it in a
 * week — which is the second of the two hard ceilings (the first being the weekly budget
 * itself).
 */
export const MIN_WEEKS = 12;

/**
 * The four lines, at the reference population, in DNG per day.
 *
 * This is the *derivation* of the partition, not a second opinion about it: the shares in
 * `lineShares()` are these numbers divided by their total, which is why reproducing the
 * published table and reproducing the partition are the same act.
 */
export function referenceLines() {
    const genesisDungeon = REFERENCE_GENESIS_ACTIVE * GENESIS_DAILY_RUNS * GENESIS_REWARD_PER_CLEAR;
    const knightsDungeon = REFERENCE_KNIGHTS_ACTIVE * expectedRewardPerDay();
    return {
        genesisDungeon,
        genesisStaking: genesisDungeon * STAKING_SHARE_OF_DUNGEON,
        knightsDungeon,
        knightsStaking: knightsDungeon * STAKING_SHARE_OF_DUNGEON,
    };
}

export function referenceBurnPerDay() {
    const lines = referenceLines();
    return lines.genesisDungeon + lines.genesisStaking + lines.knightsDungeon + lines.knightsStaking;
}

/** Each line's fraction of the weekly budget. Sums to exactly 1. */
export function lineShares() {
    const lines = referenceLines();
    const total = referenceBurnPerDay();
    return {
        genesisDungeon: lines.genesisDungeon / total,
        genesisStaking: lines.genesisStaking / total,
        knightsDungeon: lines.knightsDungeon / total,
        knightsStaking: lines.knightsStaking / total,
    };
}

/**
 * What each line is actually paid per week, out of a given budget.
 *
 * `budgetDng` defaults to the configured weekly budget, so the API and the page agree
 * without either of them re-doing the split.
 */
export function lineBudgets(budgetDng = weeklyBudgetDng()) {
    const shares = lineShares();
    return Object.fromEntries(
        Object.entries(shares).map(([key, share]) => [key, share * budgetDng]),
    );
}

/** The lines in the order the vault's constructor takes them. */
export const LINE_ORDER = ['genesisDungeon', 'genesisStaking', 'knightsDungeon', 'knightsStaking'];

/**
 * The line shares in basis points, for `RewardVault`'s constructor.
 *
 * Rounded with the largest-remainder method so the four values sum to exactly 10,000 — the
 * vault rejects anything else — while no line moves more than a basis point from its
 * derived share. Derived rather than typed, for the same reason as everything else here:
 * a hand-written 2968/2671/2295/2066 would be right today and stale the moment the
 * reference moved.
 */
export function lineBps() {
    const shares = lineShares();
    const raw = LINE_ORDER.map((key) => shares[key] * 10_000);
    const values = raw.map(Math.floor);
    let remainder = 10_000 - values.reduce((sum, v) => sum + v, 0);
    const byFraction = raw
        .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
        .sort((a, b) => b.fraction - a.fraction);
    for (let n = 0; n < remainder; n++) values[byFraction[n].index] += 1;
    return values;
}

// ------------------------------------------------------------------------ the budget
export const WEEK_DAYS = 7;

/** The budget the table is sized for: the reference burn, one week of it. */
export function weeklyBudgetDng() {
    return referenceBurnPerDay() * WEEK_DAYS;
}

export function dailyBudgetDng() {
    return referenceBurnPerDay();
}

/**
 * The most the vault may release this week without shortening its own runway below
 * `MIN_WEEKS`. This is the ceiling that makes "the vault cannot promise what it does not
 * hold" a contract invariant instead of an intention.
 */
export function maximumWeeklyBudget(vaultBalanceDng, minWeeks = MIN_WEEKS) {
    if (!Number.isFinite(vaultBalanceDng) || vaultBalanceDng <= 0) return 0;
    return vaultBalanceDng / minWeeks;
}

/** `min(configured, balance / MIN_WEEKS)` — the effective budget for this week. */
export function effectiveWeeklyBudget(vaultBalanceDng, configured = weeklyBudgetDng()) {
    return Math.min(configured, maximumWeeklyBudget(vaultBalanceDng));
}

/** Days the vault lasts at a given daily burn. */
export function horizonDays(balanceDng, burnPerDay = referenceBurnPerDay()) {
    if (!Number.isFinite(balanceDng) || balanceDng <= 0 || !burnPerDay) return 0;
    return balanceDng / burnPerDay;
}

// ------------------------------------------------------------------- the epoch scale
/**
 * One scale, settled weekly from the burn the last week actually produced:
 *
 *     epochScale = min(1, budget / lastWeekBurn)
 *
 * Capped at 1 on purpose — the published table is the **maximum**, never exceeded. When
 * participation falls the lines simply go under-spent and the vault lengthens its own
 * runway, which is the behaviour a funded pool should have. When participation rises above
 * the reference, the scale falls and every payout moves down by the same factor, so the tier
 * ratios and the 90% rule stay exactly as published.
 */
export function epochScale(lastWeekBurnDng, budgetDng = weeklyBudgetDng()) {
    if (!Number.isFinite(lastWeekBurnDng) || lastWeekBurnDng <= 0) return 1;
    if (!Number.isFinite(budgetDng) || budgetDng <= 0) return 0;
    return Math.min(1, budgetDng / lastWeekBurnDng);
}

/** The table scaled for the week. Every published figure is `table x scale`. */
export function scaled(tableDng, scale = 1) {
    return tableDng * scale;
}

// --------------------------------------------------------------- the worst case
/** Every Genesis Knight playing and staking. */
export function genesisMaximumBurnPerDay() {
    const dungeon = 1024 * GENESIS_DAILY_CAPACITY;
    return dungeon * (1 + STAKING_SHARE_OF_DUNGEON);
}

/**
 * Every Knight playing and staking, at a given collection size.
 *
 * This is the one figure in the file that **cannot be worst-cased**, and it is worth saying
 * so where it is computed. Genesis is fixed at 1,024, so its maximum burn is a number; the
 * Knights collection is unlimited, so `knightsMaximumBurnPerDay()` has no maximum at all —
 * it takes a size and answers for that size. `worstCaseBurnPerDay()` therefore answers
 * "every Genesis Knight plus this many Knights", and the size it passes is the reference
 * size, not a ceiling the collection can never cross.
 */
export function knightsMaximumBurnPerDay(size = KNIGHTS_REFERENCE_SIZE) {
    const dungeon = size * expectedRewardPerDay();
    return dungeon * (1 + STAKING_SHARE_OF_DUNGEON);
}

/**
 * Daily burn with every Genesis Knight plus `size` Knights playing and staking.
 *
 * Not a true worst case — see `knightsMaximumBurnPerDay`. For the Knights side it is a
 * *scenario*, and the interface labels it as one.
 */
export function worstCaseBurnPerDay(size = KNIGHTS_REFERENCE_SIZE) {
    return genesisMaximumBurnPerDay() + knightsMaximumBurnPerDay(size);
}

/**
 * What one Knight earns per day at a given collection size, at the reference budget.
 *
 * Both Knights lines are fixed shares of the budget, so a growing collection divides them
 * among more knights: at the reference size a Knight earns exactly
 * `REFERENCE_KNIGHTS_ACTIVE / KNIGHTS_REFERENCE_SIZE` of what it earns while the population
 * is at the reference — **5.0%** — and at twice that size, 2.5%. There is no floor to
 * quote, because there is no ceiling: the ratio is a function of the size and this returns
 * it for the size asked about.
 *
 * An earlier draft of this plan quoted "10% of reference", which compared the *combined*
 * dungeon-and-staking line against dungeon-only earnings and so doubled the denominator.
 * The two lines are returned separately for that reason, and the harness pins each one, so
 * the mistake cannot come back through a change of basis.
 */
export function knightsPayoutAtReference(size = KNIGHTS_REFERENCE_SIZE) {
    const lines = referenceLines();
    const dungeonPerKnight = lines.knightsDungeon / size;
    const stakingPerKnight = lines.knightsStaking / size;
    const referencePerKnight = (expectedRewardPerDay() * (1 + STAKING_SHARE_OF_DUNGEON));
    return {
        dungeonPerKnight,
        stakingPerKnight,
        totalPerKnight: dungeonPerKnight + stakingPerKnight,
        referencePerKnight,
        ratioOfReference: (dungeonPerKnight + stakingPerKnight) / referencePerKnight,
    };
}

// ------------------------------------------------------------------ sizes and prices
/** The size the Knights side is stated against. A reference point, never a limit. */
export { KNIGHTS_REFERENCE_SIZE };

/** Capsules handed out per weekly draw. */
export { CAPSULES_PER_WEEK };

/**
 * Capsules open for a rising price rather than a fixed one.
 *
 * A flat fee cannot price a growing collection: at 200 capsules a week the Knights
 * population compounds ~20% a week early on while a 500-DNG open funds about 2% of the
 * budget, so per-Knight payouts fall roughly ten-fold a year. The linear ramp runs
 * 500 -> 5,000 across the reference size, and the crossover is worth knowing because it is
 * the point from which the faucet funds itself: **from roughly 5,700 Knights on, the 200
 * weekly opens alone cover the whole Knights lines.**
 *
 * **Flat above the reference size**, which matters now that the collection has no ceiling:
 * the ramp is a schedule against size, not a price that can keep climbing, so the 5,000 DNG
 * top is also the price of the ten-thousandth knight and of the hundred-thousandth. The
 * consequence is stated rather than hidden — an open costs the same once the collection is
 * past the reference while every knight earns less, which is exactly the pressure a growing
 * supply is supposed to feel.
 */
export function capsuleOpenPrice(minted, referenceSize = KNIGHTS_REFERENCE_SIZE) {
    const base = 500;
    const top = 5000;
    const filled = Math.min(1, Math.max(0, (Number(minted) || 0) / referenceSize));
    return base + (top - base) * filled;
}

/** DNG the open fee puts into the vault each week, at a given collection size. */
export function capsuleFundingPerWeek(minted, opensPerWeek = CAPSULES_PER_WEEK) {
    return capsuleOpenPrice(minted) * opensPerWeek;
}

/** The collection size at which the weekly opens cover the Knights lines outright. */
export function capsuleBreakEvenMinted() {
    const lines = referenceLines();
    const knightsLinesPerWeek = (lines.knightsDungeon + lines.knightsStaking) * WEEK_DAYS;
    const priceNeeded = knightsLinesPerWeek / CAPSULES_PER_WEEK;
    const span = 5000 - 500;
    return Math.round(((priceNeeded - 500) / span) * KNIGHTS_REFERENCE_SIZE);
}

// ------------------------------------------------------------------- the funding test
/** What the project must put into the vault each year to hold the table at scale 1. */
export function fundingPerYearDng() {
    return weeklyBudgetDng() * 52;
}

// ------------------------------------------------------------------------- the summary
/**
 * Everything above, in one object. The API route, the page and the harness all start here,
 * so a number cannot be right in one of them and stale in another.
 */
export function economy() {
    const lines = referenceLines();
    const shares = lineShares();
    const budget = weeklyBudgetDng();
    return {
        supply: DNG_SUPPLY,
        decimals: DNG_DECIMALS,
        distribution: DISTRIBUTION,
        rewardVaultDng: REWARD_VAULT_DNG,
        summonPriceDng: SUMMON_PRICE_DNG,

        reference: {
            genesisActive: REFERENCE_GENESIS_ACTIVE,
            knightsActive: REFERENCE_KNIGHTS_ACTIVE,
            utilisation: REFERENCE_UTILISATION,
        },
        lines,
        shares,
        lineBudgets: lineBudgets(budget),
        weeklyBudget: budget,
        dailyBudget: referenceBurnPerDay(),
        minWeeks: MIN_WEEKS,
        stakingShareOfDungeon: STAKING_SHARE_OF_DUNGEON,

        horizonDays: horizonDays(REWARD_VAULT_DNG),
        worstCaseBurnPerDay: worstCaseBurnPerDay(),
        worstCaseHorizonDays: horizonDays(REWARD_VAULT_DNG, worstCaseBurnPerDay()),
        worstCaseScale: epochScale(worstCaseBurnPerDay(), budget),
        knightsPayoutAtReference: knightsPayoutAtReference(),
        fundingPerYear: fundingPerYearDng(),

        lineBps: lineBps(),
        knightsReferenceSize: KNIGHTS_REFERENCE_SIZE,
        capsulesPerWeek: CAPSULES_PER_WEEK,
        capsuleOpenPriceAtZero: capsuleOpenPrice(0),
        capsuleOpenPriceAtReference: capsuleOpenPrice(KNIGHTS_REFERENCE_SIZE),
        capsuleBreakEvenMinted: capsuleBreakEvenMinted(),

        genesisRewardPerClear: GENESIS_REWARD_PER_CLEAR,
        genesisDailyRuns: GENESIS_DAILY_RUNS,

        // The published table itself, served rather than left as a model function with no
        // reader. The Knights ladder draws one row per tier with its hash power, and this is
        // the only copy of that table a client can be checked against — without it the ladder
        // could drift from the model and every harness would still pass.
        referenceTable: referenceTable(),
    };
}

/** The published reference table — what a clear pays at scale 1.0. */
export function referenceTable() {
    return {
        genesis: GENESIS_REWARD_PER_CLEAR,
        tiers: Object.entries(RARITY).map(([key, tier]) => ({
            key,
            name: tier.name,
            rewardPerClear: tier.dungeonReward,
            dailyRuns: tier.dailyRuns,
            hashPower: tier.hashPower,
        })),
        knightsExpectedPerDay: expectedRewardPerDay(),
        knightsExpectedClearsPerDay: expectedClearsPerDay(),
    };
}
