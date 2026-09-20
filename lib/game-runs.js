/**
 * Game run receipts.
 *
 * The claim path used to trust the browser completely: `dungeon-session.js` decided a
 * run had happened, wrote it to `localStorage`, and V3's `batchClaimRewards` paid
 * whatever it was handed as long as the wallet owned the knights and had runs left for
 * the day. Nothing on the way checked that a dungeon was ever played, or how long it
 * took — so a script could claim a full day's allowance in one transaction.
 *
 * This module is the missing gate. Two halves, both stateless:
 *
 *   1. **Run tokens.** When a dungeon starts, the client asks for a token. It is an
 *      HMAC over the address, the knight ids and the *server's* start time, so the
 *      browser cannot backdate a run. `complete` refuses to sign until the minimum
 *      time for that squad size has passed on our clock.
 *   2. **Receipts.** When the run finishes, the server prices it from on-chain rarity
 *      and signs exactly that (player, knights, dungeon, reward, nonce, expiry). V4
 *      verifies the signature and re-derives the reward itself, so a forged or
 *      generous receipt cannot overpay.
 *
 * The nonce is single-use *on chain* (`usedNonce`), which is why none of this needs a
 * database: the contract is the replay guard.
 *
 * Honest limit, stated so nobody mistakes it for more: this stops a script from paying
 * itself without playing, and it stops it from paying faster than the minimum time. It
 * cannot tell whether a human watched the knights. What it does mean is that cheating
 * costs at least as much time as playing, and the on-chain daily caps bound the total
 * either way.
 */

import crypto from 'crypto';
// `utils` and `Wallet` only — pure JavaScript. The provider would do its own network I/O,
// which is exactly the thing that does not survive being bundled into a Next server
// route, so the chain reads below go over plain `fetch` instead.
import { BigNumber, Wallet, utils } from 'ethers';

// ------------------------------------------------------------------------------- chain
// Public values, so they can be overridden by env when the contracts move without a
// code change. `GAME_CONTRACT_V4` empty means "not deployed yet" and everything that
// needs it degrades to the legacy path instead of failing.
export const CHAIN = {
    id: Number(process.env.GAME_CHAIN_ID || 46630),
    rpc: process.env.GAME_RPC_URL || 'https://rpc.testnet.chain.robinhood.com',
    explorer: process.env.GAME_EXPLORER_URL || 'https://explorer.testnet.chain.robinhood.com',
};

export const ADDRESSES = {
    knightNFT: process.env.KNIGHT_NFT_ADDRESS || '0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512',
    dngToken: process.env.DNG_TOKEN_ADDRESS || '0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910',
    gameV3: process.env.GAME_CONTRACT_V3 || '0xD8de9385Db7DfE925882E76849B6e067e47236e5',
    gameV4: (process.env.GAME_CONTRACT_V4 || '').trim(),
};

const IFACE = new utils.Interface([
    'function ownerOf(uint256 tokenId) view returns (address)',
    'function getKnightInfo(uint256 tokenId) view returns (address owner, uint8 rarity, string rarityName)',
    'function rarityReward(uint256) view returns (uint256)',
    'function runsRemaining(uint256 knightId) view returns (uint8)',
    'function paused() view returns (bool)',
    'function trustedSigner() view returns (address)',
]);

let rpcId = 1;

/** One JSON-RPC call. Throws with the node's own message rather than a generic failure. */
export async function rpc(method, params) {
    const res = await fetch(CHAIN.rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
        cache: 'no-store',
    });
    if (!res.ok) throw new Error(`${method} failed with HTTP ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(`${method}: ${body.error.message || JSON.stringify(body.error)}`);
    return body.result;
}

/** A read-only contract call, ABI-encoded by ethers' pure utilities. */
async function call(to, fn, args) {
    const data = IFACE.encodeFunctionData(fn, args);
    const result = await rpc('eth_call', [{ to, data }, 'latest']);
    return IFACE.decodeFunctionResult(fn, result);
}

/**
 * Many JSON-RPC requests in one HTTP POST.
 *
 * Two things about this endpoint are measured rather than assumed, and both shaped this
 * function. A batch of 50 `eth_call`s comes back in one 200; a batch of 100 comes back **429**
 * — so the ceiling is real and the reader has to respect it rather than discover it in
 * production. And because a 429 is a routine answer here rather than an exception, a single
 * throttled batch must not fail the read: it retries with a widening pause.
 *
 * Returns one entry per request, in order, each either `{ result }` or `{ error }`. A revert is
 * **not** an exception — for a reader asking whether token #78 exists, "execution reverted" is
 * the answer, so the caller decides what an error means. A row missing from the response becomes
 * an explicit error entry rather than `undefined`, so a short reply cannot be mistaken for a
 * negative result.
 */
export async function rpcBatch(requests, { attempts = 4, pauseMs = 900 } = {}) {
    if (!requests.length) return [];

    const body = JSON.stringify(requests.map((request, index) => ({
        jsonrpc: '2.0',
        id: index + 1,
        method: request.method,
        params: request.params,
    })));

    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        let response;
        try {
            response = await fetch(CHAIN.rpc, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                cache: 'no-store',
            });
        } catch (error) {
            lastError = error;
            if (attempt === attempts) break;
            await new Promise((resolve) => setTimeout(resolve, pauseMs * attempt));
            continue;
        }

        if (response.status === 429) {
            lastError = new Error('the chain node is rate limiting (HTTP 429)');
            if (attempt === attempts) break;
            // Exponential with jitter: this node throttles after a handful of calls and the
            // window is not published, so a fixed pause synchronised across concurrent readers
            // is the worst thing to send at it. Measured pauses of 800ms and 1.6s were too short
            // to clear it, which is how a page load ended up reporting an unreadable chain.
            const wait = pauseMs * (2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
            await new Promise((resolve) => setTimeout(resolve, wait));
            continue;
        }
        if (!response.ok) {
            lastError = new Error(`batch failed with HTTP ${response.status}`);
            break;
        }

        let payload;
        try {
            payload = await response.json();
        } catch (error) {
            lastError = error;
            break;
        }

        // A batch of one is allowed to come back as a bare object rather than an array, and a
        // throttled reply comes back as a single error object too — both are normalised here so
        // no caller has to care which shape arrived.
        const rows = new Map();
        for (const row of Array.isArray(payload) ? payload : [payload]) {
            if (row && row.id !== undefined) rows.set(row.id, row);
        }

        return requests.map((request, index) => {
            const row = rows.get(index + 1);
            if (!row) return { error: { message: 'the node returned no response for this request' } };
            return row.error ? { error: row.error } : { result: row.result };
        });
    }

    throw lastError || new Error('batch failed');
}

// ----------------------------------------------------------------------------- dungeons
export const DUNGEONS = {
    1: { key: 'crypts', name: 'Forgotten Crypts' },
    2: { key: 'mines', name: 'Goblin Mines' },
    3: { key: 'temple', name: 'Overgrown Temple' },
    4: { key: 'magma', name: 'Magma Chambers' },
    5: { key: 'void', name: 'Void Rift' },
};

// ------------------------------------------------------------------ the minimum time
// Mirrors KNIGHT-SCALING.md: baseTime / √knights, floored at 30s. A single knight has
// to be in the dungeon for five minutes; a full squad of fifteen, 77 seconds. Measured
// on the server's clock, which is the point.
const MIN_BASE_SECONDS = Number(process.env.GAME_MIN_BASE_SECONDS || 300);
export const MIN_FLOOR_SECONDS = Number(process.env.GAME_MIN_FLOOR_SECONDS || 30);
export const RUN_TOKEN_TTL_SECONDS = 6 * 60 * 60;

export function minSecondsFor(knightCount) {
    const n = Math.max(1, Number(knightCount) || 1);
    return Math.max(MIN_FLOOR_SECONDS, Math.round(MIN_BASE_SECONDS / Math.sqrt(n)));
}

// ------------------------------------------------------------------------- secrets
function runSecret() {
    if (process.env.GAME_RUN_SECRET) return process.env.GAME_RUN_SECRET;
    if (process.env.POINTS_SESSION_SECRET) return process.env.POINTS_SESSION_SECRET;
    if (process.env.NODE_ENV !== 'production') return 'dev-only-game-run-secret';
    return null;
}

export function signerWallet() {
    const key = (process.env.GAME_SIGNER_PRIVATE_KEY || '').trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
    return new Wallet(key);
}

/** The address the backend signs with, for comparing against the contract's. */
export function signerAddress() {
    const wallet = signerWallet();
    return wallet ? wallet.address.toLowerCase() : null;
}

export function signingReady() {
    return !!ADDRESSES.gameV4 && !!signerWallet();
}

// ---------------------------------------------------------------------- run tokens
export function issueRunToken({ address, knightIds, dungeonId }) {
    const secret = runSecret();
    if (!secret) return null;

    const startedAt = Math.floor(Date.now() / 1000);
    const claims = [
        address.toLowerCase(),
        knightIds.join(','),
        String(dungeonId),
        String(startedAt),
    ].join('|');
    // The MAC covers the *encoded* payload — the exact string that travels — so the
    // reader can verify it before decoding anything. Hashing the plaintext here and the
    // encoded form there would reject every token for no visible reason.
    const payload = Buffer.from(claims, 'utf8').toString('base64url');
    const mac = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    return {
        token: `${payload}.${mac}`,
        startedAt,
        minSeconds: minSecondsFor(knightIds.length),
    };
}

export function readRunToken(token) {
    const secret = runSecret();
    if (!secret || typeof token !== 'string') return null;

    const [payload, mac] = token.split('.');
    if (!payload || !mac) return null;

    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const a = Buffer.from(mac, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    try {
        const [address, knights, dungeonId, startedAt] = Buffer.from(payload, 'base64url').toString('utf8').split('|');
        if (!/^0x[0-9a-f]{40}$/.test(address)) return null;
        const knightIds = knights ? knights.split(',').map(Number) : [];
        const started = Number(startedAt);
        if (!knightIds.length || !Number.isFinite(started)) return null;
        if (Math.floor(Date.now() / 1000) - started > RUN_TOKEN_TTL_SECONDS) return null;
        return { address, knightIds, dungeonId: Number(dungeonId), startedAt: started };
    } catch {
        return null;
    }
}

// ------------------------------------------------------------------- chain validation
/**
 * Ownership, rarity and remaining daily runs for a squad, read straight from the chain.
 * Returns { ok, reason, knights: [{ id, rarity }], reward }.
 */
export async function inspectSquad({ address, knightIds, gameAddress }) {
    const target = gameAddress || ADDRESSES.gameV4;
    if (!target) return { ok: false, reason: 'the game contract is not configured' };

    let rewards;
    try {
        rewards = await Promise.all(
            [0, 1, 2, 3, 4].map((i) => call(target, 'rarityReward', [i]).then((r) => r[0]))
        );
    } catch (error) {
        // Logged, not returned: the player gets a plain refusal, the log gets the cause.
        console.warn(`[game-runs] reward table read failed: ${error.message || error}`);
        return { ok: false, reason: 'could not read the reward table from the chain' };
    }

    const knights = [];
    let reward = BigNumber.from(0);

    for (const knightId of knightIds) {
        let owner;
        let rarity;
        try {
            [owner, rarity] = await call(ADDRESSES.knightNFT, 'getKnightInfo', [knightId]);
        } catch (error) {
            console.warn(`[game-runs] knight #${knightId} read failed: ${error.message || error}`);
            return { ok: false, reason: `could not validate knight #${knightId} on chain` };
        }

        if (owner.toLowerCase() !== address.toLowerCase()) {
            return { ok: false, reason: `knight #${knightId} is not owned by this wallet` };
        }
        if (Number(rarity) >= rewards.length) {
            return { ok: false, reason: `knight #${knightId} has an unknown rarity on chain` };
        }

        try {
            const [remaining] = await call(target, 'runsRemaining', [knightId]);
            if (Number(remaining) < 1) {
                return { ok: false, reason: `knight #${knightId} has no runs left today` };
            }
        } catch (error) {
            console.warn(`[game-runs] runsRemaining(${knightId}) failed: ${error.message || error}`);
            return { ok: false, reason: `could not check knight #${knightId}'s remaining runs` };
        }

        knights.push({ id: knightId, rarity: Number(rarity) });
        reward = reward.add(rewards[Number(rarity)]);
    }

    return { ok: true, knights, reward };
}

// ----------------------------------------------------------------------- receipts
/**
 * Sign one run. `reward` is priced here from on-chain rarity — never taken from the
 * client — and V4 re-derives it again, so the two can only agree or revert.
 */
export async function buildReceipt({ address, knightIds, dungeonId, reward }) {
    const wallet = signerWallet();
    if (!wallet || !ADDRESSES.gameV4) return null;

    const nonce = `0x${crypto.randomBytes(32).toString('hex')}`;
    const expiry = Math.floor(Date.now() / 1000) + Number(process.env.GAME_RECEIPT_TTL_SECONDS || 900);

    const hash = utils.keccak256(utils.defaultAbiCoder.encode(
        ['address', 'bytes32', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'address'],
        [
            address,
            utils.solidityKeccak256(['uint256[]'], [knightIds]),
            dungeonId,
            reward,
            nonce,
            expiry,
            CHAIN.id,
            ADDRESSES.gameV4,
        ]
    ));
    const signature = await wallet.signMessage(utils.arrayify(hash));

    return {
        knightIds,
        dungeonId,
        reward: reward.toString(),
        nonce,
        expiry,
        signature,
        hash,
        signer: wallet.address,
    };
}

// ------------------------------------------------------------------------ reporting
export function chainDescription() {
    return {
        chainId: CHAIN.id,
        explorer: CHAIN.explorer,
        knightNFT: ADDRESSES.knightNFT,
        dngToken: ADDRESSES.dngToken,
        gameV3: ADDRESSES.gameV3,
        gameV4: ADDRESSES.gameV4 || null,
        signer: signerAddress(),
    };
}
