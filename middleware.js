/**
 * Two hostnames, two jobs.
 *
 * `dungeonknights.io` is the public face: the coming-soon landing and the **Points Program**, which
 * has to work for somebody who has never seen the game, because it is the only thing being
 * advertised right now. `app.dungeonknights.io` is the game — the Kingdom Gate hub, the mint, the
 * vault, the dungeons — and it is behind a password while the project is this early.
 *
 * Three rules make that safe to reason about:
 *
 *   1. **Fail closed on hostnames, exempt by path.** In production a host is gated unless it is the
 *      apex **by name**: Vercel answers every deployment of this project under `*.vercel.app` — the
 *      project alias and one URL per build — and they used to be left strictly alone, which meant
 *      the whole game (and the Points API reading the production store) answered 200 to anybody
 *      holding an old deployment link. What has to keep working from outside is not a hostname but
 *      a **path** — the X webhook and Discord's endpoint — and those are exempted in `GLOBAL_OPEN`
 *      before any host rule runs. The gate serves the password screen on the host being asked; it
 *      never redirects to a name that may not resolve, which is the failure that once took the live
 *      game offline in both directions at once.
 *   2. **Static files are not gated, pages and APIs are.** That is what lets the password screen
 *      wear the real theme, and it leaks nothing — the scripts and stylesheets are already served
 *      publicly on the live site today.
 *   3. **Nothing gates unless a password is configured** (`APP_GATE_PASSWORD`). Unset, the app host
 *      behaves like the apex, loudly warned about, rather than locking the team out of its own game.
 *      That is why the password is also set for the **Preview** environment — a preview deployment
 *      has its own environment, and without the variable the fail-closed rule above would describe
 *      a gate that is not actually there.
 *
 * This file is plumbing only. The rules themselves — which path is in which bucket, and what that
 * means on which host — live in `lib/app-routing.js`, because they have to be testable without a
 * Next runtime (see the note at the top of that file).
 *
 * The dev-only `dk_app_host` cookie exists because `localhost:3000` cannot be two hostnames: append
 * `?__app=1` to any local URL to switch to the app branch (and `?__app=0` to switch back). It is
 * ignored in production, where the `Host` header is the only thing consulted.
 */

import { NextResponse } from 'next/server';
import {
    cookieValue,
    DEV_HOST_COOKIE_NAME,
    devHostCookie,
    gateConfigured,
    GATE_COOKIE_NAME,
    isAppRequest,
    isApexHost,
    readGateToken,
} from './lib/app-gate';
import { classify, decideRoute, gateCovers, readDevHost } from './lib/app-routing';
import { callbackStripTarget, DROPPED_COOKIE, MARKER_TTL_MS } from './lib/privy-oauth-return';

export async function middleware(request) {
    const isProduction = process.env.NODE_ENV === 'production';
    const { pathname, searchParams } = request.nextUrl;
    const search = request.nextUrl.search || '';
    const host = request.headers.get('host') || '';

    // A Privy OAuth callback is stripped here, before any HTML, because this is the only place that
    // cannot lose the race against the SDK. `privy_oauth_code` in the URL makes Privy open its own
    // modal on load — correct for the flow the player just started, and the reason a shared or
    // restored link asked people to sign in without a click. The marker cookie says which is which;
    // see `lib/privy-oauth-return.js`. Only those three parameters are removed, so a `?ref=` invite
    // code travelling beside them survives.
    const callback = callbackStripTarget({
        pathname,
        search,
        cookieHeader: request.headers.get('cookie') || '',
    });
    if (callback.strip) {
        console.warn(`[privy] stripping a sign-in callback this browser did not start (${callback.reason})`);
        const stripped = NextResponse.redirect(new URL(callback.to, request.url), 307);
        // Leave a note the page can read, so a link that really was interrupted is not dropped
        // in silence. Conditional on the page's side, because a stranger's pasted URL looks
        // exactly the same from here.
        stripped.cookies.set(DROPPED_COOKIE, callback.reason, {
            path: '/',
            maxAge: Math.floor(MARKER_TTL_MS / 1000),
            sameSite: 'lax',
            secure: true,
        });
        return stripped;
    }

    const { devHost, setDevHost } = readDevHost({
        searchParams,
        cookieValue: cookieValue(request, DEV_HOST_COOKIE_NAME),
        isProduction,
    });

    const isApp = isAppRequest({ host, devHostCookie: devHost, isProduction });
    // The public host **by name**. Not "everything that is not the gated host": that reading sent
    // `dungeon-knights.vercel.app/menu` to a hostname that does not resolve and took the game offline
    // in production. A host in neither list is left exactly as it was.
    //
    // In development only, `?__app=0` stands in for the apex, because `localhost:3000` is neither
    // hostname and the redirect would otherwise be untestable before it is published.
    const isApex = isApexHost(host) || (!isProduction && devHost === '0');
    const kind = classify(pathname);
    const passwordConfigured = gateConfigured();

    // The one thing that cannot be a pure function: the MAC check is async (Web Crypto, because this
    // runs on the Edge runtime). Asked for **only** when the answer can change anything — and the
    // question of *which paths that is* is asked through `gateCovers`, the same function the decision
    // uses. Asked separately, the two disagreed and `/` became unreachable: see its comment.
    let gateAllowed = false;
    if (isApp && passwordConfigured && gateCovers(kind)) {
        gateAllowed = !!(await readGateToken(cookieValue(request, GATE_COOKIE_NAME)));
    }

    const decision = decideRoute({ isApp, isApex, kind, pathname, search, passwordConfigured, gateAllowed });

    if (!isApp) return withDevHost(apex(decision, request), setDevHost);
    return withDevHost(app(decision, request, passwordConfigured), setDevHost);
}

/** The public host: its own pages, and a redirect for everything else. */
function apex(decision, request) {
    if (decision.action === 'redirect') return NextResponse.redirect(decision.to, 308);
    return NextResponse.next();
}

/** The gated host. */
function app(decision, request, passwordConfigured) {
    // Nothing about this host is meant to be indexed, password or not: it is the same site under a
    // second name, and two indexable copies of one product is a search-engine problem of its own.
    const stamp = (response) => {
        response.headers.set('X-Robots-Tag', 'noindex, nofollow');
        return response;
    };

    if (decision.action === 'gate') {
        const gate = new URL('/gate', request.url);
        gate.searchParams.set('next', decision.next);
        return stamp(NextResponse.redirect(gate));
    }

    if (decision.action === 'rewrite') {
        const url = request.nextUrl.clone();
        url.pathname = decision.pathname;
        return stamp(NextResponse.rewrite(url));
    }

    if (!passwordConfigured && decision.action === 'next') {
        // Configured to be open. Say so loudly on every request — a missing variable should be
        // visible, not silent — but do not pretend the host is private.
        console.warn('[app-gate] APP_GATE_PASSWORD is not set — app.dungeonknights.io is NOT gated.');
    }

    return stamp(NextResponse.next());
}

/** Persist or clear the dev host cookie, when this request asked for that. */
function withDevHost(response, setDevHost) {
    if (setDevHost) response.headers.append('Set-Cookie', devHostCookie(setDevHost));
    return response;
}

export const config = {
    /**
     * Everything except Next's own build output and the favicon. Static assets in `public/` are left
     * in the matcher deliberately — the gate's "is this a file?" rule is one of its three parts, and
     * excluding them here would move that decision somewhere it cannot be tested.
     */
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
