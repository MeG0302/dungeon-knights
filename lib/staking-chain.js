/**
 * The Vault's window onto the real collection.
 *
 * The Staking Vault used to show every visitor the same invented knights, because
 * `chainSnapshot()` returned empty holdings and nothing in the staking path ever called a
 * contract. This module is the missing read: it answers "which knights does this wallet own"
 * against the collection actually deployed, so the page can show real ones.
 *
 * ## Why this does not enumerate the contract
 *
 * The deployed collection cannot be enumerated, and that is measured, not assumed:
 *
 *     supportsInterface(0x780e9d63)  → false     (not ERC721Enumerable)
 *     totalSupply()                  → reverted
 *     nextTokenId()                  → reverted
 *     tokenOfOwnerByIndex(...)       → reverted
 *
 * So there is no way to ask the contract for a wallet's tokens. Two ways round it were
 * available and only one of them works:
 *
 *   - **Scan token ids and test each one.** Rejected, and the chain is why. Ids in this
 *     collection are *not* contiguous: one wallet holds 10–13, 22–55 and 67–74. Any scan that
 *     stopped at the first gap would report 4 knights for a wallet with 45, and any scan that
 *     did not stop would need one call per id ever minted, forever.
 *   - **Ask the logs.** `Transfer` is indexed on `to`, so one `eth_getLogs` filtered to the
 *     wallet returns every token it was ever sent — 45 ids in one request, verified against
 *     `balanceOf`'s 45. Cost is independent of collection size.
 *
 * Logs give *candidates*, not holdings: you keep receiving `Transfer`s for tokens you later
 * send away. So ownership is confirmed afterwards with `getKnightInfo`, which also supplies the
 * rarity the page needs, in batches of 50 (100 is refused — see `rpcBatch`).
 *
 * ## What it refuses to claim
 *
 * `complete` is the honest flag, and it means exactly one thing: the confirmed count equals
 * `balanceOf`. When it is false the list on screen is *known to be short*, and the page says so
 * rather than presenting a partial list as the whole. That is the case the interface exists for —
 * an unenumerable contract can produce an incomplete answer, and the only bad outcome is an
 * incomplete answer that looks finished.
 */

import { utils } from 'ethers';
import { ADDRESSES, rpcBatch } from './game-runs.js';
import { RARITY } from './knights.js';
import { ABI } from './staking-writes.js';

// One ABI, two users. The write path and this reader ask the same contracts the same questions,
// and a second copy of the signatures is how a reader ends up decoding a function the contract
// no longer has — a failure that looks like "the chain could not be read".
const STAKING_IFACE = new utils.Interface(ABI.staking);
const GENESIS_IFACE = new utils.Interface(ABI.genesis);

/**
 * How many stakers the draw's pool can be summed over before the page stops trying.
 *
 * Tickets are a per-wallet view function, so the *pool* total is one call per staker — there is
 * no aggregate on chain. 64 is two batches of 50-call chunks, which is the node's measured
 * ceiling; above that the page reports the pool total as unreadable rather than paying for a
 * read that grows with the collection. Genesis is capped at 1,024 stakes, so this is a bound on
 * cost, not a correctness limit: below it the number is exact.
 */
export const POOL_SAMPLE_MAX = 64;

const NFT_IFACE = new utils.Interface([
    'function getKnightInfo(uint256 tokenId) view returns (address owner, uint8 rarity, string rarityName)',
    'function balanceOf(address owner) view returns (uint256)',
    'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
    'function supportsInterface(bytes4 interfaceId) view returns (bool)',
    'function name() view returns (string)',
]);

/** `type(IERC721Enumerable).interfaceId` — how a collection is asked whether it indexes owners. */
const ENUMERABLE_ID = '0x780e9d63';

const TRANSFER_TOPIC = utils.id('Transfer(address,address,uint256)');

/**
 * The measured shape of this collection, published rather than hidden.
 *
 * `batchMax` is 50 because 50 `eth_call`s come back 200 and 100 come back 429 — a ceiling found
 * by asking.
 *
 * `enumerable` is **true**, and it is a fact about the live collection rather than a preference:
 * `contracts/Knights.sol` is `ERC721Enumerable`, so it indexes each owner's tokens and a wallet's
 * knights are `balanceOf` + that many `tokenOfOwnerByIndex` calls. It was false while the first
 * collection was the live one, and that history is why the reader no longer *trusts* this figure:
 * the collection it is reading is asked directly (`supportsInterface(0x780e9d63)`), and this
 * published value is what the harness asserts that answer against. A constant is a claim about an
 * address; the probe is the address answering.
 */
export const NFT_ENUMERATION = {
    enumerable: true,
    batchMax: 50,
    /** Only the fallback path uses this; enumeration needs no block range. */
    defaultFromBlock: 0,
};

/** 18-decimal wei → the number the page prints. Display only; nothing is valued on it. */
function dng(value) {
    try {
        return Number(utils.formatUnits(value ?? 0, 18));
    } catch {
        return 0;
    }
}

/** The tier table, in the contract's enum order — 0=Common … 4=Legendary. */
const TIERS = Object.entries(RARITY).map(([key, tier]) => ({ key: key.toLowerCase(), ...tier }));

/**
 * Every token id this wallet holds, read the way the collection allows.
 *
 * Two paths, chosen by `enumerable` — which is a fact about *this* collection, passed in rather
 * than read from a module constant. That distinction is the whole reason this function survived a
 * collection swap: the live collection is enumerable and the retired one is not, and both are
 * real. An `ERC721Enumerable` collection is asked directly — one `tokenOfOwnerByIndex` per knight,
 * batched — which is both cheaper and *complete*, because the index is maintained by the token
 * itself.
 *
 * The log scan is the fallback for a collection without the extension: it asks for every Transfer
 * the wallet ever received. That is a chain-wide query from `fromBlock: 0` whose cost grows with
 * the collection's entire history, which is exactly why it is not the first choice. An error is
 * thrown rather than returned because the caller can still report something true — "we could not
 * read the logs" — and a thrown error inside a route turns into a blank page instead.
 */
async function candidateIds(address, { nftAddress, fromBlock, balance, enumerable }) {
    if (enumerable) {
        const rows = await rpcBatch(Array.from({ length: Math.max(0, balance) }, (_, index) => ({
            method: 'eth_call',
            params: [{
                to: nftAddress,
                data: NFT_IFACE.encodeFunctionData('tokenOfOwnerByIndex', [address, index]),
            }, 'latest'],
        })));

        const ids = new Set();
        for (const row of rows) {
            if (row.error) throw new Error(`tokenOfOwnerByIndex: ${row.error.message || 'failed'}`);
            ids.add(Number(BigInt(NFT_IFACE.decodeFunctionResult('tokenOfOwnerByIndex', row.result)[0])));
        }
        return [...ids].sort((a, b) => a - b);
    }

    const to = `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
    const [row] = await rpcBatch([{
        method: 'eth_getLogs',
        params: [{
            address: nftAddress,
            fromBlock: `0x${Number(fromBlock).toString(16)}`,
            toBlock: 'latest',
            topics: [TRANSFER_TOPIC, null, to],
        }],
    }]);

    if (row.error) throw new Error(`eth_getLogs: ${row.error.message || 'failed'}`);

    const ids = new Set();
    for (const log of row.result || []) {
        // topic[3] is the indexed tokenId, the only one of the three that is a number.
        if (log.topics?.[3]) ids.add(Number(BigInt(log.topics[3])));
    }
    return [...ids].sort((a, b) => a - b);
}

/**
 * A wallet's knights, read from the collection itself.
 *
 * Never throws for a chain condition: a node that is down or throttling is reported as
 * `ok: false` with a reason, because the page has an honest state for that and a 500 is not it.
 */
export async function readOwnedKnights(address, {
    nftAddress = ADDRESSES.knightNFT,
    fromBlock = NFT_ENUMERATION.defaultFromBlock,
    batchSize = NFT_ENUMERATION.batchMax,
    // `null` means "ask the collection", and that is the default on purpose. The published flag
    // below says what the live collection is; trusting it as the *reader's* switch would be the
    // same mistake in the other direction — a constant that can be wrong about an address it has
    // never met. `supportsInterface(0x780e9d63)` costs one `eth_call` against a read that is
    // already making several, and it makes this function correct on any collection, including a
    // retired one a caller passes in.
    enumerable = null,
} = {}) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(address || ''))) {
        return { ok: false, reason: 'that is not a wallet address' };
    }
    if (!nftAddress) {
        return { ok: false, reason: 'no knight collection is configured for this network' };
    }

    // Lower-cased before it reaches any ABI encoder, and this is not cosmetic. `ethers` refuses
    // to encode an address whose mixed case does not match its EIP-55 checksum — it *throws*
    // rather than reverting — so a wallet address pasted in the wrong case made this function
    // report "the chain could not be read just now". That is a lie about the cause, and the
    // cause was ours: the chain was never asked. Checksums are a display convention; the chain
    // cares about the twenty bytes, so the case is dropped here and nowhere else matters.
    const owner = String(address).toLowerCase();

    let candidates;
    let balance;
    let isEnumerable = enumerable;
    try {
        // Balance and shape together, in one round trip: how much work the read is, and which
        // read it is. A wallet with nothing has an answer already — no per-token calls and no
        // chain-wide log scan — and asking for the ids before knowing the balance is what made
        // an empty wallet look like a failed read.
        const probeEnumerable = enumerable === null;
        const rows = await rpcBatch([
            {
                method: 'eth_call',
                params: [{ to: nftAddress, data: NFT_IFACE.encodeFunctionData('balanceOf', [owner]) }, 'latest'],
            },
            ...(probeEnumerable ? [{
                method: 'eth_call',
                params: [{ to: nftAddress, data: NFT_IFACE.encodeFunctionData('supportsInterface', [ENUMERABLE_ID]) }, 'latest'],
            }] : []),
        ]);
        if (rows[0].error) throw new Error(rows[0].error.message || 'balanceOf failed');
        balance = Number(BigInt(NFT_IFACE.decodeFunctionResult('balanceOf', rows[0].result)[0]));

        if (probeEnumerable) {
            // A collection that does not answer `supportsInterface` cannot be assumed to index
            // anything, so the fallback is the answer rather than an error.
            isEnumerable = rows[1]?.error
                ? false
                : Boolean(NFT_IFACE.decodeFunctionResult('supportsInterface', rows[1].result)[0]);
        }

        candidates = balance === 0
            ? []
            : await candidateIds(owner, { nftAddress, fromBlock, balance, enumerable: isEnumerable });
    } catch (error) {
        console.warn(`[staking-chain] reading ${address} failed: ${error.message || error}`);
        // Separated on purpose. `ethers` reports a bad argument with `INVALID_ARGUMENT`, and that
        // is our bug or our input — never the chain's — so it must not be answered with the same
        // sentence as a node that is down. Getting this wrong is what hid the checksum fault.
        const ourFault = error?.code === 'INVALID_ARGUMENT';
        return {
            ok: false,
            reason: ourFault
                ? 'that wallet address could not be read'
                : 'the chain could not be read just now',
        };
    }

    // Nothing to confirm — and worth returning before the batched call, since a wallet with no
    // transfers is the common case and an empty batch is not a valid request.
    if (!candidates.length) {
        return {
            ok: true,
            knights: [],
            candidates: 0,
            balance,
            complete: balance === 0,
            enumerable: isEnumerable,
            fromBlock,
            note: balance === 0
                ? 'This wallet holds no knights.'
                : `This wallet reports ${balance} knight(s), but the collection's transfer logs show none — the logs and the balance disagree, so read this as incomplete.`,
        };
    }

    const size = Math.max(1, Math.min(batchSize, NFT_ENUMERATION.batchMax));
    const knights = [];
    let mismatchedName = 0;

    for (let start = 0; start < candidates.length; start += size) {
        const chunk = candidates.slice(start, start + size);
        let rows;
        try {
            rows = await rpcBatch(chunk.map((tokenId) => ({
                method: 'eth_call',
                params: [{
                    to: nftAddress,
                    data: NFT_IFACE.encodeFunctionData('getKnightInfo', [tokenId]),
                }, 'latest'],
            })));
        } catch (error) {
            // A partial read is still a true read of the ids already confirmed, but it is not
            // the wallet's holdings — so it is reported as a failure, not as a shorter list.
            console.warn(`[staking-chain] knights ${chunk[0]}…${chunk[chunk.length - 1]} failed: ${error.message || error}`);
            return { ok: false, reason: 'the chain could not be read just now' };
        }

        chunk.forEach((tokenId, index) => {
            const row = rows[index];
            // A revert here means the token does not exist — for a log-derived candidate that
            // should not happen, so it is skipped rather than counted.
            if (!row || row.error) return;

            let transferOwner;
            let rarity;
            let onChainName;
            try {
                [transferOwner, rarity, onChainName] = NFT_IFACE.decodeFunctionResult('getKnightInfo', row.result);
            } catch {
                return;
            }

            // The candidate may have been sent on since it was received.
            if (String(transferOwner).toLowerCase() !== owner) return;

            const tier = TIERS[Number(rarity)];
            if (!tier) return;
            // The contract names the tier itself. When that disagrees with our table the table is
            // what is wrong, so the disagreement is surfaced instead of being papered over.
            if (String(onChainName).toLowerCase() !== tier.name.toLowerCase()) mismatchedName++;

            knights.push({
                tokenId,
                name: `${tier.name} Knight #${tokenId}`,
                rarity: tier.key,
                tierName: tier.name,
                hashPower: tier.hashPower,
            });
        });
    }

    knights.sort((a, b) => a.tokenId - b.tokenId);
    const complete = knights.length === balance;

    return {
        ok: true,
        knights,
        candidates: candidates.length,
        balance,
        complete,
        enumerable: isEnumerable,
        fromBlock,
        nameMismatches: mismatchedName,
        // Two different reasons a list can be short, and they are not interchangeable. A
        // non-enumerable collection is a known limit of the token; an enumerable one that
        // disagrees with its own index is a fault, and the wording should not let one read as the
        // other.
        note: complete
            ? `Read ${knights.length} knight(s) straight from the collection.`
            : (isEnumerable
                ? `The contract reports ${balance} owned but its own owner index returned ${knights.length}. Treat this list as incomplete, and read it as a fault rather than a limit.`
                : `The collection is not enumerable: ${knights.length} knight(s) were confirmed but the contract reports ${balance} owned. Treat this list as incomplete.`),
    };
}

/**
 * What a wallet actually has staked, read from the pool itself.
 *
 * This is the half of the vault that a collection read can never answer, and after a stake is
 * real it is the more important half: **a staked knight is not in its owner's wallet.** The pool
 * holds it, so `ownerOf` returns the pool, `balanceOf` drops by one, and a page that only reads
 * the collection shows a knight that vanished the moment it started earning. The pool publishes
 * `stakedTokens(wallet)` for exactly this, and `stakes(tokenId)` carries the hash power and the
 * instant it went in — which is all the interface needs to price it.
 *
 * Three readings are deliberately separate, because they fail separately:
 *
 *   - **the positions** — which knights, their hash power and when they went in.
 *   - **the money** — `claimable` (settled, unpaid), `pending` (accrued, unsettled) and
 *     `claimableNow` (what `claim()` would pay after this week's line). Three numbers because
 *     they answer three different questions, and the contract offers all three.
 *   - **the tickets** — Genesis only. `ticketsThisWeek` is the wallet's real ticket count, and
 *     the pool total needs one call per staker, so it is read only while the pool is small
 *     enough to be cheap (`POOL_SAMPLE_MAX`) and reported as unreadable above that rather than
 *     guessed.
 *
 * Never throws for a chain condition, like `readOwnedKnights`: a node that is down is `ok: false`
 * with a reason, because the page has an honest sentence for that and a 500 is not it.
 */
export async function readStakeState(address, {
    staking,
    nftAddress = null,
    collection = 'knights',
    batchSize = NFT_ENUMERATION.batchMax,
    poolSampleMax = POOL_SAMPLE_MAX,
} = {}) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(address || ''))) {
        return { ok: false, reason: 'that is not a wallet address' };
    }
    if (!staking) return { ok: false, reason: 'no staking contract is configured for this collection' };

    // Lower-cased for the same reason as the collection read: `ethers` refuses to ABI-encode an
    // address whose mixed case is not its EIP-55 checksum, and it *throws* rather than reverting,
    // which turns our input problem into "the chain could not be read".
    const owner = String(address).toLowerCase();
    const isGenesis = collection === 'genesis';

    /** Encode one staking read. */
    const stakingCall = (fn, args) => ({
        method: 'eth_call',
        params: [{ to: staking, data: STAKING_IFACE.encodeFunctionData(fn, args) }, 'latest'],
    });

    const overview = [
        ['stakedTokens', stakingCall('stakedTokens', [owner])],
        ['totalHashPower', stakingCall('totalHashPower', [])],
        ['ratePerDay', stakingCall('ratePerDay', [])],
        ['vaultState', stakingCall('vaultState', [])],
        ['claimable', stakingCall('claimable', [owner])],
        ['pending', stakingCall('pending', [owner])],
        ['claimableNow', stakingCall('claimableNow', [owner])],
    ];
    if (isGenesis) {
        overview.push(
            ['ticketsThisWeek', {
                method: 'eth_call',
                params: [{ to: staking, data: GENESIS_IFACE.encodeFunctionData('ticketsThisWeek', [owner]) }, 'latest'],
            }],
            ['stakerCount', {
                method: 'eth_call',
                params: [{ to: staking, data: GENESIS_IFACE.encodeFunctionData('stakerCount', []) }, 'latest'],
            }],
        );
    }

    let rows;
    try {
        rows = await rpcBatch(overview.map(([, request]) => request));
    } catch (error) {
        console.warn(`[staking-chain] stake overview for ${address} failed: ${error.message || error}`);
        return { ok: false, reason: 'the chain could not be read just now' };
    }

    const read = {};
    overview.forEach(([name], index) => { read[name] = rows[index]; });

    // The one call that has to succeed, because every other number below is about the positions it
    // returns. An error here is a real failure; a missing row is treated the same way.
    if (!read.stakedTokens || read.stakedTokens.error) {
        return { ok: false, reason: 'the chain could not be read just now' };
    }

    let tokenIds = [];
    try {
        [tokenIds] = STAKING_IFACE.decodeFunctionResult('stakedTokens', read.stakedTokens.result);
        tokenIds = [...tokenIds].map(Number);
    } catch (error) {
        console.warn(`[staking-chain] stakedTokens could not be decoded: ${error.message || error}`);
        return { ok: false, reason: 'the chain could not be read just now' };
    }

    // Each position, plus the tier of each one on the Knights side. `stakes` carries the hash
    // power, so Genesis needs no second call — its band is derivable from the power itself — while
    // a Knight is *named* by the tier it was minted at, which lives on the collection.
    const size = Math.max(1, Math.min(batchSize, NFT_ENUMERATION.batchMax));
    const staked = [];
    let positionsFailed = false;

    for (let start = 0; start < tokenIds.length; start += size) {
        const ids = tokenIds.slice(start, start + size);
        const requests = ids.map((tokenId) => ({
            method: 'eth_call',
            params: [{ to: staking, data: STAKING_IFACE.encodeFunctionData('stakes', [tokenId]) }, 'latest'],
        }));
        if (!isGenesis && nftAddress) {
            for (const tokenId of ids) {
                requests.push({
                    method: 'eth_call',
                    params: [{
                        to: nftAddress,
                        data: NFT_IFACE.encodeFunctionData('getKnightInfo', [tokenId]),
                    }, 'latest'],
                });
            }
        }

        let positionRows;
        try {
            positionRows = await rpcBatch(requests);
        } catch (error) {
            console.warn(`[staking-chain] staked positions ${ids[0]}…${ids[ids.length - 1]} failed: ${error.message || error}`);
            positionsFailed = true;
            break;
        }

        for (let i = 0; i < ids.length; i++) {
            const tokenId = ids[i];
            const row = positionRows[i];
            if (!row || row.error) continue;

            let hp;
            let stakedAt;
            let staker;
            try {
                [hp, stakedAt, staker] = STAKING_IFACE.decodeFunctionResult('stakes', row.result);
            } catch {
                continue;
            }

            // A token id in the wallet's list whose stake is empty means the two disagree. The
            // list is the pool's own, so this should not happen — and skipping it is better than
            // showing a knight with zero hash power that the contract would refuse to unstake.
            if (Number(hp) === 0) continue;

            const knight = {
                tokenId,
                hashPower: Number(hp),
                stakedAt: Number(stakedAt) * 1000,
                staker: String(staker || '').toLowerCase(),
                // The name the *collection* would give it. For Genesis the bands are derived from
                // the power; for a Knight the tier is read, because 45 HP is only "Epic" if the
                // collection says so.
                name: `Genesis #${String(tokenId).padStart(3, '0')}`,
            };

            if (!isGenesis && nftAddress) {
                const tierRow = positionRows[ids.length + i];
                if (tierRow && !tierRow.error) {
                    try {
                        const [, rarity, onChainName] = NFT_IFACE.decodeFunctionResult('getKnightInfo', tierRow.result);
                        const tier = TIERS[Number(rarity)];
                        if (tier) {
                            knight.rarity = tier.key;
                            knight.tierName = tier.name;
                            knight.name = `${tier.name} Knight #${tokenId}`;
                        }
                        if (onChainName) knight.collectionName = String(onChainName);
                    } catch {
                        // Left with the hash power and the id, which are still true.
                    }
                }
            }

            staked.push(knight);
        }
    }

    staked.sort((a, b) => a.tokenId - b.tokenId);

    /** A single uint256/uint16 read, or `null` when the node refused it. */
    const scalar = (name, decode = 'uint256') => {
        const row = read[name];
        if (!row || row.error) return null;
        try {
            const [value] = STAKING_IFACE.decodeFunctionResult(name, row.result);
            return value === null || value === undefined ? null : value;
        } catch {
            return null;
        }
    };

    let vault = null;
    if (read.vaultState && !read.vaultState.error) {
        try {
            const [lineBudget, lineRemaining, scaleBps] = STAKING_IFACE.decodeFunctionResult('vaultState', read.vaultState.result);
            vault = {
                lineBudget: dng(lineBudget),
                lineRemaining: dng(lineRemaining),
                scaleBps: Number(scaleBps),
            };
        } catch {
            vault = null;
        }
    }

    let tickets = null;
    if (isGenesis) {
        let mine = null;
        const row = read.ticketsThisWeek;
        if (row && !row.error) {
            try {
                const [value] = GENESIS_IFACE.decodeFunctionResult('ticketsThisWeek', row.result);
                mine = Number(value);
            } catch {
                mine = null;
            }
        }

        // The pool total is the sum over stakers, and there is no aggregate to ask for. Small
        // pools are read exactly; a large one is reported unknown, because a wrong denominator
        // turns every share on the page into a wrong number that looks precise.
        let stakerCount = null;
        if (read.stakerCount && !read.stakerCount.error) {
            try {
                const [value] = GENESIS_IFACE.decodeFunctionResult('stakerCount', read.stakerCount.result);
                stakerCount = Number(value);
            } catch {
                stakerCount = null;
            }
        }

        let poolTotal = null;
        if (stakerCount === 0) {
            poolTotal = 0;
        } else if (stakerCount !== null && stakerCount <= poolSampleMax) {
            try {
                const stakerRows = await rpcBatch(Array.from({ length: stakerCount }, (_, index) => ({
                    method: 'eth_call',
                    params: [{
                        to: staking,
                        data: GENESIS_IFACE.encodeFunctionData('stakerAt', [index]),
                    }, 'latest'],
                })));

                const wallets = [];
                for (const entry of stakerRows) {
                    if (!entry || entry.error) continue;
                    try {
                        const [wallet] = GENESIS_IFACE.decodeFunctionResult('stakerAt', entry.result);
                        wallets.push(wallet);
                    } catch {
                        // Skipped: a missing staker under-counts the pool, which is why the read is
                        // only trusted while the registry is small.
                    }
                }

                const ticketRows = await rpcBatch(wallets.map((wallet) => ({
                    method: 'eth_call',
                    params: [{
                        to: staking,
                        data: GENESIS_IFACE.encodeFunctionData('ticketsThisWeek', [wallet]),
                    }, 'latest'],
                })));

                poolTotal = 0;
                ticketRows.forEach((entry, index) => {
                    if (!entry || entry.error) return;
                    try {
                        const [value] = GENESIS_IFACE.decodeFunctionResult('ticketsThisWeek', entry.result);
                        poolTotal += Number(value);
                    } catch {
                        // Same as above: an unread staker makes the total short, and a short total
                        // is only acceptable because this path is bounded and checked per wallet.
                    }
                });
                if (wallets.length !== stakerCount) poolTotal = null;
            } catch (error) {
                console.warn(`[staking-chain] the ticket pool could not be summed: ${error.message || error}`);
                poolTotal = null;
            }
        }

        tickets = {
            mine,
            poolTotal,
            stakerCount,
            // Why the pool total is missing, in words the page can print.
            poolReason: poolTotal === null
                ? (stakerCount === null
                    ? 'the pool could not be read just now'
                    : `${stakerCount} stakers is more than this page reads in one pass, so the pool total is not shown`)
                : null,
        };
    }

    return {
        ok: true,
        staking,
        collection,
        staked,
        // `stakedTokens` returned these ids; if a position below could not be read the list on
        // screen is short, and that is said rather than silently trimmed.
        complete: !positionsFailed && staked.length === tokenIds.length,
        positions: tokenIds.length,
        // `null`, not 0, when the read failed. The pool's total weight is the **denominator** of
        // every share the page shows, and a failed read reported as zero turns the wallet into the
        // only staker in a pool it is one of many in — the most flattering possible lie about a
        // yield split. A missing denominator has to stay missing.
        totalHashPower: read.totalHashPower && !read.totalHashPower.error
            ? Number(scalar('totalHashPower') ?? 0)
            : null,
        ratePerDay: read.ratePerDay && !read.ratePerDay.error ? dng(scalar('ratePerDay')) : null,
        vault,
        // Three money readings, in DNG. `claimable` is already settled, `pending` includes what
        // is still accruing, and `claimableNow` is what the next `claim()` would actually pay.
        claim: {
            settled: dng(scalar('claimable')),
            pending: dng(scalar('pending')),
            payable: read.claimableNow && !read.claimableNow.error ? dng(scalar('claimableNow')) : null,
        },
        tickets,
        note: positionsFailed
            ? 'Some staked positions could not be read, so this list is short.'
            : null,
    };
}
