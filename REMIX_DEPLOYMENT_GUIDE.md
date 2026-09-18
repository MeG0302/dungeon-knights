# 🎯 Deploy with Remix IDE - Step by Step

## Quick Start

1. Open https://remix.ethereum.org
2. Connect MetaMask to Robinhood Chain Testnet
3. Follow steps below

---

## Step 1: Setup Remix

### 1.1 Create New File
- Click "File Explorer" (📁 icon on left)
- Click "+" to create new file
- Name it: `DungeonKnightsGame.sol`

### 1.2 Copy Contract Code
- Open `contracts/DungeonKnightsGame.sol` from your project
- Copy ALL the code
- Paste into Remix

---

## Step 2: Install Dependencies

The contract needs OpenZeppelin libraries.

**Option A: Use Remix Plugin**
1. Click "Plugin Manager" (🔌 icon on left)
2. Search "OpenZeppelin"
3. Click "Activate"
4. The imports will resolve automatically

**Option B: Manual Import**
1. Change imports in contract to:
```solidity
import "https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v4.9.0/contracts/token/ERC721/IERC721.sol";
import "https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v4.9.0/contracts/token/ERC20/IERC20.sol";
import "https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v4.9.0/contracts/access/Ownable.sol";
import "https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v4.9.0/contracts/utils/cryptography/ECDSA.sol";
```

---

## Step 3: Compile Contract

1. Click "Solidity Compiler" (📝 icon on left)
2. Select compiler version: **0.8.20 or higher**
3. Enable "Auto compile" (optional)
4. Click "Compile DungeonKnightsGame.sol"
5. Wait for green checkmark ✅

**If you see errors:**
- Make sure OpenZeppelin imports are resolved
- Try Option B (manual imports) above
- Check Solidity version is 0.8.20+

---

## Step 4: Deploy Contract

### 4.1 Connect MetaMask
1. Click "Deploy & Run" (🚀 icon on left)
2. Environment: Select **"Injected Provider - MetaMask"**
3. MetaMask popup will appear
4. Make sure it shows:
   - Network: **Robinhood Chain Testnet**
   - Chain ID: **46630**
   - Your account with ETH balance

**If wrong network:**
- MetaMask → Networks → Switch to Robinhood Chain Testnet
- Or add it: https://chainlist.org/?search=robinhood

### 4.2 Set Constructor Parameters

In the "Deploy" section, you'll see:

```
Contract: DungeonKnightsGame

▼ _KNIGHTNFT (address)
▼ _DNGTOKEN (address)
```

**Enter these values:**
```
_KNIGHTNFT: 0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512
_DNGTOKEN: 0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910
```

### 4.3 Deploy!
1. Click orange "Deploy" button
2. MetaMask popup appears
3. Review transaction (gas cost ~2-3M gas)
4. Click "Confirm"
5. Wait for confirmation ⏳

---

## Step 5: Verify Deployment

### 5.1 In Remix
After deployment, you'll see:
```
Deployed Contracts
▼ DUNGEONKNIGHTSGAME AT 0x... (INJECTED)
```

### 5.2 Copy Address
- Click the copy icon 📋 next to the contract address
- Save this address!

### 5.3 Verify on Explorer
1. Go to: https://explorer.testnet.chain.robinhood.com
2. Paste contract address in search
3. Should show:
   - Contract created
   - Transaction details
   - Contract code (once verified)

---

## Step 6: Update Frontend

### 6.1 Update dungeon-session.js
Open `dungeon-session.js` and change line 8:

```javascript
// OLD
this.gameContractAddress = '0x...';

// NEW
this.gameContractAddress = '0xYOUR_DEPLOYED_ADDRESS';
```

### 6.2 Redeploy Website
```bash
vercel --prod
```

---

## Step 7: Fund Contract

The contract needs $DNG to pay rewards.

### Option A: Direct Transfer (Simplest)
1. Go to mint page: https://dungeon-knights.vercel.app/mint.html
2. Connect wallet
3. In MetaMask:
   - Add $DNG token if not visible
   - Send tokens to game contract address

### Option B: Using Console
```javascript
const dngToken = new ethers.Contract(
    '0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910',
    ['function transfer(address to, uint256 amount) returns (bool)'],
    signer
);

await dngToken.transfer(
    'YOUR_GAME_CONTRACT_ADDRESS',
    ethers.utils.parseEther('100000')
);
```

---

## Step 8: Test!

### 8.1 Play Game
1. Go to menu: https://dungeon-knights.vercel.app/menu.html
2. Select knights
3. Enter dungeon
4. Complete dungeon

### 8.2 Check Rewards
- Should see floating widget: "💰 Unclaimed Rewards"
- Shows amount of $DNG earned

### 8.3 Claim Rewards
1. Click "Claim All" button
2. Confirm transaction in MetaMask
3. Wait for confirmation
4. Check $DNG balance increased!

### 8.4 Verify On-Chain
1. Go to explorer
2. Search your wallet address
3. Should see `completeDungeon` transaction
4. Click transaction → "Logs" tab
5. Should see `DungeonCompleted` event

---

## 🎉 Done!

Your game now has on-chain $DNG farming!

---

## Troubleshooting

### "Cannot find module '@openzeppelin/contracts'"
- Use Option B (manual imports) from Step 2

### "Insufficient funds for gas"
- Get testnet ETH from faucet
- Check you're on Robinhood Testnet

### "Invalid constructor arguments"
- Make sure addresses are correct
- Must be valid checksummed addresses
- Knight NFT: `0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512`
- DNG Token: `0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910`

### "Transaction failed"
- Check gas limit (should be ~3M)
- Check you have enough ETH
- Try increasing gas price

### "Transfer failed" when claiming
- Game contract needs $DNG balance
- Transfer $DNG tokens to contract address

---

## Quick Reference

**Remix IDE:** https://remix.ethereum.org
**Explorer:** https://explorer.testnet.chain.robinhood.com
**Chainlist:** https://chainlist.org/?search=robinhood

**Contract Addresses:**
- Knight NFT: `0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512`
- $DNG Token: `0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910`
- Game Contract: ⚠️ Deploy this!

---

Good luck! 🚀
