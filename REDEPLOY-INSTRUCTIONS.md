# 🚀 Redeploy Game Contract (No Age Limit)

## Why Redeploy?
The current contract rejects claims older than 1 hour. The fixed version allows players to claim rewards **anytime**, regardless of completion age.

## What Changed?
**File:** `contracts/DungeonKnightsGame-final.sol`

**Removed:** Line 129
```solidity
require(block.timestamp - timestamp < 1 hours, "Completion too old");
```

Now players can claim rewards from completions done hours, days, or weeks ago.

---

## 🔧 Deployment Steps

### Option 1: Using Remix (Easiest)

1. **Go to Remix IDE**
   - Open: https://remix.ethereum.org

2. **Create New File**
   - Click "+" in file explorer
   - Name: `DungeonKnightsGame.sol`

3. **Paste Contract Code**
   - Copy entire contents of `contracts/DungeonKnightsGame-final.sol`
   - Paste into Remix

4. **Compile**
   - Click "Solidity Compiler" tab (left sidebar)
   - Select compiler version: `0.8.20` or higher
   - Click "Compile DungeonKnightsGame.sol"

5. **Deploy**
   - Click "Deploy & Run Transactions" tab
   - Environment: "Injected Provider - MetaMask"
   - Make sure MetaMask is on **Robinhood Chain Testnet** (Chain ID: 46630)
   - Constructor arguments:
     ```
     _knightNFT: 0xE27106e63920BAfa0FaC0e05F1080EB6b1D9F934
     _dngToken: 0xc2e6c9a4a83608c14f604f7d6a15e6b9f84f44cc
     ```
   - Click "Deploy"
   - Confirm transaction in MetaMask

6. **Copy New Contract Address**
   - After deployment, copy the new contract address from Remix
   - Example: `0x...` (will be different from current `0xb4cee9bA94660BDB19C3a933d71d94623c0B1ec5`)

7. **Fund the Contract**
   - Call `fundContract(amount)` with DNG tokens
   - Amount: At least 10,000 DNG (10000000000000000000000 wei)

8. **Configure Dungeon #1**
   - Call `setDungeon(1, 30, 2250000000000000000000, true)`
   - This sets:
     - Dungeon ID: 1
     - Min time: 30 seconds
     - Max reward: 2,250 DNG
     - Active: true

---

## 📝 Update Frontend

After deployment, update the contract address in these files:

### 1. `dungeon-session.js` (Line 9)
```javascript
this.gameContractAddress = '0xNEW_CONTRACT_ADDRESS_HERE';
```

### 2. `update-dungeon-config.js` (Line 7)
```javascript
const GAME_CONTRACT_ADDRESS = '0xNEW_CONTRACT_ADDRESS_HERE';
```

### 3. `check-contract-config.js` (Line 7)
```javascript
const GAME_CONTRACT_ADDRESS = '0xNEW_CONTRACT_ADDRESS_HERE';
```

### 4. Deploy Frontend
```bash
vercel --prod
```

---

## ✅ Verify It Works

1. Complete a dungeon in-game
2. Wait more than 1 hour
3. Try to claim rewards
4. Should succeed! (Previously would fail with "Completion too old")

---

## 📊 Contract Differences

### Before (Current - 0xb4cee9bA94660BDB19C3a933d71d94623c0B1ec5):
- ❌ Rejects claims older than 1 hour
- ✅ Min time: 30 seconds
- ✅ Max reward: 2,250 DNG

### After (New):
- ✅ **No age limit** - claim anytime
- ✅ Min time: 30 seconds  
- ✅ Max reward: 2,250 DNG
- ✅ All other validations remain (signature, ownership, rate limiting)

---

## 🔒 Security Notes

Removed validation:
- ✅ **Timestamp age check** - Players can now claim old completions

Kept validations:
- ✅ Signature verification (anti-cheat)
- ✅ Ownership check (must own knight)
- ✅ Minimum time check (anti-speed-hack)
- ✅ Maximum reward check (anti-exploit)
- ✅ Rate limiting (1 minute between claims per knight)
- ✅ Future timestamp rejection

This is safe because the signature still proves the completion happened and was validated by the player's wallet.

---

## 🆘 Need Help?

Current contract: `0xb4cee9bA94660BDB19C3a933d71d94623c0B1ec5`
Knight NFT: `0xE27106e63920BAfa0FaC0e05F1080EB6b1D9F934`
DNG Token: `0xc2e6c9a4a83608c14f604f7d6a15e6b9f84f44cc`
Chain: Robinhood Testnet (46630)
RPC: https://rpc.testnet.chain.robinhood.com
