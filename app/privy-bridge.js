'use client';

import { useEffect, useRef } from 'react';
import { usePrivy, useWallets, useUser, useLinkAccount } from '@privy-io/react-auth';
import { DEFAULT_CHAIN, addChainParams } from '../lib/privy-chains';
import { startXLink } from '../lib/x-link';
import { markPrivyFlowStarted } from '../lib/privy-oauth-return';

/**
 * The one thing the legacy pages need from React: `window.privyBridge`.
 *
 * The game, the Hall, the mint and the vault are plain scripts speaking EIP-1193, and they
 * run inside these routes (that is what `app/legacy-page.js` does). Rather than rewrite all
 * of them, this component publishes the signed-in wallet in a small, explicit contract:
 *
 *   isReady() / isAuthenticated() / getAddress() / getWalletType()
 *   getProvider()   — the EIP-1193 provider, on the game's chain
 *   login() / logout()
 *   getXAccount()   — the X account linked to this Privy user, or null
 *   linkX()         — prompt that link, or sign in with X when there is no Privy session yet
 *   getAccessToken() — a Privy access token, so a server can prove who this is
 *
 * Events: `privyBridgeReady` once the bridge exists, `privyAuthChanged` on every sign-in or
 * sign-out, so a page can react without polling.
 *
 * `public/wallet-source.js` consumes exactly this, and it is deliberately the only consumer:
 * one wallet, one answer to "who is playing", no matter which page asks.
 */

/** The wallet the player is meant to use: the embedded one if there is a choice. */
function pickWallet(wallets) {
    if (!wallets || wallets.length === 0) return null;
    const embedded = wallets.find((wallet) => wallet.walletClientType === 'privy'
        || wallet.walletClientType === 'privy-v2');
    return embedded || wallets[0];
}

/** The chain the game runs on, read the same way every legacy script reads it. */
function targetChainId() {
    try {
        return window.DUNGEON_CONFIG?.getNetworkConfig?.().chainIdDecimal ?? DEFAULT_CHAIN.id;
    } catch {
        return DEFAULT_CHAIN.id;
    }
}

export default function PrivyBridge() {
    const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
    const { ready: walletsReady, wallets } = useWallets();
    const { user } = useUser();
    const { linkTwitter } = useLinkAccount();

    // The X account this Privy user has linked. `subject` is the `sub` claim from Twitter's own
    // JWT — the account *id* — and it is what the Points Program keys "one X account, one wallet"
    // on. A handle can be renamed; the id cannot.
    const twitter = user?.twitter
        ? { id: String(user.twitter.subject || ''), username: String(user.twitter.username || '') }
        : user?.twitter;

    const stateRef = useRef({});
    stateRef.current = {
        ready,
        walletsReady,
        authenticated,
        wallet: pickWallet(wallets),
        twitter: user?.twitter ? twitter : null,
        linkTwitter,
        login,
        getAccessToken,
    };

    useEffect(() => {
        const bridge = {
            isReady: () => stateRef.current.ready && stateRef.current.walletsReady,
            isAuthenticated: () => stateRef.current.authenticated,
            getAddress: () => stateRef.current.wallet?.address || null,
            getWalletType: () => stateRef.current.wallet?.walletClientType || null,
            getProvider: async () => {
                const wallet = stateRef.current.wallet;
                if (!wallet) return null;
                const provider = await wallet.getEthereumProvider();

                // Settle the chain before handing the provider over. A wallet that is not on
                // this game's chain turns every approval into an unreadable failure, and for
                // an embedded wallet — which starts wherever Privy put it — this is the only
                // place that can fix it. Switching is tried first; a wallet that has never
                // heard of the chain (4902) is asked to add it, using the same numbers the
                // site publishes.
                const target = targetChainId();
                try {
                    const current = parseInt(await provider.request({ method: 'eth_chainId' }), 16);
                    if (current !== target) {
                        try {
                            await wallet.switchChain(target);
                        } catch (switchError) {
                            await provider.request({
                                method: 'wallet_addEthereumChain',
                                params: addChainParams(),
                            });
                        }
                        const settled = parseInt(await provider.request({ method: 'eth_chainId' }), 16);
                        if (settled !== target) {
                            console.warn(`[privy] wallet is on ${settled}, but this game runs on `
                                + `${DEFAULT_CHAIN.name} (${target}). Enable that network for the Privy `
                                + 'app, or transactions will fail.');
                        }
                    }
                } catch (error) {
                    console.warn('[privy] could not settle the chain:', error?.message || error);
                }

                return provider;
            },
            // Every way into Privy's UI is marked, and the mark is what lets the OAuth guard tell
            // *our* return (X sends the browser back to `?privy_oauth_code=…`) from a callback URL
            // that arrived from somewhere else. Unmarked ones never open anything.
            login: () => {
                markPrivyFlowStarted();
                return login();
            },
            logout: () => logout(),

            // ------------------------------------------------------------ the X account
            /** The linked X account as `{ id, username }`, or null. Never throws. */
            getXAccount: () => {
                try {
                    const account = stateRef.current.twitter;
                    return account?.id && account?.username
                        ? { id: account.id, username: account.username }
                        : null;
                } catch {
                    return null;
                }
            },
            /**
             * Ask the player to link X.
             *
             * Never throws and never rejects — an unhandled rejection here is a page that says the
             * link started while nothing opened, which is exactly what happened when
             * `linkTwitter()` was trusted to be the `() => void` its types advertise. Resolves to
             * `{ ok, via?, reason? }`; `via` says which flow was started, and the page learns the
             * link actually landed from `privyAuthChanged`, which fires when the user record
             * changes. The rule itself is `startXLink` in `lib/x-link.js`, where it can be tested.
             */
            linkX: () => startXLink({
                authenticated: stateRef.current.authenticated,
                // Read at click time rather than captured when this bridge mounted: the answer is
                // about the wallet this browser is holding *now*, and `wallet-source.js` — a plain
                // script — may not have loaded when this effect first ran.
                //
                // True means the player already has a wallet of their own, so signing in with X
                // would make Privy build them a second one. `lib/x-link.js` sends that player
                // through a wallet sign-in instead.
                keepsItsOwnWallet: () => {
                    try {
                        return window.DKWallet?.ownsWallet?.() === true;
                    } catch {
                        return false;
                    }
                },
                linkTwitter: () => {
                    markPrivyFlowStarted();
                    return stateRef.current.linkTwitter?.();
                },
                login: (options) => {
                    markPrivyFlowStarted();
                    return stateRef.current.login?.(options);
                },
            }),
            /**
             * A Privy access token for the current user, or null.
             *
             * This is what lets the *server* prove the X link instead of believing the browser.
             * Null is a normal answer (not signed in, or Privy unreachable) and the binding is then
             * recorded as provisional.
             */
            getAccessToken: async () => {
                try {
                    return (await stateRef.current.getAccessToken?.()) || null;
                } catch (error) {
                    console.warn('[privy] no access token:', error?.message || error);
                    return null;
                }
            },
        };

        window.privyBridge = bridge;
        window.dispatchEvent(new Event('privyBridgeReady'));

        return () => {
            if (window.privyBridge === bridge) {
                delete window.privyBridge;
            }
        };
    }, [login, logout]);

    useEffect(() => {
        if (!ready || !walletsReady || !window.privyBridge) return;

        window.dispatchEvent(
            new CustomEvent('privyAuthChanged', {
                detail: {
                    authenticated,
                    address: stateRef.current.wallet?.address || null,
                    walletType: stateRef.current.wallet?.walletClientType || null,
                    // Fires again when the user links X, which is how the Points page learns that
                    // the account it is waiting for has arrived.
                    x: window.privyBridge.getXAccount?.() || null,
                },
            })
        );
    }, [ready, walletsReady, authenticated, wallets, user]);

    return null;
}
