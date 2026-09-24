import { NextResponse } from 'next/server';
import { sessionFromRequest } from '../../../../lib/points-session.js';
import { giveawayView } from '../../../../lib/points-capsules.js';
import { settleDraws } from '../../../../lib/points-draw.js';

// Today's board and the last draw are read from the store on every request — never cached.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET — the daily capsule draw, for anybody.
 *
 * Public on purpose: the board a prize is decided from should be readable by the people competing for
 * it, signed in or not, and that is the same bargain `/api/points/leaderboard` already makes. A
 * session is optional and only ever adds the caller's own row — `isYou`, their rank today, and the
 * capsules their wallet holds. No wallet, no personal fields, and no total count of players either
 * way.
 *
 * Settlement runs first, so a visitor asking about the draw is a perfectly good moment to make sure
 * the days that are owed have been drawn. It is idempotent and returns immediately when nothing is
 * outstanding, which is every request but the first of a day.
 */
export async function GET(request) {
    await settleDraws({ maxDays: 3 });
    const me = sessionFromRequest(request);
    return NextResponse.json(await giveawayView(me));
}
