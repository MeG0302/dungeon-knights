# Dungeon Knights - Complete Deployment Guide

## Overview
This guide covers deploying both the **game frontend** (HTML/CSS/JS) and the **Knight NFT smart contracts** to Robinhood Chain.

---

## Part 1: Deploy the Game (Frontend)

### Option A: Deploy to Vercel (Recommended - Easiest)

#### 1. **Prepare Your Project**
```bash
# Create a vercel.json in your project root
```

Create `vercel.json`:
```json
{
  "version": 2,
  "builds": [
    {
      "src": "**/*.html",
      "use": "@vercel/static"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "/$1"
    }
  ]
}
```

#### 2. **Install Vercel CLI**
```bash
npm install -g vercel
```

#### 3. **Deploy**
```bash
cd "d:\dungeon knights robinhood"
vercel
```

Follow prompts:
- Set up and deploy? **Y**
- Which scope? Select your account
- Link to existing project? **N**
- Project name? **dungeon-knights** (or your choice)
- Directory? **./
** (current directory)
- Override settings? **N**

Your game will be live at: `https://dungeon-knights.vercel.app`

---

### Option B: Deploy to GitHub Pages

#### 1. **Create GitHub Repository**
```bash
cd "d:\dungeon knights robinhood"
git init
git add .
git commit -m "Initial commit - Dungeon Knights game"
```

#### 2. **Push to GitHub**
```bash
# Create repo on GitHub first, then:
git remote add origin https://github.com/YOUR_USERNAME/dungeon-knights.git
git branch -M main
git push -u origin main
```

#### 3. **Enable GitHub Pages**
- Go to repository Settings → Pages
- Source: **Deploy from a branch**
- Branch: **main** → **/ (root)**
- Click Save

Your game will be live at: `https://YOUR_USERNAME.github.io/dungeon-knights/`

---

### Option C: Deploy to Netlify

#### 1. **Install Netlify CLI**
```bash
npm install -g netlify-cli
```

#### 2. **Deploy**
```bash
cd "d:\dungeon knights robinhood"
netlify deploy --prod
```

Follow prompts and your game will be live!

---

## Part 2: Deploy Knight NFT Contracts to Robinhood Chain

### About Robinhood Chain
- **Network**: Ethereum Layer 2 (Arbitrum Orbit)
- **Mainnet Launch**: July 1, 2026
- **EVM Compatible**: Full support for Solidity contracts
- **Use Case**: Tokenized stocks, real-world assets, NFTs, DeFi
- **Mainnet Chain ID**: 4663
- **Testnet Chain ID**: 46630

---

## Step 1: Create NFT Smart Contract

Create `contracts/DungeonKnights.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract DungeonKnights is ERC721Enumerable, Ownable {
    using Strings for uint256;

    // Knight Rarities
    enum Rarity { COMMON, UNCOMMON, RARE, EPIC, LEGENDARY, MYTHIC }

    struct Knight {
        uint256 tokenId;
        Rarity rarity;
        uint256 power;
        uint256 speed;
        uint256 maxStamina;
        uint256 recoveryRate;
        uint256 range;
        uint256 mintedAt;
    }

    // Storage
    mapping(uint256 => Knight) public knights;
    uint256 private _nextTokenId;
    uint256 public mintPrice = 0.001 ether; // 0.001 ETH per mint
    string private _baseTokenURI;

    // Events
    event KnightMinted(
        address indexed owner,
        uint256 indexed tokenId,
        Rarity rarity,
        uint256 power,
        uint256 speed
    );

    constructor() ERC721("Dungeon Knights", "KNIGHT") Ownable(msg.sender) {
        _baseTokenURI = "ipfs://YOUR_METADATA_CID/";
    }

    // Mint a knight with random stats
    function mintKnight() public payable returns (uint256) {
        require(msg.value >= mintPrice, "Insufficient payment");

        uint256 tokenId = _nextTokenId++;
        _safeMint(msg.sender, tokenId);

        // Generate random rarity
        Rarity rarity = _rollRarity(tokenId);
        
        // Generate stats based on rarity
        uint256 multiplier = _getRarityMultiplier(rarity);
        uint256 power = (10 + (uint256(keccak256(abi.encodePacked(tokenId, "power"))) % 15)) * multiplier / 10;
        uint256 speed = _getRaritySpeed(rarity);
        uint256 maxStamina = (300 + (uint256(keccak256(abi.encodePacked(tokenId, "stamina"))) % 100)) * multiplier / 10;
        uint256 recoveryRate = (5 + (uint256(keccak256(abi.encodePacked(tokenId, "recovery"))) % 5)) * multiplier / 10;

        knights[tokenId] = Knight({
            tokenId: tokenId,
            rarity: rarity,
            power: power,
            speed: speed,
            maxStamina: maxStamina,
            recoveryRate: recoveryRate,
            range: 1, // Melee only
            mintedAt: block.timestamp
        });

        emit KnightMinted(msg.sender, tokenId, rarity, power, speed);
        
        return tokenId;
    }

    // Batch mint knights
    function mintKnights(uint256 amount) public payable {
        require(amount > 0 && amount <= 10, "Can mint 1-10 knights at once");
        require(msg.value >= mintPrice * amount, "Insufficient payment");

        for (uint256 i = 0; i < amount; i++) {
            mintKnight();
        }
    }

    // Roll rarity with weighted probabilities
    function _rollRarity(uint256 seed) private pure returns (Rarity) {
        uint256 roll = uint256(keccak256(abi.encodePacked(seed, "rarity"))) % 1000;
        
        if (roll < 650) return Rarity.COMMON;      // 65%
        if (roll < 850) return Rarity.UNCOMMON;    // 20%
        if (roll < 950) return Rarity.RARE;        // 10%
        if (roll < 995) return Rarity.EPIC;        // 4.5%
        if (roll < 999) return Rarity.LEGENDARY;   // 1.2%
        return Rarity.MYTHIC;                      // 0.3%
    }

    function _getRarityMultiplier(Rarity rarity) private pure returns (uint256) {
        if (rarity == Rarity.COMMON) return 10;
        if (rarity == Rarity.UNCOMMON) return 15;
        if (rarity == Rarity.RARE) return 22;
        if (rarity == Rarity.EPIC) return 35;
        if (rarity == Rarity.LEGENDARY) return 50;
        return 80; // MYTHIC
    }

    function _getRaritySpeed(Rarity rarity) private pure returns (uint256) {
        if (rarity == Rarity.MYTHIC) return 15;
        if (rarity == Rarity.LEGENDARY) return 7;
        if (rarity == Rarity.EPIC) return 3;
        if (rarity == Rarity.RARE) return 2;
        if (rarity == Rarity.UNCOMMON) return 1;
        return 1; // COMMON
    }

    // Get knight details
    function getKnight(uint256 tokenId) public view returns (Knight memory) {
        require(_ownerOf(tokenId) != address(0), "Knight does not exist");
        return knights[tokenId];
    }

    // Get all knights owned by address
    function getKnightsByOwner(address owner) public view returns (uint256[] memory) {
        uint256 balance = balanceOf(owner);
        uint256[] memory tokenIds = new uint256[](balance);
        
        for (uint256 i = 0; i < balance; i++) {
            tokenIds[i] = tokenOfOwnerByIndex(owner, i);
        }
        
        return tokenIds;
    }

    // Owner functions
    function setMintPrice(uint256 newPrice) public onlyOwner {
        mintPrice = newPrice;
    }

    function setBaseURI(string memory baseURI) public onlyOwner {
        _baseTokenURI = baseURI;
    }

    function withdraw() public onlyOwner {
        uint256 balance = address(this).balance;
        payable(owner()).transfer(balance);
    }

    // Override tokenURI
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        return string(abi.encodePacked(_baseTokenURI, tokenId.toString(), ".json"));
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }
}
```

---

## Step 2: Set Up Development Environment

### Install Dependencies

```bash
# Create a new directory for contracts
mkdir dungeon-knights-contracts
cd dungeon-knights-contracts

# Initialize npm
npm init -y

# Install Hardhat
npm install --save-dev hardhat

# Initialize Hardhat
npx hardhat init
# Choose: "Create a JavaScript project"

# Install OpenZeppelin contracts
npm install @openzeppelin/contracts

# Install Hardhat plugins
npm install --save-dev @nomicfoundation/hardhat-toolbox
```

---

## Step 3: Configure Hardhat for Robinhood Chain

Update `hardhat.config.js`:

```javascript
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    // Robinhood Chain Testnet
    robinhoodTestnet: {
      url: "https://rpc.testnet.chain.robinhood.com",
      chainId: 46630,
      accounts: [process.env.PRIVATE_KEY],
      gasPrice: 1000000000 // 1 gwei
    },
    // Robinhood Chain Mainnet
    robinhoodMainnet: {
      url: "https://rpc.mainnet.chain.robinhood.com",
      chainId: 4663,
      accounts: [process.env.PRIVATE_KEY],
      gasPrice: 1000000000 // 1 gwei
    }
  },
  etherscan: {
    apiKey: {
      robinhoodTestnet: "empty",
      robinhoodMainnet: "empty"
    },
    customChains: [
      {
        network: "robinhoodTestnet",
        chainId: 46630,
        urls: {
          apiURL: "https://explorer.testnet.chain.robinhood.com/api",
          browserURL: "https://explorer.testnet.chain.robinhood.com/"
        }
      },
      {
        network: "robinhoodMainnet",
        chainId: 4663,
        urls: {
          apiURL: "https://robinhoodchain.blockscout.com/api",
          browserURL: "https://robinhoodchain.blockscout.com/"
        }
      }
    ]
  }
};
```

---

## Step 4: Create Environment Variables

Create `.env` file:

```bash
# Your deployer wallet private key (NEVER commit this!)
PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE

# Optional: Alchemy/Infura API key for better RPC
ALCHEMY_API_KEY=your_api_key_here
```

**⚠️ IMPORTANT**: Add `.env` to `.gitignore`:
```
node_modules/
.env
cache/
artifacts/
```

---

## Step 5: Get Testnet ETH

### Bridge ETH to Robinhood Chain Testnet

1. **Get Sepolia ETH** from a faucet:
   - https://sepoliafaucet.com/
   - https://www.alchemy.com/faucets/ethereum-sepolia

2. **Bridge to Robinhood Testnet**:
   - Go to: https://bridge.robinhood.com/
   - Connect wallet
   - Select: Sepolia → Robinhood Chain Testnet
   - Bridge 0.1 ETH or more

---

## Step 6: Deploy to Testnet

### Create Deployment Script

Create `scripts/deploy.js`:

```javascript
const hre = require("hardhat");

async function main() {
  console.log("🚀 Deploying Dungeon Knights NFT...");

  // Get deployer account
  const [deployer] = await hre.ethers.getSigners();
  console.log("📝 Deploying with account:", deployer.address);
  
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("💰 Account balance:", hre.ethers.formatEther(balance), "ETH");

  // Deploy contract
  const DungeonKnights = await hre.ethers.getContractFactory("DungeonKnights");
  const dungeonKnights = await DungeonKnights.deploy();
  
  await dungeonKnights.waitForDeployment();
  const address = await dungeonKnights.getAddress();

  console.log("✅ Dungeon Knights deployed to:", address);
  console.log("🔗 View on explorer:", `https://explorer.testnet.chain.robinhood.com/address/${address}`);
  
  // Save deployment info
  const fs = require("fs");
  const deployment = {
    network: "Robinhood Chain Testnet",
    contractAddress: address,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    blockNumber: await hre.ethers.provider.getBlockNumber()
  };
  
  fs.writeFileSync(
    "deployment-testnet.json",
    JSON.stringify(deployment, null, 2)
  );
  
  console.log("📄 Deployment info saved to deployment-testnet.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
```

### Deploy Command

```bash
# Compile contracts
npx hardhat compile

# Deploy to testnet
npx hardhat run scripts/deploy.js --network robinhoodTestnet
```

---

## Step 7: Verify Contract

```bash
# Verify on Blockscout
npx hardhat verify --network robinhoodTestnet YOUR_CONTRACT_ADDRESS
```

---

## Step 8: Deploy to Mainnet

### Get Mainnet ETH

1. **Buy ETH** on Robinhood, Coinbase, or other exchange
2. **Bridge to Robinhood Chain Mainnet**:
   - https://bridge.robinhood.com/
   - Select: Ethereum → Robinhood Chain
   - Bridge amount needed for gas (~0.01 ETH sufficient)

### Deploy

```bash
# Deploy to mainnet (make sure you have ETH!)
npx hardhat run scripts/deploy.js --network robinhoodMainnet

# Verify
npx hardhat verify --network robinhoodMainnet YOUR_CONTRACT_ADDRESS
```

---

## Part 3: Connect Game to Smart Contract

### Update Game Code

Create `web3.js` in your game folder:

```javascript
// Web3 Integration for Dungeon Knights

const CONTRACT_ADDRESS = "YOUR_DEPLOYED_CONTRACT_ADDRESS";
const CONTRACT_ABI = [/* ABI from compilation */];

const ROBINHOOD_CHAIN = {
  chainId: '0x1237', // 4663 in hex
  chainName: 'Robinhood Chain',
  nativeCurrency: {
    name: 'Ethereum',
    symbol: 'ETH',
    decimals: 18
  },
  rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'],
  blockExplorerUrls: ['https://robinhoodchain.blockscout.com/']
};

class Web3Manager {
  constructor() {
    this.provider = null;
    this.signer = null;
    this.contract = null;
    this.userAddress = null;
  }

  async connect() {
    if (typeof window.ethereum === 'undefined') {
      alert('Please install MetaMask to play with NFTs!');
      return false;
    }

    try {
      // Request account access
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts'
      });
      
      this.userAddress = accounts[0];

      // Switch to Robinhood Chain
      await this.switchToRobinhoodChain();

      // Initialize ethers.js
      this.provider = new ethers.BrowserProvider(window.ethereum);
      this.signer = await this.provider.getSigner();
      this.contract = new ethers.Contract(
        CONTRACT_ADDRESS,
        CONTRACT_ABI,
        this.signer
      );

      console.log('✅ Connected to Robinhood Chain:', this.userAddress);
      return true;
    } catch (error) {
      console.error('Connection failed:', error);
      return false;
    }
  }

  async switchToRobinhoodChain() {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: ROBINHOOD_CHAIN.chainId }]
      });
    } catch (switchError) {
      // Chain not added, add it
      if (switchError.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [ROBINHOOD_CHAIN]
        });
      }
    }
  }

  async mintKnight() {
    try {
      const tx = await this.contract.mintKnight({
        value: ethers.parseEther("0.001") // 0.001 ETH
      });
      
      console.log('⏳ Minting knight...', tx.hash);
      const receipt = await tx.wait();
      console.log('✅ Knight minted!', receipt);
      
      return receipt;
    } catch (error) {
      console.error('Mint failed:', error);
      throw error;
    }
  }

  async getMyKnights() {
    try {
      const tokenIds = await this.contract.getKnightsByOwner(this.userAddress);
      const knights = [];
      
      for (const tokenId of tokenIds) {
        const knight = await this.contract.getKnight(tokenId);
        knights.push({
          tokenId: Number(tokenId),
          rarity: Number(knight.rarity),
          power: Number(knight.power),
          speed: Number(knight.speed),
          maxStamina: Number(knight.maxStamina),
          recoveryRate: Number(knight.recoveryRate)
        });
      }
      
      return knights;
    } catch (error) {
      console.error('Failed to fetch knights:', error);
      return [];
    }
  }
}

// Initialize
window.web3Manager = new Web3Manager();
```

---

## Network Information

### Robinhood Chain Mainnet
- **Chain ID**: 4663
- **RPC URL**: https://rpc.mainnet.chain.robinhood.com
- **Explorer**: https://robinhoodchain.blockscout.com/
- **Bridge**: https://bridge.robinhood.com/
- **Native Token**: ETH

### Robinhood Chain Testnet
- **Chain ID**: 46630
- **RPC URL**: https://rpc.testnet.chain.robinhood.com
- **Explorer**: https://explorer.testnet.chain.robinhood.com/
- **Faucet**: Bridge from Sepolia

---

## Estimated Costs

### Deployment Costs (Testnet - Free)
- Contract Deployment: ~0 ETH (testnet ETH is free)
- Verification: Free

### Deployment Costs (Mainnet)
- Contract Deployment: ~0.002-0.005 ETH (~$5-12 USD)
- Gas fees are low on L2!

### Minting Costs
- Set `mintPrice` in contract (suggested: 0.001 ETH)
- User pays: mint price + gas (~0.001 ETH total)

---

## Post-Deployment Checklist

- [ ] Frontend deployed and accessible
- [ ] NFT contract deployed to testnet
- [ ] Contract verified on block explorer
- [ ] Minting tested on testnet
- [ ] Bridge ETH to mainnet
- [ ] Deploy contract to mainnet
- [ ] Verify mainnet contract
- [ ] Update frontend with mainnet contract address
- [ ] Test minting on mainnet
- [ ] Share game URL with users!

---

## Useful Resources

- **Robinhood Chain Docs**: https://docs.robinhood.com/chain/
- **Arbitrum Docs** (underlying tech): https://docs.arbitrum.io/
- **OpenZeppelin Contracts**: https://docs.openzeppelin.com/contracts/
- **Hardhat Docs**: https://hardhat.org/docs
- **Ethers.js**: https://docs.ethers.org/

---

## Support & Community

- **Robinhood Chain Discord**: Join for dev support
- **Twitter**: Follow @RobinhoodChain for updates
- **Arbitrum Community**: Large dev ecosystem

---

**Last Updated**: September 4, 2026
**Robinhood Chain Mainnet**: Live since July 1, 2026
