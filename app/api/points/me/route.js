import { NextResponse } from 'next/server';
import { sessionFromRequest } from '../../../../lib/points-session.js';
import { attachRef, registerVisit, stateFor } from '../../../../lib/points-program.js';

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
 * POST { ref } — claim a referral code that arrived in a link.
 *
 * Deliberately server-side: a referral is only real if the *referee's* wallet is the
 * one that banked it. The old localStorage version registered links per browser, so a
 * code shared to a friend recorded nothing at all.
 *
 * POST { attachRef } — the same thing, claimed deliberately from the page instead of carried in a
 * link. Two shapes rather than one because they answer differently: a link's code is a bonus that
 * must never block the page (a bad one is ignored, see the client), while a code a player *typed* has
 * to say why it was refused — so that one comes back as a 400 with a code of its own.
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

    // `!== undefined` on purpose: an empty string is a refusal (bad-code) rather than a visit.
    if (body?.attachRef !== undefined) {
        const result = await attachRef(address, body.attachRef);
        if (result.error) return NextResponse.json(result, { status: 400 });
        return NextResponse.json({ state: result.state });
    }

    await registerVisit(address, body?.ref);
    return NextResponse.json({ state: await stateFor(address) });
}
