# Deploying Game V4 (server-signed runs)

V3 pays any batch of runs a wallet sends. It checks ownership, rarity and the daily cap,
and nothing else — no time check, no proof a dungeon was played — so a script can claim a
full day's allowance (15 knights × 5 runs = 75 payouts) in one transaction. V4 adds the
one thing missing: **every run must carry a signature from your backend**, over the exact
run it authorises, bound to this chain and this contract.

Nothing here needs a local compiler. The contract is in `contracts/DungeonKnightsGameV4.sol`
and you deploy it from Remix, exactly as V3 was deployed.

---

## 0. Before you start

| you need | where from |
|---|---|
| A signer keypair | `node tools/gen-signer.js` (prints an address + private key once) |
| DNG to fund V4 | the owner wallet, or swept out of V3 in step 6 |
| V3's owner wallet | the wallet that deployed V3 — only it can pause V3 and withdraw from it |
| Robinhood Chain testnet in MetaMask | chain id `46630`, RPC `https://rpc.testnet.chain.robinhood.com`, symbol `ETH` |

Put the signer **private key** into Vercel first, so the deployment and the backend agree
from the first claim:

> Vercel → your project → Settings → Environment Variables → **Add New**
> - Key: `GAME_SIGNER_PRIVATE_KEY` · Value: the private key · **Secret** · Production + Preview
> - Key: `GAME_CONTRACT_V4` · Value: *(leave until step 5 — the app keeps using V3 while this is empty)*

Also set these once, so every signed receipt is stable across redeploys (a missing secret
still works, but cold starts would invalidate run tokens):

- `GAME_RUN_SECRET` — any long random string
- `POINTS_SESSION_SECRET` — if it is not set already

---

## 1. Remix

1. Open **https://remix.ethereum.org**
2. **File Explorer → `contracts/` → New File** → name it `DungeonKnightsGameV4.sol`
3. Paste the whole contents of `contracts/DungeonKnightsGameV4.sol`
4. Remix will fetch the OpenZeppelin imports on compile. If it cannot, enable the
   **OpenZeppelin** plugin library from the plugin manager, or install
   `@openzeppelin/contracts@5.0.2` in the plugin's "Import from npm" box.

## 2. Compile

**Solidity Compiler** tab:

- Compiler: **0.8.20** (or any 0.8.20+ — the pragma is `^0.8.20`)
- Advanced → **Enable optimization**: on, **200 runs**
- Press **Compile DungeonKnightsGameV4.sol** and wait for the green check

## 3. Deploy

**Deploy & Run Transactions** tab:

- Environment: **Injected Provider — MetaMask**
- Check MetaMask is on **Robinhood Chain testnet** and on the **owner** wallet
- Contract: `DungeonKnightsGameV4`

Constructor arguments, in order:

| # | argument | value |
|---|---|---|
| 1 | `_knightNFT` | `0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512` |
| 2 | `_dngToken` | `0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910` |
| 3 | `_trustedSigner` | the **address** printed by `tools/gen-signer.js` |

Pass them as `"0x06c7…","0xA8D5…","0x…"` and press **transact**. Confirm in MetaMask.

> If a signer address is not ready yet, deploy with the owner address as the third
> argument and call `setTrustedSigner(<signer>)` afterwards — the owner can rotate it.

## 4. Note the address

Copy the deployed address from the **Deployed Contracts** panel at the bottom of the
Deploy tab. That is your V4 address.

## 5. Verify the wiring (read-only, no gas)

```bash
node tools/check-v4.js 0x<your V4 address>
```

It confirms the NFT/token wiring, that `trustedSigner` matches `GAME_SIGNER_PRIVATE_KEY`,
that the reward table is identical to V3's, and that V3 is not yet paused. Fix anything it
reports **before** funding.

## 6. Fund V4, then close V3

Do this in order. The front end still uses V3 until step 7, so pre-upgrade runs in
players' browsers stay claimable — and the game flushes them automatically the first time
a player loads the new build.

**a. Move the treasury out of V3** (Deployed Contracts → the V3 instance):

1. `setPaused(true)` — stops the unsigned claim path immediately
2. `withdrawAllTokens()` — sends V3's whole DNG balance to the owner wallet

**b. Fund V4** (Deployed Contracts → the V4 instance). `fundContract` uses
`transferFrom`, so approve first — on the **DNG token** contract
(`0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910`):

1. `approve(0x<your V4 address>, <amount in wei> — e.g. 10000000000000000000000 for 10000 DNG)`
2. On V4: `fundContract(<same amount>)`

**c. Confirm:**

```bash
node tools/check-v4.js 0x<your V4 address>
```

Every line should say `ok`, including *"V3 is paused"*.

## 7. Turn the signed path on

Add the V4 address to Vercel and redeploy:

- Key: `GAME_CONTRACT_V4` · Value: `0x<your V4 address>` · Production + Preview

The client reads it from `GET /api/game/config`. While it is empty the game records runs
exactly as it did before and claims on V3 — which is why this step, not the deploy, is
what switches the site over.

Check it took:

```bash
curl -s https://dungeon-knights.vercel.app/api/game/config
# → "v4":"0x…","signing":true
```

## 8. Prove the gate actually holds (optional, ~1 minute)

In Remix, on the deployed V4, call:

```
claimSignedRuns([[ [1], 1, 1000000000000000000, 1, 9999999999, "0x11…(65 bytes)…11" ]])
```

It must revert with **"Bad signature"**. That single call is the whole point of V4: a run
the backend did not sign is worthless, no matter who sends it or how it is shaped.

Then do a real one — play a dungeon in the game, press **Claim All**, and confirm the
claim lands on the V4 address (the transaction modal links it).

---

## Rolling back

Nothing here is one-way:

| to undo | do this |
|---|---|
| The signed path, temporarily | delete `GAME_CONTRACT_V4` in Vercel and redeploy — the client falls back to V3 |
| V3 accepting unsigned claims again | `setPaused(false)` on V3 (it still holds whatever DNG is left in it) |
| A leaked signer key | `node tools/gen-signer.js`, then `setTrustedSigner(newAddress)` on V4, then update `GAME_SIGNER_PRIVATE_KEY` |

## What V4 does and does not guarantee

**Does:** no payout without a signature from your backend; no replay (single-use nonces,
on chain); the reward is re-derived from on-chain rarity, so a bad signature cannot
overpay; the minimum run time is measured on the server's clock, not the browser's; the
old contract can be paused, so both paths cannot be farmed at once.

**Does not:** prove a human watched the knights. A bot that starts and finishes runs on
schedule still earns — but it must wait the same minimum time an honest player does, and
the on-chain daily caps bound it either way. Making the client report gameplay it can
prove is backend-verification work, not a contract change.
