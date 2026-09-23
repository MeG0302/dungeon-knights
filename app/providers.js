'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { DEFAULT_CHAIN, SUPPORTED_CHAINS } from '../lib/privy-chains';

/**
 * Privy, mounted once, around every route.
 *
 * This is the app's login: the modal lists the wallets a player might already have
 * (MetaMask, Coinbase, WalletConnect, Rainbow, or whatever the browser injects) plus email,
 * and Privy creates an embedded wallet for anyone who arrives without one — which is the
 * only way the game is playable on a phone, where no extension can be installed.
 *
 * **The App ID comes from the server**, passed in by `app/layout.js` from `PRIVY_APP_ID`,
 * rather than from a `NEXT_PUBLIC_` copy in a client config: one value, one place, and no
 * second copy on the client to drift from it. It is a public identifier — it names the app
 * to Privy's hosted components — so there is nothing secret about it being in the bundle.
 *
 * **Dormant by default.** With no App ID the children render without a provider, no bridge
 * is published, and `public/wallet-source.js` falls back to the extension exactly as it did
 * before any of this existed. That is what lets the app ship with Privy switched off.
 */
export default function Providers({ appId, children }) {
    if (!appId) return children;

    return (
        <PrivyProvider
            appId={appId}
            config={{
                defaultChain: DEFAULT_CHAIN,
                supportedChains: SUPPORTED_CHAINS,
                // These three are enabled on the Privy app; anything else (SMS, passkeys, the
                // other socials) is off there and stays off here, so the modal never offers a
                // method the app would refuse. `twitter` is not only a way in — Privy's
                // `linkTwitter` is refused outright for a provider the app has not enabled,
                // which is what the Points page's "Link X account" button runs on, so this
                // list is part of the binding working at all.
                loginMethods: ['wallet', 'email', 'twitter'],
                embeddedWallets: {
                    ethereum: {
                        createOnLogin: 'users-without-wallets',
                    },
                },
                appearance: {
                    theme: 'dark',
                    accentColor: '#d4af37',
                    walletList: [
                        'detected_wallets',
                        'metamask',
                        'coinbase_wallet',
                        'wallet_connect',
                        'rainbow',
                    ],
                },
            }}
        >
            {children}
        </PrivyProvider>
    );
}
