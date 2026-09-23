/**
 * Starting the X link, when the player may not be signed in to Privy at all.
 *
 * THE BUG THIS EXISTS FOR
 * ---------------------
 * `linkTwitter()` was called inside a `try` and its result trusted, because Privy's own types say:
 *
 *     linkTwitter: () => void;
 *
 * The runtime disagrees. For a player who is *not* authenticated it returns a **rejecting promise**
 * and throws `User must be authenticated before linking an account` as an unhandled rejection — so
 * the `try` caught nothing, the console filled with an error the player could not act on, and the
 * page was told the link had started ("Finish linking X in the Privy window…") when nothing had
 * opened. A type that promises `void` is not a promise that never rejects.
 *
 * The other half is that "not authenticated" is a normal state here, not an error. `connected` on
 * the Points page means *a wallet is available* — which for an injected wallet needs no Privy login
 * at all. Linking X to nobody is impossible, so that player is sent to sign in — and because X is an
 * enabled login method, signing in with X links the account in the same step.
 *
 * The decision lives in this module rather than in the React bridge for the same reason the binding
 * rule moved to `lib/x-binding.js`: `app/privy-bridge.js` is JSX inside a provider and cannot be
 * driven by a Node harness, so anything decided there can only be checked by grepping its source.
 */

/** The SDK's way of saying "there is no one to link this to". Matched loosely, on purpose. */
export function isAuthRequired(error) {
    return /must be authenticated|not authenticated|unauthenticated/i.test(String(error?.message || error || ''));
}

/**
 * The sentence a player gets when the link could not be started.
 *
 * Deliberately about what they can still do: the typed-handle path is not a consolation prize, it
 * binds the same account and is checked the same way on every post.
 */
export function describeLinkFailure() {
    return 'Could not start the X link. Type your handle below instead — it binds the same account.';
}

/**
 * Start the X link, whichever way is correct for the player in front of us.
 *
 * `linkTwitter` and `login` are the SDK's own functions, passed in so this can be driven with fakes.
 * Both are awaited whatever their types claim, and every failure comes back as
 * `{ ok: false, reason }` — this function never throws and never rejects, because an unhandled
 * rejection here is a page that looks frozen and says the opposite of what happened.
 *
 * Returns `{ ok: true, via: 'link' | 'login' }` — `via` says which flow was started, and that is all
 * anyone can honestly claim: Privy completes the flow in its own window and both `login` and
 * `linkTwitter` return before the player has finished with it. The page learns it landed from
 * `privyAuthChanged`.
 */
export async function startXLink({ authenticated, linkTwitter, login } = {}) {
    const openLogin = typeof login === 'function' ? login : null;

    try {
        if (authenticated && typeof linkTwitter === 'function') {
            await linkTwitter();
            return { ok: true, via: 'link' };
        }

        if (openLogin) {
            // `twitter` only: this request is about one account, and a modal offering every other
            // method as well makes the player hunt for the one the page asked them to link.
            await openLogin({ loginMethods: ['twitter'] });
            return { ok: true, via: 'login' };
        }

        return { ok: false, reason: describeLinkFailure() };
    } catch (error) {
        // The session lapsed between render and click, which is the other way to arrive at the SDK's
        // rejection. Signing in with X links it just the same, so it is retried rather than reported.
        if (openLogin && isAuthRequired(error)) {
            try {
                await openLogin({ loginMethods: ['twitter'] });
                return { ok: true, via: 'login' };
            } catch {
                return { ok: false, reason: describeLinkFailure() };
            }
        }

        console.warn('[privy] could not start the X link:', error?.message || error);
        return { ok: false, reason: describeLinkFailure() };
    }
}
