// Privy Configuration for Dungeon Knights
console.log('🔧 Loading Privy configuration...');

const PRIVY_CONFIG = {
  // Get your App ID from https://dashboard.privy.io/
  appId: 'clxxx-your-privy-app-id-here', // TODO: Replace with your Privy App ID
  
  // Supported chains
  supportedChains: [
    {
      id: 46630, // Robinhood Chain Testnet
      name: 'Robinhood Chain Testnet',
      network: 'robinhood-testnet',
      nativeCurrency: {
        name: 'ETH',
        symbol: 'ETH',
        decimals: 18
      },
      rpcUrls: {
        default: { http: ['https://rpc.testnet.chain.robinhood.com'] },
        public: { http: ['https://rpc.testnet.chain.robinhood.com'] }
      },
      blockExplorers: {
        default: { 
          name: 'Robinhood Explorer', 
          url: 'https://explorer.testnet.chain.robinhood.com' 
        }
      }
    }
  ],
  
  // Default chain
  defaultChain: {
    id: 46630,
    name: 'Robinhood Chain Testnet'
  },
  
  // Appearance
  appearance: {
    theme: 'dark',
    accentColor: '#8B5CF6',
    logo: 'https://dungeon-knights.vercel.app/capsule.png'
  },
  
  // Login methods
  loginMethods: ['wallet', 'email', 'google'],
  
  // Wallet options
  embeddedWallets: {
    createOnLogin: 'users-without-wallets'
  }
};

console.log('✅ Privy config loaded');
