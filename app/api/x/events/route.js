import { NextResponse } from 'next/server';
import {
    SIGNATURE_HEADER, answerCrcChallenge, isTrustedDelivery, parseFollowEvents,
    describeFollowDelivery, followTargetId, followProofMode,
} from '../../../../lib/x-webhook.js';
import { recordFollowFact } from '../../../../lib/points-store.js';

// This route must never be cached or statically rendered: it exists to be *called* by X, and its
// whole body is a side effect on the store.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * X's CRC handshake — the first thing that happens to a webhook URL, and the gate on everything else.
 *
 * X asks `?crc_token=…` and will not deliver a single event until it gets the HMAC back. Failure
 * here is silent from the outside: the subscription simply never completes, and every later
 * debugging step is done against a webhook that was never wired up. So a missing token or a missing
 * secret is answered with a 400 that says which half is missing, rather than a cheerful 200 with a
 * token computed from an empty string.
 */
export async function GET(request) {
    const crcToken = new URL(request.url).searchParams.get('crc_token');
    const responseToken = answerCrcChallenge(crcToken);

    if (!responseToken) {
        console.error(`[x-events] CRC challenge refused — ${crcToken ? 'no X_CONSUMER_SECRET configured' : 'no crc_token in the request'}`);
        return NextResponse.json(
            { error: crcToken ? 'no consumer secret configured' : 'expected a crc_token' },
            { status: 400 },
        );
    }

    return NextResponse.json({ response_token: responseToken });
}

/**
 * A delivery from X.
 *
 * The order below is the whole security story of this route: **read the raw body**, verify the
 * signature over those exact bytes, and only then look inside. Nothing in the payload is an input to
 * anything until the header has proved the sender knows the consumer secret — which is why the body
 * is read with `request.text()` and never `request.json()`. A parsed-then-re-serialised body is
 * different bytes, so a signature check performed on it fails for *every* delivery, including the
 * genuine ones; the verifier would look broken rather than the forgery looking fake.
 *
 * A delivery that passes the signature is answered **200 even when we do not understand it**. That is
 * deliberate: X retries anything that is not a 2xx, every delivered event is billable, and a shape we
 * have never seen should cost one loud log line rather than a retry storm that pays for the same
 * event repeatedly. A 401 is the other side of the same coin — a forged delivery must never be
 * recorded, and X itself always signs correctly, so a 401 is never a genuine event being turned away.
 */
export async function POST(request) {
    const rawBody = await request.text();
    const header = request.headers.get(SIGNATURE_HEADER);

    if (!isTrustedDelivery(rawBody, header)) {
        console.error(`[x-events] refused an unsigned or wrongly signed delivery (header ${header ? 'present' : 'absent'}, ${rawBody.length} bytes)`);
        return NextResponse.json({ error: 'bad signature' }, { status: 401 });
    }

    let payload;
    try {
        payload = JSON.parse(rawBody);
    } catch {
        // Signed, so it is ours — but not JSON. Accepted and logged, for the reason above.
        console.error('[x-events] a signed delivery was not JSON');
        return NextResponse.json({ ok: true, recorded: 0, note: 'unparseable' });
    }

    const parsed = parseFollowEvents(payload, { targetId: followTargetId() });
    console.log(`[x-events] ${describeFollowDelivery(parsed)}`);

    if (!parsed.ok) {
        return NextResponse.json({ ok: true, recorded: 0, note: parsed.code });
    }

    let recorded = 0;
    for (const event of parsed.events) {
        // Best effort per event: one malformed entry must not cost the whole delivery, since X has
        // already billed it and will not re-send the rest.
        try {
            const fact = await recordFollowFact({
                id: event.id,
                username: event.username,
                following: event.following,
                at: event.at,
                source: 'webhook',
            });
            if (fact) recorded += 1;
        } catch (error) {
            console.error(`[x-events] could not record ${event.following ? 'follow' : 'unfollow'} ${event.id}: ${error.message || error}`);
        }
    }

    return NextResponse.json({
        ok: true,
        recorded,
        skipped: parsed.skipped || 0,
        // Reported so a delivery arriving against a deployment that cannot use it says so in the
        // response, in the log, and in the same words the Points page uses.
        mode: followProofMode(),
    });
}
