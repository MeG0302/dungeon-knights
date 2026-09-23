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
 * Privy's modal by itself, while a clean load never does.
 *
 * That is correct for the flow the player just started, and wrong for every other way those
 * parameters can arrive — a link pasted into a chat, a browser restoring the tab you left open on
 * X's consent screen, a reload of that URL. To a player those all look the same: *I opened the site
 * and it asked me to sign in*, which is the kind of thing a site should never do.
 *
 * THE RULE
 * --------
 * A Privy flow may only be resumed here if **this browser started one recently**. The moment we ask
 * Privy for its UI (`login()`, `linkX()`), we leave a timestamp; a return with a fresh timestamp is
 * ours and is left alone. Everything else is stripped from the URL *before the SDK can read it*,
 * which is why this runs at module scope in `app/providers.js` rather than in an effect: React
 * effects fire after children mount, and by then Privy has already opened its modal.
 *
 * Only the three `privy_oauth_*` parameters are touched. A `?ref=` invite code in the same URL is
 * somebody's referral and survives untouched.
 */

export const OAUTH_PARAMS = ['privy_oauth_code', 'privy_oauth_state', 'privy_oauth_provider'];

/** When this browser last *asked* for Privy's UI. Written by the bridge, read here. */
export const STARTED_KEY = 'dk:privy:flow-started';

/** Codes already dealt with, so a return cannot be replayed by reopening the same URL. */
export const SEEN_KEY = 'dk:privy:oauth-seen';

/** How long "we started this" is believed. Long enough for an X login and a code from an inbox. */
export const STARTED_TTL_MS = 20 * 60 * 1000;

/**
 * What to do with the OAuth parameters in a URL. Pure, so it can be tested without a browser.
 *
 * `params` is a plain object of the three values (missing ones as `''`), `startedAt` the stored
 * timestamp or null, `seenCode` the code recorded as already handled.
 *
 * Returns `{ present, action, reason, code }`:
 *   - `ignore`  nothing OAuth-shaped in the URL — the normal case
 *   - `keep`    our own return: Privy is meant to finish this
 *   - `strip`   not ours, or already handled: remove the parameters before the SDK sees them
 */
export function decideOauthReturn({ params = {}, startedAt = null, seenCode = null, now = Date.now(), ttlMs = STARTED_TTL_MS } = {}) {
    const present = OAUTH_PARAMS.filter((name) => String(params[name] || '').trim());
    const code = String(params.privy_oauth_code || '').trim();

    // The SDK needs all three to act, but a URL carrying one or two is still a callback someone
    // left behind — and stripping a partial one is how it stops being a URL that looks alive.
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
export function withoutOauthParams(search) {
    const params = new URLSearchParams(String(search || ''));
    for (const name of OAUTH_PARAMS) params.delete(name);
    const rest = params.toString();
    return rest ? `?${rest}` : '';
}

/**
 * The browser half: read the URL, decide, and act. Called once, before Privy mounts.
 *
 * Returns the decision, so a caller can log it. Never throws — a guard that breaks the page it is
 * protecting would be worse than the popup it prevents.
 */
export function installOauthReturnGuard({
    location: loc = typeof window !== 'undefined' ? window.location : null,
    history: hist = typeof window !== 'undefined' ? window.history : null,
    storage = typeof window !== 'undefined' ? window.sessionStorage : null,
    now = Date.now(),
} = {}) {
    try {
        if (!loc || !storage) return { present: [], action: 'ignore', reason: 'no-browser' };

        const search = loc.search || '';
        const params = {};
        const query = new URLSearchParams(search);
        for (const name of OAUTH_PARAMS) params[name] = query.get(name) || '';

        let startedAt = null;
        let seenCode = null;
        try {
            startedAt = storage.getItem(STARTED_KEY) || null;
            seenCode = storage.getItem(SEEN_KEY) || null;
        } catch {
            // Storage off: nothing can be remembered, so nothing can be trusted — a return with no
            // memory of starting it is stripped, which is the safe direction.
        }

        const decision = decideOauthReturn({ params, startedAt, seenCode, now });

        if (decision.action === 'keep') {
            // Ours, and about to be consumed by Privy. Record the code and drop the marker, so the
            // same URL reopened later is stripped instead of finishing the flow a second time.
            try {
                if (decision.code) storage.setItem(SEEN_KEY, decision.code);
                storage.removeItem(STARTED_KEY);
            } catch { /* storage off: the flow still finishes, it just cannot be remembered */ }
            return decision;
        }

        if (decision.action === 'strip') {
            try {
                if (decision.code) storage.setItem(SEEN_KEY, decision.code);
                storage.removeItem(STARTED_KEY);
            } catch { /* as above */ }
            const url = `${loc.pathname}${withoutOauthParams(search)}${loc.hash || ''}`;
            hist?.replaceState?.(null, '', url);
            console.warn(`[privy] ignored a sign-in callback this browser did not start (${decision.reason})`);
            return decision;
        }

        return decision;
    } catch (error) {
        console.warn('[privy] oauth return guard failed:', error?.message || error);
        return { present: [], action: 'ignore', reason: 'guard-failed' };
    }
}

/**
 * Say that this browser asked Privy for its UI. Called by the bridge the moment it decides to open
 * the modal or start a link — which is what makes the return recognisable as ours.
 */
export function markPrivyFlowStarted({ storage = typeof window !== 'undefined' ? window.sessionStorage : null, now = Date.now() } = {}) {
    try {
        storage?.setItem?.(STARTED_KEY, String(now));
    } catch {
        // Storage off: the return will be treated as not ours and simply not resumed. The player can
        // press the button again, which is a smaller harm than resuming a flow we cannot vouch for.
    }
}
