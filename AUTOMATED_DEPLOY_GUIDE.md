# 🚀 Automated Contract Deployment Guide

This guide will help you deploy the DungeonKnightsGame contract with just ONE command!

## 📋 Prerequisites

1. **Node.js installed** (check with `node --version`)
2. **MetaMask wallet** with Robinhood Chain Testnet configured
3. **Testnet ETH** in your wallet (for gas fees)
4. **Private key** from MetaMask

---

## 🔧 Step-by-Step Instructions

### Step 1: Install Dependencies

Open PowerShell in the project folder and run:

```powershell
npm install
```

This installs `ethers` and `dotenv` packages.

---

### Step 2: Add Your Private Key

1. Open MetaMask
2. Click on your account → **Account Details** → **Show Private Key**
3. Enter your password and copy the private key
4. Open `.env.local` file
5. Replace `your_private_key_here` with your actual private key:

```
PRIVATE_KEY=0x1234567890abcdef...
```

⚠️ **IMPORTANT**: Never share your private key or commit it to GitHub!

---

### Step 3: Get Contract Bytecode from Remix

1. Go to https://remix.ethereum.org
2. Compile `DungeonKnightsGame.sol` (the fixed version)
3. Click **"Compilation Details"** button (bottom of compiler panel)
4. Scroll down to **"BYTECODE"** section
5. Copy the entire **"object"** field value (starts with `0x608060...`)
6. Also copy the **ABI** section (big JSON array)

---

### Step 4: Create compiled-contract.json

Create a file named `compiled-contract.json` in the project root:

```json
{
  "bytecode": "0x608060405234801561000f575f80fd5b50604051611ff9...",
  "abi": [
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "_knightNFT",
          "type": "address"
        },
        {
          "internalType": "address",
          "name": "_dngToken",
          "type": "address"
        }
      ],
      "stateMutability": "nonpayable",
      "type": "constructor"
    },
    ...
  ]
}
```

Paste the bytecode and ABI you copied from Remix.

---

### Step 5: Deploy the Contract

Run the deployment script:

```powershell
npm run deploy
```

or

```powershell
node deploy-game-contract.js
```

---

### Step 6: Copy the Contract Address

The script will output something like:

```
✅ CONTRACT DEPLOYED SUCCESSFULLY! ✅

══════════════════════════════════════════════════════════════
📍 Game Contract Address: 0x1234567890abcdef1234567890abcdef12345678
══════════════════════════════════════════════════════════════
```

**Copy this address!**

---

### Step 7: Update Game Code

Send me the contract address and I'll automatically update:
- `dungeon-session.js` (line 8)
- Any other files that need the address

---

### Step 8: Fund the Contract

Transfer $DNG tokens to the game contract:

1. Open MetaMask
2. Go to "Send"
3. Paste the game contract address
4. Send at least **100,000 DNG** (for rewards)

---

### Step 9: Deploy to Vercel

```powershell
vercel --prod
```

---

### Step 10: Test!

1. Go to your game: https://dungeon-knights.vercel.app
2. Connect wallet
3. Select a knight
4. Play a dungeon
5. Complete it
6. Check if the reward widget shows $DNG! 🎉

---

## 🐛 Troubleshooting

### Error: PRIVATE_KEY not found
- Make sure `.env.local` has `PRIVATE_KEY=0x...` (not `your_private_key_here`)

### Error: Insufficient balance
- Get testnet ETH from a faucet
- Check you're on Robinhood Chain Testnet

### Error: compiled-contract.json not found
- Make sure you created the file with bytecode and ABI from Remix
- Check the file is in the project root folder

### Deployment hangs
- Wait up to 60 seconds
- Check Robinhood Chain explorer for your transaction
- If it fails, try increasing `gasLimit` in the script

---

## 📄 Files Created

- `deployed-contracts.json` - Contains all deployment info
- `node_modules/` - NPM dependencies
- `package-lock.json` - Dependency lock file

---

## 🎯 What This Script Does

1. ✅ Checks your private key exists
2. ✅ Connects to Robinhood Chain Testnet
3. ✅ Checks your wallet balance
4. ✅ Deploys the contract with correct parameters
5. ✅ Waits for blockchain confirmation
6. ✅ Saves the contract address
7. ✅ Gives you next steps

---

## 🔐 Security Notes

- Never commit `.env.local` to GitHub (already in `.gitignore`)
- Never share your private key
- Only use testnet private keys for testing
- Use a separate wallet for mainnet deployment

---

## 📞 Need Help?

If you get stuck, send me:
1. The error message
2. Your wallet address (NOT private key!)
3. Screenshot of the error

I'll help you fix it! 🚀
