// Single source of truth for contract addresses
// Used by both browser and Node.js scripts

const CONTRACT_ADDRESSES = {
  RPC_URL:   'https://rpc.testnet.chain.robinhood.com',
  CHAIN_ID:  46630,
  GAME_CONTRACT: '0xD8de9385Db7DfE925882E76849B6e067e47236e5', // DungeonKnightsGameV3 - Batch Claims!
  GAME_CONTRACT_V2: '0xd6D40B6C0D22f43866F6FBab3cf0DddDba05cFd5', // Old V2 (for reference)
  KNIGHT_NFT:    '0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512',
  DNG_TOKEN:     '0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910',
};

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONTRACT_ADDRESSES;
}

// Export for browser
if (typeof window !== 'undefined') {
  window.CONTRACT_ADDRESSES = CONTRACT_ADDRESSES;
}
