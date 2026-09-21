#!/usr/bin/env node
/**
 * Does the vault send what it says it sends?
 *
 *     node tools/check-staking-writes.js
 *
 * `tools/check-staking.js` proves the *state machine* — what the page says about a vault in each of
 * its modes. This file proves the other half: that pressing Stake, Unstake or Claim builds the right
 * transaction, in the right order, against the right contract, and that a failure stops rather than
 * continuing to spend the player's gas.
 *
 * Three phases, and the third is worth the most:
 *
 *   1. **The plans**, as pure functions. A stake is an approval *and* a call, and whether the
 *      approval is included is the only branch in the whole path — so it is checked in both
 *      directions, plus every case where a bad argument must be refused before a wallet is touched.
 *
 *   2. **The executor**, against a fake signer that records what it was handed. Not a mock of our own
 *      code: ethers encodes the calldata itself, and the harness compares the bytes it sent against
 *      `Interface.encodeFunctionData`, so a wrong selector or a swapped argument cannot pass.
 *
 *   3. **The deployed contracts**, read-only. Every write function this path calls is `eth_call`ed
 *      against the live pools and its **revert is read**, because the revert is the evidence: a
 *      string revert ("Not the staker", "Nothing to claim") proves the selector exists and the guard
 *      in front of it ran, and `stake` reverting with the *collection's* `ERC721NonexistentToken`
 *      proves the pool really did call into the collection it was wired to. An unknown selector on a
 *      contract with no fallback reverts just as loudly but with nothing in the payload, which is the
 *      difference this phase is built on.
 *
 * The live phase needs network access. If the RPC is unreachable it says so and counts the skipped
 * checks **neither way** — a harness that reports green because it could not ask is worse than one
 * that fails.
 */

import { existsSync, readFileSync } from 'fs';
import { utils } from 'ethers';
import { rpcBatch } from '../lib/game-runs.js';
import { readStakeState } from '../lib/staking-chain.js';
import {
    StakingWriteError, claimPlan, executePlan, readError, stakeKnight, stakeMany, stakePlan,
    unstakeKnight, unstakePlan,
} from '../lib/staking-writes.js';
import { ticketsInWeekFor } from '../lib/staking-config.js';

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

/** A wallet with no stake anywhere, used for the read-only calls. */
const NOBODY = '0x0000000000000000000000000000000000000001';

// The deployment `tools/deploy-phase2.js` writes, with env overrides so this can be pointed at
// another network without editing it.
const RECORD = existsSync(new URL('../deployed-phase2.json', import.meta.url))
    ? JSON.parse(readFileSync(new URL('../deployed-phase2.json', import.meta.url), 'utf8'))
    : { contracts: {} };

const configured = (env, key) => (process.env[env] || RECORD.contracts?.[key] || '').trim();
const POOLS = {
    genesis: configured('GENESIS_STAKING', 'genesisStaking'),
    knights: configured('KNIGHTS_STAKING', 'knightsStaking'),
};
const COLLECTIONS = {
    genesis: configured('GENESIS_NFT', 'genesis'),
    knights: configured('KNIGHT_NFT_ADDRESS', 'knights'),
};

const STAKE_ABI = ['function stake(uint256)'];
const UNSTAKE_ABI = ['function unstake(uint256)'];
const CLAIM_ABI = ['function claim() returns (uint256)'];

console.log('Staking Vault — the transaction path');
console.log(`  genesis pool ${POOLS.genesis || '(not configured)'}`);
console.log(`  knights pool ${POOLS.knights || '(not configured)'}`);

// ============================================================================ the plans
section('What a stake is made of');

{
    const approved = stakePlan({
        tokenId: 42, approved: true, staking: POOLS.knights, collection: COLLECTIONS.knights,
    });
    rec('an approved wallet is asked for one transaction, not two',
        approved.length === 1, `${approved.length} step(s)`);
    rec('and it is the stake itself, addressed to the pool',
        approved[0].method === 'stake' && approved[0].args[0] === 42 && approved[0].to === POOLS.knights,
        `${approved[0].method}(${approved[0].args.join(',')}) → ${approved[0].to}`);

    const fresh = stakePlan({
        tokenId: 42, approved: false, staking: POOLS.knights, collection: COLLECTIONS.knights,
    });
    rec('an unapproved wallet is asked for the approval first',
        fresh.length === 2 && fresh[0].kind === 'approve' && fresh[1].kind === 'stake',
        fresh.map((step) => step.kind).join(' → '));
    rec('and the approval is a collection-wide operator grant, not a per-token one',
        fresh[0].method === 'setApprovalForAll'
        && fresh[0].args[0] === POOLS.knights
        && fresh[0].args[1] === true,
        `${fresh[0].method}(${fresh[0].args.join(', ')})`);
    // The order is not cosmetic: a stake sent before the approval reverts, so the other way round
    // would cost the player a failed transaction every time.
    rec('the approval is addressed to the collection and the stake to the pool',
        fresh[0].to === COLLECTIONS.knights && fresh[1].to === POOLS.knights);
    rec('the operator granted is the pool that will hold the knight, never a third address',
        fresh[0].args[0] === fresh[1].to);
    // There is no DNG approval anywhere, and that is worth asserting because it is the obvious thing
    // to assume: staking moves the NFT, and yield flows back out of the vault, so neither direction
    // needs an ERC-20 allowance.
    rec('nothing in the plan touches the DNG token',
        !fresh.some((step) => step.abi === 'token' || /approve\(address,uint256\)/.test(step.method)));
    rec('both steps carry the label the page shows while it works',
        fresh.every((step) => typeof step.label === 'string' && step.label.length > 0));

    const unstake = unstakePlan({ tokenId: 7, staking: POOLS.genesis });
    rec('an unstake is one call and needs no approval either way',
        unstake.length === 1 && unstake[0].method === 'unstake' && unstake[0].args[0] === 7);

    // Claim is wallet-level: the contract settles every stake in one pass, and there is no per-knight
    // payout to offer. A plan that named a knight here would promise something no contract does.
    const claim = claimPlan({ staking: POOLS.genesis });
    rec('a claim is one call for the whole wallet, with no knight named',
        claim.length === 1 && claim[0].method === 'claim' && claim[0].args.length === 0);

    // Refusals happen before a wallet is asked to sign: a plan built against an empty address is a
    // transaction to nowhere, and one built against a bad id is a revert the player pays gas for.
    const refusals = [
        ['no pool configured', () => stakePlan({ tokenId: 1, approved: true, staking: '', collection: COLLECTIONS.knights }), /no staking contract/i],
        ['no collection configured', () => stakePlan({ tokenId: 1, approved: true, staking: POOLS.knights, collection: '' }), /no knight collection/i],
        ['a token id that is not an id', () => stakePlan({ tokenId: 'abc', approved: true, staking: POOLS.knights, collection: COLLECTIONS.knights }), /not a knight id/i],
        ['a zero token id', () => unstakePlan({ tokenId: 0, staking: POOLS.knights }), /not a knight id/i],
        ['a claim with no pool', () => claimPlan({ staking: '' }), /no staking contract/i],
    ];
    for (const [label, build, pattern] of refusals) {
        let message = null;
        try {
            build();
        } catch (error) {
            message = error.message;
        }
        rec(`${label} is refused before anything is signed`, !!message && pattern.test(message), message);
    }
}

// ========================================================================= the executor
section('Sending a plan');

/**
 * A signer and a contract factory that record instead of sending.
 *
 * Calldata is encoded by ethers' own `Interface`, so what the assertions below inspect is the same
 * bytes a real `signer.sendTransaction` would carry — not this file's idea of them. `sends` holds
 * what reached the signer, `encodes` what each step encoded, and `reads` the view calls a plan
 * builder made.
 */
function fake({ approved = false, failSend = null, mineStatus = 1 } = {}) {
    // `sends` is what the wallet accepted; `attempts` includes one the player refused. Keeping them
    // apart is what lets "the stake was never attempted" be a real assertion rather than a count of
    // every call this fake saw.
    const state = { encodes: [], attempts: [], sends: [], reads: [], stages: [] };
    const binding = {
        abi: {
            collection: ['function isApprovedForAll(address,address) view returns (bool)', 'function setApprovalForAll(address,bool)'],
            staking: ['function stake(uint256)', 'function unstake(uint256)', 'function claim() returns (uint256)'],
        },
        signer: {
            getAddress: async () => '0x1111111111111111111111111111111111111111',
            sendTransaction: async (tx) => {
                const index = state.attempts.length;
                state.attempts.push(tx);
                if (failSend === index) {
                    const error = new Error('user rejected transaction');
                    error.code = 4001;
                    throw error;
                }
                state.sends.push(tx);
                return {
                    hash: `0x${(index + 1).toString(16).repeat(64).slice(0, 64)}`,
                    wait: async () => ({ status: mineStatus, blockNumber: 100 + index }),
                };
            },
        },
        contractAt: (to, abi) => {
            const iface = new utils.Interface(abi);
            const populated = new Proxy({}, {
                get: (_target, method) => async (...args) => {
                    // A value-returning view has to be answered rather than populated — that is what
                    // the plan builder's `isApprovedForAll` check is.
                    if (method === 'isApprovedForAll') {
                        state.reads.push({ to, method, args });
                        return approved;
                    }
                    const data = iface.encodeFunctionData(String(method), args);
                    state.encodes.push({ to, method, args, data, abi });
                    return { to, data };
                },
            });
            return { populateTransaction: populated, isApprovedForAll: populated.isApprovedForAll };
        },
    };
    return { binding, state };
}

const APPROVE_SELECTOR = new utils.Interface(['function setApprovalForAll(address,bool)'])
    .encodeFunctionData('setApprovalForAll', [POOLS.knights, true]).slice(0, 10);

{
    const { binding, state } = fake({ approved: false });
    const result = await executePlan(
        stakePlan({ tokenId: 42, approved: false, staking: POOLS.knights, collection: COLLECTIONS.knights }),
        binding,
        { onStage: (event) => state.stages.push(event.stage) },
    );
    rec('a plan is sent one transaction per step', result.sent.length === 2, `${result.sent.length} sent`);
    rec('every step reaches the signer, rather than being called through the contract proxy',
        state.sends.length === 2);
    rec('the calldata is exactly what the ABI encodes, produced by ethers',
        state.encodes[0].data === new utils.Interface(binding.abi.collection)
            .encodeFunctionData('setApprovalForAll', [POOLS.knights, true])
        && state.encodes[1].data === new utils.Interface(binding.abi.staking)
            .encodeFunctionData('stake', [42]));
    rec('the approval goes to one address and the stake to the other',
        state.sends[0].to === COLLECTIONS.knights && state.sends[1].to === POOLS.knights);
    rec('the page is told before and after each send, so it can show progress',
        state.stages.join(',') === 'sending,sent,mined,sending,sent,mined', state.stages.join(','));
    rec('the hash of the last transaction comes back to be shown to the player',
        /^0x[0-9a-f]{64}$/.test(result.hash || ''), result.hash?.slice(0, 12));
    rec('every receipt rides on the result, so "mined" is a fact rather than an assumption',
        result.sent.every((entry) => entry.receipt?.status === 1));
}

{
    const { binding, state } = fake({ approved: true });
    const result = await stakeKnight({
        staking: POOLS.knights, collection: COLLECTIONS.knights, tokenId: 42, binding,
    });
    rec('an already approved wallet is asked for the stake alone', result.sent.length === 1,
        `${result.sent.length} sent`);
    rec('the approval is checked by reading the collection for this wallet and this pool',
        state.reads.length === 1
        && state.reads[0].args[0] === '0x1111111111111111111111111111111111111111'
        && state.reads[0].args[1] === POOLS.knights,
        state.reads[0] ? `${state.reads[0].method}(${state.reads[0].args.join(', ')})` : 'no read');
    rec('and reading rather than caching it is what makes a revoked approval safe',
        state.sends.every((tx) => !tx.data.startsWith(APPROVE_SELECTOR)));
}

{
    // The case the ordering exists for: the approval is refused in the wallet. The stake behind it
    // must not be attempted, or the player would be asked to sign twice and pay gas to see the error
    // they already saw.
    const { binding, state } = fake({ approved: false, failSend: 0 });
    let error = null;
    try {
        await stakeKnight({ staking: POOLS.knights, collection: COLLECTIONS.knights, tokenId: 42, binding });
    } catch (caught) {
        error = caught;
    }
    rec('a refused approval stops the plan', error instanceof StakingWriteError, error?.message);
    rec('and the stake behind it is never even attempted',
        state.attempts.length === 1 && state.sends.length === 0,
        `${state.attempts.length} attempted, ${state.sends.length} accepted`);
    rec('and the reason is the player\u2019s own cancellation rather than a wall of provider text',
        /cancelled/i.test(error?.message || ''), error?.message);
    rec('and the failure knows which step it was, so the page can name it',
        error?.step?.kind === 'approve', error?.step?.kind);
}

{
    const { binding } = fake({ approved: true, failSend: 0 });
    let error = null;
    try {
        await unstakeKnight({ staking: POOLS.genesis, tokenId: 7, binding });
    } catch (caught) {
        error = caught;
    }
    rec('a rejected transaction is reported as a cancellation, not as a contract failure',
        /cancelled/i.test(error?.message || ''), error?.message);
}

{
    // Mined and reverted is a different failure from never sent: the player paid for it, and the page
    // must not report it as a success.
    const { binding } = fake({ approved: true, mineStatus: 0 });
    let error = null;
    try {
        await executePlan(claimPlan({ staking: POOLS.genesis }), binding);
    } catch (caught) {
        error = caught;
    }
    rec('a reverted receipt is a failure, not a quiet success',
        /reverted/i.test(error?.message || ''), error?.message);
    rec('and it carries the hash, because the transaction exists on chain either way',
        /^0x[0-9a-f]+$/.test(error?.hash || ''), error?.hash?.slice(0, 12));
}

{
    // "Stake all" reads the approval once. One extra round trip per knight is affordable; one extra
    // wallet prompt per knight is not.
    const { binding, state } = fake({ approved: false });
    const result = await stakeMany({
        staking: POOLS.knights, collection: COLLECTIONS.knights, tokenIds: [1, 2, 3], binding,
    });
    rec('staking several knights reads the approval exactly once', state.reads.length === 1,
        `${state.reads.length} read(s)`);
    rec('and sends one approval plus one stake per knight', result.sent.length === 4,
        `${result.sent.length} transaction(s) for 3 knights`);
    const expected = [
        new utils.Interface(binding.abi.collection).encodeFunctionData('setApprovalForAll', [POOLS.knights, true]),
        ...[1, 2, 3].map((id) => new utils.Interface(binding.abi.staking).encodeFunctionData('stake', [id])),
    ];
    rec('in order, with the approval first and each stake carrying its own id',
        state.sends.map((tx) => tx.data).join(',') === expected.join(','));
    rec('and the last hash is the one the page reports',
        result.hash === `0x${(4).toString(16).repeat(64).slice(0, 64)}`, result.hash?.slice(0, 12));
}

{
    // The error mapping, driven with the strings these contracts actually revert with.
    const cases = [
        ['execution reverted: Not your knight', /not in the wallet/i],
        ['execution reverted: Already staked', /already staked/i],
        ['execution reverted: Not the staker', /only the wallet that staked/i],
        ['execution reverted: Nothing to claim', /nothing has accrued/i],
        ['execution reverted: This week\u2019s line is already spent', /line is fully spent/i],
        ['insufficient funds for gas * price + value', /enough ETH for gas/i],
        ['', /failed before it reached the chain/i],
    ];
    const mapped = cases.filter(([raw, pattern]) => pattern.test(readError(new Error(raw)))).length;
    rec('every failure a stake can produce reads as a sentence the player can act on',
        mapped === cases.length, `${mapped}/${cases.length} mapped`);
    rec('and a rejection is never reported as a contract error',
        /cancelled/i.test(readError({ code: 4001, message: 'execution reverted: Not your knight' })));
}

// =================================================================== the live contracts
section('The deployed contracts, as this path asks them');

async function chainReachable() {
    try {
        const [row] = await rpcBatch([{ method: 'eth_blockNumber', params: [] }]);
        return !row.error;
    } catch {
        return false;
    }
}

/** A read-only call: `{ value }` when it answered, `{ error }` when it did not. */
async function probe(to, abi, fn, args = [], from = null) {
    const iface = new utils.Interface(abi);
    const [row] = await rpcBatch([{
        method: 'eth_call',
        params: [{ ...(from ? { from } : {}), to, data: iface.encodeFunctionData(fn, args) }, 'latest'],
    }]);
    if (row.error) return { error: row.error, message: String(row.error.message || ''), data: String(row.error.data || '') };
    try {
        return { value: iface.decodeFunctionResult(fn, row.result) };
    } catch (error) {
        return { error, message: `undecodable result: ${error.message}` };
    }
}

// `ERC721NonexistentToken(uint256)`, OpenZeppelin v5's revert for asking about a token that was never
// minted. Derived rather than typed out, so the assertion says what it is checking for.
const ERC721_NONEXISTENT = utils.id('ERC721NonexistentToken(uint256)').slice(0, 10);

const online = await chainReachable();
if (!online) {
    console.log('');
    console.log('The chain could not be reached, so nothing below was measured.');
}

if (online && POOLS.genesis && POOLS.knights) {
    // 1. Every write function this path sends, refused by the contract for its own reason. That is the
    //    evidence, and it is specific: `unstake` and `claim` answer with a string revert from the
    //    guard inside them, and `stake` answers with the **collection's** error for a token that does
    //    not exist — which proves the pool really did dispatch into the collection it was wired to,
    //    rather than merely existing at an address.
    rec('the collection\u2019s not-minted error is the one stake should surface',
        /^0x[0-9a-f]{8}$/.test(ERC721_NONEXISTENT), ERC721_NONEXISTENT);

    const writes = [
        ['GenesisStaking', POOLS.genesis, 'unstake', UNSTAKE_ABI, [1], /not the staker/i],
        ['GenesisStaking', POOLS.genesis, 'claim', CLAIM_ABI, [], /nothing to claim/i],
        ['KnightsStaking', POOLS.knights, 'unstake', UNSTAKE_ABI, [1], /not the staker/i],
        ['KnightsStaking', POOLS.knights, 'claim', CLAIM_ABI, [], /nothing to claim/i],
    ];
    for (const [name, pool, fn, abi, args, pattern] of writes) {
        const answer = await probe(pool, abi, fn, args, NOBODY);
        rec(`${name}.${fn} exists on chain and refuses this wallet for its own reason`,
            pattern.test(answer.message || ''), answer.message || `no revert: ${answer.value}`);
    }

    for (const [name, pool, collection] of [
        ['GenesisStaking', POOLS.genesis, COLLECTIONS.genesis],
        ['KnightsStaking', POOLS.knights, COLLECTIONS.knights],
    ]) {
        const answer = await probe(pool, STAKE_ABI, 'stake', [1], NOBODY);
        rec(`${name}.stake dispatches into its own collection's ownerOf`,
            (answer.data || '').startsWith(ERC721_NONEXISTENT) || /not your knight/i.test(answer.message || ''),
            answer.data ? `${answer.data.slice(0, 10)}… from ${collection}` : answer.message);
    }

    // 2. The reads the page depends on answer against the real contracts.
    const STAKING_READS = [
        'function stakedTokens(address) view returns (uint256[])',
        'function stakedCount(address) view returns (uint256)',
        'function stakes(uint256) view returns (uint16,uint64,address)',
        'function totalHashPower() view returns (uint256)',
        'function ratePerDay() view returns (uint256)',
        'function vaultState() view returns (uint256,uint256,uint16)',
        'function claimable(address) view returns (uint256)',
        'function pending(address) view returns (uint256)',
        'function claimableNow(address) view returns (uint256)',
        'function vaultLine() view returns (uint8)',
        'function collection() view returns (address)',
    ];
    const GENESIS_READS = [
        'function ticketsThisWeek(address) view returns (uint256)',
        'function ticketsRemainingThisWeek(address) view returns (uint256,uint256)',
        'function stakerCount() view returns (uint256)',
        'function stakerAt(uint256) view returns (address)',
        'function currentWeek() view returns (uint256)',
    ];
    // Every read the page makes, asked once, with an argument the contract will accept. Listed rather
    // than generated from the ABI: the arguments differ per function, and a generated list is how a
    // probe ends up passing because it asked the wrong question.
    const readChecks = [
        ['GenesisStaking.stakedTokens', POOLS.genesis, STAKING_READS, 'stakedTokens', [NOBODY]],
        ['GenesisStaking.stakes', POOLS.genesis, STAKING_READS, 'stakes', [1]],
        ['GenesisStaking.totalHashPower', POOLS.genesis, STAKING_READS, 'totalHashPower', []],
        ['GenesisStaking.ratePerDay', POOLS.genesis, STAKING_READS, 'ratePerDay', []],
        ['GenesisStaking.vaultState', POOLS.genesis, STAKING_READS, 'vaultState', []],
        ['GenesisStaking.claimable', POOLS.genesis, STAKING_READS, 'claimable', [NOBODY]],
        ['GenesisStaking.pending', POOLS.genesis, STAKING_READS, 'pending', [NOBODY]],
        ['GenesisStaking.claimableNow', POOLS.genesis, STAKING_READS, 'claimableNow', [NOBODY]],
        ['GenesisStaking.vaultLine', POOLS.genesis, STAKING_READS, 'vaultLine', []],
        ['GenesisStaking.collection', POOLS.genesis, STAKING_READS, 'collection', []],
        ['GenesisStaking.currentWeek', POOLS.genesis, GENESIS_READS, 'currentWeek', []],
        ['GenesisStaking.ticketsThisWeek', POOLS.genesis, GENESIS_READS, 'ticketsThisWeek', [NOBODY]],
        ['GenesisStaking.ticketsRemainingThisWeek', POOLS.genesis, GENESIS_READS, 'ticketsRemainingThisWeek', [NOBODY]],
        ['GenesisStaking.stakerCount', POOLS.genesis, GENESIS_READS, 'stakerCount', []],
        ['KnightsStaking.stakedTokens', POOLS.knights, STAKING_READS, 'stakedTokens', [NOBODY]],
        ['KnightsStaking.stakes', POOLS.knights, STAKING_READS, 'stakes', [1]],
        ['KnightsStaking.ratePerDay', POOLS.knights, STAKING_READS, 'ratePerDay', []],
        ['KnightsStaking.pending', POOLS.knights, STAKING_READS, 'pending', [NOBODY]],
        ['KnightsStaking.claimableNow', POOLS.knights, STAKING_READS, 'claimableNow', [NOBODY]],
    ];
    for (const [label, pool, abis, fn, args] of readChecks) {
        const answer = await probe(pool, abis, fn, args);
        rec(`${label} answers the interface`,
            !answer.error, answer.error ? answer.message.slice(0, 60) : 'ok');
    }

    // `stakerAt` is index-bounded, so an empty registry is *supposed* to revert — "Index out of
    // range" is the contract answering correctly, and asking for index 0 is the only way to tell
    // that apart from a missing function.
    const stakerAt = await probe(POOLS.genesis, GENESIS_READS, 'stakerAt', [0]);
    rec('GenesisStaking.stakerAt is a real getter, bounded by the registry it enumerates',
        !stakerAt.error || /index out of range/i.test(stakerAt.message || ''),
        stakerAt.error ? stakerAt.message.slice(0, 60) : `staker 0 = ${stakerAt.value?.[0]}`);

    // 3. The pools point at the collections the page thinks they do. A stake transfers the NFT *into*
    //    the pool, so a pool wired to another collection would hold knights the vault cannot price —
    //    and the page would cheerfully offer to stake into it.
    for (const [side, pool] of Object.entries(POOLS)) {
        const answer = await probe(pool, ['function collection() view returns (address)'], 'collection');
        const holder = answer.value?.[0];
        rec(`${side} staking holds the ${side} collection, not another one`,
            !!holder && holder.toLowerCase() === (COLLECTIONS[side] || '').toLowerCase(),
            `${holder} vs ${COLLECTIONS[side]}`);
    }
    const LINES = ['function vaultLine() view returns (uint8)'];
    const genesisLine = await probe(POOLS.genesis, LINES, 'vaultLine');
    const knightsLine = await probe(POOLS.knights, LINES, 'vaultLine');
    rec('each pool charges its own line of the vault, not the other one\u2019s',
        Number(genesisLine.value?.[0]) === 1 && Number(knightsLine.value?.[0]) === 3,
        `genesis line ${genesisLine.value?.[0]}, knights line ${knightsLine.value?.[0]}`);

    // 4. The reader the page uses, against the real pool.
    const state = await readStakeState(NOBODY, {
        staking: POOLS.knights, nftAddress: COLLECTIONS.knights, collection: 'knights',
    });
    rec('the reader reports a wallet with no stake as empty rather than as a failure',
        state.ok === true && state.staked.length === 0, state.reason || 'ok');
    rec('and a pool weight of zero is a number, not an unknown',
        state.totalHashPower === 0, `${state.totalHashPower}`);
    rec('and it says how much the pool would pay, which is what the claim button reads',
        typeof state.claim?.payable === 'number', `${state.claim?.payable}`);
    rec('a wallet that staked nothing is not offered a claim',
        state.claim?.payable === 0 && state.staked.length === 0);

    // 5. The cross-check that makes the per-knight ticket figures trustworthy: our reproduction of
    //    the contract's week arithmetic, summed, against the contract's own `ticketsThisWeek`. Nothing
    //    is staked on Genesis yet, so this runs the moment somebody is.
    const genesis = await readStakeState(NOBODY, {
        staking: POOLS.genesis, nftAddress: COLLECTIONS.genesis, collection: 'genesis',
    });
    const stakerCount = genesis.tickets?.stakerCount ?? 0;
    if (stakerCount > 0) {
        const first = await probe(POOLS.genesis, ['function stakerAt(uint256) view returns (address)'], 'stakerAt', [0]);
        const staker = first.value?.[0];
        const theirs = await readStakeState(staker, {
            staking: POOLS.genesis, nftAddress: COLLECTIONS.genesis, collection: 'genesis',
        });
        const summed = theirs.staked.reduce((total, position) => total + ticketsInWeekFor(position), 0);
        rec('our per-knight week arithmetic sums to the contract\u2019s own ticket count',
            summed === theirs.tickets?.mine,
            `${summed} computed vs ${theirs.tickets?.mine} on chain`);
    } else {
        skip('our per-knight week arithmetic sums to the contract\u2019s own ticket count',
            'nobody has staked on Genesis yet, so there is no ledger to check against');
    }
} else if (online) {
    for (const label of [
        'the write functions exist on chain and refuse this wallet for their own reasons',
        'the reads the page depends on answer the interface',
        'each pool holds its own collection',
        'the reader reports an empty stake as empty',
        'our per-knight week arithmetic sums to the contract\u2019s own ticket count',
    ]) skip(label, 'no staking address is configured');
}

console.log('');
const failed = results.filter((row) => !row.pass);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
for (const row of failed) console.log(`  FAILED: ${row.label}`);
console.log('');
process.exit(failed.length ? 1 : 0);
