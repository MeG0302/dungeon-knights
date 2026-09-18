# 🚀 QUICK DEPLOY - 5 Steps

## What You Need
- ✅ Remix compiled contract (bytecode + ABI)
- ✅ MetaMask private key  
- ✅ Testnet ETH in wallet

---

## 🎯 5-Step Deployment

### 1️⃣ Install Dependencies
```powershell
npm install
```

### 2️⃣ Add Private Key to .env.local
```
PRIVATE_KEY=0x...your_actual_key...
```

### 3️⃣ Get Bytecode from Remix
1. Compile contract in Remix
2. Click "Compilation Details"
3. Copy **BYTECODE object** and **ABI**
4. Create `compiled-contract.json`:
```json
{
  "bytecode": "0x608060...",
  "abi": [...]
}
```

### 4️⃣ Deploy
```powershell
npm run deploy
```

### 5️⃣ Copy Contract Address
```
📍 Game Contract Address: 0x...
```
**Send this to me and I'll update the code!**

---

## ⚡ That's It!

After I update the code:
1. Fund contract with 100k+ DNG
2. Deploy: `vercel --prod`
3. Play and earn! 🎮

---

## 📖 Full Guide
See `AUTOMATED_DEPLOY_GUIDE.md` for detailed instructions.
