import { NextResponse } from 'next/server';
import { PFP_MAX_BYTES, attachRequestPhoto, countAttempt } from '../../../../../lib/collab-store.js';
import { sessionFromRequest } from '../../../../../lib/points-session.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The project's profile picture, which is the right-hand medallion of the announcement card.
 *
 * Its own route rather than a field on the submission for two reasons, both about honesty rather
 * than about tidiness:
 *
 *   - **It is a different permission.** Sending a request is something anybody may do; uploading the
 *     picture is something only an *approved* project may do, because the picture is what the card
 *     is made from. `attachRequestPhoto` refuses unless the stored status is `approved`, and this
 *     route says so in words when it does.
 *   - **It is a different size.** A submission is a few hundred bytes of text; a picture is up to
 *     `PFP_MAX_BYTES`. Keeping them apart means the JSON body limit that matters is the one on the
 *     route that has the cap, and the text route can stay a text route.
 *
 * The bytes are checked, not trusted: `readPhotoDataUrl` decodes the base64 and compares the magic
 * number against the declared type, so a file that only *claims* to be a PNG is refused rather than
 * stored and later handed to somebody's browser to decode.
 */
export async function POST(request) {
    const address = sessionFromRequest(request);
    if (!address) {
        return NextResponse.json(
            { error: 'Connect a wallet and sign in first.', code: 'signed-out' },
            { status: 401 }
        );
    }

    let body = {};
    try {
        body = await request.json();
    } catch {
        // Treated as an empty upload below rather than a crash.
    }

    const forwarded = request.headers.get('x-forwarded-for') || '';
    const attempt = await countAttempt(forwarded.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown');
    if (!attempt.allowed) {
        return NextResponse.json(
            { error: 'Too many attempts from this connection — give it a minute.', code: 'throttled' },
            { status: 429 }
        );
    }

    try {
        const result = await attachRequestPhoto(address, body?.photo);
        if (result.error) {
            return NextResponse.json(
                { error: result.error, code: result.code },
                { status: result.code === 'not-approved' ? 403 : result.code === 'not-found' ? 404 : 400 }
            );
        }
        return NextResponse.json({
            ok: true,
            mime: result.mime,
            bytes: result.bytes,
            limit: PFP_MAX_BYTES,
            photoAt: result.request?.photoAt || null,
        });
    } catch (err) {
        return NextResponse.json(
            {
                error: 'That picture could not be saved just now. Please try again in a moment.',
                code: 'store-unavailable',
                detail: process.env.NODE_ENV === 'production' ? undefined : String(err?.message || err),
            },
            { status: 503 }
        );
    }
}
