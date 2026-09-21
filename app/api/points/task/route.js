import { NextResponse } from 'next/server';
import { sessionFromRequest } from '../../../../lib/points-session.js';
import { submitTask, checkTask, claimOneTime } from '../../../../lib/points-program.js';

// Every answer here depends on a live X lookup and on stored state, so nothing may be cached.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST { action: 'submit' | 'check' | 'claim', task, url? } — the campaign reward, the daily share,
 * and the one-time tab.
 *
 * The client sends the link to a post and nothing else about it. Whether that post is real, whose
 * it is, and what it carries are all decided in `lib/points-program.js` from X's own record of the
 * post — the page's opinion of its own post is never an input to a payout.
 *
 * `submit` files a post (or files a new one) and answers straight away with one of three states:
 * paid, **pending** (X has not indexed it yet — a real answer, not an error), or failed.
 * `check` asks X again about the pending submission, and is rate-limited server-side.
 * `claim` is the one-time tab: `task` is a task id from the registry rather than a post kind, there
 * is no url, and the server pays it once per wallet under an atomic guard. Its reward is a claim
 * rather than a proof — see `claimOneTime` for why that is the honest shape for a follow.
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

    const kind = String(body?.task || '').trim();

    if (body?.action === 'submit') {
        if (!body?.url) {
            return NextResponse.json({ error: 'Paste the link to the post you made.', code: 'no-url' }, { status: 400 });
        }
        const result = await submitTask(address, kind, String(body.url).trim());
        if (result.error) {
            // A throttled re-check and a pending post are not failures — they are the answer, and
            // the page has a sentence for each. 429 says so without pretending anything broke.
            const status = result.code === 'throttled' ? 429 : 400;
            return NextResponse.json(result, { status });
        }
        return NextResponse.json(result);
    }

    if (body?.action === 'claim') {
        const result = await claimOneTime(address, kind);
        if (result.error) {
            return NextResponse.json(result, { status: result.code === 'x-required' ? 403 : 400 });
        }
        return NextResponse.json(result);
    }

    if (body?.action === 'check') {
        const result = await checkTask(address, kind);
        if (result.error) {
            const status = result.code === 'throttled' ? 429 : 400;
            return NextResponse.json(result, { status });
        }
        return NextResponse.json(result);
    }

    return NextResponse.json({ error: "action must be 'submit', 'check' or 'claim'" }, { status: 400 });
}
