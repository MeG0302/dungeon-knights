import { NextResponse } from 'next/server';
import { sessionFromRequest } from '../../../../lib/points-session.js';
import { registerVisit, stateFor } from '../../../../lib/points-program.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET — everything the Points page renders for the signed-in wallet. */
export async function GET(request) {
    const address = sessionFromRequest(request);
    if (!address) {
        return NextResponse.json({ error: 'not signed in' }, { status: 401 });
    }
    return NextResponse.json({ state: await stateFor(address) });
}

/**
 * POST { ref } — claim a referral code.
 *
 * Deliberately server-side: a referral is only real if the *referee's* wallet is the
 * one that banked it. The old localStorage version registered links per browser, so a
 * code shared to a friend recorded nothing at all.
 */
export async function POST(request) {
    const address = sessionFromRequest(request);
    if (!address) {
        return NextResponse.json({ error: 'not signed in' }, { status: 401 });
    }
    let body = {};
    try {
        body = await request.json();
    } catch {
        // An empty body is fine — this endpoint also just announces a visit.
    }
    await registerVisit(address, body?.ref);
    return NextResponse.json({ state: await stateFor(address) });
}
