/**
 * Is this X account really the one the player signed in with?
 *
 * Binding an X account is how a wallet gets *named* on the Points board, and a name that anyone
 * can type is not a name. Privy already knows the answer — the player links X to their Privy user
 * once — so this module asks Privy, rather than trusting the handle the browser sends.
 *
 * Two steps, and the first one is why the second can be believed:
 *
 *   1. **The token.** `verifyPrivyAccessToken` checks a Privy access token the way Privy's own docs
 *      say to: fetch the app's public JWKS, verify the ES256 signature against it, then check
 *      `iss`, `aud`, `exp` and that there is a subject. The JWKS is public and the app id is
 *      already in the environment, so this needs **no secret and no dependency** — it is
 *      `node:crypto` and one fetch. A token that passes really was issued by Privy to this app.
 *
 *   2. **The link.** An access token proves *who* (a Privy DID), not *which X handle* — Privy's
 *      access-token claims are `sid`, `sub`, `iss`, `aud`, `iat`, `exp` and nothing else. So the
 *      handle comes from `GET /api/v1/users/me` with the same token, whose `linked_accounts` is
 *      the authoritative record. This is a second network call and it can fail; when it does the
 *      caller is told exactly that, and falls back to a **provisional** binding rather than
 *      pretending the link was proved.
 *
 * What a provisional binding is worth is worth stating plainly: nothing can be earned with it.
 * Both rewards require a post **written by the bound handle**, and that is checked against X's
 * own record of the post. Claiming someone else's handle earns you the right to make posts as
 * them, which is not a thing you can do. So the proof here hardens *who the board says you are*;
 * it is not the lock on the till.
 *
 * Environment: `PRIVY_APP_ID` (already set — the provider uses it). No secret is read.
 */

import crypto from 'node:crypto';

/** The issuer every Privy access token carries. */
export const PRIVY_TOKEN_ISSUER = 'privy.io';

/** Privy rotates its keys rarely; re-reading them per request would be a fetch per login. */
const JWKS_TTL_MS = 30 * 60 * 1000;

/** Kept module-level on purpose: a warm serverless instance reuses it across requests. */
let keyCache = { appId: null, at: 0, keys: [] };

function appId() {
    return (process.env.PRIVY_APP_ID || '').trim();
}

/**
 * Whether this deployment can prove a binding at all. Surfaced to the page so it can say "bound,
 * but not proved" instead of implying a check that would have failed on a missing app id.
 */
export function privyAppConfigured() {
    return Boolean(appId());
}

function jwksUrl(id) {
    return `https://auth.privy.io/api/v1/apps/${id}/jwks.json`;
}

const USERS_ME_URL = 'https://auth.privy.io/api/v1/users/me';

/** For tests, so one case cannot be answered from another's cache. */
export function resetPrivyKeyCache() {
    keyCache = { appId: null, at: 0, keys: [] };
}

function timeoutSignal(ms) {
    return typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
}

function decodeSegment(segment) {
    return JSON.parse(Buffer.from(String(segment), 'base64url').toString('utf8'));
}

function signatureBuffer(segment) {
    return Buffer.from(String(segment), 'base64url');
}

/** The app's public keys, cached. Only EC P-256 keys are kept — anything else is not ours. */
async function verificationKeys(fetchImpl, now) {
    const id = appId();
    if (!id) return { ok: false, code: 'no-app-id', detail: 'PRIVY_APP_ID is not set' };
    if (keyCache.appId === id && keyCache.keys.length && now - keyCache.at < JWKS_TTL_MS) {
        return { ok: true, keys: keyCache.keys };
    }

    let res;
    try {
        res = await fetchImpl(jwksUrl(id), {
            cache: 'no-store',
            headers: { accept: 'application/json' },
            signal: timeoutSignal(8000),
        });
    } catch (error) {
        return { ok: false, code: 'jwks-unreachable', retryable: true, detail: error?.message || String(error) };
    }
    if (!res.ok) {
        return { ok: false, code: 'jwks-unavailable', retryable: true, detail: `http ${res.status}` };
    }

    let body;
    try {
        body = await res.json();
    } catch {
        return { ok: false, code: 'jwks-unreadable', retryable: true };
    }

    const keys = (Array.isArray(body?.keys) ? body.keys : []).filter(
        (key) => key?.kty === 'EC' && key?.crv === 'P-256' && key?.x && key?.y,
    );
    if (!keys.length) return { ok: false, code: 'jwks-empty', retryable: true };

    keyCache = { appId: id, at: now, keys };
    return { ok: true, keys };
}

/**
 * Verify a Privy access token: signature first, then the claims that make a signature mean
 * something. Returns `{ ok: true, userId, sessionId, claims }` or a coded refusal.
 *
 * The signature check tries every key that matches the token's `kid` (or all of them when the
 * header names none), because Privy publishes more than one and a token signed by the older key
 * is still perfectly valid.
 */
export async function verifyPrivyAccessToken(token, { fetchImpl = fetch, now = Date.now() } = {}) {
    const parts = String(token || '').trim().split('.');
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
        return { ok: false, code: 'malformed-token', detail: 'not a three-part JWT' };
    }

    let header;
    let claims;
    try {
        header = decodeSegment(parts[0]);
        claims = decodeSegment(parts[1]);
    } catch {
        return { ok: false, code: 'malformed-token', detail: 'undecodable header or payload' };
    }
    if (!claims || typeof claims !== 'object') {
        return { ok: false, code: 'malformed-token', detail: 'payload is not an object' };
    }
    // ES256 only. A token that says `alg: none` — or `HS256`, which would let anyone who has seen
    // the public key forge a token — is refused before any key is fetched.
    if (header?.alg !== 'ES256') {
        return { ok: false, code: 'unexpected-alg', detail: String(header?.alg) };
    }

    const keyset = await verificationKeys(fetchImpl, now);
    if (!keyset.ok) return keyset;

    const candidates = header.kid ? keyset.keys.filter((key) => key.kid === header.kid) : keyset.keys;
    if (!candidates.length) return { ok: false, code: 'unknown-key', detail: String(header.kid) };

    // JWS signatures are raw r‖s, not DER — without `ieee-p1363` every honest token fails.
    const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8');
    const signature = signatureBuffer(parts[2]);
    let verified = false;
    for (const jwk of candidates) {
        try {
            const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
            if (crypto.verify('sha256', signingInput, { key, dsaEncoding: 'ieee-p1363' }, signature)) {
                verified = true;
                break;
            }
        } catch {
            // A key we cannot import is not a key that verifies. Keep trying the others.
        }
    }
    if (!verified) return { ok: false, code: 'bad-signature' };

    if (claims.iss !== PRIVY_TOKEN_ISSUER) {
        return { ok: false, code: 'bad-issuer', detail: String(claims.iss) };
    }
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    // The audience is what stops a token issued for a *different* Privy app from working here.
    if (!audiences.includes(appId())) {
        return { ok: false, code: 'bad-audience', detail: audiences.join(',') };
    }
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) {
        return { ok: false, code: 'expired' };
    }
    if (typeof claims.sub !== 'string' || !claims.sub) {
        return { ok: false, code: 'no-subject' };
    }

    return { ok: true, userId: claims.sub, sessionId: claims.sid || null, claims };
}

/** The player's Twitter link, out of a Privy user record, or null. */
export function twitterFromUser(user) {
    const accounts = Array.isArray(user?.linked_accounts) ? user.linked_accounts : [];
    const linked = accounts.find((account) => (
        account?.type === 'twitter' && (account?.subject || account?.id) && account?.username
    ));
    if (!linked) return null;
    return {
        id: String(linked.subject || linked.id),
        username: String(linked.username).replace(/^@/, '').toLowerCase(),
        name: linked.name || null,
    };
}

/**
 * The whole question in one call: given an access token, which X account does it belong to?
 *
 * `{ ok: true, userId, twitter }` when both steps succeed — `twitter` may still be null, which
 * means "this Privy user has not linked X", a different answer from "we could not check".
 */
export async function privyIdentityFromToken(token, { fetchImpl = fetch, now = Date.now(), timeoutMs = 6000 } = {}) {
    const verified = await verifyPrivyAccessToken(token, { fetchImpl, now });
    if (!verified.ok) return verified;

    let res;
    try {
        res = await fetchImpl(USERS_ME_URL, {
            cache: 'no-store',
            headers: {
                authorization: `Bearer ${String(token).trim()}`,
                'privy-app-id': appId(),
                accept: 'application/json',
            },
            signal: timeoutSignal(timeoutMs),
        });
    } catch (error) {
        return { ok: false, code: 'user-unreachable', retryable: true, detail: error?.message || String(error) };
    }
    if (!res.ok) {
        return { ok: false, code: 'user-unreadable', retryable: true, detail: `http ${res.status}` };
    }

    let body;
    try {
        body = await res.json();
    } catch {
        return { ok: false, code: 'user-unreadable', retryable: true, detail: 'unparseable body' };
    }

    return { ok: true, userId: verified.userId, sessionId: verified.sessionId, twitter: twitterFromUser(body) };
}

/** A one-line summary for logs. Never includes the token itself. */
export function describeIdentity(result) {
    if (!result) return 'no identity';
    if (!result.ok) return `unverified (${result.code}${result.detail ? `: ${result.detail}` : ''})`;
    return result.twitter ? `privy ${result.userId} → @${result.twitter.username}` : `privy ${result.userId} → no X link`;
}
