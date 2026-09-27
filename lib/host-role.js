/**
 * Which host this browser is on — the half of `lib/app-gate.js` a *page* may import.
 *
 * `lib/app-gate.js` signs the gate cookie, so it reads `APP_GATE_PASSWORD` and must never reach a
 * bundle; that rule is written at the bottom of that file, and it is why returning to a page after
 * the password is `lib/safe-next.js`'s job rather than its own. This module is the second of the
 * pair: two lists of *public* hostnames and the rule that turns them into an answer, with nothing
 * in it worth hiding from anyone who can read the page.
 *
 * The lists live here, and `lib/app-gate.js` imports them as its defaults. Two copies of a hostname
 * list are two lists that drift, and this drift would be invisible in the worst way: the middleware
 * would gate one host while a page believed it was public, or the reverse. `tools/check-portfolio.js`
 * feeds both modules the same hostnames and fails if they ever disagree — which is the check that
 * keeps one list one list.
 *
 * WHY A PAGE NEEDS TO ASK. While the Knights panel is being built, `/portfolio` renders a squad of
 * sample knights — fixtures, not holdings. On the public apex that would be a claim about a wallet
 * nobody made, which is exactly what closing that panel was for. So the samples are shown on the
 * **gated** host only: the team's side, behind the password. This is what tells the page which side
 * it is on, and `tools/check-all.js` asserts both directions in one rec rather than trusting it.
 */

/**
 * The hostnames behind the gate, and the hostnames that are the public site. Named, and never
 * "not the other one" — see the note on `APEX_HOSTS` in `lib/app-gate.js` for the production outage
 * that rule cost.
 */
export const GATED_HOST_DEFAULTS = ['app.dungeonknights.io'];
export const PUBLIC_HOST_DEFAULTS = ['dungeonknights.io', 'www.dungeonknights.io'];

/**
 * The dev-only cookie that makes the app branch testable on `localhost`, where one port cannot be
 * two hostnames. It is deliberately not `HttpOnly`: it says nothing a stranger does not already
 * know — that this development server is pretending to be the gated host — and the page has to be
 * able to read it.
 */
export const DEV_HOST_COOKIE_NAME = 'dk_app_host';

/** Strip a port and lowercase — `app.dungeonknights.io:443` is the same host. */
export function normaliseHost(host) {
    return String(host || '').trim().toLowerCase().replace(/:\d+$/, '');
}

/**
 * Is the browser reading this page on the gated host?
 *
 * The same three steps, in the same order, as `isAppRequest` in `lib/app-gate.js` — named host,
 * then the development cookie, then fail closed in production — because the two answers are used
 * for the same decision and a page that disagreed with the middleware would be a page showing the
 * wrong thing about which side of the door it is on. `isProduction` is passed rather than read from
 * `process.env` here so this stays a plain function over plain values, which is what makes it
 * testable from a Node harness; the caller inlines its own `NODE_ENV`.
 *
 * **One case is deliberately not the same, and it is the empty one.** With no hostname at all this
 * answers `false` while `isAppRequest` answers `true`. The middleware is looking at a real request
 * whose `Host` is always set, and failing closed there is the safe direction. A *page* is
 * server-rendered first, where there is no `location` — and answering `true` there would put the
 * sample knights into the first paint for every visitor, which is the one thing they must not do.
 * So the page renders the closed panel on the server and swaps after mount if it turns out to be
 * the team's host. `tools/check-portfolio.js` pins both halves of this: the real hostnames must
 * agree between the two modules, and the empty one must answer `false` here.
 */
export function isGatedBrowser({
    hostname,
    devHostCookie = null,
    isProduction = true,
    gatedHosts = GATED_HOST_DEFAULTS,
    publicHosts = PUBLIC_HOST_DEFAULTS,
} = {}) {
    const host = normaliseHost(hostname);
    // No hostname at all is not the gated host: a page rendered on the server has no `location`,
    // and guessing "yes" there would put the samples in the first paint for everybody.
    if (!host) return false;
    if (gatedHosts.includes(host)) return true;
    if (!isProduction) return devHostCookie === '1';
    return !publicHosts.includes(host);
}
