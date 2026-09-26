/**
 * The reels at `/redeem` — what the three columns can land on, and what one spin lands on.
 *
 * Pure and React-free on purpose. This is the *rule* of the game — three of a kind pays, and no
 * loss may look like one — and a rule that lives inside a client component can only be read by the
 * harness as text. Out here `tools/check-redeem.js` imports it and holds both properties over every
 * seed instead of trusting one example of each.
 *
 * The symbols come from `lib/knights.js`, so the wheel turns on the same five portraits the roster
 * does and there is no second list of image paths to keep in step.
 */

import { KNIGHT_PFP, RARITY } from './knights.js';

/** The five tiers, in the order the roster lists them. */
export const TIERS = Object.keys(KNIGHT_PFP);

export function knightTile(tier) {
    return { key: `knight-${tier}`, kind: 'knight', pfp: KNIGHT_PFP[tier], label: RARITY[tier].name };
}

/**
 * What a reel can land on: **five knights and nothing else.**
 *
 * The first version put a card tile on each reel, so a win spelled out `GOOGLE PLAY` three times.
 * It read badly — a wall of the same three words where the faces belong — and it gave the machine a
 * second kind of symbol it did not need. The card a win pays is named in the sentence under the
 * reels and printed on the code plate; the reels only have to say *whether* the three columns agree,
 * and a portrait repeated is the clearest way a wheel can say that.
 */
export const LIST = TIERS.map(knightTile);

/** Twice through, so the roll loops without a seam. */
export const STRIP = [...LIST, ...LIST];

/**
 * Where each column rests before the first spin.
 *
 * Three *different* knights, named rather than numbered so a re-order of `KNIGHT_PFP` cannot
 * quietly leave two columns idling on the same face. A machine at rest showing one face three
 * times reads as a jackpot nobody paid for — and here it would read that way, because three of a
 * kind is exactly what a win looks like.
 */
export const IDLE = ['knight-EPIC', 'knight-COMMON', 'knight-RARE'];

/** A tile by its key, or `null` — the one lookup the reels need. */
export function tileOf(key) {
    return LIST.find((tile) => tile.key === key) || null;
}

/** The five keys, in the strip's own order — what `landedKeys` draws from. */
const KNIGHTS = TIERS.map((tier) => `knight-${tier}`);

/** Where a key sits in the strip's first pass, or `-1` if it is not a symbol at all. */
export function indexOf(key) {
    return LIST.findIndex((tile) => tile.key === key);
}

/**
 * What the three reels land on — which is also the rule the game pays by.
 *
 * A slot machine pays on three of a kind and on nothing else, so a **win** is the same portrait in
 * all three windows and a **loss** is a pair with the third reel odd. Two properties fall out of
 * that, and both are load-bearing:
 *
 *   - **A loss is never three of a kind.** Three matching knights on a spin that pays nothing is a
 *     page lying about a payout, and it is the one shape this function must not be able to produce
 *     — so the pair is a knight and the odd reel is forced to a *different* knight, which makes the
 *     shape total rather than merely likely.
 *   - **A win is three of the same portrait.** Any of the five can be the one that lands three
 *     times, so no tier is a second-class symbol and none of them is a prediction about the prize:
 *     which card was drawn is the server's business and it is said in the sentence under the reels.
 *
 * The arrangement is seeded from the spin's own record rather than from a second roll, so a replay
 * of one spin lands on the same tiles while two spins differ. It rides on `at` — the timestamp the
 * server wrote when it charged the wallet — and two seeds in three put the odd reel last, which is
 * where a near miss belongs.
 */
export function landedKeys(outcome, payload) {
    const n = KNIGHTS.length;
    const seed = Math.abs(Math.floor(Number(payload?.at) || 0));
    const first = KNIGHTS[seed % n];
    if (outcome !== 'tryAgain') return [first, first, first];
    // `1 + k` for `k` in `0 … n-2` is never a multiple of `n`, so the odd reel cannot be the pair.
    const odd = KNIGHTS[(seed % n + 1 + Math.floor(seed / n) % (n - 1)) % n];
    const keys = [first, first, first];
    keys[Math.floor(seed / (n * (n - 1))) % 3] = odd;
    return keys;
}

/**
 * Does what is on the reels pay?
 *
 * Read off the tiles rather than off the outcome, deliberately: the payline lights because three
 * columns match, which is the same rule the player is reading off the machine — so if the reels and
 * the answer ever disagreed, the lights would follow the reels.
 */
export function threeOfAKind(landed) {
    return Boolean(landed?.[0]) && landed[0] === landed[1] && landed[1] === landed[2];
}
