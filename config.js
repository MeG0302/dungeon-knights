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
    mainnet: '500'    // $DNG tokens on mainnet (fixed for all rarities)
  },
  
  // Rarity System - Uncommon = 25 dungeon ROI baseline
  RARITY: {
    common: {
      name: 'Common',
      color: '#9E9E9E',
      glowColor: 'rgba(158, 158, 158, 0.5)',
      dropRate: 0.50, // 50% chance
      dungeonReward: 12, // 500 / 12 = 41.67 dungeons to ROI
      statsMultiplier: 1.0,
      baseStats: { hp: 100, attack: 10, defense: 5, speed: 8 }
    },
    uncommon: {
      name: 'Uncommon',
      color: '#4CAF50',
      glowColor: 'rgba(76, 175, 80, 0.5)',
      dropRate: 0.30, // 30% chance
      dungeonReward: 20, // 500 / 20 = 25 dungeons to ROI ✅ BASELINE
      statsMultiplier: 1.5,
      baseStats: { hp: 150, attack: 15, defense: 8, speed: 10 }
    },
    rare: {
      name: 'Rare',
      color: '#2196F3',
      glowColor: 'rgba(33, 150, 243, 0.5)',
      dropRate: 0.15, // 15% chance
      dungeonReward: 36, // 500 / 36 = 13.89 dungeons to ROI (1.8x faster)
      statsMultiplier: 2.5,
      baseStats: { hp: 250, attack: 25, defense: 13, speed: 12 }
    },
    epic: {
      name: 'Epic',
      color: '#9C27B0',
      glowColor: 'rgba(156, 39, 176, 0.5)',
      dropRate: 0.04, // 4% chance
      dungeonReward: 60, // 500 / 60 = 8.33 dungeons to ROI (3x faster)
      statsMultiplier: 4.0,
      baseStats: { hp: 400, attack: 40, defense: 20, speed: 15 }
    },
    legendary: {
      name: 'Legendary',
      color: '#FFD700',
      glowColor: 'rgba(255, 215, 0, 0.8)',
      dropRate: 0.01, // 1% chance
      dungeonReward: 100, // 500 / 100 = 5 dungeons to ROI (5x faster!)
      statsMultiplier: 7.0,
      baseStats: { hp: 700, attack: 70, defense: 35, speed: 20 }
    }
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

// Helper function to get rarity by name
CONFIG.getRarity = function(rarityName) {
  return this.RARITY[rarityName.toLowerCase()];
};

// Helper function to roll random rarity
CONFIG.rollRarity = function() {
  const rand = Math.random();
  let cumulative = 0;
  
  for (const [key, rarity] of Object.entries(this.RARITY)) {
    cumulative += rarity.dropRate;
    if (rand < cumulative) {
      return key;
    }
  }
  return 'common'; // Fallback
};

// Helper function to get reward for rarity
CONFIG.getRewardForRarity = function(rarityName) {
  const rarity = this.getRarity(rarityName);
  return rarity ? rarity.dungeonReward : 20; // Default to uncommon
};

// Export for use in other files
if (typeof window !== 'undefined') {
  window.DUNGEON_CONFIG = CONFIG;
}
