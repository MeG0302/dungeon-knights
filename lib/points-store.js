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
import { randomInt } from 'crypto';
import path from 'path';
import { REF_CODE_ALPHABET, REF_CODE_LENGTH, normaliseRefCode, isDayKey } from './points-config.js';

const WALLET_PREFIX = 'dk:points:wallet:';
const BOARD_KEY = 'dk:points:board';
// The board for **one UTC day**, which is what the capsule draw ranks. A sorted set per day rather
// than a field on the wallet for the reason the lifetime board is one: the question asked of it is
// "who is on top", and a per-wallet record cannot answer that without walking every wallet — which
// production, reached over a REST KV, cannot do at all. The day is in the key, so a new day is a new
// set and yesterday's is left exactly as it was for the draw to read.
const DAY_BOARD_PREFIX = 'dk:points:day:';
// When each wallet was last credited on that day, which is what breaks a tie in the draw. A separate
// key rather than a field on the wallet for the reason the board itself is one: it is a fact about
// **the day**, written by the same call that ranks it, so the score and the stamp can never be read
// from two places that disagree. Redis gets a hash (no score to carry it); the document drivers keep
// it beside the points in `days`, where there is room for both.
const DAY_STAMP_PREFIX = 'dk:points:daystamp:';
// A day board is only read for as long as a draw might still settle for it. Thirty-five days is
// generous headroom over the seven a late settlement could plausibly need, and it keeps the keyspace
// from growing by one sorted set per day forever.
const DAY_BOARD_TTL_SECONDS = 35 * 24 * 60 * 60;
const GUARD_PREFIX = 'dk:points:guard:';
// An index, not a wallet record: "which wallet claimed this X account". One direction only, and
// the reverse lookup (a wallet's own handle) is a field on the wallet itself.
const XINDEX_PREFIX = 'dk:points:xindex:';
// The same shape for the five-character invite code: code → wallet. The reverse (`a wallet's own
// code`) is `refCode` on the wallet, exactly as the handle is. It has to be an index rather than a
// derivation from the address, because a code is what a player types in: resolving one means
// looking something up, and 28.6M possible codes is too few to hand out without a uniqueness check.
const REFCODE_PREFIX = 'dk:points:refcode:';
/**
 * Indexes whose **value** is the wallet, so a purge can find them without being told their keys.
 * See `walletKeys` — this list is the one place a new value-indexed key shape has to be declared.
 */
const VALUE_INDEXES = [XINDEX_PREFIX, REFCODE_PREFIX];

/** How many codes to try before giving up. A collision is retried, never resolved by sharing. */
const REF_CODE_ATTEMPTS = 12;
// What X has told us about an account's relationship to ours. Two keys per fact — see
// `recordFollowFact` — because a wallet can be bound by account id *or* by typed handle, and the
// fact is worth finding either way.
const FOLLOW_ID_PREFIX = 'dk:points:follow:id:';
const FOLLOW_HANDLE_PREFIX = 'dk:points:follow:h:';
// Claims waiting on their review window. A plain member set of `<task>:<address>`, because the only
// question ever asked of it is "what is still waiting" — and the answer has to be complete, which is
// exactly what a Redis ZSET of top wallets cannot give (see `debugDump`, which is a dev helper for
// the file driver and nothing more).
const PENDING_KEY = 'dk:points:pending';
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
function dayBoardKey(day) {
    return DAY_BOARD_PREFIX + (isDayKey(day) || '');
}

function dayStampKey(day) {
    return DAY_STAMP_PREFIX + (isDayKey(day) || '');
}

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

/**
 * Every key matching a pattern, cursor by cursor. Only used by maintenance (see `purgeWallet`).
 *
 * `KEYS` would be one round trip and would block the server for every other player while it walks
 * the keyspace, so it is not used here even for a handful of keys.
 */
async function redisScan(pattern) {
    const found = [];
    let cursor = '0';
    do {
        const [next, batch] = await redis('SCAN', cursor, 'MATCH', pattern, 'COUNT', '1000');
        cursor = String(next);
        if (Array.isArray(batch)) found.push(...batch);
    } while (cursor !== '0');
    return found;
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
        return { wallets: {}, indexes: {}, days: {} };
    }
}

/**
 * The day boards, for the two drivers that keep everything in one document.
 *
 * Shape: `{ 'YYYY-MM-DD': { '0xwallet': { points, at } } }` — the same two facts the Redis sorted
 * set carries (a score, and the moment it was last added to), held together because the file driver
 * has no scores to sort by. `at` is what breaks a tie in the draw, and it is a fact about the day's
 * board rather than about the wallet, so it lives here and not in the sorted set. The caller writes
 * back through `writeDays`, since a read-modify-write across two functions is the only shape these
 * drivers offer (they are single-process; production is on Redis).
 */
async function readDays() {
    if (STORAGE_DRIVER === 'memory') return memory.days;
    const data = await readFile();
    data.days = data.days || {};
    return data.days;
}

async function writeDays(days) {
    if (STORAGE_DRIVER === 'memory') {
        memory.days = days;
        return;
    }
    const data = await readFile();
    data.days = days;
    await writeFile(data);
}

async function writeFile(data) {
    await fs.mkdir(path.dirname(FILE_PATH), { recursive: true });
    await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2));
}

// -------------------------------------------------------------------------- memory
const memory = { wallets: {}, indexes: {}, days: {} };

// ------------------------------------------------------------------ indexes (one owner)
/**
 * A tiny key → value map, because "one X account, one wallet" is not a property of any single
 * wallet record: it is a claim two wallets can both try to make at once.
 *
 * Redis gets `SET … NX`, which is atomic across every instance. The file and memory drivers are
 * single-process, so a read-then-write is enough there — production never runs that way, and a
 * local race costs a duplicate binding, not points.
 */
async function indexRead(prefix, id) {
    const key = prefix + id;
    if (STORAGE_DRIVER === 'redis') return (await redis('GET', key)) || null;
    if (STORAGE_DRIVER === 'memory') return memory.indexes[key] || null;
    const data = await readFile();
    return data.indexes?.[key] || null;
}

async function indexWrite(prefix, id, value, { onlyIfFree = false } = {}) {
    const key = prefix + id;
    if (STORAGE_DRIVER === 'redis') {
        if (!onlyIfFree) {
            await redis('SET', key, value);
            return true;
        }
        return (await redis('SET', key, value, 'NX')) === 'OK';
    }
    if (STORAGE_DRIVER === 'memory') {
        if (onlyIfFree && memory.indexes[key]) return false;
        memory.indexes[key] = value;
        return true;
    }
    const data = await readFile();
    data.indexes = data.indexes || {};
    if (onlyIfFree && data.indexes[key]) return false;
    data.indexes[key] = value;
    await writeFile(data);
    return true;
}

async function indexDelete(prefix, id) {
    const key = prefix + id;
    if (STORAGE_DRIVER === 'redis') {
        await redis('DEL', key);
        return;
    }
    if (STORAGE_DRIVER === 'memory') {
        delete memory.indexes[key];
        return;
    }
    const data = await readFile();
    if (data.indexes) delete data.indexes[key];
    await writeFile(data);
}

/* ============================================================ shared documents
 *
 * A few records belong to nobody in particular — the review queue above is one, and the one-time
 * tasks the owner publishes after the code shipped are another. Each is a single JSON document,
 * written by a tool and read by every process, so they ride the three drivers that already exist
 * rather than growing a second storage story: same file in development, same KV in production,
 * same "in memory, and it will not last" when neither is configured.
 *
 * The key is the caller's, which is why these are generic: the alternative is one of these per
 * feature, all four identical, and the fifth one written from scratch by whoever forgets.
 */
export function documentRead(key) {
    return indexRead('', String(key || ''));
}

export function documentWrite(key, value) {
    return indexWrite('', String(key || ''), value);
}

export function documentDelete(key) {
    return indexDelete('', String(key || ''));
}

// --------------------------------------------------------------- the X binding index
/** Which wallet holds this X account, if any. */
export async function xBindingOwner(xid) {
    const id = String(xid || '').trim();
    if (!id) return null;
    return normaliseAddress(await indexRead(XINDEX_PREFIX, id));
}

/**
 * Claim an X account for a wallet, or report who already holds it.
 *
 * Returns `{ ok: true, owner }` when this wallet holds it (whether it just took it or already
 * had it) and `{ ok: false, owner }` when another wallet does. Deciding what to do about that
 * other wallet — a provisional binding can be taken over by a proved one — is the program's job,
 * not the store's: it is a rule about points, not about storage.
 */
export async function claimXBinding(xid, address) {
    const id = String(xid || '').trim();
    const key = normaliseAddress(address);
    if (!id || !key) return { ok: false, owner: null };

    const owner = await xBindingOwner(id);
    if (owner && owner !== key) return { ok: false, owner };
    await indexWrite(XINDEX_PREFIX, id, key);
    return { ok: true, owner: key };
}

/** Hand an account back. Only the wallet holding it may, unless `force` says otherwise. */
export async function releaseXBinding(xid, address, { force = false } = {}) {
    const id = String(xid || '').trim();
    const key = normaliseAddress(address);
    const owner = await xBindingOwner(id);
    if (!force && owner && key && owner !== key) return { ok: false, owner };
    await indexDelete(XINDEX_PREFIX, id);
    return { ok: true };
}

// ------------------------------------------------------------------ the invite code
/** Which wallet holds this code, if any. */
export async function refCodeOwner(code) {
    const normalised = normaliseRefCode(code);
    if (!normalised) return null;
    return normaliseAddress(await indexRead(REFCODE_PREFIX, normalised));
}

/**
 * Claim a code for a wallet, or report who already holds it.
 *
 * The same contract as `claimXBinding`: `{ ok: true }` when this wallet holds it (just now or
 * already), `{ ok: false, owner }` when another wallet does. What to do about that — refuse, or try
 * another code — is the program's decision, not the store's.
 *
 * Redis gets `SET … NX`, so two wallets minting at the same instant cannot both win; the loser is
 * told whose it is and draws again.
 */
export async function claimRefCode(code, address) {
    const normalised = normaliseRefCode(code);
    const key = normaliseAddress(address);
    if (!normalised || !key) return { ok: false, owner: null };

    const owner = await refCodeOwner(normalised);
    if (owner === key) return { ok: true, owner: key };
    if (owner) return { ok: false, owner };

    if (await indexWrite(REFCODE_PREFIX, normalised, key, { onlyIfFree: true })) return { ok: true, owner: key };
    return { ok: false, owner: await refCodeOwner(normalised) };
}

/**
 * Ensure this wallet has a code, and give it back.
 *
 * Idempotent, and safe to call on every read that renders the code — which is what makes it work
 * for the wallets that were here before codes existed: the next page load is when they get one.
 *
 * The index, not the wallet record, is the authority, so the two are reconciled rather than
 * trusted: a record whose code the index has lost reclaims it, and a record whose code now belongs
 * to somebody else — which a race alone could produce — draws a fresh one instead of showing the
 * player a code that credits another wallet.
 */
export async function assignRefCode(address) {
    const key = normaliseAddress(address);
    if (!key) return null;
    // A wallet that has never been written yet is the *normal* case here, not a missing one: this is
    // reached from the read that renders the code, and a player's first page load — before they have
    // earned anything — is exactly when they need one to hand out. Bailing on a missing record made
    // the code appear only after some other award had created the wallet, which is the opposite of
    // what an invite is for. `updateWallet` below creates the record from `blankWallet`.
    const doc = (await getWallet(key)) || blankWallet(key);

    if (doc.refCode) {
        const owner = await refCodeOwner(doc.refCode);
        if (owner === key) return doc.refCode;
        if (owner === null && (await claimRefCode(doc.refCode, key)).ok) return doc.refCode;
    }

    for (let attempt = 0; attempt < REF_CODE_ATTEMPTS; attempt += 1) {
        let candidate = '';
        for (let i = 0; i < REF_CODE_LENGTH; i += 1) {
            // `randomInt` rather than `Math.random`: a code is not a secret, but there is no reason
            // for the next one to be guessable from the last.
            candidate += REF_CODE_ALPHABET[randomInt(REF_CODE_ALPHABET.length)];
        }
        if (!(await claimRefCode(candidate, key)).ok) continue;
        await updateWallet(key, (w) => {
            w.refCode = candidate;
            return w;
        });
        return candidate;
    }
    return null;
}

// ------------------------------------------------------------------- follow facts
/**
 * Split an X identity into the two keys a follow fact can be filed under.
 *
 * A **proved** binding carries the numeric account id, and an id is the better key: a handle can be
 * renamed, an id cannot. A **provisional** binding — the player typed their handle because their
 * Privy app has Twitter switched off — has no id at all and stores `handle:<name>` in the id field
 * (see `bindX`). This is the one place that prefix is understood on the way back in, so callers can
 * hand over `doc.x` unchanged.
 */
function splitIdentity({ id, username } = {}) {
    let accountId = String(id || '').trim();
    let handle = String(username || '').trim().replace(/^@/, '').toLowerCase();
    const provisional = /^handle:(.+)$/.exec(accountId);
    if (provisional) {
        if (!handle) handle = provisional[1].trim().toLowerCase();
        accountId = '';
    }
    return { accountId, handle };
}

async function readFact(prefix, key) {
    const raw = await indexRead(prefix, key);
    if (!raw) return null;
    try {
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
        // A corrupt fact must not read as "they follow us". Refusing the claim is recoverable; paying
        // one it should not is not.
        console.warn(`[points-store] unreadable follow fact at ${prefix}${key}`);
        return null;
    }
}

/**
 * Write down what X told us about one account.
 *
 * Filed under the account id **and** the handle, so the same fact answers a wallet that bound with
 * an id and one that bound by name. Both writes describe the same event, so a partial failure leaves
 * one of the two able to answer rather than losing the event — and a later delivery rewrites both.
 *
 * Returns the stored fact, or null when the delivery carried no usable key at all.
 */
export async function recordFollowFact({ id, username, following, at, source = 'webhook' } = {}) {
    const { accountId, handle } = splitIdentity({ id, username });
    if (!accountId && !handle) return null;

    const fact = {
        following: following === true,
        username: handle || null,
        at: String(at || '').trim() || new Date().toISOString(),
        source,
        recordedAt: new Date().toISOString(),
    };
    const body = JSON.stringify(fact);
    if (accountId) await indexWrite(FOLLOW_ID_PREFIX, accountId, body);
    if (handle) await indexWrite(FOLLOW_HANDLE_PREFIX, handle, body);
    return fact;
}

/**
 * The latest thing X told us about an account, or null when it has told us nothing.
 *
 * The id is asked first and **wins** when both exist: a handle-rename would leave two records, and
 * the one filed against the id is the one about the account that actually followed. Watching a
 * handle change underneath is how a fact keyed only by name silently becomes about somebody else.
 */
export async function followFact(identity = {}) {
    const { accountId, handle } = splitIdentity(identity);
    if (accountId) {
        const byId = await readFact(FOLLOW_ID_PREFIX, accountId);
        if (byId) return byId;
    }
    if (handle) return readFact(FOLLOW_HANDLE_PREFIX, handle);
    return null;
}

// ------------------------------------------------------------- the review queue
/**
 * Put a claim in the queue, or take it out.
 *
 * A set rather than a field on the wallet on purpose: the wallet is read by address, and the
 * question the review tool asks is the other direction ("who is waiting?") — which no per-wallet
 * record can answer without walking every wallet, and which production (Redis, but reached over
 * REST) cannot walk at all.
 */
export async function pendingAdd(address, taskId) {
    const key = normaliseAddress(address);
    const member = `${String(taskId || '').trim()}:${key || ''}`;
    if (!key || !taskId) return false;

    if (STORAGE_DRIVER === 'redis') {
        await redis('SADD', PENDING_KEY, member);
        return true;
    }
    const members = await pendingReadRaw();
    if (!members.includes(member)) members.push(member);
    await pendingWriteRaw(members);
    return true;
}

export async function pendingRemove(address, taskId) {
    const key = normaliseAddress(address);
    const member = `${String(taskId || '').trim()}:${key || ''}`;
    if (!key || !taskId) return false;

    if (STORAGE_DRIVER === 'redis') {
        await redis('SREM', PENDING_KEY, member);
        return true;
    }
    const members = (await pendingReadRaw()).filter((m) => m !== member);
    await pendingWriteRaw(members);
    return true;
}

/** Everything still waiting, newest last. */
export async function pendingList() {
    const members = STORAGE_DRIVER === 'redis'
        ? ((await redis('SMEMBERS', PENDING_KEY)) || [])
        : await pendingReadRaw();

    return members
        .map((member) => {
            const at = String(member).indexOf(':');
            return { taskId: String(member).slice(0, at), address: String(member).slice(at + 1) };
        })
        .filter((entry) => entry.taskId && normaliseAddress(entry.address));
}

async function pendingReadRaw() {
    if (STORAGE_DRIVER === 'memory') {
        try { return JSON.parse(memory.indexes[PENDING_KEY] || '[]'); } catch { return []; }
    }
    const data = await readFile();
    try { return JSON.parse(data.indexes?.[PENDING_KEY] || '[]'); } catch { return []; }
}

async function pendingWriteRaw(members) {
    const body = JSON.stringify(members);
    if (STORAGE_DRIVER === 'memory') {
        memory.indexes[PENDING_KEY] = body;
        return;
    }
    const data = await readFile();
    data.indexes = data.indexes || {};
    data.indexes[PENDING_KEY] = body;
    await writeFile(data);
}

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
        // The daily streak: { days, lastDay, award } — the day of the run this wallet is on, and
        // the UTC day it was last credited for. Written by `settleStreak`, read by `streakFor`,
        // which is also what decides whether the run is still alive or starts again at day one.
        streak: null,
        sharedOn: {},        // { 'YYYY-MM-DD': true } — the *old* unverified flag, kept readable
        // Capsules won from the daily draw, by the day they were won:
        // { 'YYYY-MM-DD': { day, capsule, wonAt, registeredAt, claimedAt, claimSigHash, status } }.
        // A prize, not an earning — nothing here is points, and nothing here is spendable until the
        // capsule contract exists; see `lib/points-capsules.js` for the whole ladder.
        capsules: {},
        // The day of a win this wallet has not looked at yet, so the tab can wear a badge. Cleared by
        // the read that shows it, exactly like the announcements badge.
        capsuleNotice: null,
        // { at, address, messageHash, sigHash } — a one-time signature proving this wallet is the
        // player's, which is what a capsule is later sent against. See `lib/capsule-claims.js`.
        registration: null,
        x: null,             // { id, username, verified, boundAt } once X is bound
        tasks: {},           // { [taskId]: { state, url, attempts, credited, … } } — see points-program
        referrer: null,
        referrals: [],
        referralEarned: 0,   // points this wallet has been paid for referring others
        referralLedger: {},  // { refereeAddress: points paid to this wallet for them }
        refCode: null,       // this wallet's own five-character invite code (see assignRefCode)
        referredAt: null,    // when a referrer was attached — by link on arrival, or later by hand
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

/* ============================================================== the day's board
 *
 * One sorted set per UTC day, written by the same event that writes the lifetime board — an earning
 * — and read by the capsule draw and by the page that shows today's standings.
 *
 * The reason this exists at all rather than being derived: the store keeps no per-day points total,
 * and deriving one from the wallet's history would be wrong in a way that costs a player a capsule.
 * The activity log is capped at forty entries, `levelsCleared` is wiped by the daily reset, and a
 * share's bonus is recorded on the task rather than as an earning — so a recomputed day would be a
 * guess that silently drifts from facts. A tally written where the points are written is the only
 * version of this that cannot disagree with the balance.
 */

/**
 * Add an earning to its day's board, and to the wallet's own record for that day.
 *
 * `at` is the moment of the *latest* credit, not the first: the tie-break in the draw is "who got
 * there first" for a tie in points, and a wallet that earns twice has been earning all along, so the
 * later stamp is the honest one to compare. Redis gets one pipeline (a score bump and the TTL that
 * keeps the keyspace bounded); the document drivers get a read-modify-write, which is what they are.
 *
 * Returns the amount added, so a caller can log it — never throws over a board it could not write,
 * because a board is a ranking and the points are already banked by the time this runs.
 */
export async function bumpDailyPoints(address, day, amount, at = Date.now()) {
    const key = normaliseAddress(address);
    const value = Math.floor(Number(amount) || 0);
    if (!key || !isDayKey(day) || value <= 0) return 0;

    try {
        if (STORAGE_DRIVER === 'redis') {
            await redisPipeline([
                ['ZINCRBY', dayBoardKey(day), String(value), key],
                ['HSET', dayStampKey(day), key, String(Number(at) || Date.now())],
                ['EXPIRE', dayBoardKey(day), String(DAY_BOARD_TTL_SECONDS)],
                ['EXPIRE', dayStampKey(day), String(DAY_BOARD_TTL_SECONDS)],
            ]);
            return value;
        }
        const days = await readDays();
        const board = days[day] || (days[day] = {});
        const previous = board[key] || { points: 0, at };
        board[key] = { points: previous.points + value, at: Number(at) || Date.now() };
        await writeDays(days);
        return value;
    } catch (error) {
        console.error(`[points-store] could not add ${value} PTS to the ${day} board for ${key}: ${error.message || error}`);
        return 0;
    }
}

/**
 * The wallets that earned on a day, highest first — with the `at` the draw's tie-break needs.
 *
 * Hydrated records come back with each row because the draw and the page both need a name for a
 * wallet (its bound handle), and a caller that had to fetch them itself would be one loop away from
 * an N+1 that only shows up on the day the board is full. Rows whose record has vanished — a wallet
 * purged by a harness — are dropped rather than rendered as a nameless address with points.
 *
 * The rows are ordered **here**, by the same three facts the draw orders them by, rather than left in
 * whatever order the driver returned. That matters most on Redis, where equal scores come back in
 * reverse lexicographic order — so the board a player reads would have been tie-broken one way and
 * the draw that pays them another. One comparator, one order, whichever driver answered.
 */
export async function topWalletsOnDay(day, limit = 30) {
    const key = isDayKey(day);
    const cap = Math.max(1, Math.min(Math.trunc(Number(limit) || 30), 500));
    if (!key) return [];

    if (STORAGE_DRIVER === 'redis') {
        const flat = (await redis('ZREVRANGE', dayBoardKey(key), 0, String(cap - 1), 'WITHSCORES')) || [];
        const addresses = [];
        const scores = new Map();
        for (let i = 0; i + 1 < flat.length; i += 2) {
            addresses.push(flat[i]);
            scores.set(flat[i], Number(flat[i + 1]) || 0);
        }
        if (!addresses.length) return [];
        const [stamps, docs] = await Promise.all([
            redis('HGETALL', dayStampKey(key)),
            redisPipeline(addresses.map((a) => ['GET', WALLET_PREFIX + a])),
        ]);
        const at = new Map();
        // Upstash answers `HGETALL` as a flat `[field, value, …]`; a plain object comes back from the
        // file-backed fake in the harness, so both shapes are read rather than assumed.
        if (Array.isArray(stamps)) {
            for (let i = 0; i + 1 < stamps.length; i += 2) at.set(String(stamps[i]), Number(stamps[i + 1]) || 0);
        } else if (stamps && typeof stamps === 'object') {
            for (const [field, value] of Object.entries(stamps)) at.set(String(field), Number(value) || 0);
        }
        return addresses
            .map((address, i) => rowFrom(address, scores.get(address), at.get(address) || 0, hydrate(docs[i], address)))
            .filter(Boolean)
            .sort(rowOrder);
    }

    const days = await readDays();
    const board = days[key] || {};
    const wallets = STORAGE_DRIVER === 'memory' ? memory.wallets : (await readFile()).wallets;
    return Object.entries(board)
        .filter(([, row]) => Number(row?.points) > 0)
        .slice(0, cap)
        .map(([address, row]) => rowFrom(address, row.points, Number(row.at) || 0, hydrate(wallets[address], address)))
        .filter(Boolean)
        .sort(rowOrder);
}

/**
 * The draw's ordering, in the one place both the store and the page can read it: points, then the
 * earlier stamp, then the address as the stable last word.
 */
function rowOrder(a, b) {
    return (b.dayPoints - a.dayPoints)
        || (a.at - b.at)
        || (a.address < b.address ? -1 : a.address > b.address ? 1 : 0);
}

/**
 * One board row, or null when there is no wallet record to name it with.
 *
 * Both facts come from the day's own board — the score and the stamp — so a row cannot be ranked by
 * one source and tie-broken by another. The record is read only for what names the wallet.
 */
function rowFrom(address, dayPoints, at, doc) {
    if (!doc) return null;
    const handle = doc.x?.username || null;
    return {
        address,
        dayPoints: Math.max(0, Math.floor(Number(dayPoints) || 0)),
        at: Number(at) || 0,
        handle,
        handleProved: Boolean(handle) && doc.x?.verified === true,
        doc,
    };
}

/**
 * Where a wallet stands on a day's board, or null when it did not earn that day.
 *
 * The board the draw ranks, asked one wallet at a time — which is what the page needs to show a
 * player their own place without shipping them the whole list. Null rather than 0 for a wallet that
 * is nowhere on it: "unranked today" and "ranked last with nothing" are different sentences.
 */
export async function dailyRankOf(address, day) {
    const key = normaliseAddress(address);
    const board = isDayKey(day);
    if (!key || !board) return null;
    if (STORAGE_DRIVER === 'redis') {
        const rank = await redis('ZREVRANK', dayBoardKey(board), key);
        return rank === null || rank === undefined ? null : Number(rank) + 1;
    }
    const days = await readDays();
    const rows = Object.entries(days[board] || {})
        .filter(([, row]) => Number(row?.points) > 0)
        .sort((a, b) => (b[1].points - a[1].points) || ((a[1].at || 0) - (b[1].at || 0)));
    const index = rows.findIndex(([address]) => address === key);
    return index === -1 ? null : index + 1;
}

/** What a wallet earned on a day, or 0. */
export async function dailyPointsFor(address, day) {
    const key = normaliseAddress(address);
    const board = isDayKey(day);
    if (!key || !board) return 0;
    if (STORAGE_DRIVER === 'redis') return Number(await redis('ZSCORE', dayBoardKey(board), key)) || 0;
    const days = await readDays();
    return Number(days[board]?.[key]?.points) || 0;
}

/**
 * Every day the store holds a board for, oldest first.
 *
 * Read by the draw on its first settlement (the earliest day on record is the giveaway's first day,
 * which is why the daily tally needs no separate "when did this start" bookkeeping) and by the
 * prune. A scan rather than a KEYS, for the reason the maintenance path gives: `KEYS` walks the
 * whole keyspace and blocks every other player while it does.
 */
export async function dailyKeys() {
    if (STORAGE_DRIVER === 'redis') {
        const keys = await redisScan(`${DAY_BOARD_PREFIX}*`);
        return keys.map((k) => k.slice(DAY_BOARD_PREFIX.length)).filter(isDayKey).sort();
    }
    return Object.keys(await readDays()).filter(isDayKey).sort();
}

/** Drop day boards older than `keepDays` before `before` (a day key). Returns what it removed. */
export async function pruneDailyKeys(before, keepDays = 1) {
    if (!isDayKey(before)) return [];
    const cutoff = new Date(`${before}T00:00:00.000Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - Math.max(0, keepDays));
    const oldest = cutoff.toISOString().slice(0, 10);
    const doomed = (await dailyKeys()).filter((day) => day < oldest);
    if (!doomed.length) return [];

    if (STORAGE_DRIVER === 'redis') {
        await redisPipeline(doomed.flatMap((day) => [['DEL', dayBoardKey(day)], ['DEL', dayStampKey(day)]]));
        return doomed;
    }
    const days = await readDays();
    for (const day of doomed) delete days[day];
    await writeDays(days);
    return doomed;
}

// ------------------------------------------------------------------ maintenance
/** The follow-fact keys belonging to the identities a caller says it created. */
function factKeysFor({ ids = [], handles = [] } = {}) {
    const keys = new Set();
    for (const id of ids) {
        const value = String(id || '').trim();
        if (value) keys.add(FOLLOW_ID_PREFIX + value);
    }
    for (const handle of handles) {
        const value = String(handle || '').trim().replace(/^@/, '').toLowerCase();
        if (value) keys.add(FOLLOW_HANDLE_PREFIX + value);
    }
    return keys;
}

/**
 * Everything in the store that names one wallet — for tools and harnesses, never for the site.
 *
 * Nothing in `app/` calls this. It is the answer to "is this wallet really gone?", and it exists
 * because that question has to be asked more than once: `purgeWallet` asks it to find what to delete,
 * and a caller asks it again afterwards. Counting what purge says it removed is not the same thing —
 * measured, in fact: with the guard deletion stubbed to a no-op, purge still reported
 * *"1 guard key(s) removed"* while the key sat there untouched.
 *
 * Each match is on the **whole address**, lower-cased. The X-account index is matched on its *value*
 * rather than its key, because the key is the account (a numeric id, or `handle:<name>` for a
 * provisional binding) and that shape is the program's business, not this file's.
 *
 * Returns a flat list of labels: real key names everywhere they exist, and `key member` for the two
 * member sets (the review queue and the leaderboard), so an empty array means the wallet is nowhere.
 */
export async function walletKeys(address, { ids = [], handles = [] } = {}) {
    const key = normaliseAddress(address);
    if (!key) return [];
    const factKeys = factKeysFor({ ids, handles });
    const found = [];

    if (STORAGE_DRIVER === 'redis') {
        if (await redis('GET', WALLET_PREFIX + key)) found.push(WALLET_PREFIX + key);

        // Value-matched indexes, so a new one is a line in `VALUE_INDEXES` rather than another scan
        // here that somebody has to remember to add.
        for (const prefix of VALUE_INDEXES) {
            for (const indexKey of await redisScan(prefix + '*')) {
                if (String((await redis('GET', indexKey)) || '').trim() === key) found.push(indexKey);
            }
        }
        // Guards are named after the thing they guard, so the address is inside the key.
        for (const guardKey of await redisScan(GUARD_PREFIX + '*')) {
            if (guardKey.toLowerCase().includes(key)) found.push(guardKey);
        }
        for (const row of await pendingList()) {
            if (row.address === key) found.push(`${PENDING_KEY} ${row.taskId}:${key}`);
        }
        if ((await redis('ZSCORE', BOARD_KEY, key)) !== null) found.push(`${BOARD_KEY} ${key}`);
        // And the day boards: a wallet that scored today is on today's board, and "purged" has to
        // mean no longer anywhere — the draw reads these sets, so a leftover membership is a winner
        // a harness cannot clean up.
        for (const dayKey of await redisScan(`${DAY_BOARD_PREFIX}*`)) {
            if ((await redis('ZSCORE', dayKey, key)) !== null) found.push(`${dayKey} ${key}`);
        }
        for (const stampKey of await redisScan(`${DAY_STAMP_PREFIX}*`)) {
            if (Number(await redis('HEXISTS', stampKey, key)) === 1) found.push(`${stampKey} ${key}`);
        }
        for (const factKey of factKeys) {
            if (await redis('GET', factKey)) found.push(factKey);
        }
        return found;
    }

    // file and memory hold the same document, one read apart.
    const data = STORAGE_DRIVER === 'memory' ? memory : await readFile();
    if (data.wallets?.[key]) found.push(WALLET_PREFIX + key);
    for (const [day, board] of Object.entries(data.days || {})) {
        if (board?.[key]) found.push(`${DAY_BOARD_PREFIX}${day} ${key}`);
    }
    for (const indexKey of Object.keys(data.indexes || {})) {
        if (VALUE_INDEXES.some((prefix) => indexKey.startsWith(prefix))
            && normaliseAddress(data.indexes[indexKey]) === key) found.push(indexKey);
        else if (indexKey.startsWith(GUARD_PREFIX) && indexKey.toLowerCase().includes(key)) found.push(indexKey);
        else if (factKeys.has(indexKey)) found.push(indexKey);
    }
    try {
        for (const member of JSON.parse(data.indexes?.[PENDING_KEY] || '[]')) {
            if (String(member).endsWith(`:${key}`)) found.push(`${PENDING_KEY} ${member}`);
        }
    } catch { /* an unreadable queue names nothing — and it is not this function's to reset */ }
    return found;
}

/**
 * Take one wallet out of the store completely.
 *
 * This exists because a harness that signs in a generated wallet against a **shared** store has no
 * file of its own to restore afterwards: the store is the deployment's, and the only way to leave it
 * as it was found is to take that one wallet back out. The caller is
 * `tools/check-follow-gate.js --against-live`.
 *
 * The deletion is driven entirely by `walletKeys` — find, delete, find again — so no step knows a key
 * shape except for the two member sets, and `survived` is measured rather than assumed.
 *
 * `ids` and `handles` are the identities whose follow **facts** should go too, and they must be
 * passed in: a fact is filed against an X account, not a wallet, so this function cannot derive them,
 * and guessing would sooner or later delete a fact about our own account — which is a real follower
 * being told they are not following.
 */
export async function purgeWallet(address, { ids = [], handles = [] } = {}) {
    const key = normaliseAddress(address);
    if (!key) return null;
    const factKeys = factKeysFor({ ids, handles });

    const before = await walletKeys(key, { ids, handles });
    const summary = {
        address: key,
        driver: STORAGE_DRIVER,
        removed: [],
        survived: before,
        pending: before.filter((label) => label.startsWith(`${PENDING_KEY} `)),
        facts: before.filter((label) => factKeys.has(label)),
        board: before.some((label) => label.startsWith(`${BOARD_KEY} `)),
        dayBoards: before.filter((label) => label.startsWith(DAY_BOARD_PREFIX) || label.startsWith(DAY_STAMP_PREFIX)),
    };
    if (!before.length) return summary;

    if (STORAGE_DRIVER === 'redis') {
        for (const label of before) {
            if (label.startsWith(`${PENDING_KEY} `)) await redis('SREM', PENDING_KEY, label.slice(PENDING_KEY.length + 1));
            else if (label.startsWith(`${BOARD_KEY} `)) await redis('ZREM', BOARD_KEY, key);
            else if (label.startsWith(DAY_BOARD_PREFIX)) await redis('ZREM', label.slice(0, label.indexOf(' ')), key);
            else if (label.startsWith(DAY_STAMP_PREFIX)) await redis('HDEL', label.slice(0, label.indexOf(' ')), key);
            else await redis('DEL', label);
        }
    } else {
        const data = STORAGE_DRIVER === 'memory' ? memory : await readFile();
        data.wallets = data.wallets || {};
        data.indexes = data.indexes || {};
        data.days = data.days || {};
        if (data.wallets[key]) delete data.wallets[key];
        for (const board of Object.values(data.days)) {
            if (board?.[key]) delete board[key];
        }
        for (const indexKey of Object.keys(data.indexes)) {
            if (VALUE_INDEXES.some((prefix) => indexKey.startsWith(prefix))
                && normaliseAddress(data.indexes[indexKey]) === key) delete data.indexes[indexKey];
            else if (indexKey.startsWith(GUARD_PREFIX) && indexKey.toLowerCase().includes(key)) delete data.indexes[indexKey];
            else if (factKeys.has(indexKey)) delete data.indexes[indexKey];
        }
        try {
            const members = JSON.parse(data.indexes[PENDING_KEY] || '[]');
            data.indexes[PENDING_KEY] = JSON.stringify(members.filter((member) => !String(member).endsWith(`:${key}`)));
        } catch { /* see walletKeys */ }
        if (STORAGE_DRIVER === 'file') await writeFile(data);
        // Guards for these two drivers are held in this process rather than in the store.
        for (const guardKey of [...memoryGuards]) {
            if (guardKey.toLowerCase().includes(key)) memoryGuards.delete(guardKey);
        }
    }

    summary.removed = before;
    summary.survived = await walletKeys(key, { ids, handles });
    return summary;
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
