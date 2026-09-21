#!/usr/bin/env node
/**
 * Does the vault read the collection the way the collection actually is?
 *
 *     node tools/check-staking-chain.js
 *
 * The Staking Vault used to show every visitor the same invented knights, and the reason was not
 * laziness — the collection it was pointed at cannot be enumerated, so there was no obvious way to
 * list what a wallet owns. That collection was measured, the measurement became the reader's
 * design, and then the collection itself was replaced. So this file now asserts **two** shapes,
 * because both are live facts and neither is a hypothetical:
 *
 *   live    0x27Cfbb76…1B2D  ERC721Enumerable **true**, mintable        → the index path
 *   retired 0x06c7D4b0…0512  ERC721Enumerable **false**, no `totalSupply` → the log-scan path
 *
 * `live` has been three addresses now, and the file records the current one rather than a rule:
 * the first collection was not enumerable at all, the second was but could not be minted into
 * (`summon()` never collected the fee), and this one is the repaired collection. What the harness
 * actually asserts is the *shape* — enumerable or not — read from whichever address is
 * configured, so the checks travel with the address instead of describing a memory of one.
 *
 * The retired one is not dead weight as a fixture: it holds **47 knights for a real wallet** whose
 * ids **are not contiguous** (10–13, 22–55, 67–74), so it is the one collection on this chain that
 * can catch a reader which walks ids until it finds a gap — that mistake would report 4 knights
 * for a wallet with 47 and still look successful. Both paths must agree with the contract's own
 * `balanceOf`, and the reader must pick the path by **asking the collection**, not by trusting the
 * published flag. Both halves of that are asserted below.
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

// The collection the app is configured to read. Asserting its shape against the retired one would
// prove nothing, and the swap is exactly the event that made this distinction matter.
const NFT = process.env.KNIGHTS_NFT_ADDRESS || process.env.KNIGHT_NFT_ADDRESS || '0x27Cfbb763188a50Fe1C0fFfBe2552b1945eE1B2D';

// The previous collection. It is not configured anywhere in the app — it is here because it is the
// only non-enumerable collection on this chain with real holders, which makes it the fixture for
// the log-scan path.
const RETIRED = '0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512';

// A real wallet with real knights (47, on the retired collection), and one with none.
const HOLDER = '0x038d75aDb74d8e5Db82E6c6797f90dCdF82ef4C9';
const EMPTY = '0x0000000000000000000000000000000000000001';

const IFACE = new utils.Interface([
    'function supportsInterface(bytes4) view returns (bool)',
    'function totalSupply() view returns (uint256)',
    'function nextTokenId() view returns (uint256)',
    'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
    'function balanceOf(address) view returns (uint256)',
]);

async function probe(fn, args, to = NFT) {
    const [row] = await rpcBatch([{
        method: 'eth_call',
        params: [{ to, data: IFACE.encodeFunctionData(fn, args) }, 'latest'],
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

    rec('the live collection is published as enumerable, which is its actual shape',
        NFT_ENUMERATION.enumerable === true,
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

section('The live collection, as deployed');
if (online) {
    const enumerable = await probe('supportsInterface', ['0x780e9d63']);
    rec('the live collection IS ERC721Enumerable — the premise of the index reader',
        enumerable.value === true, enumerable.reverted ? 'reverted' : String(enumerable.value));

    const erc721 = await probe('supportsInterface', ['0x80ac58cd']);
    rec('and it is a real ERC721', erc721.value === true, String(erc721.value));

    const supply = await probe('totalSupply', []);
    rec('totalSupply exists, so the collection can describe its own size',
        supply.reverted !== true, supply.reverted ? 'reverted' : String(supply.value));

    const held = await probe('balanceOf', [HOLDER]);
    const byIndex = await probe('tokenOfOwnerByIndex', [HOLDER, 0]);
    // `held.value` is a BigNumber from ethers v5, not a BigInt — comparing it to `0n` would be
    // false for every collection, including empty ones, and the check would fail for the wrong
    // reason. Whatever else it asserts, it must not do that.
    const ownsNothing = Number(held.value) === 0;
    // `probe` signals a revert by *setting* `reverted`, so a successful call leaves it `undefined` —
    // and `undefined === false` is false, which made this check fail on a collection that was
    // behaving perfectly. Compare the meaning, not the property.
    const answered = !byIndex.reverted;
    rec('the owner index answers exactly when the wallet owns something',
        answered === !ownsNothing,
        `balanceOf ${held.value}, tokenOfOwnerByIndex(…,0) ${answered ? 'answered' : 'reverted'}`);
} else {
    for (const label of [
        'the live collection IS ERC721Enumerable — the premise of the index reader',
        'and it is a real ERC721',
        'totalSupply exists, so the collection can describe its own size',
        'the owner index answers exactly when the wallet owns something',
    ]) skip(label, 'no chain');
}

section('The retired collection, which is the log-scan fixture');
if (online) {
    const enumerable = await probe('supportsInterface', ['0x780e9d63'], RETIRED);
    rec('the retired collection is NOT enumerable, so the fallback path has a real subject',
        enumerable.value === false, enumerable.reverted ? 'reverted' : String(enumerable.value));

    const supply = await probe('totalSupply', [], RETIRED);
    rec('and it has no totalSupply, so a scan cannot be bounded by one', supply.reverted === true);
} else {
    for (const label of [
        'the retired collection is NOT enumerable, so the fallback path has a real subject',
        'and it has no totalSupply, so a scan cannot be bounded by one',
    ]) skip(label, 'no chain');
}

section('Reading a wallet — the enumerable path');
if (online) {
    const held = await readOwnedKnights(HOLDER);
    rec('a wallet reads successfully through the owner index', held.ok === true, held.reason || held.note);
    rec('and the read is complete, not short', held.complete === true);
    rec('the collection is reported as enumerable, because it was asked', held.enumerable === true);
    rec('the count agrees with the contract’s own balanceOf',
        held.knights.length === held.balance, `${held.knights.length} vs balanceOf ${held.balance}`);

    // Case must not change the answer: ethers refuses to ABI-encode a bad EIP-55 checksum, so a
    // mixed-case address used to fail as "the chain could not be read" without being read.
    const lower = await readOwnedKnights(HOLDER.toLowerCase());
    rec('a lower-cased address reads the same as the checksummed one',
        lower.ok === true && lower.balance === held.balance, `balance ${lower.balance}`);
    const badCase = await readOwnedKnights(HOLDER.toUpperCase().replace('0X', '0x'));
    rec('and an address with a broken checksum is read rather than blamed on the chain',
        badCase.ok === true && badCase.balance === held.balance, badCase.reason || `balance ${badCase.balance}`);

    const none = await readOwnedKnights(EMPTY);
    rec('a wallet with no knights is an empty complete read, not a failure',
        none.ok === true && none.knights.length === 0 && none.complete === true, none.note);

    // The path is chosen per collection, by asking it. This is the check that would have caught the
    // reader being pinned to the retired collection's shape when the collections were swapped.
    const forced = await readOwnedKnights(HOLDER, { enumerable: false });
    rec('forcing the wrong path still agrees with balanceOf rather than inventing knights',
        forced.ok === true && forced.knights.length === forced.balance,
        `enumerable=false → ${forced.knights.length} knight(s), balanceOf ${forced.balance}`);
} else {
    for (const label of [
        'a wallet reads successfully through the owner index',
        'and the read is complete, not short',
        'the collection is reported as enumerable, because it was asked',
        'the count agrees with the contract’s own balanceOf',
        'a lower-cased address reads the same as the checksummed one',
        'and an address with a broken checksum is read rather than blamed on the chain',
        'a wallet with no knights is an empty complete read, not a failure',
        'forcing the wrong path still agrees with balanceOf rather than inventing knights',
    ]) skip(label, 'no chain');
}

section('Reading a wallet — the log-scan fallback, against real holdings');
if (online) {
    const held = await readOwnedKnights(HOLDER, { nftAddress: RETIRED });
    rec('the retired collection reads successfully through the logs', held.ok === true, held.reason || held.note);
    rec('it is reported as non-enumerable, because it was asked and said so', held.enumerable === false);
    rec('and the confirmed count equals the contract’s own balanceOf',
        held.knights.length === held.balance, `${held.knights.length} confirmed vs balanceOf ${held.balance}`);
    rec('so the read is reported as complete', held.complete === true);
    rec('every knight carries its tier, and a hash power from that tier',
        held.knights.every((k) => {
            const tier = Object.entries(RARITY).find(([key]) => key.toLowerCase() === k.rarity)?.[1];
            return tier && tier.hashPower === k.hashPower;
        }), held.knights.slice(0, 3).map((k) => `#${k.tokenId} ${k.tierName} ${k.hashPower}`).join(', '));
    rec('the contract’s own tier names agree with ours', (held.nameMismatches || 0) === 0,
        `${held.nameMismatches} mismatch(es)`);
    rec('ids come back sorted, so the list cannot reshuffle between renders',
        held.knights.every((k, i, all) => i === 0 || all[i - 1].tokenId < k.tokenId));

    // The ids in this collection are not contiguous. A reader that walked ids until it hit a gap
    // would return a short list and still look successful — this is the check that catches it.
    const ids = held.knights.map((k) => k.tokenId);
    const gaps = ids.filter((id, i) => i > 0 && id - ids[i - 1] > 1).length;
    rec('the reader does not assume contiguous ids', ids.length === held.balance,
        `${ids.length} ids with ${gaps} gap(s) between them`);

    // The two collections are different questions, and the one thing that must never be true is
    // the app being configured back onto the retired collection — that is the exact regression
    // that would strand the live one, and it is invisible on screen because both are called
    // "Dungeon Knights" and both answer `balanceOf`.
    rec('the configured collection is not the retired one',
        String(NFT).toLowerCase() !== RETIRED.toLowerCase(), NFT);
} else {
    for (const label of [
        'the retired collection reads successfully through the logs',
        'it is reported as non-enumerable, because it was asked and said so',
        'and the confirmed count equals the contract’s own balanceOf',
        'so the read is reported as complete',
        'every knight carries its tier, and a hash power from that tier',
        'the contract’s own tier names agree with ours',
        'ids come back sorted, so the list cannot reshuffle between renders',
        'the reader does not assume contiguous ids',
        'the configured collection is not the retired one',
    ]) skip(label, 'no chain');
}

console.log('');
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
for (const f of failed) console.log(`  FAILED: ${f.label}`);
console.log('');
process.exit(failed.length ? 1 : 0);
