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

const NFT_IFACE = new utils.Interface([
    'function getKnightInfo(uint256 tokenId) view returns (address owner, uint8 rarity, string rarityName)',
    'function balanceOf(address owner) view returns (uint256)',
    'function name() view returns (string)',
]);

const TRANSFER_TOPIC = utils.id('Transfer(address,address,uint256)');

/**
 * The measured shape of this collection, published rather than hidden.
 *
 * `batchMax` is 50 because 50 `eth_call`s come back 200 and 100 come back 429 — a ceiling found
 * by asking. `enumerable` is false and the page repeats that to the player, because it is the
 * reason an owner list can be incomplete at all.
 */
export const NFT_ENUMERATION = {
    enumerable: false,
    batchMax: 50,
    /** No deploy block is needed at this size, but a busier chain should set one. */
    defaultFromBlock: 0,
};

/** The tier table, in the contract's enum order — 0=Common … 4=Legendary. */
const TIERS = Object.entries(RARITY).map(([key, tier]) => ({ key: key.toLowerCase(), ...tier }));

/**
 * Every token id this wallet has ever been sent.
 *
 * `fromBlock: 0` is a chain-wide scan; it is one request here and the collection is small, so it
 * is left as the default until a deploy block is worth configuring. An error is returned rather
 * than thrown because the caller can still report something true — "we could not read the logs" —
 * and a thrown error inside a route turns into a blank page instead.
 */
async function candidateIds(address, { nftAddress, fromBlock }) {
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
    try {
        candidates = await candidateIds(owner, { nftAddress, fromBlock });
        const [balanceRow] = await rpcBatch([{
            method: 'eth_call',
            params: [{ to: nftAddress, data: NFT_IFACE.encodeFunctionData('balanceOf', [owner]) }, 'latest'],
        }]);
        if (balanceRow.error) throw new Error(balanceRow.error.message || 'balanceOf failed');
        balance = Number(BigInt(NFT_IFACE.decodeFunctionResult('balanceOf', balanceRow.result)[0]));
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
            enumerable: NFT_ENUMERATION.enumerable,
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
        enumerable: NFT_ENUMERATION.enumerable,
        fromBlock,
        nameMismatches: mismatchedName,
        note: complete
            ? `Read ${knights.length} knight(s) straight from the collection.`
            : `The collection is not enumerable: ${knights.length} knight(s) were confirmed but the contract reports ${balance} owned. Treat this list as incomplete.`,
    };
}
