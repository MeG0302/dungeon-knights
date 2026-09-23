/**
 * Which X handle a wallet ends up with, and whether it was proved.
 *
 * WHAT THIS DECIDES
 * -----------------
 * A player binds one X account, and the binding is permanent — so the only question that matters is
 * *whose* account it is. Two things can say: the handle they typed, and the X account linked to
 * their Privy user (proved by a signed token). Everything below is the arithmetic of preferring the
 * stronger one without ever calling the weaker one proof.
 *
 * The rule lives here rather than in the route because the route imports `next/server`, which does
 * not resolve outside Next — so a decision made in the handler can only be checked by asserting its
 * source text. Moved out, it is exercised directly by `tools/check-x-bind.js`, against real ES256
 * tokens and a stubbed Privy, and the harness asserts the route still calls it.
 *
 * THE ONE CASE THAT USED TO BE A WALL
 * -----------------------------------
 * A valid token for a Privy user with **no X linked** was refused outright, with a sentence telling
 * the player to link X first. That refused exactly the players who used the app's own login, and the
 * page had promised the opposite two lines above the button ("a typed handle works the same"). It is
 * not a weaker position than arriving with no token at all — in both, nothing is known about any
 * handle — so both are answered the same way now: bind the handle the player typed, mark it
 * provisional, and let them prove it later.
 *
 * Nothing is loosened by that. Correctness of a binding is not what makes it safe: `bindX` in
 * `lib/points-program.js` keys a handle to one wallet ever, and every reward that depends on a post
 * checks the post's author against the bound handle. A handle nobody can post from earns nothing.
 *
 * `proofCode` is the honest word for the record and for the page. `ok` is deliberately never one of
 * its values: a token that proved *who the player is* has said nothing about a handle, and reporting
 * it as `ok` would read as "checked" in a log line.
 */

/** The typed claim, cleaned. Never trusted as evidence — only as the fallback identity. */
function claimedIdentity(claimed) {
    return {
        id: String(claimed?.id || '').trim(),
        username: String(claimed?.username || '').trim().replace(/^@/, ''),
    };
}

/** The X account Privy vouches for, or null when it named none we can use. */
function provedIdentity(proof) {
    if (!proof?.ok || !proof.twitter) return null;
    const identity = claimedIdentity(proof.twitter);
    return identity.username ? identity : null;
}

/**
 * Resolve who is being bound.
 *
 * `proof` is whatever the token check returned — `{ ok: false, code: 'bad-signature' }`,
 * `{ ok: true, twitter: null }`, or `{ ok: true, twitter: { id, username } }`. Every failure mode
 * falls through to the typed handle rather than stopping the binding, because a Privy outage is not
 * the player's problem and the handle is checked again on every post anyway.
 *
 * Returns:
 *   - `identity`       what to bind (possibly `{ id: '', username: '' }` — the caller refuses that)
 *   - `verified`       true only when Privy named the account
 *   - `proofCode`      `privy`, `privy-no-x`, or the token check's own code (`no-token`, `expired`, …)
 *   - `replacedClaim`  the typed handle and the proved one disagreed, and the proved one won
 */
export function resolveXIdentity({ claimed, proof } = {}) {
    const typed = claimedIdentity(claimed);
    const proved = provedIdentity(proof);

    if (proved) {
        return {
            identity: proved,
            verified: true,
            proofCode: 'privy',
            replacedClaim: Boolean(typed.username && typed.username.toLowerCase() !== proved.username.toLowerCase()),
        };
    }

    // A token that verified and still named no X account. Worth saying so — it is the one case where
    // linking X would upgrade a binding from checked-on-every-post to proved once — but it is a
    // provisional binding, not a refusal.
    const proofCode = proof?.ok ? 'privy-no-x' : (proof?.code || 'no-token');

    return {
        identity: typed,
        verified: false,
        proofCode,
        replacedClaim: false,
    };
}

/** The line for the server log when a binding ends up provisional. Never throws. */
export function describeBinding({ identity, proofCode }) {
    const handle = identity?.username ? `@${identity.username}` : '(no handle)';
    if (proofCode === 'privy-no-x') {
        return `${handle} — signed in with Privy, which has no X account linked to it`;
    }
    return `${handle} — ${proofCode}`;
}
