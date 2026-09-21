import { NextResponse } from 'next/server';
import { readDngBalance } from '../../../../lib/staking-chain.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET ?address=0x… — how much $DNG this wallet holds.
 *
 * Its own route, in the `wallet` namespace rather than `staking`, because a balance belongs to a
 * wallet and not to a collection — the two holdings routes answer "which knights", and this
 * answers "how much token", which is true regardless of which side of the vault is on screen.
 *
 * **Why the server reads it rather than the browser.** The wallet's own provider could answer
 * this with one `eth_call`, and the first version of the Portfolio page did exactly that. What it
 * produced was a page whose four other sections showed real chain data while its headline figure
 * said the wallet was unavailable — because having a saved address and having a live extension are
 * two different facts, and a visitor reading their own portfolio in a browser without one is not
 * an edge case, it is most of them. Every other read on that page is server-side; this is the
 * last one to join them, and now no section needs an extension to render.
 *
 * A chain failure is a 200 with `ok: false` and a reason, matching `/api/staking/holdings`: the
 * page has a true sentence for an unreadable token, and a 500 would replace it with a broken
 * panel. The address is validated here as well as in the reader, so a malformed request is a 400
 * rather than a sentence about the chain.
 */
export async function GET(request) {
    const address = (new URL(request.url).searchParams.get('address') || '').trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
        return NextResponse.json({ ok: false, reason: 'a wallet address is required' }, { status: 400 });
    }

    return NextResponse.json(await readDngBalance(address));
}
