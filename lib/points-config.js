/**
 * The Points Program's rules, in one place.
 *
 * Kept free of any storage or browser import so the API routes, the page and the vault
 * mini-game can all read exactly these numbers without dragging a driver into the module
 * graph. Because every one of them imports this file, they cannot disagree about what a
 * floor pays.
 *
 * The one import is `lib/site.js`, which is a constant — so the module stays safe to pull into a
 * browser bundle, which the vault mini-game does.
 */

import { SITE_URL } from './site.js';

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

/* ===================================================================== earning on X
 *
 * Two of the ways to earn are things done on X, and both are proved the same way: the player
 * hands over the link to the post they made, and `lib/x-verify.js` asks X about it. What makes a
 * post pay is **who wrote it** (the X account bound to this wallet) and **what it says** (it has
 * to carry our site link), and nothing else — see that module's header for what X will and will
 * not tell us.
 *
 * `X_CAMPAIGN_POST` is **server-side only**. The page never reads it: it renders the campaign
 * from `state.campaign`, which the API builds here. A client that read this constant would get
 * `undefined` (Next only inlines `NEXT_PUBLIC_*` into the bundle) and would quietly render a task
 * with no post to quote — the kind of bug this comment exists to prevent.
 */

/** What the engagement task pays, once per wallet per campaign post. */
export const X_ENGAGEMENT_REWARD = Number(process.env.X_ENGAGEMENT_REWARD || 500);

/** The campaign post players quote-retweet. Empty means the task is not configured at all. */
export const X_CAMPAIGN_POST = (process.env.X_CAMPAIGN_POST || '').trim();

/** An optional campaign tag, accepted *instead of* the site link when we set one. */
export const X_CAMPAIGN_KEYWORD = (process.env.X_CAMPAIGN_KEYWORD || '').trim();

/** How many times a pending submission is re-checked before it is left expired, not credited. */
export const X_VERIFY_MAX_ATTEMPTS = 20;

/** And how long between those checks, so a player cannot turn the button into an X-shaped load test. */
export const X_VERIFY_MIN_GAP_SECONDS = 60;

/**
 * The host a post has to mention. Derived from the site's own URL rather than typed again, so a
 * custom domain moves the rule with it instead of silently invalidating every honest post.
 */
export const SITE_LINK_HOST = (() => {
    try {
        return new URL(SITE_URL).host.toLowerCase();
    } catch {
        return 'dungeon-knights.vercel.app';
    }
})();

/** The campaign post's status id, out of whatever URL was configured, or null. */
export function campaignPostId() {
    const match = /\/status(?:es)?\/(\d{5,25})/.exec(X_CAMPAIGN_POST);
    return match ? match[1] : null;
}

/**
 * Task ids. The campaign's carries the post's id, so publishing a second post later creates a
 * second payable task instead of a second claim on the first one. The share's is a **stable** id
 * and the UTC day lives inside its record: a per-day id would make yesterday's pending submission
 * invisible today — it would read as "never submitted" instead of expiring with a sentence about
 * the day that ended.
 */
export function campaignTaskId() {
    const id = campaignPostId();
    return id ? `x:${id}` : null;
}

export function shareTaskId() {
    return 'share';
}
