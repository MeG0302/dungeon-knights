# 🚀 Mainnet Deployment Guide

## Current Status
- ✅ Testnet deployed and working
- ✅ Custom $DNG token created on mainnet
- ⏳ Ready to deploy NFT contract to mainnet

---

## Step 1: Add Your Token Address

Edit `config.js`:

```javascript
TOKEN: {
  symbol: '$DNG',
  name: 'Dungeon Token',
  decimals: 18,
  mainnetAddress: '0xYOUR_ACTUAL_DNG_TOKEN_ADDRESS', // ⚠️ UPDATE THIS
  testnetAddress: null
}
```

**What you need:**
- Your $DNG token contract address from Robinhood mainnet

---

## Step 2: Deploy NFT Contract to Mainnet

### Option A: Using your existing deploy script

```bash
cd D:\dungeon-knights-contracts
node scripts/deploy-mainnet.js
```

### Option B: Manual deployment

1. Make sure `.env` has your private key:
   ```
   PRIVATE_KEY=0xYOUR_MAINNET_PRIVATE_KEY
   ```

2. Make sure you have ETH on Robinhood mainnet

3. Run deploy script (from contracts folder):
   ```bash
   node scripts/deploy-simple.js
   ```
   
4. Copy the deployed NFT contract address

---

## Step 3: Update NFT Contract Address

Edit `config.js`:

```javascript
NFT_CONTRACTS: {
  testnet: '0xEA37B1D036a880DfF372bCdd8b2A3AEeEe01e55A',
  mainnet: '0xYOUR_DEPLOYED_NFT_CONTRACT' // ⚠️ UPDATE THIS
}
```

---

## Step 4: Update NFT Contract to Accept $DNG Token

Your NFT contract currently accepts ETH. You need to modify it to accept $DNG tokens instead.

### Current contract (accepts ETH):
```solidity
function mintKnight() public payable returns (uint256) {
    require(msg.value >= mintPrice, "Insufficient payment");
    // ... minting logic
}
```

### Updated contract (accepts $DNG):
```solidity
IERC20 public dungeonToken;

constructor(address _tokenAddress) {
    dungeonToken = IERC20(_tokenAddress);
}

function mintKnight() public returns (uint256) {
    require(dungeonToken.transferFrom(msg.sender, address(this), mintPrice), 
            "Token transfer failed");
    // ... minting logic
}
```

### Steps:
1. Update `DungeonKnights.sol` to accept ERC-20 tokens
2. Redeploy contract to mainnet with token address in constructor
3. Update `config.js` with new NFT contract address

---

## Step 5: Switch to Mainnet

Edit `config.js`:

```javascript
USE_MAINNET: true, // ⚠️ Change from false to true
```

---

## Step 6: Redeploy Frontend

```bash
cd "d:\dungeon knights robinhood"
vercel --prod
```

---

## Step 7: Test on Mainnet

1. Visit: https://dungeon-knights.vercel.app
2. Connect wallet (should switch to Robinhood mainnet)
3. Approve $DNG token spending
4. Mint a knight with $DNG tokens!

---

## ⚠️ Important Checklist Before Going Live

- [ ] Token contract deployed and verified on mainnet
- [ ] NFT contract deployed with token address
- [ ] NFT contract accepts $DNG tokens (not ETH)
- [ ] Updated `config.js` with all mainnet addresses
- [ ] Tested minting on mainnet with test wallet
- [ ] Set reasonable mint price in $DNG
- [ ] Verified contracts on block explorer
- [ ] Set `USE_MAINNET: true` in config.js
- [ ] Deployed frontend to Vercel

---

## Quick Switch Commands

### Switch to Mainnet:
```javascript
// In config.js
USE_MAINNET: true
```

### Switch back to Testnet:
```javascript
// In config.js  
USE_MAINNET: false
```

---

## Token Information Needed

Please provide:

1. **$DNG Token Address** (Robinhood mainnet):
   ```
   0x_____________________
   ```

2. **Token Details**:
   - Symbol: $DNG
   - Decimals: 18 (or different?)
   - Mint price: How many $DNG per knight?

3. **Do you want to:**
   - [ ] Deploy new NFT contract to mainnet now
   - [ ] Test more on testnet first
   - [ ] Need help updating contract for $DNG

---

## Contract Deployment Script

I can create a deployment script that:
1. Deploys NFT contract to mainnet
2. Sets $DNG token address
3. Configures mint price in $DNG
4. Transfers ownership to you

Just provide your token address and I'll prepare it! 🚀
