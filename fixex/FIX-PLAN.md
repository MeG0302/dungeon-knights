# Dungeon Knights — Remediation Spec

Handoff document. Each task is self-contained: file paths, exact changes, and how to verify.
Do them in the order given — Task 1 and 2 must ship together, everything after is independent.

**Repo:** `D:\robin cursor\dungeon knights robinhood`
**Chain:** Robinhood Chain Testnet, chainId 46630 (`0xb626`)
**Stack:** vanilla JS, no build step, no framework. ethers v5 UMD in the browser (`ethers-5.7.2.umd.min.js`), ethers v6 in Node ops scripts. Do not introduce a bundler.

**Live page flow** (only these files matter for gameplay):
`landing.html` → `menu.html` (`menu.js`) → `dungeon-select.html` → `index.html` (`game.js`, `ui.js`, `dungeon-session.js`)

Files named `*-new.*`, `*-old-backup.*`, `ui-new.js`, `index-new.html`, `menu-new.*` are **orphans — not referenced by anything**. Do not edit them. Do not "keep them in sync."

---

## Task 0 — Decide the daily-run economy (do this before Task 1)

**This is a decision for the project owner, not a code change.** It is Task 0 because the numbers get compiled into Task 1's constructor, and changing them after players hold NFTs reads as a nerf.

### Why this matters more than it used to

Before this rewrite, `dailyCap` was **decorative**. Run counts lived in `localStorage` under `knight_daily_runs`, and the old contract never checked them — the only ceiling was `maxRewardPerRun = 2250`. A player could clear their own storage and keep claiming.

Under the on-chain model (Task 1), `dailyCap` is **the only thing bounding token supply.** It stopped being a game-balance knob and became monetary policy. Emission scales linearly with every NFT minted; the treasury does not.

### The decision (settled — 2026-09-14)

Two calls, made by the project owner:

1. **Cut Mythic.** The game ships **five** tiers, not six.
2. **Adopt the advertised odds** — `65 / 20 / 10 / 4.5 / 1.2` — as the real drop rates, so the code matches what the mint page already promises.

Rationale for (2): the advertised table is better-balanced than what the game has been rolling, it is **already public** on [mint.html:340-350](mint.html:340), and it is **more conservative** — it flattens Common from 50%→65% and thins the middle tiers, which makes Legendary feel genuinely rare rather than 1-in-100. Correcting the code to match the marketing is both the smaller change and the safer one.

### What was actually wrong

The advertised distribution and the rolled distribution **never matched**:

| Tier | Advertised ([mint.html](mint.html)) | Actually rolled ([characters.js](characters.js)) |
|---|---|---|
| Common | 65% | 50% |
| Uncommon | 20% | 30% |
| Rare | 10% | 15% |
| Epic | 4.5% | 4% |
| Legendary | 1.2% | 1% |
| Mythic | 0.3% | **could not be rolled at all** |

`dropRate` is live code, not decoration: `rollRarity()` ([characters.js:96-108](characters.js:96)) walks the `RARITY` object accumulating `dropRate` and **falls through to Common** (`:107`) for anything past the last entry. So Mythic was advertised at 0.3% and was never reachable, and the other five were off by 5-15 percentage points.

**The advertised percentages sum to 101%, not 100%** (the five-tier version sums to 100.7%). A cumulative walk whose total exceeds 1.0 silently under-serves the final tier, so normalise when writing the values:

```js
// characters.js — normalise so the cumulative walk lands where advertised.
const RAW   = { COMMON: 0.65, UNCOMMON: 0.20, RARE: 0.10, EPIC: 0.045, LEGENDARY: 0.012 };
const TOTAL = Object.values(RAW).reduce((a, b) => a + b, 0); // 1.007
// store dropRate: RAW[tier] / TOTAL
```

Or hand-round to `0.65 / 0.199 / 0.099 / 0.045 / 0.006` (sums to 0.999) and skip the normalisation. Either works; a table that sums over 1.0 does not.

### Economies at a glance

Mint cost is a flat **500 $DNG** for every knight regardless of roll ([mint.html:324](mint.html:324), [mint.html:336](mint.html:336)). All rows assume that.

| Odds used | Caps | EV per mint | Avg payback | Emission @1,000 knights |
|---|---|---|---|---|
| rolled (50/30/15/4/1) | current | 83.5 DNG/day | 6.0 days | ~2.5M DNG/month |
| rolled (50/30/15/4/1) | Option B | 67.9 DNG/day | 7.4 days | ~2.0M DNG/month |
| **advertised (decided)** | **current** | **78.3 DNG/day** | **6.4 days** | **~2.3M DNG/month** |
| **advertised (decided)** | **Option B** | **65.0 DNG/day** | **7.7 days** | **~2.0M DNG/month** |

Figures are normalised. **The odds change alone is a ~6% cut in emission; pairing it with Option B caps takes it to ~22%.**

### With the decided odds, per tier (Option A caps)

| Tier | Odds | Reward/run | Runs/day | DNG/day | Days to repay 500 |
|---|---|---|---|---|---|
| Common | 65% | 10 | 5 | 50 | 10.0 |
| Uncommon | 20% | 17 | 5 | 85 | 5.9 |
| Rare | 10% | 30 | 4 | 120 | 4.2 |
| Epic | 4.5% | 75 | 3 | 225 | 2.2 |
| Legendary | 1.2% | 150 | 4 | 600 | 0.83 |

### Mythic removal — every site

Eight references. All must go, or the filter, sort, and audio layers keep pointing at a tier that can never exist.

| File | Line | What to do |
|---|---|---|
| [mint.html:349](mint.html:349) | `<li>…Mythic: 0.3%</li>` | delete the whole `<li>` |
| [mint.css:516](mint.css:516) | `.rarity-dot.mythic` | delete the rule |
| [menu.js:30](menu.js:30) | `imageMap` entry | delete the `'MYTHIC': …` line |
| [menu.js:337](menu.js:337) | `rarityOrder` array | drop `'MYTHIC'` |
| [menu.html:81](menu.html:81) | filter `<option>` | delete the `<option value="MYTHIC">` line |
| [game.js:472](game.js:472) | `['EPIC','LEGENDARY','MYTHIC']` | drop `'MYTHIC'` |
| [dungeon.js:691](dungeon.js:691) | `imageMap` entry | delete the `'MYTHIC': …` line |
| [menu.css:582](menu.css:582) | `.rarity-MYTHIC` + `.knight-avatar.rarity-MYTHIC` | delete both rules |

After removal, `characters/Pixel_knight_holding_cosmic_shield_2K_202609041402_jpeg_2K_202609041417.png` has no remaining references. Leaving the asset on disk is fine.

**Do not edit `menu-old-backup.*`** — orphan files, see the note at the top.

### Three deeper problems (unchanged by the decision)

**1. The run curve is not monotonic: 5, 5, 4, 3, 4.** Legendary gets *more* runs than Epic. This looks like a typo but is not — [characters.js:43](characters.js:43) reads `dailyRuns: 4 // 4 runs/day = 600 DNG/day = 0.8 day ROI`, so the consequence was calculated deliberately. Epic holders earn 225/day; Legendary holders earn 2.7× that off a 1.2% roll at the *same* 500 mint price.

**2. Legendary repays its mint in under a day.** 600/day against a 500 cost. After ~20 hours it is a pure money printer with no off switch.

**3. Run caps alone cannot equalise ROI.** With a flat mint price, a knight earning 15× as much always repays 15× faster unless its cap drops 15× too (5 runs → 0.33 runs/day, which is not a thing). Anyone trying to "fix ROI spread" by tuning caps alone will fail. The real levers are: rarity-priced mints, a compressed reward spread, or accepting the spread and bounding supply instead.

### Still open: the run caps (Option A vs Option B)

The odds and Mythic questions are settled. **This one is not** — it is the remaining Task 0 decision, and it still gets compiled into Task 1.

**Option A — keep the current caps (jackpot model).** Legendary is a lottery win and is *supposed* to feel broken. Defensible, but then bound the damage elsewhere (a hard NFT supply cap) and size the treasury for it. **No code change — Task 1's constructor already contains these values.**

**Option B — monotonic caps (recommended).** Rewards unchanged; only caps change. Monotonic, and Legendary is still clearly the best NFT in the game.

| Tier | Runs/day | DNG/day | Days to repay | vs. current |
|---|---|---|---|---|
| Common | 5 | 50 | 10.0 | unchanged |
| Uncommon | **4** | 68 | 7.4 | −20% |
| Rare | **3** | 90 | 5.6 | −25% |
| Epic | **2** | 150 | 3.3 | −33% |
| Legendary | **2** | 300 | **1.7** | −50% |

With the decided odds, Option B gives expected value **65.0 DNG/day** (**7.7 day** average payback) — **~22% less emission** than the currently-rolled odds under current caps, at the same mint price and the same headline reward numbers. Legendary still earns 2× Epic and 6× Common per day.

**To adopt Option B, replace exactly these five lines in Task 1's constructor:**

```solidity
        dailyCap[0] = 5; // Common
        dailyCap[1] = 4; // Uncommon
        dailyCap[2] = 3; // Rare
        dailyCap[3] = 2; // Epic
        dailyCap[4] = 2; // Legendary
```

Then update Task 5's `characters.js` `dailyRuns` values to match (`5/4/3/2/2`), and re-check the Task 2 treasury math below.

**Either way, `setDailyCap` is `onlyOwner` and adjustable after deploy** — this is not a one-way door. But ship close to correct, because lowering a cap later is a visible takeaway from holders.

### Also fix: the 12:00 UTC reset is double-claimable

`currentDayIndex()` buckets by a hard boundary, so a player claims at 11:59 UTC and again at 12:01 — two full daily allowances inside ~2 minutes. The 30s `RUN_COOLDOWN` comfortably fits every run on both sides. A Legendary extracts **1,200 DNG in about four minutes** under Option A, 600 under Option B.

This does not change the long-run average, but the treasury must survive the burst, and it rewards players who set an alarm. **If you want it closed,** swap the day-bucket for a window that starts on first claim — in `KnightState` replace `uint32 dayIndex` with `uint64 windowStart`, and replace the rollover block in `completeDungeons` with:

```solidity
            // Window opens on first claim and runs 24h, so there is no
            // fixed boundary for a player to straddle.
            if (block.timestamp >= uint256(ks.windowStart) + 1 days) {
                ks.windowStart = uint64(block.timestamp);
                ks.runsUsed    = 0;
            }
```

`currentDayIndex()` and `RESET_HOUR_UTC` then become unused — delete them, and update `runsRemaining()` to use the same window check.

**Honest trade-off:** the window drifts. Claim at 11:00 today and your reset is 11:00 tomorrow; claim at 13:00 tomorrow and it moves to 13:00. Players lose a predictable reset time — which many idle games consider worse UX than the burst it prevents. Keeping the hard 12:00 UTC boundary is a legitimate choice; just size the treasury for 2× a single day's cap.

### Open question — where does the 500 DNG mint fee go?

**This determines whether ~6-day payback is sustainable at all, and I could not resolve it from the repo.** The NFT contract source is not in `contracts/` (only the game contract is), and `minting.js` has been deleted. Three possibilities:

- **Burned** → a real sink. Roughly self-balancing, defensible.
- **Sent to the game treasury** → each mint partly funds its own rewards. Workable, but only until payback.
- **Minted fresh / paid in another token** → faucet with no sink. Guaranteed inflation regardless of caps.

**Check the deployed NFT on the block explorer before funding anything.** If there is no sink, no cap table fixes this — you need a burn, a supply ceiling, or a different mint currency.

---

## Task 1 — Rewrite the game contract: on-chain rewards, no signatures

### The problem

`contracts/DungeonKnightsGame-final.sol:154` and `:239`:

```solidity
require(signer == msg.sender, "Invalid signature");
```

The player signs their own reward amount and the contract checks the player signed it. That check always passes. A holder of one Common knight can submit `reward = 2250 ether, timeSpent = 30` and the contract pays it. Verified: a fabricated claim recovers to the attacker's own address and satisfies the require.

Compounding:
- No nonce or used-signature mapping → one valid signature replays forever, and `batchCompleteDungeons` accepts the same completion N times in one call.
- `MIN_CLAIM_INTERVAL = 0` (`:47`) → no rate limit.
- `rarityRewards` is set in the constructor and **never read by the claim path** → reward is unbound by rarity; the only ceiling is `maxRewardPerRun = 2250` per completion.

`contracts/DungeonKnightsGame-fixed.sol` is **not** a fix — same `== msg.sender` check at `:136` and `:190`. Do not deploy it.

### The approach

Delete the signature mechanism entirely. The contract derives the reward itself from data it can independently verify: knight ownership (from the NFT contract) and knight rarity (from the NFT contract). Daily run caps are enforced on-chain, so the worst case for any attacker is claiming their own daily allowance without playing — bounded by the same economy an honest player gets.

**Accepted trade-off, state this to the user:** gameplay is no longer proof-of-work. Someone can call the contract directly and claim their daily allowance without clearing a dungeon. The caps bound the damage. If gameplay must be *required*, that needs a backend signer — see Appendix A for the delta.

The deployed NFT at `0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512` exposes (confirmed via the ABI in `wallet.js:349-353`):

```solidity
function getKnightInfo(uint256) view returns (address owner, uint8 rarity, string memory rarityName)
```

`rarity` is a `uint8` index: `0=common, 1=uncommon, 2=rare, 3=epic, 4=legendary` (confirmed by `wallet.js:377`).

### Write `contracts/DungeonKnightsGameV2.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IKnightNFT {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getKnightInfo(uint256 tokenId)
        external view returns (address owner, uint8 rarity, string memory rarityName);
}

/// @title DungeonKnightsGameV2
/// @notice Rewards are derived on-chain from NFT rarity. Nothing client-supplied is trusted.
contract DungeonKnightsGameV2 is Ownable, ReentrancyGuard {
    IKnightNFT public knightNFT;
    IERC20  public dngToken;

    uint8 public constant RARITY_COUNT     = 5;
    uint256 public constant MAX_BATCH      = 15;     // matches the 15-knight squad cap
    uint256 public constant RESET_HOUR_UTC = 12;     // daily reset at 12:00 UTC
    uint256 public constant RUN_COOLDOWN   = 30;     // seconds between runs for one knight

    /// @notice DNG paid per completed run, indexed by rarity. 18 decimals.
    uint256[RARITY_COUNT] public rarityReward;

    /// @notice Max runs per knight per UTC day, indexed by rarity.
    uint8[RARITY_COUNT] public dailyCap;

    struct KnightState {
        uint32  dayIndex;      // which reset-day runsUsed refers to
        uint8   runsUsed;      // runs consumed during dayIndex
        uint64  lastRunTime;   // unix seconds, for RUN_COOLDOWN
        uint256 totalClaimed;  // lifetime DNG, 18 decimals
    }
    mapping(uint256 => KnightState) public knightState;

    bool public paused;

    event DungeonCompleted(
        address indexed player,
        uint256 indexed knightId,
        uint256 indexed dungeonId,
        uint8   rarity,
        uint256 reward,
        uint256 timestamp
    );
    event RewardsClaimed(address indexed player, uint256 amount, uint256 knightCount);
    event RarityRewardUpdated(uint8 rarity, uint256 reward);
    event DailyCapUpdated(uint8 rarity, uint8 cap);
    event PausedSet(bool paused);

    constructor(address _knightNFT, address _dngToken) Ownable(msg.sender) {
        require(_knightNFT != address(0) && _dngToken != address(0), "Zero address");
        knightNFT = IKnightNFT(_knightNFT);
        dngToken  = IERC20(_dngToken);

        // Must match characters.js RARITY and dungeon-session.js rarityRewards.
        rarityReward[0] =  10 ether; // Common
        rarityReward[1] =  17 ether; // Uncommon
        rarityReward[2] =  30 ether; // Rare
        rarityReward[3] =  75 ether; // Epic
        rarityReward[4] = 150 ether; // Legendary

        dailyCap[0] = 5; // Common
        dailyCap[1] = 5; // Uncommon
        dailyCap[2] = 4; // Rare
        dailyCap[3] = 3; // Epic
        dailyCap[4] = 4; // Legendary
        // ^ These are the CURRENT live values (Task 0, Option A). If the owner
        //   chose Option B, replace with 5/4/3/2/2 and update characters.js to match.
    }

    /// @notice Reset-day index. Day rolls over at 12:00 UTC, matching the client.
    function currentDayIndex() public view returns (uint32) {
        return uint32((block.timestamp - (RESET_HOUR_UTC * 1 hours)) / 1 days);
    }

    function runsRemaining(uint256 knightId) public view returns (uint8) {
        (, uint8 rarity, ) = knightNFT.getKnightInfo(knightId);
        require(rarity < RARITY_COUNT, "Bad rarity");
        KnightState storage ks = knightState[knightId];
        if (ks.dayIndex != currentDayIndex()) return dailyCap[rarity];
        if (ks.runsUsed >= dailyCap[rarity]) return 0;
        return dailyCap[rarity] - ks.runsUsed;
    }

    /// @notice Claim one run for each listed knight. Reward is computed on-chain.
    /// @param knightIds Knights that completed the run. Must be owned by msg.sender, no duplicates.
    /// @param dungeonId Which dungeon, for analytics only. Does not affect payout.
    function completeDungeons(uint256[] calldata knightIds, uint256 dungeonId)
        external
        nonReentrant
    {
        require(!paused, "Paused");
        require(knightIds.length > 0, "No knights");
        require(knightIds.length <= MAX_BATCH, "Too many knights");

        uint32  today       = currentDayIndex();
        uint256 totalReward = 0;

        for (uint256 i = 0; i < knightIds.length; i++) {
            uint256 knightId = knightIds[i];

            require(knightNFT.ownerOf(knightId) == msg.sender, "Not your knight");

            (, uint8 rarity, ) = knightNFT.getKnightInfo(knightId);
            require(rarity < RARITY_COUNT, "Bad rarity");

            KnightState storage ks = knightState[knightId];

            // Roll the day over lazily.
            if (ks.dayIndex != today) {
                ks.dayIndex = today;
                ks.runsUsed = 0;
            }

            require(ks.runsUsed < dailyCap[rarity], "No runs left today");
            // Also rejects a duplicate knightId inside one call: the first
            // iteration writes lastRunTime = block.timestamp, so the second fails.
            require(
                block.timestamp >= uint256(ks.lastRunTime) + RUN_COOLDOWN,
                "Run cooldown"
            );

            uint256 reward = rarityReward[rarity];

            ks.runsUsed    += 1;
            ks.lastRunTime  = uint64(block.timestamp);
            ks.totalClaimed += reward;

            totalReward += reward;

            emit DungeonCompleted(
                msg.sender, knightId, dungeonId, rarity, reward, block.timestamp
            );
        }

        require(
            dngToken.balanceOf(address(this)) >= totalReward,
            "Treasury empty"
        );
        require(dngToken.transfer(msg.sender, totalReward), "Transfer failed");

        emit RewardsClaimed(msg.sender, totalReward, knightIds.length);
    }

    // ---- views used by the client ----

    function getKnightStats(uint256 knightId)
        external view returns (uint256 totalClaimed, uint8 remaining, uint64 lastRunTime)
    {
        KnightState storage ks = knightState[knightId];
        return (ks.totalClaimed, runsRemaining(knightId), ks.lastRunTime);
    }

    function treasuryBalance() external view returns (uint256) {
        return dngToken.balanceOf(address(this));
    }

    // ---- admin ----

    function setRarityReward(uint8 rarity, uint256 reward) external onlyOwner {
        require(rarity < RARITY_COUNT, "Bad rarity");
        rarityReward[rarity] = reward;
        emit RarityRewardUpdated(rarity, reward);
    }

    function setDailyCap(uint8 rarity, uint8 cap) external onlyOwner {
        require(rarity < RARITY_COUNT, "Bad rarity");
        dailyCap[rarity] = cap;
        emit DailyCapUpdated(rarity, cap);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedSet(_paused);
    }

    function fundContract(uint256 amount) external onlyOwner {
        require(dngToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
    }

    function withdrawTokens(uint256 amount) external onlyOwner {
        require(dngToken.transfer(msg.sender, amount), "Transfer failed");
    }
}
```

### Notes for whoever implements this

- **No signature anywhere.** Delete `signCompletion()` from the client (Task 3). This also removes the MetaMask popup on every dungeon clear, which was bad UX.
- **`startSession` / `activeSessions` are gone.** The old contract had them; nothing ever called `startSession`. Don't port them.
- **Duplicate knight IDs in one call** are rejected by `RUN_COOLDOWN`, since the first iteration sets `lastRunTime`. This is why `RUN_COOLDOWN` must stay `> 0`. `runsUsed` is a second, independent bound.
- **`dungeonId` is analytics only.** It no longer gates payout, so the `dungeonNameToId` maps (which collapsed every dungeon to `1` anyway) can go. Keep emitting it so the leaderboard can break down by dungeon later.
- **OpenZeppelin v5** — the existing contract uses `Ownable(msg.sender)` and `MessageHashUtils`, so it is v5. In v5 `ReentrancyGuard` lives at `utils/ReentrancyGuard.sol`, **not** `security/`.
- **`timeSpent` is not a parameter anymore.** It was client-supplied and unverifiable. `RUN_COOLDOWN` is the real floor.

### Verify before deploying

Write throwaway tests (Hardhat/Foundry, or a scratch script against testnet) proving:

1. A Common knight claiming once receives exactly 10 DNG.
2. The same knight claiming a 6th time in one UTC day reverts `"No runs left today"`.
3. Passing the same `knightId` twice in one `completeDungeons` call reverts `"Run cooldown"`.
4. Calling with a `knightId` you do not own reverts `"Not your knight"`.
5. After 12:00 UTC rolls over, `runsRemaining` returns the full cap again.
6. With the treasury drained, the call reverts `"Treasury empty"` and not a bare `"Transfer failed"`.
7. **The old exploit is dead:** there is no code path that accepts a caller-supplied reward amount.

---

## Task 2 — Fix the contract address split, then deploy and fund

### The problem

Three different game-contract addresses are live in the repo at once:

| Address | Referenced by |
|---|---|
| `0xbA216A5f7733B0B989eD751496386B759698797F` | **the running game** — `dungeon-session.js:8`, `leaderboard.js:159`, `game.js:259` |
| `0xb4cee9bA94660BDB19C3a933d71d94623c0B1ec5` | `deployed-contracts.json`, `CONTRACT_FIX_SUMMARY.md` |
| `0x45B905f66789bED9A1e9FF47f5429aF41A370E17` | **every ops script** — `fund-game-contract.js`, `update-max-reward.js`, `update-dungeon-config.js`, `check-contract-balance.js`, `fix-nft-address.js` |

So `fund-game-contract.js` funds a contract nobody claims from. `CONTRACT_FIX_SUMMARY.md:14-18` documents `0x45B905f6…` as pointing at the wrong NFT *and* wrong DNG token, yet every script still targets it. `fund-game-contract.js:8` also uses DNG `0xc2e6c9a4…` instead of the `0xA8D54F6F…` the game uses. This is the likely cause of any "Transfer failed" revert on claim: the live contract has no DNG balance.

### The fix — one source of truth

**Step 1.** In `config.js`, inside the `CONFIG` object, add a `GAME_CONTRACTS` block next to the existing `NFT_CONTRACTS`:

```js
  GAME_CONTRACTS: {
    testnet: '0xPASTE_V2_ADDRESS_AFTER_DEPLOY',
    mainnet: '0xYOUR_MAINNET_GAME_CONTRACT'
  },
```

And a helper alongside the other `CONFIG.get*` functions near the bottom:

```js
CONFIG.getGameContract = function() {
  return this.GAME_CONTRACTS[this.getCurrentNetwork()];
};
```

**Step 2.** Replace every hardcoded game-contract address with `window.DUNGEON_CONFIG.getGameContract()`:

- `dungeon-session.js:8` — `this.gameContractAddress = window.DUNGEON_CONFIG.getGameContract();`
- `leaderboard.js:159` — same.
- `game.js:259` — **delete the whole `if` block.** It compares the address to itself (`if (window.dungeonSession.gameContractAddress === '0xbA216A5f…')`), which is always true and silently breaks the moment the address changes. Keep only the body.

**Step 3.** Make the ops scripts read the same source. They are Node (ethers v6) and can't use `window`, so give them a shared module — create `contract-addresses.js`:

```js
// Single source of truth for Node ops scripts. Keep in sync with config.js.
module.exports = {
  RPC_URL:   'https://rpc.testnet.chain.robinhood.com',
  CHAIN_ID:  46630,
  GAME_CONTRACT: '0xPASTE_V2_ADDRESS_AFTER_DEPLOY',
  KNIGHT_NFT:    '0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512',
  DNG_TOKEN:     '0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910',
};
```

Then update `fund-game-contract.js`, `check-contract-balance.js`, `check-contract-config.js`, `update-max-reward.js`, `update-dungeon-config.js`, `fix-nft-address.js` to `require('./contract-addresses')` instead of their own constants.

**Step 4.** Delete the scripts that only exist to debug the address confusion, once the split is resolved: `check-both-contracts.js`, `check-other-contract.js`, `fix-nft-address.js`. Also delete `CONTRACT_FIX_SUMMARY.md` and `REDEPLOY-INSTRUCTIONS.md` — they document the wrong addresses and will mislead the next person.

**Step 5.** `update-max-reward.js` and `update-dungeon-config.js` target functions (`setDungeon`, `maxRewardPerRun`) that **no longer exist** on V2. Either rewrite them against `setRarityReward` / `setDailyCap` / `setPaused`, or delete them.

### Deploy + fund runbook

1. Compile and deploy `DungeonKnightsGameV2.sol` with constructor args:
   - `_knightNFT` = `0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512`
   - `_dngToken`  = `0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910`
2. Paste the deployed address into **both** `config.js` (`GAME_CONTRACTS.testnet`) and `contract-addresses.js`.
3. Rewrite `deployed-contracts.json` with the real new address, NFT, token, deployer, txHash.
4. **Size the treasury before funding.** Worst-case daily emission = for every minted knight, `dailyCap[rarity] × rarityReward[rarity]`, summed. A single Legendary is `4 × 150 = 600 DNG/day` (Option A) or `2 × 300 = 300` (Option B). **Budget 2× one day's cap**, because the 12:00 UTC boundary is double-claimable unless Task 0's rolling-window fix was applied. With the decided odds, expected emission per random mint is **78.3 DNG/day** (Option A) or **65.0** (Option B) — at 1,000 knights that is ~2.3M or ~2.0M DNG/month. Fund for at least 30 days of *current* supply and re-check as supply grows; emission scales with mints, the treasury does not.
5. `fundContract(amount)` requires an ERC-20 `approve` from the owner to the game contract first. Make sure the updated `fund-game-contract.js` does approve-then-fund.
6. Confirm `treasuryBalance()` is non-zero before letting anyone claim.
7. **Old contracts:** call `withdrawTokens` on any prior game contract you still own to recover stranded DNG.

### Migration note — this breaks stored data

The claim payload shape changes completely. Any `dungeonCompletions` already in a player's `localStorage` carries `signature`, `reward`, `timeSpent` fields that V2 does not accept. On first load after this ships, clear it:

```js
// One-time migration. Safe to delete this block after a week.
const SCHEMA_VERSION = 'v2';
if (localStorage.getItem('dungeonSchemaVersion') !== SCHEMA_VERSION) {
    localStorage.removeItem('dungeonCompletions');
    localStorage.removeItem('knight_daily_runs'); // now authoritative on-chain
    localStorage.setItem('dungeonSchemaVersion', SCHEMA_VERSION);
}
```

Put this at the top of `dungeon-session.js`, before the manager is constructed. Any unclaimed rewards sitting in localStorage are forfeited — if that's unacceptable, claim them against the old contract first, then ship.

---

## Task 3 — Rewrite `dungeon-session.js` against the new contract

`dungeon-session.js` is built around the signature flow and needs real surgery, not patches.

### Delete outright

- **`signCompletion()` (`:327-366`)** — gone entirely. No more signing, no more MetaMask popup per dungeon.
- **`dungeonNameToId` maps (`:333-337`, `:422-428`)** — two *different* maps for the same job, both collapsing everything to `1`. Replace with a single module-level constant:
  ```js
  const DUNGEON_IDS = { crypts: 1, mines: 2, temple: 3, magma: 4, void: 5 };
  ```
  Now that `dungeonId` is analytics-only, distinct IDs are safe and more useful.
- **`calculateReward()` (`:219-250`)** — the contract computes the reward now. Keep a client-side *estimate* for display only, and rename it `estimateReward()` so nobody mistakes it for authoritative. It must read from the shared rarity table (Task 5), not its own inline copy.
- **The `dailyRunLimits` table (`:17-23`) and all localStorage run tracking** (`initializeRunTracking`, `checkDailyReset`, `getNext12PMUTC`, `getLastReset12PMUTC`, `saveRunTracking`, `useRun`). The contract is authoritative. Rewrite `getRemainingRuns(knightId)` to call `gameContract.runsRemaining(knightId)` and cache the result for ~30s.

### Update the ABI (`:9-14`)

```js
this.gameContractABI = [
    'function completeDungeons(uint256[] knightIds, uint256 dungeonId) external',
    'function runsRemaining(uint256 knightId) view returns (uint8)',
    'function getKnightStats(uint256 knightId) view returns (uint256 totalClaimed, uint8 remaining, uint64 lastRunTime)',
    'function treasuryBalance() view returns (uint256)',
    'event DungeonCompleted(address indexed player, uint256 indexed knightId, uint256 indexed dungeonId, uint8 rarity, uint256 reward, uint256 timestamp)',
    'event RewardsClaimed(address indexed player, uint256 amount, uint256 knightCount)'
];
```

Note `dungeonId` is now `indexed` — three indexed params is the max, and this lets the leaderboard filter by dungeon.

### Rewrite `completeDungeon()` and `claimAllRewards()`

New shape: a cleared dungeon appends a **pending run** (`{ knightIds, dungeonId, dungeonName, clearedAt }`) to local state — no signature, no reward baked in. `claimAllRewards()` then submits one `completeDungeons(knightIds, dungeonId)` transaction per pending run.

Keep these behaviours from the current code, they're fine:
- the `window.transactionModal` loading → waiting → success/error sequence (`:382`, `:455`, `:479`)
- the `window.audioManager` calls
- `saveToLocalStorage` / `loadFromLocalStorage`

Rewrite the error mapping at `:499-513` — those strings no longer match. New revert reasons to handle: `"No runs left today"`, `"Run cooldown"`, `"Not your knight"`, `"Treasury empty"`, `"Paused"`, plus `"user rejected"`. Delete the branches for `"Reward too high"`, `"Completion too fast"`, `"Claim too soon"`, `"Completion too old"` — those reverts can't happen now.

Also delete `clearOldCompletions()` (`:529-543`) — it exists to work around the 24h expiry the old contract had. V2 has no expiry.

---

## Task 4 — Fix the session lifecycle (rewards stop after dungeon #1)

### The problem

`completeDungeon()` nulls the session (`dungeon-session.js:311`). But `game.js` `nextDungeon()` (`:363`) and `replayDungeon()` (`:399`) re-deploy knights and set `isRunning = true` **without calling `dungeonSession.startDungeon()` again**. So from dungeon #2 onward, the `currentSession` check at `game.js:255` fails and logs `"Blockchain session not started"` — no rewards, silently, forever. The 60s auto-progress at `:334` means players hit this without touching anything.

Second bug: `stopDungeon()` (`:217`) never clears `currentSession`. So after a Recall, the next `startDungeon()` hits `"Session already active"` (`dungeon-session.js:167`) and returns `false` — and `game.js` **ignores the return value**. The stale `startTime` also inflates the next run's duration.

### The fix

**In `game.js`,** extract the session-start into one helper and call it from all three entry points:

```js
beginRun(knights) {
    if (!window.dungeonSession || knights.length === 0) return false;

    // Always clear a stale session before starting a new one.
    window.dungeonSession.abandonSession();

    const ok = window.dungeonSession.startDungeon(
        knights.map(k => k.tokenId),
        this.selectedDungeon,
        this.dungeon.config.name
    );
    if (!ok) {
        console.error('Failed to start dungeon session — rewards will not accrue');
        this.logMessage('⚠️ Could not start run tracking. Recall and redeploy.');
    }
    this.dungeonStartTime = Date.now();
    return ok;
}
```

Then:
- `startDungeon()` (`:175`) — replace the inline `window.dungeonSession.startDungeon(...)` block at `:196-205` with `this.beginRun(deployedKnights)`.
- `nextDungeon()` (`:363`) — add `this.beginRun(deployedKnights)` in the re-deploy branch at `:388`.
- `replayDungeon()` (`:399`) — same, at `:419`.
- `stopDungeon()` (`:217`) — add `window.dungeonSession?.abandonSession();`.

**Note the signature change:** `startDungeon` now takes an **array of tokenIds**, not a single lead knight. The old code tracked only `availableKnights[0]` as `knightId` while paying out for the whole squad, which is why on-chain `totalClaimed` skewed entirely onto one knight and `ui.js:237` reported a wrong "Total Historical $DNG Claimed."

**In `dungeon-session.js`,** add:

```js
abandonSession() {
    if (this.currentSession) {
        console.log('🚪 Abandoning stale session');
        this.currentSession = null;
    }
}
```

### Also fix in `game.js`

- **Daily caps are never enforced client-side.** `Knight.canDeploy()` exists (`characters.js:89`) but nothing calls it — `getAvailableKnights()` (`characters.js:313`) filters only on `isDeployed`/`resting`. In `startDungeon()` at `:178`, filter the deploy list through `canDeploy()` so exhausted knights aren't sent in to earn nothing. The contract is the real enforcement; this is UX.
- **Guard the empty-dungeon loop.** `update()` (`:158`) fires `handleDungeonCleared()` whenever `activeLoot === 0 && deployedKnights.length > 0`. If `createDungeon` ever generates zero loot nodes, this re-triggers every frame. Add an `if (this.completionHandled) return;` flag, set on clear, reset in `createDungeon()`.

---

## Task 5 — One rarity table, not four

### The problem

Reward values disagree across four files. Only `dungeon-session.js` matched what the old contract actually paid:

| Tier | `config.js` | `characters.js` | `menu.js` inline | `dungeon-session.js` |
|---|---|---|---|---|
| Common | 12 | 10 | 12 | **10** |
| Uncommon | 20 | 20 | 20 | **17** |
| Rare | 36 | 30 | 36 | **30** |
| Epic | 60 | 75 | 60 | **75** |
| Legendary | 100 | 150 | 100 | **150** |

The menu advertises 100 DNG for a Legendary run that pays 150, and 20 for an Uncommon that pays 17. Worse, `menu.js:100-129` **overwrites `knight.rarity`** with its own inline table whose multipliers (1.5/2.5/4/7) don't match `characters.js` (1.7/3/7.5/15) — so displayed stats are computed from different numbers than gameplay uses.

### The fix

`characters.js` already defines the global `const RARITY` (`:4-45`) and is loaded before every consumer on every page. Make it the single source.

1. **Add the missing fields** to `characters.js` `RARITY` so nothing else needs its own table: set `dropRate` to the **decided advertised odds, normalised** (`0.65 / 0.20 / 0.10 / 0.045 / 0.012`, divided by 1.007 — see the normalisation snippet in Task 0), keep `dungeonReward` at `10/17/30/75/150` to match the V2 constructor, and set `dailyRuns` to whichever Task 0 cap option was chosen (`5/5/4/3/4` for Option A, `5/4/3/2/2` for Option B). **Also in this file:** delete the Mythic reference (Task 0 lists every site), and fix `UNCOMMON.dungeonReward`, currently `20` at [characters.js:18](characters.js:18), which must become **17**. The comment there reads `// Fixed: matches contract (was 17)` — wrong in both directions, since the contract constructor and `dungeon-session.js` both pay **17**. The UI has been advertising 20 for a run that pays 17. Delete that misleading comment.
2. **Delete `RARITY_DATA` from `menu.js` (`:95-129`)** and the `knight.rarity = {...}` overwrite. Build rarity from the shared `RARITY[tier]` instead. Keep `RARITY_MAP` (the blockchain-index → tier-name lookup) — that part is correct.
3. **Delete the inline `rarityRewards` in `dungeon-session.js` `calculateReward` (`:223-229`)** and in `game.js` `getGameState` (`:516-522`). Both read `RARITY[tier].dungeonReward`.
4. **`config.js` `RARITY` (`:73-119`) is dead weight** — different numbers, different shape (lowercase keys, `baseStats`), and nothing in the live flow reads it. Delete the block and the `getRarity` / `rollRarity` / `getRewardForRarity` helpers (`:148-170`), or if something still references them, repoint to `characters.js`. Grep before deleting.
5. **Best-effort:** have the client read `rarityReward` and `dailyCap` from the contract on load and warn to console if they disagree with `RARITY`. Cheap drift alarm.

Whoever does this must grep for `dungeonReward`, `dailyRuns`, `rarityRewards`, and `RARITY_DATA` across the repo afterward and confirm only `characters.js` defines values.

---

## Task 6 — Stop `ui.js` hammering the RPC at 60fps

### The problem

`startUILoop()` (`ui.js:492-498`) runs `update()` on **every animation frame**. `update()` calls `updateTotalClaimedFromBlockchain()` (`:215`) and `updateWalletBalance()` (`:255`). Both guard with a timestamp — but set it *after* the `await` (`:248`, `:269`). During the first round-trip (~500ms ≈ 30 frames), 30 more calls launch, each firing one RPC **per deployed knight**. With 15 knights that's ~450 in-flight requests before the first guard ever closes.

`updateSquadList()` (`:279`) also rebuilds the entire squad list via `innerHTML` every frame.

### The fix

**Split the loop by cadence.** Canvas-rate work stays on rAF; everything else goes on timers.

```js
startUILoop() {
    // 60fps: cheap, local-state only.
    const tick = () => {
        this.updateStatusBar();   // dngRate, activeKnights, activeLoot, estimatedTime
        requestAnimationFrame(tick);
    };
    tick();

    // 1s: DOM rebuilds.
    setInterval(() => {
        this.updateSquadList();
        this.updateRewardsDisplay();
    }, 1000);

    // 15s / 30s: network.
    setInterval(() => this.updateWalletBalance(), 15000);
    setInterval(() => this.updateTotalClaimedFromBlockchain(), 30000);
}
```

Then **delete the timestamp guards entirely** (`:219-222`, `:259-262`) — the interval *is* the rate limit now. Add a simple in-flight flag to each so a slow RPC can't stack:

```js
async updateWalletBalance() {
    if (this._balanceInFlight) return;
    this._balanceInFlight = true;
    try { /* ...existing body... */ }
    finally { this._balanceInFlight = false; }
}
```

**Make `updateSquadList` idempotent.** Build a cheap signature of the roster (`id:state:stamina` joined) and skip the rebuild when unchanged:

```js
const sig = deployedKnights.map(k =>
    `${k.id}:${k.state}:${Math.floor(k.stamina)}`
).join('|');
if (sig === this._lastSquadSig) return;
this._lastSquadSig = sig;
```

**Batch the per-knight stat calls.** `updateTotalClaimedFromBlockchain` (`:235`) loops `getKnightStatsFromChain` one knight at a time. Wrap in `Promise.all`, or better — once Task 4 lands, the contract tracks per-knight `totalClaimed` and the UI can sum locally from `DungeonCompleted` events instead of polling at all.

### Also in `ui.js`

- **`updateTheme()` (`:353`) is never called.** `index.html:12` hardcodes `data-dungeon-theme="crypts"`, so the theme never changes. Call `window.ui?.updateTheme(type)` at the end of `game.js` `createDungeon()` (`:109`).
- **`this.dungeonTitle` is never assigned** in `initElements()`, so the `:377` branch is dead. Either add the lookup or remove the branch.
- **`RARITY[knight.rarity.tier]?.dailyRuns` (`:297`)** should come from the contract cache after Task 3.

---

## Task 7 — Smaller fixes

**`leaderboard.js:68` — wrong property.** Reads `window.walletManager.account`; the property is `userAddress` (`wallet.js:7`). The "You" highlight never fires. Fix to `window.walletManager.userAddress`. Grep for `.account` across the repo for the same mistake elsewhere.

**`leaderboard.js:175` — block range too wide.** Queries 100,000 blocks in one `eth_getLogs`; most RPCs cap this and reject it. Page it in 10,000-block chunks (or whatever the Robinhood RPC allows) and merge, or record a `DEPLOY_BLOCK` constant and scan from there. Also: it builds its own `JsonRpcProvider` from `CONFIG.getNetworkConfig().rpc` rather than reusing the wallet provider — fine, but it means the leaderboard silently queries a different network than the player's wallet if they disagree. Log a warning on mismatch.

**`wallet.js:372` — O(totalMinted) scan.** `getMyKnights()` loops `0 → totalMinted` with one RPC per token. Fine at 100 NFTs, unusable at 10,000. If the NFT contract supports ERC-721 Enumerable (`tokenOfOwnerByIndex`), use it — that's `balanceOf` calls only. Otherwise query `Transfer` events to the user's address and reconcile. Add a loading indicator either way.

**`dungeon-select.html` has no audio.** It never loads `audio.js`, so both `window.audioManager` branches in `dungeon-select.js` (`:31`, `:43`) are silent no-ops, and `:60` constructs `AudioManager` from an undefined global. Add `<script src="audio.js"></script>` before `dungeon-select.js` and delete the dead constructor at `:59-61`. Separately, `'hover'` (`dungeon-select.js:43`) is not a defined sound key — the registry has `sword_hit, monster_death, chest_break, coin_pickup, gold_earn, button_click, recruit, deploy, dungeon_complete, rare_drop, reward_claim_start, reward_claim_success, coin_cascade, blockchain_confirm, footstep`. Either add `hover` or use `button_click`.

**`reward-claim-ui.js` is mostly dead.** `createUI()` (`:17`) is a no-op, so `claimRewardsBtn`, `unclaimedAmount`, `completionCount` never exist — those listeners and `updateDisplay()` do nothing, while a 5s `setInterval` (`:12`) runs forever. `index.html` uses `claimAllBtn`/`rewardsTotal`/`rewardsCompletions`, all correctly handled by `ui.js` (`:109`, `:320`). **The only live thing in this file** is the `leaderboardBtn` listener (`:47`). Move that into `ui.js` `bindEvents()` and delete `reward-claim-ui.js` entirely, including the `<script>` tag at `index.html:199` and the `window.rewardClaimUI` call at `game.js:268`.

**`dungeon-select.html` broken thumbnails.** `:27, :45, :63, :81, :99` reference `maps/crypts.png`, `goblin.png`, `temple.png`, `magma.png`, `void rift.png`. **All five are deleted** — `maps/` now holds only differently-named `.jpeg` files. Every card on the dungeon picker is a broken image, on the critical path into the game.
> **User is supplying new art.** Leave the five `<img>` tags as-is and flag them as a TODO. Once files land, update the five `src` attributes. If the art doesn't arrive in time, the originals are recoverable: `git checkout 5acf86f -- maps/`. Interim: add a CSS background colour on `.dungeon-image-wrapper` so broken-image icons don't show.

**Orphan files — delete.** Not referenced by anything in the live flow: `index-new.html` (references `themed-styles-new.css`, which doesn't exist), `menu-new.html`, `menu-new.js`, `menu-new.css`, `index-old-backup.html`, `menu-old-backup.html`, `menu-old-backup.js`, `menu-old-backup.css`, `ui-new.js`, `ui-old-backup.js`, `sprite-viewer.html`, `themed-styles.css` (live page uses `themed-styles-centered.css`).
> Note `menu-new.js:49` writes `selectedKnights` as a bare ID array while `game.js:41` expects full objects — if that file were ever made live it would break the handoff. Another reason to delete rather than keep.

**`vercel.json` publishes everything.** The `**/*.html` build rule plus the catch-all route means `deploy-contract-simple.html`, `deploy-game-browser.html`, `test-daily-runs.html`, and `test-timing.html` are all live on the production domain. They contain no private keys (they use the injected wallet), but `test-daily-runs.html` manipulates the same `localStorage` keys the game uses. Delete them, or move them to a `tools/` directory excluded from the build.

**`USE_MAINNET` is decorative.** `config.js:6` implies a network switch, but `wallet.js:15-16` hardcodes chainId 46630, and `wallet.js:11-12`, `dungeon-session.js:8`, `leaderboard.js:159` hardcode testnet addresses. Flipping the flag switches nothing. Worse, `config.js:28` and `:35` still hold `0xYOUR_…` placeholders — enabling mainnet as-is throws on invalid addresses. After Task 2, route `wallet.js` through `CONFIG.getNetworkConfig()` / `getNFTContract()` / `getTokenAddress()` too, and add a startup assert that every active-network address is a valid `0x…40-hex` before the game boots.

---

## Suggested order

1. **Task 0 first** — the owner has already settled *cut Mythic* and *adopt the advertised odds*; the only open item is the run caps (Option A vs B). It is a five-minute decision, but its numbers get compiled into Task 1 and are awkward to change once players hold NFTs.
2. **Task 1 + Task 2 together** — contract rewrite, deploy, fund, address consolidation. Nothing else matters while the treasury is drainable. Do not skip the verification list.
3. **Task 3** — client rewrite against the new ABI. The game is broken between Task 1 and Task 3; keep them in one branch.
4. **Task 4** — session lifecycle. This is the bug where rewards silently stop after dungeon #1.
5. **Task 5** — rarity table. Do it before Task 6 so the UI reads correct numbers.
6. **Task 6, Task 7** — performance and cleanup, independent of each other.

## Ground rules

- **No build step.** Plain `<script>` tags, globals on `window`. Don't add a bundler, TypeScript, or a framework.
- **ethers v5 in the browser** (`ethers.utils.parseEther`, `new ethers.providers.Web3Provider`), **v6 in Node scripts** (`ethers.parseEther`, `new ethers.JsonRpcProvider`). The APIs are not interchangeable — check which context you're in.
- **Cache-bust on deploy.** Script tags carry `?v=` query strings (e.g. `index.html:187-208`). Bump them when changing a file or returning players get stale JS. `vercel.json` sets `must-revalidate` on JS/HTML, but the query string is the real lever.
- **Don't edit orphan files.** If a change seems to have no effect, confirm the file is in the live chain listed at the top.
- **Test on testnet with a real wallet** before considering any of this done. Claim reverts are the failure mode that matters, and they only show up against a real chain.

---

## Appendix A — if you later want gameplay to be required

Task 1 accepts that a player can claim their daily allowance without playing. If that becomes unacceptable, the change is contained:

1. Stand up a small backend that watches/validates a run and signs `keccak256(knightId, dungeonId, nonce, player)` with a server-held key.
2. Add to V2: `address public verifier;`, `mapping(bytes32 => bool) public usedNonce;`, and an owner-only `setVerifier`.
3. In `completeDungeons`, take a `bytes[] signatures` + `uint256[] nonces` param and require:
   ```solidity
   require(!usedNonce[h], "Replay");
   usedNonce[h] = true;
   require(ECDSA.recover(ethSigned, signatures[i]) == verifier, "Bad signature");
   ```
   **`verifier`, never `msg.sender`** — that was the original bug.
4. Reward derivation from rarity stays exactly as-is. The signature gates *eligibility*, it never carries an amount.

The reward amount must never come from the client, in any version.
