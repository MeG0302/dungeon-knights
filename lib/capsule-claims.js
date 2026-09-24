/**
 * Capsule claims: the message a winner signs, and what it proves.
 *
 * A capsule is worth money, so it is sent to a wallet only after that wallet has **proved** it is the
 * player's. The proof is the same one the Points Program already uses to sign a player in — the
 * server writes a message, the wallet signs it, `ethers` recovers the signer — with two changes that
 * matter, and both of them exist because this signature authorises a *specific* thing:
 *
 *   - **It says what it is for.** The message begins `Dungeon Knights — Capsule Delivery` and carries
 *     `Purpose: register` or `Purpose: claim`. That is not decoration: a sign-in signature is a
 *     perfectly valid 65-byte signature by the same wallet, and if a claim were verified by "the
 *     signer is the wallet" alone then any site the player had ever signed in to could be replayed
 *     here. `verifyCapsuleChallenge` reads the family first and refuses anything else.
 *   - **A claim names its day.** `Day: 2026-09-25` is in the message, and the caller must say which
 *     day it expects. This is what makes the owner's rule — *submit your wallet daily* — hold against
 *     a player who honestly kept yesterday's signature, or one who tried to file it again today. The
 *     day is compared, not trusted.
 *
 * Both halves are stateless, like the session: the nonce is a MAC over the address, the purpose, the
 * day and the issue time, so nothing has to be stored for a challenge to be checkable and a redeploy
 * cannot resurrect one. Secret: `CAPSULE_CLAIM_SECRET`, falling back to the session secret and then
 * to a loud per-process value in production — the same trade the session makes, so a deployment that
 * sets one secret does not silently have two.
 */

import crypto from 'crypto';
import { utils } from 'ethers';
import { normaliseAddress } from './points-store.js';

const CHALLENGE_TTL_SECONDS = 10 * 60;

/** The first line, and the whole of what separates this family from a sign-in. */
const FAMILY = 'Dungeon Knights — Capsule Delivery';

export const CAPSULE_PURPOSES = ['register', 'claim'];

const SECRET = (() => {
    if (process.env.CAPSULE_CLAIM_SECRET) return process.env.CAPSULE_CLAIM_SECRET;
    if (process.env.POINTS_SESSION_SECRET) return `capsules:${process.env.POINTS_SESSION_SECRET}`;
    if (process.env.NODE_ENV !== 'production') return 'dev-only-capsule-claim-secret';
    const random = crypto.randomBytes(32).toString('hex');
    console.warn(
        '[capsule-claims] Neither CAPSULE_CLAIM_SECRET nor POINTS_SESSION_SECRET is set — using a '
        + 'random per-process secret, so a signature is only valid on the instance that issued it. '
        + 'Set CAPSULE_CLAIM_SECRET.'
    );
    return random;
})();

function mac(...parts) {
    return crypto.createHmac('sha256', SECRET).update(parts.join('|')).digest('hex');
}

/** What a signature is kept as on the record: evidence it happened, not a thing that can be replayed. */
export function signatureDigest(signature) {
    return crypto.createHash('sha256').update(String(signature || ''), 'utf8').digest('hex').slice(0, 40);
}

function buildMessage({ address, purpose, day, issuedAt }) {
    const lines = [
        FAMILY,
        '',
        `Wallet: ${address}`,
        `Purpose: ${purpose}`,
    ];
    if (purpose === 'claim') lines.push(`Day: ${day}`);
    lines.push(
        `Nonce: ${mac('nonce', address, purpose, day || '', String(issuedAt)).slice(0, 32)}`,
        `Issued: ${issuedAt}`,
        '',
        purpose === 'claim'
            ? 'Signing proves this wallet is yours and claims the capsule you won that day. No gas, no funds move.'
            : 'Signing proves this wallet is yours, so a capsule you win can be sent to it. No gas, no funds move.',
    );
    return lines.join('\n');
}

/**
 * A message for a wallet to sign.
 *
 * `day` is required for a claim and refused for a registration: a claim that named no day would be a
 * signature that could be spent on any day, which is the thing this module exists to prevent.
 */
export function challengeFor(address, purpose = 'register', day = null) {
    const key = normaliseAddress(address);
    const wanted = String(purpose || '').trim().toLowerCase();
    if (!key || !CAPSULE_PURPOSES.includes(wanted)) return null;
    if (wanted === 'claim' && !/^\d{4}-\d{2}-\d{2}$/.test(String(day || '').trim())) return null;

    const issuedAt = Math.floor(Date.now() / 1000);
    const forDay = wanted === 'claim' ? String(day).trim() : null;
    return {
        address: key,
        purpose: wanted,
        day: forDay,
        issuedAt,
        expiresAt: new Date((issuedAt + CHALLENGE_TTL_SECONDS) * 1000).toISOString(),
        message: buildMessage({ address: key, purpose: wanted, day: forDay, issuedAt }),
    };
}

/** The fields a capsule message carries, or null when this is not one. */
function parseMessage(message) {
    if (typeof message !== 'string' || !message.startsWith(FAMILY)) return null;
    const address = /Wallet:\s*(0x[0-9a-fA-F]{40})/.exec(message)?.[1];
    const purpose = /Purpose:\s*([a-z]+)/.exec(message)?.[1];
    const day = /Day:\s*(\d{4}-\d{2}-\d{2})/.exec(message)?.[1] || null;
    const issuedAt = Number(/Issued:\s*(\d+)/.exec(message)?.[1]);
    const nonce = /Nonce:\s*([0-9a-f]+)/.exec(message)?.[1];
    if (!address || !purpose || !nonce || !Number.isFinite(issuedAt)) return null;
    if (!CAPSULE_PURPOSES.includes(purpose)) return null;
    // The two purposes differ in whether they carry a day, and that difference is structural: a
    // claim without one, or a registration with one, is a message this server never wrote.
    if (purpose === 'claim' && !day) return null;
    if (purpose === 'register' && day) return null;
    return { address: normaliseAddress(address), purpose, day, issuedAt, nonce };
}

/**
 * Check a signed capsule message — and check it *against what was asked for*.
 *
 * `expect` is the caller's requirement: `{ purpose, day }`. It is compared here rather than at the
 * call site so that no path can verify a signature and then forget to ask what it was for. A
 * signature from the wrong family, the wrong purpose, the wrong day, a stale nonce, a forged nonce or
 * a different wallet all come back `null` — the same answer, because a caller cannot act on anything
 * but "this is not a claim I can honour".
 */
export function verifyCapsuleChallenge(signature, message, expect = {}) {
    if (typeof signature !== 'string' || typeof message !== 'string') return null;
    const parsed = parseMessage(message);
    if (!parsed) return null;

    if (expect.purpose && parsed.purpose !== expect.purpose) return null;
    if (expect.day && parsed.day !== String(expect.day)) return null;
    if (expect.address && parsed.address !== normaliseAddress(expect.address)) return null;

    const age = Math.abs(Math.floor(Date.now() / 1000) - parsed.issuedAt);
    if (age > CHALLENGE_TTL_SECONDS) return null;

    const expected = mac('nonce', parsed.address, parsed.purpose, parsed.day || '', String(parsed.issuedAt)).slice(0, 32);
    if (parsed.nonce !== expected) return null;

    try {
        const signer = normaliseAddress(utils.verifyMessage(message, signature));
        if (!signer || signer !== parsed.address) return null;
        return { address: signer, purpose: parsed.purpose, day: parsed.day, issuedAt: parsed.issuedAt };
    } catch {
        return null;
    }
}
