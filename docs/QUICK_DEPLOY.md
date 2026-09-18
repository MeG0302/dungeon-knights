# Quick Deployment Checklist

## 🎮 Deploy Game Frontend (5 minutes)

### Fastest: Vercel
```bash
npm install -g vercel
cd "d:\dungeon knights robinhood"
vercel
```
✅ Done! Game is live at your Vercel URL

---

## ⚔️ Deploy NFT Contract to Robinhood Chain

### Prerequisites
- [ ] Node.js installed
- [ ] MetaMask wallet with ETH
- [ ] Private key ready (for deployment)

### Step 1: Setup (5 minutes)
```bash
mkdir dungeon-knights-contracts
cd dungeon-knights-contracts
npm init -y
npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox
npm install @openzeppelin/contracts
npx hardhat init
```

### Step 2: Copy Files
- Copy `DungeonKnights.sol` from DEPLOYMENT_GUIDE.md → `contracts/`
- Copy `hardhat.config.js` config from guide
- Create `.env` with your `PRIVATE_KEY`

### Step 3: Get Testnet ETH
1. Get Sepolia ETH: https://sepoliafaucet.com/
2. Bridge to Robinhood Testnet: https://bridge.robinhood.com/

### Step 4: Deploy to Testnet
```bash
npx hardhat compile
npx hardhat run scripts/deploy.js --network robinhoodTestnet
npx hardhat verify --network robinhoodTestnet YOUR_CONTRACT_ADDRESS
```

### Step 5: Deploy to Mainnet (when ready)
1. Bridge real ETH to Robinhood Chain mainnet
2. Deploy: `npx hardhat run scripts/deploy.js --network robinhoodMainnet`
3. Verify: `npx hardhat verify --network robinhoodMainnet YOUR_CONTRACT_ADDRESS`

---

## 🔗 Connect Game to Contract

### Add to index.html
```html
<script src="https://cdn.ethers.io/lib/ethers-5.7.2.umd.min.js"></script>
<script src="web3.js"></script>
```

### Update web3.js
- Replace `CONTRACT_ADDRESS` with your deployed address
- Add contract ABI from compilation

---

## 📊 Quick Reference

| Network | Chain ID | RPC URL |
|---------|----------|---------|
| Testnet | 46630 | https://rpc.testnet.chain.robinhood.com |
| Mainnet | 4663 | https://rpc.mainnet.chain.robinhood.com |

| Action | Cost (Mainnet) |
|--------|----------------|
| Deploy Contract | ~0.003 ETH |
| Mint Knight | 0.001 ETH + gas |
| Transfer NFT | ~0.0001 ETH |

---

## 🚀 Production URLs

**Game**: https://YOUR-GAME.vercel.app
**Contract**: https://robinhoodchain.blockscout.com/address/YOUR_CONTRACT
**Bridge**: https://bridge.robinhood.com/

---

## ⚡ Why Robinhood Chain?

✅ **EVM Compatible** - Use standard Ethereum tools
✅ **Low Gas Fees** - L2 scaling = cheap transactions
✅ **Fast** - Instant confirmations
✅ **Growing Ecosystem** - Launched July 2026, active community
✅ **Real Assets** - Built for tokenized stocks/assets
✅ **Arbitrum Tech** - Proven, secure infrastructure

---

## 🆘 Troubleshooting

**"Insufficient funds"**
- Need ETH on Robinhood Chain (bridge from Ethereum)

**"Wrong network"**
- Switch MetaMask to Robinhood Chain (chain ID 4663 or 46630)

**"Contract not verified"**
- Run: `npx hardhat verify --network NETWORK ADDRESS`

**"Can't mint"**
- Check you're on correct network
- Ensure you have enough ETH (0.001 + gas)

---

## 📞 Get Help

- Robinhood Chain Docs: https://docs.robinhood.com/chain/
- Discord: Find Robinhood Chain developer channel
- GitHub: Check issues/discussions

---

**Ready to deploy?** Start with testnet, then move to mainnet when confident! 🎉
