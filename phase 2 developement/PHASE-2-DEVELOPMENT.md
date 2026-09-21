# Phase 2 Development — Genesis NFT + Staking + Weekly Raffle

---

## Overview

Phase 2 adds three new NFT collections and a staking/raffle system to Dungeon Knights.
This document covers every detail: smart contracts, frontend pages, integration points, and build order.

---

## Current Project State (Phase 1 Complete)

| Component | Status |
|---|---|
| Game (V3 contract) | Live on Robinhood Chain Testnet |
| Knight NFT (ERC-721) | Live — 34 minted |
| DNG Token | Live ERC-20 |
| Landing page | Done (dark tactical, 2-panel) |
| Menu page | Done (Knight's Hall, roster) |
| Mint page | Done (Summoning Chamber, 500 DNG/call) |
| Dungeon game | Working, 5 dungeons |
| Vercel deploy | Working |

**Existing contracts (do NOT modify):**
- Game Contract V3: `0xD8de9385Db7DfE925882E76849B6e067e47236e5`
- Knight NFT: `0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512`
- DNG Token: `0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910`

---

## New Smart Contracts (4 contracts)

### 1. GenesisNFT.sol — Mythical Knights (1024 supply)

```
Type: ERC-721
Supply: 1024 (fixed, all minted by owner)
Network: Robinhood Chain Testnet
Mint: Owner-only (all 1024 minted by deployer), then listed on OpenSea

On-chain data per token:
- hashPower: uint256 (1-100, trait determines staking power)
- name: string (e.g. "Genesis #042")

Interface:
- function mint(address to, uint256 hashPower) external onlyOwner
- function tokenURI(uint256 tokenId) external view returns (string)
- function hashPower(uint256 tokenId) external view returns (uint256)
- function totalSupply() external view returns (uint256)
```

### 2. StakingContract.sol

```
Type: Custom staking contract
Accepts: GenesisNFT tokens only

Core data structures:
- struct StakeSession {
    uint256 nftId;
    address owner;
    uint256 stakedAt;
    uint256 lastClaimAt;
    bool active;
  }
- mapping(uint256 => StakeSession) public sessions; // keyed by NFT tokenId
- mapping(address => uint256[]) public userStakedNfts;

Raffle ticket formula:
  tickets = floor(min(stakedHours, 168) * hashPower)
  (capped at 1 week / 168 hours of staking)

Core functions:
- stake(uint256 nftId)              // transfer NFT to contract, create session
- unstake(uint256 nftId)             // return NFT, settle all pending rewards
- claimRewards(uint256 nftId)        // claim DNG + raffle tickets, keep NFT staked
- getRaffleTickets(uint256 nftId)    // view pending ticket count
- getStakeDuration(uint256 nftId)    // view hours staked (for UI display)
- getUserStakedNfts(address owner)   // view all staked NFTs for an address

Events:
- event Staked(uint256 indexed nftId, address indexed owner, uint256 timestamp)
- event Unstaked(uint256 indexed nftId, address indexed owner, uint256 timestamp)
- event RewardsClaimed(uint256 indexed nftId, uint256 dngAmount, uint256 ticketsEarned, uint256 timestamp)
- event DungeonHunt(uint256 indexed nftId, uint256 dungeonId, uint256 reward, uint256 timestamp)
```

### 3. RaffleContract.sol

```
Type: Weekly lottery contract

Core data:
- uint256 public constant TICKETS_PER_WEEK = 200; // capsules awarded per draw
- uint256 public constant TICKET_DECAY_HOURS = 168; // 1 week
- uint256 public currentWeek; // increments each Monday 00:00 UTC
- mapping(uint256 => RaffleEntry[]) public weekEntries; // week => list of entries
- mapping(uint256 => bool) public capsuleClaimed; // week + winner index

- struct RaffleEntry {
    uint256 nftId;
    address owner;
    uint256 tickets; // number of tickets this entry holds
    uint256 week;
  }

Core functions:
- enterRaffle(uint256 nftId, uint256 ticketAmount) // user enters with their tickets
- drawWinner(uint256 weekNumber)                    // only owner, picks 200 winning ticket numbers
- claimCapsule(uint256 weekNumber, uint256 winnerIndex) // winner claims their capsule
- claimDNGReward(uint256 weekNumber, uint256 winnerIndex) // winner claims DNG prize
- getWeekEntries(uint256 weekNumber) // view all entries for a week
- getCurrentWeek() // view current week number

Draw mechanism:
- Uses blockhash of the draw block (testnet)
- 200 winning numbers: random(1, totalTickets) drawn 200 times (no duplicates)
- Each winning number maps to an entry (which person owns that ticket range)
- Winners can claim Capsule NFT + DNG from weekly pool

Events:
- event RaffleEntered(uint256 indexed week, uint256 indexed nftId, address indexed owner, uint256 tickets)
- event WinnerDrawn(uint256 indexed week, uint256 winnerIndex, uint256 ticketNumber, address winner, uint256 capsulesWon)
- event CapsuleClaimed(uint256 indexed week, uint256 indexed winnerIndex, uint256 capsuleId)
```

### 4. CapsuleNFT.sol

```
Type: ERC-1155 (semi-fungible, multiple capsule types)
Minter: Only RaffleContract can mint

Capsule types:
- Type 1: Common Capsule
- Type 2: Rare Capsule
- Type 3: Legendary Capsule
- Type 4: Mythic Capsule

Interface:
- function mint(address to, uint256 capsuleType, uint256 amount) external onlyRaffleContract
- function openCapsule(uint256 capsuleId) external // burns capsule, reveals knight NFT
- function balanceOf(address owner, uint256 capsuleType) external view returns (uint256)

Opening a capsule:
- User clicks "Open Capsule" on staking page
- Redirected to Summoning Chamber (mint.html)
- Capsule burned, random knight NFT minted to user
- Rarity determined by capsule type (Common capsule = Common-Legendary chance, etc.)
```

---

## Frontend Pages

### Page 5: Staking Page (`staking.html` + `staking.js`)

**Route:** Navigation between Hall of Fame and Marketplace on landing page

**Layout:** Two-panel, matches existing dark tactical theme

```
┌──────────────────────────────────────────────────────────────┐
│ HEADER (same as other pages)                                  │
├──────────────┬───────────────────────────────────────────────┤
│              │                                               │
│  LEFT PANEL  │  RIGHT PANEL                                  │
│  (380px)     │  (flex: 1)                                    │
│              │                                               │
│  My Genesis  │  Staking Overview                             │
│  Knights     │  ├── Weekly Pool: 15,420 DNG                  │
│              │  ├── Capsules Remaining: 187/200              │
│  ┌────────┐  │  └── Next Draw: 3d 14h 22m                   │
│  │ #042   │  │                                               │
│  │ ⚡67HP │  │  [ Staked Knights ]  [ Raffle ]  ← tab bar  │
│  │ 47h st │  │                                               │
│  │ 142 tk │  │  ┌─────────────────────────────────────┐     │
│  │[Unstake│  │  │  Staked Knights list or              │     │
│  │ [Claim]│  │  │  Raffle board content                │     │
│  └────────┘  │  │                                       │     │
│  ┌────────┐  │  │                                       │     │
│  │ #017   │  │  │                                       │     │
│  │ ⚡92HP │  │  │                                       │     │
│  │ 89h st │  │  │                                       │     │
│  │ 289 tk │  │  └─────────────────────────────────────┘     │
│  │[Unstake│  │                                               │
│  │ [Claim]│  │                                               │
│  └────────┘  │                                               │
│              │                                               │
│  Stats       │                                               │
│  Staked: 3/5 │                                               │
│  Tickets: 487│                                               │
│              │                                               │
└──────────────┴───────────────────────────────────────────────┘
```

**Tab 1 — Staked Knights:**
- List of owned Genesis NFTs with status
- Each card shows: image, name, hashPower, staked duration, pending tickets
- Buttons: Stake, Unstake, Claim Rewards

**Tab 2 — Raffle:**
- Left: My entries table (NFT #, hashPower, ticket count, Enter/Withdraw)
- Right: Raffle board (week info, total entries, capsules remaining, countdown)
- Button: "Enter All in Raffle" / "Withdraw All"

### Page 6: Raffle (integrated into Staking page)
- Raffle tab inside staking.html
- Shows current week, entry count, capsule count, countdown timer
- Enter/withdraw tickets per knight
- View past winners

### Page 7: Capsule Inventory (integrated into Staking page or separate)
- Shows won capsules
- "Open Capsule" button → redirects to `mint.html`
- Opening a capsule mints a new knight NFT via the summoning chamber

---

## Landing Page Update

**Current order:**
1. Enter Dungeon
2. Summon Knight
3. Hall of Fame
4. Marketplace

**New order (insert Staking Vault between Hall of Fame and Marketplace):**
1. Enter Dungeon
2. Summon Knight
3. Hall of Fame
4. Staking Vault (NEW)
5. Marketplace

---

## New JavaScript Modules

### `genesis-nft.js` — Genesis NFT Manager
```
class GenesisNFTManager {
    contract; // GenesisNFT contract instance

    async getOwnedGenesisNFTs()        // balanceOf + tokenOfOwnerByIndex loop
    async getGenesisNFTMetadata(id)    // hashPower + name
    async isGenesisNFT(address, id)     // verify correct contract
    async loadAllGenesisKnights()       // populate UI with owned NFTs
}
```

### `staking.js` — Staking Page Controller
```
class StakingPage {
    genesisManager; // GenesisNFTManager instance
    stakingContract; // StakingContract instance
    raffleContract;  // RaffleContract instance

    // Initialization
    async init()                          // load contracts, fetch data
    async loadStakedKnights()             // fetch user's staked NFTs with session data
    async loadRaffleData()                // fetch current week, entries, countdown

    // Staking actions
    async stakeGenesisNft(nftId)          // approve + stake
    async unstakeGenesisNft(nftId)         // unstake + claim all pending
    async claimStakingRewards(nftId)      // claim DNG + tickets without unstaking

    // Raffle actions
    async enterRaffle(nftId)              // enter specific NFT's tickets
    async withdrawFromRaffle(nftId)       // withdraw from raffle
    async enterAllInRaffle()              // enter all staked NFTs
    async claimCapsule(week, winnerIndex) // claim won capsule
    async claimRaffleDNGReward(week, idx) // claim DNG prize

    // UI rendering
    renderStakedKnightsList()
    renderRaffleBoard()
    renderActivityLog()
    updateCountdownTimer()
    showTransactionModal(message)
}
```

### Update `landing.js`
```
- Add Staking Vault button click → navigate to staking.html
- Add staking page link to navigation
```

### Update `lib/static-pages.js`
```
- Add "staking" page entry:
  - styles: [theme.css, shared-wallet.css]
  - scripts: [ethers, config, wallet, genesis-nft, staking, shared-header, audio]
  - body: staking page HTML (two-panel layout)
- Add routing for /staking.html
```

---

## DNG Reward Pool (Design TBD)

**Current understanding:**
- There will be a pool of DNG per epoch
- Epoch duration and pool size to be determined later
- Staked Genesis NFTs earn DNG from this pool
- Rewards are claimed via `claimRewards()` on StakingContract

**Open questions (to decide later):**
- Epoch length: daily? weekly?
- Pool size per epoch: fixed amount or % based?
- Distribution: equal per NFT, or proportional to hashPower + stake duration?
- Does DNG come from existing token supply or new emissions?

---

## Raffle Mechanics (Detailed)

```
Weekly Cycle:
  Monday 00:00 UTC  → New week begins, previous week's draw is finalized
  Throughout week  → Players stake Genesis NFTs, earn tickets, enter raffle
  Sunday 23:59 UTC  → Entry window closes
  Monday 00:00 UTC  → Draw happens (200 winning ticket numbers)

Ticket Calculation:
  tickets = floor(min(stakedHours, 168) * hashPower)
  Example: NFT with hashPower 67 staked for 47 hours
    → tickets = floor(min(47, 168) * 67) = floor(47 * 67) = 3149 tickets

Draw Process:
  1. Total tickets across all entries calculated
  2. 200 unique random numbers generated (1 to totalTickets)
  3. Each winning number maps to an entry (person who owns that ticket)
  4. Winners announced, capsules + DNG available to claim

Winning:
  - Each winning ticket = 1 Capsule NFT
  - Person with most winning tickets gets most capsules
  - Winner claims via claimCapsule() + claimDNGReward()
```

---

## Capsule Opening Flow

```
1. User wins capsule in raffle
2. Capsule appears in inventory (shown on staking page or mint page)
3. User clicks "Open Capsule"
4. Redirected to /mint.html (Summoning Chamber)
5. Capsule type determines knight rarity chances:
   - Common Capsule:   Common 60%, Uncommon 25%, Rare 10%, Epic 4%, Legendary 1%
   - Rare Capsule:     Uncommon 30%, Rare 40%, Epic 20%, Legendary 8%, Mythic 2%
   - Legendary Capsule: Rare 20%, Epic 40%, Legendary 30%, Mythic 10%
   - Mythic Capsule:   Epic 30%, Legendary 40%, Mythic 28%, Mythic 2%
6. New knight NFT minted to user's wallet
7. Knight appears in roster (menu.html)
```

---

## Integration Points with Phase 1

| Feature | Reuses From Phase 1 | New Code Needed |
|---|---|---|
| Wallet connection | `wallet.js` (ethers provider) | — |
| Page routing | `landing.js`, `lib/static-pages.js` | Add staking route |
| Theme / CSS | `theme.css` (variables, layout) | Add staking-specific styles |
| Audio | `audio.js` | Hover/click sounds (existing) |
| Knight NFTs | Existing ERC-721 (non-Genesis) | New GenesisNFT contract + mint flow |
| DNG token | Existing ERC-20 | — (same token) |
| Summoning chamber | `mint.html` + `mint-page.js` | Add capsule opening to existing flow |

---

## Build & Deploy Order

```
Step 1: Write smart contracts (Solidity)
  ├── GenesisNFT.sol
  ├── StakingContract.sol
  ├── RaffleContract.sol
  └── CapsuleNFT.sol

Step 2: Test contracts locally (Forge/Hardhat)
  ├── Unit tests for each contract
  └── Integration test (stake → earn tickets → enter raffle → draw → claim)

Step 3: Deploy contracts to testnet
  ├── Deploy GenesisNFT → mint 1024 tokens
  ├── Deploy CapsuleNFT
  ├── Deploy StakingContract
  └── Deploy RaffleContract

Step 4: Verify contracts on Robinhood Chain explorer

Step 5: List Genesis NFTs on OpenSea
  └── Set price, description, traits

Step 6: Build frontend
  ├── Create staking.html (two-panel layout)
  ├── Create staking.js (staking + raffle logic)
  ├── Create genesis-nft.js (NFT loading/management)
  ├── Update landing.html (add Staking Vault button)
  ├── Update landing.js (add staking navigation)
  ├── Update lib/static-pages.js (add staking route + scripts)
  └── Update mint.html (add capsule opening flow)

Step 7: End-to-end testing on testnet
  ├── Stake a Genesis NFT
  ├── Claim rewards
  ├── Enter raffle
  ├── Simulate draw (owner function)
  ├── Claim capsule
  ├── Open capsule → new knight

Step 8: Deploy to Vercel
  └── git push → auto deploy
```

---

## File Checklist

### New Files to Create
```
contracts/
  GenesisNFT.sol
  StakingContract.sol
  RaffleContract.sol
  CapsuleNFT.sol

public/
  staking.html
  staking.js
  genesis-nft.js

lib/
  (no new files — update existing static-pages.js)
```

### Existing Files to Modify
```
landing.html      → add Staking Vault button (between Hall of Fame and Marketplace)
landing.js        → add staking page navigation
lib/static-pages.js → add staking page config + route
mint.html         → add capsule opening flow (optional: redirect to separate page)
mint-page.js      → handle capsule opening logic
contract-addresses.js → add new contract addresses after deployment
```

### Files NOT to Touch
```
dungeon.js, game.js, dungeon-session.js, ui.js, characters.js,
combat.js, pathfinding.js, dungeon-select.js, menu.js, menu.html,
wallet.js, audio.js, config.js, theme.css, layout.css
```

---

## Open Decisions (Not Yet Made)

1. **Epoch system for DNG pool** — length, size, distribution formula
2. **Genesis mint price** — to be revealed later
3. **Capsule rarity distribution** — exact % per capsule type
4. **Staking cooldowns** — any lock-up period before unstake?
5. **Raffle entry cost** — free (just your tickets) or cost DNG to enter?
6. **Capsule reveal animation** — any special effect when opening?

---

## What We Are NOT Building

- Session simulation / live activity feed (removed — not needed now)
- Backend indexer (frontend reads contract directly)
- Chainlink VRF (using blockhash on testnet, upgradeable later)
- Mobile app (web only)
- Mainnet deployment (testnet first)

---

## Notes

- All contracts use Solidity 0.8.20+ with OpenZeppelin v5
- Network: Robinhood Chain Testnet (Chain ID: 46630)
- RPC: https://rpc.testnet.chain.robinhood.com
- DNG token is the same existing token — no new token needed
- Genesis NFTs are minted by owner only, listed on OpenSea for sale
- Only GenesisNFT tokens can be staked (contract validates token address)
