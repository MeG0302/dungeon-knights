#!/usr/bin/env node
/**
 * Does the vault read the collection the way the collection actually is?
 *
 *     node tools/check-staking-chain.js
 *
 * The Staking Vault used to show every visitor the same invented knights, and the reason was not
 * laziness — the deployed collection cannot be enumerated, so there was no obvious way to list
 * what a wallet owns. Before that could be worked around, the shape of the problem had to be
 * measured, and measuring it is what most of this file does:
 *
 *     supportsInterface(0x780e9d63)  → false     (not ERC721Enumerable)
 *     totalSupply()                  → reverted
 *     nextTokenId()                  → reverted
 *     tokenOfOwnerByIndex(...)       → reverted
 *
 * Those four are asserted rather than described, because the whole design rests on them. If a
 * future deployment *is* enumerable, the log-based reader becomes unnecessary complexity and
 * this file should be the first thing that says so.
 *
 * The reader then works by asking the `Transfer` logs who was ever sent a token, and confirming
 * each candidate against `getKnightInfo`. Two things about that are worth a test rather than a
 * comment: the ids are **not contiguous** — one real wallet holds 10–13, 22–55 and 67–74 — so any
 * scan that walked ids until it found a gap would report 4 knights for a wallet with 45; and the
 * confirmed count must equal the contract's own `balanceOf`, which is the invariant that catches
 * that whole class of mistake at once.
 *
 * The live phase needs network access. If the RPC cannot be reached it says so and counts the
 * skipped checks **neither way** — a harness that reports green because it could not ask is
 * worse than one that fails.
 */

import { utils } from 'ethers';
import { rpcBatch } from '../lib/game-runs.js';
import { NFT_ENUMERATION, readOwnedKnights } from '../lib/staking-chain.js';
import { RARITY } from '../lib/knights.js';

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}
function skip(label, why) {
    console.log(`  --    ${label}  — skipped: ${why}`);
}
function section(title) {
    console.log('');
    console.log(title);
}

const NFT = process.env.KNIGHTS_NFT_ADDRESS || '0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512';

// A real wallet with real knights, and one with none. Both are public testnet addresses.
const HOLDER = '0x038d75aDb74d8e5Db82E6c6797f90dCdF82ef4C9';
const EMPTY = '0x0000000000000000000000000000000000000001';

const IFACE = new utils.Interface([
    'function supportsInterface(bytes4) view returns (bool)',
    'function totalSupply() view returns (uint256)',
    'function nextTokenId() view returns (uint256)',
    'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
    'function balanceOf(address) view returns (uint256)',
]);

async function probe(fn, args) {
    const [row] = await rpcBatch([{
        method: 'eth_call',
        params: [{ to: NFT, data: IFACE.encodeFunctionData(fn, args) }, 'latest'],
    }]);
    if (row.error) return { reverted: true, message: row.error.message || 'reverted' };
    return { value: IFACE.decodeFunctionResult(fn, row.result)[0] };
}

/** Whether the chain answered at all — the difference between a skip and a failure. */
async function chainReachable() {
    try {
        const [row] = await rpcBatch([{ method: 'eth_blockNumber', params: [] }]);
        return !row.error;
    } catch {
        return false;
    }
}

// -------------------------------------------------------------------------- arguments
section('Arguments');
{
    const bad = await readOwnedKnights('not-an-address');
    rec('a malformed address is refused without asking the chain',
        bad.ok === false && /not a wallet address/i.test(bad.reason), bad.reason);

    const noCollection = await readOwnedKnights(HOLDER, { nftAddress: '' });
    rec('a missing collection is refused with its own reason, not a chain error',
        noCollection.ok === false && /no knight collection/i.test(noCollection.reason), noCollection.reason);

    rec('the measured limits are published, not hidden in a comment',
        NFT_ENUMERATION.enumerable === false && NFT_ENUMERATION.batchMax > 0,
        `enumerable=${NFT_ENUMERATION.enumerable}, batchMax=${NFT_ENUMERATION.batchMax}`);
    rec('and the batch size answers to what the node actually accepts',
        NFT_ENUMERATION.batchMax <= 50,
        `${NFT_ENUMERATION.batchMax} — a batch of 100 comes back HTTP 429`);
}

// --------------------------------------------------------------------------- the chain
const online = await chainReachable();
if (!online) {
    console.log('');
    console.log('The chain could not be reached, so nothing below was measured.');
}

section('The collection, as deployed');
if (online) {
    const enumerable = await probe('supportsInterface', ['0x780e9d63']);
    rec('the collection is NOT ERC721Enumerable — the premise of the whole reader',
        enumerable.value === false, enumerable.reverted ? 'reverted' : String(enumerable.value));

    const erc721 = await probe('supportsInterface', ['0x80ac58cd']);
    rec('but it is a real ERC721', erc721.value === true, String(erc721.value));

    const supply = await probe('totalSupply', []);
    rec('totalSupply does not exist, so the count cannot be asked for', supply.reverted === true);

    const next = await probe('nextTokenId', []);
    rec('there is no mint counter to bound a scan with', next.reverted === true);

    const byIndex = await probe('tokenOfOwnerByIndex', [HOLDER, 0]);
    rec('tokenOfOwnerByIndex reverts, so a wallet cannot be listed',
        byIndex.reverted === true);
} else {
    for (const label of [
        'the collection is NOT ERC721Enumerable — the premise of the whole reader',
        'but it is a real ERC721',
        'totalSupply does not exist, so the count cannot be asked for',
        'there is no mint counter to bound a scan with',
        'tokenOfOwnerByIndex reverts, so a wallet cannot be listed',
    ]) skip(label, 'no chain');
}

section('Reading a wallet');
if (online) {
    const held = await readOwnedKnights(HOLDER);
    rec('a real holder reads successfully', held.ok === true, held.reason || held.note);
    rec('and the confirmed count equals the contract\u2019s own balanceOf',
        held.ok && held.knights.length === held.balance,
        `${held.knights?.length} confirmed vs balanceOf ${held.balance}`);
    rec('so the read is reported as complete', held.complete === true);
    rec('every knight carries its tier, and a hash power from that tier',
        (held.knights || []).every((k) => {
            const tier = Object.entries(RARITY).find(([key]) => key.toLowerCase() === k.rarity)?.[1];
            return tier && tier.hashPower === k.hashPower;
        }), (held.knights || []).slice(0, 3).map((k) => `#${k.tokenId} ${k.tierName} ${k.hashPower}`).join(', '));
    rec('the contract\u2019s own tier names agree with ours', (held.nameMismatches || 0) === 0,
        `${held.nameMismatches} mismatch(es)`);
    rec('ids come back sorted, so the list cannot reshuffle between renders',
        (held.knights || []).every((k, i, all) => i === 0 || all[i - 1].tokenId < k.tokenId));

    // The ids in this collection are not contiguous. A reader that walked ids until it hit a gap
    // would return a short list and still look successful — this is the check that catches it.
    const ids = (held.knights || []).map((k) => k.tokenId);
    const gaps = ids.filter((id, i) => i > 0 && id - ids[i - 1] > 1).length;
    rec('the reader does not assume contiguous ids', ids.length === held.balance,
        `${ids.length} ids with ${gaps} gap(s) between them`);

    // Case must not change the answer: ethers refuses to ABI-encode a bad EIP-55 checksum, so a
    // mixed-case address used to fail as "the chain could not be read" without being read.
    const lower = await readOwnedKnights(HOLDER.toLowerCase());
    rec('a lower-cased address reads the same as the checksummed one',
        lower.ok === true && lower.knights.length === held.knights.length,
        `${lower.knights?.length} vs ${held.knights?.length}`);

    const badCase = await readOwnedKnights(HOLDER.toUpperCase().replace('0X', '0x'));
    rec('and an address with a broken checksum is read rather than blamed on the chain',
        badCase.ok === true && badCase.knights.length === held.knights.length,
        badCase.reason || `${badCase.knights?.length} knight(s)`);

    const none = await readOwnedKnights(EMPTY);
    rec('a wallet with no knights is an empty complete read, not a failure',
        none.ok === true && none.knights.length === 0 && none.complete === true,
        none.note);
} else {
    for (const label of [
        'a real holder reads successfully',
        'and the confirmed count equals the contract\u2019s own balanceOf',
        'so the read is reported as complete',
        'every knight carries its tier, and a hash power from that tier',
        'the contract\u2019s own tier names agree with ours',
        'ids come back sorted, so the list cannot reshuffle between renders',
        'the reader does not assume contiguous ids',
        'a lower-cased address reads the same as the checksummed one',
        'and an address with a broken checksum is read rather than blamed on the chain',
        'a wallet with no knights is an empty complete read, not a failure',
    ]) skip(label, 'no chain');
}

console.log('');
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
for (const f of failed) console.log(`  FAILED: ${f.label}`);
console.log('');
process.exit(failed.length ? 1 : 0);
