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
    // Phase 2 $DNG: 1,000,000,000 supply, with 45% minted straight into the reward vault.
    // The first token (`0xA8D5…`) belonged to the first collection and is not what any
    // contract in the game pays in any more.
    testnetAddress: '0x3D94e56E0d967633830f6d9E42CE43A64FFfD6Ca'
  },
  
  // NFT Contract Addresses
  //
  // The summonable collection. **Replaced on 21 September**: the previous one could not be
  // minted into at all, because `summon()` never pulled the player's 500 DNG and the vault asked
  // the collection for money it had never held. A deployed collection cannot be repaired in
  // place, so this is a new address — and `NFT_CONTRACTS` here is what the Summoning Chamber
  // approves and calls, so a stale value here is a summon that reverts.
  NFT_CONTRACTS: {
    testnet: '0x27Cfbb763188a50Fe1C0fFfBe2552b1945eE1B2D',
    mainnet: '0xYOUR_MAINNET_NFT_CONTRACT' // TODO: Deploy NFT to mainnet
  },
  
  // Capsule Contract Addresses
  //
  // Capsules are minted by the weekly raffle rather than sold, and opening one burns it
  // and mints a Knight at the published odds. The address is empty until the collection
  // is deployed: the Summoning Chamber reads an empty string as "not deployed yet" and
  // says so, instead of showing a button that would revert.
  CAPSULE_CONTRACTS: {
    testnet: '0x628ae2254fFE4aeC68D13b1E46E5628CCcbD2728',
    mainnet: '' // TODO: same on mainnet
  },

  // Game Contract Addresses
  //
  // `DungeonKnightsGameV4` — runs are signed by the backend, so this contract has no unsigned
  // claim entry point at all. The V3 address that used to sit here paid the first collection's
  // knights out of its own balance; it is retired, and a browser pointed at it would be pointed
  // at a contract the server no longer signs for.
  GAME_CONTRACTS: {
    testnet: '0xD60FfCb1df8ce1163e0a5137651E98BDC0Acd8a8',
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

// Helper function to get current capsule contract. An empty string means "not deployed",
// which every caller has to handle — it is not the same thing as an address that reverts.
CONFIG.getCapsuleContract = function() {
  return this.CAPSULE_CONTRACTS[this.getCurrentNetwork()] || '';
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
//
// A tier carries TWO pictures, because a knight is shown in two
// different places for two different reasons:
//
//   `image` — the art the *dungeon* draws: the sprite the map and
//             the squad screen have always used. `public/dungeon.js`
//             mirrors this table, and `tools/check-rarity.js` fails
//             if the two drift apart.
//   `pfp`   — the portrait shown wherever a knight appears as a
//             *record* rather than as a unit: the Knight's Hall
//             roster and the Summoning Chamber. Absolute paths, so a
//             page at any depth resolves them.
//
// Keeping them apart is the point: the map is not a gallery, and a
// 512px portrait drawn at 32px next to a tileset reads as mud.
// ==========================================================
window.RARITY_TIERS = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

window.RARITY_CONFIG = {
  common: {
    tier: 'COMMON',
    name: 'Common',
    color: '#9E9E9E',
    multiplier: 1.0,
    dropRate: 0.50,       // 50% roll (see WHITEPAPER.md §11.13 before calling this a mint odd)
    dungeonReward: 12,    // $DNG per dungeon clear, at the reference budget (scale 1.0)
    dailyRuns: 5,
    hashPower: 15,        // capacity / 4 — what makes staking pay 90% of playing
    image: 'characters/Pixel_knight_holding_wooden_shield_2K_202609041402_jpeg_2K_202609041417.png',
    pfp: '/assets/pfp/common.webp'
  },
  uncommon: {
    tier: 'UNCOMMON',
    name: 'Uncommon',
    color: '#4CAF50',
    multiplier: 1.7,
    dropRate: 0.30,
    dungeonReward: 20,
    dailyRuns: 5,
    hashPower: 25,
    image: 'characters/Pixel_knight_standing_on_floor_2K_202609041402_jpeg_2K_202609041417.png',
    pfp: '/assets/pfp/uncommon.webp'
  },
  rare: {
    tier: 'RARE',
    name: 'Rare',
    color: '#2196F3',
    multiplier: 3.0,
    dropRate: 0.15,
    dungeonReward: 36,
    dailyRuns: 4,
    hashPower: 36,
    image: 'characters/Pixelated_knight_standing_on_tile_2K_202609041402_jpeg_2K_202609041417.png',
    pfp: '/assets/pfp/rare.webp'
  },
  epic: {
    tier: 'EPIC',
    name: 'Epic',
    color: '#9C27B0',
    multiplier: 7.5,
    dropRate: 0.04,
    dungeonReward: 60,
    dailyRuns: 3,
    hashPower: 45,
    image: 'characters/Pixel_knight_holding_cosmic_shield_2K_202609041402_jpeg_2K_202609041417.png',
    pfp: '/assets/pfp/epic.webp'
  },
  legendary: {
    tier: 'LEGENDARY',
    name: 'Legendary',
    color: '#FFD700',
    multiplier: 15.0,
    dropRate: 0.01,
    dungeonReward: 100,
    dailyRuns: 4,
    hashPower: 100,
    image: 'characters/Knight_in_golden_armor_stands_2K_202609041404_jpeg_2K_202609041417.png',
    pfp: '/assets/pfp/legendary.webp'
  }
};

console.log('✅ RARITY_CONFIG loaded:', window.RARITY_CONFIG);
