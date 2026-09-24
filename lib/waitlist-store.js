/**
 * The Genesis waitlist.
 *
 * A public form on the coming-soon page collects an email address (and, optionally, the wallet and
 * the X handle of the person giving it), so this is the one place in the project that holds
 * **personal data** rather than a public wallet address. That shapes everything below:
 *
 *   - the key is `sha256(email)`, not the email, so a key dump is not an address book;
 *   - one entry per address, decided by that key, so a double submission returns the position the
 *     person already had instead of a second row (and a second place in the queue);
 *   - no IP is stored. The rate limit keeps a **counter** keyed by a hash of the IP for a minute,
 *     and nothing else about the request is kept — enough to stop a loop, not enough to profile;
 *   - `tools/waitlist.js` is the only reader of the list, and it needs the store's own credentials.
 *
 * Driver selection is deliberately the same as `lib/points-store.js` (KV/Upstash in production, a
 * file in development, memory as a last resort) but it is *its own* client rather than a shared one:
 * the two stores hold different things, and one day they will be pointed at different databases.
 */

import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import path from 'path';

const ENTRY_PREFIX = 'dk:waitlist:entry:';
// Two numbers, two meanings, and they must not be confused:
//
//   COUNT_KEY — **how many people are in line.** This is the number the queue endpoint answers with
//               and the one `tools/waitlist.js` reports, so it has to fall when an entry is removed;
//               otherwise the project quotes a queue that is not there. (Measured: after clearing
//               three test entries the count still said 5.) No page prints it: the owner asked that
//               no running total sit on a public page.
//   SEQ_KEY   — the next position to hand out. Never decremented: a position that has been given to
//               somebody is theirs, and reissuing it would move a person who never did anything.
const COUNT_KEY = 'dk:waitlist:count';
const SEQ_KEY = 'dk:waitlist:seq';
const RATE_PREFIX = 'dk:waitlist:rate:';
const FILE_PATH = path.join(process.cwd(), '.data', 'waitlist.json');

/** A minute of one IP's attempts. Small enough to be forgotten, big enough to stop a loop. */
const RATE_LIMIT = 5;
const RATE_WINDOW_SECONDS = 60;

export const WAITLIST_DRIVER = (() => {
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) return 'redis';
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) return 'redis';
    return process.env.NODE_ENV === 'production' ? 'memory' : 'file';
})();

export function storageDescription() {
    if (WAITLIST_DRIVER === 'redis') return 'Upstash/Vercel KV (REST)';
    if (WAITLIST_DRIVER === 'file') return `local file ${FILE_PATH}`;
    return 'in-memory (NOT PERSISTENT — set KV_REST_API_URL + KV_REST_API_TOKEN)';
}

if (WAITLIST_DRIVER === 'memory') {
    console.warn('[waitlist] No Redis configured in production — waitlist signups will be lost on redeploy.');
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
    if (!res.ok) throw new Error(`waitlist store: redis ${command[0]} failed (${res.status})`);
    const body = await res.json();
    if (body.error) throw new Error(`waitlist store: redis ${command[0]} → ${body.error}`);
    return body.result;
}

// ------------------------------------------------------------------- file / memory
const memory = { entries: {}, rate: {}, count: 0, seq: 0 };

async function readFileStore() {
    try {
        return JSON.parse(await fs.readFile(FILE_PATH, 'utf8'));
    } catch {
        return { entries: {}, rate: {}, count: 0, seq: 0 };
    }
}

async function writeFileStore(data) {
    await fs.mkdir(path.dirname(FILE_PATH), { recursive: true });
    await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2));
}

// ------------------------------------------------------------------------ helpers
export function normaliseEmail(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim().toLowerCase();
    if (!trimmed || trimmed.length > 254) return null;
    // Pragmatic rather than RFC-exact, and worth being honest about: the only complete validation of
    // an address is sending mail to it, which this does not do yet. This rejects the shapes a real
    // mistake takes — no `@`, no dot in the domain, spaces, a trailing dot.
    if (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(trimmed)) return null;
    if (trimmed.startsWith('.') || trimmed.includes('..')) return null;
    return trimmed;
}

export function normaliseHandle(value) {
    if (typeof value !== 'string') return null;
    const cleaned = value.trim().replace(/^@+/, '').toLowerCase();
    return /^[a-z0-9_]{1,15}$/.test(cleaned) ? cleaned : null;
}

/** The key an entry is filed under. The email itself never appears in a key name. */
export function emailKey(email) {
    const normalised = normaliseEmail(email);
    return normalised ? createHash('sha256').update(normalised).digest('hex') : null;
}

/** Hashes an IP for the rate-limit counter, so the log of attempts holds no addresses either. */
export function rateKeyFor(ip, windowSeconds = RATE_WINDOW_SECONDS, nowSeconds = Math.floor(Date.now() / 1000)) {
    const bucket = Math.floor(nowSeconds / windowSeconds);
    const hashed = createHash('sha256').update(String(ip || 'unknown')).digest('hex').slice(0, 16);
    return `${RATE_PREFIX}${hashed}:${bucket}`;
}

// -------------------------------------------------------------------- the interface
/** How many people are in line — the queue's own count, for the endpoint and the tooling. */
export async function waitlistSize() {
    if (WAITLIST_DRIVER === 'redis') return Math.max(0, Number(await redis('GET', COUNT_KEY)) || 0);
    if (WAITLIST_DRIVER === 'memory') return Math.max(0, memory.count || 0);
    return Math.max(0, (await readFileStore()).count || 0);
}

/** The entry for an email, or null. */
export async function getEntry(email) {
    const key = emailKey(email);
    if (!key) return null;
    if (WAITLIST_DRIVER === 'redis') {
        const raw = await redis('GET', ENTRY_PREFIX + key);
        return raw ? JSON.parse(raw) : null;
    }
    if (WAITLIST_DRIVER === 'memory') return memory.entries[key] || null;
    return (await readFileStore()).entries[key] || null;
}

/**
 * Count one attempt against an IP. Returns `{ allowed, count }` — the caller decides what to say.
 *
 * A counter with a window, not a lockout: `INCR` then `EXPIRE` on the first hit of the window, and
 * for the local drivers a map entry that is simply replaced when its bucket rolls over. The
 * waitlist is not worth more machinery than that.
 */
export async function countAttempt(ip, nowSeconds = Math.floor(Date.now() / 1000)) {
    const key = rateKeyFor(ip, RATE_WINDOW_SECONDS, nowSeconds);
    let count;

    if (WAITLIST_DRIVER === 'redis') {
        count = Number(await redis('INCR', key)) || 0;
        if (count === 1) await redis('EXPIRE', key, String(RATE_WINDOW_SECONDS));
    } else {
        const data = WAITLIST_DRIVER === 'memory' ? memory : await readFileStore();
        data.rate = data.rate || {};
        // Drop buckets that have expired, so the file cannot grow by one entry per IP forever.
        for (const stale of Object.keys(data.rate)) {
            if (!stale.startsWith(RATE_PREFIX)) continue;
            const bucket = Number(stale.slice(stale.lastIndexOf(':') + 1));
            if (Number.isFinite(bucket) && bucket * RATE_WINDOW_SECONDS < nowSeconds - RATE_WINDOW_SECONDS) {
                delete data.rate[stale];
            }
        }
        const current = data.rate[key] || { count: 0 };
        const next = { count: (current.count || 0) + 1 };
        data.rate[key] = next;
        if (WAITLIST_DRIVER === 'file') await writeFileStore(data);
        count = next.count;
    }

    // The limit is applied in **one** place, after whichever driver counted. It used to be written
    // into both branches, which meant the rule was stated twice and the offline harness — which only
    // ever runs the file driver — could not fail the Redis copy of it.
    return { allowed: count <= RATE_LIMIT, count };
}

/**
 * Record a signup. Idempotent per email address: a second call returns the first call's position.
 *
 * The position is "how many entries existed when this one was created, plus one" and it is stored on
 * the record, so it never moves afterwards — a queue number that shifts under a person is worse than
 * no number at all.
 */
export async function addToWaitlist({ email, handle = null, address = null, followClaimed = false, source = 'landing' } = {}) {
    const normalised = normaliseEmail(email);
    if (!normalised) return { error: 'That email address does not look right.', code: 'bad-email' };
    const key = emailKey(normalised);

    const existing = await getEntry(normalised);
    if (existing) return { ok: true, alreadyRegistered: true, position: existing.position, entry: existing };

    const record = {
        email: normalised,
        handle: normaliseHandle(handle),
        // Kept exactly as the chain gives it — this is a public address, and lower-casing it here
        // would lose the checksum somebody may want to verify it by.
        address: typeof address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(address.trim()) ? address.trim() : null,
        // Only ever true when the person ticked the box, and it is **not** verified: X's free API has
        // no view of who follows whom. The page says so, and so does the export.
        followClaimed: followClaimed === true,
        source: typeof source === 'string' ? source.slice(0, 40) : 'landing',
        at: new Date().toISOString(),
        position: 0,
    };

    if (WAITLIST_DRIVER === 'redis') {
        // `SET NX` is the atomic part: two simultaneous signups with the same address cannot both
        // create an entry, and the loser falls through to the existing record below.
        const created = await redis('SET', ENTRY_PREFIX + key, JSON.stringify(record), 'NX');
        if (created !== 'OK') {
            const winner = await getEntry(normalised);
            return { ok: true, alreadyRegistered: true, position: winner?.position ?? null, entry: winner };
        }
        record.position = Number(await redis('INCR', SEQ_KEY)) || 1;
        await redis('INCR', COUNT_KEY);
        await redis('SET', ENTRY_PREFIX + key, JSON.stringify(record));
        return { ok: true, alreadyRegistered: false, position: record.position, entry: record };
    }

    const data = WAITLIST_DRIVER === 'memory' ? memory : await readFileStore();
    data.entries = data.entries || {};
    if (data.entries[key]) {
        return { ok: true, alreadyRegistered: true, position: data.entries[key].position, entry: data.entries[key] };
    }
    data.seq = (Number(data.seq) || 0) + 1;
    data.count = (Number(data.count) || 0) + 1;
    record.position = data.seq;
    data.entries[key] = record;
    if (WAITLIST_DRIVER === 'file') await writeFileStore(data);
    return { ok: true, alreadyRegistered: false, position: record.position, entry: record };
}

/** Oldest first — the order people joined, which is the order the export should be read in. */
export async function listWaitlist({ limit = 0 } = {}) {
    let entries;
    if (WAITLIST_DRIVER === 'redis') {
        const { url, token } = redisEnv();
        entries = [];
        let cursor = '0';
        do {
            const res = await fetch(url, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(['SCAN', cursor, 'MATCH', `${ENTRY_PREFIX}*`, 'COUNT', '1000']),
                cache: 'no-store',
            });
            const body = await res.json();
            if (body.error) throw new Error(`waitlist store: redis SCAN → ${body.error}`);
            cursor = String(body.result?.[0] ?? '0');
            for (const key of body.result?.[1] || []) {
                const raw = await redis('GET', key);
                if (raw) entries.push(JSON.parse(raw));
            }
        } while (cursor !== '0');
    } else {
        const data = WAITLIST_DRIVER === 'memory' ? memory : await readFileStore();
        entries = Object.values(data.entries || {});
    }
    entries.sort((a, b) => (a.position || 0) - (b.position || 0));
    return limit > 0 ? entries.slice(0, limit) : entries;
}

/**
 * Remove an entry and everything filed with it.
 *
 * For the harness, which writes real entries into a real store and has to take them out again — the
 * same bargain `purgeWallet` makes for the points program. It returns the labels it removed so the
 * caller can assert on the *removal* rather than on its own optimism.
 */
export async function purgeEntry(email) {
    const key = emailKey(email);
    const existing = await getEntry(email);
    if (!key || !existing) return { removed: [], survived: false };

    if (WAITLIST_DRIVER === 'redis') {
        await redis('DEL', ENTRY_PREFIX + key);
        // The queue gets shorter; the position sequence does not. See the two keys at the top.
        const remaining = Number(await redis('DECR', COUNT_KEY));
        if (remaining < 0) await redis('SET', COUNT_KEY, '0');
    } else {
        const data = WAITLIST_DRIVER === 'memory' ? memory : await readFileStore();
        delete data.entries?.[key];
        data.count = Math.max(0, (Number(data.count) || 0) - 1);
        if (WAITLIST_DRIVER === 'file') await writeFileStore(data);
    }
    return { removed: [ENTRY_PREFIX + key], survived: (await getEntry(email)) !== null };
}
