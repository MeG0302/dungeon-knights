'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { DEFAULT_CHAIN, PRIVY_APP_ID, SUPPORTED_CHAINS } from '../lib/privy-chains';

export default function Providers({ children }) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        defaultChain: DEFAULT_CHAIN,
        supportedChains: SUPPORTED_CHAINS,
        loginMethods: ['wallet', 'email'],
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
