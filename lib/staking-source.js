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
    CAPSULE_OPEN_COST_DNG,
    CAPSULE_TYPES,
    GENESIS_SUPPLY,
    HASH_POWER_MAX,
    HASH_POWER_MIN,
    TICKET_CAP_HOURS,
    WEEKLY_POOL_DNG,
    accruedPoolShare,
    dngFromPoolShare,
    expectedCapsules,
    ticketsFor,
    weekEnd,
    weekNumber,
    weekPhase,
    weekStart,
} from './staking-config.js';

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

// ------------------------------------------------------------------------ the snapshot
function emptySnapshot(nowMs, poolDng = WEEKLY_POOL_DNG) {
    return {
        source: SOURCE_PREVIEW,
        wallet: null,
        connected: false,
        canWrite: false,
        writeBlockedReason: null,
        owned: [],
        staked: [],
        board: [],
        capsules: [],
        history: [],
        week: weekInfo(nowMs),
        pool: {
            dng: poolDng,
            capsulesPerWeek: CAPSULES_PER_WEEK,
            awarded: 0,
            left: CAPSULES_PER_WEEK,
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
            hashPowerMin: HASH_POWER_MIN,
            hashPowerMax: HASH_POWER_MAX,
            supply: GENESIS_SUPPLY,
            capsuleOpenCost: CAPSULE_OPEN_COST_DNG,
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
            // `WEEKLY_POOL_DNG` env var moves the cards and the tile together.
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
export function previewSnapshot(address, nowMs = Date.now(), poolDng = WEEKLY_POOL_DNG) {
    const base = emptySnapshot(nowMs, poolDng);
    const knights = previewGenesis(address, nowMs);
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
        board: neighbours.map((row) => ({ ...row, short: shortAddress(row.address), knights: 1 + Math.floor(rand() * 3) })),
        capsules: stockedCapsules,
        history,
        pool: { ...base.pool, awarded: 37 },
    }, nowMs);
}

// ----------------------------------------------------------------------------- chain
/**
 * The chain snapshot is not wired yet: the four Phase 2 contracts are not deployed, so
 * there is nothing to read. Rather than fabricate holdings, this reports the block
 * honestly and the page disables its write buttons with that reason.
 *
 * This is the seam the contract increment fills in — the shape above is the target.
 */
export function chainSnapshot(address, config, nowMs = Date.now()) {
    const base = emptySnapshot(nowMs, config?.poolDng ?? WEEKLY_POOL_DNG);
    return withShares({
        ...base,
        source: SOURCE_CHAIN,
        wallet: address,
        connected: true,
        canWrite: false,
        writeBlockedReason: config?.reason
            || 'The staking contracts are not deployed on this network yet, so this page is read-only.',
    }, nowMs);
}

/**
 * Load the vault for a wallet.
 *
 * `config` is `/api/staking/config`. When it reports addresses, the chain path is taken;
 * otherwise the deterministic preview stands in. A config fetch that fails is not an
 * error the player can act on — it falls back to preview and says so.
 */
export async function loadVault(address, { config, nowMs = Date.now(), fetchJson } = {}) {
    if (!address) return { ...emptySnapshot(nowMs), wallet: null, connected: false };

    let resolved = config;
    if (!resolved && typeof fetchJson === 'function') {
        try {
            resolved = await fetchJson('/api/staking/config');
        } catch {
            resolved = null;
        }
    }

    if (resolved?.chain) return chainSnapshot(address, resolved, nowMs);
    return previewSnapshot(address, nowMs, resolved?.poolDng ?? WEEKLY_POOL_DNG);
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
export function applyAction(snapshot, action, payload = {}, nowMs = Date.now()) {
    if (!snapshot?.connected) return { error: 'Connect a wallet first.' };
    if (!snapshot.canWrite) {
        return { error: snapshot.writeBlockedReason || 'This vault is read-only right now.' };
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
            if (snapshot.pool.dng === null) {
                return { error: 'The weekly pool is not set yet, so there is nothing to claim. Your share keeps accruing.' };
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
