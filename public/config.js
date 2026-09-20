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
    testnet: '0xD8de9385Db7DfE925882E76849B6e067e47236e5', // DungeonKnightsGameV3 deployed! (Batch Claims)
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

// Mint price (in $DNG) for the current network
CONFIG.getMintPrice = function() {
  return Number(this.MINT_PRICE[this.getCurrentNetwork()]);
};

// Look up a rarity by tier name (accepts 'COMMON' or 'common')
CONFIG.getRarity = function(tier) {
  if (!tier || typeof window === 'undefined' || !window.RARITY_CONFIG) return null;
  return window.RARITY_CONFIG[String(tier).toLowerCase()] || null;
};

// Ordered dungeon rewards, index matches the on-chain rarity enum (0-4)
CONFIG.getRarityRewards = function() {
  if (typeof window === 'undefined' || !window.RARITY_TIERS) return [];
  return window.RARITY_TIERS.map(t => window.RARITY_CONFIG[t].dungeonReward);
};

// Expected $DNG per dungeon run, weighted by drop rate (used for display estimates)
CONFIG.averageDungeonReward = function() {
  if (typeof window === 'undefined' || !window.RARITY_TIERS) return 0;
  return window.RARITY_TIERS.reduce((sum, t) => {
    const r = window.RARITY_CONFIG[t];
    return sum + r.dungeonReward * r.dropRate;
  }, 0);
};

// Export for use in other files
if (typeof window !== 'undefined') {
  window.DUNGEON_CONFIG = CONFIG;
}


// ==========================================================
// KNIGHT RARITY — SINGLE SOURCE OF TRUTH
// Drives gameplay rewards, the mint odds table, card art and
// claim estimates. There are exactly 5 tiers to match the
// on-chain rarity enum (0=common … 4=legendary).
// ==========================================================
window.RARITY_TIERS = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

window.RARITY_CONFIG = {
  common: {
    tier: 'COMMON',
    name: 'Common',
    color: '#9E9E9E',
    multiplier: 1.0,
    dropRate: 0.50,       // 50% mint odds
    dungeonReward: 10,    // $DNG per dungeon clear
    dailyRuns: 5,
    image: 'characters/Pixel_knight_holding_wooden_shield_2K_202609041402_jpeg_2K_202609041417.png'
  },
  uncommon: {
    tier: 'UNCOMMON',
    name: 'Uncommon',
    color: '#4CAF50',
    multiplier: 1.7,
    dropRate: 0.30,
    dungeonReward: 17,
    dailyRuns: 5,
    image: 'characters/Pixel_knight_standing_on_floor_2K_202609041402_jpeg_2K_202609041417.png'
  },
  rare: {
    tier: 'RARE',
    name: 'Rare',
    color: '#2196F3',
    multiplier: 3.0,
    dropRate: 0.15,
    dungeonReward: 30,
    dailyRuns: 4,
    image: 'characters/Pixelated_knight_standing_on_tile_2K_202609041402_jpeg_2K_202609041417.png'
  },
  epic: {
    tier: 'EPIC',
    name: 'Epic',
    color: '#9C27B0',
    multiplier: 7.5,
    dropRate: 0.04,
    dungeonReward: 75,
    dailyRuns: 3,
    image: 'characters/Pixel_knight_holding_cosmic_shield_2K_202609041402_jpeg_2K_202609041417.png'
  },
  legendary: {
    tier: 'LEGENDARY',
    name: 'Legendary',
    color: '#FFD700',
    multiplier: 15.0,
    dropRate: 0.01,
    dungeonReward: 150,
    dailyRuns: 4,
    image: 'characters/Knight_in_golden_armor_stands_2K_202609041404_jpeg_2K_202609041417.png'
  }
};

console.log('✅ RARITY_CONFIG loaded:', window.RARITY_CONFIG);
