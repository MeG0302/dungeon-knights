# 🏰 Dungeon Knights - Blockchain Idle RPG

An NFT-based idle RPG game where players mint knight NFTs, battle through dungeons, and earn $DNG tokens on Robinhood Chain.

![Game Banner](https://dungeon-knights.vercel.app)

## 🎮 Features

- **NFT Knights**: Mint unique knight NFTs with 5 rarity tiers
- **Idle Gameplay**: Knights automatically battle through dungeons
- **Play-to-Earn**: Earn $DNG tokens by completing dungeons
- **Rarity System**: Common, Uncommon, Rare, Epic, Legendary
- **Squad Management**: Deploy up to 5 knights simultaneously
- **Web3 Integration**: Multi-wallet support (MetaMask, Coinbase, WalletConnect, etc.)
- **Mobile Responsive**: Play on any device

## 🪙 Tokenomics

- **Token**: $DNG (Dungeon Token)
- **Total Supply**: 1,000,000 $DNG
- **Network**: Robinhood Chain (Mainnet)
- **Mint Cost**: 500 $DNG per knight (random rarity)
- **ROI**: 25 dungeons for Uncommon knights
- **No Burning**: Sustainable recirculation model

### Token Distribution
- 35% - Reward Pool (player earnings)
- 30% - Liquidity (DEX)
- 15% - Treasury (development)
- 10% - Marketing
- 10% - Team (vested)

## 🎯 Rarity & Rewards

| Rarity | Drop Rate | Dungeon Reward | Dungeons to ROI |
|--------|-----------|----------------|-----------------|
| Common | 50% | 12 $DNG | 42 |
| Uncommon | 30% | 20 $DNG | 25 ✅ |
| Rare | 15% | 36 $DNG | 14 |
| Epic | 4% | 60 $DNG | 9 |
| Legendary | 1% | 100 $DNG | 5 |

## 🚀 Tech Stack

- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Blockchain**: Solidity, ethers.js v5
- **Wallet**: RainbowKit (multi-wallet support)
- **Network**: Robinhood Chain
- **Deployment**: Vercel
- **Audio**: Web Audio API

## 🎨 Game Assets

- Custom pixel art characters
- Dungeon map tiles
- Sound effects & music
- Animated sprites

## 📦 Project Structure

```
dungeon-knights/
├── landing.html          # Landing page
├── menu.html            # Squad management
├── mint.html            # NFT minting
├── game.js              # Game logic
├── web3-integration.js  # Web3 functionality
├── config.js            # Network configuration
├── rainbowkit-integration.js  # Multi-wallet support
├── mobile.css           # Responsive design
└── assets/              # Game assets
```

## 🔧 Setup & Installation

### Prerequisites
- Node.js 16+
- MetaMask or compatible Web3 wallet
- Robinhood Chain testnet/mainnet ETH

### Local Development

```bash
# Clone repository
git clone https://github.com/YOUR_USERNAME/dungeon-knights.git
cd dungeon-knights

# Serve locally (use any static server)
npx http-server .

# Or use Python
python -m http.server 8000

# Open http://localhost:8000
```

### Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

## 🎮 How to Play

1. **Connect Wallet**: Click "Connect Wallet" and choose your wallet
2. **Mint Knights**: Pay 500 $DNG to mint a random rarity knight
3. **Deploy Squad**: Add knights to your squad (max 5)
4. **Enter Dungeon**: Choose a dungeon and start battling
5. **Earn Rewards**: Complete dungeons to earn $DNG tokens
6. **ROI in 25 Dungeons**: Uncommon knights break even after 25 clears

## 🔗 Smart Contracts

### Robinhood Chain Testnet
- **NFT Contract**: `0xEA37B1D036a880DfF372bCdd8b2A3AEeEe01e55A`
- **ChainID**: 46630

### Robinhood Chain Mainnet
- **Token Contract**: TBD (to be deployed)
- **NFT Contract**: TBD (to be deployed)
- **ChainID**: 4663

## 🌐 Links

- **Live Game**: [dungeon-knights.vercel.app](https://dungeon-knights.vercel.app)
- **Robinhood Chain Explorer**: [robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com)
- **Documentation**: See `/docs` folder

## 🛠️ Configuration

Edit `config.js` to switch between testnet and mainnet:

```javascript
USE_MAINNET: false  // Set to true for mainnet
```

## 🔐 Security

- Private keys never stored in code
- Web3 wallet integration (non-custodial)
- Audited smart contracts (recommended before mainnet)
- Treasury multi-sig wallet (recommended)

## 📄 License

MIT License - see LICENSE file

## 🤝 Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Open a pull request

## 📞 Support

- GitHub Issues: [Report bugs](https://github.com/YOUR_USERNAME/dungeon-knights/issues)
- Discord: [Join community](#)
- Twitter: [@DungeonKnights](#)

## 🎯 Roadmap

### Phase 1 (Current)
- ✅ NFT minting system
- ✅ Basic dungeon gameplay
- ✅ $DNG token integration
- ✅ Multi-wallet support
- ✅ Mobile responsive design

### Phase 2 (Q1 2027)
- [ ] PvP tournaments
- [ ] Equipment system
- [ ] Stat upgrades
- [ ] Marketplace trading
- [ ] Staking rewards

### Phase 3 (Q2 2027)
- [ ] Guild system
- [ ] Seasonal events
- [ ] Advanced dungeons
- [ ] Achievement system
- [ ] Leaderboards

## 💎 Why Play Dungeon Knights?

- **Fair Economics**: All players can ROI in 25 dungeons
- **No Pay-to-Win**: Skill and strategy matter
- **True Ownership**: NFTs are yours forever
- **Sustainable**: Reward pool recirculates from minting
- **Mobile-Friendly**: Play anywhere, anytime
- **Community-Driven**: Player feedback shapes development

## 🏆 Credits

Developed with ❤️ by the Dungeon Knights team

---

**Start your adventure today!** 🗡️⚔️🛡️

[Play Now](https://dungeon-knights.vercel.app) | [Join Discord](#) | [Follow Twitter](#)
