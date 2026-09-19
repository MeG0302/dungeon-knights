import { NextResponse } from 'next/server';
import { challengeFor, issueToken, verifyChallenge } from '../../../../lib/points-session.js';
import { stateFor } from '../../../../lib/points-program.js';

// Reads the session secret and (for the file driver) the disk, so it must never be
// prerendered or cached.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET ?address=0x… — the message to sign. */
export async function GET(request) {
    const address = new URL(request.url).searchParams.get('address');
    const challenge = challengeFor(address);
    if (!challenge) {
        return NextResponse.json({ error: 'a 0x wallet address is required' }, { status: 400 });
    }
    return NextResponse.json(challenge);
}

/** POST { message, signature } — verify the signature and start a session. */
export async function POST(request) {
    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'expected a JSON body' }, { status: 400 });
    }

    const address = verifyChallenge(body?.signature, body?.message);
    if (!address) {
        return NextResponse.json(
            { error: 'That signature did not match the wallet, or it has expired. Try again.' },
            { status: 401 }
        );
    }

    const session = issueToken(address);
    return NextResponse.json({
        token: session.token,
        expiresAt: session.expiresAt,
        // The page can render straight away instead of making a second round trip.
        state: await stateFor(address),
    });
}
