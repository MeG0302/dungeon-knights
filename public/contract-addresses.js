// Single source of truth for contract addresses
// Used by both browser and Node.js scripts
//
// **Phase 2 is the only set.** The first collection (`0x06c7…`), the first $DNG (`0xA8D5…`),
// `DungeonKnightsGameV2` and `DungeonKnightsGameV3` used to be listed here, and every one of
// them is retired: the game, the vault and the reward contracts read and pay the contracts
// below, so a page that resolved an address from this table to *play* was resolving one that
// the server no longer signs for. The old deployments still exist on chain — addresses cannot
// be un-deployed — but nothing in this project should name them again.
//
// **Five of these were replaced on 21 September**, because `Knights` and `Capsules` were each
// missing the line that collects a player's DNG and a deployed contract cannot be repaired in
// place. `Capsules.knights`, `RaffleContract.capsules`, `GameV4.knightNFT` and
// `StakingPool.collection` are all `immutable`, so a fixed collection drags four contracts with
// it; `DNGToken`, `RewardVault`, `GenesisKnights` and `GenesisStaking` were untouched. The
// retired addresses are not listed here any more, for the same reason as the ones above — a page
// resolving one of them could only reach a contract nothing signs for. `deployed-mint-fix.js` in
// the repository root is the record of that deploy, and `docs/DEPLOY-PHASE-2.md` has the evidence.
//
// `tools/check-copies.js` and `tools/check-rarity.js` read this file.

const CONTRACT_ADDRESSES = {
  RPC_URL:  'https://rpc.testnet.chain.robinhood.com',
  CHAIN_ID: 46630,

  // DungeonKnightsGameV4 — backend-signed runs only. There is no unsigned claim entry point.
  GAME_CONTRACT: '0xD60FfCb1df8ce1163e0a5137651E98BDC0Acd8a8',

  // The summonable collection (ERC-721, ERC-721Enumerable, uncapped). Knights enter through
  // `summon()` for 500 $DNG or through a capsule the weekly draw awarded.
  KNIGHT_NFT: '0x27Cfbb763188a50Fe1C0fFfBe2552b1945eE1B2D',

  // The fixed collection: 1,024 knights, 300–1,000 hash power from six published bands,
  // owner-minted. Nothing is minted yet.
  GENESIS_NFT: '0xbd99CD46dd42472fAA7667d5c782eEbe0Abe9e5d',

  // $DNG: 1,000,000,000 supply, 18 decimals. 45% was minted into the reward vault at
  // construction, which is the only bucket the game spends from.
  DNG_TOKEN: '0x3D94e56E0d967633830f6d9E42CE43A64FFfD6Ca',

  // Capsules (ERC-1155, four rungs) — minted by the weekly draw, burned on open.
  CAPSULE_NFT: '0x628ae2254fFE4aeC68D13b1E46E5628CCcbD2728',

  // The reward vault every payout is charged against, one line per budget.
  REWARD_VAULT: '0x6Cc2cA52F24Df5fE752e2792E1acA8783413e0Cc',

  KNIGHTS_STAKING: '0x27fBBba5feCD0Bc4a83d51b4f2832a13c6E0a627',
  GENESIS_STAKING: '0x173cED7aeb1F0F6871c5110112Ade6f61106D7FD',
  RAFFLE_CONTRACT: '0xc26360C6CC4B67720558F71fB32Dc413e27E5b4C',
};

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONTRACT_ADDRESSES;
}

// Export for browser
if (typeof window !== 'undefined') {
  window.CONTRACT_ADDRESSES = CONTRACT_ADDRESSES;
}
