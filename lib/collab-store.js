/**
 * Who has registered for a collab giveaway, and who has asked to be in one.
 *
 * Two halves, one store, and they are different shapes:
 *
 *   - **entries** are keyed by **(project, wallet)** rather than by wallet alone, because a partner's
 *     giveaway is its own entry list: registering for Fabled Chronicle must not put a wallet in the
 *     running for the next project that arrives. That is the whole reason the slug is in the key.
 *   - **requests** are a project asking *us* for a collaboration — keyed by the **wallet that asked**,
 *     not by the handle it typed. A handle is a claim, not a fact: anybody can type `@somebody` into
 *     a form, and keying by it would let a stranger overwrite the real project's request. Keyed by
 *     the wallet, two people claiming one handle are two requests the owner can read and merge, and
 *     nothing anybody types can move somebody else's row.
 *
 * They also live in different places in the file driver (`entries` and `requests`), so a listing of
 * one can never pick up a row of the other.
 *
 * The two halves also meet here, in one read: `listedProjects` hands the page the pinned projects
 * plus every **approved** request. That is what makes an approval the whole of adding a project —
 * the slug, the prize, the dates and the picture all come off the row the owner approved, and no
 * file between here and `/collab` is edited by hand.
 *
 * What is held, and what is not:
 *
 *   - an entry is the **public wallet address** — no email, no IP, nothing personal. That makes this
 *     a much smaller bargain than `lib/waitlist-store.js`, which is the one place in the project that
 *     keeps an email address. It is a separate store for that reason rather than a second prefix in
 *     the waitlist's: the two hold different things and one day they will be different databases.
 *   - an entry is only ever written for an address that has **signed for it** — the route proves the
 *     wallet with the Points Program's own session (`lib/points-session.js#sessionFromRequest`)
 *     before it calls in here. The store takes the address on trust; verifying it is the caller's
 *     job, and the caller does it.
 *   - the rate limit keeps a **counter** keyed by a hash of the IP for a minute and nothing else
 *     about the request; same bargain as the waitlist's, and the same reason.
 *
 * Driver selection is deliberately the same as `lib/points-store.js` and `lib/waitlist-store.js`
 * (KV/Upstash in production, a file in development, memory as a last resort). One driver for both
 * halves on purpose: two files would be two things to configure correctly on a deploy.
 */

import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { composeProjects, projectBySlug, projectFromRequest, projectPhotoUrl } from './collab-content.js';

const ENTRY_PREFIX = 'dk:collab:entry:';
// Two numbers, two meanings — the same pair the waitlist keeps, for the same reasons:
//
//   COUNT_KEY — how many wallets are registered for a project, per project. It is what a tool
//               reports and what a winner list is drawn from, so it has to fall when an entry is
//               removed. No page prints it: the owner's standing rule is that no running total sits
//               on a public page, and the store's counts are for the export.
//   SEQ_KEY   — the next position to hand out, per project. Never decremented: a position that has
//               been given to somebody is theirs.
const COUNT_PREFIX = 'dk:collab:count:';
const SEQ_PREFIX = 'dk:collab:seq:';
const RATE_PREFIX = 'dk:collab:rate:';
const FILE_PATH = path.join(process.cwd(), '.data', 'collab.json');

/** Attempts per minute, per IP. Enough to stop a loop, small enough to be forgotten. */
const RATE_LIMIT = 6;
const RATE_WINDOW_SECONDS = 60;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export const COLLAB_DRIVER = (() => {
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) return 'redis';
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) return 'redis';
    return process.env.NODE_ENV === 'production' ? 'memory' : 'file';
})();

export function storageDescription() {
    if (COLLAB_DRIVER === 'redis') return 'Upstash/Vercel KV (REST)';
    if (COLLAB_DRIVER === 'file') return `local file ${FILE_PATH}`;
    return 'in-memory (NOT PERSISTENT — set KV_REST_API_URL + KV_REST_API_TOKEN)';
}

if (COLLAB_DRIVER === 'memory') {
    console.warn('[collab] No Redis configured in production — collab registrations will be lost on redeploy.');
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
    if (!res.ok) throw new Error(`collab store: redis ${command[0]} failed (${res.status})`);
    const body = await res.json();
    if (body.error) throw new Error(`collab store: redis ${command[0]} → ${body.error}`);
    return body.result;
}

// ------------------------------------------------------------------- file / memory
const memory = { entries: {}, rate: {}, counts: {}, seqs: {} };

async function readFileStore() {
    try {
        const data = JSON.parse(await fs.readFile(FILE_PATH, 'utf8'));
        return { entries: {}, rate: {}, counts: {}, seqs: {}, ...data };
    } catch {
        return { entries: {}, rate: {}, counts: {}, seqs: {} };
    }
}

async function writeFileStore(data) {
    await fs.mkdir(path.dirname(FILE_PATH), { recursive: true });
    await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2));
}

// ------------------------------------------------------------------------ helpers
/**
 * The project a slug names, or null — the pinned list first, then the approved requests.
 *
 * The order matters twice over. A pinned slug is answered without touching the store at all, which
 * is the common case and keeps the hot path off Redis; and a project that is both pinned and
 * approved is answered from the store, so the row a partner's entries are actually filed under is
 * the row the page describes.
 *
 * This is why "is this a project" is an async question now. A project can arrive by being approved
 * (see `tools/collab-requests.js`) rather than by being written into `lib/collab-content.js`, and
 * that is a fact that lives in the store.
 */
export async function knownProject(slug) {
    if (typeof slug !== 'string' || !slug) return null;
    const pinned = projectBySlug(slug);
    if (pinned) return { ...pinned };
    const request = await approvedRequestForSlug(slug);
    return request ? projectFromRequest(request) : null;
}

/** Is this a project the store will answer for? Pinned, or approved. */
export async function isProjectSlug(slug) {
    return (await knownProject(slug)) !== null;
}

/**
 * The address, or null.
 *
 * Kept exactly as the chain gives it — this is a public address, and lower-casing it here would lose
 * the checksum somebody may want to verify it by. What *is* lower-cased is the key it is filed
 * under, so a wallet that signs from two clients that spell its case differently is one entry rather
 * than two.
 */
export function normaliseAddress(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return ADDRESS_RE.test(trimmed) ? trimmed : null;
}

/** A registrant's X handle, or null. Optional: a registration is a wallet, not a handle. */
export function normaliseHandle(value) {
    if (typeof value !== 'string') return null;
    const cleaned = value.trim().replace(/^@+/, '').toLowerCase();
    return /^[a-z0-9_]{1,15}$/.test(cleaned) ? cleaned : null;
}

/**
 * The key an entry is filed under — project first, because a project is its own entry list.
 *
 * A **shape, not a permission**: this builds a key for any slug it is handed, and asking whether the
 * slug is a project at all is the caller's job (`isProjectSlug`, which is async because a project
 * can come from the store). A key cannot be the gate for that, and pretending otherwise is how a
 * hand-written slug list becomes a silent second source of truth.
 */
export function entryKey(slug, address) {
    const clean = normaliseAddress(address);
    if (typeof slug !== 'string' || !slug || !clean) return null;
    const digest = createHash('sha256').update(clean.toLowerCase()).digest('hex').slice(0, 24);
    return `${ENTRY_PREFIX}${slug}:${digest}`;
}

/** Hashes an IP for the rate-limit counter, so the log of attempts holds no addresses either. */
export function rateKeyFor(ip, windowSeconds = RATE_WINDOW_SECONDS, nowSeconds = Math.floor(Date.now() / 1000)) {
    const bucket = Math.floor(nowSeconds / windowSeconds);
    const hashed = createHash('sha256').update(String(ip || 'unknown')).digest('hex').slice(0, 16);
    return `${RATE_PREFIX}${hashed}:${bucket}`;
}

// -------------------------------------------------------------------- the interface
/** How many wallets are registered for a project. For the export and the tools, not for a page. */
export async function registrationCount(slug) {
    if (!(await isProjectSlug(slug))) return 0;
    if (COLLAB_DRIVER === 'redis') return Math.max(0, Number(await redis('GET', COUNT_PREFIX + slug)) || 0);
    if (COLLAB_DRIVER === 'memory') return Math.max(0, memory.counts?.[slug] || 0);
    return Math.max(0, (await readFileStore()).counts?.[slug] || 0);
}

/** The entry for a (project, wallet), or null. */
export async function getRegistration(slug, address) {
    const key = entryKey(slug, address);
    if (!key) return null;
    if (COLLAB_DRIVER === 'redis') {
        const raw = await redis('GET', key);
        return raw ? JSON.parse(raw) : null;
    }
    if (COLLAB_DRIVER === 'memory') return memory.entries[key] || null;
    return (await readFileStore()).entries[key] || null;
}

/**
 * Count one attempt against an IP. Returns `{ allowed, count }` — the caller decides what to say.
 *
 * A counter with a window, not a lockout: `INCR` then `EXPIRE` on the first hit of the window, and
 * for the local drivers a map entry that is simply replaced when its bucket rolls over. The limit is
 * applied in **one** place, after whichever driver counted, so the offline harness (which only ever
 * runs the file driver) cannot fail a rule that Redis runs instead.
 */
export async function countAttempt(ip, nowSeconds = Math.floor(Date.now() / 1000)) {
    const key = rateKeyFor(ip, RATE_WINDOW_SECONDS, nowSeconds);
    let count;

    if (COLLAB_DRIVER === 'redis') {
        count = Number(await redis('INCR', key)) || 0;
        if (count === 1) await redis('EXPIRE', key, String(RATE_WINDOW_SECONDS));
    } else {
        const data = COLLAB_DRIVER === 'memory' ? memory : await readFileStore();
        data.rate = data.rate || {};
        // Drop expired buckets, so the file cannot grow by one entry per IP forever.
        for (const stale of Object.keys(data.rate)) {
            if (!stale.startsWith(RATE_PREFIX)) continue;
            const bucket = Number(stale.slice(stale.lastIndexOf(':') + 1));
            if (Number.isFinite(bucket) && bucket * RATE_WINDOW_SECONDS < nowSeconds - RATE_WINDOW_SECONDS) {
                delete data.rate[stale];
            }
        }
        const next = { count: (data.rate[key]?.count || 0) + 1 };
        data.rate[key] = next;
        if (COLLAB_DRIVER === 'file') await writeFileStore(data);
        count = next.count;
    }

    return { allowed: count <= RATE_LIMIT, count };
}

/**
 * Record a registration. Idempotent per (project, wallet): a second call returns the first call's
 * position instead of adding a row.
 *
 * The position is `how many entries existed when this one was created, plus one`, stored on the
 * record, and it never moves afterwards — a queue number that shifts under a person is worse than
 * no number at all.
 */
export async function registerForProject({ slug, address, handle = null, source = 'collab' } = {}) {
    if (!(await isProjectSlug(slug))) return { error: 'That project is not in the collab giveaway.', code: 'unknown-project' };
    const clean = normaliseAddress(address);
    if (!clean) return { error: 'A 0x wallet address is required.', code: 'bad-address' };
    const key = entryKey(slug, clean);

    const existing = await getRegistration(slug, clean);
    if (existing) return { ok: true, alreadyRegistered: true, position: existing.position, entry: existing };

    const record = {
        project: slug,
        // Kept exactly as the chain gives it: a public address, and lower-casing it would lose the
        // checksum somebody may want to verify it by.
        address: clean,
        handle: normaliseHandle(handle),
        source: typeof source === 'string' ? source.slice(0, 40) : 'collab',
        at: new Date().toISOString(),
        position: 0,
    };

    if (COLLAB_DRIVER === 'redis') {
        // `SET NX` is the atomic part: two simultaneous registrations of one wallet cannot both
        // create an entry, and the loser falls through to the existing record below.
        const created = await redis('SET', key, JSON.stringify(record), 'NX');
        if (created !== 'OK') {
            const winner = await getRegistration(slug, clean);
            return { ok: true, alreadyRegistered: true, position: winner?.position ?? null, entry: winner };
        }
        record.position = Number(await redis('INCR', SEQ_PREFIX + slug)) || 1;
        await redis('INCR', COUNT_PREFIX + slug);
        await redis('SET', key, JSON.stringify(record));
        return { ok: true, alreadyRegistered: false, position: record.position, entry: record };
    }

    const data = COLLAB_DRIVER === 'memory' ? memory : await readFileStore();
    data.entries = data.entries || {};
    data.counts = data.counts || {};
    data.seqs = data.seqs || {};
    if (data.entries[key]) {
        return { ok: true, alreadyRegistered: true, position: data.entries[key].position, entry: data.entries[key] };
    }
    data.seqs[slug] = (Number(data.seqs[slug]) || 0) + 1;
    data.counts[slug] = (Number(data.counts[slug]) || 0) + 1;
    record.position = data.seqs[slug];
    data.entries[key] = record;
    if (COLLAB_DRIVER === 'file') await writeFileStore(data);
    return { ok: true, alreadyRegistered: false, position: record.position, entry: record };
}

/** Oldest first — the order people registered, which is the order a winner list should be read in. */
export async function listRegistrations({ slug, limit = 0 } = {}) {
    if (!(await isProjectSlug(slug))) return [];
    let entries;
    if (COLLAB_DRIVER === 'redis') {
        const { url, token } = redisEnv();
        entries = [];
        let cursor = '0';
        do {
            const res = await fetch(url, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(['SCAN', cursor, 'MATCH', `${ENTRY_PREFIX}${slug}:*`, 'COUNT', '1000']),
                cache: 'no-store',
            });
            const body = await res.json();
            if (body.error) throw new Error(`collab store: redis SCAN → ${body.error}`);
            cursor = String(body.result?.[0] ?? '0');
            for (const key of body.result?.[1] || []) {
                const raw = await redis('GET', key);
                if (raw) entries.push(JSON.parse(raw));
            }
        } while (cursor !== '0');
    } else {
        const data = COLLAB_DRIVER === 'memory' ? memory : await readFileStore();
        entries = Object.values(data.entries || {}).filter((row) => row?.project === slug);
    }
    entries.sort((a, b) => (a.position || 0) - (b.position || 0));
    return limit > 0 ? entries.slice(0, limit) : entries;
}

/**
 * Remove an entry, and take its project's count down with it.
 *
 * For the harness, which writes real entries into a real store and has to take them out again — the
 * same bargain `purgeEntry` makes for the waitlist. It returns what it removed so the caller can
 * assert on the *removal* rather than on its own optimism.
 */
export async function purgeRegistration(slug, address) {
    const key = entryKey(slug, address);
    const existing = await getRegistration(slug, address);
    if (!key || !existing) return { removed: [], survived: false };

    if (COLLAB_DRIVER === 'redis') {
        await redis('DEL', key);
        const remaining = Number(await redis('DECR', COUNT_PREFIX + slug));
        if (remaining < 0) await redis('SET', COUNT_PREFIX + slug, '0');
    } else {
        const data = COLLAB_DRIVER === 'memory' ? memory : await readFileStore();
        delete data.entries?.[key];
        data.counts = data.counts || {};
        data.counts[slug] = Math.max(0, (Number(data.counts[slug]) || 0) - 1);
        if (COLLAB_DRIVER === 'file') await writeFileStore(data);
    }
    return { removed: [key], survived: (await getRegistration(slug, address)) !== null };
}

/* ============================================================================ the other half
 * The request a project sends us.
 * ========================================================================== */

/**
 * The states a request can be in.
 *
 * `pending` is the only one a project can put itself in — there is no path through the API from
 * "I asked" to "I am approved", because approval is the owner's and nothing a browser sends can
 * stand in for it. `rejected` is not an ending: a request that was turned down can be edited and
 * resubmitted, because the reason it was turned down may well be the thing that gets fixed.
 */
export const REQUEST_STATUSES = Object.freeze(['pending', 'approved', 'rejected']);

/**
 * What a request carries, and how long each field may be.
 *
 * The limits are enforced on the server as well as in the form: a length that only the page knows is
 * a length anybody can post past, and this text ends up on a card people put their name under.
 */
export const REQUEST_LIMITS = Object.freeze({
    name: 48,
    handle: 15,
    prize: 90,
    dates: 40,
    note: 400,
});

/**
 * The profile picture a project uploads, capped.
 *
 * It arrives as a `data:` URL because that is what the browser can produce without a multipart
 * parser, and it is stored on the request because there is nowhere else to put it: the store's three
 * drivers are one Redis key, one JSON file, one in-memory map, and a second storage system for
 * pictures would be a second thing to configure, back up and secure. The cap is what makes that
 * honest — a 512px portrait, re-encoded by the page before it is sent, is around 60–90 KB.
 */
export const PFP_MAX_BYTES = 256 * 1024;
export const PFP_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);

const REQUEST_PREFIX = 'dk:collab:request:';

/** The key a request is filed under. The **wallet** asked, so the handle cannot be used to overwrite. */
export function requestKey(address) {
    const clean = normaliseAddress(address);
    if (!clean) return null;
    const digest = createHash('sha256').update(clean.toLowerCase()).digest('hex').slice(0, 24);
    return `${REQUEST_PREFIX}${digest}`;
}

/** A single-line text field: trimmed, collapsed whitespace, and cut to its limit or refused. */
export function normaliseText(value, limit) {
    if (typeof value !== 'string') return null;
    const text = value.replace(/\s+/g, ' ').trim();
    if (!text || text.length > limit) return null;
    return text;
}

export function normaliseProjectName(value) {
    return normaliseText(value, REQUEST_LIMITS.name);
}

/**
 * A handle as it should be **printed**, which is not the same job as `normaliseHandle`.
 *
 * That one lower-cases, because a registrant's handle is only ever matched against other handles. A
 * request's handle is different: it goes on a card that gets posted, under the project's own name, so
 * `@FabledChronicle` has to survive as `FabledChronicle`. It is validated case-insensitively — X
 * treats the two as one account, which is why the slug is derived from the lower-cased form — but
 * stored as it was typed, minus the `@`.
 */
export function normaliseDisplayHandle(value) {
    if (typeof value !== 'string') return null;
    const cleaned = value.trim().replace(/^@+/, '');
    return /^[A-Za-z0-9_]{1,15}$/.test(cleaned) ? cleaned : null;
}

/** The prize line, as it will be printed on the card. */
export function normalisePrizeLine(value) {
    return normaliseText(value, REQUEST_LIMITS.prize);
}

export function normaliseDates(value) {
    return normaliseText(value, REQUEST_LIMITS.dates);
}

/** The free-form note, which may be empty — the only optional field. */
export function normaliseNote(value) {
    if (value === null || value === undefined || value === '') return null;
    return normaliseText(value, REQUEST_LIMITS.note);
}

/**
 * The project slug a request would take if it became a project.
 *
 * Derived from the handle, so the slug is a decision made once, here, instead of by hand twice — the
 * slug is the key a project's entries are filed under the moment somebody registers. It is minted on
 * approval, and from then on it **is** the project: the page reads the approved rows out of the
 * store, so a new collaboration needs no edit to any file.
 */
export function projectSlugFor(handle) {
    const clean = normaliseDisplayHandle(handle);
    if (!clean) return null;
    return clean.toLowerCase().replace(/_/g, '-');
}

/**
 * Read a `data:` URL as an image we will store, or say why we will not.
 *
 * The declared type is checked **and** the bytes are checked against it. A file that says
 * `image/png` and is not one is the whole reason this is a function rather than a `startsWith`: the
 * bytes are what a browser will later be asked to decode, and a stored lying header is how an "image"
 * becomes a script or a 404 in somebody's timeline.
 */
export function readPhotoDataUrl(value) {
    if (typeof value !== 'string') return { ok: false, reason: 'no picture was sent' };
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value.trim());
    if (!match) return { ok: false, reason: 'the picture has to be a PNG, JPEG or WebP data URL' };
    const mime = match[1];
    if (!PFP_TYPES.includes(mime)) return { ok: false, reason: `we do not accept ${mime}` };

    let bytes;
    try {
        bytes = Buffer.from(match[2], 'base64');
    } catch {
        return { ok: false, reason: 'the picture could not be decoded' };
    }
    if (!bytes.length) return { ok: false, reason: 'the picture is empty' };
    if (bytes.length > PFP_MAX_BYTES) {
        return { ok: false, reason: `the picture is ${Math.round(bytes.length / 1024)} KB — the limit is ${Math.round(PFP_MAX_BYTES / 1024)} KB` };
    }

    const looksLike = {
        'image/png': bytes.length > 8 && bytes.readUInt32BE(0) === 0x89504e47,
        'image/jpeg': bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
        'image/webp': bytes.length > 12 && bytes.slice(0, 4).toString('ascii') === 'RIFF'
            && bytes.slice(8, 12).toString('ascii') === 'WEBP',
    }[mime];
    if (!looksLike) return { ok: false, reason: 'that file is not the picture its name says it is' };

    return { ok: true, mime, bytes: bytes.length, buffer: bytes, dataUrl: value.trim() };
}

/** The request a wallet sent, or null. */
export async function getRequest(address) {
    const key = requestKey(address);
    if (!key) return null;
    if (COLLAB_DRIVER === 'redis') {
        const raw = await redis('GET', key);
        return raw ? JSON.parse(raw) : null;
    }
    if (COLLAB_DRIVER === 'memory') return memory.requests?.[key] || null;
    return (await readFileStore()).requests?.[key] || null;
}

async function writeRequest(key, record) {
    if (COLLAB_DRIVER === 'redis') {
        await redis('SET', key, JSON.stringify(record));
        return record;
    }
    const data = COLLAB_DRIVER === 'memory' ? memory : await readFileStore();
    data.requests = data.requests || {};
    data.requests[key] = record;
    if (COLLAB_DRIVER === 'file') await writeFileStore(data);
    return record;
}

/**
 * Send a request, or edit the one already sent.
 *
 * Refused once the request is **approved**, and only then: an approved request is a live
 * collaboration — the card is made from it, the giveaway is announced off it — so letting the
 * browser rewrite the name and prize afterwards would let the picture and the post disagree with
 * what was agreed. A pending request can be corrected, and a rejected one resubmitted, which is the
 * whole point of rejection not being terminal.
 */
export async function putRequest({ address, name, handle, prize, dates = null, note = null } = {}) {
    const clean = normaliseAddress(address);
    if (!clean) return { error: 'A 0x wallet address is required.', code: 'bad-address' };

    const cleanName = normaliseProjectName(name);
    if (!cleanName) return { error: `Give your project a name of ${REQUEST_LIMITS.name} characters or fewer.`, code: 'bad-name' };
    const cleanHandle = normaliseDisplayHandle(handle);
    if (!cleanHandle) return { error: 'That is not an X handle. It should be letters, numbers and underscores, 15 at most.', code: 'bad-handle' };
    const cleanPrize = normalisePrizeLine(prize);
    if (!cleanPrize) return { error: `Describe the prize in ${REQUEST_LIMITS.prize} characters or fewer.`, code: 'bad-prize' };

    const key = requestKey(clean);
    const existing = await getRequest(clean);
    if (existing && existing.status === 'approved') {
        return { error: 'That request is already approved — message us on X if anything needs to change.', code: 'already-approved' };
    }

    const record = {
        wallet: clean,
        name: cleanName,
        handle: cleanHandle,
        prize: cleanPrize,
        dates: normaliseDates(dates),
        note: normaliseNote(note),
        status: 'pending',
        // No slug until it is approved: the slug is the key the project's registrations will be filed
        // under, and a project that was turned down never gets one.
        slug: existing?.slug || null,
        at: existing?.at || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        decidedAt: null,
        decidedNote: null,
        // A resubmission keeps its place in the queue's order (its original `at`) but is visibly a
        // new revision, and it loses nothing the owner may have already looked at — the count of
        // times it has been sent is worth being able to see.
        revisions: (Number(existing?.revisions) || 0) + 1,
        photo: null,
        photoMime: null,
        photoBytes: null,
        photoAt: null,
    };

    await writeRequest(key, record);
    return { ok: true, request: record, resubmitted: !!existing };
}

/** Withdraw a request. Refused once approved — that one is a conversation, not a form. */
export async function removeRequest(address) {
    const existing = await getRequest(address);
    if (!existing) return { ok: true, removed: false };
    if (existing.status === 'approved') {
        return { error: 'That request is approved — message us on X rather than withdrawing it.', code: 'already-approved' };
    }
    const purged = await purgeRequest(address);
    return { ok: true, removed: purged.removed.length > 0 };
}

/**
 * Approve or reject a request. **The owner is the only caller**, and there are two ways in: the CLI
 * (`tools/collab-requests.js`) and the owner's own page (`app/api/collab/review/route.js`, which asks
 * `lib/collab-owners.js` whether the signed wallet is the owner before it gets here).
 *
 * What stays true is the part that matters: **no browser can ask for this for itself.** There is no
 * route a project can reach that moves its own status, and the address a decision is made about is
 * the *subject* of the call — the authority comes from the signed wallet of whoever asked for it.
 */
export async function setRequestStatus(address, status, { note = null, now = new Date() } = {}) {
    if (!REQUEST_STATUSES.includes(status)) {
        return { error: `unknown status ${status}`, code: 'bad-status' };
    }
    const key = requestKey(address);
    const existing = await getRequest(address);
    if (!key || !existing) return { error: 'no such request', code: 'not-found' };

    const record = {
        ...existing,
        status,
        decidedAt: now.toISOString(),
        decidedNote: note,
        // Minted once, on approval: from here on the slug is the project's key in the store *and* the
        // thing the page lists it under, so it is not a suggestion to be copied anywhere.
        slug: status === 'approved' ? (existing.slug || projectSlugFor(existing.handle)) : existing.slug || null,
    };
    await writeRequest(key, record);
    return { ok: true, request: record };
}

/**
 * Attach the picture the card is made from. **Approved requests only**, checked here as well as in
 * the route: this is the one field whose eligibility is a policy rather than a shape.
 */
export async function attachRequestPhoto(address, photo) {
    const key = requestKey(address);
    const existing = await getRequest(address);
    if (!key || !existing) return { error: 'no such request', code: 'not-found' };
    if (existing.status !== 'approved') {
        return { error: 'A project picture can only be uploaded once the collaboration is approved.', code: 'not-approved' };
    }

    const read = readPhotoDataUrl(photo);
    if (!read.ok) return { error: read.reason, code: 'bad-photo' };

    const record = {
        ...existing,
        photo: read.dataUrl,
        photoMime: read.mime,
        photoBytes: read.bytes,
        photoAt: new Date().toISOString(),
    };
    await writeRequest(key, record);
    return { ok: true, request: record, mime: read.mime, bytes: read.bytes };
}

/**
 * Every request, oldest first — for the owner's tool and the owner's page. Never for a public page:
 * a row carries a plan, a handle and the wallet that sent it, and the only reader is the owner, who
 * reaches these through `app/api/collab/review/route.js` and `tools/collab-requests.js`.
 */
export async function listRequests({ status = null, limit = 0 } = {}) {
    let rows;
    if (COLLAB_DRIVER === 'redis') {
        const { url, token } = redisEnv();
        rows = [];
        let cursor = '0';
        do {
            const res = await fetch(url, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(['SCAN', cursor, 'MATCH', `${REQUEST_PREFIX}*`, 'COUNT', '1000']),
                cache: 'no-store',
            });
            const body = await res.json();
            if (body.error) throw new Error(`collab store: redis SCAN → ${body.error}`);
            cursor = String(body.result?.[0] ?? '0');
            for (const key of body.result?.[1] || []) {
                const raw = await redis('GET', key);
                if (raw) rows.push(JSON.parse(raw));
            }
        } while (cursor !== '0');
    } else {
        const data = COLLAB_DRIVER === 'memory' ? memory : await readFileStore();
        rows = Object.values(data.requests || {});
    }
    const filtered = status ? rows.filter((row) => row?.status === status) : rows;
    filtered.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
    return limit > 0 ? filtered.slice(0, limit) : filtered;
}

/**
 * The approved request behind a project slug, or null.
 *
 * A request is keyed by the **wallet** that sent it, so a slug is not something the store can look up
 * directly — there is no index from one to the other, and adding one would be a second thing to keep
 * true. Approved rows are read and one is picked. That is a scan of a handful of keys for the two
 * callers that need it: the picture route, and `knownProject` when a slug is not pinned.
 */
export async function approvedRequestForSlug(slug) {
    if (typeof slug !== 'string' || !slug) return null;
    const rows = await listRequests({ status: 'approved' });
    return rows.find((row) => row.slug === slug) || null;
}

/**
 * A request as the owner's page reads it: **the picture's bytes are not in it.**
 *
 * The store keeps an upload as a `data:` URL, and a list of ten requests handed to a browser whole
 * would be ten base64 portraits at up to 256 KB each — megabytes to draw thumbnails. So the bytes are
 * dropped and the row carries `hasPhoto`, the size and the time instead, plus a **URL** when there is
 * a picture a browser can actually fetch: `/api/collab/photo`, which serves an approved project's
 * picture and nothing else. A rejected row keeps its picture in the store and gets no URL, because
 * that route will not serve it — the owner sees that it is there and how big it is.
 *
 * Everything else is the row as stored: the wallet that asked, the words it typed, its revisions and
 * the decision. A decision comes back in this same shape, so the page can replace one row rather than
 * re-reading the list.
 */
export function reviewRow(request) {
    if (!request) return null;
    const { photo, ...rest } = request;
    return {
        ...rest,
        hasPhoto: typeof photo === 'string' && photo.length > 0,
        photoUrl: request.status === 'approved' && photo ? projectPhotoUrl(request) : null,
    };
}

/**
 * Every project the giveaway tab shows: the pinned ones, plus every approved request.
 *
 * This is the read that makes approval enough. No file is edited between a project being approved
 * and its giveaway being on `/collab` — the page asks for this on each render and shows whatever is
 * on the store, picture included.
 *
 * It **never throws**. A store that cannot be reached leaves the pinned projects rather than an
 * empty page: the tab is how a partner's community finds the giveaway, and the one thing it must not
 * do when the database is having a bad minute is tell them there is nothing to enter.
 */
export async function listedProjects() {
    try {
        return composeProjects(await listRequests({ status: 'approved' }));
    } catch (error) {
        console.warn(`[collab] could not read the approved projects: ${error?.message || error}`);
        return composeProjects([]);
    }
}

/** Remove a request and its picture. For the owner's tool and for the harness. */
export async function purgeRequest(address) {
    const key = requestKey(address);
    const existing = await getRequest(address);
    if (!key || !existing) return { removed: [], survived: false };

    if (COLLAB_DRIVER === 'redis') {
        await redis('DEL', key);
    } else {
        const data = COLLAB_DRIVER === 'memory' ? memory : await readFileStore();
        delete data.requests?.[key];
        if (COLLAB_DRIVER === 'file') await writeFileStore(data);
    }
    return { removed: [key], survived: (await getRequest(address)) !== null };
}
