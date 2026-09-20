import { NextResponse } from 'next/server';
import {
    CAPSULES_PER_WEEK,
    CAPSULE_TYPES,
    KNIGHTS_CAP,
    TICKET_CAP_HOURS,
    WEEK_EPOCH_UTC,
    WEEK_MS,
} from '../../../../lib/staking-config.js';
import {
    MIN_WEEKS, REWARD_VAULT_DNG, STAKING_SHARE_OF_DUNGEON, capsuleOpenPrice, economy,
    horizonDays, lineBudgets, weeklyBudgetDng,
} from '../../../../lib/reward-config.js';
// The tiers every reward contract can pay. Served alongside the capsule odds because those
// odds are expressed in these names, and a capsule may not promise one that is missing —
// the spec's fourth capsule offered a Mythic, which has no on-chain reward slot.
import { KNIGHT_TIERS } from '../../../../lib/knights.js';
// The deployed knight collection's address and the facts about reading it. Imported from the
// game's chain module rather than declared again here, so the vault and the game can never
// disagree about which collection they are talking about.
import { ADDRESSES as GAME_ADDRESSES } from '../../../../lib/game-runs.js';
import { NFT_ENUMERATION } from '../../../../lib/staking-chain.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Public values, overridable by env so nothing needs recompiling when a contract moves —
// the same rule the game's config route follows. An empty string means "not deployed
// yet", and the page degrades to its labelled preview instead of failing.
const ADDRESSES = {
    genesis: (process.env.GENESIS_NFT || '').trim(),
    staking: (process.env.STAKING_CONTRACT || '').trim(),
    raffle: (process.env.RAFFLE_CONTRACT || '').trim(),
    capsule: (process.env.CAPSULE_NFT || '').trim(),
    vault: (process.env.REWARD_VAULT || '').trim(),
};

/**
 * The weekly pool, which under the third revision is no longer a `TBD`.
 *
 * It is the Genesis *staking line* — the weekly budget split into four, one of which is the
 * pool Genesis stakers draw from — so the page shows real DNG figures derived from the same
 * file the contracts are deployed from. `WEEKLY_POOL_DNG` still wins when it is set, because a
 * deployment reading a live vault should be able to say what that vault actually releases.
 */
function poolFromEnv() {
    const raw = (process.env.WEEKLY_POOL_DNG || '').trim();
    const fallback = lineBudgets().genesisStaking;
    if (!raw) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * The Knights side's pool — the `knightsStaking` line, 292,320 at the reference.
 *
 * Separate env override (`KNIGHTS_POOL_DNG`) rather than a fraction of the Genesis one,
 * because the two lines are independently funded and a deployment that has one on chain may
 * not have the other.
 */
function knightsPoolFromEnv() {
    const raw = (process.env.KNIGHTS_POOL_DNG || '').trim();
    const fallback = lineBudgets().knightsStaking;
    if (!raw) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * GET — how the page decides between the chain and its preview.
 *
 * `chain` is true only when all four collection contracts are configured: half a vault
 * cannot read coherently (tickets come from staking, draws come from the raffle), so a
 * partial set reports the reason rather than half-loading. The reward vault is reported
 * separately, because the economy is derived either way and the vault only decides whether
 * the *live* figures are read off chain or computed here.
 */
export async function GET() {
    const missing = Object.entries(ADDRESSES)
        .filter(([key, value]) => !value && key !== 'vault')
        .map(([key]) => key);

    const model = economy();

    return NextResponse.json({
        chain: missing.length === 0,
        reason: missing.length
            ? `The staking contracts are not deployed on this network yet (missing ${missing.join(', ')}), so this vault is showing preview data.`
            : null,
        addresses: ADDRESSES,
        vaultLive: Boolean(ADDRESSES.vault),

        poolDng: poolFromEnv(),
        knightsPoolDng: knightsPoolFromEnv(),

        // ------------------------------------------------------------ what can be read
        // Two collections are described separately because they are in different states, and
        // one all-or-nothing `chain` flag could not say so. The summonable Knights collection
        // **exists and is readable today**; Genesis Knights have never been minted, and the
        // staking, raffle and capsule contracts are not deployed. Collapsing those into a
        // single boolean is what kept real knights off this page: `chain: false` because three
        // other things were missing, which made the one collection that does exist unreadable
        // too.
        collections: {
            genesis: {
                nft: ADDRESSES.genesis,
                live: Boolean(ADDRESSES.genesis),
                reason: ADDRESSES.genesis ? null : 'Genesis Knights have not been minted yet.',
            },
            knights: {
                nft: GAME_ADDRESSES.knightNFT,
                live: Boolean(GAME_ADDRESSES.knightNFT),
                reason: null,
            },
        },
        // Whether a wallet's knights can be read at all, which is now independent of whether
        // they can be staked.
        holdingsLive: Boolean(GAME_ADDRESSES.knightNFT || ADDRESSES.genesis),
        // The measured shape of the collection — not enumerable, batches of 50. Published so the
        // page can tell a player *why* an owner list might be short, instead of showing a
        // partial list as if it were whole.
        nftReads: NFT_ENUMERATION,
        // Whether staking itself is live, which is the thing `chain` has always meant.
        stakingLive: missing.length === 0,

        capsulesPerWeek: CAPSULES_PER_WEEK,
        capsuleTypes: CAPSULE_TYPES,
        knightTiers: KNIGHT_TIERS,
        capHours: TICKET_CAP_HOURS,
        week: { epochUtc: WEEK_EPOCH_UTC, lengthMs: WEEK_MS },

        // ------------------------------------------------------------------ the economy
        // Served whole rather than field by field, so the page and the harness read the same
        // object and a number cannot be right in one and stale in the other.
        economy: {
            supply: model.supply,
            distribution: model.distribution,
            rewardVaultDng: REWARD_VAULT_DNG,
            reference: model.reference,
            lines: model.lines,
            shares: model.shares,
            lineBudgets: model.lineBudgets,
            weeklyBudget: weeklyBudgetDng(),
            dailyBudget: model.dailyBudget,
            minWeeks: MIN_WEEKS,
            // The scale the published table is paid at this week. `1` until a live vault
            // reports its own — the model's ceiling is what the page shows either way.
            epochScale: 1,
            horizonDays: horizonDays(REWARD_VAULT_DNG),
            worstCaseBurnPerDay: model.worstCaseBurnPerDay,
            worstCaseHorizonDays: model.worstCaseHorizonDays,
            worstCaseScale: model.worstCaseScale,
            fundingPerYear: model.fundingPerYear,
            stakingShareOfDungeon: STAKING_SHARE_OF_DUNGEON,
            knightsCap: KNIGHTS_CAP,
            knightsPayoutAtCap: model.knightsPayoutAtCap,
            // The draw's size belongs to the economy, not only to the vault: the capsule
            // panel quotes it, and it is what makes the open price a funding mechanism
            // rather than a fee. It was top-level only, so the panel read `undefined`.
            capsulesPerWeek: model.capsulesPerWeek,
            capsuleOpenPriceAtZero: capsuleOpenPrice(0),
            capsuleOpenPriceAtCap: capsuleOpenPrice(KNIGHTS_CAP),
            capsuleBreakEvenMinted: model.capsuleBreakEvenMinted,
            genesisRewardPerClear: model.genesisRewardPerClear,
            genesisDailyRuns: model.genesisDailyRuns,
            // The reference table, whole. The staking page's Knights ladder and the capsule
            // section both describe the same five tiers, so they read the model's table
            // rather than a second copy of it.
            referenceTable: model.referenceTable,
        },
    });
}
