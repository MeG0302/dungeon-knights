/**
 * Wallet sessions for the Points Program.
 *
 * A shared leaderboard is only worth anything if a wallet cannot be impersonated, so
 * the page proves ownership the way every other dapp does: the server hands out a
 * nonce, the player signs it, and `ethers` recovers the signer from the signature.
 * What comes back is a small HMAC-signed token the browser stores and sends as a
 * `Authorization: Bearer` header.
 *
 * Both halves are stateless — the nonce is a MAC over the address and its issue time,
 * and the token is a MAC over the address and its expiry — so nothing has to be stored
 * and a redeploy cannot resurrect or leak a pending challenge.
 *
 * Secret: `POINTS_SESSION_SECRET`. In development a fixed fallback is used so restarts
 * do not log everyone out. In production, a missing secret falls back to a random
 * per-process value and says so loudly: everything still works, but every cold start
 * invalidates outstanding sessions.
 */

import crypto from 'crypto';
import { utils } from 'ethers';
import { normaliseAddress } from './points-store.js';

const CHALLENGE_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

const SECRET = (() => {
    if (process.env.POINTS_SESSION_SECRET) return process.env.POINTS_SESSION_SECRET;
    if (process.env.NODE_ENV !== 'production') return 'dev-only-points-session-secret';
    const random = crypto.randomBytes(32).toString('hex');
    console.warn(
        '[points-session] POINTS_SESSION_SECRET is not set — using a random per-process secret. '
        + 'Points still work, but every redeploy and cold start signs players out. '
        + 'Set POINTS_SESSION_SECRET to keep sessions stable.'
    );
    return random;
})();

function mac(...parts) {
    return crypto.createHmac('sha256', SECRET).update(parts.join('|')).digest('hex');
}

function b64url(value) {
    return Buffer.from(value, 'utf8').toString('base64url');
}

function fromB64url(value) {
    return Buffer.from(value, 'base64url').toString('utf8');
}

/** The exact text the player signs. Field order is fixed — verifying parses it back. */
function buildMessage(address, issuedAt) {
    return [
        'Dungeon Knights — Points Program',
        '',
        `Wallet: ${address}`,
        `Nonce: ${mac('nonce', address, String(issuedAt)).slice(0, 32)}`,
        `Issued: ${issuedAt}`,
        '',
        'Signing proves you own this wallet. It costs no gas and moves no funds.',
    ].join('\n');
}

export function challengeFor(address) {
    const key = normaliseAddress(address);
    if (!key) return null;
    const issuedAt = Math.floor(Date.now() / 1000);
    return { address: key, issuedAt, message: buildMessage(key, issuedAt) };
}

function parseMessage(message) {
    const address = /Wallet:\s*(0x[0-9a-fA-F]{40})/.exec(message)?.[1];
    const issuedAt = Number(/Issued:\s*(\d+)/.exec(message)?.[1]);
    const nonce = /Nonce:\s*([0-9a-f]+)/.exec(message)?.[1];
    if (!address || !Number.isFinite(issuedAt) || !nonce) return null;
    return { address: normaliseAddress(address), issuedAt, nonce };
}

/**
 * Check a signed challenge. Returns the wallet address, or null when the signature is
 * missing, stale, forged, or signed by anything other than the address it claims.
 */
export function verifyChallenge(signature, message) {
    if (typeof signature !== 'string' || typeof message !== 'string') return null;
    const parsed = parseMessage(message);
    if (!parsed) return null;
    const age = Math.abs(Math.floor(Date.now() / 1000) - parsed.issuedAt);
    if (age > CHALLENGE_TTL_SECONDS) return null;
    // The nonce must be one this server issued for this address, which is what stops a
    // signature harvested somewhere else from being replayed at our API.
    const expected = mac('nonce', parsed.address, String(parsed.issuedAt)).slice(0, 32);
    if (parsed.nonce !== expected) return null;
    try {
        const signer = normaliseAddress(utils.verifyMessage(message, signature));
        return signer && signer === parsed.address ? signer : null;
    } catch {
        return null;
    }
}

export function issueToken(address) {
    const key = normaliseAddress(address);
    if (!key) return null;
    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
    const payload = b64url(JSON.stringify({ a: key, e: expiresAt }));
    return { token: `${payload}.${mac('token', payload)}`, expiresAt, address: key };
}

export function readToken(token) {
    if (typeof token !== 'string') return null;
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;
    const expected = mac('token', payload);
    // Constant-time compare: a length-dependent early exit leaks the MAC byte by byte.
    const a = Buffer.from(signature, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
        const parsed = JSON.parse(fromB64url(payload));
        if (!parsed?.a || !normaliseAddress(parsed.a)) return null;
        if (Number(parsed.e) < Math.floor(Date.now() / 1000)) return null;
        return normaliseAddress(parsed.a);
    } catch {
        return null;
    }
}

/** The signed-in wallet for a request, or null. */
export function sessionFromRequest(request) {
    const header = request.headers.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    return token ? readToken(token) : null;
}
