/**
 * The development door on `app.dungeonknights.io`.
 *
 * The game is early, and the hub, the mint, the vault and the dungeons all live at one hostname that
 * nobody outside the team should be browsing yet. So the **app host** sits behind a password, while
 * the apex — the coming-soon landing and the Points Program — stays public. That split is the point:
 * the campaign has to work for somebody who has never seen the game, and a gate on the apex would be
 * a gate on the only thing being advertised.
 *
 * Same shape as `lib/points-session.js`, on purpose: the password is compared in constant time, and
 * what the browser keeps is an HMAC over an expiry — nothing to store, nothing to leak, and a
 * redeploy cannot resurrect a session. The difference is that this is a *shared* password rather
 * than a per-wallet signature, because there is no wallet here to prove anything with.
 *
 * **Web Crypto, not `node:crypto`.** This module is imported by `middleware.js`, and Next 14 runs
 * middleware on the Edge runtime, where Node's `crypto` does not exist — importing it fails the
 * build with "the edge runtime does not support Node.js 'crypto' module". `globalThis.crypto.subtle`
 * works in both places (Node 18+ has it too), so one module serves the middleware, the API route and
 * the offline harness. The cost is that everything here is async.
 *
 * Secret: `APP_GATE_PASSWORD`. Unset means **the gate is off**, which is the honest default — a
 * deployment nobody configured should behave like today rather than lock the team out of its own
 * game. `gateConfigured()` is what the middleware asks.
 */

const COOKIE_NAME = 'dk_app_gate';
// The dev-only cookie that makes the app branch testable on localhost, where there is no DNS to
// distinguish the two hosts. See `isAppRequest` — it is ignored in production.
const DEV_HOST_COOKIE = 'dk_app_host';
const GATE_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Which hostnames are behind the gate **by name**, ahead of the fail-closed rule in `isAppRequest`.
 * Comma-separated so a preview hostname can be added without touching code. This list is what the
 * apex redirects to (`APP_HOSTS[0]`), so it must keep naming the host the game is meant to live on
 * even though production already gates everything that is not the apex.
 */
export const APP_HOSTS = (process.env.APP_HOSTS || 'app.dungeonknights.io')
    .split(',')
    .map((host) => host.trim().toLowerCase().replace(/:\d+$/, ''))
    .filter(Boolean);

/**
 * Which hostnames are the **public** site.
 *
 * Named, for the same reason `APP_HOSTS` is named, and it cost a production outage to learn it: the
 * apex branch was written as "not the gated host", so `dungeon-knights.vercel.app/menu` — a host that
 * is neither gated nor the apex — was redirected to the app hostname too, and the game became
 * unreachable everywhere at once, including on the host the X webhook is registered against. Measured
 * on the live deployment: `/menu` and `/game` on the vercel hostname both answered
 * `308 → https://app.dungeonknights.io/…`, which does not resolve.
 *
 * There are three classes:
 *
 *   **the apex**       the coming-soon landing, the Points Program, and a redirect for game paths.
 *   **the app host**   gated (or open, if no password is set) — the game.
 *   **anything else**  gated *in place* in production, by `isAppRequest`. Vercel answers every
 *                      deployment of this project under `*.vercel.app` — the project alias and one
 *                      URL per build, all of them public and none of them something the team
 *                      remembers to think about. Those are the production class that used to be
 *                      "untouched", and leaving them untouched meant the whole game, and the
 *                      Points API that reads the production store, answered on every past build.
 *                      Measured on the live deployment before this rule existed:
 *                      `dungeon-knights-<hash>.vercel.app/menu` answered 200 to a stranger.
 *
 *                      The old reason for leaving them alone was the X webhook, which is registered
 *                      against `dungeon-knights.vercel.app`. That reason is gone: signed endpoints
 *                      are exempted **by path** (`GLOBAL_OPEN`) before any host rule runs, and the
 *                      gate serves the password screen on the host being asked rather than
 *                      redirecting to a name that may not resolve. Verified after the change:
 *                      `/api/x/events` still answers on the vercel hostname, and `/menu` does not.
 *
 * In development `localhost` is the third class for real — one port, two branches — and it stays
 * untouched; `?__app=1` / `?__app=0` pick the side. The production rule never runs there.
 */
export const APEX_HOSTS = (process.env.APEX_HOSTS || 'dungeonknights.io,www.dungeonknights.io')
    .split(',')
    .map((host) => host.trim().toLowerCase().replace(/:\d+$/, ''))
    .filter(Boolean);

const PASSWORD = (process.env.APP_GATE_PASSWORD || '').trim();

const SECRET = (() => {
    if (process.env.APP_GATE_SECRET) return process.env.APP_GATE_SECRET;
    if (PASSWORD) return `gate:${PASSWORD}`;
    if (process.env.NODE_ENV !== 'production') return 'dev-only-app-gate-secret';
    // No password and no secret: nothing is gated (see `gateConfigured`), so this only has to be
    // unguessable, not stable.
    return randomHex(16);
})();

const encoder = new TextEncoder();

function randomHex(bytes) {
    const view = new Uint8Array(bytes);
    crypto.getRandomValues(view);
    return [...view].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function b64urlEncode(text) {
    return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(text) {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/');
    return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}

async function digest(text) {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

/** HMAC-SHA256 over the parts, joined — the same shape `points-session` uses. */
async function mac(...parts) {
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(SECRET),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(parts.join('|')));
    return b64urlEncode(String.fromCharCode(...new Uint8Array(signature)));
}

/**
 * Compare two byte arrays without an early exit.
 *
 * Honest caveat: JavaScript cannot *guarantee* constant time — a JIT is free to notice things a
 * compiler is not — so this is the standard mitigation rather than a proof. It is worth having
 * anyway: both sides here are fixed-length digests, so there is no length to leak, and the loop
 * removes the obvious byte-at-a-time signal.
 */
function timingSafeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
    return diff === 0;
}

/** Is a password configured at all? When it is not, the middleware does not gate anything. */
export function gateConfigured() {
    return PASSWORD.length > 0;
}

/**
 * Does this password open the door?
 *
 * Compares SHA-256 digests rather than the raw strings, so two passwords of different lengths still
 * take the same path through the comparison.
 */
export async function passwordMatches(candidate) {
    if (!gateConfigured() || typeof candidate !== 'string') return false;
    const given = await digest(candidate);
    const real = await digest(PASSWORD);
    return timingSafeEqual(given, real);
}

/** The value the browser keeps: an expiry and a MAC over it. Nothing else, because it is shared. */
export async function issueGateToken(nowSeconds = Math.floor(Date.now() / 1000)) {
    const payload = b64urlEncode(String(nowSeconds + GATE_TTL_SECONDS));
    return `${payload}.${await mac('gate', payload)}`;
}

/** Null unless the token is intact and unexpired. */
export async function readGateToken(token, nowSeconds = Math.floor(Date.now() / 1000)) {
    if (typeof token !== 'string') return null;
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;

    const expected = await mac('gate', payload);
    const given = encoder.encode(signature);
    const want = encoder.encode(expected);
    if (!timingSafeEqual(given, want)) return null;

    let expiresAt;
    try {
        expiresAt = Number(b64urlDecode(payload));
    } catch {
        return null;
    }
    if (!Number.isFinite(expiresAt) || expiresAt < nowSeconds) return null;
    return { expiresAt };
}

/** Strip a port and lowercase — `Host: app.dungeonknights.io:443` is the same host. */
export function normaliseHost(host) {
    return String(host || '').trim().toLowerCase().replace(/:\d+$/, '');
}

export function isAppHost(host) {
    return APP_HOSTS.includes(normaliseHost(host));
}

/** Is this hostname the public site? Distinct from "not the app host" on purpose. */
export function isApexHost(host) {
    return APEX_HOSTS.includes(normaliseHost(host));
}

/**
 * Is this request the gated application?
 *
 * Three ways to be, in the order they are trusted:
 *
 *   1. **Named in `APP_HOSTS`** — the host the game is meant to live on.
 *   2. **In development**, a cookie says so. `localhost:3000` cannot be two hostnames, so the whole
 *      split would otherwise be untestable before it is published. Ignored in production.
 *   3. **In production, anything that is not the apex.** Fail closed: a hostname nobody remembered
 *      to list is the *game*, not the public site. This is the rule that closes the deployment URLs
 *      — the project alias `dungeon-knights.vercel.app` and every `dungeon-knights-<hash>-….vercel.app`
 *      ever printed in a Vercel dashboard, an error report or a chat — all of which used to answer
 *      200 with the whole game while sharing the production store.
 *
 * The apex is matched **by name** (`isApexHost`), never "not the gated host": the difference is what
 * keeps this from becoming the inverse of the outage documented on `APEX_HOSTS`. A hostname that
 * merely looks like the apex (`dungeonknights.io.evil.com`) fails the name test and is gated, which
 * is the safe direction to be wrong in.
 */
export function isAppRequest({ host, devHostCookie, isProduction }) {
    if (isAppHost(host)) return true;
    if (!isProduction) return devHostCookie === '1';
    return !isApexHost(host);
}

/** `Set-Cookie` for a passing password. `secure` is the caller's job — it knows the protocol. */
export function gateCookie(token, { secure = true } = {}) {
    const attributes = [
        `${COOKIE_NAME}=${token}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${GATE_TTL_SECONDS}`,
    ];
    if (secure) attributes.push('Secure');
    return attributes.join('; ');
}

/** The dev-only host cookie. `Set-Cookie` strings, so the middleware hands them straight over. */
export function devHostCookie(value) {
    return value === '0'
        ? `${DEV_HOST_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`
        : `${DEV_HOST_COOKIE}=${value}; Path=/; SameSite=Lax; Max-Age=${GATE_TTL_SECONDS}`;
}

/** Read one cookie out of a request without pulling in a parser. */
export function cookieValue(request, name) {
    const header = request.headers.get('cookie') || '';
    for (const part of header.split(';')) {
        const index = part.indexOf('=');
        if (index === -1) continue;
        if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
    }
    return null;
}

export const GATE_COOKIE_NAME = COOKIE_NAME;
export const DEV_HOST_COOKIE_NAME = DEV_HOST_COOKIE;
export const GATE_TTL = GATE_TTL_SECONDS;

// `?next=` is sanitised by `lib/safe-next.js`, which the browser imports instead of this file — the
// rule is needed on the client, and this module must never reach a bundle (it reads a secret).
