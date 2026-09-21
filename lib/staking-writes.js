/**
 * The Staking Vault's transaction path.
 *
 * Until this file existed the vault had none, and the page said so: every button moved a
 * knight in the browser and reached nothing. That was honest, but it meant `STAKING_WRITES_READY`
 * could never be true. What lives here is the missing half — the calls that make a stake real.
 *
 * ## Three calls, and why the fourth is not one
 *
 *     approve   collection.setApprovalForAll(staking, true)   once per collection
 *     stake     staking.stake(tokenId)                        the pool pulls the knight in
 *     unstake   staking.unstake(tokenId)                      only the staker may call it
 *     claim     staking.claim()                               pays the wallet's whole accrual
 *
 * There is no DNG approval anywhere, and that is worth stating because it is the obvious thing
 * to assume: `StakingPool.stake` moves the **NFT**, so the collection needs the approval, not
 * the token. Yield flows the other way — the pool pays out of `RewardVault` — so claiming needs
 * no allowance either.
 *
 * ## Why plans, and not three functions that call each other
 *
 * A stake is one approval plus one call, and the two are not interchangeable: skipping the
 * approval reverts, and repeating it wastes a transaction and a wallet prompt. So the *plan* —
 * the ordered list of calls a wallet is about to be asked to sign — is computed as a pure
 * function of facts (`isApprovedForAll`, the token id), and a thin executor sends it. That keeps
 * the part that can be wrong testable without a browser, a wallet or a chain: `stakePlan` is
 * checked in `tools/check-staking-writes.js` against all four combinations of approved/not, and
 * the executor against a fake binding that records what it was handed.
 *
 * `claim()` is deliberately wallet-level rather than per knight, because that is what the
 * contract implements — it settles every stake the wallet holds in one pass. The interface says
 * so instead of implying a per-knight payment the chain would not make.
 */

/**
 * Read and write surface of a staking pool. Signatures copied from `contracts/StakingPool.sol`
 * and `contracts/GenesisStaking.sol`, and `tools/check-staking-writes.js` checks every one of
 * them against the deployed bytecode rather than against this comment.
 */
export const STAKING_ABI = [
    'function stake(uint256 tokenId)',
    'function unstake(uint256 tokenId)',
    'function claim() returns (uint256)',
    'function sync()',
    'function vaultLine() view returns (uint8)',
    'function stakedTokens(address wallet) view returns (uint256[])',
    'function stakedCount(address wallet) view returns (uint256)',
    'function stakes(uint256 tokenId) view returns (uint16 hp, uint64 stakedAt, address staker)',
    'function claimable(address wallet) view returns (uint256)',
    'function pending(address wallet) view returns (uint256)',
    'function claimableNow(address wallet) view returns (uint256)',
    'function totalHashPower() view returns (uint256)',
    'function ratePerDay() view returns (uint256)',
    'function vaultState() view returns (uint256 lineBudget, uint256 lineRemaining, uint16 scaleBps)',
];

/** The part of the two collections a stake needs: ownership, and permission to be held. */
export const COLLECTION_ABI = [
    'function ownerOf(uint256 tokenId) view returns (address)',
    'function isApprovedForAll(address owner, address operator) view returns (bool)',
    'function setApprovalForAll(address operator, bool approved)',
    'function hashPowerOfToken(uint256 tokenId) view returns (uint16)',
];

/** Genesis only: the ticket ledger, which the raffle is drawn from. */
export const GENESIS_STAKING_ABI = [
    'function ticketsThisWeek(address wallet) view returns (uint256)',
    'function ticketsInWeek(uint256 week, address wallet) view returns (uint256)',
    'function ticketsRemainingThisWeek(address wallet) view returns (uint256 earned, uint256 total)',
    'function currentWeek() view returns (uint256)',
    'function stakerCount() view returns (uint256)',
    'function stakerAt(uint256 index) view returns (address)',
];

export const ABI = {
    collection: COLLECTION_ABI,
    staking: STAKING_ABI,
    genesis: GENESIS_STAKING_ABI,
};

// ------------------------------------------------------------------------------ the plans

/**
 * The calls a stake needs, in order.
 *
 * `approved` is passed in rather than read here so the plan stays a pure function: the caller
 * asks the collection `isApprovedForAll` and hands the answer over, which is what lets the
 * "already approved" path be tested without a chain.
 *
 * The approval is `setApprovalForAll` rather than a per-token `approve` on purpose. A per-token
 * approval is narrower, and it is the better choice for a one-off — but a staker is going to
 * stake again, and approving each knight separately costs a transaction per knight for no
 * additional safety here: the operator is the staking contract, and it can only ever move a
 * knight into itself or back to its staker (`StakingPool.stake`/`unstake` are the only paths
 * that call `transferFrom`).
 */
export function stakePlan({ tokenId, approved, staking, collection }) {
    if (!staking) throw new Error('no staking contract is configured for this collection');
    if (!collection) throw new Error('no knight collection is configured for this network');
    const id = Number(tokenId);
    if (!Number.isInteger(id) || id <= 0) throw new Error(`"${tokenId}" is not a knight id`);

    const steps = [];
    if (!approved) {
        steps.push({
            key: 'approve',
            kind: 'approve',
            abi: 'collection',
            to: collection,
            method: 'setApprovalForAll',
            args: [staking, true],
            label: 'Allow the vault to hold your knights',
            note: 'One approval per collection, not per knight. It lets the staking contract move a knight into itself so it can be held while it earns — the only two transfers it makes.',
        });
    }
    steps.push({
        key: 'stake',
        kind: 'stake',
        abi: 'staking',
        to: staking,
        method: 'stake',
        args: [id],
        label: `Stake #${id}`,
        note: 'Moves the knight into the staking contract. It is not in your wallet while it is staked, and it cannot be sold or sent into a dungeon until it comes back.',
    });
    return steps;
}

/** The calls an unstake needs. One, and no approval: the pool transfers the knight back. */
export function unstakePlan({ tokenId, staking }) {
    if (!staking) throw new Error('no staking contract is configured for this collection');
    const id = Number(tokenId);
    if (!Number.isInteger(id) || id <= 0) throw new Error(`"${tokenId}" is not a knight id`);
    return [{
        key: 'unstake',
        kind: 'unstake',
        abi: 'staking',
        to: staking,
        method: 'unstake',
        args: [id],
        label: `Unstake #${id}`,
        note: 'Returns the knight to your wallet and settles what it earned. It may be paid now or queued — the settlement survives the unstake either way.',
    }];
}

/**
 * The calls a claim needs: one, for the whole wallet.
 *
 * `claim()` settles every stake the wallet holds and pays up to what this week's line has left,
 * clamping rather than reverting. So this is deliberately *not* per knight — the contract has no
 * per-knight payout to offer, and a button that looked like it had one would be a fiction.
 */
export function claimPlan({ staking }) {
    if (!staking) throw new Error('no staking contract is configured for this collection');
    return [{
        key: 'claim',
        kind: 'claim',
        abi: 'staking',
        to: staking,
        method: 'claim',
        args: [],
        label: 'Claim accrued yield',
        note: 'Pays everything this wallet has accrued, up to what the staking line can pay this week. A shortfall is not lost — it stays claimable and pays out later.',
    }];
}

/**
 * The calls a rate refresh needs. Permissionless on chain, and included because the pool's
 * accrual rate is the one thing here that goes stale on its own.
 */
export function syncPlan({ staking }) {
    return [{
        key: 'sync',
        kind: 'sync',
        abi: 'staking',
        to: staking,
        method: 'sync',
        args: [],
        label: 'Refresh the pool rate',
        note: 'Re-reads what the vault releases for this line. Anyone may do it, and the rate only moves when the vault does.',
    }];
}

// --------------------------------------------------------------------------- the executor

/**
 * Send a plan, one step at a time, and stop at the first failure.
 *
 * Stopping matters more than it looks: a rejected approval must not be followed by a stake,
 * because the stake would revert too and the player would have signed two prompts to end up
 * with the error they already saw. Nothing here retries — a wallet prompt is a decision, and
 * repeating it is not this module's call to make.
 *
 * The binding is injected so this can be driven without a browser — three things and nothing else:
 *
 *     { abi: { collection, staking, genesis },
 *       signer: { getAddress(), sendTransaction(tx) },
 *       contractAt(to, abi) }
 *
 * `onStage` is called with `{ stage, step, hash? }` before and after each send, which is what the
 * page turns into "Approving…", "Staking…" and a tx hash the player can follow.
 *
 * **The transaction is built and sent rather than called through the contract proxy.**
 * `contract.stake(id)` would work and would hide the important half: in ethers the proxy method
 * quietly reaches `signer.sendTransaction`, so a page can look like it stakes while nothing in it
 * says "send". Two calls make the shape of the thing visible — `populateTransaction` encodes, the
 * signer sends — and it is also what makes this testable, because a fake signer can record exactly
 * which contract, function and arguments it was handed.
 */
export async function executePlan(plan, binding, { onStage = () => {} } = {}) {
    if (typeof binding?.contractAt !== 'function' || typeof binding?.signer?.sendTransaction !== 'function') {
        throw new Error('no wallet is available to sign with');
    }

    const sent = [];
    for (const step of plan) {
        onStage({ stage: 'sending', step });
        const contract = binding.contractAt(step.to, binding.abi[step.abi]);
        // A `callStatic`-style pre-flight is deliberately not used: the wallet's own
        // `eth_estimateGas` already reverts with the contract's reason, and a second dry run
        // would double the round trips for the same message.

        let tx;
        try {
            const populated = await contract.populateTransaction[step.method](...step.args);
            tx = await binding.signer.sendTransaction(populated);
        } catch (error) {
            throw new StakingWriteError(readError(error), { step, cause: error });
        }

        sent.push({ step, hash: tx.hash });
        onStage({ stage: 'sent', step, hash: tx.hash });

        let receipt;
        try {
            receipt = await tx.wait();
        } catch (error) {
            // Sent but not mined: a different failure from "never sent", and the hash is the
            // one useful thing to hand back, so it travels with the error.
            throw new StakingWriteError(readError(error), { step, hash: tx.hash, cause: error });
        }
        if (receipt && receipt.status === 0) {
            throw new StakingWriteError('The transaction was mined but reverted.', {
                step, hash: tx.hash,
            });
        }
        sent[sent.length - 1].receipt = receipt;
        onStage({ stage: 'mined', step, hash: tx.hash, receipt });
    }

    return { sent, hash: sent[sent.length - 1]?.hash || null };
}

/** A failure the page can print as-is, with the step and hash attached. */
export class StakingWriteError extends Error {
    constructor(message, { step = null, hash = null, cause = null } = {}) {
        super(message);
        this.name = 'StakingWriteError';
        this.step = step;
        this.hash = hash;
        this.cause = cause;
    }
}

/**
 * A wallet or chain failure, in a sentence a player can act on.
 *
 * Generic wallet providers are unhelpful here by default: a rejection, a wrong network, a
 * reverting call and a wallet with no gas all arrive as "Error: …" with a long stack. Each has a
 * different fix, so each gets its own line — and the contract's own revert strings are matched
 * first, because they say what happened better than any mapping could.
 */
export function readError(error) {
    const code = error?.code ?? error?.cause?.code;
    if (code === 4001 || code === 'ACTION_REJECTED' || code === 'USER_REJECTED') {
        return 'You cancelled that in your wallet — nothing was sent.';
    }

    const raw = String(error?.reason || error?.data?.message || error?.error?.message || error?.message || '');
    const revert = raw.match(/execution reverted:?\s*(.*)$/i)?.[1]?.trim() || raw;

    const known = [
        [/not your knight/i, 'That knight is not in the wallet that is connected.'],
        [/already staked/i, 'That knight is already staked.'],
        [/not the staker/i, 'Only the wallet that staked a knight can unstake it.'],
        [/not staked/i, 'That knight is not staked.'],
        [/nothing to claim/i, 'Nothing has accrued to claim yet.'],
        [/line is already spent/i, 'This week’s staking line is fully spent — what is left stays claimable next week.'],
        [/knight has no hash power/i, 'That knight has no hash power, so the pool will not accept it.'],
        [/insufficient funds/i, 'This wallet does not have enough ETH for gas.'],
        [/nonce too low|replacement transaction/i, 'The wallet and the chain disagree about a pending transaction — check your wallet for a stuck one.'],
        [/underpriced/i, 'The gas price was too low for the chain to accept.'],
    ];
    for (const [pattern, message] of known) {
        if (pattern.test(raw)) return message;
    }

    if (/network|chain/i.test(raw) && /mismatch|wrong/i.test(raw)) {
        return 'Your wallet is on a different network from the vault.';
    }
    if (!revert) return 'The transaction failed before it reached the chain.';
    return `The transaction failed: ${revert.slice(0, 180)}`;
}

// ------------------------------------------------------------------------- the browser

/**
 * A binding backed by the page's wallet.
 *
 * Uses the **vendored ethers v5 UMD** (`/ethers-5.7.2.umd.min.js`) rather than a bundled copy,
 * for two reasons. It is the one ethers this project has ever used in a browser — `public/wallet.js`
 * and every legacy page load the same global — and a second, differently-versioned copy inside the
 * React bundle is how `parseEther` and `utils.parseEther` end up in the same page. The script tag is
 * on the staking page for the same reason: the library has to be there before a button is pressed,
 * and saying so is better than a `ReferenceError` after the click.
 *
 * `expectedChainId` is checked before anything is signed. A contract call on the wrong network
 * either reverts with nothing useful or, worse, lands on an address that means something else
 * there — so the mismatch is reported as a network problem rather than as a failed stake.
 */
export async function browserBinding({ expectedChainId = null, ethereum = null } = {}) {
    const injected = ethereum || (typeof window !== 'undefined' ? window.ethereum : null);
    if (!injected) {
        throw new StakingWriteError('No Web3 wallet was found in this browser. Install one to stake.');
    }
    const ethers = typeof window !== 'undefined' ? window.ethers : null;
    if (!ethers?.Contract || !ethers?.providers?.Web3Provider) {
        throw new StakingWriteError('The wallet library is still loading — try that again in a moment.');
    }

    const provider = new ethers.providers.Web3Provider(injected);
    const signer = provider.getSigner();

    if (expectedChainId) {
        const network = await provider.getNetwork();
        if (Number(network.chainId) !== Number(expectedChainId)) {
            throw new StakingWriteError(
                `Your wallet is on chain ${network.chainId}, but the vault is on chain ${expectedChainId}. `
                + 'Switch networks in your wallet and try again.'
            );
        }
    }

    return {
        abi: ABI,
        provider,
        signer,
        contractAt: (to, abi) => new ethers.Contract(to, abi, signer),
        // Reads go through the provider rather than the signer, so a view call is never a wallet
        // round trip: `eth_call` needs no account, and asking the injected provider to "sign" a
        // read is how a page ends up prompting for a signature it did not need.
        read: (to, abi) => new ethers.Contract(to, abi, provider),
    };
}

/**
 * Stake one knight, approving the collection first only when it is not already approved.
 *
 * The approval check is a read on the collection, so the answer is about *this* wallet and *this*
 * pool rather than about a cache: an approval can be revoked in a wallet's own settings, and a
 * cached "yes" would then send a stake that reverts.
 */
export async function stakeKnight({
    staking, collection, tokenId, binding = null, onStage, expectedChainId = null,
}) {
    const bound = binding || await browserBinding({ expectedChainId });
    const owner = await bound.signer.getAddress();
    const nft = bound.contractAt(collection, bound.abi.collection);
    const approved = await nft.isApprovedForAll(owner, staking);
    const plan = stakePlan({ tokenId, approved, staking, collection });
    return { ...await executePlan(plan, bound, { onStage }), approved: !!approved };
}

/**
 * Stake several knights, reading the collection's approval **once**.
 *
 * "Stake all" is the button a new holder presses first, and the naive version is `stakeKnight` in a
 * loop — which re-reads `isApprovedForAll` before every knight. One extra round trip per knight is
 * affordable and one wallet prompt per knight is not: the approval is asked for once, and a
 * successful one stands for the rest of the batch, because the answer cannot change underneath a
 * batch of transactions the same wallet is signing. If the approval step is rejected the loop stops
 * before the first stake, which is the whole point of `executePlan` stopping at the first failure.
 *
 * Sequential on purpose. `Promise.all` over these would need a nonce per transaction and would send
 * the first approval concurrently with the stake that depends on it.
 */
export async function stakeMany({
    staking, collection, tokenIds, binding = null, onStage, expectedChainId = null,
}) {
    const bound = binding || await browserBinding({ expectedChainId });
    const owner = await bound.signer.getAddress();
    let approved = await bound.contractAt(collection, bound.abi.collection).isApprovedForAll(owner, staking);

    const sent = [];
    for (const tokenId of tokenIds) {
        const result = await executePlan(stakePlan({ tokenId, approved, staking, collection }), bound, { onStage });
        sent.push(...result.sent);
        approved = true;
    }
    return { sent, hash: sent[sent.length - 1]?.hash || null };
}

/** Unstake one knight. No approval either way — the pool already holds it. */
export async function unstakeKnight({ staking, tokenId, binding = null, onStage, expectedChainId = null }) {
    const bound = binding || await browserBinding({ expectedChainId });
    return executePlan(unstakePlan({ tokenId, staking }), bound, { onStage });
}

/** Claim everything this wallet has accrued, in one call. */
export async function claimRewards({ staking, binding = null, onStage, expectedChainId = null }) {
    const bound = binding || await browserBinding({ expectedChainId });
    return executePlan(claimPlan({ staking }), bound, { onStage });
}

/** Ask the pool to re-read the vault's rate. Permissionless, and it changes nobody's balance. */
export async function syncPool({ staking, binding = null, onStage, expectedChainId = null }) {
    const bound = binding || await browserBinding({ expectedChainId });
    return executePlan(syncPlan({ staking }), bound, { onStage });
}
