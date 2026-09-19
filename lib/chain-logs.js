/**
 * The game's history, read from the chain itself.
 *
 * Every claim and every completed run is an event on the game contract, so the Hall of
 * Fame and a player's claim history are both a `eth_getLogs` query away — no indexer, no
 * database, nothing to keep in sync. Two things this module exists to get right, because
 * the previous client-side attempt got both wrong:
 *
 *   - **The event signature has to match the contract exactly.** `public/leaderboard.js`
 *     queried `DungeonCompleted(address,uint256,uint256,uint256,uint256,uint256)`, but the
 *     contract emits `(address,uint256,uint256,uint8,uint256,uint256)` — a different topic
 *     hash, so it silently matched nothing and the board said "no claims yet" forever. The
 *     interface below is written from the contract source, and `tools/check-logs.js`
 *     re-encodes logs with it to prove the round trip.
 *   - **Reads belong on the server.** A 121-million-block `getLogs` sweep from a browser
 *     competes with the game for the player's bandwidth and dies on RPC CORS. The routes
 *     under `app/api/game/` do the sweep and hand back a small, cached summary.
 *
 * The sweep is chunked: a node with a block-range cap answers a too-wide query with an
 * error or, worse, a truncated result, so a wide range is split into windows and the
 * pieces are stitched back together.
 */

import { utils } from 'ethers';
import { ADDRESSES, CHAIN, DUNGEONS, rpc } from './game-runs.js';

const IFACE = new utils.Interface([
    // Copied from contracts/DungeonKnightsGameV3-Simple.sol (and V4, which reuses both).
    'event DungeonCompleted(address indexed player, uint256 indexed knightId, uint256 indexed dungeonId, uint8 rarity, uint256 reward, uint256 timestamp)',
    'event RewardsClaimed(address indexed player, uint256 amount, uint256 runsCount, uint256 knightCount)',
]);

const TOPIC = {
    DungeonCompleted: IFACE.getEventTopic('DungeonCompleted'),
    RewardsClaimed: IFACE.getEventTopic('RewardsClaimed'),
};

/** The exact topic hashes this build filters on. Exported so a test can pin them. */
export const EVENT_TOPICS = { ...TOPIC };

/** The signatures those hashes come from, written from the contract source. */
export const EVENT_SIGNATURES = {
    DungeonCompleted: 'DungeonCompleted(address,uint256,uint256,uint8,uint256,uint256)',
    RewardsClaimed: 'RewardsClaimed(address,uint256,uint256,uint256)',
};

/** Fallback window size, used only when a node refuses a wide `eth_getLogs` outright. */
const CHUNK = 20000;

/**
 * Where each contract starts, cached per process.
 *
 * This is what keeps the sweep cheap: the chain is 121 million blocks tall, so walking it
 * in windows from block 0 is thousands of RPC calls, and a `eth_getCode` binary search is
 * about twenty-seven. `GAME_FROM_BLOCK` skips even those when the answer is known.
 */
const FIRST_BLOCK = new Map();

/** How far back a windowed sweep will reach when the contract's start cannot be found. */
const LOOKBACK = Number(process.env.GAME_LOOKBACK_BLOCKS || 1_000_000);

/** Is there at least one log for this contract in the range? */
async function hasLogsIn(address, from, to) {
    const logs = await rpc('eth_getLogs', [{ address, fromBlock: hex(from), toBlock: hex(to) }]);
    return Array.isArray(logs) && logs.length > 0;
}

/**
 * The block the contract's history begins at, found by bisecting on its own logs.
 *
 * Not `eth_getCode` at a historical block: this chain's public RPC does not keep historical
 * state (`eth_getCode` at an old block answers "historical state … is not available"), which
 * is what this did first and what made the board come back empty. Logs are indexed and
 * queryable at any range, so the question "is there any log at or after block B?" is
 * answerable — and it is monotone, so ~27 probes find the first one.
 *
 * Only reached when a single wide query is refused; the fast path is one call.
 */
async function firstBlockFor(address, latest) {
    const fromEnv = Number(process.env.GAME_FROM_BLOCK);
    if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
    if (FIRST_BLOCK.has(address)) return FIRST_BLOCK.get(address);

    try {
        // "is there a log at or before block B?" — true from the first event onwards, which
        // makes it the monotone question to bisect on.
        if (!(await hasLogsIn(address, 0, latest))) {
            FIRST_BLOCK.set(address, latest);
            return latest;
        }
        let low = 0;
        let high = latest;
        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            // eslint-disable-next-line no-await-in-loop
            if (await hasLogsIn(address, 0, mid)) high = mid;
            else low = mid + 1;
        }
        FIRST_BLOCK.set(address, low);
        return low;
    } catch (error) {
        const fallback = Math.max(0, latest - LOOKBACK);
        console.warn(`[chain-logs] could not find where ${address} starts (${String(error.message || error).slice(0, 100)}); `
            + `sweeping the last ${LOOKBACK} blocks instead — set GAME_FROM_BLOCK to be exact`);
        FIRST_BLOCK.set(address, fallback);
        return fallback;
    }
}

/**
 * Logs for a range: one call when the node allows it, windows when it does not.
 *
 * The wide query is tried first because it is what this RPC answers best — a single
 * full-range call returns the game's whole history — and the windowed sweep exists because
 * a capped node answers a too-wide range with an error. A node that answered one with a
 * silently truncated result would be worse than either.
 */
async function logsFor(address, topics, from, latest) {
    if (from <= latest) {
        try {
            const one = await rpc('eth_getLogs', [{ address, fromBlock: hex(from), toBlock: hex(latest), topics }]);
            if (Array.isArray(one)) return one;
        } catch (error) {
            console.warn(`[chain-logs] wide getLogs refused (${String(error.message || error).slice(0, 120)}); sweeping windows`);
        }
    }

    const start = await firstBlockFor(address, latest);
    const out = [];
    for (let block = start; block <= latest; block += CHUNK) {
        const to = Math.min(block + CHUNK - 1, latest);
        // eslint-disable-next-line no-await-in-loop
        const chunk = await rpc('eth_getLogs', [{ address, fromBlock: hex(block), toBlock: hex(to), topics }]);
        if (Array.isArray(chunk)) out.push(...chunk);
    }
    return out;
}
const RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];

const hex = (n) => `0x${Number(n).toString(16)}`;

/**
 * Both live contracts, newest first. V4 is empty until it is deployed, and the board then
 * follows the deployment on its own instead of needing a code change.
 */
export function gameAddresses() {
    return [ADDRESSES.gameV4, ADDRESSES.gameV3].filter(Boolean);
}

export async function blockNumber() {
    return parseInt(await rpc('eth_blockNumber', []), 16);
}

/** Block timestamps, cached: a claim event carries no time of its own. */
const blockTimes = new Map();
async function timestampOf(block) {
    if (blockTimes.has(block)) return blockTimes.get(block);
    try {
        const header = await rpc('eth_getBlockByNumber', [hex(block), false]);
        const seconds = header?.timestamp ? parseInt(header.timestamp, 16) : null;
        blockTimes.set(block, seconds);
        return seconds;
    } catch {
        blockTimes.set(block, null);
        return null;
    }
}

/**
 * Every matching log, decoded by name.
 *
 * `player` filters on the indexed first argument, which is how a wallet's own history is
 * fetched without sweeping the chain and filtering afterwards. A log that will not decode
 * is dropped rather than thrown: a stranger's event can never break the board.
 */
export async function readEventLogs(eventName, { address, player = null, fromBlock = null, toBlock = 'latest' } = {}) {
    const topic0 = TOPIC[eventName];
    if (!topic0) throw new Error(`unknown event: ${eventName}`);
    if (!address) throw new Error(`${eventName} needs a contract address`);

    const latest = toBlock === 'latest' ? await blockNumber() : Number(toBlock);
    const topics = player ? [topic0, utils.hexZeroPad(player.toLowerCase(), 32)] : [topic0];
    const start = fromBlock === null ? 0 : Number(fromBlock);

    const raw = await logsFor(address, topics, start, latest);

    const decoded = [];
    for (const log of raw) {
        try {
            const args = IFACE.decodeEventLog(eventName, log.data, log.topics);
            decoded.push({
                event: eventName,
                contract: String(log.address || address).toLowerCase(),
                player: String(args.player).toLowerCase(),
                block: parseInt(log.blockNumber, 16),
                txHash: log.transactionHash,
                ...(eventName === 'RewardsClaimed'
                    ? {
                        amount: args.amount,
                        runsCount: Number(args.runsCount),
                        knightCount: Number(args.knightCount),
                    }
                    : {
                        knightId: Number(args.knightId),
                        dungeonId: Number(args.dungeonId),
                        rarity: Number(args.rarity),
                        reward: args.reward,
                        timestamp: Number(args.timestamp),
                    }),
            });
        } catch {
            // A different event with a colliding prefix, or a log this build cannot read.
        }
    }
    return decoded.sort((a, b) => a.block - b.block);
}

/** Search every live contract for one event. */
export async function readAll(eventName, options = {}) {
    const found = [];
    for (const address of gameAddresses()) {
        try {
            found.push(...await readEventLogs(eventName, { ...options, address }));
        } catch (error) {
            // A missing or unreachable contract must not take the whole board down.
            console.warn(`[chain-logs] ${eventName} on ${address}: ${error.message || error}`);
        }
    }
    return found.sort((a, b) => a.block - b.block);
}

const asDng = (wei) => Number(utils.formatEther(wei));

/**
 * The Hall of Fame: DNG actually paid out, ranked.
 *
 * `RewardsClaimed` is the event that matters here rather than `DungeonCompleted` — it is
 * emitted once per payout, after the transfer, so it is what has really left the treasury.
 * 900 DNG of runs that were never claimed is not an achievement yet.
 */
export async function claimedBoard({ limit = 25 } = {}) {
    const claims = await readAll('RewardsClaimed');
    const byPlayer = new Map();

    for (const claim of claims) {
        const entry = byPlayer.get(claim.player) || {
            address: claim.player, totalRewards: 0, claimCount: 0, runs: 0, knights: 0, lastBlock: 0,
        };
        entry.totalRewards += asDng(claim.amount);
        entry.claimCount += 1;
        entry.runs += claim.runsCount;
        entry.knights += claim.knightCount;
        entry.lastBlock = Math.max(entry.lastBlock, claim.block);
        byPlayer.set(claim.player, entry);
    }

    const sorted = [...byPlayer.values()].sort((a, b) => b.totalRewards - a.totalRewards);
    return {
        rows: sorted.slice(0, limit),
        players: sorted.length,
        claims: claims.length,
        totalClaimed: sorted.reduce((sum, row) => sum + row.totalRewards, 0),
        chain: { id: CHAIN.id, mainnet: false },
    };
}

/** One wallet's history, from the same logs: what it was paid, and what it ran. */
export async function historyFor(address, { limit = 50 } = {}) {
    const key = typeof address === 'string' ? address.trim().toLowerCase() : null;
    if (!/^0x[0-9a-f]{40}$/.test(key || '')) return null;

    const [claims, runs] = await Promise.all([
        readAll('RewardsClaimed', { player: key }),
        readAll('DungeonCompleted', { player: key }),
    ]);

    const claimsOut = [];
    for (const claim of claims) {
        claimsOut.push({
            amount: asDng(claim.amount),
            runsCount: claim.runsCount,
            knightCount: claim.knightCount,
            block: claim.block,
            txHash: claim.txHash,
            at: await timestampOf(claim.block),
        });
    }

    return {
        address: key,
        totals: {
            claimed: claimsOut.reduce((sum, c) => sum + c.amount, 0),
            claims: claimsOut.length,
            runs: runs.length,
            knightsPaid: claims.reduce((sum, c) => sum + c.knightCount, 0),
        },
        claims: claimsOut.reverse().slice(0, limit),
        runs: runs.map((run) => ({
            knightId: run.knightId,
            dungeonId: run.dungeonId,
            dungeon: DUNGEONS[run.dungeonId]?.name || `Dungeon ${run.dungeonId}`,
            rarity: RARITIES[run.rarity] || 'Unknown',
            reward: asDng(run.reward),
            at: run.timestamp,
            txHash: run.txHash,
        })).reverse().slice(0, limit),
        chain: { id: CHAIN.id, explorer: CHAIN.explorer },
    };
}
