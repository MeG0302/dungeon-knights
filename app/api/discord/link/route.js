import { NextResponse } from 'next/server';
import { sessionFromRequest } from '../../../../lib/points-session.js';
import { issueLinkCode, pendingCodeFor, linkForAddress, storageDescription, CODE_TTL_MS } from '../../../../lib/discord-link.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The site half of linking a Discord account to a wallet.
 *
 * A signed-in wallet asks for a code; the person types it in Discord. The code is the only thing that
 * crosses between the two, and it is worthless to anyone who is not already signed in as that wallet,
 * because it is never shown to anybody else (see `lib/discord-link.js` for the whole argument).
 *
 * Three answers, and no more:
 *
 *   - `code` (default) issues a fresh one. Any earlier code for this wallet stops working, so a
 *     screenshot taken yesterday cannot be redeemed today.
 *   - `status` reports what is already true without issuing anything: whether a wallet is linked, and
 *     which code is outstanding. This is what the page calls when it opens, so that a player who
 *     refreshed mid-flow sees the same code rather than a new one every render.
 *
 * The session is required for both. There is nothing here for an anonymous caller, and the code is a
 * bearer for a role grant, so an unauthenticated read of it would be the whole hole.
 */
export async function POST(request) {
    const address = sessionFromRequest(request);
    if (!address) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

    let body = {};
    try {
        body = await request.json();
    } catch {
        // Treated as the default action below, like every other route in this project.
    }

    const link = await linkForAddress(address);
    const linked = link ? { discordId: String(link.discordId), at: link.at || null, roles: link.roles || [] } : null;

    const action = String(body?.action || 'code');

    if (action === 'status') {
        return NextResponse.json({
            linked,
            pending: await pendingCodeFor(address),
            ttlMinutes: Math.round(CODE_TTL_MS / 60000),
            storage: storageDescription(),
        });
    }

    if (action !== 'code') {
        return NextResponse.json({ error: "action must be 'code' or 'status'" }, { status: 400 });
    }

    const issued = await issueLinkCode(address);
    if (issued.error) return NextResponse.json({ error: issued.error }, { status: 400 });

    return NextResponse.json({
        ok: true,
        code: issued.code,
        expiresAt: issued.expiresAt,
        ttlMinutes: Math.round(CODE_TTL_MS / 60000),
        linked,
        // The instruction is written here rather than in the page so that the command name and the
        // flow cannot drift apart in two places.
        command: `/claim ${issued.code}`,
        storage: storageDescription(),
    });
}
