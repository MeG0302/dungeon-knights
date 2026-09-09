# 🔗 Dungeon Knights Web3 Integration Guide

## ✅ Deployment Status

### Game Frontend
- **URL**: https://dungeon-knights.vercel.app
- **Status**: ✅ Live with Web3 integration

### NFT Smart Contract (Testnet)
- **Contract**: `0xEA37B1D036a880DfF372bCdd8b2A3AEeEe01e55A`
- **Network**: Robinhood Chain Testnet
- **Chain ID**: 46630 (0xb5f6)
- **RPC**: https://rpc.testnet.chain.robinhood.com
- **Explorer**: https://explorer.testnet.chain.robinhood.com/address/0xEA37B1D036a880DfF372bCdd8b2A3AEeEe01e55A

---

## 🎮 How It Works

### Dual-Mode Minting

Players can choose between two modes:

#### 🆓 **Free Mode** (Default)
- Unlimited knight minting
- Costs: 10 Gold per knight
- Storage: Browser localStorage
- No wallet needed
- Perfect for: Testing, practice, demo

#### 💎 **NFT Mode** (Blockchain)
- Real ERC-721 NFTs
- Costs: 0.001 ETH per knight (testnet)
- Storage: Robinhood Chain blockchain
- Requires: MetaMask wallet
- Perfect for: Real ownership, trading, value

---

## 🚀 User Instructions

### Step 1: Access the Game
Visit: https://dungeon-knights.vercel.app

### Step 2: Try Free Mode (No Setup)
1. Click "Summon Knights" from landing page
2. Use Gold to mint unlimited knights
3. Knights stored locally in browser

### Step 3: Upgrade to NFT Mode
1. Install MetaMask: https://metamask.io/
2. Add Robinhood Chain Testnet to MetaMask:
   - Network Name: `Robinhood Chain Testnet`
   - RPC URL: `https://rpc.testnet.chain.robinhood.com`
   - Chain ID: `46630`
   - Currency Symbol: `ETH`
   - Explorer: `https://explorer.testnet.chain.robinhood.com`

3. Get testnet ETH (you already have some!)
4. Click "Connect Wallet" in game
5. Approve MetaMask connection
6. Switch to "NFT Mode" toggle
7. Mint real NFT knights (0.001 ETH each)

---

## 💰 Future: $DNG Token Integration

### Current (Testnet)
- Minting costs: **0.001 ETH** per knight

### Future (Mainnet)
- Minting costs: **$DNG tokens** (Dungeon token)
- Players will need to:
  1. Buy/earn $DNG tokens
  2. Approve token spending
  3. Mint knights with $DNG

### To Deploy $DNG Token:
1. Create ERC-20 token contract:
   ```solidity
   contract DungeonToken is ERC20 {
       constructor() ERC20("Dungeon", "DNG") {
           _mint(msg.sender, 1000000 * 10**18); // 1M tokens
       }
   }
   ```

2. Update `DungeonKnights.sol` contract:
   - Change `mintPrice` to accept ERC-20 tokens
   - Add `IERC20 public dungeonToken;`
   - Update mint functions to use `token.transferFrom()`

3. Redeploy both contracts to mainnet

---

## 🛠️ Technical Architecture

### Frontend Files
- `web3-integration.js` - Web3Manager class (wallet, minting, contract calls)
- `mint.js` - Updated with dual-mode logic
- `mint.html` - Mode toggle UI, wallet button
- `mint.css` - Web3 styles

### Smart Contract
- `DungeonKnights.sol` - ERC-721 NFT with on-chain stats
- Location: `D:\dungeon-knights-contracts\contracts\`

### Key Features
✅ MetaMask wallet connection
✅ Network auto-switch (Robinhood Chain)
✅ Dual-mode toggle (Free/NFT)
✅ Single & batch minting (1-5 knights)
✅ Load NFT knights from blockchain
✅ NFT badge display (💎)
✅ Transaction status feedback
✅ Error handling

---

## 🔄 Deployment Commands

### Redeploy Frontend
```bash
cd "d:\dungeon knights robinhood"
vercel --prod
```

### Deploy to Mainnet
```bash
cd D:\dungeon-knights-contracts
node scripts/deploy-mainnet.js
```

### Update Contract Address (After Mainnet Deploy)
Edit `web3-integration.js`:
```javascript
const CONTRACTS = {
  testnet: "0xEA37B1D036a880DfF372bCdd8b2A3AEeEe01e55A",
  mainnet: "0xYOUR_MAINNET_ADDRESS_HERE" // <-- Update this
};
```

Then change line:
```javascript
window.web3Manager = new Web3Manager(false); // false = mainnet
```

---

## 🧪 Testing Checklist

### Free Mode ✅
- [x] Can mint knights with Gold
- [x] Knights saved to localStorage
- [x] No wallet needed

### NFT Mode ✅
- [x] Wallet connect button works
- [x] MetaMask popup appears
- [x] Network switches to Robinhood Chain
- [x] Mint costs 0.001 ETH
- [x] Transaction sent to blockchain
- [x] NFT appears in game with 💎 badge
- [x] NFT visible on block explorer

### Future: $DNG Token Mode ⏳
- [ ] Deploy $DNG ERC-20 token
- [ ] Update contract to accept $DNG
- [ ] Update UI to show $DNG cost
- [ ] Test token approval flow
- [ ] Test minting with $DNG

---

## 📊 Gas Costs (Testnet)

| Action | Cost | Notes |
|--------|------|-------|
| Deploy Contract | ~0.00009 ETH | One-time |
| Mint 1 Knight | 0.001 ETH | Set by contract |
| Mint 5 Knights | 0.005 ETH | Batch discount coming |

---

## 🎯 Next Steps

1. **Test the integration**:
   - Visit https://dungeon-knights.vercel.app
   - Connect wallet
   - Mint testnet NFT knights
   - Verify on block explorer

2. **When ready for mainnet**:
   ```bash
   node scripts/deploy-mainnet.js
   ```
   - Update contract address in `web3-integration.js`
   - Redeploy frontend: `vercel --prod`

3. **Deploy $DNG Token** (when ready):
   - Create ERC-20 contract
   - Deploy to mainnet
   - Update `DungeonKnights.sol` to accept $DNG
   - Redeploy NFT contract
   - Update frontend to show $DNG costs

---

## 🆘 Troubleshooting

### "Connect Wallet" not working
- Make sure MetaMask is installed
- Try refreshing the page
- Check browser console for errors

### Transaction failing
- Make sure you have enough testnet ETH
- Check you're on correct network (46630)
- Try increasing gas limit in MetaMask

### NFT not showing in game
- Wait 5-10 seconds for blockchain confirmation
- Refresh the page
- Check contract on explorer to verify mint succeeded

### Wrong network in MetaMask
- Click wallet button to auto-switch
- Or manually switch to Robinhood Chain Testnet

---

## 📝 Contract Interaction

### View Your NFTs
```javascript
// In browser console:
await web3Manager.connect();
const myKnights = await web3Manager.getMyKnights();
console.log(myKnights);
```

### Check Mint Price
```javascript
const price = await web3Manager.getMintPrice();
console.log('Mint price:', price, 'ETH');
```

### Mint Single Knight
```javascript
const tokenId = await web3Manager.mintKnight();
console.log('Minted Knight #' + tokenId);
```

---

## 🎉 Success!

Your game now has full Web3 integration with:
- ✅ Dual-mode minting (Free + NFT)
- ✅ MetaMask wallet connection
- ✅ Robinhood Chain testnet deployment
- ✅ On-chain NFT storage
- ✅ Ready for $DNG token upgrade

**Game**: https://dungeon-knights.vercel.app
**Contract**: https://explorer.testnet.chain.robinhood.com/address/0xEA37B1D036a880DfF372bCdd8b2A3AEeEe01e55A

Enjoy your blockchain-powered idle RPG! 🎮⚔️💎
