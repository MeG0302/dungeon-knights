# 🚨 Dungeon Knights - Emergency Recovery Plan

## Current Situation (2026-09-15)

### 💰 Funds at Risk: 320,339 DNG

**4 abandoned contracts with exploitable vulnerabilities:**

| Contract | Balance | Type | Risk Level |
|----------|---------|------|------------|
| `0x45B905f66789bED9A1e9FF47f5429aF41A370E17` | 204,000 DNG | V1 | 🔴 CRITICAL - Self-signed rewards |
| `0xb4cee9bA94660BDB19C3a933d71d94623c0B1ec5` | 99,785 DNG | V1 | 🔴 CRITICAL - Self-signed rewards |
| `0xbA216A5f7733B0B989eD751496386B759698797F` | 7,409 DNG | V1 | 🔴 CRITICAL - Self-signed rewards + No cooldown |
| `0xd6D40B6C0D22f43866F6FBab3cf0DddDba05cFd5` | 9,145 DNG | V2 | 🟡 MEDIUM - Stranded, no known exploit |

### ⚡ The V1 Exploit

V1 contracts allow **caller-supplied reward amounts** with self-signed signatures:

```solidity
function completeDungeon(
    uint256 knightId,
    uint256 dungeonId,
    uint256 timeSpent,
    uint256 reward,        // ❌ ATTACKER CONTROLS THIS
    uint256 timestamp,
    bytes memory signature
) external {
    // Validates signature against msg.sender
    require(signer == msg.sender, "Invalid signature");
    // ❌ NO trusted signer check!
    // ❌ Attacker signs their own reward amount
}
```

**Impact:**
- Any knight holder can claim up to 2,250 DNG per call
- `batchCompleteDungeons` has no cooldown check
- 45 runs × 2,250 DNG = **101,250 DNG in 1 transaction**
- **Repeatable until treasury is empty**

### 🎯 Live Production Contract (Safe)

| Contract | Address | Treasury | Status |
|----------|---------|----------|--------|
| **V3 Simple (LIVE)** | `0xD8de9385Db7DfE925882E76849B6e067e47236e5` | 5,000 DNG | ✅ Secure (no exploits) |

---

## 🚀 Recovery Steps

### Step 1: Run Recovery Script (URGENT)

```bash
node recover-old-contracts.js
```

**What it does:**
1. Verifies you're the owner (`0x038d75aDb74d8e5Db82E6c6797f90dCdF82ef4C9`)
2. Scans all 4 contracts for balances
3. Shows recovery plan
4. **Waits for your confirmation** (type "RECOVER")
5. For each contract:
   - Withdraws all DNG to owner wallet
   - **V1 contracts:** Deactivates dungeon #1 (`setDungeon(1, 0, 0, false)`)
   - **V2 contract:** Pauses contract (`setPaused(true)`)
6. Verifies all balances are now 0

**Result:** All 320,339 DNG transferred to owner wallet, contracts disabled.

---

### Step 2: Fund Live Contract Correctly

```bash
node fund-game-contract.js
```

**Current treasury:** 5,000 DNG (≈2.3 days of max play)  
**Target treasury:** 25,000 DNG (≈12 days of max play)

**Why 25k, not more?**
- Live contract has NO gameplay validation
- Treasury balance = maximum possible loss to bots
- Keep bulk funds in owner wallet, top up on schedule

**Script needs update:** Change line 53-55 to top up to 25k target instead of flat 50k.

---

### Step 3: Fix Claim Lockout Bug

**The Problem:**
- Players complete 7 dungeons over multiple days
- Try to claim all 7 at once
- Contract rejects: "No runs left today"
- Runs stay in localStorage forever
- **No way to recover** (waiting for reset doesn't help)

**The Fix:**
3 parts, all in frontend:

1. **Add cache + budget helpers** to `dungeon-session.js`
   - Cache on-chain `runsRemaining` for each knight
   - Calculate available = cached - already queued
   - Method: `canDeploy(knightId)` returns if knight has budget

2. **Partial batch claiming**
   - Split pending runs into claimable vs deferred
   - Claim only what fits in daily budget TODAY
   - Keep deferred runs for next day
   - Never wipe localStorage on failure

3. **Gate dungeon entry**
   - Check available runs BEFORE allowing deployment
   - Warm cache when wallet connects
   - Prevent creating impossible-to-claim runs

---

### Step 4: Remove Broken Code

1. **Delete `claimRewards` from ABI** - permanently broken (reentrancy guard)
2. **Fix `getKnightStats`** - returns 2 values, not 3 (NaN bug)
3. **Fix `canDeploy` call** - method exists after Step 3

---

### Step 5: Clean Up Repository

**Delete dangerous contracts:**
- ❌ `DungeonKnightsGameV3.1-RewardsOnly.sol` (unbounded drain)
- ❌ `DungeonKnightsGame.sol` (V1 exploit)
- ❌ `DungeonKnightsGame-fixed.sol` (V1 exploit)
- ❌ `DungeonKnightsGame-final.sol` (V1 exploit)
- ✅ Keep: `DungeonKnightsGameV3-Simple.sol` (live)

**Delete 16 contradictory deploy guides**, replace with 1 accurate `CONTRACTS.md`

**Fix/delete hardcoded address scripts:**
- 6 scripts point to abandoned contracts
- Make them use `require('./contract-addresses')`

---

## 🎯 Priority Order

### RIGHT NOW (Funds at Risk):
1. ✅ **Run `recover-old-contracts.js`** - Secure 320k DNG
2. ✅ **Update & run `fund-game-contract.js`** - Top up to 25k DNG

### TODAY (Player-Facing Breakage):
3. ✅ **Fix claim lockout bug** - 3-part frontend fix
4. ✅ **Remove broken code paths** - ABI + NaN fixes

### THIS WEEK (Prevent Repeating):
5. ✅ **Clean up repository** - Delete dangerous files

### BEFORE MAINNET (Not Now):
6. ⏳ **Add Foundry + tests** - Catch bugs before deploy
7. ⏳ **Build V4 with EIP-712 signatures** - Bot protection

---

## 📊 Expected Results

**After Recovery:**
- ✅ Owner wallet: +320,339 DNG
- ✅ V1 contracts: 0 DNG, dungeons deactivated
- ✅ V2 contract: 0 DNG, paused
- ✅ Live contract: 25,000 DNG, fully functional

**After Claim Fix:**
- ✅ Players can claim old pending runs
- ✅ No more "No runs left today" errors
- ✅ Partial batch claims work (5 of 7, defer 2)
- ✅ Daily limits enforced at ENTRY, not CLAIM

**After Cleanup:**
- ✅ No exploitable contracts in repo
- ✅ No contradictory documentation
- ✅ All scripts use correct addresses

---

## 🔐 Security Notes

**What's Still NOT Protected:**
- ❌ Bot spam (no rate limiting beyond daily caps)
- ❌ Gameplay validation (frontend only)
- ❌ Signature verification (no backend)

**Why This is Acceptable for Testnet:**
- Only 34 knights exist (3 holders, 2 are yours)
- Max legitimate payout: 2,155 DNG/day
- Treasury capped at 25k = max 12 days loss
- Mainnet MUST have V4 with signatures

---

## 📞 Contact

**Owner EOA:** `0x038d75aDb74d8e5Db82E6c6797f90dCdF82ef4C9`  
**Network:** Robinhood Testnet (Chain ID 46630)  
**RPC:** https://rpc.testnet.chain.robinhood.com

---

**START HERE:** `node recover-old-contracts.js` 🚀
