import { NextResponse } from 'next/server';
import {
    REQUEST_LIMITS,
    countAttempt,
    getRequest,
    putRequest,
    removeRequest,
    storageDescription,
} from '../../../../lib/collab-store.js';
import { sessionFromRequest } from '../../../../lib/points-session.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * A project asking to collaborate.
 *
 * All three verbs are **the caller's own request and nothing else**: there is no id in the URL, no
 * listing and no way to read somebody else's row. That is not an oversight in the design, it is the
 * design — a request carries a contact and a plan, and the only person who needs to read it back is
 * the person who sent it plus the owner, who reads it at `/collab/review`
 * (`app/api/collab/review/route.js`, signed and checked against `lib/collab-owners.js`) or with
 * `tools/collab-requests.js` and the store's own credentials.
 *
 * Like registration, the address comes out of the signed session and never out of the body, so a
 * request cannot be filed under a wallet nobody controls. Unlike registration, one row is reachable
 * only by the wallet that wrote it, which is what makes "will you collaborate with us" safe to ask
 * in public.
 *
 * `status` is not writable here. A request is born `pending` and the only thing that moves it is
 * `setRequestStatus` in the store, called by the owner's route. There is no route **here** that
 * approves, and nothing a project can post reaches a status: the only two callers that decide are the
 * owner's own, and both check who is asking before the store is touched.
 */

/** Behind Vercel there is always a proxy; the first hop is the client. */
function clientIp(request) {
    const forwarded = request.headers.get('x-forwarded-for') || '';
    const first = forwarded.split(',')[0].trim();
    return first || request.headers.get('x-real-ip') || 'unknown';
}

function mine(request) {
    const address = sessionFromRequest(request);
    if (!address) {
        return { error: NextResponse.json(
            { error: 'Connect a wallet and sign in first.', code: 'signed-out' },
            { status: 401 }
        ) };
    }
    return { address };
}

/** The caller's own request, or `null`. Never anybody else's, and never a list. */
export async function GET(request) {
    const { address, error } = mine(request);
    if (error) return error;

    const found = await getRequest(address);
    if (!found) return NextResponse.json({ ok: true, request: null, storage: storageDescription() });

    return NextResponse.json({
        ok: true,
        // The whole record, including the picture: it is the caller's own upload, and the page needs
        // it to draw the card. Nothing here belongs to another wallet.
        request: found,
        limits: REQUEST_LIMITS,
        storage: storageDescription(),
    });
}

/** Send a request, or edit the pending one. */
export async function POST(request) {
    const { address, error } = mine(request);
    if (error) return error;

    let body = {};
    try {
        body = await request.json();
    } catch {
        // Treated as an empty submission below rather than a crash.
    }

    const attempt = await countAttempt(clientIp(request));
    if (!attempt.allowed) {
        return NextResponse.json(
            { error: 'Too many attempts from this connection — give it a minute.', code: 'throttled' },
            { status: 429 }
        );
    }

    try {
        const result = await putRequest({
            address,
            name: body?.name,
            handle: body?.handle,
            prize: body?.prize,
            dates: body?.dates ?? null,
            note: body?.note ?? null,
        });

        if (result.error) {
            return NextResponse.json({ error: result.error, code: result.code }, { status: 400 });
        }

        return NextResponse.json({
            ok: true,
            request: result.request,
            resubmitted: result.resubmitted === true,
            limits: REQUEST_LIMITS,
            storage: storageDescription(),
        });
    } catch (err) {
        return NextResponse.json(
            {
                error: 'That request could not be saved just now. Please try again in a moment.',
                code: 'store-unavailable',
                detail: process.env.NODE_ENV === 'production' ? undefined : String(err?.message || err),
            },
            { status: 503 }
        );
    }
}

/** Withdraw it, while it is still pending. */
export async function DELETE(request) {
    const { address, error } = mine(request);
    if (error) return error;

    try {
        const result = await removeRequest(address);
        if (result.error) {
            return NextResponse.json({ error: result.error, code: result.code }, { status: 409 });
        }
        return NextResponse.json({ ok: true, removed: result.removed === true });
    } catch (err) {
        return NextResponse.json(
            {
                error: 'That request could not be withdrawn just now. Please try again in a moment.',
                code: 'store-unavailable',
                detail: process.env.NODE_ENV === 'production' ? undefined : String(err?.message || err),
            },
            { status: 503 }
        );
    }
}
