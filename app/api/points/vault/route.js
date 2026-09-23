import { NextResponse } from 'next/server';
import { sessionFromRequest } from '../../../../lib/points-session.js';
import { clearLevel, shareEntry } from '../../../../lib/points-program.js';
import { VAULT_LEVELS } from '../../../../lib/points-config.js';
import { notifyVaultRun } from '../../../../lib/discord-notify.js';

// The payout rules depend on today's date and on stored state, so nothing here may be
// cached or prerendered.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST { action, level } — the only way points are ever awarded.
 *
 * The vault mini-game is scripted, so the client is trusted only for *which* floor it
 * finished. How much that pays, whether it has already been paid today, and whether the
 * floors were done in order are all decided here — a replayed or hand-rolled request
 * gets the same answer as the real one: nothing.
 */
export async function POST(request) {
    const address = sessionFromRequest(request);
    if (!address) {
        return NextResponse.json({ error: 'not signed in' }, { status: 401 });
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'expected a JSON body' }, { status: 400 });
    }

    const action = body?.action;
    if (action === 'clear') {
        const result = await clearLevel(address, body?.level);
        if (result.error) return NextResponse.json(result, { status: 400 });

        // One milestone is worth a public note: the last floor, cleared today, for points. `credited`
        // is what separates finishing the run from tapping the button twice, because a floor already
        // cleared today pays nothing and comes back with the same state.
        //
        // Not awaited. The player is watching the mini-game finish, and a post to Discord is not
        // worth a second of their time; `notifyVaultRun` never throws and never changes the answer,
        // so the worst case of losing the race is a missing post. The points are already paid, and
        // the run is already recorded, before this line runs.
        if (Number(body?.level) === VAULT_LEVELS.length - 1 && Number(result.credited) > 0) {
            void notifyVaultRun({ points: Number(result.state?.entryTotalToday) || Number(result.credited) });
        }

        return NextResponse.json(result);
    }
    if (action === 'share') {
        // The share is a *verified* task now: it doubles today's run only once a post written by the
        // bound X account is confirmed to exist. `url` is the link to that post, and the doubling is
        // the same code path the campaign reward uses — one verifier, two rewards.
        const result = await shareEntry(address, body?.url ? String(body.url).trim() : '');
        if (result.error) {
            const status = result.code === 'throttled' ? 429 : 400;
            return NextResponse.json(result, { status });
        }
        return NextResponse.json(result);
    }
    return NextResponse.json({ error: "action must be 'clear' or 'share'" }, { status: 400 });
}
