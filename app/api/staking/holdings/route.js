import { NextResponse } from 'next/server';
import { readOwnedKnights } from '../../../../lib/staking-chain.js';
import { ADDRESSES } from '../../../../lib/game-runs.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * A wallet's answer, held briefly.
 *
 * Not an optimisation for its own sake — the node throttles. A read costs three calls (the
 * transfer logs, `balanceOf`, then the ownership batch), one page load can ask twice (a reload,
 * a side switch, a double render in dev), and hitting HTTP 429 three times in a row turns into
 * the honest-but-alarming "the chain could not be read just now" over a wallet's real knights.
 * Thirty seconds collapses that burst into one read.
 *
 * It is a **cache, not a store**: each serverless instance has its own, losing it costs one read,
 * and nothing depends on it being warm. Failures are deliberately not cached, so a throttle is
 * followed by a real retry rather than half a minute of the same error.
 */
const CACHE_TTL_MS = 30_000;
const cache = new Map();

function cached(key) {
    const hit = cache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > CACHE_TTL_MS) {
        cache.delete(key);
        return null;
    }
    return hit.payload;
}

function remember(key, payload) {
    // Bounded, because this lives in a serverless instance that may serve many wallets: 200
    // entries is far more than a warm instance will use and cannot grow without limit.
    if (cache.size > 200) cache.clear();
    cache.set(key, { at: Date.now(), payload });
    return payload;
}

/**
 * The knights a wallet actually owns, read from the collection itself.
 *
 * Its own route rather than a field on `/api/staking/config` for two reasons. Holdings are
 * **per wallet** and the config is not — caching one against the other is how a page ends up
 * showing someone else's knights. And the read is a chain round trip, while the config is pure
 * arithmetic that every visitor needs before they connect anything; folding them together would
 * put a node dependency in front of the economy panel.
 *
 * The collection is read live even though the four staking contracts are not deployed. Owning a
 * knight and being able to stake one are different facts — the first is true today, the second
 * is not — and the page is allowed to report the first while refusing the second.
 *
 * A chain failure is a 200 with `ok: false`, not a 500. The page has a true thing to say about a
 * node that is down ("the chain could not be read just now"), and a 500 would replace that with
 * a broken panel.
 */
export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const address = (searchParams.get('address') || '').trim();
    const collection = (searchParams.get('collection') || 'knights').trim().toLowerCase();

    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
        return NextResponse.json({ ok: false, reason: 'a wallet address is required' }, { status: 400 });
    }

    // Only the Knights collection exists on this network. Genesis Knights have never been
    // minted, so there is nothing to read and saying so is better than reading the summonable
    // collection and labelling its knights with Genesis bands.
    const nft = collection === 'genesis' ? '' : ADDRESSES.knightNFT;

    if (!nft) {
        return NextResponse.json({
            ok: false,
            collection,
            reason: collection === 'genesis'
                ? 'Genesis Knights are not minted yet, so there is no collection to read.'
                : 'no knight collection is configured for this network',
        });
    }

    // Keyed by collection as well as address: the same wallet owns different knights on each
    // side, and sharing one entry between them would show Genesis knights under a Knights label.
    const key = `${collection}:${address.toLowerCase()}`;
    const hit = cached(key);
    if (hit) return NextResponse.json(hit);

    const holdings = await readOwnedKnights(address, { nftAddress: nft });
    const payload = { ...holdings, collection, nft };

    // A failed read is never remembered, so the next request actually tries again.
    return NextResponse.json(holdings.ok ? remember(key, payload) : payload);
}
