import { NextResponse } from 'next/server';
import {
    CAPSULES_PER_WEEK,
    CAPSULE_TYPES,
    TICKET_CAP_HOURS,
    WEEKLY_POOL_DNG,
    WEEK_EPOCH_UTC,
    WEEK_MS,
} from '../../../../lib/staking-config.js';

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
};

/**
 * The weekly pool, from env when the tokenomics exist and `null` until then.
 *
 * This is the one number the whole page is waiting on, so it is read here rather than
 * hard-coded: setting `WEEKLY_POOL_DNG` in the deployment turns every `TBD` on the page
 * into real DNG figures, with no code change and no redeploy of the client.
 */
function poolFromEnv() {
    const raw = (process.env.WEEKLY_POOL_DNG || '').trim();
    if (!raw) return WEEKLY_POOL_DNG;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : WEEKLY_POOL_DNG;
}

/**
 * GET — how the page decides between the chain and its preview.
 *
 * `chain` is true only when all four contracts are configured: half a vault cannot read
 * coherently (tickets come from staking, draws come from the raffle), so a partial set
 * reports the reason rather than half-loading.
 */
export async function GET() {
    const missing = Object.entries(ADDRESSES)
        .filter(([, value]) => !value)
        .map(([key]) => key);

    return NextResponse.json({
        chain: missing.length === 0,
        reason: missing.length
            ? `The staking contracts are not deployed on this network yet (missing ${missing.join(', ')}), so this vault is showing preview data.`
            : null,
        addresses: ADDRESSES,
        poolDng: poolFromEnv(),
        capsulesPerWeek: CAPSULES_PER_WEEK,
        capsuleTypes: CAPSULE_TYPES,
        capHours: TICKET_CAP_HOURS,
        week: { epochUtc: WEEK_EPOCH_UTC, lengthMs: WEEK_MS },
    });
}
