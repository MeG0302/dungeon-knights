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
 * A SECOND RULE LIVES HERE
 * ------------------------
 * *Which* flow is the right one depends on the player, and it is not always X. A browser that is
 * already playing with a wallet of its own — an extension holding the address this site has been
 * using — must sign in **with that wallet** first. Privy builds an embedded wallet for a user who
 * arrives without one (the app's own config, `createOnLogin: 'users-without-wallets'` in
 * `app/providers.js`), and a player arriving through X is exactly such a user. So linking X from
 * that state quietly mints a *second* wallet for someone who already had one — a wallet the site
 * would then have to refuse to play with (`public/wallet-source.js` shadows it) and which the player
 * never asked for.
 *
 * Wallet first, then X. Signing in with the wallet links it to the Privy user, no embedded wallet is
 * created at all, and the X account then attaches to an account that was already theirs. The X
 * link's only job is the binding: it must never move, replace or duplicate the wallet.
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
 * `linkTwitter` and `login` are the SDK's own functions, passed in so this can be driven with fakes,
 * and `keepsItsOwnWallet` answers whether this browser already holds a wallet of its own — so the
 * whole decision, including which sign-in the player gets, is drivable without a browser.
 *
 * Both SDK calls are awaited whatever their types claim, and every failure comes back as
 * `{ ok: false, reason }` — this function never throws and never rejects, because an unhandled
 * rejection here is a page that looks frozen and says the opposite of what happened.
 *
 * Returns `{ ok: true, via: 'link' | 'wallet' | 'login' }` — `via` says which flow was started, and
 * that is all anyone can honestly claim: Privy completes the flow in its own window and both `login`
 * and `linkTwitter` return before the player has finished with it. The page learns it landed from
 * `privyAuthChanged`, and `'wallet'` is its cue to say *why* the sign-in is asking for a wallet
 * rather than for X.
 */
export async function startXLink({ authenticated, linkTwitter, login, keepsItsOwnWallet } = {}) {
    const openLogin = typeof login === 'function' ? login : null;

    // Asked of whatever owns this browser's wallet, and asked defensively: the accessor belongs to
    // another script on the page, so it may be absent — and a missing answer must never be the
    // reason a click does nothing.
    const ownWallet = (() => {
        try {
            return typeof keepsItsOwnWallet === 'function' && keepsItsOwnWallet() === true;
        } catch {
            return false;
        }
    })();

    /**
     * Which way in, for a player with no Privy session yet.
     *
     * `wallet` when this browser already holds one: that sign-in links the wallet, so nothing is
     * built and nothing about who is playing changes. `twitter` when there is no wallet here — a
     * first wallet has to come from somewhere, and X is the account the player is binding anyway.
     *
     * One method either way, on purpose: a modal offering every other method makes the player hunt
     * for a choice this page has already made for them, to undo the very thing it is preventing.
     */
    const signIn = () => openLogin(ownWallet ? { loginMethods: ['wallet'] } : { loginMethods: ['twitter'] });

    try {
        if (authenticated && typeof linkTwitter === 'function') {
            await linkTwitter();
            return { ok: true, via: 'link' };
        }

        if (openLogin) {
            await signIn();
            return { ok: true, via: ownWallet ? 'wallet' : 'login' };
        }

        return { ok: false, reason: describeLinkFailure() };
    } catch (error) {
        // The session lapsed between render and click, which is the other way to arrive at the SDK's
        // rejection. Signing in links it just the same, so it is retried rather than reported — and
        // through the same door, so a retry cannot be the way a second wallet gets made.
        if (openLogin && isAuthRequired(error)) {
            try {
                await signIn();
                return { ok: true, via: ownWallet ? 'wallet' : 'login' };
            } catch {
                return { ok: false, reason: describeLinkFailure() };
            }
        }

        console.warn('[privy] could not start the X link:', error?.message || error);
        return { ok: false, reason: describeLinkFailure() };
    }
}
