/* ==========================================================================
   run-budget.js — the daily run budget, in one place.

   A clear is paid for with one run from **each** knight in the squad, and the run is
   spent when the reward is *claimed*, not when the dungeon falls. Two numbers therefore
   decide whether a squad may enter, and they live in different places:

     - `runsRemaining(id)` on the game contract — the claims a knight still has in the
       current reset-day. The chain's day rolls at 12:00 UTC, not at midnight
       (`currentDayIndex()` in `contracts/DungeonKnightsGameV4.sol`).
     - the runs finished today that have not been claimed yet, which this browser is
       holding in its own pending queue (`dungeon-session.js`).

   A run is playable exactly while `remaining - bankedToday > 0`. Claiming spends the
   claims and empties the queue in the same move, so that number does not move when a
   player claims — which is what makes "5/5 runs today" a fact about *play* rather than
   a guess about the payout. Without the subtraction a player banks five clears, claims
   them, and finds that the sixth is refused on chain with "No runs left today" after
   having already played it.

   Kept dependency-free and dual-exported on purpose: the dungeon, the roster and
   `tools/check-run-budget.js` all run *this* arithmetic, so the cap cannot be proved in
   a harness that the game does not actually use. The harness also reads the ladder back
   out of the Solidity source and the page config, so the tables cannot drift.
   ========================================================================== */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.RunBudget = api;
})(typeof self !== 'undefined' ? self : null, function () {
    'use strict';

    const RESET_HOUR_UTC = 12;
    const DAY_SECONDS = 86400;

    // The contract's `dailyCap` ladder, the fallback for a page whose `RARITY` table has
    // not loaded yet. `tools/check-run-budget.js` reads the same ladder out of
    // `contracts/DungeonKnightsGameV4.sol` and out of `public/config.js`, and refuses a
    // drift between the three.
    const CAPS = { COMMON: 5, UNCOMMON: 5, RARE: 4, EPIC: 3, LEGENDARY: 4 };

    /** The contract's reset-day index: days start at 12:00 UTC, not at midnight. */
    function dayIndexAt(timestampSeconds) {
        return Math.floor((toSeconds(timestampSeconds) - RESET_HOUR_UTC * 3600) / DAY_SECONDS);
    }

    /** Seconds since the epoch, from a millisecond stamp, a seconds stamp, or now. */
    function toSeconds(when) {
        if (when === undefined || when === null) return Math.floor(Date.now() / 1000);
        const n = Number(when);
        if (!Number.isFinite(n)) return Math.floor(Date.now() / 1000);
        return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
    }

    /** The knight's daily cap, from the page's own rarity table when it has one. */
    function capFor(tier, table) {
        const key = String(tier || '').toUpperCase();
        const row = table && table[key];
        const cap = row && Number(row.dailyRuns);
        if (Number.isFinite(cap) && cap > 0) return cap;
        return CAPS[key] || CAPS.COMMON;
    }

    /**
     * How many of today's finished runs one knight is still holding, unclaimed.
     * @param {Array} runs - pending runs: `[{ knightIds, clearedAt }]`, clearedAt in ms or s
     */
    function bankedFor(runs, knightId, now) {
        const day = dayIndexAt(toSeconds(now));
        const id = Number(knightId);
        let banked = 0;
        (runs || []).forEach((run) => {
            if (!run) return;
            if (dayIndexAt(run.clearedAt) !== day) return;
            if ((run.knightIds || []).map(Number).indexOf(id) !== -1) banked += 1;
        });
        return banked;
    }

    /**
     * Runs a knight can still start today, or `null` when the chain has not answered.
     * Null is not zero: an unread knight is unknown, and unknown must never read as
     * "exhausted" — the server and the contract are the real gate, and a wallet whose
     * RPC is down must not be locked out of its own game.
     */
    function playableFor(remaining, banked) {
        if (remaining === null || remaining === undefined || !Number.isFinite(Number(remaining))) return null;
        return Math.max(0, Number(remaining) - Number(banked || 0));
    }

    /** One line per knight, plus the squad's verdict — what every screen and the gate read. */
    function planFor(options) {
        const opts = options || {};
        const table = opts.table;
        const now = toSeconds(opts.now);
        const runs = opts.runs || [];
        const remainingById = opts.remainingById || {};

        const lines = (opts.knights || []).map((knight) => {
            const id = Number(knight.id === undefined ? knight.tokenId : knight.id);
            const tier = String(knight.tier || (knight.rarity && knight.rarity.tier) || 'COMMON').toUpperCase();
            const raw = remainingById[id];
            const known = raw !== null && raw !== undefined && Number.isFinite(Number(raw));
            const banked = bankedFor(runs, id, now);
            const playable = playableFor(known ? Number(raw) : null, banked);
            return {
                id,
                tier,
                cap: capFor(tier, table),
                remaining: known ? Number(raw) : null,
                banked,
                playable,
                known,
                exhausted: playable === 0,
            };
        });

        const answered = lines.filter((line) => line.known);
        return {
            day: dayIndexAt(now),
            lines,
            // The squad enters while every knight can still pay for the run. `blocked` is
            // the knights the chain said are spent; `unknown` is the ones it did not answer
            // for, which hold nothing back.
            blocked: lines.filter((line) => line.exhausted).map((line) => line.id),
            unknown: lines.filter((line) => !line.known).map((line) => line.id),
            // The squad's own budget: the smallest playable count among its knights.
            playable: answered.length ? Math.min(...answered.map((line) => line.playable)) : null,
        };
    }

    return { RESET_HOUR_UTC, CAPS, dayIndexAt, toSeconds, capFor, bankedFor, playableFor, planFor };
});
