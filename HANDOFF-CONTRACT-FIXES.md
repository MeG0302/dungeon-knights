# Dungeon Knights — Contract & Claim-Flow Remediation Handoff

**Written:** 2026-09-15
**Audience:** an AI coding agent with repo access and no prior context.
**Repo:** `D:\robin cursor\dungeon knights robinhood`

Read Section 0 and Section 1 before editing anything. Tasks are ordered by urgency.
Task 1 is time-sensitive (live funds at risk). Tasks 3–4 are the ones that fix real
player-facing breakage.

---

## 0. Verified ground truth

Everything here was verified on-chain on 2026-09-15 against
`https://rpc.testnet.chain.robinhood.com` (chainId 46630 / `0xb626`). Re-verify before acting
if significant time has passed — commands to do so are in Section 7.

### Live contracts

| Role | Address | Notes |
|---|---|---|
| **Game (LIVE)** | `0xD8de9385Db7DfE925882E76849B6e067e47236e5` | `DungeonKnightsGameV3-Simple.sol`. Not paused. Treasury **5,000 DNG**. |
| Knight NFT | `0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512` | Correct, matches live game's `knightNFT()`. |
| DNG token | `0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910` | Standard ERC-20, returns bool. Total supply 1,000,000. |
| Owner EOA | `0x038d75aDb74d8e5Db82E6c6797f90dCdF82ef4C9` | Owns **all five** game contracts. Holds 48,613 DNG. |

Live game on-chain config: `dailyCap = [5,5,4,3,4]`, `rarityReward = [10,17,30,75,150]` DNG,
rarity order `[Common, Uncommon, Rare, Epic, Legendary]`.

The live address is set in [`contract-addresses.js:7`](contract-addresses.js) and
[`config.js:40`](config.js). **These two are the only trustworthy address sources in the repo.**

### Abandoned contracts still holding DNG (Task 1 targets)

| Address | DNG held | Version | Exploitable |
|---|---|---|---|
| `0x45B905f66789bED9A1e9FF47f5429aF41A370E17` | **204,000** | V1 | Yes — also points at the *wrong* NFT (`0xe27106e6…`) |
| `0xb4cee9bA94660BDB19C3a933d71d94623c0B1ec5` | **99,785** | V1 | Yes |
| `0xbA216A5f7733B0B989eD751496386B759698797F` | **7,409** | V1 | Yes, and `MIN_CLAIM_INTERVAL = 0` |
| `0xd6D40B6C0D22f43866F6FBab3cf0DddDba05cFd5` | **9,145** | V2 | No known exploit, just stranded |

**Total to recover: 320,339 DNG** (311,194 of it from exploitable contracts).

**The V1 exploit:** `completeDungeon(knightId, dungeonId, timeSpent, reward, timestamp, signature)`
takes `reward` as a **caller-supplied parameter** and validates it against a signature the caller
produces themselves — see [`contracts/DungeonKnightsGame-final.sol:154`](contracts/DungeonKnightsGame-final.sol):
`require(signer == msg.sender, "Invalid signature")`. None of the three has a `trustedSigner()`
(confirmed absent from deployed bytecode). Each has `dungeons(1) = {minCompletionTime: 30s,
maxRewardPerRun: 2250 DNG, active: true}`. `batchCompleteDungeons` never checks
`MIN_CLAIM_INTERVAL` at all, so ~45 entries × 2250 = **101,250 DNG in one transaction**.

Anyone holding a single knight can do this. There are currently 3 knight holders; one of them
(`0xd99aB677…`, 17 knights) is not a wallet you control.

### Knight population (drives treasury sizing)

34 knights exist (scanned tokenIds 1–400, stopped after 40 consecutive misses).
Rarity spread `[C,U,R,E,L] = [23, 9, 2, 0, 0]`. Held by 3 addresses.
**Maximum legitimate payout if every knight maxes its daily cap: 2,155 DNG/day.**

### Toolchain

- **Node scripts:** ethers **v6.17.0** (`node_modules/` present). `require('dotenv').config({ path: '.env.local' })`.
  Key is `process.env.PRIVATE_KEY` in `.env.local` (git-ignored, never committed — verified).
- **Browser:** ethers **v5.7.2** UMD (`ethers-5.7.2.umd.min.js`). **Different API — do not mix.**
  v5: `new ethers.providers.Web3Provider(...)`, `ethers.utils.formatEther`.
  v6: `new ethers.JsonRpcProvider(...)`, `ethers.formatEther`.
- **No hardhat, no foundry, no `@openzeppelin/contracts` installed.** Contracts cannot be
  compiled locally. All past deploys went through Remix.

---

## 1. Ground rules — do not violate these

1. **Do NOT deploy a new game contract.** The live one works for the path the game actually
   uses. A new address must be propagated through 5+ files; that churn is what created this mess.
2. **Do NOT deploy `contracts/DungeonKnightsGameV3.1-RewardsOnly.sol`.** It removes every daily
   cap. Repeating one `knightId` 15× per run × 50 runs pays `750 × rarityReward` in a single call
   — one legendary knight drains 112,500 DNG per transaction, repeatably. Two markdown files in
   this repo tell you to deploy it. They are wrong. Task 5 deletes them.
3. **Do NOT call `claimRewards()` on the live contract.** It reverts 100% of the time
   (see Task 4). Only `batchClaimRewards` works.
4. **Do NOT send the recovered 320k into the game contract.** The live contract has no gameplay
   validation, so its balance *is* the loss ceiling. See Task 2 for correct sizing.
5. **Never print or commit `PRIVATE_KEY`.** `.env.local` is git-ignored; keep it that way.
6. Any script that moves funds must **print a plan and require confirmation** before sending.

---

## 2. TASK 1 — Recover 320,339 DNG (urgent, do first)

**Create a new file `recover-old-contracts.js`** in the repo root. Model it on the existing
[`fund-game-contract.js`](fund-game-contract.js) (same dotenv path, same provider construction).

### Behaviour

1. Load `PRIVATE_KEY` from `.env.local`; abort if missing.
2. Connect to the RPC, build a `Wallet`.
3. **Assert `wallet.address` equals the owner EOA `0x038d75aD…`** — abort loudly otherwise.
   Every one of these calls is `onlyOwner`.
4. For each of the four contracts: read `owner()` and the DNG `balanceOf`, print a table.
5. **Print the full plan and wait for the operator to type `RECOVER` on stdin.** Abort on anything else.
6. For each contract with a non-zero balance: `withdrawTokens(balance)` (transfers to `msg.sender`
   = owner). Wait for each receipt, print the tx hash.
7. For the three **V1** contracts only, follow up with
   `setDungeon(1, 0, 0, false)` to deactivate the exploitable dungeon as a backstop.
   *(V1 has no `setPaused`. V2 `0xd6D40B6C` has `setPaused(bool)` — call `setPaused(true)` on that one instead.)*
8. Re-read all balances and print a final confirmation table.

### ABIs to use

```js
const V1_ABI = [
  'function owner() view returns (address)',
  'function withdrawTokens(uint256 amount) external',
  'function setDungeon(uint256 dungeonId, uint256 minTime, uint256 maxReward, bool active) external',
  'function dungeons(uint256) view returns (uint256 minCompletionTime, uint256 maxRewardPerRun, bool active)',
];

const V2_ABI = [
  'function owner() view returns (address)',
  'function withdrawTokens(uint256 amount) external',
  'function setPaused(bool) external',
];

const DNG_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];
```

### Targets

```js
const TARGETS = [
  { addr: '0x45B905f66789bED9A1e9FF47f5429aF41A370E17', kind: 'V1' },
  { addr: '0xb4cee9bA94660BDB19C3a933d71d94623c0B1ec5', kind: 'V1' },
  { addr: '0xbA216A5f7733B0B989eD751496386B759698797F', kind: 'V1' },
  { addr: '0xd6D40B6C0D22f43866F6FBab3cf0DddDba05cFd5', kind: 'V2' },
];
const DNG  = '0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910';
const RPC  = 'https://rpc.testnet.chain.robinhood.com';
const CHAIN_ID = 46630;
```

**Acceptance:** all four contracts report `balanceOf == 0`; owner EOA balance increased by
~320,339 DNG; `dungeons(1).active == false` on all three V1s.

---

## 3. TASK 2 — Fund the live contract correctly

Live treasury is 5,000 DNG ≈ 2.3 days at the theoretical max of 2,155 DNG/day.

**Fund it to 25,000 DNG** (~12 days of absolute-max play). Keep the rest in the owner EOA and
top up on a schedule. Rationale: the live contract has no gameplay validation, so anyone with a
knight can script `batchClaimRewards` up to the daily cap without playing — the treasury balance
is the only thing bounding that loss.

[`fund-game-contract.js`](fund-game-contract.js) already reads the correct address from
`contract-addresses.js`, so it is safe to use. **Two changes needed:**

- Line 53–55: it hardcodes a 50,000 DNG cap. Change the amount to top **up to** a 25,000 target,
  i.e. compute `target - currentTreasuryBalance` and fund only the difference (no-op if already at target).
- It does `approve` + `fundContract`. That works. A plain `dngToken.transfer(GAME, amount)` also
  works (the contract measures treasury via `balanceOf(address(this))`) and costs one tx instead
  of two — either is acceptable.

**Acceptance:** `treasuryBalance()` on `0xD8de9385…` returns 25000.0.

---

## 4. TASK 3 — Fix the permanent claim lockout (highest player impact)

### The bug

[`dungeon-session.js`](dungeon-session.js) queues completed runs in `this.pendingRuns`
(persisted to `localStorage` under `dungeonPendingRuns`) and **never checks the on-chain daily
cap** — not when starting a dungeon, not when claiming. `batchClaimRewards` is all-or-nothing, so
one over-cap run makes the entire batch revert. `pendingRuns` is cleared **only on success**
([`dungeon-session.js:290`](dungeon-session.js)), so the bad queue persists forever.

Measured against the live contract with knight #1 (Common, cap 5, 5 remaining):

```
5 runs  -> OK (174,462 gas)
6 runs  -> revert "No runs left today"
51 runs -> revert "Too many runs"
```

Waiting for the daily reset does **not** help: the cap resets to 5 while 6 runs are still queued.
The error string shown to players ([`dungeon-session.js:319`](dungeon-session.js)) tells them to
wait for 12:00 UTC, which can never resolve it.

There is currently **no daily-run gating anywhere in the live game**:
`characters.js:313 getAvailableKnights()` filters only on `isDeployed` / `state === 'resting'`,
and `characters.js:89 canDeploy()` is dead code that nothing calls — and would throw
`TypeError: window.dungeonSession.canDeploy is not a function` if it were called, because that
method only exists in the orphaned `dungeon-session-OLD.js`.

### The fix — three parts, no contract change required

Key formula: **a knight's true available runs = `runsRemaining(chain)` − (runs already queued for
that knight in `pendingRuns`)**. Queued runs haven't been submitted yet but will consume the same
daily budget when they are.

A run is **atomic** on-chain (the contract iterates every `knightId` in it), so a run is claimable
only if *every* knight in it has budget. Runs that don't fit are **deferred to a later day, never
dropped** — no rewards are lost.

#### 4a. Add cache + budget helpers to `DungeonSessionManager`

In [`dungeon-session.js`](dungeon-session.js), add near the top of the file:

```js
const MAX_BATCH_RUNS = 50;       // contract MAX_BATCH
const MAX_KNIGHTS_PER_RUN = 15;  // contract per-run limit
```

In the constructor (after `this.pendingRuns = []`), add:

```js
this.runsCache = new Map(); // String(knightId) -> Number(runsRemaining on chain)
```

Add these methods to the class:

```js
/** How many runs are already queued (unclaimed) for this knight. */
pendingCountFor(knightId) {
    const key = String(knightId);
    return this.pendingRuns.reduce(
        (n, run) => n + run.knightIds.filter(id => String(id) === key).length,
        0
    );
}

/** Refresh on-chain runsRemaining for the given knights into the cache. */
async refreshRunsRemaining(knightIds) {
    if (!window.walletManager || !window.walletManager.isConnected) return;
    try {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const gameContract = new ethers.Contract(
            this.gameContractAddress, this.gameContractABI, provider
        );
        const unique = [...new Set(knightIds.map(String))];
        await Promise.all(unique.map(async id => {
            try {
                this.runsCache.set(id, Number(await gameContract.runsRemaining(id)));
            } catch (e) {
                // burned / nonexistent token: getKnightInfo reverts -> treat as no runs
                this.runsCache.set(id, 0);
            }
        }));
    } catch (e) {
        console.warn('⚠️ runsRemaining refresh failed:', e.message);
    }
}

/** Synchronous. On-chain allowance minus what is already queued. null = unknown. */
availableRuns(knightId) {
    const chain = this.runsCache.get(String(knightId));
    if (chain === undefined) return null;
    return Math.max(0, chain - this.pendingCountFor(knightId));
}

/** Accepts a stray second arg so the existing characters.js call site keeps working. */
canDeploy(knightId) {
    const a = this.availableRuns(knightId);
    return a === null ? true : a > 0;   // fail open when cache is cold
}

/** Split pendingRuns into what is claimable right now and what must wait. */
buildClaimBatch() {
    const budget = new Map();
    for (const run of this.pendingRuns) {
        for (const id of run.knightIds) {
            const key = String(id);
            if (!budget.has(key)) budget.set(key, this.runsCache.get(key) ?? 0);
        }
    }

    const claimable = [], deferred = [];
    for (const run of this.pendingRuns) {
        const ids = run.knightIds.map(String);
        if (run.knightIds.length > MAX_KNIGHTS_PER_RUN) {
            console.warn('⚠️ Run exceeds 15 knights and can never be claimed:', run);
            deferred.push(run);
            continue;
        }
        const fits = claimable.length < MAX_BATCH_RUNS && ids.every(id => budget.get(id) > 0);
        if (fits) {
            ids.forEach(id => budget.set(id, budget.get(id) - 1));
            claimable.push(run);
        } else {
            deferred.push(run);
        }
    }
    return { claimable, deferred };
}
```

#### 4b. Rewrite `claimAllRewards()` to claim partially

In [`dungeon-session.js:214`](dungeon-session.js), inside the `try` block **before** building
`runs`:

```js
// Reconcile against on-chain daily caps before submitting.
await this.refreshRunsRemaining(this.pendingRuns.flatMap(r => r.knightIds));
const { claimable, deferred } = this.buildClaimBatch();

if (claimable.length === 0) {
    const msg = `All knights are out of runs for today. ${deferred.length} run(s) saved — ` +
                `claim them after the 12:00 UTC reset.`;
    if (window.transactionModal) window.transactionModal.showError(msg); else alert(msg);
    return false;
}
```

Then change the `runs` construction at [`dungeon-session.js:256`](dungeon-session.js) from
`this.pendingRuns.map(...)` to `claimable.map(...)`:

```js
const runs = claimable.map(run => [run.knightIds, run.dungeonId]);
```

And **critically**, change the success handler at [`dungeon-session.js:290`](dungeon-session.js)
from `this.pendingRuns = [];` to:

```js
this.pendingRuns = deferred;   // keep what could not fit today — do NOT wipe
this.saveToLocalStorage();
if (deferred.length > 0) {
    console.log(`ℹ️ ${deferred.length} run(s) deferred to the next daily reset.`);
}
```

Also refresh the cache after a successful claim so the UI updates:
`await this.refreshRunsRemaining(claimable.flatMap(r => r.knightIds));`

#### 4c. Gate dungeon entry so the queue can never go over cap

This is the root-cause fix — it stops bad runs from ever entering the queue.

- **[`characters.js:79-84`](characters.js)** — `getRemainingRuns()` currently returns
  `window.dungeonSession.getRemainingRuns(...)`, which is **async** and therefore returns a
  `Promise`. Its three consumers use it synchronously, so `menu.js:195` compares a Promise to a
  number (always falsy) and `ui.js:323` / `menu.js:437` render `[object Promise]`.
  Replace the body with the synchronous cache lookup:

  ```js
  getRemainingRuns() {
      if (window.dungeonSession) {
          const a = window.dungeonSession.availableRuns(this.tokenId);
          if (a !== null) return a;
      }
      return RARITY[this.rarity.tier]?.dailyRuns ?? 5;
  }
  ```

- **[`characters.js:313`](characters.js)** — `getAvailableKnights()` must also exclude knights with
  no runs left:

  ```js
  getAvailableKnights() {
      return this.knights.filter(k =>
          !k.isDeployed && k.state !== 'resting' &&
          (!window.dungeonSession || window.dungeonSession.canDeploy(k.tokenId))
      );
  }
  ```

- **[`game.js:181` `beginRun(knights)`](game.js)** — before calling `startDungeon`, drop any knight
  without budget, and abort if none remain:

  ```js
  const eligible = knights.filter(k =>
      !window.dungeonSession || window.dungeonSession.canDeploy(k.tokenId || k.id)
  );
  if (eligible.length === 0) {
      this.logMessage('⚠️ These knights have no runs left today. Daily reset is 12:00 UTC.');
      return false;
  }
  ```
  then use `eligible` instead of `knights` for `knightIds`.

- **Warm the cache.** Call `await window.dungeonSession.refreshRunsRemaining(<all owned knight ids>)`
  after the wallet connects and whenever the knight roster renders — in `menu.js` where the roster
  is built (near line 195 / 437) and in `claim-history.js` (near line 58, before
  `updateDisplay`). Without this the cache is cold and `canDeploy` fails open.

**Acceptance:**
- A knight at 0 remaining cannot be deployed; the UI shows a number, never `[object Promise]`.
- With 6 queued runs for a cap-5 Common knight: claiming succeeds for 5 and leaves exactly 1
  in `pendingRuns`; the next day that 1 claims successfully.
- With 60 queued runs: claim submits 50, leaves 10.
- `pendingRuns` is never silently emptied on a revert.

---

## 5. TASK 4 — Remove dead and broken code paths

1. **`claimRewards` is permanently broken — remove it from the ABI.**
   Verified on-chain: `claimRewards([1], 1)` reverts with `0x3ee5aeb5` =
   `ReentrancyGuardReentrantCall()`. Both it and `batchClaimRewards` are `nonReentrant`, and
   `claimRewards` calls `this.batchClaimRewards(runs)` as an **external** call
   ([`contracts/DungeonKnightsGameV3-Simple.sol:186`](contracts/DungeonKnightsGameV3-Simple.sol)),
   which trips the guard. Even without the guard, `msg.sender` inside would be the contract, so
   `ownerOf() == msg.sender` would fail.
   → Delete line 30 of [`dungeon-session.js`](dungeon-session.js)
   (`'function claimRewards(uint256[] calldata knightIds, uint256 dungeonId) external'`).
   Nothing calls it today; removing it prevents someone from trying.

2. **`getKnightStats` destructures 3 values from a 2-value return.**
   [`dungeon-session.js:383`](dungeon-session.js) reads `[totalClaimed, remaining, lastRunTime]`,
   but both the ABI (line 32) and the V3-Simple contract return only 2 values. `lastRunTime` is
   `undefined` → `Number(undefined)` → `NaN`. This is a V2 leftover (V2 did return 3).
   → Drop `lastRunTime` from the destructure and from the returned object.

3. **`canDeploy` in `characters.js:89`** currently calls a method that does not exist on the live
   session manager. Task 3 adds `canDeploy(knightId)` to `DungeonSessionManager`, which resolves
   this. Verify the call site works after the change (the stray second argument is harmless).

---

## 6. TASK 5 — Repo hygiene (prevents repeating this)

1. **Delete the dangerous contract sources** so they cannot be deployed by mistake:
   - `contracts/DungeonKnightsGameV3.1-RewardsOnly.sol` (unbounded drain — see Ground Rule 2)
   - `contracts/DungeonKnightsGame.sol`, `contracts/DungeonKnightsGame-fixed.sol`,
     `contracts/DungeonKnightsGame-final.sol` (all three carry the self-signed-reward exploit)
   - Keep `DungeonKnightsGameV3-Simple.sol` (live) and `DungeonKnightsGameV3.sol` (the signature
     design, reference for a future V4).

2. **Delete the misleading deploy guides.** All 16 exist and contradict each other; two of them
   (`DEPLOY-V3.1-NOW.md`, `V3.1-READY-TO-DEPLOY.md`) actively instruct deploying the drainable
   V3.1:
   `AUTOMATED_DEPLOY_GUIDE.md`, `CONTRACT_FIX_SUMMARY.md`, `DEPLOY-V3-NOW.md`,
   `DEPLOY-V3.1-NOW.md`, `DEPLOYMENT_GUIDE.md`, `DEPLOYMENT_TODO.md`, `DEPLOY_NOW.md`,
   `QUICK_DEPLOY.md`, `REDEPLOY-INSTRUCTIONS.md`, `REMIX_DEPLOYMENT_GUIDE.md`,
   `V3-DEPLOYMENT-COMPLETE.md`, `V3-DEPLOYMENT-GUIDE.md`, `V3-FIX-APPLIED.md`,
   `V3-SIMPLE-DEPLOYMENT.md`, `V3-vs-V3.1-COMPARISON.md`, `V3.1-READY-TO-DEPLOY.md`.
   Replace with **one** `CONTRACTS.md` describing only the live deployment.

3. **Fix or delete scripts that hardcode dead addresses.** These six target abandoned contracts
   and will silently operate on the wrong thing — one of them (`fix-nft-address.js`) targets a
   contract whose NFT address cannot be changed at all (no setter exists in V1):
   `update-max-reward.js:4`, `update-dungeon-config.js:7`, `fix-nft-address.js:6`,
   `check-both-contracts.js:5-6`, `check-other-contract.js:5`, `test-claim-simulation.js:6`.
   → Either delete them, or make every one of them `require('./contract-addresses')` the way
   [`fund-game-contract.js:3`](fund-game-contract.js) and `check-contract-balance.js` already do.
   Also `redeploy-game-contract.js:9-10` references a **different NFT and a different DNG token**
   (`0xE27106e6…` / `0xc2e6c9a4…`) — delete it.

4. **Fix `deployed-contracts.json`.** Line 2 claims the game contract is `0xb4cee9bA…`, which is a
   drained V1. Update it to the live address or delete the file.

5. **Delete orphaned duplicates** so future edits land on live files (verified present):
   `dungeon-session-OLD.js`, `deploy-game-browser.html`, `deploy-contract-simple.html`,
   `test-daily-runs.html`, `test-timing.html`.
   Live page flow is: `landing.html` → `menu.html` → `dungeon-select.html` → `index.html`.

---

## 7. TASK 6 — Before mainnet only (do NOT build now)

Bot protection is **not** worth building for testnet: 34 knights, 3 holders, 2 of them yours.
Defer deliberately — but it is **mandatory before mainnet**, where scripted claiming extracts
real value.

### 7a. Add a build + test setup first

This is the highest-leverage item. `claimRewards` reached a live contract 100% broken, and the
repo cannot compile as a unit — `V3.1` needs OpenZeppelin **v4** (`security/ReentrancyGuard.sol`,
no-arg `Ownable`) while V2/V3/V3-Simple need **v5** (`utils/ReentrancyGuard.sol`,
`Ownable(msg.sender)`). One `forge build` plus one test per entrypoint catches both classes of bug.

Add Foundry, pin OpenZeppelin v5, and write at minimum: a happy-path batch claim, an over-cap
revert, a `MAX_BATCH` revert, and a test that **calls every public entrypoint at least once**
(that alone would have caught `claimRewards`).

### 7b. V4 contract requirements

Start from [`contracts/DungeonKnightsGameV3.sol`](contracts/DungeonKnightsGameV3.sol) (the
signature design) and fix these before deploying:

- **EIP-712 typed data with a domain separator including `chainId` and the verifying contract.**
  The current hash at [`DungeonKnightsGameV3.sol:155`](contracts/DungeonKnightsGameV3.sol) uses
  `abi.encodePacked` with no domain binding, so a signature is replayable against any other
  deployment sharing the signer.
- **Keep the on-chain daily caps.** They are the defence-in-depth if the signer key leaks.
- **Replace `completedAt >= block.timestamp - 1 hours`** with a per-signature expiry. The 1-hour
  window contradicts the play-now-claim-later batching the contract exists to enable.
- **Delete the `claimRewards` self-call wrapper.** Never have a `nonReentrant` function call
  another `nonReentrant` function on itself.
- `immutable` for `knightNFT` / `dngToken` (a wrong constructor arg is how `0x45B905f6…` ended up
  on the wrong NFT, with no setter to fix it), `SafeERC20`, and `Ownable2Step`.
- Consider moving ownership off a single EOA — one key currently controls every treasury.

### 7c. The signer service

A Vercel serverless function (the site already deploys to Vercel, so no new infra): issue a
server-side nonce when a dungeon starts, validate elapsed time and the run summary on completion,
sign the EIP-712 payload with a key held in a Vercel env var. Contract verifies against
`trustedSigner`. This is not cheat-proof — a determined attacker can drive the real client — but
it stops trivial scripted claiming.

---

## 8. Re-verification commands

Run from the repo root (ethers v6 is installed there; a script placed outside the repo will fail
to resolve `ethers`).

```bash
node -e "
const {ethers}=require('ethers');
const p=new ethers.JsonRpcProvider('https://rpc.testnet.chain.robinhood.com',46630);
const DNG='0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910';
const d=new ethers.Contract(DNG,['function balanceOf(address) view returns (uint256)'],p);
const t={'LIVE V3':'0xD8de9385Db7DfE925882E76849B6e067e47236e5',
 'V1 204k':'0x45B905f66789bED9A1e9FF47f5429aF41A370E17',
 'V1 99k':'0xb4cee9bA94660BDB19C3a933d71d94623c0B1ec5',
 'V1 7k':'0xbA216A5f7733B0B989eD751496386B759698797F',
 'V2 9k':'0xd6D40B6C0D22f43866F6FBab3cf0DddDba05cFd5',
 'owner':'0x038d75aDb74d8e5Db82E6c6797f90dCdF82ef4C9'};
(async()=>{for(const [k,a] of Object.entries(t))
 console.log(k.padEnd(9), ethers.formatEther(await d.balanceOf(a)),'DNG');})();
"
```

Simulate a claim without sending a transaction (replace owner/tokenId as needed):

```bash
node -e "
const {ethers}=require('ethers');
const p=new ethers.JsonRpcProvider('https://rpc.testnet.chain.robinhood.com',46630);
const g=new ethers.Contract('0xD8de9385Db7DfE925882E76849B6e067e47236e5',
 ['function batchClaimRewards((uint256[],uint256)[] runs)',
  'function runsRemaining(uint256) view returns (uint8)',
  'function treasuryBalance() view returns (uint256)'],p);
(async()=>{
 console.log('treasury',ethers.formatEther(await g.treasuryBalance()));
 console.log('remaining #1',(await g.runsRemaining(1)).toString());
 try{ await g.batchClaimRewards.staticCall([[[1],1]],
   {from:'0xd99aB6773E06A440D9927905a5C4070C4064D3aC'}); console.log('claim OK'); }
 catch(e){ console.log('claim REVERT:', e.reason||e.shortMessage); }
})();
"
```

---

## 9. Summary checklist

- [ ] **T1** Recover 320,339 DNG from 4 abandoned contracts; deactivate the 3 V1s. *(urgent)*
- [ ] **T2** Top live treasury up to 25,000 DNG; keep the remainder in the owner wallet.
- [ ] **T3** Fix the claim lockout: cache + budget helpers, partial claim, entry gating.
- [ ] **T4** Remove `claimRewards` from the ABI; fix the `getKnightStats` NaN.
- [ ] **T5** Delete the 4 exploitable/dangerous `.sol` files, the misleading deploy guides, the
      hardcoded-address scripts, and the orphaned page duplicates.
- [ ] **T6** *(pre-mainnet only)* Foundry + tests, then V4 with EIP-712 and a Vercel signer.

**If you only do one thing today: Task 1.**
