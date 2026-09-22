import { NextResponse } from 'next/server';
import { addToWaitlist, countAttempt, normaliseHandle, storageDescription, waitlistSize } from '../../../lib/waitlist-store';
import { forwardToForm } from '../../../lib/waitlist-forms';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The Genesis waitlist.
 *
 * `GET` answers with one number — how many people are in line — and is public on purpose: it is the
 * only thing on the landing page that is worth showing and worth nothing to forge. No addresses, no
 * handles, no emails.
 *
 * `POST` takes an email, and optionally a handle, a wallet and the person's own word that they
 * followed us. The follow is **not verified** (see `lib/waitlist-store.js`), which is why the field
 * is named `followClaimed` rather than `following`.
 */

/** Behind Vercel there is always a proxy; the first hop is the client. */
function clientIp(request) {
    const forwarded = request.headers.get('x-forwarded-for') || '';
    const first = forwarded.split(',')[0].trim();
    return first || request.headers.get('x-real-ip') || 'unknown';
}

export async function GET() {
    return NextResponse.json({ count: await waitlistSize() });
}

export async function POST(request) {
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
        const result = await addToWaitlist({
            email: body?.email,
            handle: normaliseHandle(body?.handle) ? body.handle : null,
            address: body?.address ?? null,
            followClaimed: body?.followClaimed,
            source: body?.source,
        });

        if (result.error) {
            return NextResponse.json({ error: result.error, code: result.code }, { status: 400 });
        }

        // The owner's Google Form, kept in step with the store. Deliberately after the entry is
        // safely written and deliberately unable to change the answer: a form that is slow, blocked
        // or rebuilt must never cost somebody their place, and it must never turn a signup that
        // succeeded into an error the visitor reads as "try again". Only **new** signups are copied
        // — a repeat submission is the same person, and a second row for them would be a duplicate
        // in the list somebody mints from.
        let formForwarded = null;
        if (!result.alreadyRegistered) {
            const forwarded = await forwardToForm({ email: body?.email, address: body?.address ?? null });
            formForwarded = forwarded.ok === true;
            if (!forwarded.ok && !forwarded.skipped) {
                console.warn('[waitlist] the Google Form copy did not record this signup:', forwarded.reason);
            }
        }

        return NextResponse.json({
            ok: true,
            position: result.position,
            alreadyRegistered: result.alreadyRegistered === true,
            count: await waitlistSize(),
            // So the page — and whoever is reading the response while testing — can see where the
            // signup was written without having to guess which deployment is configured.
            storage: storageDescription(),
            // `true` when the owner's form took it, `false` when it did not, `null` when the signup
            // was a repeat and nothing was sent. Stated rather than implied, because a waitlist row
            // that never reached the form is invisible from our side until somebody counts rows.
            formForwarded,
        });
    } catch (error) {
        // A store that is unreachable is not the visitor's problem, and saying "try again" is honest:
        // nothing was recorded.
        return NextResponse.json(
            {
                error: 'The waitlist could not be saved just now. Please try again in a moment.',
                code: 'store-unavailable',
                detail: process.env.NODE_ENV === 'production' ? undefined : String(error?.message || error),
            },
            { status: 503 }
        );
    }
}
