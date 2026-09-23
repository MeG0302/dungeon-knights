import { NextResponse } from 'next/server';
import { verifySignature, handleInteraction, SIGNATURE_HEADER, TIMESTAMP_HEADER } from '../../../../lib/discord-interactions.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Discord's interaction endpoint. Slash commands arrive here.
 *
 * The order of the four statements below is the security property, the same one the X receiver has:
 * read the **raw** body, check the signature over it, and only then parse it. A body parsed first and
 * re-serialised would never match the signature, so a verifier written that way either fails every
 * genuine interaction (visible) or starts trusting parsed input (silent), and the fix looks like the
 * same code either way.
 *
 * An unsigned or stale request is a 401. That is not only correct, it is **the signal the setup tool
 * uses**: `--wire-app` posts an unsigned ping and treats a 401 as proof the route is deployed and
 * verifying, because Discord will not accept an endpoint that answers anything else.
 */
export async function POST(request) {
    const rawBody = await request.text();
    const signature = request.headers.get(SIGNATURE_HEADER);
    const timestamp = request.headers.get(TIMESTAMP_HEADER);

    const verdict = verifySignature({ rawBody, signature, timestamp });
    if (!verdict.ok) {
        // Logged with the reason, because the two causes need different fixes: no public key is a
        // deployment problem, a mismatch is usually a request that did not come from Discord.
        console.warn(`[discord] refused an interaction (${verdict.code}): ${verdict.reason}`);
        return NextResponse.json({ error: 'bad signature' }, { status: 401 });
    }

    let payload = null;
    try {
        payload = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ error: 'expected JSON' }, { status: 400 });
    }

    const deadline = Number(process.env.DISCORD_INTERACTION_DEADLINE_MS);
    const answer = await handleInteraction(payload, {
        guild: process.env.DISCORD_GUILD_ID || '',
        deadlineMs: Number.isFinite(deadline) && deadline > 0 ? deadline : undefined,
    });

    return NextResponse.json(answer.body, { status: answer.status });
}

/**
 * Discord only ever POSTs. A GET is answered rather than 404'd, so that a person checking the URL in
 * a browser can see the route is deployed and is not the thing that is broken.
 */
export async function GET() {
    return NextResponse.json(
        {
            ok: true,
            endpoint: 'discord interactions',
            note: 'this URL only answers signed POSTs from Discord. A 401 to anything else is correct.',
        },
        { status: 405 },
    );
}
