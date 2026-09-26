/**
 * The wheel at `/redeem` — the one place points are *spent*.
 *
 * Three reels of knight PFPs, a thousand points a spin, and a gift card one time in three. The
 * three facts that matter are all decided here, on the server, and the page is told the answer
 * rather than asked for it:
 *
 *   - **The outcome is drawn here.** `crypto.randomInt` over `REDEEM_WEIGHTS`, so "1 in 3" is a
 *     property of a table in `lib/points-config.js` rather than of a client that could be edited.
 *     The page learns the outcome with the spin and animates the reels to it, which is the only
 *     way a wheel can be honest: it cannot show what the server did not decide.
 *   - **The code leaves the pool before the wallet is charged.** The pool document is one write —
 *     a code is popped and recorded as given in the same call — so a crash between the two steps
 *     can only ever lose a code, never hand the same one to two winners. The charge itself is a
 *     single `updateWallet` (`spendPoints`), with the code recorded on the wallet in that same
 *     write, so a win and its code cannot disagree.
 *   - **Nothing is charged that cannot be paid.** A prize with an empty pool refuses the spin
 *     before any money moves, rather than silently converting a win into a "try again" and
 *     changing the odds the page prints.
 *
 * And twice over, because a player retries: a wallet that is charged twice for one spin is the
 * failure nobody forgives. `spin` holds the wallet's own `claimGuard` for the whole sequence, and
 * the browser's spin id is recorded on the wallet, so a second request with the same id is
 * answered from the record instead of from the pool.
 *
 * The pool itself never reaches a browser: it lives in the store under one key, written by
 * `tools/redeem-codes.js`, and `redeemView` hands a player their own codes and nothing else —
 * `tools/check-redeem.js` proves that with sentinel codes planted in the pool.
 */

import crypto from 'crypto';
import {
    REDEEM_OUTCOMES,
    REDEEM_PRIZES,
    REDEEM_SPIN_COST,
    REDEEM_WEIGHTS,
    redeemTable,
} from './points-config.js';
import {
    blankWallet,
    claimGuard,
    documentRead,
    documentWrite,
    getWallet,
    normaliseAddress,
    releaseGuard,
} from './points-store.js';
import { spendPoints } from './points-program.js';

/** The one key the gift codes live under: `{ amazon: [], google: [], given: [] }`. */
export const REDEEM_POOL_KEY = 'dk:points:redeem';

/** How many spins a wallet's record keeps, and how many of them the page lists. */
const REDEEM_RECORD_LIMIT = 40;
const REDEEM_SHOWN = 12;

/**
 * How many handed-out codes the pool document keeps as its ledger.
 *
 * The pool document is small and read on every spin, so `given` is capped — but generously: it is
 * the record of what left the pool, and the tool that tops the pool up reads it back to say how
 * many codes have gone out and to whom. A code that falls off the end is still on the wallet that
 * won it, which is the copy that matters to the player.
 */
const GIVEN_LIMIT = 500;

/** A spin holds this for as long as it takes; the TTL is the safety valve if a process dies. */
const SPIN_GUARD_TTL_SECONDS = 60;

// ------------------------------------------------------------------------------------ the pool
function codeList(value) {
    return Array.isArray(value) ? value.filter((code) => typeof code === 'string' && code.trim()) : [];
}

/** The stored pool, coerced: three arrays, whatever a hand-edited document happens to hold. */
export async function readPool() {
    const raw = await documentRead(REDEEM_POOL_KEY);
    const doc = raw && typeof raw === 'object' ? raw : {};
    return {
        amazon: codeList(doc.amazon),
        google: codeList(doc.google),
        given: Array.isArray(doc.given) ? doc.given : [],
    };
}

/** Write the pool back, trimming the ledger to what it keeps. */
export async function writePool(pool) {
    const doc = {
        amazon: codeList(pool?.amazon),
        google: codeList(pool?.google),
        given: (Array.isArray(pool?.given) ? pool.given : []).slice(-GIVEN_LIMIT),
    };
    await documentWrite(REDEEM_POOL_KEY, doc);
    return doc;
}

/** How many codes are left for each card — what the page shows and a spin needs. */
export function stockOf(pool) {
    const out = {};
    for (const prize of REDEEM_PRIZES) out[prize] = codeList(pool?.[prize]).length;
    return out;
}

/** Both cards stocked? A spin needs every prize it could draw to be payable. */
export function poolReady(pool) {
    const stock = stockOf(pool);
    return REDEEM_PRIZES.every((prize) => stock[prize] > 0);
}

/**
 * A code that looks like one, so the tool that loads them can refuse a line that was pasted badly
 * (a whole email, a stray space, a truncated row). Deliberately loose: gift-card formats differ by
 * country and by issuer, and the job here is to catch a mistake, not to out-guess Amazon.
 */
export function looksLikeCode(value) {
    const code = String(value || '').trim();
    return /^[A-Za-z0-9][A-Za-z0-9-]{5,39}$/.test(code);
}

// ----------------------------------------------------------------------------------- the draw
/**
 * One outcome, in proportion to the weights.
 *
 * `randomInt` is a seam for `tools/check-redeem.js`, which has to be able to ask for a win on
 * purpose; nothing in the application passes it, so a real spin is drawn by `crypto.randomInt` —
 * the same generator Node uses for keys, not `Math.random`.
 */
export function pickOutcome(randomInt = crypto.randomInt) {
    const table = redeemTable();
    const total = table.reduce((sum, row) => sum + row.weight, 0);
    let roll = randomInt(total);
    for (const row of table) {
        if (roll < row.weight) return row.key;
        roll -= row.weight;
    }
    // Unreachable while the weights are positive — but a zero-weighted row at the end of the table
    // must not return `undefined` and be read as a prize by whoever asked.
    return 'tryAgain';
}

// ------------------------------------------------------------------------------------ the spin
function newSpinId() {
    return `spin_${crypto.randomBytes(8).toString('hex')}`;
}

/** The answer to a spin id already on the wallet: the record, not a second charge. */
function replayOf(entry, wallet) {
    return {
        outcome: entry.outcome,
        prize: entry.prize || null,
        code: entry.code || null,
        cost: Number(entry.cost) || REDEEM_SPIN_COST,
        points: Math.max(0, Math.floor(Number(wallet?.points) || 0)),
        spinId: entry.id || null,
        at: entry.at || null,
        replay: true,
    };
}

/**
 * Play one spin for `address`.
 *
 * Returns `{ outcome, prize, code, cost, points, spinId, at, replay? }` on success, or
 * `{ error }` — `not_enough_points`, `out_of_stock`, `busy`, `not signed in` — with **nothing
 * charged** on every one of those paths. `randomInt` is the harness seam described on
 * `pickOutcome`.
 */
export async function spin(address, { spinId = '', randomInt = crypto.randomInt } = {}) {
    const key = normaliseAddress(address);
    if (!key) return { error: 'not signed in' };

    // The sequence guard. Everything below — the balance, the draw, the pool write, the charge —
    // has to happen without a second spin from the same wallet interleaving with it, and the store
    // offers no transaction to lean on, so this is the transaction.
    const guard = `redeem:spin:${key}`;
    if (!(await claimGuard(guard, SPIN_GUARD_TTL_SECONDS))) {
        return { error: 'busy', retryInSeconds: SPIN_GUARD_TTL_SECONDS };
    }

    try {
        const wallet = (await getWallet(key)) || blankWallet(key);
        const id = String(spinId || '').trim();

        // A spin id that is already on the wallet was answered once. Hand back the same answer:
        // a retried request must never cost a second thousand points, and it must hand back the
        // same code rather than a second one.
        if (id) {
            const seen = (Array.isArray(wallet.redeems) ? wallet.redeems : []).find((row) => row && row.id === id);
            if (seen) return replayOf(seen, wallet);
        }

        const points = Math.max(0, Math.floor(Number(wallet.points) || 0));
        if (points < REDEEM_SPIN_COST) {
            return { error: 'not_enough_points', points, needed: REDEEM_SPIN_COST };
        }

        // Read before the draw, and refuse if either card is out of stock: with one pool empty the
        // honest answer is "not right now", not a wheel whose real odds have quietly changed.
        const pool = await readPool();
        if (!poolReady(pool)) {
            return { error: 'out_of_stock', stock: stockOf(pool), needed: REDEEM_SPIN_COST };
        }

        const outcome = pickOutcome(randomInt);
        const won = outcome !== 'tryAgain';
        const code = won ? pool[outcome].shift() : null;
        // Unreachable given the check above; enforced here anyway, because this is where a code
        // would leave the pool, and an invariant checked only where it is convenient is not one.
        if (won && !code) {
            return { error: 'out_of_stock', stock: stockOf(pool), needed: REDEEM_SPIN_COST };
        }

        const entry = {
            id: id || newSpinId(),
            at: Date.now(),
            outcome,
            prize: won ? outcome : null,
            code: code || null,
            cost: REDEEM_SPIN_COST,
        };

        // The code leaves the pool first, with the ledger row that records it, in one write.
        if (won) {
            pool.given = [...pool.given, { ...entry, address: key }];
            await writePool(pool);
        }

        // Then the charge, with the spin recorded on the wallet in the same write.
        const paid = await spendPoints(key, REDEEM_SPIN_COST, 'redeem_spin', (doc) => {
            const rows = Array.isArray(doc.redeems) ? doc.redeems.slice() : [];
            rows.push(entry);
            doc.redeems = rows.slice(-REDEEM_RECORD_LIMIT);
        });

        if (!paid.ok) {
            // Not reachable while this guard is held — the balance was read under it — but if it
            // ever happens the code has already left the pool, and a code nobody was charged for
            // belongs back in it.
            if (won) {
                pool[outcome].unshift(code);
                pool.given = pool.given.slice(0, -1);
                await writePool(pool);
            }
            return { error: paid.error || 'not_enough_points', points: paid.points ?? points, needed: REDEEM_SPIN_COST };
        }

        return {
            outcome,
            prize: entry.prize,
            code: entry.code,
            cost: REDEEM_SPIN_COST,
            points: paid.points ?? null,
            spinId: entry.id,
            at: entry.at,
            stock: stockOf(pool),
        };
    } finally {
        await releaseGuard(guard);
    }
}

// ------------------------------------------------------------------------------------ the view
/**
 * Everything `/redeem` renders for the signed-in wallet.
 *
 * Only this wallet's own codes: `prizes` carries counts, `spins` carries the rows this address
 * won, and the pool's codes are not in the payload at any depth. That is the property the harness
 * asserts with sentinel codes rather than trusting.
 */
export async function redeemView(address) {
    const key = normaliseAddress(address);
    if (!key) return null;

    const wallet = (await getWallet(key)) || blankWallet(key);
    const pool = await readPool();
    const stock = stockOf(pool);
    const rows = (Array.isArray(wallet.redeems) ? wallet.redeems.slice() : []).reverse();

    return {
        address: key,
        points: Math.max(0, Math.floor(Number(wallet.points) || 0)),
        prizes: REDEEM_PRIZES.map((prize) => ({
            key: prize,
            name: REDEEM_OUTCOMES[prize].name,
            short: REDEEM_OUTCOMES[prize].short,
            left: stock[prize],
        })),
        spins: rows.slice(0, REDEEM_SHOWN).map((row) => ({
            id: row.id || null,
            at: row.at || null,
            outcome: row.outcome || 'tryAgain',
            prize: row.prize || null,
            code: row.code || null,
            cost: Number(row.cost) || REDEEM_SPIN_COST,
        })),
        spinCount: rows.length,
        // The weight table as numbers, so a page (or a support answer) can print the rule without
        // re-deriving it from the copy.
        weights: { ...REDEEM_WEIGHTS },
    };
}
