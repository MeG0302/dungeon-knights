import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { drawDay, recentDraws, settleDraws } from '../../../../lib/points-draw.js';

// Reads and writes the store on every call, and is reached by a scheduler we do not control.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The daily draw, driven by Vercel's cron.
 *
 *     GET /api/points/draw                 settle every day that is owed, oldest first
 *     GET /api/points/draw?day=2026-09-25  settle one day — a re-run, or a repair
 *
 * ## Why this route exists when the page already settles the draw
 *
 * It does not have to. `settleDraws` is called from the read that renders a wallet, so the draw is
 * correct with no scheduler at all — a day whose board has closed is drawn the next time anybody looks
 * at the site. This endpoint is what makes it *prompt*: a cron at 00:10 UTC means the winners exist
 * before the first player of the new day arrives, instead of a minute after they do. Two triggers,
 * one idempotent function, and neither is load-bearing on its own.
 *
 * ## The secret, and why the route is exempt from the gate
 *
 * `dungeonknights.io` is the public hostname; the app and every deployment URL are behind a password,
 * and the middleware exempts a short list of paths *by name* (`GLOBAL_OPEN`) because a scheduler
 * cannot type a password. This route is on that list for exactly that reason — and it is closed to
 * everybody else by `CRON_SECRET`, compared in constant time.
 *
 * **No secret means no draw, not an open draw.** The check fails closed, and the response says what
 * to set. The consequence of that choice is bounded and understood: a deployment without the variable
 * simply has no scheduler, and every page read still settles the days it owes.
 */
function authorised(request, secret) {
    const header = request.headers.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return false;
    const given = Buffer.from(token, 'utf8');
    const expected = Buffer.from(secret, 'utf8');
    // Length first because `timingSafeEqual` throws on a mismatch, then a constant-time compare: a
    // length-dependent early exit on a secret of unknown length leaks the length, which is the only
    // thing this comparison is here to avoid.
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export async function GET(request) {
    const secret = String(process.env.CRON_SECRET || '').trim();
    if (!secret) {
        return NextResponse.json({
            error: 'The draw endpoint is disabled because CRON_SECRET is not set. The draw still runs '
                + 'on the next page read; set CRON_SECRET to put it on a schedule.',
            code: 'no-secret',
        }, { status: 503 });
    }
    if (!authorised(request, secret)) {
        return NextResponse.json({ error: 'not authorised', code: 'unauthorised' }, { status: 401 });
    }

    const day = new URL(request.url).searchParams.get('day');

    if (day) {
        const result = await drawDay(String(day).trim());
        if (result?.error) {
            return NextResponse.json(result, { status: 400 });
        }
        return NextResponse.json({
            ok: true,
            mode: result.busy ? 'busy' : result.already ? 'already' : 'drawn',
            day: result.day,
            awarded: result.awarded ?? 0,
            winners: (result.winners || []).map((w) => ({ rank: w.rank, handle: w.handle, address: w.address, points: w.points })),
            recent: await recentDraws(3),
        });
    }

    // Ten days per invocation, deliberately: a cron that has missed a week should catch up in a few
    // quick passes rather than hold one request open for a year of history. `pending` says how much
    // is left, so a caller can see that the catch-up is progressing.
    const result = await settleDraws({ maxDays: 10 });
    return NextResponse.json({
        ok: true,
        firstDay: result.firstDay,
        settled: result.settled,
        pending: result.pending,
        busy: result.busy || null,
        recent: await recentDraws(1),
    });
}
