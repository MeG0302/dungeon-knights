# 🔐 Privy Integration Setup

> **Superseded — kept for history.** The integration described below (`privy-integration.js`,
> `privy-config.js`, `public/js/web3/*`) was never loaded by any page and has been deleted.
> Wallets now go through `public/wallet-source.js` and `app/api/wallet/config/route.js`:
> an injected extension first, an embedded (Privy) wallet when `PRIVY_APP_ID` is set on the
> server. See `.freebuff/run.md` → "Wallets: injected first, embedded when configured" for the
> steps that actually switch it on.

## What is Privy?
Privy allows users to connect with:
- 🦊 MetaMask
- 💙 Coinbase Wallet
- 🌐 WalletConnect (150+ wallets)
- 📧 Email (embedded wallet)
- 🔐 Social (Google, Twitter, Discord)

---

## Steps to Enable Privy

### 1. Get Privy API Key
1. Go to https://dashboard.privy.io/
2. Sign up / Log in
3. Create new app: "Dungeon Knights"
4. Copy your **App ID**

### 2. Add to config.js
I'll update the config to include:
```javascript
PRIVY_APP_ID: 'YOUR_PRIVY_APP_ID_HERE'
```

### 3. That's it!
I'll handle all the integration. Players can connect with any wallet!

---

## Benefits
✅ Support 150+ wallets
✅ Email login (no wallet needed)
✅ Social login (Google, Twitter)
✅ Better UX for non-crypto users
✅ Still works with existing MetaMask users

---

## Cost
- **Free tier**: Up to 1,000 monthly active users
- **Pro**: $99/month for unlimited users

Start with free tier!
