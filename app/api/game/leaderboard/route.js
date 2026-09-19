import { NextResponse } from 'next/server';
import { claimedBoard } from '../../../../lib/chain-logs.js';

// The chain is the source, so nothing here may be prerendered or cached by the platform.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET — the Hall of Fame, from on-chain claim events.
 *
 * `?limit=25` caps the rows. The sweep itself is cached in-process for half a minute: the
 * player presses Refresh as often as they like, and the RPC sees one sweep per interval
 * rather than one per click. A failure comes back as an error the page can show, never as
 * an empty board that looks like "nobody has ever claimed anything".
 */
const CACHE_MS = 30_000;
let cache = { at: 0, limit: 0, payload: null };

export async function GET(request) {
    const requested = Number(new URL(request.url).searchParams.get('limit'));
    const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), 100) : 25;

    if (cache.payload && cache.limit === limit && Date.now() - cache.at < CACHE_MS) {
        return NextResponse.json({ ...cache.payload, cached: true, age: Date.now() - cache.at });
    }

    try {
        const board = await claimedBoard({ limit });
        cache = { at: Date.now(), limit, payload: board };
        return NextResponse.json({ ...board, cached: false, age: 0 });
    } catch (error) {
        console.error('[leaderboard] chain read failed:', error.message || error);
        return NextResponse.json(
            { error: 'Could not read the chain right now. Try again in a moment.', detail: String(error.message || error).slice(0, 200) },
            { status: 502 }
        );
    }
}
