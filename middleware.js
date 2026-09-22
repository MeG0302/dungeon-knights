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
 *   1. **The gate is an allowlist, never "everything that is not the apex".** The X webhook is
 *      registered against `dungeon-knights.vercel.app`, and a gate expressed as "not the apex"
 *      would have quietly locked out a paid registration. Only the hostnames in `APP_HOSTS` are
 *      gated; every other host keeps behaving exactly as it does today.
 *   2. **Static files are not gated, pages and APIs are.** That is what lets the password screen
 *      wear the real theme, and it leaks nothing — the scripts and stylesheets are already served
 *      publicly on the live site today.
 *   3. **Nothing gates unless a password is configured** (`APP_GATE_PASSWORD`). Unset, the app host
 *      behaves like the apex, loudly warned about, rather than locking the team out of its own game.
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

export async function middleware(request) {
    const isProduction = process.env.NODE_ENV === 'production';
    const { pathname, searchParams } = request.nextUrl;
    const search = request.nextUrl.search || '';
    const host = request.headers.get('host') || '';

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
