/**
 * Who is allowed to open Privy's UI — us, on a click, or anybody with a URL.
 *
 * THE PROBLEM
 * -----------
 * Privy finishes an OAuth flow by looking for three parameters in the address bar:
 *
 *     privy_oauth_code, privy_oauth_state, privy_oauth_provider
 *
 * If all three are there, the SDK treats the load as "an OAuth flow is returning" and **opens its
 * own UI to complete it, with no click and no prompt**. Measured, not assumed: loading
 * `/points?privy_oauth_code=…&privy_oauth_state=…&privy_oauth_provider=twitter` on production shows
 * Privy's modal by itself, while a clean load never does (checked at 390×844 as well, so it is not a
 * mobile layout thing).
 *
 * Correct for the flow the player just started; wrong for every other way those parameters can
 * arrive — a link pasted into a chat, a browser restoring the tab left open on X's consent screen, a
 * reload of that URL. To a player those look the same: *I opened the site and it asked me to sign
 * in*, which is the kind of thing a site should never do.
 *
 * WHY THE DECISION IS MADE ON THE SERVER
 * --------------------------------------
 * Two client-side placements were tried and both lost the same race. Running the guard at module
 * scope in `app/providers.js` looked early — a side effect during module evaluation — but production
 * still opened the modal: Privy had already read the callback. Shipping the guard as an inline
 * `beforeInteractive` script was measured too, and Next places it *after* the app's chunk scripts in
 * the document (byte 9758 against 1018), so it can still be beaten by an `async` chunk.
 *
 * The only placement with no race is before the HTML. `middleware.js` therefore strips a callback
 * this browser did not start, and it can, because the mark is a **first-party cookie** rather than
 * sessionStorage: `dk_privy_flow`, written the moment we ask Privy for its UI, sent on the top-level
 * navigation X redirects back with (`SameSite=Lax`), and spent as soon as a return is used.
 *
 * THE RULE
 * --------
 * A return is resumed only if the marker cookie is present and fresh. Anything else has the three
 * parameters removed from the URL, and only those — a `?ref=` invite code beside them is somebody's
 * referral and survives. The client half (`installOauthReturnGuard`) stays as a second line for
 * anything the middleware never sees, and the rule itself is one pure function both halves call.
 */

export const OAUTH_PARAMS = ['privy_oauth_code', 'privy_oauth_state', 'privy_oauth_provider'];

/** The marker cookie. First-party, so the server can read it on the redirect back from X. */
export const MARKER_COOKIE = 'dk_privy_flow';

/** How long "we started this" is believed. Long enough for an X login and a code from an inbox. */
export const MARKER_TTL_MS = 20 * 60 * 1000;

/**
 * What to do with the OAuth parameters in a URL. Pure, so it can be tested without a browser and
 * used unchanged on both sides of the network.
 *
 * `params` is a plain object of the three values (missing ones as `''`), `startedAt` the marker
 * (milliseconds since the epoch, as a string or number) or null, `seenCode` the code recorded as
 * already handled by this browser.
 *
 * Returns `{ present, action, reason, code }`:
 *   - `ignore`  nothing OAuth-shaped in the URL — the normal case
 *   - `keep`    our own return: Privy is meant to finish this
 *   - `strip`   not ours, or already handled: remove the parameters before Privy can see them
 */
export function decideOauthReturn({ params = {}, startedAt = null, seenCode = null, now = Date.now(), ttlMs = MARKER_TTL_MS } = {}) {
    const present = OAUTH_PARAMS.filter((name) => String(params[name] || '').trim());
    const code = String(params.privy_oauth_code || '').trim();

    // Privy needs all three to act, but a URL carrying one or two is still a callback someone left
    // behind — and stripping a partial one is how it stops being a URL that looks alive.
    if (present.length === 0) {
        return { present: [], action: 'ignore', reason: 'no-oauth-params', code: '' };
    }

    if (seenCode && code && seenCode === code) {
        return { present, action: 'strip', reason: 'already-handled', code };
    }

    if (!startedAt) {
        // Nobody here asked Privy for anything: this URL arrived from somewhere else.
        return { present, action: 'strip', reason: 'not-started-here', code };
    }

    const age = now - Number(startedAt);
    if (!Number.isFinite(age) || age < 0 || age > ttlMs) {
        return { present, action: 'strip', reason: 'not-started-here', code };
    }

    return { present, action: 'keep', reason: 'ours', code };
}

/** Remove the OAuth parameters from a query string, leaving every other one — `ref` included. */
export function withoutOauthParams(search, params = OAUTH_PARAMS) {
    const query = new URLSearchParams(String(search || ''));
    for (const name of params) query.delete(name);
    const rest = query.toString();
    return rest ? `?${rest}` : '';
}

/** The three parameters as a plain object, from a query string. */
export function oauthParamsFrom(search) {
    const query = new URLSearchParams(String(search || ''));
    const params = {};
    for (const name of OAUTH_PARAMS) params[name] = query.get(name) || '';
    return params;
}

/**
 * The marker out of a `Cookie` header. Hand-parsed because this runs in middleware, which must stay
 * edge-safe and dependency-free.
 */
export function readMarkerCookie(cookieHeader) {
    const header = String(cookieHeader || '');
    if (!header) return null;
    for (const part of header.split(';')) {
        const index = part.indexOf('=');
        if (index === -1) continue;
        if (part.slice(0, index).trim() === MARKER_COOKIE) {
            const value = part.slice(index + 1).trim();
            return value || null;
        }
    }
    return null;
}

/**
 * The whole server-side decision: given a request, should this callback be stripped, and to where?
 *
 * Returns `{ strip, to, reason }` — `to` is the path to redirect to, with every other query
 * parameter preserved. Called from `middleware.js`.
 */
export function callbackStripTarget({ pathname = '/', search = '', cookieHeader = '', now = Date.now(), ttlMs = MARKER_TTL_MS } = {}) {
    const decision = decideOauthReturn({
        params: oauthParamsFrom(search),
        startedAt: readMarkerCookie(cookieHeader),
        now,
        ttlMs,
    });
    if (decision.action === 'ignore') return { strip: false, to: null, reason: decision.reason, decision };
    if (decision.action === 'keep') return { strip: false, to: null, reason: decision.reason, decision };
    return {
        strip: true,
        to: `${pathname || '/'}${withoutOauthParams(search)}`,
        reason: decision.reason,
        decision,
    };
}

/**
 * Say that this browser asked Privy for its UI — the bridge calls this the instant it opens the
 * modal or starts a link, and it is what makes the return recognisable as ours.
 *
 * `Secure` only where the page is https: on `http://localhost` a Secure cookie is dropped, and a
 * guard that never sees its own marker would strip every real return in development.
 */
export function markPrivyFlowStarted({
    document: doc = typeof document !== 'undefined' ? document : null,
    location: loc = typeof window !== 'undefined' ? window.location : null,
    now = Date.now(),
} = {}) {
    try {
        if (!doc) return false;
        const secure = String(loc?.protocol || '') === 'https:' ? '; Secure' : '';
        const seconds = Math.floor(MARKER_TTL_MS / 1000);
        doc.cookie = `${MARKER_COOKIE}=${now}; Path=/; Max-Age=${seconds}; SameSite=Lax${secure}`;
        return true;
    } catch {
        // Cookies off: a return will be treated as not ours and simply not resumed. The player can
        // press the button again, which is a smaller harm than resuming a flow we cannot vouch for.
        return false;
    }
}

/**
 * The client fallback: strip a callback the middleware never saw (a client-side navigation, or a
 * deployment whose middleware was skipped). Never throws.
 */
export function installOauthReturnGuard({
    location: loc = typeof window !== 'undefined' ? window.location : null,
    history: hist = typeof window !== 'undefined' ? window.history : null,
    document: doc = typeof document !== 'undefined' ? document : null,
    now = Date.now(),
} = {}) {
    try {
        if (!loc || !doc) return { present: [], action: 'ignore', reason: 'no-browser' };

        const decision = decideOauthReturn({
            params: oauthParamsFrom(loc.search || ''),
            startedAt: readMarkerCookie(doc.cookie),
            now,
        });

        if (decision.action === 'strip') {
            const clean = `${loc.pathname}${withoutOauthParams(loc.search || '')}${loc.hash || ''}`;
            console.warn(`[privy] ignored a sign-in callback this browser did not start (${decision.reason})`);
            try {
                hist?.replaceState?.(null, '', clean);
            } catch {
                // An embedded browser that locks `history`: rewriting is out, so leave the URL
                // outright. A hard navigation costs a reload on a page that was about to be wrong —
                // the parameters must not still be there when Privy reads them.
                loc.replace?.(clean);
            }
        }

        return decision;
    } catch (error) {
        console.warn('[privy] oauth return guard failed:', error?.message || error);
        return { present: [], action: 'ignore', reason: 'guard-failed' };
    }
}
