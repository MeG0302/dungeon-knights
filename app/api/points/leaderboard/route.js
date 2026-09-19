import { NextResponse } from 'next/server';
import { sessionFromRequest } from '../../../../lib/points-session.js';
import { leaderboard } from '../../../../lib/points-program.js';

// Reads the store on every request — never prerender this.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET ?limit=25 — the public board. Signed in, your own row comes back flagged. */
export async function GET(request) {
    const url = new URL(request.url);
    const requested = Number(url.searchParams.get('limit'));
    const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 100) : 25;
    const me = sessionFromRequest(request);   // optional: only marks the caller's row
    const rows = await leaderboard(limit, me);
    return NextResponse.json({ rows, me });
}
