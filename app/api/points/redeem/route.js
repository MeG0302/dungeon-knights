import { NextResponse } from 'next/server';
import { sessionFromRequest } from '../../../../lib/points-session.js';
import { redeemView, spin } from '../../../../lib/points-redeem.js';

// The view reads stored state (the wallet's record and the pool) and the spin writes both, so
// nothing here may be cached or prerendered.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET — the wheel's state for the signed-in wallet: balance, stock, and the codes this address has
 * won. Never the pool: `redeemView` hands over this player's own rows and counts, nothing else.
 */
export async function GET(request) {
    const address = sessionFromRequest(request);
    if (!address) {
        return NextResponse.json({ error: 'not signed in' }, { status: 401 });
    }
    return NextResponse.json({ state: await redeemView(address) });
}

/**
 * POST { action: 'spin', spinId } — pay the cost, draw, and hand back the outcome.
 *
 * The client is trusted for **one** thing: the spin id, which is what makes a retry safe. It is not
 * trusted for the outcome, the price, the odds or the code — a hand-rolled request gets a real spin
 * and pays the real cost, exactly like the button does.
 *
 * The status codes are the refusal, and each is a different thing to say to a player:
 *   400 `not_enough_points`  — they cannot afford it; nothing was taken.
 *   400 `out_of_stock`       — a card has run out; nothing was taken.
 *   409 `busy`               — a spin from this wallet is already running.
 *   401 — no session.
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

    if (body?.action !== 'spin') {
        return NextResponse.json({ error: "action must be 'spin'" }, { status: 400 });
    }

    const result = await spin(address, { spinId: body?.spinId });

    if (result.error === 'not_enough_points' || result.error === 'out_of_stock') {
        return NextResponse.json({ ...result, state: await redeemView(address) }, { status: 400 });
    }
    if (result.error === 'busy') {
        return NextResponse.json(result, { status: 409 });
    }
    if (result.error) {
        return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json({ ...result, state: await redeemView(address) });
}
