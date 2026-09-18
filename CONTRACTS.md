# Dungeon Knights - Live Contract Documentation

**Last Updated:** 2026-09-15  
**Network:** Robinhood Chain Testnet (Chain ID: 46630)  
**RPC:** https://rpc.testnet.chain.robinhood.com

---

## 🎮 Live Production Contracts

| Contract | Address | Status | Source |
|----------|---------|--------|--------|
| **Game Contract (V3)** | `0xD8de9385Db7DfE925882E76849B6e067e47236e5` | ✅ Active | `contracts/DungeonKnightsGameV3-Simple.sol` |
| **Knight NFT** | `0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512` | ✅ Active | (Deployed separately) |
| **DNG Token** | `0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910` | ✅ Active | Standard ERC-20 |
| **Owner EOA** | `0x038d75aDb74d8e5Db82E6c6797f90dCdF82ef4C9` | ✅ Active | All contracts owned by this address |

### Deployment Details

**V3 Game Contract:**
- **Transaction:** `0xd167e7fca0af84a0ba6e614d3db161fd4cff8a132f2283dfc7373deb78875610`
- **Block:** 119515284
- **Deployed:** 2026-09-12
- **Version:** V3-Simple (Batch Claims, No Cooldowns)

**Constructor Parameters:**
```solidity
_knightNFT: 0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512
_dngToken:  0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910
```

---

## 📊 V3 Game Contract Configuration

### Rarity Rewards (per run)
| Rarity | Reward | Daily Cap |
|--------|--------|-----------|
| Common (0) | 10 DNG | 5 runs/day |
| Uncommon (1) | 17 DNG | 5 runs/day |
| Rare (2) | 30 DNG | 4 runs/day |
| Epic (3) | 75 DNG | 3 runs/day |
| Legendary (4) | 150 DNG | 4 runs/day |

### Contract State
- **Paused:** `false` (active)
- **Treasury:** 5,000 DNG (as of 2026-09-15)
- **Max Batch:** 50 runs per transaction
- **Max Knights per Run:** 15

---

## 🔧 V3 Key Features

### ✅ What V3 Has
- **Batch Claims:** Claim up to 50 dungeon runs in 1 transaction
- **No Cooldowns:** Removed 30-second wait between claims
- **Daily Limits:** Per-knight run limits enforced (Common: 5/day, etc.)
- **Gas Efficient:** ~47% cheaper than V2 for batch claims

### ❌ What V3 Does NOT Have
- **No Gameplay Validation:** Contract trusts frontend
- **No Signature Requirements:** No backend verification
- **No Cooldowns:** Can claim instantly after completing dungeons
- **No Anti-Bot Protection:** Daily limits are the only restriction

---

## 📝 Contract Interface

### Player Functions

```solidity
// Batch claim multiple runs (RECOMMENDED)
function batchClaimRewards((uint256[],uint256)[] runs) external
// Input: Array of (knightIds[], dungeonId) tuples
// Max: 50 runs per call

// View functions
function runsRemaining(uint256 knightId) view returns (uint8)
function getKnightStats(uint256 knightId) view returns (uint256 totalClaimed, uint8 remaining)
function treasuryBalance() view returns (uint256)
```

### Owner Functions

```solidity
function setRarityReward(uint8 rarity, uint256 reward) external onlyOwner
function setDailyCap(uint8 rarity, uint8 cap) external onlyOwner
function setPaused(bool paused) external onlyOwner
function fundContract(uint256 amount) external onlyOwner
function withdrawTokens(uint256 amount) external onlyOwner
function withdrawAllTokens() external onlyOwner
```

### Events

```solidity
event DungeonCompleted(
    address indexed player,
    uint256 indexed knightId,
    uint256 indexed dungeonId,
    uint8 rarity,
    uint256 reward,
    uint256 timestamp
)

event RewardsClaimed(
    address indexed player,
    uint256 amount,
    uint256 runsCount,
    uint256 knightCount
)
```

---

## 🎯 Frontend Integration

### Contract Configuration Files

**Primary (Browser & Node.js):**
- `contract-addresses.js` - Single source of truth for addresses
- `config.js` - Network config, calls `contract-addresses.js`

**Update Both When Deploying:**
```javascript
// contract-addresses.js
GAME_CONTRACT: '0xD8de9385Db7DfE925882E76849B6e067e47236e5'

// config.js
GAME_CONTRACTS: {
  testnet: '0xD8de9385Db7DfE925882E76849B6e067e47236e5'
}
```

### ABI (in dungeon-session.js)

```javascript
this.gameContractABI = [
    'function batchClaimRewards((uint256[],uint256)[] runs) external',
    'function runsRemaining(uint256 knightId) view returns (uint8)',
    'function getKnightStats(uint256 knightId) view returns (uint256, uint8)',
    'function treasuryBalance() view returns (uint256)',
    'event DungeonCompleted(address indexed player, uint256 indexed knightId, uint256 indexed dungeonId, uint8 rarity, uint256 reward, uint256 timestamp)',
    'event RewardsClaimed(address indexed player, uint256 amount, uint256 runsCount, uint256 knightCount)'
];
```

**⚠️ Note:** `claimRewards` single-run function is **permanently broken** (reentrancy guard issue). Only use `batchClaimRewards`.

---

## 🚨 Abandoned Contracts (DO NOT USE)

These contracts were drained and disabled on 2026-09-15:

| Address | Version | Status | Issue |
|---------|---------|--------|-------|
| `0x45B905f66789bED9A1e9FF47f5429aF41A370E17` | V1 | ❌ Drained & Disabled | Self-signed rewards exploit |
| `0xb4cee9bA94660BDB19C3a933d71d94623c0B1ec5` | V1 | ❌ Drained & Disabled | Self-signed rewards exploit |
| `0xbA216A5f7733B0B989eD751496386B759698797F` | V1 | ❌ Drained & Disabled | Self-signed rewards exploit |
| `0xd6D40B6C0D22f43866F6FBab3cf0DddDba05cFd5` | V2 | ❌ Drained & Paused | Stranded (30s cooldown issues) |

**Total Recovered:** 320,339 DNG on 2026-09-15

---

## 📈 Knight Population & Economics

**Current Knights:** 34 NFTs minted  
**Rarity Distribution:**
- Common: 23 knights
- Uncommon: 9 knights
- Rare: 2 knights
- Epic: 0 knights
- Legendary: 0 knights

**Holders:** 3 addresses (2 controlled by deployer)

**Maximum Daily Payout:**
- Common: 23 × 5 runs × 10 DNG = 1,150 DNG/day
- Uncommon: 9 × 5 runs × 17 DNG = 765 DNG/day
- Rare: 2 × 4 runs × 30 DNG = 240 DNG/day
- **Total:** 2,155 DNG/day maximum

**Treasury Strategy:**
- Current: 5,000 DNG (≈2.3 days)
- Target: 25,000 DNG (≈12 days)
- Rationale: No gameplay validation = treasury balance is loss ceiling

---

## 🔐 Security Model

### Current (V3-Simple)

**What's Protected:**
- ✅ Ownership validation (must own knights to claim)
- ✅ Daily run limits per knight rarity
- ✅ Treasury balance checks
- ✅ Paused state (owner can emergency stop)

**What's NOT Protected:**
- ❌ No gameplay validation (frontend only)
- ❌ No time-based verification
- ❌ No signature requirements
- ❌ No bot protection beyond daily caps

**Risk Level:** Medium
- Worst case: Someone scripts claims up to daily cap without playing
- Mitigation: Daily limits + capped treasury (25k DNG)
- Acceptable for: Testnet, 34 knights, 3 holders

### Future (V4 - Before Mainnet)

**Required Additions:**
- ✅ EIP-712 typed signatures with domain separator
- ✅ Backend signature service (Vercel serverless)
- ✅ Gameplay validation (time, loot, enemies)
- ✅ Per-signature expiry
- ✅ Nonce tracking (prevent replay)
- ✅ Keep daily caps as defense-in-depth

**Reference Implementation:** `contracts/DungeonKnightsGameV3.sol` (needs EIP-712 fixes)

---

## 🛠️ Management Scripts

### Check Contract State
```bash
node test-v3-contract.js
```

### Fund Contract
```bash
node fund-game-contract.js
# Tops up to 25,000 DNG target
```

### Check Balances
```bash
node check-contract-balance.js
```

### Recover Abandoned Contracts (One-time, completed)
```bash
node recover-old-contracts.js
# ✅ Completed 2026-09-15: Recovered 320,339 DNG
```

---

## 📚 Additional Documentation

- **Handoff Document:** `HANDOFF-CONTRACT-FIXES.md` - Comprehensive technical analysis
- **Recovery Plan:** `RECOVERY-PLAN.md` - Emergency recovery documentation
- **Gameplay Validation:** `GAMEPLAY-VERIFICATION-TODO.md` - Future V4 requirements

---

## ⚠️ Important Notes

1. **Never deploy new contracts without updating:**
   - `contract-addresses.js`
   - `config.js`
   - This file (CONTRACTS.md)

2. **All scripts must use `require('./contract-addresses')`**
   - Never hardcode addresses in scripts
   - Prevents targeting wrong contracts

3. **Before Mainnet:**
   - Add Foundry + tests
   - Deploy V4 with EIP-712 signatures
   - Set up backend signature service
   - Use Ownable2Step for ownership transfers

4. **Treasury Management:**
   - Keep bulk funds in owner wallet
   - Top up contract to 25k DNG regularly
   - Monitor via `treasuryBalance()` calls

---

**Contract Source:** `contracts/DungeonKnightsGameV3-Simple.sol`  
**Compiler:** Solidity 0.8.20+  
**OpenZeppelin:** v5 (ReentrancyGuard, Ownable)  
**License:** MIT
