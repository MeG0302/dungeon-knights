/**
 * Points Program storage.
 *
 * The Points Program used to live entirely in `localStorage`, which meant a referral
 * link opened on someone else's machine registered nothing, and the leaderboard could
 * only ever show wallets that had played in the same browser. This is the server side
 * of it: one record per wallet address, shared by everyone.
 *
 * Two drivers, chosen by environment so this works today and scales when you want it:
 *
 *   - **redis** — any Upstash-compatible REST endpoint. Set either pair and it is used:
 *       KV_REST_API_URL / KV_REST_API_TOKEN              (Vercel KV)
 *       UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (Upstash direct)
 *   - **file** — `.data/points.json` on disk. The default in development, so the whole
 *     thing runs end to end with no accounts and no credentials.
 *   - **memory** — used in production when no Redis is configured. It works, and it
 *     loses everything on redeploy; it logs loudly on every write. Deploying to Vercel
 *     without the env vars means ephemeral points.
 */

import { promises as fs } from 'fs';
import path from 'path';

const WALLET_PREFIX = 'dk:points:wallet:';
const BOARD_KEY = 'dk:points:board';
const GUARD_PREFIX = 'dk:points:guard:';
const FILE_PATH = path.join(process.cwd(), '.data', 'points.json');

export const STORAGE_DRIVER = (() => {
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) return 'redis';
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) return 'redis';
    return process.env.NODE_ENV === 'production' ? 'memory' : 'file';
})();

export function storageDescription() {
    if (STORAGE_DRIVER === 'redis') return 'Upstash/Vercel KV (REST)';
    if (STORAGE_DRIVER === 'file') return `local file ${FILE_PATH}`;
    return 'in-memory (NOT PERSISTENT — set KV_REST_API_URL + KV_REST_API_TOKEN)';
}

// ---------------------------------------------------------------------------- redis
function redisEnv() {
    if (process.env.KV_REST_API_URL) {
        return { url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN };
    }
    return { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN };
}

async function redis(...command) {
    const { url, token } = redisEnv();
    const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
        cache: 'no-store',
    });
    if (!res.ok) throw new Error(`points store: redis ${command[0]} failed (${res.status})`);
    const body = await res.json();
    if (body.error) throw new Error(`points store: redis ${command[0]} → ${body.error}`);
    return body.result;
}

async function redisPipeline(commands) {
    const { url, token } = redisEnv();
    const res = await fetch(`${url}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(commands),
        cache: 'no-store',
    });
    if (!res.ok) throw new Error(`points store: redis pipeline failed (${res.status})`);
    return (await res.json()).map((r) => r.result);
}

// ----------------------------------------------------------------------------- file
// One JSON document, read and written whole. At points-program scale (hundreds of
// wallets) that is a few kilobytes and rounds in well under a millisecond.
//
// Every read goes to disk. Caching the parsed document in a module-level variable looked
// like free speed, but it is exactly the wrong kind of speed: `next dev` can evaluate
// this module graph more than once (concurrent first requests to a not-yet-compiled
// route, then a recompile), and each copy then holds its own snapshot. A stale snapshot
// is not a slow answer, it is a *wrong* one — a wallet that had just cleared a floor was
// told "clear a floor before sharing". Measured on a cold dev server: all eight share
// requests in `tools/check-points-guard.js` were rejected, 7/9. Reading the file removes
// the whole class.
async function readFile() {
    try {
        return JSON.parse(await fs.readFile(FILE_PATH, 'utf8'));
    } catch {
        return { wallets: {} };
    }
}

async function writeFile(data) {
    await fs.mkdir(path.dirname(FILE_PATH), { recursive: true });
    await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2));
}

// -------------------------------------------------------------------------- memory
const memory = { wallets: {} };

// ----------------------------------------------------------------------- interface
export function normaliseAddress(address) {
    return typeof address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(address.trim())
        ? address.trim().toLowerCase()
        : null;
}

export function blankWallet(address) {
    return {
        address,
        points: 0,
        entries: 0,          // fully cleared vault entries
        levelsCleared: {},   // { 'YYYY-MM-DD': [0,1,2] }
        sharedOn: {},        // { 'YYYY-MM-DD': true }
        referrer: null,
        referrals: [],
        referralEarned: 0,   // points this wallet has been paid for referring others
        referralLedger: {},  // { refereeAddress: points paid to this wallet for them }
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
    };
}

/** Coerce anything read back from a driver into a complete record. */
function hydrate(raw, address) {
    if (!raw) return null;
    const doc = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { ...blankWallet(address), ...doc, address };
}

export async function getWallet(address) {
    const key = normaliseAddress(address);
    if (!key) return null;
    if (STORAGE_DRIVER === 'redis') return hydrate(await redis('GET', WALLET_PREFIX + key), key);
    if (STORAGE_DRIVER === 'memory') return hydrate(memory.wallets[key], key);
    const data = await readFile();
    return hydrate(data.wallets[key], key);
}

export async function putWallet(doc) {
    const key = normaliseAddress(doc.address);
    if (!key) throw new Error('putWallet needs a valid address');
    doc.address = key;
    doc.lastSeenAt = new Date().toISOString();

    if (STORAGE_DRIVER === 'redis') {
        await redisPipeline([
            ['SET', WALLET_PREFIX + key, JSON.stringify(doc)],
            // Keep the sorted-set index in step; this is what makes the leaderboard a
            // single ZREVRANGE instead of scanning every wallet.
            ['ZADD', BOARD_KEY, String(doc.points), key],
        ]);
        return doc;
    }
    if (STORAGE_DRIVER === 'memory') {
        memory.wallets[key] = doc;
        return doc;
    }
    const data = await readFile();
    data.wallets[key] = doc;
    await writeFile(data);
    return doc;
}

/**
 * Claim the right to run a once-per-day award, atomically.
 *
 * `updateWallet` is a read-modify-write, so two requests arriving at the same time both
 * read "floor 1 not cleared", both credit, and both record it. That is exactly what
 * happened in production: six concurrent re-clears of the same floor credited the wallet
 * five times, while the same thing run sequentially looks perfect. Measured before this
 * guard existed, on a deployment with no shared store:
 *
 *     six concurrent re-clears -> credited 100, 100, 100, 100, 0, 100, 0
 *
 * Returns true only for the caller that won the claim. Redis does it with `SET NX`, which
 * is atomic across every instance; the file and memory drivers are single-process, so a
 * local set is enough there (two dev servers on one machine would still race — that is a
 * development-only shape, production never runs that way).
 *
 * The TTL is the safety valve: if the process dies between claiming and recording, the
 * claim lapses and the player can try again, rather than being locked out of a floor they
 * were never paid for.
 */
export async function claimGuard(name, ttlSeconds = 600) {
    const key = GUARD_PREFIX + name;

    if (STORAGE_DRIVER === 'redis') {
        return (await redis('SET', key, '1', 'NX', 'EX', String(ttlSeconds))) === 'OK';
    }

    if (memoryGuards.has(key)) return false;
    memoryGuards.add(key);
    const timer = setTimeout(() => memoryGuards.delete(key), ttlSeconds * 1000);
    if (timer.unref) timer.unref();
    return true;
}

/** Release a claim that was taken but never acted on. */
export async function releaseGuard(name) {
    const key = GUARD_PREFIX + name;
    if (STORAGE_DRIVER === 'redis') {
        await redis('DEL', key);
        return;
    }
    memoryGuards.delete(key);
}

const memoryGuards = new Set();

/** Read-modify-write. Good enough for a points promotion; not a transaction. */
export async function updateWallet(address, mutator) {
    const key = normaliseAddress(address);
    if (!key) return null;
    const current = (await getWallet(key)) || blankWallet(key);
    const next = (await mutator(current)) || current;
    return putWallet(next);
}

/** Top wallets by points, newest records included. */
export async function topWallets(limit = 50) {
    if (STORAGE_DRIVER === 'file') {
        const data = await readFile();
        return Object.values(data.wallets)
            .map((w) => hydrate(w, w.address))
            .sort((a, b) => b.points - a.points)
            .slice(0, limit);
    }
    if (STORAGE_DRIVER === 'memory') {
        return Object.values(memory.wallets)
            .sort((a, b) => b.points - a.points)
            .slice(0, limit);
    }
    const flat = await redis('ZREVRANGE', BOARD_KEY, 0, String(limit - 1));
    const addresses = flat || [];
    if (!addresses.length) return [];
    const docs = await redisPipeline(addresses.map((a) => ['GET', WALLET_PREFIX + a]));
    return docs.map((raw, i) => hydrate(raw, addresses[i])).filter(Boolean);
}

/** 1-based position on the board, or null when the wallet is not on it. */
export async function rankOf(address) {
    const key = normaliseAddress(address);
    if (!key) return null;
    if (STORAGE_DRIVER === 'redis') {
        const rank = await redis('ZREVRANK', BOARD_KEY, key);
        return rank === null || rank === undefined ? null : Number(rank) + 1;
    }
    const all = STORAGE_DRIVER === 'file'
        ? Object.values((await readFile()).wallets)
        : Object.values(memory.wallets);
    const sorted = all.sort((a, b) => b.points - a.points);
    const index = sorted.findIndex((w) => w.address === key);
    return index === -1 ? null : index + 1;
}

export async function walletCount() {
    if (STORAGE_DRIVER === 'redis') return Number(await redis('ZCARD', BOARD_KEY)) || 0;
    const all = STORAGE_DRIVER === 'file'
        ? Object.values((await readFile()).wallets)
        : Object.values(memory.wallets);
    return all.length;
}

/** Test/dev helper: how many wallets the store is holding. */
export async function debugDump() {
    if (STORAGE_DRIVER === 'file') return (await readFile()).wallets;
    if (STORAGE_DRIVER === 'memory') return memory.wallets;
    const docs = await topWallets(200);
    return Object.fromEntries(docs.map((d) => [d.address, d]));
}

if (STORAGE_DRIVER === 'memory') {
    console.warn('[points-store] No Redis configured in production — points are in memory and will be lost. Set KV_REST_API_URL + KV_REST_API_TOKEN.');
}
