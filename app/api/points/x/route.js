import { NextResponse } from 'next/server';
import { sessionFromRequest } from '../../../../lib/points-session.js';
import { bindX, unbindX, stateFor } from '../../../../lib/points-program.js';
import { privyIdentityFromToken, describeIdentity, privyAppConfigured } from '../../../../lib/privy-verify.js';

// The binding depends on stored state and on a live Privy check, so nothing here may be cached.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST { action: 'bind' | 'unbind', identity?, accessToken? } — bind the X account that earns.
 *
 * The wallet comes from the signed session, never from the body: a player cannot bind an X account
 * to someone else's wallet. The *handle* is a different matter, and it is the one thing this route
 * is careful about — an access token, when the client sends one, is verified with Privy and its
 * linked X account is what gets bound. The client's own claim is used only when that check cannot
 * be made, and the record says which of the two happened.
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

    if (action === 'unbind') {
        const result = await unbindX(address);
        if (result.error) return NextResponse.json(result, { status: 400 });
        return NextResponse.json({ ...result, verified: false, provisional: false });
    }

    if (action !== 'bind') {
        return NextResponse.json({ error: "action must be 'bind' or 'unbind'" }, { status: 400 });
    }

    const claimed = {
        id: String(body?.identity?.id || '').trim(),
        username: String(body?.identity?.username || '').trim(),
    };

    // Try to prove it. A missing token, an expired one, or a Privy outage all land in `verified:
    // false` — the binding still happens, and the page says it is provisional. What never happens
    // is a failed proof being reported as a successful one.
    let proof = { ok: false, code: 'no-token' };
    if (body?.accessToken) {
        proof = await privyIdentityFromToken(body.accessToken);
    }

    let identity = claimed;
    let verified = false;
    let replacedClaim = false;

    if (proof.ok && proof.twitter) {
        identity = proof.twitter;
        verified = true;
        replacedClaim = claimed.id && claimed.id !== identity.id;
        if (replacedClaim) {
            console.warn(`[points] privy proof for ${address} named @${identity.username}, not the claimed @${claimed.username || '?'}`);
        }
    } else if (proof.ok && !proof.twitter) {
        // Signed in with Privy, and that user has no X account linked. Saying so is the whole point:
        // an unlinked account cannot be verified, and the player can fix it in one tap.
        return NextResponse.json({
            error: 'Your Privy account has no X account linked yet. Link X first, then bind it here.',
            code: 'no-x-link',
            provisional: true,
        }, { status: 400 });
    }

    // A handle is required; the account id is not. Without a proof the id is unknown, and the
    // program keys the binding on the handle instead — which still holds one name to one wallet.
    if (!identity.username) {
        return NextResponse.json({
            error: 'No X account to bind. Link X to your Privy account, or type the handle you post as.',
            code: 'bad-identity',
        }, { status: 400 });
    }

    const result = await bindX(address, identity, { verified });
    if (result.error) return NextResponse.json(result, { status: 400 });

    if (!verified) {
        console.warn(`[points] provisional X binding for ${address}: @${identity.username} — ${describeIdentity(proof)}`);
    }

    return NextResponse.json({
        ...result,
        verified,
        provisional: !verified,
        replacedClaim,
        proof: verified ? 'privy' : proof.code,
        state: result.state || await stateFor(address),
    });
}

/** GET — what this wallet has bound, and whether this deployment can prove a binding at all. */
export async function GET(request) {
    const address = sessionFromRequest(request);
    if (!address) {
        return NextResponse.json({ error: 'not signed in' }, { status: 401 });
    }
    const state = await stateFor(address);
    return NextResponse.json({
        x: state?.x || null,
        canEarn: state?.canEarn === true,
        verificationAvailable: privyAppConfigured(),
    });
}
