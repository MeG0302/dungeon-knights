/**
 * The daily capsule draw: which wallets won, and the record of it.
 *
 * Ten capsules a day, to the top ten of **that UTC day's** board. The board itself is written by
 * `credit` (see `lib/points-store.js#bumpDailyPoints`); this file is what reads it, decides the
 * winners, hands out the wins and writes down what happened.
 *
 * ## Two properties this file is built around
 *
 * **A day settles once, and settling it twice changes nothing.** `drawDay` takes a per-day guard and
 * checks the record first, so a cron run, a page load and a hand-run command racing each other end
 * with one draw. The award itself is guarded *again*, inside the wallet write, on the day it is for:
 * a wallet that already holds a capsule for that day is left alone. That second guard is what makes
 * a failed record write harmless — the next settlement re-derives the same winners from the same
 * (now closed) board and finds them already paid, so the record heals and nobody is paid twice.
 *
 * **Nothing depends on the cron.** `settleDraws` walks every day that has no record yet, oldest
 * first, and is called from the draw endpoint *and* from the page read that renders a wallet. A cron
 * that never fires, fires late, or fires on a deployment with no KV configured costs a player
 * nothing: the next page load settles the days that are owed. The endpoint exists so the common case
 * is prompt, not so the feature works.
 *
 * ## Why there is no randomness
 *
 * A draw that picks by luck needs a seed nobody can lean on, and a seed that can be leaned on is a
 * fairness argument this project cannot yet win. The board is close to a cap — three floors, a streak,
 * a share — so the honest sort is points first, and then **who got there first**. A tie broken by the
 * clock is a rule a player can plan around, and it needs no proof.
 */

import {
    DRAW_CAPSULE, DRAW_SIZE, GIVEAWAY_DAY_ONE, dayMarker, isDayKey,
    nextDayKey, previousDayKey, programDay, todayKey,
} from './points-config.js';
import {
    claimGuard, dailyKeys, documentDelete, documentRead, documentWrite,
    pruneDailyKeys, releaseGuard, topWalletsOnDay, updateWallet,
} from './points-store.js';

/** One document, on the store's existing drivers: the dev file, the KV, or memory. */
const DRAWS_KEY = 'dk:points:draws';

/** What the announcements tab reads. Written here, read by the page and nothing else. */
const NEWS_KEY = 'dk:points:news';

/**
 * How far down the board we read, to break ties with.
 *
 * The ten winners are fetched, and a tie at the cut line is real — a full daily run pays the same to
 * everyone who completes it — so the read goes deeper than the prize. Three times the size is enough
 * that the tenth place is settled by the clock rather than by whichever address Redis happened to
 * return first, and it is one bounded read either way.
 */
const DRAW_ROWS = DRAW_SIZE * 3;

/** How much history the store keeps. Sixty days of draws, forty announcements. */
const DRAWS_KEPT = 60;
const NEWS_KEPT = 40;

/** A ceiling on one settlement pass, so a wrong `firstDay` cannot walk for years. */
const MAX_DAYS_PER_SETTLE = 400;

/** The blank document, so an unreadable file degrades to "nothing drawn yet" instead of a throw. */
function blankDraws() {
    return { firstDay: null, draws: [] };
}

/**
 * The winners, from the day's rows.
 *
 * **Pure**, and that is the point: an ordering rule that decides who is paid should be checkable
 * without a store, a clock or a deployment. Highest points first; then whoever reached their total
 * first (`at`); then by address, which is arbitrary but stable, so two runs over the same rows can
 * never disagree about who took the tenth capsule. Rows with nothing earned are dropped rather than
 * ranked last — a wallet that did not play has no place on the board.
 */
export function pickWinners(rows, size = DRAW_SIZE) {
    return (Array.isArray(rows) ? rows : [])
        .map((row) => ({
            address: String(row?.address || '').toLowerCase(),
            points: Math.max(0, Math.floor(Number(row?.points) || 0)),
            at: Number(row?.at) || 0,
            handle: row?.handle || null,
            handleProved: row?.handleProved === true,
        }))
        .filter((row) => row.address && row.points > 0)
        .sort((a, b) => (b.points - a.points)
            || (a.at - b.at)
            || (a.address < b.address ? -1 : a.address > b.address ? 1 : 0))
        .slice(0, Math.max(0, Math.floor(Number(size) || DRAW_SIZE)));
}

/** The draws document, repaired into a shape a caller can trust. */
async function readDraws() {
    const raw = await documentRead(DRAWS_KEY);
    if (!raw) return blankDraws();
    try {
        const parsed = JSON.parse(raw);
        const draws = Array.isArray(parsed?.draws) ? parsed.draws.filter((d) => isDayKey(d?.day)) : [];
        return { firstDay: isDayKey(parsed?.firstDay) || null, draws };
    } catch {
        // A corrupted document is not a reason to stop paying: the day boards are the facts, and the
        // record can be rebuilt from them by settling again.
        console.warn('[points-draw] the draws document is unreadable — rebuilding from the day boards');
        return blankDraws();
    }
}

async function writeDraws(state) {
    const draws = [...state.draws].sort((a, b) => (a.day < b.day ? -1 : 1)).slice(-DRAWS_KEPT);
    await documentWrite(DRAWS_KEY, JSON.stringify({ firstDay: state.firstDay, draws }, null, 2));
    return draws;
}

/**
 * Append one day's record, under a short doc guard.
 *
 * The guard is not about the day — that has its own — it is about the *file*: two days settling at
 * once in two instances would otherwise both read the document and one append would vanish. The
 * retry is deliberate rather than a wait-and-hope: the write it is racing is a few hundred bytes, and
 * a lost record is not a lost payment (the award is guarded on the wallet), so three short attempts
 * then a loud log is the right amount of effort.
 */
async function recordDraw(draw) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        if (await claimGuard('draws-doc', 20)) {
            try {
                const state = await readDraws();
                if (!state.draws.some((d) => d.day === draw.day)) {
                    state.draws.push(draw);
                    await writeDraws(state);
                }
                return draw;
            } finally {
                // Released rather than left to the TTL: a guard held for its full twenty seconds is a
                // guard that fails the *next* day in the same process, which is every day of a
                // catch-up pass — and on the document drivers, every day of a single harness run.
                await releaseGuard('draws-doc');
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
    }
    console.error(`[points-draw] could not write the record for ${draw.day}; the awards are made and the next settlement will rewrite it`);
    return draw;
}

/** One announcement per draw, so the tab's record is written by the same event that paid. */
async function recordNews(draw) {
    const raw = await documentRead(NEWS_KEY);
    let list = [];
    try {
        const parsed = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) list = parsed;
    } catch {
        list = [];
    }
    if (list.some((entry) => entry?.id === `draw:${draw.day}`)) return;

    const short = draw.winners.length < DRAW_SIZE;
    list.push({
        id: `draw:${draw.day}`,
        day: draw.day,
        kind: 'draw',
        at: draw.at,
        title: `${dayMarker(draw.day)} draw settled`,
        body: draw.winners.length === 0
            ? 'No wallet earned on that day, so no capsule was drawn.'
            : `${draw.winners.length}${short ? ` of ${DRAW_SIZE}` : ''} capsule${draw.winners.length === 1 ? '' : 's'} went to the wallets topping that day's board.`,
    });
    await documentWrite(NEWS_KEY, JSON.stringify(list.slice(-NEWS_KEPT), null, 2));
}

/**
 * Hand one winner their capsule for a day.
 *
 * The day is checked **inside the write**, which is the only place it can be checked: two settlements
 * of the same day are one write apart, and a read-then-write would pay twice on the second. Returns
 * whether this call is the one that paid it.
 */
async function awardCapsule(day, winner, dayNumber) {
    const at = new Date().toISOString();
    let awarded = false;
    await updateWallet(winner.address, (w) => {
        w.capsules = w.capsules && typeof w.capsules === 'object' ? w.capsules : {};
        if (w.capsules[day]) return w;
        w.capsules[day] = {
            day,
            dayNumber,
            capsule: DRAW_CAPSULE,
            points: winner.points,
            rank: winner.rank ?? null,
            wonAt: at,
            // Filled by the claim path, never here: winning is not registering, and a prize whose
            // holder has not proved the wallet is a prize that stays on this list until they do.
            registeredAt: w.registration?.at || null,
            claimedAt: null,
            claimSigHash: null,
            formSubmittedAt: null,
            status: 'won',
        };
        w.capsuleNotice = day;
        awarded = true;
        return w;
    });
    return awarded;
}

/**
 * The giveaway's first day.
 *
 * The earliest day the store actually holds a board for — because the daily tally cannot exist
 * before the day this code shipped, so the earliest one on record *is* the start. `GIVEAWAY_DAY_ONE`
 * overrides it for holding the giveaway back or starting it on an announced date. Once decided it is
 * written into the document, so it does not move when old boards are pruned.
 */
async function resolveFirstDay(state) {
    if (state.firstDay) return state.firstDay;
    if (isDayKey(GIVEAWAY_DAY_ONE)) return GIVEAWAY_DAY_ONE;
    const keys = await dailyKeys();
    return keys[0] || todayKey();
}

/** Every day between the giveaway's start and yesterday that has no record yet, oldest first. */
async function dueDays(state, now = new Date(), maxDays = MAX_DAYS_PER_SETTLE) {
    const today = todayKey(now);
    const first = await resolveFirstDay(state);
    const last = previousDayKey(today);
    const cap = Math.max(1, Math.floor(Number(maxDays) || MAX_DAYS_PER_SETTLE));

    const drawn = new Set(state.draws.map((d) => d.day));
    const due = [];
    let day = first;
    while (day <= last && due.length < cap) {
        if (!drawn.has(day)) due.push(day);
        day = nextDayKey(day);
    }
    return { first, due };
}

/**
 * Settle one day. Idempotent, guarded, and safe to call for a day from any direction.
 *
 * Returns the day's record — `{ day, winners, ... }` — with `already: true` when it was settled
 * before, or `{ busy: true }` when another process holds the guard. A caller that gets `busy` should
 * stop rather than push on: the days are walked in order, so the guard is a queue.
 */
export async function drawDay(day) {
    const key = isDayKey(day);
    if (!key) return { error: 'A draw needs a UTC day key (YYYY-MM-DD).', code: 'bad-day' };

    const state = await readDraws();
    const existing = state.draws.find((d) => d.day === key);
    if (existing) return { ...existing, already: true };

    if (!(await claimGuard(`draw:${key}`, 900))) return { busy: true, day: key };

    try {
        return await settleDay(key);
    } finally {
        // Released rather than left to its TTL. The guard's job is to serialise two settlements of the
        // same day, not to rate-limit one: held for fifteen minutes it would make an explicit re-run
        // (`?day=`) silently do nothing, and the record check behind it is what actually stops a
        // second payout, so letting the next caller through the moment this one is done is safe.
        await releaseGuard(`draw:${key}`);
    }
}

/** The guarded half of `drawDay`: re-check the record, rank the board, pay, and write it down. */
async function settleDay(key) {
    // Re-read behind the guard: whoever held it before may have written this very day.
    const settled = (await readDraws()).draws.find((d) => d.day === key);
    if (settled) return { ...settled, already: true };

    const dayNumber = programDay(key);
    const rows = await topWalletsOnDay(key, DRAW_ROWS);
    // The store's rows use its own vocabulary (`dayPoints`); `pickWinners` takes the three facts the
    // ordering is actually about. Mapped explicitly rather than aliasing the field, so the pure rule
    // does not have to know where a row came from.
    const winners = pickWinners(rows.map((row) => ({
        address: row.address,
        points: row.dayPoints,
        at: row.at,
        handle: row.handle,
        handleProved: row.handleProved,
    })), DRAW_SIZE);

    let awarded = 0;
    for (const [index, winner] of winners.entries()) {
        const paid = await awardCapsule(key, { ...winner, rank: index + 1 }, dayNumber);
        if (paid) awarded += 1;
    }

    const draw = {
        day: key,
        dayNumber,
        at: new Date().toISOString(),
        size: DRAW_SIZE,
        capsule: DRAW_CAPSULE,
        // How many wallets were on the board at all, so the record says whether ten was a cut or the
        // whole field. It is a fact about a closed day, not a running total of players.
        qualifiers: rows.length,
        awarded,
        winners: winners.map((winner, i) => ({ rank: i + 1, ...winner })),
    };
    await recordDraw(draw);
    await recordNews(draw);
    return draw;
}

/**
 * Settle everything owed, oldest first.
 *
 * Stops the moment a day is held by somebody else, because the days are dependent: the record is
 * walked in order, and the process that holds the guard for the earliest day is the one that should
 * carry on. Returns what it settled, so a cron's response says what it did rather than "ok".
 */
export async function settleDraws({ now = new Date(), maxDays = MAX_DAYS_PER_SETTLE } = {}) {
    const state = await readDraws();
    const { first, due } = await dueDays(state, now, maxDays);
    if (!due.length) return { settled: [], firstDay: first, pending: 0 };

    if (!state.firstDay) {
        // Persist the start before drawing, so a crash mid-pass cannot move it.
        await writeDraws({ firstDay: first, draws: state.draws });
    }

    const settled = [];
    for (const day of due) {
        const result = await drawDay(day);
        if (result?.busy) return { settled, firstDay: first, pending: due.length - settled.length, busy: day };
        settled.push({ day, awarded: result.awarded ?? 0, winners: result.winners?.length ?? 0 });
    }

    // Only when something was actually drawn: the boards are the draw's input, and keeping a month of
    // them costs nothing while keeping a year of them would.
    await pruneDailyKeys(previousDayKey(todayKey(now)), 35);
    return { settled, firstDay: first, pending: 0 };
}

/** The most recent settled day, or null before the first draw. */
export async function latestDraw() {
    const state = await readDraws();
    return state.draws.length ? state.draws[state.draws.length - 1] : null;
}

/** The last `limit` draws, newest first. */
export async function recentDraws(limit = 7) {
    const state = await readDraws();
    return state.draws.slice(-Math.max(1, Math.floor(Number(limit) || 7))).reverse();
}

/** The announcements feed, newest first. */
export async function newsFeed(limit = 12) {
    const raw = await documentRead(NEWS_KEY);
    if (!raw) return [];
    try {
        const list = JSON.parse(raw);
        if (!Array.isArray(list)) return [];
        return list.slice(-Math.max(1, Math.floor(Number(limit) || 12))).reverse();
    } catch {
        return [];
    }
}

/** Test/dev helper: forget every draw, so a harness can settle the same day again. */
export async function resetDraws() {
    await documentDelete(DRAWS_KEY);
    await documentDelete(NEWS_KEY);
}

/**
 * Today's board, as a page renders it.
 *
 * The same shape the lifetime leaderboard uses — a rank, a name, points and a `you` flag — so the two
 * boards are read the same way, and nothing here reports a total number of players, which is a
 * deliberate absence everywhere else on this site.
 */
export async function dayBoard(day, limit = DRAW_SIZE, me = null) {
    const key = isDayKey(day) || todayKey();
    const rows = await topWalletsOnDay(key, Math.max(1, Math.floor(Number(limit) || DRAW_SIZE)));
    const mine = me ? String(me).toLowerCase() : null;
    return rows.map((row, i) => ({
        rank: i + 1,
        address: row.address,
        short: `${row.address.slice(0, 6)}…${row.address.slice(-4)}`,
        handle: row.handle,
        handleProved: row.handleProved,
        points: row.dayPoints,
        isYou: !!mine && row.address === mine,
    }));
}
