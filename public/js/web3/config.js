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
    // TODO: Add your mainnet token contract address
    mainnetAddress: '0xYOUR_DNG_TOKEN_ADDRESS', 
    testnetAddress: null // No token on testnet
  },
  
  // NFT Contract Addresses
  NFT_CONTRACTS: {
    testnet: '0xEA37B1D036a880DfF372bCdd8b2A3AEeEe01e55A',
    mainnet: '0xYOUR_MAINNET_NFT_CONTRACT' // TODO: Deploy NFT to mainnet
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
    testnet: '0.001', // ETH on testnet
    mainnet: '100'    // $DNG tokens on mainnet (adjust as needed)
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
