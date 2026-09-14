// Dungeon Knights - Network Configuration
// Change USE_MAINNET to true when ready to go live

const CONFIG = {
  // ⚠️ IMPORTANT: Set to true for production (mainnet), false for testing (testnet)
  USE_MAINNET: false, // Change to true to use mainnet
  
  // Wallet Connection Method
  WALLET: {
    method: 'rainbowkit', // Options: 'metamask', 'privy', 'rainbowkit'
    // RainbowKit: Works immediately, shows all wallets (MetaMask, Coinbase, WalletConnect, etc.)
    // Privy: Needs App ID, supports email/social login too
    // MetaMask: Simple, MetaMask only
  },
  
  // Privy Configuration (supports all wallets + email + social)
  PRIVY: {
    enabled: false, // Set to true after getting App ID from https://dashboard.privy.io/
    appId: 'YOUR_PRIVY_APP_ID_HERE', // Get from https://dashboard.privy.io/
  },
  
  // Token Information
  TOKEN: {
    symbol: '$DNG', // Your token symbol
    name: 'Dungeon Token',
    decimals: 18,
    // Deployed token addresses
    mainnetAddress: '0xYOUR_DNG_TOKEN_ADDRESS', // TODO: Deploy to mainnet
    testnetAddress: '0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910' // ✅ Deployed!
  },
  
  // NFT Contract Addresses
  NFT_CONTRACTS: {
    testnet: '0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512', // ✅ Deployed!
    mainnet: '0xYOUR_MAINNET_NFT_CONTRACT' // TODO: Deploy NFT to mainnet
  },
  
  // Game Contract Addresses
  GAME_CONTRACTS: {
    testnet: '0xd6D40B6C0D22f43866F6FBab3cf0DddDba05cFd5', // DungeonKnightsGameV2 deployed!
    mainnet: '0xYOUR_MAINNET_GAME_CONTRACT' // TODO: Deploy to mainnet
  },
  
  // Network Details
  NETWORKS: {
    testnet: {
      chainId: '0xb626', // 46630
      chainIdDecimal: 46630,
      name: 'Robinhood Chain Testnet',
      rpc: 'https://rpc.testnet.chain.robinhood.com',
      explorer: 'https://explorer.testnet.chain.robinhood.com',
      currency: {
        name: 'Ethereum',
        symbol: 'ETH',
        decimals: 18
      }
    },
    mainnet: {
      chainId: '0x1237', // 4663
      chainIdDecimal: 4663,
      name: 'Robinhood Chain',
      rpc: 'https://rpc.mainnet.chain.robinhood.com',
      explorer: 'https://robinhoodchain.blockscout.com',
      currency: {
        name: 'Ethereum',
        symbol: 'ETH',
        decimals: 18
      }
    }
  },
  
  // Minting Costs
  MINT_PRICE: {
    testnet: '500', // 500 $DNG tokens on testnet
    mainnet: '500'  // 500 $DNG tokens on mainnet
  }
};

// Helper function to get current network
CONFIG.getCurrentNetwork = function() {
  return this.USE_MAINNET ? 'mainnet' : 'testnet';
};

// Helper function to get current network config
CONFIG.getNetworkConfig = function() {
  return this.NETWORKS[this.getCurrentNetwork()];
};

// Helper function to get current NFT contract
CONFIG.getNFTContract = function() {
  return this.NFT_CONTRACTS[this.getCurrentNetwork()];
};

// Helper function to get current game contract
CONFIG.getGameContract = function() {
  return this.GAME_CONTRACTS[this.getCurrentNetwork()];
};

// Helper function to get current token address
CONFIG.getTokenAddress = function() {
  return this.USE_MAINNET ? this.TOKEN.mainnetAddress : this.TOKEN.testnetAddress;
};

// Helper function to check if using custom token
CONFIG.usesCustomToken = function() {
  return this.USE_MAINNET && this.getTokenAddress() !== null;
};

// Export for use in other files
if (typeof window !== 'undefined') {
  window.DUNGEON_CONFIG = CONFIG;
}
