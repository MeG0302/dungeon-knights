/**
 * The Staking Vault's rules, in one place.
 *
 * Free of storage and browser imports on purpose, like `points-config.js`: the page, the
 * API routes and the Node harness all read exactly these numbers, so they cannot disagree
 * about what a staked knight earns. When the tokenomics land, the pool is set here (or by
 * the `WEEKLY_POOL_DNG` env var) and nothing else has to move.
 */

// ---------------------------------------------------------------- Genesis collection
export const GENESIS_SUPPLY = 1024;
export const HASH_POWER_MIN = 300;
export const HASH_POWER_MAX = 1000;

/**
 * The published hash-power pool — how many Genesis Knights exist in each band.
 *
 * This table *is* the fairness rule, and it lives here rather than in a document so the
 * page, the API and the harness all read the same numbers. Two properties matter and both
 * are asserted in `tools/check-staking.js`, so the distribution cannot drift once knights
 * are sold:
 *
 *   - the counts sum to exactly GENESIS_SUPPLY (1,024), and
 *   - the bands tile HASH_POWER_MIN..HASH_POWER_MAX with no gap and no overlap.
 *
 * A knight banks exactly its hash power in tickets for every hour staked, so a band's
 * range *is* its yield range: a 1,000-HP knight earns 1,000 tickets an hour and a
 * 300-HP knight earns 300. The band names are a labelling choice; the counts are the
 * promise. Individual rolls inside a band are uniform, which is why the bands — not the
 * individual values — are what a buyer can hold us to.
 */
export const HASH_POWER_BANDS = [
    { key: 'spark', name: 'Spark', lo: 300, hi: 424, count: 200 },
    { key: 'ember', name: 'Ember', lo: 425, hi: 549, count: 210 },
    { key: 'forge', name: 'Forge', lo: 550, hi: 674, count: 210 },
    { key: 'radiant', name: 'Radiant', lo: 675, hi: 799, count: 200 },
    { key: 'ascendant', name: 'Ascendant', lo: 800, hi: 899, count: 140 },
    { key: 'prime', name: 'Genesis Prime', lo: 900, hi: 1000, count: 64 },
];

/** The band a hash power falls in, or null when it is outside the published range. */
export function bandFor(hashPower) {
    const hp = Number(hashPower);
    if (!Number.isFinite(hp)) return null;
    return HASH_POWER_BANDS.find((band) => hp >= band.lo && hp <= band.hi) || null;
}

/**
 * Tickets banked per hour of staking. Exactly the hash power — stated once, here, so the
 * "1 HP = 1 ticket/hour" rule has a single home instead of being implied by `ticketsFor`.
 */
export function ticketsPerHour(hashPower) {
    return Math.max(0, Number(hashPower) || 0);
}

/** The pool a mint draws from, as `{ bandKey: count }`. */
export function hashPowerPool() {
    return HASH_POWER_BANDS.reduce((pool, band) => {
        pool[band.key] = band.count;
        return pool;
    }, {});
}

// ---------------------------------------------------------------------- the raffle
/** Capsules handed out per weekly draw. Your call, and a one-line change if it moves. */
export const CAPSULES_PER_WEEK = 200;

/**
 * A knight stops earning tickets after a week of staking, so leaving one parked forever
 * is not the same as playing. The cap is stated in the UI rather than hidden.
 */
export const TICKET_CAP_HOURS = 168;

// ------------------------------------------------------------------ the weekly pool
/**
 * DNG awarded per week from the treasury, split in proportion to ticket share.
 *
 * `null` means "not decided yet" — the tokenomics are not out. The page shows `TBD`
 * where this number would be and keeps showing everything that *is* known (your share of
 * the pool, accruing per second). It never invents an official figure, and setting the
 * `WEEKLY_POOL_DNG` env var turns real numbers on with no deploy of new code.
 */
export const WEEKLY_POOL_DNG = null;

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A Monday at 00:00 UTC. Every week boundary is `epoch + n × 7 days`, so the draw really
 * does land on Monday midnight and the week number is stable across clients — no
 * timezone can disagree about which week it is.
 */
export const WEEK_EPOCH_UTC = Date.UTC(2024, 0, 1);

// -------------------------------------------------------------------------- capsules
/**
 * Capsule types and what they can become.
 *
 * Two corrections were applied to the spec's tables. The first is arithmetic: it listed
 * the rare capsule as "28% Mythic + 2% Mythic"-class typos that did not sum to 100. The
 * second matters more — every outcome must be a tier the reward contracts can actually
 * pay.
 *
 * `DungeonKnightsGameV4` (and every other reward contract) indexes five slots, 0–4. A
 * "Mythic" knight has no reward slot, so a capsule that rolled one would mint a token
 * that reverts on every claim. The spec's fourth capsule was named after that tier and
 * handed it out 2–30% of the time; it is now the **Prime Capsule**, named for the top
 * hash-power band (`Genesis Prime`, 900–1,000 HP) rather than for a knight tier, and it
 * draws only from the top of the real range.
 *
 * Each rung raises a player's **floor** and every table sums to exactly 100. The odds are
 * printed in the UI rather than kept as a surprise, because players compare them to the
 * Summoning Chamber's price:
 *
 *   capsule     floor       odds                                   expected yield
 *   Common      Common      60 / 25 / 10 / 4 / 1                    78.3 DNG a day
 *   Rare        Uncommon    30 / 40 / 20 / 10                      178.5
 *   Legendary   Rare        20 / 40 / 40                           354.0
 *   Prime       Epic        30 / 70                               487.5
 *
 * (Yield is `dungeonReward x dailyRuns` per tier — 50 / 85 / 120 / 225 / 600 DNG a day —
 * weighted by those odds.) The ladder is deliberately not steeper than this: with only
 * five tiers the top rung has nowhere to climb but Legendary, and a Prime that were all
 * Legendary would make every other capsule worthless.
 *
 * Still undecided, and it is the number that actually sets this economy: how the 200
 * weekly capsules are split across the four types. Nothing here assumes a split.
 */
export const CAPSULE_TYPES = [
    {
        id: 1,
        key: 'common',
        name: 'Common Capsule',
        rarity: 'common',
        odds: [
            { rarity: 'Common', pct: 60 },
            { rarity: 'Uncommon', pct: 25 },
            { rarity: 'Rare', pct: 10 },
            { rarity: 'Epic', pct: 4 },
            { rarity: 'Legendary', pct: 1 },
        ],
    },
    {
        id: 2,
        key: 'rare',
        name: 'Rare Capsule',
        rarity: 'rare',
        odds: [
            { rarity: 'Uncommon', pct: 30 },
            { rarity: 'Rare', pct: 40 },
            { rarity: 'Epic', pct: 20 },
            { rarity: 'Legendary', pct: 10 },
        ],
    },
    {
        id: 3,
        key: 'legendary',
        name: 'Legendary Capsule',
        rarity: 'legendary',
        odds: [
            { rarity: 'Rare', pct: 20 },
            { rarity: 'Epic', pct: 40 },
            { rarity: 'Legendary', pct: 40 },
        ],
    },
    {
        id: 4,
        key: 'prime',
        name: 'Prime Capsule',
        rarity: 'prime',
        odds: [
            { rarity: 'Epic', pct: 30 },
            { rarity: 'Legendary', pct: 70 },
        ],
    },
];

/** Capsules are free to open — the win is the prize, not a second purchase. */
export const CAPSULE_OPEN_COST_DNG = 0;

export function capsuleType(keyOrId) {
    return CAPSULE_TYPES.find((t) => t.key === keyOrId || t.id === keyOrId) || null;
}

// ---------------------------------------------------------------------- the week clock
/** The Monday 00:00 UTC that opens the week containing `now`. */
export function weekStart(nowMs = Date.now()) {
    const index = Math.floor((nowMs - WEEK_EPOCH_UTC) / WEEK_MS);
    return WEEK_EPOCH_UTC + index * WEEK_MS;
}

/** A stable, countable week index — the same on every client. */
export function weekNumber(nowMs = Date.now()) {
    return Math.floor((nowMs - WEEK_EPOCH_UTC) / WEEK_MS);
}

export function weekEnd(nowMs = Date.now()) {
    return weekStart(nowMs) + WEEK_MS;
}

/**
 * Which side of the draw we are on.
 *
 * `pending` is the honest state for the minutes after Monday 00:00 before the draw has
 * been run — the previous week's tickets are still the live ones, and the UI says
 * "drawing" rather than showing a countdown that has already expired.
 */
export function weekPhase(nowMs = Date.now(), drawDelayMinutes = 30) {
    const start = weekStart(nowMs);
    const elapsed = nowMs - start;
    if (elapsed < drawDelayMinutes * 60 * 1000) return 'pending';
    if (weekEnd(nowMs) - nowMs < 60 * 60 * 1000) return 'final';
    return 'open';
}

// ------------------------------------------------------------------------- the maths
export function stakedHours(stakedAtMs, nowMs = Date.now()) {
    if (!stakedAtMs) return 0;
    return Math.max(0, (nowMs - stakedAtMs) / 3_600_000);
}

/**
 * `tickets = floor(min(stakedHours, 168) × hashPower)` — the spec's formula, kept exactly.
 */
export function ticketsFor({ hashPower, stakedAt }, nowMs = Date.now()) {
    const hours = Math.min(stakedHours(stakedAt, nowMs), TICKET_CAP_HOURS);
    return Math.floor(hours * Math.max(0, hashPower || 0));
}

function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
}

/**
 * A staker's slice of the weekly pool, as a fraction of the whole.
 *
 * Tickets are *time*, so the honest measure is how much of the week's ticket-time one
 * wallet owns. In practice the page computes its own share from the live totals.
 */
export function shareOfPool(myTickets, totalTickets) {
    if (!myTickets || !totalTickets || totalTickets <= 0) return 0;
    return clamp01(myTickets / totalTickets);
}

/**
 * How much of the pool has accrued to a stake, as a fraction of the pool.
 *
 * Accrual starts when the knight is staked (not when the week starts) and runs
 * continuously, which is why the number on screen climbs every second instead of
 * jumping once a day. Returns a fraction, not a DNG amount, because the pool size is
 * still unknown — `dngFrom` converts it the moment the pool is set.
 */
export function accruedPoolShare({ myTickets, totalTickets, stakedAt }, nowMs = Date.now()) {
    const share = shareOfPool(myTickets, totalTickets);
    if (!share) return 0;
    const weekOpen = Math.max(weekStart(nowMs), stakedAt || weekStart(nowMs));
    const elapsed = clamp01((nowMs - weekOpen) / WEEK_MS);
    return share * elapsed;
}

/** Pool share → DNG. `null` while the pool is undecided, which the UI renders as TBD. */
export function dngFromPoolShare(poolShare, poolDng = WEEKLY_POOL_DNG) {
    if (poolDng === null || poolDng === undefined) return null;
    return poolShare * poolDng;
}

/**
 * What one entry can expect to win: your tickets' cut of the capsules on offer.
 *
 * Shown per entry so a player reads their odds instead of guessing. Early in the life of
 * the raffle, when few knights are staked, one entry can take most of the draw — that is
 * the formula, not a bug, and the page says so.
 */
export function expectedCapsules(myTickets, totalTickets, capsules = CAPSULES_PER_WEEK) {
    return shareOfPool(myTickets, totalTickets) * capsules;
}

/** Whole tickets in a range, as the draw stores them. */
export function ticketRangeTickets(range) {
    return Math.max(0, (range.lastTicket - range.firstTicket) + 1);
}
