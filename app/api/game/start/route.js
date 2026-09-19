import { NextResponse } from 'next/server';
import { sessionFromRequest } from '../../../../lib/points-session.js';
import { DUNGEONS, issueRunToken, minSecondsFor, signingReady } from '../../../../lib/game-runs.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST { knightIds, dungeonId } — the clock starts here.
 *
 * The token is an HMAC over the address, the squad and *our* timestamp, so the browser
 * cannot backdate a run: whatever it reports later, `complete` measures against this
 * moment. Without it, a client could claim a five-minute dungeon finished in five
 * seconds and the server would have no way to disagree.
 */
export async function POST(request) {
    const address = sessionFromRequest(request);
    if (!address) {
        return NextResponse.json({ error: 'not signed in' }, { status: 401 });
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'expected a JSON body' }, { status: 400 });
    }

    const knightIds = Array.isArray(body?.knightIds)
        ? [...new Set(body.knightIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
        : [];
    const dungeonId = Number(body?.dungeonId);

    if (!knightIds.length || knightIds.length > 15) {
        return NextResponse.json({ error: 'a run needs between 1 and 15 knights' }, { status: 400 });
    }
    if (!DUNGEONS[dungeonId]) {
        return NextResponse.json({ error: 'unknown dungeon' }, { status: 400 });
    }
    if (!signingReady()) {
        // The client treats this as "no receipt for this run" and falls back to the
        // legacy path, so an unconfigured server never blocks play.
        return NextResponse.json({ error: 'the run signer is not configured' }, { status: 503 });
    }

    const issued = issueRunToken({ address, knightIds, dungeonId });
    if (!issued) {
        return NextResponse.json({ error: 'the run secret is not configured' }, { status: 503 });
    }

    return NextResponse.json({
        runToken: issued.token,
        startedAt: issued.startedAt,
        dungeonId,
        knightIds,
        minSeconds: minSecondsFor(knightIds.length),
    });
}
