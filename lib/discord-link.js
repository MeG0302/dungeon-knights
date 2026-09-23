/**
 * Turning a wallet into a Discord role without asking anyone to trust anyone.
 *
 * THE PROBLEM
 * -----------
 * Holders-only rooms and rank roles need one fact: *this Discord account is that wallet*. Every way
 * of establishing it collapses into "prove the wallet" or "prove the Discord account", and one of the
 * two is always out of our hands. OAuth would prove the Discord side and then tell us nothing about
 * the wallet unless the person also signs. So the link is built the other way round, out of a piece
 * of data only the two parties could both know:
 *
 *   1. The wallet **signs** for a session, which the Points Program already does for every other
 *      action (`lib/points-session.js`). That proves the wallet, using code that is already trusted
 *      and tested in this project.
 *   2. The signed-in wallet asks for a **code**, six characters, good for fifteen minutes.
 *   3. The person types `/claim CODE` in Discord. Discord itself tells us who they are — an
 *      interaction arrives signed by Discord, with the member's id in it, and that signature is the
 *      whole of the proof on that side (`app/api/discord/interactions/route.js`).
 *
 * Neither half is worth anything alone, and the pair cannot be assembled by a third party: the code
 * is only ever shown to a signed-in wallet, and it burns when it is used.
 *
 * ONE WALLET, ONE ACCOUNT, BOTH WAYS
 * ----------------------------------
 * The obvious rule is one Discord account per wallet, and getting only that would leave the farm door
 * open: one wallet, ten Discord accounts, ten times the rooms. So both directions are stored and both
 * are checked, and either collision is refused with a sentence that says what happened. A person who
 * has genuinely lost a Discord account gets a human answer instead: staff unlink it with
 * `tools/discord-setup.js --unlink <discord id>`.
 *
 * The link is deliberately **permanent** otherwise. The X binding on the Points Program is permanent
 * for the same reason: an account that can be moved is an account that can be re-used, and the role
 * on the other end of it stops meaning anything.
 *
 * Its own store client, like the other two stores in this project, because it holds a different kind
 * of thing and one day will be pointed at a different database. Keys are prefixed `dk:discord:` and
 * only ever contain ids, never a secret and never an email.
 */

import { promises as fs } from 'fs';
import { randomInt } from 'crypto';
import path from 'path';
import { REF_CODE_ALPHABET } from './points-config.js';

const CODE_PREFIX = 'dk:discord:code:';
const USER_PREFIX = 'dk:discord:user:';
const ADDR_PREFIX = 'dk:discord:addr:';
const FILE_PATH = path.join(process.cwd(), '.data', 'discord-links.json');

/** Six characters from an alphabet with no 0/O, no 1/I/L, and no lower case to get wrong. */
export const CODE_LENGTH = 6;
export const CODE_ALPHABET = REF_CODE_ALPHABET;

/** Fifteen minutes. Long enough to switch to Discord, short enough that a screenshot goes stale. */
export const CODE_TTL_MS = 15 * 60 * 1000;

export const DISCORD_DRIVER = (() => {
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) return 'redis';
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) return 'redis';
    return process.env.NODE_ENV === 'production' ? 'memory' : 'file';
})();

export function storageDescription() {
    if (DISCORD_DRIVER === 'redis') return 'Upstash/Vercel KV (REST)';
    if (DISCORD_DRIVER === 'file') return `local file ${FILE_PATH}`;
    return 'in-memory (NOT PERSISTENT — set KV_REST_API_URL + KV_REST_API_TOKEN)';
}

if (DISCORD_DRIVER === 'memory') {
    console.warn('[discord-link] No Redis configured in production — wallet links will be lost on redeploy.');
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
    if (!res.ok) throw new Error(`discord store: redis ${command[0]} failed (${res.status})`);
    const body = await res.json();
    if (body.error) throw new Error(`discord store: redis ${command[0]} → ${body.error}`);
    return body.result;
}

const memory = { codes: {}, users: {}, addrs: {} };

async function readFileStore() {
    try {
        return JSON.parse(await fs.readFile(FILE_PATH, 'utf8'));
    } catch {
        return { codes: {}, users: {}, addrs: {} };
    }
}

async function writeFileStore(data) {
    await fs.mkdir(path.dirname(FILE_PATH), { recursive: true });
    await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2));
}

/** The document for the local drivers, whichever they are. */
async function localDoc() {
    if (DISCORD_DRIVER === 'memory') return memory;
    const data = await readFileStore();
    data.codes = data.codes || {};
    data.users = data.users || {};
    data.addrs = data.addrs || {};
    return data;
}

async function saveLocal(data) {
    if (DISCORD_DRIVER === 'file') await writeFileStore(data);
}

/** The shape a code is required to have before it is looked up. Never guess at a malformed one. */
export function normaliseCode(value) {
    const text = String(value || '').trim().toUpperCase().replace(/[\s-]/g, '');
    if (text.length !== CODE_LENGTH) return null;
    return [...text].every((char) => CODE_ALPHABET.includes(char)) ? text : null;
}

/** A code, drawn from the alphabet with an unbiased generator. `randomInt` is rejection-sampled. */
export function drawCode() {
    let out = '';
    for (let index = 0; index < CODE_LENGTH; index += 1) out += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
    return out;
}

function walletKey(address) {
    return String(address || '').toLowerCase();
}

/* ------------------------------------------------------------------------------- issuing */

/**
 * Hand a signed-in wallet a code.
 *
 * Any earlier code for the same wallet stops working here, so "show me a fresh one" cannot leave two
 * live codes for one wallet and a screenshot from an hour ago cannot be redeemed later. `taken` is
 * passed in by the caller when it has already written the code, so the two drivers share one path.
 */
export async function issueLinkCode(address, { nowMs = Date.now(), taken = null } = {}) {
    const wallet = walletKey(address);
    if (!/^0x[0-9a-f]{40}$/.test(wallet)) return { error: 'that is not a wallet address' };

    const record = { address: wallet, at: new Date(nowMs).toISOString(), expiresAt: nowMs + CODE_TTL_MS };

    // Collisions are vanishingly rare and cheap to avoid entirely: the write below is create-only.
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = taken && attempt === 0 ? taken : drawCode();
        const key = CODE_PREFIX + code;

        if (DISCORD_DRIVER === 'redis') {
            const previous = await redis('GET', USER_PREFIX + `pending:${wallet}`);
            const created = await redis('SET', key, JSON.stringify(record), 'PX', String(CODE_TTL_MS), 'NX');
            if (created !== 'OK') continue;
            if (previous && previous !== code) await redis('DEL', CODE_PREFIX + previous);
            // A short index so a second tap replaces the first code rather than adding another.
            await redis('SET', USER_PREFIX + `pending:${wallet}`, code, 'PX', String(CODE_TTL_MS));
            return { ok: true, code, expiresAt: record.expiresAt, replaces: previous && previous !== code ? previous : null };
        }

        const data = await localDoc();
        if (data.codes[key]) continue;
        const previous = data.users[`pending:${wallet}`] || null;
        data.codes[key] = record;
        data.users[`pending:${wallet}`] = code;
        if (previous && previous !== code) delete data.codes[CODE_PREFIX + previous];
        await saveLocal(data);
        return { ok: true, code, expiresAt: record.expiresAt, replaces: previous && previous !== code ? previous : null };
    }

    return { error: 'could not draw a code, try again' };
}

/** The code currently outstanding for a wallet, or null. Used by the page so a refresh shows it. */
export async function pendingCodeFor(address) {
    const wallet = walletKey(address);
    if (DISCORD_DRIVER === 'redis') {
        return await redis('GET', USER_PREFIX + `pending:${wallet}`) || null;
    }
    const data = await localDoc();
    return data.users[`pending:${wallet}`] || null;
}

/* ------------------------------------------------------------------------------ redeeming */

/**
 * Spend a code.
 *
 * Every refusal names one thing: unknown, expired, already linked to another wallet, or the wallet
 * already linked to somebody else. A single "that did not work" would leave the player with nowhere
 * to go, and the two collision cases genuinely need different help.
 */
export async function redeemLinkCode(code, member = {}, { nowMs = Date.now() } = {}) {
    const normalised = normaliseCode(code);
    const discordId = String(member.id || '').trim();
    if (!normalised) return { error: 'That code is not the right shape. Codes are six characters.', code: 'bad-code' };
    if (!/^\d{5,25}$/.test(discordId)) return { error: 'Discord did not tell us who you are.', code: 'no-member' };

    const key = CODE_PREFIX + normalised;
    let record = null;

    if (DISCORD_DRIVER === 'redis') {
        const raw = await redis('GET', key);
        record = raw ? JSON.parse(raw) : null;
    } else {
        const data = await localDoc();
        record = data.codes[key] || null;
    }

    if (!record) return { error: 'That code is not live. Ask the site for a new one.', code: 'unknown-code' };
    if (Number(nowMs) > Number(record.expiresAt)) {
        await dropCode(normalised, record.address);
        return { error: 'That code has expired. Ask the site for a new one and use it right away.', code: 'expired' };
    }

    const wallet = walletKey(record.address);
    const [holderOfWallet, heldByUser] = await Promise.all([linkForAddress(wallet), linkForUser(discordId)]);

    // Both sides checked before anything is written, and a re-link of the same pair is a success
    // rather than an error: people run /claim twice, and the second time should be quiet.
    const sameUser = heldByUser && walletKey(heldByUser.address) === wallet;
    if (heldByUser && !sameUser) {
        return {
            error: `This Discord account is already linked to ${short(heldByUser.address)}. Ask a Keeper to unlink it if that wallet is not yours any more.`,
            code: 'taken-user',
            address: walletKey(heldByUser.address),
        };
    }
    if (holderOfWallet && String(holderOfWallet.discordId) !== discordId) {
        return {
            error: 'That wallet is already linked to another Discord account. One wallet, one account.',
            code: 'taken-wallet',
            address: wallet,
        };
    }

    const userRecord = {
        address: wallet,
        username: member.username ? String(member.username).slice(0, 60) : (heldByUser?.username || null),
        at: new Date(nowMs).toISOString(),
        roles: heldByUser?.roles || [],
        syncedAt: heldByUser?.syncedAt || null,
    };
    const addrRecord = { discordId, at: userRecord.at };

    if (DISCORD_DRIVER === 'redis') {
        await redis('SET', USER_PREFIX + discordId, JSON.stringify(userRecord));
        await redis('SET', ADDR_PREFIX + wallet, JSON.stringify(addrRecord));
    } else {
        const data = await localDoc();
        data.users[discordId] = userRecord;
        data.addrs[wallet] = addrRecord;
        await saveLocal(data);
    }

    await dropCode(normalised, wallet);
    return { ok: true, address: wallet, relinked: Boolean(sameUser), username: userRecord.username };
}

async function dropCode(code, address) {
    const wallet = walletKey(address);
    if (DISCORD_DRIVER === 'redis') {
        await redis('DEL', CODE_PREFIX + code);
        const pending = await redis('GET', USER_PREFIX + `pending:${wallet}`);
        if (pending === code) await redis('DEL', USER_PREFIX + `pending:${wallet}`);
        return;
    }
    const data = await localDoc();
    delete data.codes[CODE_PREFIX + code];
    if (data.users[`pending:${wallet}`] === code) delete data.users[`pending:${wallet}`];
    await saveLocal(data);
}

function short(address) {
    const text = String(address || '');
    return /^0x[0-9a-fA-F]{40}$/.test(text) ? `${text.slice(0, 6)}…${text.slice(-4)}` : 'another wallet';
}

/* ------------------------------------------------------------------------------- reading */

export async function linkForUser(discordId) {
    const id = String(discordId || '').trim();
    if (!/^\d{5,25}$/.test(id)) return null;
    if (DISCORD_DRIVER === 'redis') {
        const raw = await redis('GET', USER_PREFIX + id);
        return raw ? JSON.parse(raw) : null;
    }
    return (await localDoc()).users[id] || null;
}

export async function linkForAddress(address) {
    const wallet = walletKey(address);
    if (!/^0x[0-9a-f]{40}$/.test(wallet)) return null;
    if (DISCORD_DRIVER === 'redis') {
        const raw = await redis('GET', ADDR_PREFIX + wallet);
        return raw ? JSON.parse(raw) : null;
    }
    return (await localDoc()).addrs[wallet] || null;
}

/** Remember what the role sync last granted, so `/whoami` can name it without a second chain read. */
export async function recordSyncedRoles(discordId, roles = []) {
    const existing = await linkForUser(discordId);
    if (!existing) return null;
    const next = { ...existing, roles: [...roles], syncedAt: new Date().toISOString() };
    if (DISCORD_DRIVER === 'redis') {
        await redis('SET', USER_PREFIX + String(discordId), JSON.stringify(next));
    } else {
        const data = await localDoc();
        data.users[String(discordId)] = next;
        await saveLocal(data);
    }
    return next;
}

/** Every link, for the tools. Small by nature: one row per player who has ever claimed. */
export async function listLinks() {
    if (DISCORD_DRIVER === 'redis') {
        const { url, token } = redisEnv();
        const rows = [];
        let cursor = '0';
        do {
            const res = await fetch(url, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(['SCAN', cursor, 'MATCH', `${USER_PREFIX}*`, 'COUNT', '500']),
                cache: 'no-store',
            });
            const body = await res.json();
            if (body.error) throw new Error(`discord store: redis SCAN → ${body.error}`);
            cursor = String(body.result?.[0] ?? '0');
            for (const key of body.result?.[1] || []) {
                if (key.includes(':pending:')) continue;
                const raw = await redis('GET', key);
                if (raw) rows.push({ discordId: key.slice(USER_PREFIX.length), ...JSON.parse(raw) });
            }
        } while (cursor !== '0');
        return rows;
    }
    const data = await localDoc();
    return Object.entries(data.users)
        .filter(([key]) => !key.startsWith('pending:'))
        .map(([discordId, record]) => ({ discordId, ...record }));
}

/**
 * Remove everything filed under a set of wallets.
 *
 * For the harness, which writes real links into a real store and has to take them out again — the
 * same bargain `purgeWallet` makes for the points program and `purgeEntry` for the waitlist. It
 * returns the labels it removed so a caller can assert on the removal rather than on its own
 * optimism, and it deliberately does not touch links for any wallet it was not given.
 */
export async function purgeLinks(addresses = []) {
    const removed = [];
    for (const address of addresses) {
        const wallet = walletKey(address);
        if (!/^0x[0-9a-f]{40}$/.test(wallet)) continue;
        const link = await linkForAddress(wallet);
        if (link) {
            await unlinkDiscord(link.discordId);
            removed.push(ADDR_PREFIX + wallet, USER_PREFIX + link.discordId);
        }
        if (DISCORD_DRIVER === 'redis') {
            const pending = await redis('GET', USER_PREFIX + `pending:${wallet}`);
            if (pending) {
                await redis('DEL', CODE_PREFIX + pending, USER_PREFIX + `pending:${wallet}`);
                removed.push(CODE_PREFIX + pending);
            }
        } else {
            const data = await localDoc();
            const pending = data.users[`pending:${wallet}`];
            if (pending) {
                delete data.codes[CODE_PREFIX + pending];
                delete data.users[`pending:${wallet}`];
                await saveLocal(data);
                removed.push(CODE_PREFIX + pending);
            }
        }
    }
    return { removed };
}

/**
 * Take a link away.
 *
 * Only ever run by a person for a reason they can explain (a lost Discord account, a wallet sold with
 * a link attached). The pending code is left alone: unlinking is not the same act as cancelling.
 */
export async function unlinkDiscord(discordId) {
    const id = String(discordId || '').trim();
    const existing = await linkForUser(id);
    if (!existing) return { removed: false, reason: 'no link for that Discord account' };
    const wallet = walletKey(existing.address);
    if (DISCORD_DRIVER === 'redis') {
        await redis('DEL', USER_PREFIX + id);
        await redis('DEL', ADDR_PREFIX + wallet);
    } else {
        const data = await localDoc();
        delete data.users[id];
        delete data.addrs[wallet];
        await saveLocal(data);
    }
    return { removed: true, address: wallet };
}
