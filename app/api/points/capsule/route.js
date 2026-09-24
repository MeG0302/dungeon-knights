import { NextResponse } from 'next/server';
import { sessionFromRequest } from '../../../../lib/points-session.js';
import { challengeFor } from '../../../../lib/capsule-claims.js';
import { capsuleState, claimCapsule, markFormSubmitted, registerWallet } from '../../../../lib/points-capsules.js';

// A challenge depends on the clock, and a claim on stored state — nothing here may be cached.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The capsule paper trail: prove the wallet, then claim the day's win.
 *
 *     GET  ?purpose=register              a message to sign, to prove the wallet
 *     GET  ?purpose=claim&day=YYYY-MM-DD  a message to sign, for that day's capsule
 *     POST { action: 'register' | 'claim' | 'form', ... }
 *
 * A session is required, which is the same gate every other mutation in this program uses — the page
 * has one the moment a wallet is connected, so it costs the player nothing. It is **not** what proves
 * the wallet: the message the player signs is, and the address is taken from the session so a claim
 * cannot be filed against somebody else's record even with a stolen signature.
 *
 * Why two signatures exist at all is worth stating where the code is. The session proves "this browser
 * controls this wallet" well enough to earn points; a capsule leaves the building and is sent by a
 * human, so the proof is made explicit, names the wallet, names the **day** it is for, and is written
 * down — see `lib/capsule-claims.js` for why the day is inside the message rather than checked beside
 * it.
 */
export async function GET(request) {
    const address = sessionFromRequest(request);
    if (!address) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

    const url = new URL(request.url);
    const purpose = (url.searchParams.get('purpose') || 'register').trim().toLowerCase();

    if (purpose === 'register') {
        return NextResponse.json({ challenge: challengeFor(address, 'register') });
    }

    if (purpose !== 'claim') {
        return NextResponse.json({ error: "purpose must be 'register' or 'claim'" }, { status: 400 });
    }

    // A claim challenge is only issued for a win that is actually waiting. Asking for a signature for
    // nothing would hand a player a prompt to sign about a capsule that does not exist, which is the
    // kind of dead end this page is supposed to be free of.
    const state = await capsuleState(address);
    const requested = (url.searchParams.get('day') || '').trim();
    const open = requested
        ? state.capsules.find((row) => row.day === requested && row.claimable)
        : state.open;
    if (!open) {
        return NextResponse.json({
            error: 'There is nothing to claim right now.',
            code: 'nothing-to-claim',
            state,
        }, { status: 409 });
    }

    return NextResponse.json({
        challenge: challengeFor(address, 'claim', open.day),
        capsule: open,
    });
}

export async function POST(request) {
    const address = sessionFromRequest(request);
    if (!address) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'expected a JSON body' }, { status: 400 });
    }

    const action = String(body?.action || '').trim();

    if (action === 'register') {
        const result = await registerWallet(address, { message: body?.message, signature: body?.signature });
        if (result.error) return NextResponse.json(result, { status: 400 });
        return NextResponse.json({ ...result, state: await capsuleState(address) });
    }

    if (action === 'claim') {
        const result = await claimCapsule(address, {
            day: body?.day,
            message: body?.message,
            signature: body?.signature,
        });
        if (result.error) {
            // A closed window is an answer, not a fault: 409 so the page can tell "you are too late"
            // from "that request was wrong".
            const status = result.code === 'window-closed' ? 409 : 400;
            return NextResponse.json({ ...result, state: await capsuleState(address) }, { status });
        }
        return NextResponse.json({ ...result, state: await capsuleState(address) });
    }

    if (action === 'form') {
        const result = await markFormSubmitted(address, body?.day);
        if (result.error) return NextResponse.json(result, { status: 400 });
        return NextResponse.json({ ...result, state: await capsuleState(address) });
    }

    return NextResponse.json({ error: "action must be 'register', 'claim' or 'form'" }, { status: 400 });
}
