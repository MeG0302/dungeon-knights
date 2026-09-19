import { NextResponse } from 'next/server';
import { ADDRESSES, CHAIN, DUNGEONS, MIN_FLOOR_SECONDS, minSecondsFor, signingReady } from '../../../../lib/game-runs.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET — what the browser needs to know about the claim path.
 *
 * The V4 address is served from here rather than hard-coded in `public/config.js` so
 * there is exactly one place to change when the contract moves: the server's env. A
 * client that gets `v4: null` keeps using the old V3 path, which is what makes
 * shipping this before the contract exists safe.
 */
export async function GET() {
    return NextResponse.json({
        chainId: CHAIN.id,
        explorer: CHAIN.explorer,
        knightNFT: ADDRESSES.knightNFT,
        dngToken: ADDRESSES.dngToken,
        v3: ADDRESSES.gameV3,
        v4: ADDRESSES.gameV4 || null,
        signing: signingReady(),
        dungeons: Object.fromEntries(
            Object.entries(DUNGEONS).map(([id, d]) => [id, d.name])
        ),
        minFloorSeconds: MIN_FLOOR_SECONDS,
        // The client shows the same estimate the server enforces, so a player is never
        // told one number and judged by another.
        minSeconds: Object.fromEntries(
            [1, 2, 3, 5, 10, 15].map((n) => [n, minSecondsFor(n)])
        ),
    });
}
