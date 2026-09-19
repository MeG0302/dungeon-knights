import { NextResponse } from 'next/server';
import { historyFor } from '../../../../lib/chain-logs.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET ?address=0x… — one wallet's claim history, straight from the contract's events.
 *
 * This replaces the `claim-history.html` page the game's History button used to open: that
 * file lives outside `public/`, so it was never served and the button navigated into a 404.
 *
 * The address is the whole request, so it is the whole validation. Nothing here is private:
 * an address and a transaction are public chain data by construction, and the endpoint only
 * ever reads.
 */
export async function GET(request) {
    const address = new URL(request.url).searchParams.get('address');
    if (!/^0x[0-9a-fA-F]{40}$/.test((address || '').trim())) {
        return NextResponse.json({ error: 'a 0x wallet address is required' }, { status: 400 });
    }

    try {
        const history = await historyFor(address);
        if (!history) return NextResponse.json({ error: 'invalid address' }, { status: 400 });
        return NextResponse.json(history);
    } catch (error) {
        console.error('[history] chain read failed:', error.message || error);
        return NextResponse.json(
            { error: 'Could not read the chain right now. Try again in a moment.' },
            { status: 502 }
        );
    }
}
