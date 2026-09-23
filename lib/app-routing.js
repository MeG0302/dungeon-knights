/**
 * Which host serves what — the decision, with no `NextResponse` in sight.
 *
 * This was inline in `middleware.js` until it needed testing. It cannot be tested from there: the
 * `next` package ships no `exports` map, so `next/server` resolves under CJS but **not** under ESM,
 * and a Node harness that imports the middleware dies on `Cannot find module 'next/server'` before
 * it reaches a single rule. The rules are the part worth testing — a gate that accidentally serves
 * the hub, or an escape hatch that works in production, is invisible in a browser until it is not —
 * so they live here, as plain functions over plain values, and the middleware does nothing but turn
 * the answer into a response.
 *
 * Two exports, in the order the middleware uses them:
 *
 *   `classify(pathname)` says which bucket a path is in, without knowing the host;
 *   `decideRoute({…})` says what to do with it, given the host and the gate's two facts.
 *
 * Everything about *why* each list is what it is stays with the middleware, where it is read next
 * to the response it produces.
 */

// Explicit `.js`: this module is imported by the offline harness under plain Node, which does not
// resolve extensionless specifiers the way the bundler does.
import { APP_HOSTS, isAppRequest, isApexHost } from './app-gate.js';

export { isAppRequest, isApexHost };

/**
 * Signature-authenticated, so it stays reachable on **any** host — the platform calls it, and a
 * platform cannot type a password.
 *
 *   `/api/x/events`              the X webhook for the one-time tasks. Registered against
 *                                `dungeon-knights.vercel.app`, which is a gated host now: the
 *                                exemption is *by path*, so the registration is unaffected.
 *   `/api/discord/interactions`  Discord's endpoint, which `tools/discord-setup.js` points at
 *                                `https://dungeonknights.io/api/discord/interactions`. It was landing
 *                                in `other` and being 308'd to the gated host — which has no DNS record
 *                                yet. Nothing is registered with Discord today (`(none set)`, read from
 *                                the application record), and the wiring tool's own preflight requires
 *                                an unsigned request to answer **401**, so that redirect is what would
 *                                have made the wiring fail. Ed25519 is its authenticator
 *                                (`lib/discord-interactions.js`), the same way the webhook's HMAC is
 *                                its own; being reachable is the whole design.
 */
export const GLOBAL_OPEN = ['/api/x/events', '/api/discord/interactions'];

/** What the apex serves publicly. Everything else there belongs to the game. */
export const APEX_PUBLIC = [
    '/',
    '/points',
    // The Genesis collection page, which the landing page's second button opens. Public for the
    // same reason `/points` is: it is the page a stranger is being sent to, it needs no wallet, and
    // the whole point of the apex is that the door is open. Without this entry the apex would 308
    // it to the password on the app host, which is the one place this page must never be.
    '/genesis',
    // The portfolio is a page strangers are sent to, which is why it is here and not with the game.
    // The Points Program hands people a points balance and a rank and no way to look at them; the
    // portfolio is where a player checks what a season of that produced. It reads a wallet and shows
    // it, so it needs no password on the host whose whole job is being open.
    '/portfolio',
    '/api/points',
    '/api/waitlist',
    // The portfolio's other three panels. Every one of these is a GET keyed by a wallet address over
    // public chain data — an address and a transaction are public by construction — and none of them
    // takes a key or writes anything. Listed by exact path rather than by prefix, so the staking and
    // game *writes* stay behind the gate: `/api/staking/holdings` is public, `/api/staking/stake`
    // would not be.
    '/api/wallet',
    '/api/staking/holdings',
    '/api/game/history',
];

/** Reachable on the gated host without a password: the screen you type it into, and assets. */
export const APP_OPEN = ['/gate', '/api/gate', '/_next/', '/assets/'];

/** Spellings of the Kingdom Gate hub, which is the app host's front page. */
export const HUB_PATHS = new Set(['/', '/hub', '/landing', '/landing.html']);

/** Root-level files that live in `public/` (theme.css, wallet.js, maps, icons…). */
export const STATIC_FILE = /\.(?:css|js|mjs|map|png|jpe?g|gif|webp|avif|svg|ico|mp4|webm|mp3|ogg|wav|woff2?|ttf|otf|json|txt|xml|webmanifest)$/i;

/**
 * Exact, or a whole path segment below it — `/api/points` covers `/api/points/me` but never
 * `/api/pointsomething`. An entry ending in `/` is a plain prefix. `/` itself is exact only, so the
 * apex's public list cannot accidentally swallow `/menu`.
 */
export function startsWithAny(pathname, list) {
    return list.some((entry) => {
        // `/` is exact, and only exact. Written the general way it matched *every* path — every entry
        // ending in `/` is a prefix, and `/` ends in `/` — which quietly made the whole apex public.
        // Measured: `/menu` answered 200 instead of redirecting to the gated host.
        if (entry === '/') return pathname === '/';
        return pathname === entry || pathname.startsWith(entry.endsWith('/') ? entry : `${entry}/`);
    });
}

/** Is this a file the browser fetches directly, rather than a page or an API? */
export function isStaticFile(pathname) {
    return STATIC_FILE.test(pathname);
}

/**
 * The bucket a path falls in, independent of host. `other` is the bucket that is ambiguous by
 * itself: on the apex it is a redirect to the game, on the app host it is the thing the password
 * guards.
 */
export function classify(pathname) {
    if (startsWithAny(pathname, GLOBAL_OPEN)) return 'global-open';
    if (startsWithAny(pathname, APEX_PUBLIC)) return 'apex-public';
    if (isStaticFile(pathname)) return 'static';
    if (startsWithAny(pathname, APP_OPEN)) return 'app-open';
    return 'other';
}

/**
 * Read the dev-only host switch.
 *
 * `localhost:3000` cannot be two hostnames, so the whole split would be untestable before it is
 * published. `?__app=1` / `?__app=0` sets a cookie that only ever counts in development — the
 * `isProduction` check is here, not in the caller, so there is one place to read the rule.
 */
export function readDevHost({ searchParams, cookieValue, isProduction }) {
    if (isProduction) return { devHost: null, setDevHost: null };
    const wanted = searchParams?.get?.('__app');
    if (wanted === '1' || wanted === '0') return { devHost: wanted, setDevHost: wanted };
    return { devHost: cookieValue ?? null, setDevHost: null };
}

/**
 * Does the password guard this path on the gated host?
 *
 * Exported, and used by **both** callers, because the middleware has to know whether the MAC is
 * worth computing and the decision has to know whether the answer is worth using. When those two
 * asked the question separately they disagreed: the middleware computed the MAC only for
 * `kind === 'other'` while the decision treated `apex-public` as gated — and since `/` is in the
 * apex's public list, the front page of the gated host could never be reached. Typing the password
 * bounced you straight back to the password screen. Measured in a browser-shaped way: a valid cookie
 * on `/?__app=1` answered `307 /gate?next=%2F`. One function asking the question once is the fix.
 */
export function gateCovers(kind) {
    // The webhook is signed and the password screen and assets have to load *before* anybody has a
    // cookie, so all three pass through. Everything else on this host is behind the password —
    // including `/points`, which is public on the apex and private here, and that is deliberate:
    // this host is the game, and nothing on it is meant to be reached without the password.
    return kind !== 'global-open' && kind !== 'app-open' && kind !== 'static';
}

/**
 * What to do with a request.
 *
 * Returns one of:
 *
 *   `{ action: 'next' }`            let Next route it normally
 *   `{ action: 'redirect', to }`    send it to the gated host, same path and method (308)
 *   `{ action: 'rewrite', pathname }` serve a different route at this URL (`/` → `/hub`)
 *   `{ action: 'gate', next }`      send them to the password screen, remembering where they were
 *
 * `passwordConfigured` and `gateAllowed` are the gate's two facts, passed in rather than read here:
 * one is an env var, the other needs a Web Crypto MAC, and neither belongs in a function that is
 * mostly about pathnames. Deciding the *order* they are consulted in does belong here — an
 * unconfigured deployment is open, and a gated path is gated **before** it can be rewritten.
 *
 * `isApp` and `isApex` are two separate facts, and neither is the negation of the other. A host that
 * is both false — a Vercel preview URL, `dungeon-knights.vercel.app`, `localhost:3000` — is **left
 * alone**, and that is the whole point: reading "not the app host" as "the apex" is what took the
 * live game offline for a few minutes (see the note on `APEX_HOSTS` in `lib/app-gate.js`).
 *
 * In production those two facts are now complementary — `isAppRequest` gates everything that is not
 * the apex — so the third branch below is what **development** uses for `localhost`: one port, two
 * branches, neither name matching. It stays untouched so the dev loop is unchanged, and it is
 * unreachable in production, which is what makes the fail-closed rule above safe to reason about.
 */
export function decideRoute({
    isApp,
    isApex = false,
    kind,
    pathname,
    search = '',
    passwordConfigured = false,
    gateAllowed = false,
}) {
    if (!isApp) {
        // A host that is neither gated nor public: untouched. Whatever it served yesterday it serves
        // now — the game on a preview URL, the game on the vercel hostname, the game on localhost.
        if (!isApex) return { action: 'next' };

        // The public host. Its own pages and files pass through; anything else is the game, and the
        // game lives behind the password on the other host. A 308 keeps the method and the path, so
        // a bookmarked `/mint` still lands on the mint.
        if (kind === 'global-open' || kind === 'apex-public' || kind === 'static') return { action: 'next' };
        const appHost = APP_HOSTS[0];
        if (!appHost) return { action: 'next' };
        return { action: 'redirect', to: `https://${appHost}${pathname}${search}` };
    }

    // The gated host. Assets, the password screen and the webhook stay open on purpose: assets so
    // the password screen can wear the real theme, and the webhook because it is signed.
    if (!gateCovers(kind)) return { action: 'next' };

    if (!passwordConfigured) {
        // Configured to be open. The middleware says so loudly on its way past; here it just means
        // the host behaves like the apex rather than locking the team out of its own game.
        return { action: 'next' };
    }

    if (!gateAllowed) {
        // Not a 401: this is a page for a person, and it should be able to say what it is and send
        // them back to where they were trying to go.
        return { action: 'gate', next: `${pathname}${search}` };
    }

    // The hub answers at the *root* of this host, which is the whole point of `/hub` being an
    // internal file name. The legacy `landing.html` / `landing` spellings are what the pages inside
    // the game still link back to (`menu.html` → `landing.html`), and they resolve here as a
    // fallback — in practice `next.config.js` answers `/landing.html` with a 308 to `/` before the
    // middleware sees it, which lands on this same rewrite one hop later. Measured both ways.
    //
    // After the gate, never before it: returning this early served the whole hub without asking for
    // the password. Measured: `/?__app=1` answered 200 with the game's front door.
    if (HUB_PATHS.has(pathname)) return { action: 'rewrite', pathname: '/hub' };

    return { action: 'next' };
}
