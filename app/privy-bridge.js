'use client';

import { useEffect, useRef } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { DEFAULT_CHAIN, addChainParams } from '../lib/privy-chains';

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
    const { ready, authenticated, login, logout } = usePrivy();
    const { ready: walletsReady, wallets } = useWallets();

    const stateRef = useRef({});
    stateRef.current = {
        ready,
        walletsReady,
        authenticated,
        wallet: pickWallet(wallets),
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
            login: () => login(),
            logout: () => logout(),
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
                },
            })
        );
    }, [ready, walletsReady, authenticated, wallets]);

    return null;
}
