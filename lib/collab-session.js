/**
 * One way in: connect a wallet, then sign, then act.
 *
 * Both things a visitor can *do* on `/collab` need the same three steps — register for a giveaway,
 * ask for a collaboration — and both need the same proof, so the dance lives here once rather than
 * twice on one page. What it returns is the pair the API wants: the address, and the Points
 * Program's session token (`lib/points-session.js`), which is the only credential either route
 * accepts. Nothing else on the site needs to know it exists.
 *
 * Three behaviours worth stating, because they are the interesting part:
 *
 *   - **A saved address is not a session.** `readSession()` answers with a token; `savedAddress()`
 *     answers with the wallet this browser last used, which may never have signed. Both are consulted
 *     — a wallet that has already signed is not asked again — but only the token is ever sent
 *     anywhere. No storage key is read here: both of those live in `lib/points-client.js`, which owns
 *     them, and a second copy of a key name is how two modules drift apart.
 *   - **`connectWallet()` returning nothing is not a failure.** It returns `null` while the Privy
 *     modal is still open, and the sign-in that finishes it arrives later on `privyAuthChanged`. This
 *     function returns `null` in that case too, so a caller can quietly stop rather than report an
 *     error the visitor can see is not true.
 *   - **Re-signing is a parameter, not a retry loop.** A 401 means the session is gone — expired, or
 *     signed with a secret that changed under a redeploy — and one more signature is the whole fix.
 *     `force: true` is how a caller asks for that second signature.
 */

const sameAddress = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();

/**
 * The wallet module, pulled in lazily.
 *
 * Deliberately a dynamic import: `lib/points-client.js` reaches for `window` at call time, and this
 * keeps it out of the server render and out of the first chunk for a visitor who never presses
 * anything.
 */
export const walletModule = () => import('./points-client.js');

/** The token this browser already holds, if any — for the reads, which must never prompt. */
export async function tokenIfSigned() {
    const mod = await walletModule();
    return mod.readSession()?.token || null;
}

/**
 * Connect if there is nobody yet, sign if there is no session, and hand back `{ address, token }`.
 *
 * Returns `null` only when the visitor has to finish something themselves — the Privy modal is open,
 * or they closed it.
 */
export async function ensureSession({ address = null, force = false, onStep = () => {} } = {}) {
    const mod = await walletModule();

    let session = mod.readSession();
    let who = address || session?.address || mod.savedAddress();

    if (!who) {
        onStep('connect');
        who = await mod.connectWallet();
        if (!who) return null;
        session = mod.readSession();
    }

    if (!force && session?.token && sameAddress(session.address, who)) {
        return { address: session.address, token: session.token, fresh: false };
    }

    onStep('sign');
    await mod.signIn(who);
    session = mod.readSession();
    return { address: who, token: session?.token || null, fresh: true };
}
