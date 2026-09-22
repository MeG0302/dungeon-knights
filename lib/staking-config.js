/**
 * The Staking Vault's rules, in one place.
 *
 * Free of storage and browser imports on purpose, like `points-config.js`: the page, the
 * API routes and the Node harness all read exactly these numbers, so they cannot disagree
 * about what a staked knight earns.
 *
 * The *economy* — supply, the weekly budget, the split across the four reward lines, the
 * capsule open price — lives next door in `reward-config.js`, which imports this file. One
 * direction only, so there is no cycle and no second copy of any number.
 */

// ---------------------------------------------------------------- Genesis collection
export const GENESIS_SUPPLY = 1024;
export const HASH_POWER_MIN = 300;
export const HASH_POWER_MAX = 1000;

/**
 * The size the Knights side of the economy is *stated* against. **Not a cap.**
 *
 * The summonable collection has no supply limit, and that is a decision rather than an
 * oversight: knights come out of capsules, summoning and promises to players, and a ceiling
 * on a collection whose growth is the product's own faucet would be a promise the project
 * would have to break or ration.
 *
 * What an unlimited collection costs is stated here instead, because the honest thing to do
 * with an unbounded number is publish what it does to everyone else:
 *
 *   - **Genesis is unaffected, permanently.** The four reward lines are *fixed shares* of
 *     the weekly budget (`lib/reward-config.js#lineShares`), so however many Knights exist
 *     they cannot dilute what Genesis was promised. That partition — not a supply cap — is
 *     what protects the fixed collection, and it is why the vault has four lines at all.
 *   - **The Knights lines have no floor.** Their two shares are divided among however many
 *     Knights there are, so per-knight yield *keeps falling* as the collection grows. At
 *     10,000 that is 5% of the reference rate; at 100,000 it is 0.5%; the number tends to
 *     zero and never settles on one. Any figure quoted as "the floor" is a figure at one
 *     particular size, which is what this constant names.
 *
 * So this is the reference point, used in exactly two places, both of them disclosures
 * rather than limits: the capsule open price, which ramps 500 → 5,000 DNG across it and is
 * flat above it, and the per-knight payout the interface quotes so a player can see the
 * direction of travel. `tools/check-contracts.js` asserts that `Knights.sol` contains **no**
 * supply ceiling, so this can never quietly become one again.
 */
export const KNIGHTS_REFERENCE_SIZE = 10_000;

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

/**
 * Whether the vault can send a stake, an unstake or a claim to the chain.
 *
 * The page always *looked* like it could — the buttons have always moved a knight on screen —
 * so the honest badge has always depended on a fact about the **interface**, not about the
 * deployment. Deriving it from "are the staking contracts deployed" made that badge a
 * consequence of an environment variable: pointing a deployment at real addresses would have
 * deleted the warning from a page whose buttons still send nothing, which is the one failure
 * the vault is not allowed to have.
 *
 * So it is stated here, once, and flipped only when the approve/stake/claim transaction path
 * exists. It does now, and it is one file: `lib/staking-writes.js` holds the approval, the stake,
 * the unstake and the claim, `tools/check-staking-writes.js` drives them, and the page routes its
 * buttons through them. `tools/check-staking.js` fails if this constant and the code disagree, so
 * it cannot be flipped without the path behind it.
 *
 * **True means "the interface can send", not "the chain will accept".** A side whose staking
 * contract is not configured still says it is a simulation, because a plan against an empty
 * address is a button that cannot do anything; the snapshot requires the address as well as this
 * flag. Fixing this one constant cannot make a deployment look live that is not.
 */
export const STAKING_WRITES_READY = true;

// ----------------------------------------------------------------------- the week clock
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The one week is also the budget's period; `reward-config.js` owns that arithmetic. */
export const WEEK_DAYS = 7;

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
 *   Common      Common      60 / 25 / 10 / 4 / 1                    86.6 DNG a day
 *   Rare        Uncommon    30 / 40 / 20 / 10                      163.6
 *   Legendary   Rare        20 / 40 / 40                           260.8
 *   Prime       Epic        30 / 70                               334.0
 *
 * (Yield is `dungeonReward x dailyRuns` per tier — 60 / 100 / 144 / 180 / 400 DNG a day —
 * weighted by those odds, and `tools/check-rarity.js` asserts the ladder is monotonic.) The
 * ladder is deliberately not steeper than this: with only
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

/**
 * Capsules are **not** free to open, and that is the single biggest correction in this
 * revision.
 *
 * A free open plus 200 capsules a week is 10,400 knights a year, each carrying a full year
 * of claim capacity — 317x the whole token supply if anyone played them. The price is not a
 * constant and so lives in `reward-config.js#capsuleOpenPrice`, where it rises from 500 to
 * 5,000 as the collection fills toward `KNIGHTS_REFERENCE_SIZE`.
 */

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
 *
 * This is the *bank* from one stake: hours since it went in, capped at a week. It is what the
 * preview counts and what the card's cap bar is drawn from, and it is the right shape for
 * "how much of a week has this stake used". It is **not** what the raffle is drawn on — see
 * `ticketsInWeekFor` below, which is the same arithmetic read the way the contract reads it.
 */
export function ticketsFor({ hashPower, stakedAt }, nowMs = Date.now()) {
    const hours = Math.min(stakedHours(stakedAt, nowMs), TICKET_CAP_HOURS);
    return Math.floor(hours * Math.max(0, hashPower || 0));
}

/**
 * `ticketsInWeek(week)`, reproduced from `contracts/GenesisStaking.sol`.
 *
 * The draw does not ask "how long has this stake been in", it asks "how much of **week W** did
 * this stake cover" — and the two answers differ for a stake older than the week. The contract
 * computes each segment's overlap with the week, cuts it at the week's end (a stake that is
 * still open is counted to the end of the week, not to now), caps that overlap at 168 hours and
 * multiplies by hash power:
 *
 *     tickets = floor( min(weekEnd, stakedTo) - max(weekStart, stakedAt) , 168h ) × hp
 *
 * Reproducing it here is what lets the interface show a per-knight ticket count for a **real**
 * stake, which the contract does not publish per token — and `tools/check-staking-writes.js`
 * checks the sum of these against the contract's own `ticketsThisWeek` for a real staker, so the
 * reproduction is verified against the thing it copies rather than asserted.
 *
 * `stakedTo` is optional and means an unstake: an open stake is cut at the week's end.
 */
export function ticketsInWeekFor({ hashPower, stakedAt, stakedTo = null }, nowMs = Date.now()) {
    const hp = Math.max(0, Number(hashPower) || 0);
    if (!stakedAt || !hp) return 0;

    const weekOpen = weekStart(nowMs);
    const weekClose = weekOpen + WEEK_MS;
    const from = Math.max(Number(stakedAt), weekOpen);
    const to = stakedTo ? Math.min(Number(stakedTo), weekClose) : weekClose;
    if (to <= from) return 0;

    const hours = Math.min((to - from) / 3_600_000, TICKET_CAP_HOURS);
    return Math.floor(hours * hp);
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
 *
 * `settledAt` is the last time a claim was made, and it restarts the clock. Without it a
 * payoff was decorative: the page said `25.52 DNG claimed from Genesis #001`, left the same
 * 25.52 on the card and would have offered it again a second later. A claim has to *undo* the
 * accrual it paid, so — exactly as a real position does — the next DNG starts from zero at the
 * moment of the claim.
 */
export function accruedPoolShare({ myTickets, totalTickets, stakedAt, settledAt = null }, nowMs = Date.now()) {
    const share = shareOfPool(myTickets, totalTickets);
    if (!share) return 0;
    const weekOpen = Math.max(weekStart(nowMs), stakedAt || weekStart(nowMs), settledAt || 0);
    const elapsed = clamp01((nowMs - weekOpen) / WEEK_MS);
    return share * elapsed;
}

/**
 * Pool share → DNG. `null` when no budget is supplied, which the UI renders as `—`; the
 * budget itself comes from `reward-config.js#lineBudgets`, not from a compile-time default.
 */
export function dngFromPoolShare(poolShare, poolDng) {
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
