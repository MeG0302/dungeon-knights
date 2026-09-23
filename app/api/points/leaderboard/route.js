import { NextResponse } from 'next/server';
import { sessionFromRequest } from '../../../../lib/points-session.js';
import { leaderboard } from '../../../../lib/points-program.js';

// Reads the store on every request — never prerender this.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET ?limit=10 — the public board. Signed in, your own row comes back flagged.
 *
 * The default is the page's own board size, so a caller that asks for nothing gets what a player
 * sees. The ceiling stays where it is: it is a read guard, not a policy on how much of the board
 * exists, and the totals are public either way.
 */
export async function GET(request) {
    const url = new URL(request.url);
    // An absent parameter has to become something that is **not a number before it is checked**:
    // `searchParams.get` answers `null`, and `Number(null)` is `0` — a finite number, so the default
    // below was unreachable and every bare call was served a single row. The page always sends its
    // own limit, which is why nothing on screen ever showed it.
    const raw = url.searchParams.get('limit');
    const requested = raw === null || raw.trim() === '' ? Number.NaN : Number(raw);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 100) : 10;
    const me = sessionFromRequest(request);   // optional: only marks the caller's row
    const rows = await leaderboard(limit, me);
    return NextResponse.json({ rows, me });
}
