# Deploy V3-Simple - Step by Step Guide

## 🎯 Goal
Deploy DungeonKnightsGameV3-Simple with batch claims (no backend required)

---

## 📋 Pre-Deployment Checklist

### Contract Details:
- **File:** `contracts/DungeonKnightsGameV3-Simple.sol`
- **Network:** Robinhood Testnet
- **Constructor Parameters:**
  - `_knightNFT`: `0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512`
  - `_dngToken`: `0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910`

### Required:
- ✅ MetaMask connected to Robinhood Testnet
- ✅ Owner wallet has DNG tokens to fund contract
- ✅ Remix IDE open: https://remix.ethereum.org

---

## 🚀 Step 1: Deploy Contract in Remix

### 1.1 Open Remix
Go to: https://remix.ethereum.org

### 1.2 Create New File
- Click "+" in File Explorer
- Name: `DungeonKnightsGameV3-Simple.sol`
- Paste the contract code from `contracts/DungeonKnightsGameV3-Simple.sol`

### 1.3 Add OpenZeppelin Imports
Remix will auto-import these, but verify in "File Explorer":
```
@openzeppelin/contracts/token/ERC721/IERC721.sol
@openzeppelin/contracts/token/ERC20/IERC20.sol
@openzeppelin/contracts/access/Ownable.sol
@openzeppelin/contracts/utils/ReentrancyGuard.sol
```

### 1.4 Compile
- Click "Solidity Compiler" tab (left sidebar)
- Select compiler: `0.8.20` or higher
- Click "Compile DungeonKnightsGameV3-Simple.sol"
- Wait for ✅ green checkmark

### 1.5 Deploy
1. Click "Deploy & Run Transactions" tab
2. **Environment:** Select "Injected Provider - MetaMask"
3. MetaMask should popup → Confirm connection
4. **Contract:** Select "DungeonKnightsGameV3 - DungeonKnightsGameV3-Simple.sol"
5. **Constructor Parameters:**
   ```
   _KNIGHTNFT: 0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512
   _DNGTOKEN: 0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910
   ```
6. Click **"Deploy"**
7. MetaMask popup → **Confirm transaction**
8. Wait 5-10 seconds for deployment

### 1.6 Save Contract Address
After deployment, you'll see:
```
> DungeonKnightsGameV3 at 0x... (address will appear)
```
**📝 Copy this address! You'll need it.**

---

## 💰 Step 2: Fund the Contract

### 2.1 Check Your DNG Balance
In Remix console, call:
```javascript
// DNG Token contract
const dngAddress = "0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910";
const dngABI = ["function balanceOf(address) view returns (uint256)"];
const dng = new ethers.Contract(dngAddress, dngABI, provider);
const balance = await dng.balanceOf(YOUR_ADDRESS);
console.log("Balance:", ethers.utils.formatEther(balance));
```

### 2.2 Approve Contract to Spend DNG
```javascript
// In Remix, load DNG token contract
// Then call: approve(V3_CONTRACT_ADDRESS, amount)

// Or use this Remix shortcut:
const dngAddress = "0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910";
const v3Address = "0x..."; // Your V3 contract address
const amount = ethers.utils.parseEther("1000000"); // 1M DNG

// Load DNG contract in Remix "At Address" feature
// Then call: approve(v3Address, amount)
```

### 2.3 Fund V3 Contract
In Remix, call on your V3 contract:
```
fundContract(1000000000000000000000000) // 1M DNG with 18 decimals
```

### 2.4 Verify Treasury Balance
Call:
```
treasuryBalance() // Should return 1000000000000000000000000
```

---

## 🔧 Step 3: Update Frontend

### 3.1 Update Contract Address
Edit `contract-addresses.js`:
```javascript
const CONTRACT_ADDRESSES = {
  RPC_URL:   'https://rpc.testnet.chain.robinhood.com',
  CHAIN_ID:  46630,
  GAME_CONTRACT: '0x...', // ← PUT V3 ADDRESS HERE
  KNIGHT_NFT:    '0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512',
  DNG_TOKEN:     '0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910',
};
```

### 3.2 Update dungeon-session.js ABI
Replace the `gameContractABI` array:
```javascript
this.gameContractABI = [
    // V3 Simple ABI
    'function batchClaimRewards((uint256[],uint256)[] runs) external',
    'function claimRewards(uint256[] calldata knightIds, uint256 dungeonId) external',
    'function runsRemaining(uint256 knightId) view returns (uint8)',
    'function getKnightStats(uint256 knightId) view returns (uint256, uint8)',
    'function treasuryBalance() view returns (uint256)'
];
```

### 3.3 Update Claim Logic
Replace `claimAllRewards()` in dungeon-session.js:
```javascript
async claimAllRewards() {
    if (this.pendingRuns.length === 0) {
        alert('No unclaimed rewards!');
        return false;
    }

    if (!window.walletManager || !window.walletManager.isConnected) {
        alert('Please connect your wallet first!');
        return false;
    }

    try {
        console.log(`🎁 Batch claiming ${this.pendingRuns.length} runs...`);

        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const signer = provider.getSigner();
        const gameContract = new ethers.Contract(
            this.gameContractAddress,
            this.gameContractABI,
            signer
        );

        // Format runs for V3 contract
        const runs = this.pendingRuns.map(run => ({
            knightIds: run.knightIds,
            dungeonId: run.dungeonId
        }));

        console.log('📝 Submitting batch claim with', runs.length, 'runs');

        // Submit batch claim transaction
        const tx = await gameContract.batchClaimRewards(runs);
        console.log('📝 Transaction sent:', tx.hash);

        // Wait for confirmation
        const receipt = await tx.wait();
        console.log('✅ Confirmed!');

        // Parse RewardsClaimed event
        const event = receipt.events?.find(e => e.event === 'RewardsClaimed');
        if (event) {
            const amount = ethers.utils.formatEther(event.args.amount);
            console.log(`💰 Claimed ${amount} DNG for ${event.args.runsCount} runs`);
        }

        // Clear pending runs
        this.pendingRuns = [];
        this.saveToLocalStorage();

        alert(`Successfully claimed rewards!`);
        return true;

    } catch (error) {
        console.error('❌ Claim failed:', error);
        
        let errorMsg = 'Claim failed: ';
        if (error.message.includes('No runs left today')) {
            errorMsg += 'One or more knights have no runs left today.';
        } else if (error.message.includes('Not your knight')) {
            errorMsg += 'You do not own one or more of these knights.';
        } else if (error.message.includes('Treasury empty')) {
            errorMsg += 'Contract treasury is empty. Please contact support.';
        } else {
            errorMsg += error.message;
        }

        alert(errorMsg);
        return false;
    }
}
```

---

## 🧪 Step 4: Test the Flow

### 4.1 Test Single Claim
1. Complete 1 dungeon in game
2. Click "Claim All"
3. MetaMask popup → Confirm
4. Should succeed and clear pending runs

### 4.2 Test Batch Claim
1. Complete 3 dungeons (don't claim yet)
2. Click "Claim All"
3. Should claim all 3 in ONE transaction
4. Check console logs for confirmation

### 4.3 Test Daily Limits
1. Complete 5 dungeons with same common knight
2. Try to complete 6th → Should fail
3. Wait until next 12:00 PM UTC → Should reset

---

## 🚀 Step 5: Deploy to Vercel

### 5.1 Commit Changes
```bash
# Not using git, so just deploy directly
vercel --prod
```

### 5.2 Test Live Site
1. Go to: https://dungeon-knights.vercel.app
2. Connect wallet
3. Complete dungeon
4. Try claiming
5. Verify transaction on explorer

---

## ✅ Deployment Complete!

### Verify Everything Works:
- [ ] V3 contract deployed
- [ ] Treasury funded with DNG
- [ ] Frontend updated with V3 address
- [ ] Frontend updated with V3 ABI
- [ ] Claim logic updated for batch claims
- [ ] Single claim tested
- [ ] Batch claim tested (3+ dungeons)
- [ ] Daily limits verified
- [ ] Deployed to Vercel
- [ ] Live site tested

---

## 📝 Contract Info Summary

**Save this for reference:**
```
Contract Name: DungeonKnightsGameV3-Simple
Contract Address: 0x... (fill in after deployment)
Network: Robinhood Testnet (46630)
Explorer: https://testnet.rh-explorer.com/address/0x...
Treasury Balance: 1,000,000 DNG

Knight NFT: 0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512
DNG Token: 0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910

Deployment Date: [DATE]
Deployed By: 0x038d75aDb74d8e5Db82E6c6797f90dCdF82ef4C9
```

---

## 🔄 Rollback Plan (If Needed)

If V3 has issues, you can rollback to V2:
1. Update `contract-addresses.js` back to V2 address
2. Restore old ABI in dungeon-session.js
3. Redeploy to Vercel
4. V2 will still work since it's on-chain

---

## 🎉 Success!

Your game now has batch claims! Players can:
- ✅ Complete multiple dungeons
- ✅ Claim all at once in 1 transaction
- ✅ Save 50-80% on gas costs
- ✅ No more 30-second waits!

**Next: Monitor for issues and gather player feedback!**
