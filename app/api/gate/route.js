import { NextResponse } from 'next/server';
import { gateConfigured, gateCookie, issueGateToken, passwordMatches } from '../../../lib/app-gate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST { password, next } — the way in.
 *
 * Two things are refused, and they are refused differently: a wrong password (which is the normal
 * mistyped case and deserves a sentence), and an unconfigured deployment (which is an operational
 * mistake, not something the visitor can fix — so it says so instead of pretending they got it
 * wrong). Nothing here is rate-limited beyond the password itself: there is one shared secret, no
 * user accounts, and the only thing a slow loop buys is a slower loop.
 */
export async function POST(request) {
    let body = {};
    try {
        body = await request.json();
    } catch {
        // An empty body is just a wrong password.
    }

    if (!gateConfigured()) {
        return NextResponse.json(
            { error: 'This deployment has no APP_GATE_PASSWORD set, so there is nothing to unlock.' },
            { status: 503 }
        );
    }

    if (!(await passwordMatches(body?.password))) {
        // Deliberately vague about *why*, and deliberately slow enough to notice: the password is
        // shared, so the only attacker this costs anything is a person guessing.
        await new Promise((resolve) => setTimeout(resolve, 400));
        return NextResponse.json({ error: 'That password is not right.' }, { status: 401 });
    }

    const response = NextResponse.json({ ok: true });
    // `secure` follows the protocol the visitor actually used, so the localhost test works over
    // http while production keeps the flag.
    const secure = request.headers.get('x-forwarded-proto') !== 'http';
    response.headers.append('Set-Cookie', gateCookie(await issueGateToken(), { secure }));
    return response;
}
