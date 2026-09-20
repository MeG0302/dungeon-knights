'use client';

import { useEffect, useRef } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';

const FALLBACK_CHAIN_ID = 46630;

function pickWallet(wallets) {
  if (!wallets || wallets.length === 0) return null;
  const embedded = wallets.find(
    (wallet) =>
      wallet.walletClientType === 'privy' || wallet.walletClientType === 'privy-v2'
  );
  return embedded || wallets[0];
}

function targetChainId() {
  try {
    return window.DUNGEON_CONFIG?.getNetworkConfig?.().chainIdDecimal ?? FALLBACK_CHAIN_ID;
  } catch {
    return FALLBACK_CHAIN_ID;
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
        try {
          const target = targetChainId();
          const current = parseInt(
            await provider.request({ method: 'eth_chainId' }),
            16
          );
          if (current !== target) {
            await wallet.switchChain(target);
          }
        } catch (error) {
          console.warn('Privy: network switch skipped', error?.message || error);
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
