import { NextResponse } from 'next/server';
import { readOwnedKnights, readStakeState } from '../../../../lib/staking-chain.js';
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
 * The knights a wallet actually owns, and the ones it actually has staked.
 *
 * Its own route rather than a field on `/api/staking/config` for two reasons. Holdings are
 * **per wallet** and the config is not — caching one against the other is how a page ends up
 * showing someone else's knights. And the read is a chain round trip, while the config is pure
 * arithmetic that every visitor needs before they connect anything; folding them together would
 * put a node dependency in front of the economy panel.
 *
 * **Ownership and staking are two reads, and after a stake is real they return disjoint sets.**
 * `stakedTokens(wallet)` answers the second one, from the pool. Without it a wallet's staked
 * knights would simply be missing: the pool owns them, so a collection read cannot see them, and
 * the page would show a knight vanish the moment it started earning. The two are read one after
 * the other rather than together — this node throttles on bursts, and the second read is cheap
 * once the first has warmed the connection.
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
    // Set by the page immediately after a transaction. The cache is a throttle guard, and the one
    // moment it must not answer from memory is the one where the wallet just changed something on
    // chain — reading back the state from before the stake is exactly what looks like a broken
    // vault. Fresh reads are remembered: they are newer than what they replace.
    const fresh = searchParams.get('fresh') === '1';

    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
        return NextResponse.json({ ok: false, reason: 'a wallet address is required' }, { status: 400 });
    }

    // Read the collection the caller actually asked for, and only refuse when it is genuinely not
    // configured.
    //
    // This used to hard-code a refusal for Genesis on the grounds that it had never been minted —
    // true when it was written, and false the moment the contract was deployed. The two facts
    // "there is no Genesis collection" and "the Genesis collection holds no knights" are read very
    // differently by a player, and reporting the first while the second is true sends them looking
    // for a deployment that already exists. An empty read (`ok: true, balance: 0`) is the honest
    // answer; the collection's own reason is reserved for the case where there is nothing to read.
    const nft = collection === 'genesis' ? ADDRESSES.genesisNFT : ADDRESSES.knightNFT;

    if (!nft) {
        return NextResponse.json({
            ok: false,
            collection,
            reason: collection === 'genesis'
                ? 'No Genesis collection is configured for this network.'
                : 'no knight collection is configured for this network',
        });
    }

    // Keyed by collection as well as address: the same wallet owns different knights on each
    // side, and sharing one entry between them would show Genesis knights under a Knights label.
    const key = `${collection}:${address.toLowerCase()}`;
    if (!fresh) {
        const hit = cached(key);
        if (hit) return NextResponse.json(hit);
    }

    const holdings = await readOwnedKnights(address, { nftAddress: nft });

    // The pool this side stakes into, and the reason a staked knight is not in the list above.
    // Read even when the collection read failed: "you own 45" and "you have 3 staked" are separate
    // facts, and an empty collection read must not erase the staked ones.
    const staking = collection === 'genesis' ? ADDRESSES.genesisStaking : ADDRESSES.knightsStaking;
    const stake = staking
        ? await readStakeState(address, { staking, nftAddress: nft, collection })
        : { ok: false, reason: 'no staking contract is configured for this collection' };

    const payload = { ...holdings, collection, nft, staking: staking || null, stake };

    // A failed read is never remembered, so the next request actually tries again.
    return NextResponse.json(holdings.ok ? remember(key, payload) : payload);
}
