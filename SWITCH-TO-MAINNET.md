# 🚀 Quick Guide: Switch to Mainnet with $DNG Token

## Current Setup
- ✅ Config system ready
- ✅ Currently on **Testnet** (safe for testing)
- ✅ Ready to switch to **Mainnet** when you provide token address

---

## What I Need From You

### 1. Your $DNG Token Address
```
Token Address: 0x_____________________
```

### 2. Token Details
- Symbol: $DNG ✅
- Decimals: 18? (confirm)
- Mint Price: How many $DNG per knight? (e.g., 100 $DNG)

### 3. Decision
Do you want to:
- **Option A**: Deploy NFT contract to mainnet now (I'll help)
- **Option B**: Keep testing on testnet, switch later

---

## How to Switch (3 Simple Steps)

### Step 1: Update Token Address
Edit `config.js` (line 12):
```javascript
mainnetAddress: '0xYOUR_ACTUAL_DNG_TOKEN_ADDRESS', // ⚠️ ADD YOUR ADDRESS
```

### Step 2: Deploy NFT to Mainnet (if ready)
```bash
cd D:\dungeon-knights-contracts
node scripts/deploy-mainnet.js
```

Then update `config.js` (line 21):
```javascript
mainnet: '0xYOUR_DEPLOYED_NFT_CONTRACT' // ⚠️ ADD NFT ADDRESS
```

### Step 3: Turn On Mainnet
Edit `config.js` (line 6):
```javascript
USE_MAINNET: true, // ⚠️ Change from false to true
```

Then redeploy:
```bash
cd "d:\dungeon knights robinhood"
vercel --prod
```

---

## ⚠️ Important: Update NFT Contract for $DNG

Your current NFT contract accepts **ETH**. You need to modify it to accept **$DNG tokens**.

### I can help you:
1. Update the Solidity contract to accept ERC-20 tokens
2. Deploy it to mainnet with your $DNG token address
3. Test minting with $DNG

Just say "help me update the contract" and provide your token address!

---

## What Happens When You Switch

### Before (Testnet):
- Network: Robinhood Testnet (46630)
- Cost: 0.001 ETH per knight
- NFT Contract: 0xEA37...e55A

### After (Mainnet):
- Network: Robinhood Mainnet (4663)
- Cost: X $DNG per knight (you choose)
- NFT Contract: Your mainnet address
- Token: Your $DNG token

---

## Testing Checklist

Before going live on mainnet:
- [ ] $DNG token deployed and working
- [ ] NFT contract deployed to mainnet
- [ ] NFT contract accepts $DNG (not ETH)
- [ ] Test minting with small amount
- [ ] Verify on block explorer
- [ ] Set reasonable mint price

---

## Quick Commands

### Check current network:
Open browser console on https://dungeon-knights.vercel.app:
```javascript
console.log(window.DUNGEON_CONFIG.getCurrentNetwork());
// Shows: 'testnet' or 'mainnet'
```

### Switch back to testnet anytime:
```javascript
// config.js
USE_MAINNET: false
```

---

## Ready to Go Live?

**Provide me with:**
1. $DNG token address
2. How many $DNG per knight mint
3. Do you need help deploying NFT contract?

I'll handle the rest! 🚀⚔️💎
