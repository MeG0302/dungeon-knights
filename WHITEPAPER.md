# Dungeon Knights — Whitepaper

**Version 1.0 · September 2026**

An NFT idle-RPG where knights you own clear dungeons you watch, and every reward is a
signed, on-chain fact rather than a number the browser made up.

- **Play:** https://dungeon-knights.vercel.app
- **Code:** https://github.com/MeG0302/dungeon-knights
- **Network today:** Robinhood Chain **testnet** (chain ID 46630)

> **Status honesty box.** This is a working product on testnet. Three contracts are live
> and have processed real runs; four more are specified and one is written but not
> deployed. There has been **no third-party security audit**, the reward pool is **not
> seeded**, and the mainnet deployment has not happened. Every claim in this document is
> labelled **Live**, **Written**, or **Planned**, and anything unverifiable is marked
> **TBD**. Read §11 before you spend anything.

---

## 1. Abstract

Idle and blockchain games share a credibility problem: the player is asked to believe a
number. The game says you earned 40 tokens, the token appears, and nothing anywhere
proves a dungeon was played or that the payout was the amount the rules promised.

Dungeon Knights is built the other way round. The game itself is a full canvas engine —
five themed dungeons, pathfinding knights, monsters that fight back — and the reward layer
sits *behind* a server that times every run on its own clock, prices it from on-chain
rarity, and signs exactly that one run. The contract re-derives the price and refuses
anything the signature did not authorise. A script cannot pay itself without playing, and
it cannot pay itself faster than an honest player.

Everything else follows from that: a fixed-supply token with a mint-funded reward pool, an
economy quoted in **clears to break even** rather than in dollars, and a Phase 2 staking
and weekly raffle layer now specified in full.

---

## 2. The problem

1. **Unverifiable rewards.** Most "play to earn" front ends decide what you earned and
   then ask the chain to pay it. The chain has no opinion, so the game has no integrity.
2. **ROI promises that ignore supply.** A reward table is meaningless without stating
   where the tokens come from. If rewards are minted, the promise is inflation.
3. **Opaque odds.** Drop rates and raffle chances are usually hidden, which is exactly
   where they should be readable.
4. **Testnet fatigue.** Projects ship a pretty front end and no working loop. Here, the
   loop came first: knights pathfind, fight, and die, and have done since the first build.

---

## 3. What Dungeon Knights is

A player owns ERC-721 **knights**, forms a squad of up to **15**, picks one of **five
dungeons**, and watches the squad fight through it on a canvas. Clearing pays **$DNG**,
subject to per-knight daily limits. A gatekeeper character, **Arya**, walks the player
through each surface.

Seven surfaces, all live on the production domain:

| Route | Surface | What it does |
|---|---|---|
| `/` | Landing | Two-panel entry, routes to the rest |
| `/mint` | **Summoning Chamber** | Summon 1–5 knights, 500 $DNG each, rarity rolled |
| `/menu` | **Knight's Hall** | Roster, sort/filter, squad selection, DNG balance, claim records |
| `/dungeons` | Dungeon select | Five maps with difficulty, monsters and themes |
| `/game` | Battle | The canvas engine: knights, monsters, chests, attacks |
| `/points` | **Points Program** | Points Vault mini-game, referrals, share-to-double, leaderboard |
| `/staking` | **Staking Vault** | Genesis staking + weekly raffle UI (preview data, see §9) |

---

## 4. Game design

### 4.1 Knights and rarity

**Five** rarities, one per on-chain enum slot (0–4), rolled once. Multipliers affect
**gameplay stats only** — reward amounts are table-fixed per rarity, so a Legendary is not
paid more per clear than the table allows.

The odds below are the single published table. It is asserted by `tools/check-rarity.js`
against the engine, the shared config, the React helpers and each reward contract's
constructor, so the interface cannot advertise a tier or a number the contracts do not pay:

| Rarity | Roll | Power × | Base speed | Reward / clear | Daily runs | Max DNG / day | Hash power |
|---|---|---|---|---|---|---|---|
| Common | 50% | 1.0 | 1.0 | 12 | 5 | 60 | 15 |
| Uncommon | 30% | 1.7 | 1.7 | 20 | 5 | 100 | 25 |
| Rare | 15% | 3.0 | 3.0 | 36 | 4 | 144 | 36 |
| Epic | 4% | 7.5 | 7.5 | 60 | 3 | 180 | 45 |
| Legendary | 1% | 15.0 | 15.0 | 100 | 4 | 400 | 100 |

**Hash power is `dailyCapacity ÷ 4` for every tier**, which is what makes staking pay exactly
90% of playing across the whole collection. An earlier table (5 / 8 / 15 / 40 / 100) was not
proportional to earning power, so a Legendary staker earned 2.1× its own dungeon income
passively while a Common earned 0.7×. Deriving the value from capacity removes the judgement
call. `tools/check-rarity.js` asserts this identity in all three tables.

The rolls sum to exactly 100%, which matters: `rollRarity()` accumulates the percentages and
falls through to Common for anything past the last entry, so a table that summed to less than
100 would quietly promote a phantom tier rather than fail. An earlier six-tier table
advertised a Mythic at 0.3% that could never be rolled at all (§11.1).

Stats: `power = (10 + rand·15) × multiplier × variance(0.8–1.2)`,
`stamina = (300 + rand·100) × multiplier`. Squad cap **15**. Melee only, 1s attack
cooldown, monsters 500 HP, loot chests 250 HP.

Observed on testnet across the 78 knights minted so far: 46 Common, 22 Uncommon, 6 Rare,
1 Epic, 2 Legendary. That is the **collection contract's** roll rather than this table — its
source is not in this repository (§11.13) — and at n=78 the sample is too small to confirm
or refute either distribution: 59% Common sits between this table's 50% and the previous
advertised 65%, each about one standard error away.

### 4.2 The five dungeons

| # | Dungeon | Theme | Monster | Monster attacks with |
|---|---|---|---|---|
| 1 | Forgotten Crypts | Bones and skulls | Skeletal warrior | Glowing **black beam** from the mouth |
| 2 | Goblin Mines | Crystal-lit shafts | Goblin | Green-yellow **acid vomit** |
| 3 | Overgrown Temple | Vines and mushrooms | Plant creature | **Vine whip** |
| 4 | Magma Chambers | Lava channels | Fire demon | **Flames** |
| 5 | Void Rift | Cosmic purple | Void creature | **Cosmic beam** |

Each dungeon maps to a monster sprite and a themed tile palette.

### 4.3 Combat rules (as implemented and tested)

- **Monsters act.** Monsters had previously been scenery. They now fight back with the
  themed attack listed above, and they **walk 2 tiles off their mean position** when idle
  and return when done.
- **Domains and aggro.** A monster only attacks when a knight is inside its domain — a
  **3-tile radius, all directions**. It **faces the knight that entered**.
- **Short beams.** Attacks are emitted from the mouth and never exceed **2 tiles** in any
  direction, and they are drawn slim.
- **No interleaving.** Knights and monsters never occupy or mix into the same tile space.
- **Left and right only.** Knights engage monsters horizontally, never vertically, so the
  fight reads clearly on screen.
- **Off-beat.** Knight and monster attacks are deliberately staggered; they never land on
  the same frame.
- **Chests are static.** Loot chests do not walk, do not aggro, and open only when their HP
  is depleted. They are scenery with a health bar, not combatants.
- **No double damage.** An attack animation — beam, whip, or vomit — is **presentation
  only**. It applies no damage beyond the damage already modelled, exactly as before the
  animation existed. This is a deliberate design rule, not an oversight.

### 4.4 Arya, the dungeon gate keeper

A hand-drawn character who appears from the lower middle of the screen with an
expression matched to the moment, and a line of dialogue written for that moment:

| Trigger | What she does |
|---|---|
| Entering the Points Program (first time, and any time after — always skippable) | Walks the whole page: what points are, connect wallet, sign once, clear the vault, share to double |
| Map selected, dungeon loading | Holds the screen while monsters, knights and art finish preloading, so the player never sees the placeholder map or an empty board |
| Dungeon cleared | Celebrates the clear and the reward |
| Knight minted | Welcomes the new recruit, in her own voice rather than a browser alert |
| Returning from the game to the Knight's Hall | Hands the player back to squad management |

She is a functional guide, not a decoration: her walkthrough is what makes the Points
Program legible to someone who has never seen a wallet prompt.

### 4.5 The Points Vault (non-token mini-game)

A three-floor dungeon, reachable only from inside the Points Program, playable with five
**dummy epic knights** granted for the run (these are not NFTs and are not your knights).
It clears in roughly 20–25 seconds and runs on its own map.

| Floor | Name | Points |
|---|---|---|
| 1 | Vault Entrance | 100 |
| 2 | Treasury Hall | 300 |
| 3 | Inner Sanctum | 500 |
| | **Entry total** | **900** |

Flow: clear a floor → **Move to Next Dungeon** → on the third floor choose **Exit** (take
the points) or **Share on X** — sharing **doubles the whole entry** to **1,800 PTS**. Once
a day per wallet, reset at UTC midnight, with the share claim guarded so concurrent
requests cannot double-pay. Deploy, recall and exit are available from inside the vault.

**Referrals:** 15% of a first-degree referee's first points, 5% of a second-degree's.

Points are an off-chain record, not a token, and carry no promise of conversion. See §11.

---

## 5. Economy — $DNG

### 5.1 Token parameters

| Item | Value |
|---|---|
| Name / symbol | Dungeon Token / **$DNG** |
| Standard | ERC-20, 18 decimals |
| Total supply | **1,000,000,000**, minted once at deployment |
| Inflation | **None by design** — the project's stated model is a once-minted fixed supply (see §11.9: the token source is not in this repository, so this is a design statement, not a verified property) |
| Chain today | Robinhood Chain testnet, ID 46630 |
| Chain at mainnet | Robinhood Chain, ID 4663 (Arbitrum Orbit L2, ETH for gas) |
| Contract | `0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910` |

### 5.2 Where $DNG comes from and goes

**Source of rewards — a funded vault, not emission.** Summoning a knight costs **500 $DNG**.
Rewards come from one contract, `RewardVault`, funded by the 45% reward vault, summon fees,
capsule open fees, and Genesis mint proceeds converted into it. It releases a fixed weekly
budget with a hard ceiling per line, so **the pool cannot pay out what the project has not
put in** and cannot be drained inside a week. There is no mechanism to create $DNG for rewards, which
is the single most important sentence in this document for anyone reasoning about supply.

**Distribution** (published in full in `tokenomics.md` §2):

| Bucket | Share | Amount | Custody |
|---|---|---|---|
| **Reward vault** | **45%** | **450,000,000** | `RewardVault`, spent on claims |
| Liquidity | 30% | 300,000,000 | DEX pool, LP locked 12 months |
| Treasury | 15% | 150,000,000 | Multisig, quarterly release |
| Marketing / community | 10% | 100,000,000 | Multisig, no cliff, no vesting |
| Team | **0%** | — | none |

> Two consequences stated rather than discovered later. **There is no team allocation**, so
the 15% treasury is the only bucket funding operations and development. And **marketing is
the only unvested bucket**, so its spend cadence is disclosed publicly instead of enforced
by a lock.
>
> On testnet this distribution is a **plan, not a fact**. The 1,000,000,000 supply exists; the
> game's reward contract was funded ad hoc (5,000 $DNG, **811 remaining** as of
> 20 September 2026). The buckets above describe the mainnet intent.

### 5.3 Break-even math, in clears

Mint cost is 500 $DNG. Quoting ROI in **clears** rather than dollars is deliberate — a
token price cannot break this promise, only a reward table can.

| Rarity | Reward / clear | Clears to 500 | At full daily utilisation |
|---|---|---|---|
| Common | 12 | 42 | 8.3 days |
| Uncommon | 20 | 25 | 5.0 days |
| Rare | 36 | 14 | 3.5 days |
| Epic | 60 | 9 | 2.8 days |
| Legendary | 100 | 5 | 1.3 days |

Expected value of one fresh summon at the published drop rates, running every daily run:
`Σ p·reward·runs = 0.50·60 + 0.30·100 + 0.15·144 + 0.04·180 + 0.01·400 = **92.8 $DNG/day**` —
a payback of **5.39 days**, or **24.04 clears**, of full play on average, and considerably
longer if you do not run your knights every day. The economy is designed so that **squad
utilisation, not luck, is the dominant variable.**

Note the shape of that sum: it weights each tier's **daily capacity**, and it is a single
weighted total rather than `E[reward/clear] × E[runs/day]`. Multiplying the two averages
would say 99.01 $DNG/day, because the tiers that pay the most also get the most runs — the
two are correlated, and the product of averages is not the average of the product. The
harness asserts that the two really do differ, so staying with the weighted sum is a
decision rather than an accident.

**These figures are computed, not typed.** `lib/reward-config.js` and `lib/token-math.js`
derive every number in this section from the tier table in `lib/knights.js`, and
`tools/check-token-math.js` fails if this document and the code disagree. That harness exists
because they had already disagreed: this section used to quote an expected daily earning
fifteen per cent lower and a payback a third of a day longer, from a six-tier table whose
probabilities summed to **100.7%** and which predated the removal of Mythic. Nothing failed,
because the number lived in a sentence.

**The table is a maximum, not a promise.** Since the third revision these rates are the
*reference* table, and it is the first table in this project's history that cannot be paid
out in full by accident. The weekly budget is fixed and every payout is `table × epochScale`,
where the scale is settled each week from the burn the last week actually produced. More
players than the reference population means **one scale moves every number down together** —
the table stays exactly as published, at a lower level, and the interface shows the live
rate. `tokenomics.md` §3 has the mechanism and §8 has the horizon.

### 5.4 Daily limits as the anti-farm bound

Per-knight daily caps (5/5/4/3/4 runs) are enforced **on chain**, so even a perfect script
cannot exceed them. A 15-knight squad of Legendaries caps at 9,000 $DNG/day, and every
payout must be signed (V4) and must clear the reward-table check. That is the ceiling on
damage from any farming strategy short of breaking the contract.

But caps are no longer the main bound on a payout, and the third revision is explicit about
why. At the published rates an average knight can claim **33,872 $DNG a year** running every
daily cap, so a table left unbounded is a claim on the whole supply rather than a reward
schedule. Three things bound it now, in order of strength:

1. **The reward vault releases a fixed weekly budget**, `min(configured, balance / 12)`. The
   vault cannot pay a week it cannot fund, and it cannot outlive itself.
2. **Each of the four lines has a hard weekly ceiling.** A claim that would exceed its line
   reverts; see `tokenomics.md` §3.
3. **One published scale** moves every number together when participation exceeds the
   reference, so the ladder and the 90% staking rule survive at a lower level instead of
   being quietly broken.

The whole supply is **29,523 knight-years** of full play, which is enough runway that the
question is no longer whether the table can be paid — it is how long the project wants the
reference table to hold at scale 1.0, and that is a published horizon. Every figure in this
paragraph is derived in `lib/token-math.js`.

---

## 6. Architecture

### 6.1 Stack

Next.js 14 (App Router) · React 18 · a vanilla-JS canvas game engine (vendored, classic
scripts) · ethers.js v5 (pinned, offline-capable) · Vercel.

The engine is **reused, not rewritten**: the `/game` route renders the exact DOM the
original engine expects, injects the engine scripts, and re-fires `DOMContentLoaded` so
the engine boots itself. The React shell supplies routing, metadata and the wallet facade.
Server routes hold every secret; nothing sensitive ships to the browser.

### 6.2 The on-chain / off-chain split

| Layer | Owns |
|---|---|
| **Chain** | Ownership of knights, rarity, daily run caps, the reward table, payments, nonce replay protection |
| **Server** | Run timing, reward pricing, the signature, points records, leaderboard and history read from chain events |
| **Browser** | Rendering, input, local session state. **Trusted for nothing that costs money** |

### 6.3 The signed-run gate (the core integrity mechanism)

Three layers, in order:

**1 · Run tokens.** When a dungeon starts, the client asks for a token: an HMAC over
`address | knightIds | dungeonId | server start time`, base64url-encoded, 6-hour TTL. The
start time is the **server's**, so a browser cannot backdate a run.

**2 · Minimum time.** `minimumTime = max(30s, 300s / √knightCount)`, measured on the
server clock. One knight must be in the dungeon 5 minutes; fifteen, 77 seconds. This
mirrors the design note in `KNIGHT-SCALING.md`: √ scaling, because 2× knights is not 2×
speed.

**3 · Receipts.** On completion the server prices the run **from on-chain rarity** and
signs exactly:

```
keccak256(abi.encode(
  player, keccak256(abi.encodePacked(knightIds)),
  dungeonId, reward, nonce, expiry, block.chainid, contractAddress
))
```

signed as an EIP-191 personal message. The contract independently re-derives the reward
from on-chain rarity and requires it to equal the signed total, so a compromised or buggy
signer cannot overpay. The nonce is **single-use on chain** — which is why none of this
needs a database.

### 6.4 What this does and does not achieve

**Does:** no payout without a backend signature; no replay; the reward cannot exceed the
on-chain table; the minimum time is enforced on a clock the player does not control; the
legacy unsigned contract can be paused so both paths cannot be farmed at once.

**Does not:** prove a human watched. A bot that starts and finishes runs on schedule still
earns — but it must wait exactly as long as an honest player, and the on-chain daily caps
bound it either way. Proving gameplay is backend-verification work, not a contract change,
and it is on the roadmap rather than in the marketing copy.

---

## 7. Contracts

### 7.1 Live on Robinhood Chain testnet (chain ID 46630)

| Contract | Address | Notes |
|---|---|---|
| Dungeon Token ($DNG) | `0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910` | ERC-20, fixed 1,000,000 supply |
| RewardVault | *not deployed* | The funded pot and the four lines (`contracts/RewardVault.sol`) |
| Dungeon Knights (NFT) | `0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512` | ERC-721 `KNIGHT`, 500 $DNG per summon, 78 minted |
| DungeonKnightsGameV3-Simple | `0xD8de9385Db7DfE925882E76849B6e067e47236e5` | Batch claims, rewards, daily caps |

**V3-Simple in full:** rarity rewards 10/17/30/75/150 · daily caps 5/5/4/3/4 · day reset
12:00 UTC · max 50 runs per transaction · max 15 knights per run · `paused()` false ·
treasury **811 $DNG** · owner `0x038d75aD…4C9`.

Events: `DungeonCompleted(player, knightId, dungeonId, rarity, reward, timestamp)`,
`RewardsClaimed(player, amount, runsCount, knightCount)`, plus
`RarityRewardUpdated`, `DailyCapUpdated`, `PausedSet`.

**Ownership:** the game contract is owned by the deployer `0x038d75aD…4C9`. The NFT and
$DNG contracts are owned by `0x10FD6a06…9d50` — note that `CONTRACTS.md`'s claim that *all*
contracts share one owner does not hold today.

**Testnet activity so far:** 162 completed runs from 2 wallets, 12 claims, **4,189 $DNG
paid**, 38 distinct knights, across Mines (87), Magma (30), Temple (16), Void (15),
Crypts (14). First run 16 September 2026. This is a smoke test, and calling it traction
would be dishonest.

**Known weakness, by design of the fix that follows it:** V3 validates ownership, rarity
and the daily cap, and nothing else. It has no signature check, so the reward path is
only as trustworthy as the front end that calls it. That is precisely what V4 closes.

### 7.2 Written, tested, not deployed

**DungeonKnightsGameV4** — server-signed runs. Adds: signature verification against a
rotatable `trustedSigner`, single-use nonces, receipt expiry (max 1 day), on-chain reward
re-derivation with a `Reward mismatch` revert, EIP-2 low-s enforcement in a self-contained
recovery function, and `MAX_BATCH` 50 / `MAX_RUN_KNIGHTS` 15 retained. Deployment recipe
and a rollback path are in `docs/DEPLOY-GAME-V4.md`; the switch is the `GAME_CONTRACT_V4`
environment variable, and an empty value means the site keeps using V3.

### 7.3 Superseded lineage

| Contract | Fate |
|---|---|
| `DungeonKnightsGameV2.sol` | Superseded |
| `DungeonKnightsGameV3.sol` | Superseded by V3-Simple |
| `DungeonKnightsGameV3.1-RewardsOnly.sol` | Written, never deployed — no limits at all, rejected |
| `DungeonKnightsGameV3-Simple.sol` | **Live** |

### 7.4 Four earlier contracts, drained and disabled

The lineage above is not academic — the earliest versions were **exploited and emptied**,
and the recovery is where this project's trust model comes from. All four were drained and
disabled on 15 September 2026, with **320,339 $DNG recovered**.

| Address | Version | What went wrong |
|---|---|---|
| `0x45B905f6…0E17` | V1 | Self-signed rewards exploit |
| `0xb4cee9bA…1ec5` | V1 | Self-signed rewards exploit |
| `0xbA216A5f…797F` | V1 | Self-signed rewards exploit |
| `0xd6D40B6C…cFd5` | V2 | Stranded — 30-second cooldowns blocked claims |

**Do not interact with those addresses.** The V1 failure is the whole argument of this
paper in one incident: when the client signs its own rewards, the client *is* the
attacker, and the treasury is the loss ceiling. V3-Simple removed the client's ability to
invent runs; V4 removes the client's ability to invent *authorisation*.

### 7.5 Phase 2 contracts (specified, not yet written)

| Contract | Shape |
|---|---|
| **GenesisNFT** | ERC-721, fixed **1,024** supply, owner-minted, on-chain `hashPower` **300–1,000** (distribution published in [`GENESIS-HASH-POWER.md`](./GENESIS-HASH-POWER.md)) |
| **StakingContract** | Accepts Genesis only. `tickets = floor(min(stakedHours, 168) × hashPower)`. `stake` / `unstake` / `claimRewards` / `getRaffleTickets` |
| **RaffleContract** | Weekly draw, **200 capsules** per week, week boundary **Monday 00:00 UTC**, ticket ranges per entry |
| **CapsuleNFT** | ERC-1155, four capsule types, mintable only by the raffle, burns on open to reveal a knight |

### 7.6 Security posture

**Present:** OpenZeppelin `Ownable` and `ReentrancyGuard`; treasury balance checked before
every transfer; nonce burned before any external call; admin actions limited to reward
table, daily caps, pause, signer rotation, funding and withdrawal; every admin action
emits an event.

**Absent, and stated plainly:** **no third-party audit**, no timelock, no multisig in the
deployed testnet contracts (the owner is a single externally-owned wallet), and no
bug-bounty programme. Nothing here should be treated as audited code. Treat testnet
contract risk as real risk, and do not assume the mainnet deployment will look identical.

---

## 8. Delivery so far — Phase 1

| # | Shipped |
|---|---|
| 1 | Canvas engine: pathfinding, melee combat, stamina, five themed dungeons |
| 2 | Knight NFTs with a five-tier rarity roll, summoning chamber, 500 $DNG summons |
| 3 | Knight's Hall: roster, sort/filter, squad selection, up to 15 deployed |
| 4 | Monsters that fight back — themed attacks, 3-tile domains, facing, 2-tile beams, static chests, no double damage |
| 5 | Live on-chain rewards with daily caps, plus a claim record per wallet |
| 6 | **Hall of Fame and claim history read from real chain events** — no invented numbers |
| 7 | Points Program: three-floor Points Vault, referrals, share-to-double, leaderboard, once-a-day guards proven under concurrency |
| 8 | Arya the gate keeper across four moments, including holding the screen during dungeon load |
| 9 | Wallet facade with hardware-wallet and mobile path, plus a deployment switch |
| 10 | Staking Vault UI, complete and tested, pending its contracts |
| 11 | Verification harnesses: 100+ automated checks across contracts, points, logs, wallet routing and in-browser behaviour |

---

## 9. Phase 2 — Genesis, staking and the weekly raffle

**Genesis.** A fixed 1,024-knight collection, minted by the project and then distributed.
Each carries an on-chain `hashPower` between **300 and 1,000**, which is the only input to
staking yield besides time. The rule is deliberately simple to state: **1 hash power = 1
ticket per hour staked.** A 1,000-HP knight banks 1,000 tickets an hour, a 300-HP knight
exactly a third of that.

The distribution is **published before mint and machine-checked**: six bands, a bell with
a thin top, 64 knights at 900+, mean hash power 615.5, every count matching a test in
`tools/check-staking.js` so the promise cannot drift once knights are sold. Full tables —
tickets per hour, pool share and expected capsules per band — are in
[`GENESIS-HASH-POWER.md`](./GENESIS-HASH-POWER.md).

**Staking.** `tickets = floor(min(stakedHours, 168) × hashPower)`. The 168-hour (one week)
cap is deliberate: parking a knight forever must not be strictly better than playing, and
the cap is shown in the interface rather than hidden in a contract.

**Weekly raffle.** **200 capsules** are awarded each week, split in proportion to ticket
share. The week turns over **Monday 00:00 UTC**, computed from a fixed epoch so no
timezone disagrees about which week it is. For the minutes after the boundary, before the
draw has run, the interface says *Drawing…* rather than showing an expired countdown.

**Capsules.** Free to open — the prize is the knight, not a second purchase. Odds are shown
in the interface, every table sums to exactly 100, and **no table offers a tier the reward
contracts cannot pay**. Each rarer capsule raises the floor rather than only shifting weight:

| Capsule | Common | Uncommon | Rare | Epic | Legendary | Expected |
|---|---|---|---|---|---|---|
| Common | 60% | 25% | 10% | 4% | 1% | 78.3 DNG/day |
| Rare | — | 30% | 40% | 20% | 10% | 178.5 |
| Legendary | — | — | 20% | 40% | 40% | 354.0 |
| Prime | — | — | — | 30% | 70% | 487.5 |

The fourth capsule was specified as the *Mythic* capsule, handing out a tier with no reward
slot (see §11.1). It is now the **Prime Capsule** — named for the top hash-power band rather
than for a knight tier — and it draws only from the top of the real range. *Expected* is
`dungeonReward × dailyRuns` (a knight's earning power) weighted by the table; the ladder is
deliberately not steeper, because with five tiers the top rung has nowhere to climb but
Legendary. **How the 200 weekly capsules are split across these four types is still
undecided, and it is the number that actually sets this economy.**

**The weekly DNG pool is TBD and the product says so.** No official figure has been
published, so the interface shows `TBD` where a number would go and continues to show
everything that *is* known — your share of the pool, and a per-second entitlement that
ticks live. Setting the `WEEKLY_POOL_DNG` environment variable turns real numbers on
without a code change. **This is intentional: the project will not print a reward figure it
cannot yet fund.**

**Current state, stated honestly.** The staking interface is **live** and fully interactive
— live accrual, countdowns, expected capsule odds, keyboard-navigable tabs, designed empty
states — but it runs against **deterministic preview data** and wears a visible
**PREVIEW DATA** badge. No staking contract has been deployed, because the economics it
depends on (the weekly pool) are not final. The economics live in one file, so the moment
the pool is decided, the page becomes real without redesign.

---

## 10. Roadmap

**Phase 1 — core game and live rewards** · *shipped*
Five dungeons, five-rarity NFTs, on-chain claims with daily caps, points program, Arya,
verification harnesses. (§8)

**Phase 2 — Genesis, staking, raffle** · *in progress*
Write and deploy GenesisNFT, StakingContract, RaffleContract, CapsuleNFT; set the weekly
pool; convert the staking interface from preview to live. (§9)

**Phase 3 — mainnet** · *next*
Deploy V4, close V3, publish the signer and rotation policy; deploy to Robinhood Chain
mainnet (ID 4663); distribute supply per §5.2; lock LP; move ownership to a multisig or
timelock; commission the audit that has not happened yet.

**Phase 4 — depth**
Marketplace, equipment and upgrades as a token sink, guilds, seasons and resets,
leaderboard prizes, PvP tournaments, and backend verification of gameplay rather than of
timing alone.

---

## 11. Known gaps and open items

Disclosed because a whitepaper that hides these is worth less than the paper it is printed
on.

**11.1 — The Mythic reward slot.** *(Closed at the source, 20 Sep 2026.)* The engine could
roll six rarities while the reward contracts define five reward slots (indices 0–4), so a
knight that rolled Mythic would have failed the contract's rarity check on claim. The
engine, the shared config, the React helpers and the capsule tables now carry the same five
tiers, and `tools/check-rarity.js` fails if any of them drifts — including if a capsule ever
promises a tier with no reward slot. The **deployed** contracts are unchanged, but the trap
can no longer fire, because nothing can mint the sixth tier.

**11.2 — Conflicting reward tables.** *(Closed, 20 September 2026.)* `tokenomics.md` quoted
12 / 20 / 36 / 60 / 100 / 150 per clear against the **live contract's 10 / 17 / 30 / 75 /
150**, and §5.3 of this document quoted a daily expectation derived from an older, six-tier
probability set. One table is now canonical — the contract's — and `tokenomics.md` was
rewritten as v2.0 around it. The figures are no longer typed into prose: `lib/token-math.js`
derives them from `lib/knights.js` and `lib/staking-config.js`, and
`tools/check-token-math.js` fails if this document, the Genesis paper or `tokenomics.md`
disagrees with the code. It also fails if a contract's `RARITY_COUNT` stops matching the
tier count, which is how the missing sixth reward slot was caught.

**11.3 — Stale documentation.** The README's contract-address table and its `0.001 ETH`
testnet mint price are historical and no longer describe the live system, which charges
500 $DNG. Anyone reading the README first will be misled.

**11.4 — No audit.** §7.6. This is the largest single risk in the project, and it is not
theoretical: the V1 contracts were drained once already (§7.4).

**11.5 — Points are not a token.** Points are an off-chain record with no conversion
mechanism, no published ratio, and no guarantee of one. They should be treated as a
participation record.

**11.6 — Small testnet sample.** Two wallets have claimed on testnet. Nothing in §5 has
been stress-tested by a real population, and the anti-farm ceiling is a design argument,
not an observed fact.

**11.7 — Mainnet supply plan is unseeded.** The 35/30/15/10/10 distribution is a plan. No
liquidity exists, no LP is locked, and no vesting contract has been deployed.

**11.8 — One claim function in the live contract is unusable.** `claimRewards` (the
single-run convenience wrapper) calls `this.batchClaimRewards(...)`, which cannot pass its
own reentrancy guard. It reverts. Only `batchClaimRewards` works. The interface hides this
by always batching, but the broken selector is still callable and should be removed in the
next deployment. *(Source corrected 20 Sep 2026: `claimRewards` is deleted from
V3-Simple, so no new deployment inherits it. The deployed address still exposes the
reverting selector.)*

**11.9 — The $DNG token's source is not in this repository.** Its supply, symbol, decimals
and owner are verifiable on chain; whether a privileged mint function exists is **not**
verifiable from anything here. Until the token source is published, read §5.1's no-inflation
row as the project's design intent rather than a proven property. This is exactly the class
of claim the rest of this paper refuses to make.

**11.10 — The testnet reward pool is below the project's own target.** `CONTRACTS.md` sets
a treasury target of **25,000 $DNG** and describes the contract balance as the loss
ceiling. It stands at **811 $DNG**. At current daily caps the pool is the binding
constraint on payouts, not the reward table — which is honest, but should be refilled
before any public testnet push.

**11.11 — Ownership is a single externally-owned wallet, with no two-step transfer.**
`CONTRACTS.md` already lists `Ownable2Step` as a mainnet prerequisite. Until then, an owner
key compromise is an immediate, unilateral control of rewards, caps and treasury. *(Source
corrected 20 Sep 2026: every reward contract is now `Ownable2Step`, with immutable token
references and `SafeERC20`. The deployed V3-Simple still uses single-step `Ownable`.)*

**11.12 — Genesis has no contract, no price, and one unbudgeted promise.** Nothing in §9 is
on chain: `GenesisNFT.sol` does not exist, the mint price is undecided, and the weekly DNG
pool is `TBD`. Two consequences are quantified in `GENESIS-HASH-POWER.md` §6 and should be
read before mint: the capsule draw pays a knight roughly **0.2 capsules per week** once
1,024 are staked, and **free capsule opening mints 10,400 knights a year**, whose expected
claim capacity is **~299M DNG against a 1M supply**. That faucet is the largest
unquantified liability in the project.

**11.13 — The collection contract's mint odds are not in this repository.** §4.1's table is
asserted against the engine, the config, the React helpers and the reward contracts — every
one of which is in this repository. The **knight NFT itself** is not: `contracts/` holds the
five reward contracts and nothing else, so the roll that decides a minted knight's rarity
cannot be read here. That matters because the Summoning Chamber now prints §4.1's numbers as
*chances*, which asserts they are the contract's odds too. The on-chain sample (78 mints,
§4.1) is far too small to settle it. **Publishing the collection's source, or reading its
fixed odds off the bytecode, is required before §4.1 can be called the mint odds rather than
the engine's roll.**

**11.14 — Capsules minted knights and were free to open.** *(Closed, third revision.)* This
was the largest unbudgeted liability in the project: opening a capsule cost nothing, and the
raffle awards **200 capsules a week** — **10,400 knights a year**, each carrying a full year
of claim capacity, against a supply that could not pay them. The capsule *odds* were never the
problem (the four rungs are worth 86.6 / 163.6 / 260.8 / 334.0 $DNG a day and each raises the
floor); the problem was that odds decide which knight arrives, not whether anyone paid for it.

Three things bound it now, and the first is the one that matters. **Extra knights split a
fixed pot instead of creating new claims**, because the vault's four lines have hard weekly
ceilings — so the old compounding liability simply does not exist under a funded budget. On
top of that the open is **never free** (500 → 5,000 $DNG as the collection fills) and the
Knights collection has a **hard cap of 10,000**. At the cap each Knights line pays **5.0%** of
the reference table, and from about 5,746 knights the weekly opens alone cover the whole
Knights lines. All three figures are derived in `lib/reward-config.js` and asserted by
`tools/check-token-math.js`.

**11.15 — The weekly staking pool had no number, because it had no funding.** *(Closed, third
revision.)* The pool is no longer a `TBD`: it is the **Genesis staking line**, 26.71% of a
weekly budget the vault releases and can actually pay, and the interface shows real DNG figures
derived from the same file the contracts are deployed from.

The open question that replaced it is smaller and answerable. Holding the reference table at
scale 1.0 forever costs **73,586,240 $DNG a year**; capsule opens cover roughly 5.2M of it at
the reference and about 32.1M once the Knights collection passes 5,746, and the remainder has
to come from Genesis mint proceeds converted into the vault. **The mint price in ETH therefore
cannot stay open past this**, because it is what funds the table after the 6.1-year runway the
45% vault provides.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| Reward pool drain by scripted farming | On-chain per-knight daily caps, signed runs (V4), reward re-derived on chain. Bounded, not eliminated |
| Contract bug or exploit | OpenZeppelin primitives, `ReentrancyGuard`, pause switch, check-before-transfer. **Not audited**, and the V1 deployments were exploited once — the four drained addresses are listed in §7.4 and must never be reused |
| Reward pool exhausted before the economy matures | Contract balance is the loss ceiling, and it is the current binding constraint (811 $DNG, §11.10). Top-up cadence is an operational duty, not a code guarantee |
| Signer key compromise | Rotatable `trustedSigner`; a compromised signer cannot overpay past the on-chain table, only authorise runs that are capped anyway |
| $DNG price volatility | ROI is quoted in **clears**, never in USD, so a price move does not break a stated promise |
| Reward table set unsustainably | The vault releases `min(configured, balance / 12)` per week with a hard ceiling per line, so the budget cannot promise what it does not hold. At the published rates an average knight can claim 33,872 $DNG a year, so the whole supply is **29,523 knight-years** of play; the binding constraint is the weekly budget, not the table |
| Capsule faucet (§11.14) | **Bounded.** Extra knights split a fixed pot rather than creating claims, the open price is never zero (500 → 5,000), and the collection is capped at 10,000 — at which point each Knights line pays a computed 5.0% of reference |
| The reference population is a guess | Published rather than hidden, and the mechanism does not depend on it being right: above the reference one scale moves every number down together, and the interface shows the live rate |
| The live contract pays an older table | **Real, and recorded.** `DungeonKnightsGameV3-Simple` pays 10/17/30/75/150 and is what is deployed today; the published table takes effect with V4. `tools/check-rarity.js` asserts both tables and fails if this record disappears |
| A points-to-$DNG conversion appears | **Unmitigated by design** — there is no conversion, and `tools/check-token-math.js` asserts none has appeared. Wallets are free, so any conversion is an unbounded claim on a fixed supply |
| Off-chain scoring trust (points) | Server-signed sessions, HMAC tokens, once-a-day guards proven under concurrent load |
| Thin liquidity at mainnet | 30% of supply reserved for liquidity with a 12-month lock, as a requirement rather than a hope |

---

## 13. Closing

Most of the interesting work in this project is invisible when it is working. The dungeons
render, the monsters swing back, the chests stay put, and the DNG arrives — and none of
that is the point. The point is that when the DNG arrives, a signature proves which run
paid it, the contract proves the amount was the table's amount, the daily cap proves
nobody exceeded their allowance, and the timestamps prove the run took at least as long as
an honest one would.

Everything else — the staking vault, the raffle, the capsule odds — is designed to the
same standard: **publish the number, or say TBD.**

---

*Dungeon Knights Whitepaper v1.0 · September 2026. Figures verified against the live
testnet contracts and chain events on 20 September 2026. This document is a description of
software, not an offer, a solicitation, or financial advice; $DNG has no guaranteed value,
no audited contract, and no mainnet deployment. Verify every address before interacting.*
