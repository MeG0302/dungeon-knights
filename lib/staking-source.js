/**
 * Where the Staking Vault's numbers come from.
 *
 * The page is being built before its contracts exist, so this module has two modes and
 * says which one it is in:
 *
 *   - **chain** — real Genesis holdings, real stake sessions, a real draw. Used the moment
 *     `/api/staking/config` reports deployed addresses.
 *   - **preview** — deterministic holdings seeded from the wallet address, so the same
 *     wallet always sees the same knights and the tests are stable. The page wears a
 *     visible badge in this mode; nothing pretends to be on-chain.
 *
 * Every function here is pure and takes `nowMs`, which is what lets the harness prove the
 * accrual, ticket and countdown maths without a browser, a clock or a chain.
 */

import {
    CAPSULES_PER_WEEK,
    CAPSULE_TYPES,
    GENESIS_SUPPLY,
    HASH_POWER_MAX,
    HASH_POWER_MIN,
    KNIGHTS_CAP,
    TICKET_CAP_HOURS,
    accruedPoolShare,
    dngFromPoolShare,
    expectedCapsules,
    ticketsFor,
    weekEnd,
    weekNumber,
    weekPhase,
    weekStart,
} from './staking-config.js';
import {
    STAKING_SHARE_OF_DUNGEON, capsuleOpenPrice, lineBudgets, weeklyBudgetDng,
} from './reward-config.js';
import { RARITY } from './knights.js';

/**
 * Which collection's side of the vault is being shown.
 *
 * They are two collections with one vault, not two vaults: both draw from the same weekly
 * budget, each from its own line of it, and both cap at the same 168 staked hours. What
 * separates them is what the stake *is* — **Genesis stakes for yield and raffle tickets;
 * Knights stake for yield only.** The raffle is Genesis-only because the prize is a capsule
 * and a capsule mints a Knight, so a Knights staker entering it would be paid twice from
 * the same faucet. That is the whole reason for the split, and it is the thing the interface
 * has to say out loud rather than let a player discover.
 */
export const COLLECTIONS = ['genesis', 'knights'];

export const COLLECTION_LABELS = {
    genesis: 'Genesis',
    knights: 'Knights',
};

/**
 * The Genesis staking line, in DNG per week.
 *
 * This used to be `TBD`, and the page printed `TBD` next to everything that depended on it
 * because the tokenomics were undecided. Under the third revision it is *derived*: the
 * weekly budget split into its four lines, one of which is the pool Genesis stakers draw
 * from. The page can therefore show real DNG figures that come from the same file the
 * contracts are deployed from, and setting the `WEEKLY_POOL_DNG` env var overrides it for a
 * deployment that has one on chain.
 */
export const DEFAULT_WEEKLY_POOL_DNG = lineBudgets().genesisStaking;

/**
 * The Knights staking line, in DNG per week — 292,320 at the reference.
 *
 * Smaller than Genesis's for a reason worth keeping in view: it is 90% of the *Knights*
 * dungeon line, and a Knights clear pays far less than a Genesis clear. The two pools are
 * not meant to be equal; they are each 90% of their own collection's play.
 *
 * And unlike Genesis's, this pool's per-knight payout **falls as the collection grows** —
 * the line is a fixed share of the budget, so filling the cap divides it among twenty times
 * as many knights. At the cap a staked Knight earns 5.00% of the reference rate. The page
 * says so; see `knightsYieldAtCap` below.
 */
export const DEFAULT_KNIGHTS_POOL_DNG = lineBudgets().knightsStaking;

/** The pool for a collection, so callers do not each re-derive which constant to read. */
export function defaultPoolDng(collection = 'genesis') {
    return collection === 'knights' ? DEFAULT_KNIGHTS_POOL_DNG : DEFAULT_WEEKLY_POOL_DNG;
}

/**
 * A Knight's hash power is its tier's, and the tier table is the single source.
 *
 * Stated as a list so the interface can draw the whole ladder, and as a lookup so a seeded
 * preview knight cannot wear a power no mint could produce.
 */
export const KNIGHTS_HASH_POWER = Object.entries(RARITY).map(([key, tier]) => ({
    key: key.toLowerCase(),
    name: tier.name,
    hashPower: tier.hashPower,
    dropRate: tier.dropRate,
    color: tier.color,
    reward: tier.dungeonReward,
}));

export const KNIGHTS_HASH_POWER_MIN = Math.min(...KNIGHTS_HASH_POWER.map((t) => t.hashPower));
export const KNIGHTS_HASH_POWER_MAX = Math.max(...KNIGHTS_HASH_POWER.map((t) => t.hashPower));

/**
 * What a staked Knight earns once the cap is full, against what it earns at the reference.
 *
 * Both sides are stated per knight per week so the ratio cannot be computed against the
 * wrong denominator — the mistake an earlier draft of the plan made, quoting a combined
 * dungeon-and-staking figure against dungeon-only earnings and so doubling it to "10% of
 * reference" when the truth is 5%.
 */
export function knightsYieldAtCap() {
    const pool = DEFAULT_KNIGHTS_POOL_DNG;
    const dungeonPerKnight = lineBudgets().knightsDungeon / KNIGHTS_CAP;
    return {
        poolPerWeek: pool,
        dungeonPerWeek: dungeonPerKnight * 7,
        atCapStakedPerWeek: pool / KNIGHTS_CAP,
        atReferenceStakedPerWeek: pool / 500,
        ratioOfReference: 500 / KNIGHTS_CAP,
    };
}

export const SOURCE_PREVIEW = 'preview';
export const SOURCE_CHAIN = 'chain';

export function shortAddress(address) {
    if (!address || address.length < 10) return address || '';
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

// ------------------------------------------------------------------- seeding (preview)
/**
 * A tiny deterministic PRNG. Seeded from the wallet, so a preview wallet's knights never
 * shuffle between renders — a list that rearranged itself on every tick would make the
 * page impossible to judge.
 */
function seededRandom(seed) {
    let state = seed >>> 0;
    return function next() {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function seedFrom(address) {
    const text = String(address || '0x0').toLowerCase();
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

const HOUR_MS = 3_600_000;

// Preview knights are drawn across the published range and never outside it, so the page
// cannot show a hash power that could never be minted. (+1 keeps HASH_POWER_MAX
// reachable, since `rand()` never returns 1.)
const PREVIEW_POWER_SPAN = HASH_POWER_MAX - HASH_POWER_MIN + 1;

function previewGenesis(address, nowMs) {
    const rand = seededRandom(seedFrom(address));
    const count = 5;
    const knights = [];
    const used = new Set();

    for (let i = 0; i < count; i++) {
        let tokenId = 1 + Math.floor(rand() * GENESIS_SUPPLY);
        while (used.has(tokenId)) tokenId = 1 + Math.floor(rand() * GENESIS_SUPPLY);
        used.add(tokenId);
        knights.push({
            tokenId,
            name: `Genesis #${String(tokenId).padStart(3, '0')}`,
            hashPower: HASH_POWER_MIN + Math.floor(rand() * PREVIEW_POWER_SPAN),
        });
    }

    knights.sort((a, b) => a.tokenId - b.tokenId);

    // Two of the five are already staked — one for a while (near the ticket cap), one
    // fresh — so the page shows both ends of the ticket curve without any help.
    const stakedAt = [nowMs - 53 * HOUR_MS, nowMs - 6 * HOUR_MS];
    return knights.map((knight, index) => (
        index < stakedAt.length ? { ...knight, stakedAt: stakedAt[index] } : { ...knight, stakedAt: null }
    ));
}

/**
 * A wallet's preview Knights.
 *
 * Knights come from capsules, so the preview draws them across the **published tier odds**
 * rather than spreading them evenly — a preview that showed one of each tier would suggest a
 * distribution no mint produces. Hash power is the tier's and never a number in between,
 * because a Knight's power is fixed by its tier and inventing one would show a knight that
 * cannot exist.
 *
 * Seeded from the wallet like the Genesis holdings, and for the same reason: a list that
 * reshuffles between renders is a list nobody can judge.
 */
function previewKnights(address, nowMs) {
    const rand = seededRandom(seedFrom(address) ^ 0x5bf03635);
    const count = 6;
    const knights = [];
    const used = new Set();

    const pickTier = () => {
        let roll = rand();
        for (const tier of KNIGHTS_HASH_POWER) {
            roll -= tier.dropRate;
            if (roll <= 0) return tier;
        }
        return KNIGHTS_HASH_POWER[0];
    };

    for (let i = 0; i < count; i++) {
        const tier = pickTier();
        let tokenId = 1 + Math.floor(rand() * KNIGHTS_CAP);
        while (used.has(tokenId)) tokenId = 1 + Math.floor(rand() * KNIGHTS_CAP);
        used.add(tokenId);
        knights.push({
            tokenId,
            name: `${tier.name} Knight #${tokenId}`,
            rarity: tier.key,
            tierName: tier.name,
            hashPower: tier.hashPower,
        });
    }

    knights.sort((a, b) => a.tokenId - b.tokenId);

    // Two of the six are staked — one a while in, one fresh — so the page shows both ends of
    // the yielding curve without any help, exactly as the Genesis preview does.
    const stakedAt = [nowMs - 31 * HOUR_MS, nowMs - 4 * HOUR_MS];
    return knights.map((knight, index) => (
        index < stakedAt.length ? { ...knight, stakedAt: stakedAt[index] } : { ...knight, stakedAt: null }
    ));
}

// ------------------------------------------------------------------------ the snapshot
// An absent `poolDng` resolves to the collection's **own** published line, and the resolution
// happens here rather than in the parameter list because a parameter default cannot see
// `collection` — which is how a Knights vault silently drew the Genesis pool (377,999.99
// instead of 292,320). Passing `null` therefore means "use the line this side is entitled to",
// not "there is no pool": the partition in `lib/reward-config.js` is what sets the number.
function emptySnapshot(nowMs, poolDng = null, collection = 'genesis') {
    const knights = collection === 'knights';
    const resolvedPool = poolDng ?? defaultPoolDng(collection);
    return {
        source: SOURCE_PREVIEW,
        collection,
        wallet: null,
        connected: false,
        canWrite: false,
        writeBlockedReason: null,
        owned: [],
        staked: [],
        board: [],
        // Capsules are the Genesis draw's prize, so a Knights staker holds none by
        // definition rather than by having not won yet.
        capsules: [],
        history: [],
        week: weekInfo(nowMs),
        pool: {
            dng: resolvedPool,
            capsulesPerWeek: knights ? 0 : CAPSULES_PER_WEEK,
            awarded: 0,
            left: knights ? 0 : CAPSULES_PER_WEEK,
            totalTickets: 0,
            entries: 0,
        },
        totals: {
            myTickets: 0,
            myShare: 0,
            totalTickets: 0,
            stakedCount: 0,
            ownedCount: 0,
            hashPower: 0,
            expectedCapsules: 0,
        },
        limits: {
            capHours: TICKET_CAP_HOURS,
            hashPowerMin: knights ? KNIGHTS_HASH_POWER_MIN : HASH_POWER_MIN,
            hashPowerMax: knights ? KNIGHTS_HASH_POWER_MAX : HASH_POWER_MAX,
            supply: knights ? KNIGHTS_CAP : GENESIS_SUPPLY,
            // The one structural difference between the two sides, carried as data so no
            // control has to decide for itself whether the raffle exists.
            raffleEligible: !knights,
            capsuleOpenCost: capsuleOpenPrice(0),
            capsuleOpenCostAtCap: capsuleOpenPrice(KNIGHTS_CAP),
            knightsCap: KNIGHTS_CAP,
            stakingShareOfDungeon: STAKING_SHARE_OF_DUNGEON,
            weeklyBudget: weeklyBudgetDng(),
            lineBudgets: lineBudgets(),
            knightsYieldAtCap: knights ? knightsYieldAtCap() : null,
        },
    };
}

export function weekInfo(nowMs) {
    const phase = weekPhase(nowMs);
    const start = weekStart(nowMs);
    const end = weekEnd(nowMs);
    return {
        number: weekNumber(nowMs),
        startsAt: start,
        endsAt: end,
        drawAt: end,
        phase,
        phaseLabel: {
            open: 'Entries open',
            final: 'Final hour',
            pending: 'Drawing now',
        }[phase],
    };
}

/**
 * The player's own stake sessions, priced at `nowMs`.
 *
 * Tickets grow with time, so this must be recomputed rather than stored — that is exactly
 * what makes the number on the card climb while the page is open.
 */
function priceStaked(staked, nowMs) {
    return staked.map((knight) => {
        const tickets = ticketsFor(knight, nowMs);
        return {
            ...knight,
            tickets,
            enteredTickets: knight.entered ? tickets : 0,
        };
    });
}

function myTickets(staked) {
    return staked.reduce((sum, knight) => sum + knight.tickets, 0);
}

function withShares(snapshot, nowMs) {
    const staked = priceStaked(snapshot.staked, nowMs);
    const mine = myTickets(staked);
    const others = snapshot.board.reduce((sum, row) => sum + row.tickets, 0);
    const totalTickets = mine + others;

    const entries = staked
        .filter((knight) => knight.entered)
        .map((knight) => ({
            tokenId: knight.tokenId,
            name: knight.name,
            hashPower: knight.hashPower,
            tickets: knight.tickets,
            expected: expectedCapsules(knight.tickets, totalTickets),
        }));

    return {
        ...snapshot,
        staked: staked.map((knight) => ({
            ...knight,
            poolShare: knight.tickets / totalTickets,
            // The slice of the pool this stake has accrued so far, as a fraction. It is a
            // real number even while the pool size is TBD, which is why the page can show
            // something honest and live before the tokenomics exist.
            accruedShare: accruedPoolShare({
                myTickets: knight.tickets,
                totalTickets,
                stakedAt: knight.stakedAt,
            }, nowMs),
            // Priced with *this snapshot's* pool, not the compile-time default, so the
            // API's resolved line and the cards can never disagree about the weekly budget.
            accruedDng: dngFromPoolShare(accruedPoolShare({
                myTickets: knight.tickets,
                totalTickets,
                stakedAt: knight.stakedAt,
            }, nowMs), snapshot.pool.dng),
        })),
        entries,
        pool: {
            ...snapshot.pool,
            left: snapshot.pool.capsulesPerWeek - snapshot.pool.awarded,
            totalTickets,
            entries: entries.length,
        },
        totals: {
            myTickets: mine,
            myShare: totalTickets ? mine / totalTickets : 0,
            totalTickets,
            stakedCount: staked.length,
            ownedCount: staked.length + snapshot.owned.length,
            hashPower: staked.reduce((sum, knight) => sum + knight.hashPower, 0),
            expectedCapsules: expectedCapsules(mine, totalTickets),
        },
    };
}

// --------------------------------------------------------------------------- preview
/**
 * A wallet's preview vault.
 *
 * Shaped exactly like the chain snapshot so the page has one contract to render and the
 * eventual contract reads drop in without touching the UI.
 */
export function previewSnapshot(
    address, nowMs = Date.now(), poolDng = null, collection = 'genesis',
) {
    const base = emptySnapshot(nowMs, poolDng, collection);
    const isKnights = collection === 'knights';
    const knights = isKnights ? previewKnights(address, nowMs) : previewGenesis(address, nowMs);
    const stocked = knights.filter((k) => k.stakedAt).map((k) => ({ ...k, entered: false }));

    const rand = seededRandom(seedFrom(address) ^ 0x9e3779b9);
    const neighbours = ['0x7a3f', '0x2bd4', '0x9636', '0x5494'].map((prefix, index) => ({
        address: `${prefix}${String(Math.floor(rand() * 1e12)).padStart(12, '0')}`,
        tickets: Math.floor(180 + rand() * 900) * (index + 1),
    }));

    const stockedCapsules = CAPSULE_TYPES.map((type, index) => ({
        id: type.id,
        key: type.key,
        name: type.name,
        rarity: type.rarity,
        odds: type.odds,
        count: index < 2 ? (index === 0 ? 2 : 1) : 0,
    }));

    const history = [1, 2, 3].map((back) => {
        const week = base.week.number - back;
        return {
            week,
            address: `${['0x2bd4', '0x9636', '0x7a3f'][back - 1]}${String(Math.floor(rand() * 1e12)).padStart(12, '0')}`,
            capsules: [12, 7, 19][back - 1],
            tickets: [4120, 2380, 6110][back - 1],
        };
    }).map((row) => ({ ...row, short: shortAddress(row.address) }));

    return withShares({
        ...base,
        wallet: address,
        connected: true,
        canWrite: true,
        owned: knights.filter((k) => !k.stakedAt),
        staked: stocked,
        // The raffle board belongs to the Genesis draw. A Knights vault shows it empty rather
        // than showing Genesis entrants, which would read as a draw they are part of.
        board: isKnights
            ? []
            : neighbours.map((row) => ({ ...row, short: shortAddress(row.address), knights: 1 + Math.floor(rand() * 3) })),
        capsules: isKnights ? [] : stockedCapsules,
        history: isKnights ? [] : history,
        pool: { ...base.pool, awarded: isKnights ? 0 : 37 },
    }, nowMs);
}

// ----------------------------------------------------------------------------- chain
/**
 * A snapshot built from the real collection.
 *
 * Two facts live here that used to be one, and separating them is the point. **Ownership is
 * readable today** — the knights this wallet holds come straight from the deployed collection —
 * while **staking is not**, because that contract does not exist. Reporting them together is
 * what kept every visitor looking at invented knights: the page asked whether *everything* was
 * deployed, got `false` because three things were missing, and fell back to a preview for the
 * one thing that was real.
 *
 * `holdings` is the reader's own answer (`lib/staking-chain.js`), passed through rather than
 * flattened, because it carries the part the page must not drop: an unenumerable collection can
 * return a list that is **known to be short**, and `complete: false` is how that travels to the
 * screen instead of being rounded up to a confident-looking list.
 *
 * `staked` is always empty and that is not a placeholder. Nothing can be staked until the
 * staking contract exists, and seeding it with anything would be the exact dishonesty this
 * function was rewritten to remove.
 */
export function chainSnapshot(address, config, nowMs = Date.now(), collection = 'genesis', holdings = null) {
    const isKnights = collection === 'knights';
    const base = emptySnapshot(
        nowMs,
        (isKnights ? config?.knightsPoolDng : config?.poolDng) ?? defaultPoolDng(collection),
        collection,
    );

    const held = holdings?.ok ? holdings.knights : [];
    const side = config?.collections?.[collection];

    // Why staking is refused, in the order the player would ask. A missing collection comes
    // first because it explains why the list is empty at all; a missing staking contract is the
    // next question.
    const blocked = !side?.live
        ? (side?.reason || 'This collection does not exist on this network yet.')
        : (config?.reason
            || 'The staking contracts are not deployed on this network yet, so this page is read-only.');

    return withShares({
        ...base,
        source: SOURCE_CHAIN,
        wallet: address,
        connected: true,
        canWrite: false,
        writeBlockedReason: blocked,
        owned: held.map((knight) => ({ ...knight, stakedAt: null })),
        // Passed through whole: `enumerable`, `complete`, `balance`, `candidates` and `note` are
        // all read by the page, and a summary here would have to be re-derived there.
        holdings: holdings
            ? {
                ok: !!holdings.ok,
                reason: holdings.reason || null,
                note: holdings.note || null,
                complete: holdings.complete !== false,
                enumerable: holdings.enumerable === true,
                balance: holdings.balance ?? null,
                candidates: holdings.candidates ?? null,
                fromBlock: holdings.fromBlock ?? null,
                nft: side?.nft || null,
            }
            : null,
    }, nowMs);
}

/**
 * Load the vault for a wallet.
 *
 * `config` is `/api/staking/config`. There are three states, in this order of precedence:
 *
 *   1. **A collection exists** (`holdingsLive`) — read the wallet's knights from it and show
 *      those. The preview is not used at all, even for the side whose collection is missing:
 *      once real holdings can be read, the side without a collection says so instead of seeding
 *      invented knights next to real ones.
 *   2. **The staking contracts are deployed** (`chain`) — read the vault itself.
 *   3. **Neither** — the deterministic preview stands in, labelled.
 *
 * A config fetch that fails is not an error the player can act on, and it falls through to the
 * preview rather than leaving the page empty.
 */
export async function loadVault(address, { config, nowMs = Date.now(), fetchJson, collection = 'genesis' } = {}) {
    if (!address) return { ...emptySnapshot(nowMs, defaultPoolDng(collection), collection), wallet: null, connected: false };

    let resolved = config;
    if (!resolved && typeof fetchJson === 'function') {
        try {
            resolved = await fetchJson('/api/staking/config');
        } catch {
            resolved = null;
        }
    }

    // Real holdings, when anything can actually be read. A side whose collection does not exist
    // gets an empty snapshot carrying the reason — not a preview, and not an error either.
    if (resolved?.holdingsLive && typeof fetchJson === 'function') {
        const side = resolved.collections?.[collection];
        if (!side?.live) {
            return chainSnapshot(address, resolved, nowMs, collection, {
                ok: false,
                reason: side?.reason || 'This collection does not exist on this network yet.',
            });
        }
        try {
            const held = await fetchJson(
                `/api/staking/holdings?address=${encodeURIComponent(address)}&collection=${encodeURIComponent(collection)}`
            );
            if (held?.ok) return chainSnapshot(address, resolved, nowMs, collection, held);
            // The route answered, and its answer is that the chain could not be read. That is a
            // true statement about the wallet's holdings and belongs on screen; falling back to
            // the preview here would replace it with an invention.
            return chainSnapshot(address, resolved, nowMs, collection, held || {
                ok: false,
                reason: 'the chain could not be read just now',
            });
        } catch {
            return chainSnapshot(address, resolved, nowMs, collection, {
                ok: false,
                reason: 'the chain could not be read just now',
            });
        }
    }

    if (resolved?.chain) return chainSnapshot(address, resolved, nowMs, collection);
    const pool = (collection === 'knights' ? resolved?.knightsPoolDng : resolved?.poolDng)
        ?? defaultPoolDng(collection);
    return previewSnapshot(address, nowMs, pool, collection);
}

/** Re-price a snapshot for a new instant, without touching the source. */
export function refresh(snapshot, nowMs = Date.now()) {
    if (!snapshot?.wallet) return snapshot;
    return withShares(snapshot, nowMs);
}

// --------------------------------------------------------------------------- actions
/**
 * What a button does.
 *
 * Pure and synchronous over the snapshot, so every path — staking, claiming, entering the
 * raffle, opening a capsule — is proven in `tools/check-staking.js` without a wallet. In
 * preview mode the mutation is local; in chain mode these become contract calls that
 * produce the same new snapshot.
 */
/**
 * The raffle actions, refused on the Knights side.
 *
 * The rule is enforced here rather than only rendered: `enterRaffle` on a Knights stake would
 * mint the *appearance* of a weekly entry, and a player who has been told they are in the draw
 * is being lied to whether or not a contract later says no.
 */
const RAFFLE_ACTIONS = new Set(['enterRaffle', 'enterAll', 'withdrawRaffle', 'withdrawAll']);

const RAFFLE_REFUSAL = 'The weekly raffle is Genesis-only. Its prize is a capsule, and a capsule mints a Knight — '
    + 'so a Knights stake entering it would be paid twice from the same faucet. Knights stake for yield.';

export function applyAction(snapshot, action, payload = {}, nowMs = Date.now()) {
    if (!snapshot?.connected) return { error: 'Connect a wallet first.' };
    if (!snapshot.canWrite) {
        return { error: snapshot.writeBlockedReason || 'This vault is read-only right now.' };
    }
    if (snapshot.collection === 'knights' && RAFFLE_ACTIONS.has(action)) {
        return { error: RAFFLE_REFUSAL };
    }
    if (snapshot.collection === 'knights' && action === 'openCapsule') {
        return { error: 'Capsules are awarded by the Genesis draw, so a Knights vault holds none to open.' };
    }

    const next = {
        ...snapshot,
        owned: [...snapshot.owned],
        staked: [...snapshot.staked],
        board: snapshot.board.map((row) => ({ ...row })),
        capsules: snapshot.capsules.map((capsule) => ({ ...capsule })),
    };

    const findStaked = (tokenId) => next.staked.find((k) => k.tokenId === Number(tokenId));

    switch (action) {
        case 'stake': {
            const knight = next.owned.find((k) => k.tokenId === Number(payload.tokenId));
            if (!knight) return { error: 'That Genesis Knight is not in this wallet.' };
            next.owned = next.owned.filter((k) => k.tokenId !== knight.tokenId);
            next.staked.push({ ...knight, stakedAt: nowMs, entered: false });
            return {
                snapshot: withShares(next, nowMs),
                notice: `${knight.name} is staked. Tickets start counting now.`,
            };
        }

        case 'stakeAll': {
            if (!next.owned.length) return { error: 'Nothing left to stake.' };
            const moved = next.owned.length;
            next.staked.push(...next.owned.map((knight) => ({ ...knight, stakedAt: nowMs, entered: false })));
            next.owned = [];
            return {
                snapshot: withShares(next, nowMs),
                notice: `${moved} Genesis ${moved === 1 ? 'Knight is' : 'Knights are'} staked.`,
            };
        }

        case 'unstake': {
            const knight = findStaked(payload.tokenId);
            if (!knight) return { error: 'That knight is not staked.' };
            next.staked = next.staked.filter((k) => k.tokenId !== knight.tokenId);
            next.owned = [...next.owned, { tokenId: knight.tokenId, name: knight.name, hashPower: knight.hashPower }];
            return {
                snapshot: withShares(next, nowMs),
                notice: `${knight.name} is back in your wallet. Its tickets are forfeited — tickets only count while staked.`,
            };
        }

        case 'claim': {
            const knight = findStaked(payload.tokenId);
            if (!knight) return { error: 'That knight is not staked.' };
            // A line with no budget is the reachable failure here, not an unset pool — the
            // partition always names a figure, so what can be missing is the funding.
            if (!snapshot.pool.dng) {
                return { error: 'This collection\u2019s staking line has no budget, so there is nothing to claim. Your share keeps accruing.' };
            }
            if (!knight.accruedDng) return { error: 'Nothing has accrued on that knight yet.' };
            const claimed = knight.accruedDng;
            next.staked = next.staked.map((k) => (k.tokenId === knight.tokenId ? { ...k, claimed: true } : k));
            return {
                snapshot: withShares(next, nowMs),
                notice: `${claimed.toFixed(2)} DNG claimed from ${knight.name}.`,
            };
        }

        case 'enterRaffle': {
            const knight = findStaked(payload.tokenId);
            if (!knight) return { error: 'Only staked knights can enter the draw.' };
            if (knight.entered) return { snapshot: { ...snapshot }, notice: `${knight.name} is already in this week's draw.` };
            next.staked = next.staked.map((k) => (k.tokenId === knight.tokenId ? { ...k, entered: true } : k));
            return {
                snapshot: withShares(next, nowMs),
                notice: `${knight.name} entered with ${knight.tickets.toLocaleString()} tickets.`,
            };
        }

        case 'enterAll': {
            const pending = next.staked.filter((k) => !k.entered);
            if (!pending.length) return { error: 'Every staked knight is already in this week\'s draw.' };
            next.staked = next.staked.map((k) => ({ ...k, entered: true }));
            const tickets = pending.reduce((sum, k) => sum + ticketsFor(k, nowMs), 0);
            return {
                snapshot: withShares(next, nowMs),
                notice: `${pending.length} ${pending.length === 1 ? 'knight' : 'knights'} entered — ${tickets.toLocaleString()} tickets in the draw.`,
            };
        }

        case 'withdrawRaffle': {
            const knight = findStaked(payload.tokenId);
            if (!knight) return { error: 'That knight is not staked.' };
            if (!knight.entered) return { snapshot: { ...snapshot }, notice: `${knight.name} is not in the draw.` };
            next.staked = next.staked.map((k) => (k.tokenId === knight.tokenId ? { ...k, entered: false } : k));
            return {
                snapshot: withShares(next, nowMs),
                notice: `${knight.name} withdrew from this week's draw.`,
            };
        }

        case 'withdrawAll': {
            if (!next.staked.some((k) => k.entered)) return { error: 'Nothing to withdraw.' };
            next.staked = next.staked.map((k) => ({ ...k, entered: false }));
            return { snapshot: withShares(next, nowMs), notice: 'All entries withdrawn.' };
        }

        case 'openCapsule': {
            const capsule = next.capsules.find((c) => c.key === payload.key);
            if (!capsule || capsule.count < 1) return { error: 'No capsule of that type to open.' };
            next.capsules = next.capsules.map((c) => (c.key === capsule.key ? { ...c, count: c.count - 1 } : c));
            return {
                snapshot: withShares(next, nowMs),
                notice: `${capsule.name} opened — head to the Summoning Chamber to reveal the knight.`,
                redirect: '/mint',
            };
        }

        default:
            return { error: `Unknown action "${action}".` };
    }
}
