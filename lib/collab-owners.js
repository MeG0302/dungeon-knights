/**
 * Who may decide a collab request.
 *
 * `/collab` lets a project *ask* to collaborate, and the thing that reads the asking is now a page
 * an owner works from rather than a terminal: `/collab/review` lists the requests and approves or
 * rejects them. That page is on the open host and its HTML says nothing, so the whole of its
 * authority is this file — the one place that answers *is this wallet the owner*.
 *
 * Three decisions:
 *
 *   - **A list in the environment, not in the code.** `COLLAB_OWNERS` is a comma-separated list of
 *     0x addresses. Somebody's wallet is a fact about a deployment, not about the repository, and an
 *     address hard-coded in a module is an address that survives the person leaving.
 *   - **Unset means nobody, and that is the default on purpose.** A missing variable must not mean
 *     *everyone* — that is the one failure that would let a stranger approve a giveaway — and it must
 *     not mean *the first person to sign in* either, which is only marginally better. Fail closed,
 *     say so on the page, and let the operator set the variable.
 *   - **It is not a secret, and it is still not in the browser.** A public address is public; what
 *     matters is that the *check* happens on the server, where `process.env` is. The owners module is
 *     imported by the route and the page only, and the client never sees the list — a browser that
 *     knew it could not do anything with it, but there is no reason to put it there.
 *
 * This is the same bargain `lib/points-session.js` makes for the signature: whoever holds the wallet
 * proves it by signing, and the server is the only thing that decides what that proof is worth.
 */

import { normaliseAddress } from './collab-store.js';

/**
 * The addresses in a `COLLAB_OWNERS`-shaped string, lower-cased and deduped.
 *
 * Pure, and exported, because *what a list of addresses means* is worth testing without an
 * environment: separators are tolerated rather than insisted on, a checksummed spelling and a
 * lower-cased one are the same wallet, and anything that is not an address is dropped instead of
 * breaking the ones around it. A typo in the variable therefore costs that one address and nothing
 * else — the page says how many are configured, so a list of one that should be two is visible.
 */
export function parseOwners(value) {
    const seen = new Set();
    for (const part of String(value ?? '').split(/[\s,;]+/)) {
        const address = normaliseAddress(part);
        if (address) seen.add(address.toLowerCase());
    }
    return [...seen];
}

/** The owners this deployment has. Read once, like every other driver decision in the project. */
export const COLLAB_OWNERS = Object.freeze(parseOwners(process.env.COLLAB_OWNERS || process.env.COLLAB_OWNER));

if (process.env.NODE_ENV === 'production' && !COLLAB_OWNERS.length) {
    console.warn('[collab] COLLAB_OWNERS is not set — nobody can review a collab request. '
        + 'Set it to a comma-separated list of 0x addresses to open /collab/review.');
}

/**
 * May this wallet decide a request?
 *
 * Case-insensitive, because an address is one address however a client spells its checksum, and
 * compared with `includes` over a normalized list rather than by regex, so the env var cannot
 * contain a pattern. Returns a boolean and never a reason: *which* addresses are allowed is the
 * operator's business, and a caller that could tell "not on the list" from "list is empty" is a
 * caller that could be used to probe it.
 */
export function isOwner(address) {
    const clean = normaliseAddress(address);
    return !!clean && COLLAB_OWNERS.includes(clean.toLowerCase());
}

/** How many owners are configured. The page prints it, so an unset variable is obvious rather than mysterious. */
export function ownerCount() {
    return COLLAB_OWNERS.length;
}
