import { NextResponse } from 'next/server';
import { sessionFromRequest } from '../../../../lib/points-session.js';
import { clearLevel, shareEntry } from '../../../../lib/points-program.js';

// The payout rules depend on today's date and on stored state, so nothing here may be
// cached or prerendered.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST { action, level } — the only way points are ever awarded.
 *
 * The vault mini-game is scripted, so the client is trusted only for *which* floor it
 * finished. How much that pays, whether it has already been paid today, and whether the
 * floors were done in order are all decided here — a replayed or hand-rolled request
 * gets the same answer as the real one: nothing.
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

    const action = body?.action;
    if (action === 'clear') {
        const result = await clearLevel(address, body?.level);
        if (result.error) return NextResponse.json(result, { status: 400 });
        return NextResponse.json(result);
    }
    if (action === 'share') {
        const result = await shareEntry(address);
        if (result.error) return NextResponse.json(result, { status: 400 });
        return NextResponse.json(result);
    }
    return NextResponse.json({ error: "action must be 'clear' or 'share'" }, { status: 400 });
}
