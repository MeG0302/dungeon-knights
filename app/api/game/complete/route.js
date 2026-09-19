import { NextResponse } from 'next/server';
import { sessionFromRequest } from '../../../../lib/points-session.js';
import {
    buildReceipt, inspectSquad, minSecondsFor, readRunToken, signingReady,
} from '../../../../lib/game-runs.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// What a single dungeon can plausibly contain. The engine generates 50–70 loot nodes
// per run, so these are wide bounds whose only job is to catch a report that was never
// played at all — the time floor, ownership and the on-chain daily caps do the real
// work, and a tight check here would only ever punish an honest player.
const MAX_NODES = 150;
const MAX_CHESTS = 8;

/**
 * POST { runToken, kills, totalNodes, chests } — the only place a run is priced.
 *
 * Everything that decides the payout happens here or on chain: how long the run took
 * (our clock, from the token), whether the wallet owns the knights and has runs left
 * today (the chain), and what it is worth (on-chain rarity, not the browser's estimate).
 * The signed receipt is then re-checked by V4, which recomputes the reward itself.
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

    if (!signingReady()) {
        return NextResponse.json({ error: 'the run signer is not configured' }, { status: 503 });
    }

    const run = readRunToken(body?.runToken);
    if (!run) {
        return NextResponse.json({ error: 'that run token is missing, forged or too old' }, { status: 400 });
    }
    // A token is bound to the wallet it was issued to, so one player cannot finish
    // another player's run.
    if (run.address !== address) {
        return NextResponse.json({ error: 'that run belongs to a different wallet' }, { status: 403 });
    }

    // Shape first, then the clock. A report that could never describe a dungeon is
    // malformed whatever its timing, and answering 400 for it is clearer than making the
    // caller wait out a 409 to be told the same thing.
    // Bounds only — see MAX_NODES above.
    const kills = Number(body?.kills);
    const totalNodes = Number(body?.totalNodes);
    const chests = Number(body?.chests);
    if (Number.isFinite(kills) && (kills < 0 || kills > MAX_NODES)) {
        return NextResponse.json({ error: 'that kill count is not possible' }, { status: 400 });
    }
    if (Number.isFinite(totalNodes) && (totalNodes < 1 || totalNodes > MAX_NODES)) {
        return NextResponse.json({ error: 'that dungeon size is not possible' }, { status: 400 });
    }
    if (Number.isFinite(kills) && Number.isFinite(totalNodes) && kills > totalNodes) {
        return NextResponse.json({ error: 'more kills than monsters' }, { status: 400 });
    }
    if (Number.isFinite(chests) && (chests < 0 || chests > MAX_CHESTS)) {
        return NextResponse.json({ error: 'that chest count is not possible' }, { status: 400 });
    }

    const elapsed = Math.floor(Date.now() / 1000) - run.startedAt;
    const minSeconds = minSecondsFor(run.knightIds.length);
    if (elapsed < minSeconds) {
        // Not a rejection: the run is real, it is simply too fast to be believable yet.
        // The client waits out `retryAfter` and asks again.
        return NextResponse.json(
            {
                error: 'that run finished sooner than the dungeon allows',
                retryAfter: minSeconds - elapsed,
            },
            { status: 409 }
        );
    }

    const squad = await inspectSquad({ address, knightIds: run.knightIds });
    if (!squad.ok) {
        return NextResponse.json({ error: squad.reason }, { status: 400 });
    }

    const receipt = await buildReceipt({
        address,
        knightIds: run.knightIds,
        dungeonId: run.dungeonId,
        reward: squad.reward,
    });
    if (!receipt) {
        return NextResponse.json({ error: 'could not sign the run' }, { status: 500 });
    }

    return NextResponse.json({
        receipt,
        elapsed,
        minSeconds,
        reward: receipt.reward,
        // Readable on the explorer by anyone who wants to check what was signed.
        hash: receipt.hash,
    });
}
