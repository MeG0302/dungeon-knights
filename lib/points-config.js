/**
 * The Points Program's rules, in one place.
 *
 * Kept free of any storage or browser import so the API routes, the page and the vault
 * mini-game can all read exactly these numbers without dragging a driver into the module
 * graph. Because every one of them imports this file, they cannot disagree about what a
 * floor pays.
 */

export const VAULT_LEVELS = [
    { name: 'Vault Entrance', points: 100 },
    { name: 'Treasury Hall', points: 300 },
    { name: 'Inner Sanctum', points: 500 },
];

export const VAULT_ENTRY_TOTAL = VAULT_LEVELS.reduce((sum, level) => sum + level.points, 0);

/** Referral programme: 15% of a first-degree referee's points, 5% of a second-degree's. */
export const REFERRAL_1ST_PCT = 0.15;
export const REFERRAL_2ND_PCT = 0.05;

/** Points are whole numbers; every commission is floored, never rounded up. */
export function commission(points, pct) {
    return Math.floor(points * pct);
}

/** The UTC day key. Every daily rule (floors, share, resets) keys off this one function. */
export function todayKey(now = new Date()) {
    return now.toISOString().slice(0, 10);
}
