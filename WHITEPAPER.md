# Dungeon Knights — Whitepaper

**Version 2.0 · September 2026**

An NFT idle-RPG where knights you own clear dungeons you watch, and every reward is a
signed, on-chain fact rather than a number the browser made up.

- **Public site:** https://dungeonknights.io
- **The game:** https://dungeon-knights.vercel.app (app.dungeonknights.io once its DNS record lands)
- **Code:** https://github.com/MeG0302/dungeon-knights
- **Network today:** Robinhood Chain **testnet**, chain ID 46630

> **Status.** The full contract set in §7 is deployed on testnet, and the site reads and
> writes it. The reward vault holds its published 45% allocation on chain, the backend
> signer is a key of its own (not the owner), and knights can be summoned, staked,
> unstaked and claimed against the live deployment. The 1,024 Genesis Knights have not
> been minted; their price in ETH is set at mint on OpenSea. There has been **no
> third-party security audit** and **no mainnet deployment**. Every claim below is
> labelled **Live**, **Written** or **Planned**, and any number that is not decided is
> marked **TBD**.

---

## 1. Abstract

Idle and blockchain games share a credibility problem: the player is asked to believe a
number. The game says you earned 40 tokens, the token appears, and nothing anywhere
proves a dungeon was played or that the payout was the amount the rules promised.

Dungeon Knights is built the other way round. The game itself is a full canvas engine
(five themed dungeons, pathfinding knights, monsters that fight back, chests that open
when killed) and the reward layer sits behind a server that times every run on its own
clock, prices it from on-chain rarity, and signs exactly that one run. The contract
re-derives the price and refuses anything the signature did not authorise.

Two collections sit on top of that engine. **Knights** are summonable, uncapped, and
earned by playing. **Genesis Knights** are fixed at 1,024, minted once, and earned by
staking: hash power decides their passive share of the vault and their raffle tickets,
while both collections play the same dungeons for the same published table.

Everything else follows from one decision: **rewards are not minted.** A funded vault
releases a fixed weekly budget, four lines partition it, and every published rate is the
table times one weekly scale. The token cannot be inflated to pay a promise, so the
promise is stated in ratios that survive whatever level the vault can actually fund.

---

## 2. The problem

1. **Unverifiable rewards.** Most "play to earn" front ends decide what you earned and
   then ask the chain to pay it. The chain has no opinion, so the game has no integrity.
2. **ROI promises that ignore supply.** A reward table is meaningless without stating
   where the tokens come from. If rewards are minted, the promise is inflation.
3. **Opaque odds.** Drop rates, capsule outcomes and raffle chances are usually hidden,
   which is exactly where they should be readable. Here they are published tables, and
   the code asserts them.
4. **Testnet fatigue.** Projects ship a pretty front end and no working loop. Here the
   loop came first: knights pathfind, fight and die, and have since the first build.

---

## 3. What Dungeon Knights is

A player owns ERC-721 **knights**, forms a squad of up to **15**, picks one of **five
dungeons**, and watches the squad fight through it on a canvas. Clearing pays **$DNG**,
subject to per-knight daily limits. A gatekeeper character, **Arya**, walks the player
through each surface the first time it is opened.

Two hostnames, two jobs: the public site carries the campaign, and the game lives on its
own host behind the Kingdom Gate while the project is still in its early phase.

| Route | Surface | What it does |
|---|---|---|
| `dungeonknights.io/` | Landing | Two doors: the Points Program and the Genesis waitlist |
| `/genesis` | Genesis Knights | The collection in full: supply, hash-power bands, captures, and the waitlist |
| `/points` | **Points Program** | Points Vault run, daily share, one-time tasks, referrals, leaderboard, Hall of Fame |
| `/portfolio` | Portfolio | $DNG, Knights, Genesis, points and recent activity for the connected wallet |
| `/hub` | **Hall of Fame** | All-time claims read from real chain events |
| `/mint` | **Summoning Chamber** | Summon knights for 500 $DNG, and open capsules |
| `/menu` | **Knight's Hall** | Roster, sort/filter, squad selection, DNG balance |
| `/dungeons` | Dungeon select | Five maps with difficulty, monsters and themes |
| `/game` | Battle | The canvas engine: knights, monsters, chests, attacks |
| `/staking` | **Staking Vault** | Genesis staking with raffle tickets, Knights staking for yield, real reads and writes |
| `/tokenomics` | Tokenomics | The economy as the API serves it, derived from one file |

---

## 4. Game design

### 4.1 Knights, rarity and the two collections

**Five** rarities, one per on-chain enum slot (0–4), rolled once. Multipliers affect
**gameplay stats only**; reward amounts are table-fixed per rarity.

The odds below are the single published table. `tools/check-rarity.js` asserts it against
the engine, the shared config, the React helpers, the collection contract that mints them,
and each reward contract's constructor, so the interface cannot advertise a tier or a
number the contracts do not pay:

| Rarity | Roll | Power × | Base speed | Reward / clear | Daily runs | Max DNG / day | Hash power |
|---|---|---|---|---|---|---|---|
| Common | 50% | 1.0 | 1.0 | 12 | 5 | 60 | 15 |
| Uncommon | 30% | 1.7 | 1.7 | 20 | 5 | 100 | 25 |
| Rare | 15% | 3.0 | 3.0 | 36 | 4 | 144 | 36 |
| Epic | 4% | 7.5 | 7.5 | 60 | 3 | 180 | 45 |
| Legendary | 1% | 15.0 | 15.0 | 100 | 4 | 400 | 100 |

The rolls sum to exactly 100%, which matters: `rollRarity()` accumulates the percentages
and falls through to Common for anything past the last entry, so a table that summed to
less than 100 would quietly promote a phantom tier rather than fail. An earlier six-tier
table advertised a sixth tier that could never be rolled and had no reward slot to be paid
from; §11 records the closure.

**Hash power is `dailyCapacity ÷ 4` for every tier.** That identity is what makes staking
pay exactly 90% of playing across the whole collection (see §5.6). A hand-typed set
(5 / 8 / 15 / 40 / 100) was not proportional to earning power, so a Legendary staker
earned 2.1× its own dungeon income passively while a Common earned 0.7×. Deriving the
value from capacity removes the judgement call, and `tools/check-rarity.js` asserts the
identity in every table that carries it.

Stats: `power = (10 + rand·15) × multiplier × variance(0.8–1.2)`,
`stamina = (300 + rand·100) × multiplier`. Squad cap **15**. Melee only, 1s attack
cooldown, monsters 500 HP, loot chests 250 HP.

**Two collections, two jobs.**

| | **Knights** | **Genesis Knights** |
|---|---|---|
| Supply | Uncapped; minted by summon and by capsules | Fixed at **1,024** |
| How you get one | Summon for 500 $DNG, or open a capsule | Mint at launch (price in ETH, set on OpenSea), then the secondary market |
| Rarity | Five tiers, rolled | Six hash-power bands, 300–1,000 |
| Dungeon reward | The tier table above | **Flat for every knight** |
| Staking | Yield only | Yield **and** raffle tickets |
| What decides value | The tier it rolled | The hash power it was born with |

The Knights collection has **no supply cap**. The published size of 10,000 is a
**reference point** the economy is stated against (capsule pricing, per-knight payout
ratios), never a limit on minting.

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

- **Monsters act.** Monsters fight back with the themed attack above, and they **walk 2
  tiles off their mean position** when idle, returning when done.
- **Domains and aggro.** A monster only attacks when a knight is inside its domain, a
  **3-tile radius, all directions**. It **faces the knight that entered**.
- **Short beams.** Attacks are emitted from the mouth and never exceed **2 tiles** in any
  direction, drawn slim.
- **No interleaving.** Knights and monsters never occupy or mix into the same tile space.
- **Left and right only.** Knights engage monsters horizontally, never vertically, so the
  fight reads clearly on screen.
- **Off-beat.** Knight and monster attacks are deliberately staggered; they never land on
  the same frame.
- **Chests are static.** Loot chests do not walk, do not aggro, and open only when their HP
  is depleted. They are scenery with a health bar, not combatants.
- **No double damage.** An attack animation (beam, whip, or vomit) is **presentation
  only**. It applies no damage beyond the damage already modelled, exactly as before the
  animation existed. This is a deliberate design rule, not an oversight.

### 4.4 Arya, the dungeon gate keeper

A hand-drawn character who appears from the lower middle of the screen with an expression
matched to the moment, and a line of dialogue written for that moment:

| Trigger | What she does |
|---|---|
| Entering the Points Program (first time automatically, afterwards on **Ask Arya**) | Walks the whole page: what points are, connect wallet, sign once, clear the vault, share to double |
| Entering the Staking Vault (first time; afterwards on request) | Explains the two sides of the vault, tickets and the weekly pool |
| Map selected, dungeon loading | Holds the screen while monsters, knights and art finish preloading, so the player never sees the placeholder map or an empty board |
| Dungeon cleared | Celebrates the clear and the reward |
| Knight minted | Welcomes the new recruit, in her own voice rather than a browser alert |
| Returning from the game to the Knight's Hall | Hands the player back to squad management |

She is a functional guide, not a decoration: her walkthrough is what makes a wallet prompt
legible to someone who has never seen one.

### 4.5 The Points Program

Points are a **participation record with no conversion mechanism** (§5.8). The program is
designed so every visible number is either checked or labelled as reviewed.

**Binding an X account.** A wallet binds one X account, and only one: the binding is
permanent and cannot be handed back, because a single X account bound to two wallets would
be a farm. Earning requires a binding; a run cleared without one is refused. A wallet that
joined the game before the campaign can attach an invite code later, and so can an
inviter's referee.

**The Points Vault.** A three-floor dungeon, reachable only from inside the Points
Program, playable with five **dummy epic knights** granted for the run (not NFTs, not your
knights). It clears in roughly 20–25 seconds and runs on its own map.

| Floor | Name | Points |
|---|---|---|
| 1 | Vault Entrance | 100 |
| 2 | Treasury Hall | 300 |
| 3 | Inner Sanctum | 500 |
| | **Entry total** | **900** |

Flow: clear a floor, choose **Move to Next Dungeon**; on the third floor choose **Exit**
(take the points) or **Share on X**, which doubles the whole entry to **1,800 PTS**. Once
a day per wallet, reset at UTC midnight, with the share claim guarded so concurrent
requests cannot double-pay. Deploy, recall and exit are available from inside the vault.
The share is a tagged post carrying the campaign image, so the timeline shows the run
rather than a bare link.

**One-time tasks.** A tab of tasks that pay once per wallet, ever. Each carries a button,
its reward, and a note about what is actually checked. The first is a follow of
@DNGrobinhood; four more are quote-reposts of campaign posts, each paid separately because
each is a separate post to quote. Follow and quote claims are **reviewed before they are
credited** (typically within 30–45 minutes, with the deadline shown on the card) so a
throwaway account cannot be paid instantly; the review window is visible, not silent.

**Referrals.** Every wallet gets a **five-character invite code** at first entry, shown
with both links (site and X post). A referral earns **15%** of a first-degree referee's
points and **5%** of a second-degree's, credited as the referee earns. Codes are unique,
and attaching one after playing is supported because a player who arrives through the
front door is still someone's referee.

**Leaderboard and Hall of Fame.** The leaderboard is read from the points store; the Hall
of Fame reads claim events from chain, so "all-time claimed" is a fact rather than a
total the page keeps.

**Storage.** Points live in a shared key-value store (permanent across deployments and
restarts), with a file driver for local development. Sessions are HMAC-signed tokens
issued after a wallet signature, so a wallet cannot be impersonated by editing a request.

---

## 5. Economy — $DNG

### 5.1 Token parameters

| Item | Value |
|---|---|
| Name / symbol | Dungeon Token / **$DNG** |
| Standard | ERC-20, 18 decimals |
| Total supply | **1,000,000,000**, minted once at deployment |
| Inflation | **None.** The token source is in this repository (`contracts/DNGToken.sol`) and carries no privileged mint after construction |
| Chain today | Robinhood Chain testnet, ID 46630 |
| Chain at mainnet | Robinhood Chain, ID 4663 (Arbitrum Orbit L2, ETH for gas) |
| Contract (live set) | `0x3D94e56E0d967633830f6d9E42CE43A64FFfD6Ca` |

The first token deployed (`0xA8D54F6F…`) is retired; nothing in the game pays in it any
more (§7.2).

### 5.2 Where $DNG comes from and goes

**Rewards are released from a funded vault, not minted.** Summoning a knight costs
**500 $DNG**. Rewards come from one contract, `RewardVault`, which holds the 45% reward
allocation and is topped up by summon fees, capsule open fees and Genesis mint proceeds
converted into it. It releases a fixed weekly budget with a hard ceiling per line, so the
pool **cannot pay out what the project has not put in** and cannot be drained inside a
week.

At the reference population the weekly budget is **1,415,120 $DNG**, partitioned across
four lines in fixed shares. The shares are derived from the lines themselves, rounded to
basis points so they sum to exactly 10,000 (the vault rejects anything else):

| Line | Share of the weekly budget | Basis points |
|---|---|---|
| Genesis dungeon claims | 29.68% | 2968 |
| Genesis staking yield | 26.71% | 2671 |
| Knights dungeon claims | 22.95% | 2295 |
| Knights staking yield | 20.66% | 2066 |

Two rules bound the vault beyond the budget itself:

- **`min(configured, balance / 12)`.** No week may be released that would leave the vault
  funded for fewer than twelve more weeks at that rate, so the vault cannot outlive
  itself.
- **One scale.** Each week the scale is settled from the burn the last week actually
  produced: `epochScale = min(1, budget / lastWeekBurn)`. The published table is the
  **maximum**, never exceeded; when participation rises above the reference, one scale
  moves every published number down together, so the tier ratios and the 90% staking rule
  survive at whatever level is fundable. The interface shows the live rate.

**Distribution** (the vault's share is written into the contract; the rest is a plan until
custody is split, §11):

| Bucket | Share | Amount | Custody |
|---|---|---|---|
| **Reward vault** | **45%** | **450,000,000** | `RewardVault`, spent on claims |
| Liquidity | 30% | 300,000,000 | DEX pool, LP locked 12 months |
| Treasury | 15% | 150,000,000 | Multisig, quarterly release |
| Marketing / community | 10% | 100,000,000 | Multisig, no cliff, no vesting |
| Team | **0%** | — | none |

> Two consequences stated rather than discovered later. **There is no team allocation**,
> so the 15% treasury is the only bucket funding operations and development. And
> **marketing is the only unvested bucket**, so its spend cadence is disclosed publicly
> instead of enforced by a lock.

The vault's 45% is not a promise: the deployed vault holds it. The other three buckets sit
in the deployer wallet today, and moving them is an ordinary ERC-20 transfer (§11).

### 5.3 Break-even math, in clears

Mint cost is 500 $DNG. Quoting ROI in **clears** rather than dollars is deliberate: a token
price cannot break this promise, only a reward table can.

| Rarity | Reward / clear | Clears to 500 | At full daily utilisation |
|---|---|---|---|
| Common | 12 | 42 | 8.3 days |
| Uncommon | 20 | 25 | 5.0 days |
| Rare | 36 | 14 | 3.5 days |
| Epic | 60 | 9 | 2.8 days |
| Legendary | 100 | 5 | 1.3 days |

Expected value of one fresh summon at the published drop rates, running every daily run:
`Σ p·reward·runs = 0.50·60 + 0.30·100 + 0.15·144 + 0.04·180 + 0.01·400 = **92.8 $DNG/day**`,
a payback of **5.39 days**, or **24.04 clears**, of full play on average, and considerably
longer if you do not run your knights every day. Squad utilisation, not luck, is the
dominant variable.

Note the shape of that sum: it weights each tier's **daily capacity**, and it is a single
weighted total rather than `E[reward/clear] × E[runs/day]`. Multiplying the two averages
would say 99.01 $DNG/day, because the tiers that pay the most also get the most runs; the
two are correlated, and the product of averages is not the average of the product. The
harness asserts the two really do differ, so the weighted sum is a decision rather than an
accident.

**These figures are computed, not typed.** `lib/reward-config.js` and `lib/token-math.js`
derive every number in this section from the tier table in `lib/knights.js`, and
`tools/check-token-math.js` fails if this document and the code disagree. That harness
exists because they had already disagreed: this section once quoted an expected daily
earning fifteen per cent lower and a payback a third of a day longer, from a six-tier
table whose probabilities summed to **100.7%**. Nothing failed, because the number lived
in a sentence.

### 5.4 Daily limits, the budget and the horizon

Per-knight daily caps (5/5/4/3/4 runs) are enforced **on chain**, so even a perfect script
cannot exceed them. A 15-knight squad of Legendaries caps at 9,000 $DNG/day, and every
payout must be signed and must clear the reward-table check.

Three things bound a payout, in order of strength:

1. **The weekly budget** released by the vault, capped at `balance / 12`.
2. **A hard weekly ceiling per line.** A claim that would exceed its line reverts.
3. **One published scale** that moves every number together when participation exceeds the
   reference.

The reference population is **50 Genesis and 500 Knights active on a given day**, which is
about 5% of each collection. It is published because it is the honest way to state which
population the table is sized for: *the full table is payable to about 5% of each
collection playing daily, and above that the scale falls in proportion.* At that reference
the vault's 450,000,000 lasts **2,226 days, about 6.1 years**. Holding the table at scale
1.0 forever costs **73,586,240 $DNG a year**.

If everyone played and staked at once, the burn would be 4,097,920 $DNG/day and one weekly
scale would settle every payout at about **34.5%** of the published table, with the vault
still solvent on its own horizon. That is the mechanism working, not failing.

### 5.5 Genesis income

Genesis Knights are paid **flat**: a fixed reward per clear and four runs a day for every
one of the 1,024, so playing income does not depend on the band a knight landed in. Hash
power moves **passive** income only (staking yield and raffle tickets), which is the whole
point of the collection's design: every Genesis knight is equally valuable for playing, and
the bands distinguish them where the collection says they should be distinguished.

### 5.6 The staking rule

Staking pays **90% of what the same knight earns by playing**, stated as a ratio inside each
collection rather than as an amount. At matched participation both sides come out at
exactly 90.0%; when the two diverge (everyone stakes and nobody plays), the realised ratio
moves and the interface shows it.

`tickets = floor(min(stakedHours, 168) × hashPower)` for Genesis. The 168-hour (one week)
cap is deliberate: parking a knight forever must not be strictly better than playing, and
the cap is shown in the interface rather than hidden in a contract.

Because both staking lines are fixed shares of the budget, a growing Knights collection
divides them among more knights: at the reference-size boundary a Knight earns **5.0%** of
its reference payout, and lower beyond it. There is no floor to quote because there is no
ceiling on the collection; the ratio is a function of size, and the page shows the size it
was computed for.

### 5.7 Capsules

Capsules are ERC-1155 tokens minted **only by the raffle** (200 a week, §9) and opened in
the Summoning Chamber. Opening **burns the capsule and mints one Knight**.

**Opening is never free, and its price rises with the collection.** The fee ramps from
**500 $DNG** at zero knights to **5,000 $DNG** at the reference size, then stays flat. The
crossover is worth knowing because it is the point from which the faucet funds itself:
**from roughly 5,746 knights on, the 200 weekly opens alone cover the whole Knights
lines.**

All four capsule types draw only from tiers the reward contracts can pay, and each raises a
player's **floor** rather than only shifting weight. Every table sums to exactly 100:

| Capsule | Common | Uncommon | Rare | Epic | Legendary | Expected yield |
|---|---|---|---|---|---|---|
| Common Capsule | 60% | 25% | 10% | 4% | 1% | 86.6 $DNG/day |
| Rare Capsule | — | 30% | 40% | 20% | 10% | 163.6 $DNG/day |
| Legendary Capsule | — | — | 20% | 40% | 40% | 260.8 $DNG/day |
| Prime Capsule | — | — | — | 30% | 70% | 334.0 $DNG/day |

*Expected yield* is `reward × dailyRuns` per tier, weighted by the table. The ladder is
deliberately not steeper: with five tiers the top rung has nowhere to climb but Legendary,
and a Prime that were all Legendary would make every other capsule worthless.

The fourth capsule was specified as a tier that has no reward slot to be paid from (see
§11). It is now the **Prime Capsule**, named for the top hash-power band rather than for a
knight tier, and it draws only from the top of the real range. **The split of the 200
weekly capsules across the four types is still TBD**, and it is the number that sets this
part of the economy; nothing in the model assumes a split.

### 5.8 Points are a closed loop

Points are an off-chain record with no conversion mechanism, no published ratio and no
guarantee of one. `tools/check-token-math.js` asserts that nothing in the repository
converts points to $DNG, and fails if a conversion function appears. Wallets are free, so
any conversion would be an unbounded claim on a fixed supply.

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
| **Chain** | Ownership of knights, rarity, hash power, staking positions, raffle tickets, daily run caps, the reward table, payments, nonce replay protection |
| **Server** | Run timing, reward pricing, the signature, points records, waitlist records, leaderboard and history read from chain events |
| **Browser** | Rendering, input, local session state. **Trusted for nothing that costs money** |

### 6.3 The signed-run gate (the core integrity mechanism)

Three layers, in order:

**1 · Run tokens.** When a dungeon starts, the client asks for a token: an HMAC over
`address | knightIds | dungeonId | server start time`, base64url-encoded, 6-hour TTL. The
start time is the **server's**, so a browser cannot backdate a run.

**2 · Minimum time.** `minimumTime = max(30s, 300s / √knightCount)`, measured on the server
clock. One knight must be in the dungeon 5 minutes; fifteen, 77 seconds. This mirrors the
design note in `KNIGHT-SCALING.md`: √ scaling, because 2× knights is not 2×
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
signer cannot overpay. The nonce is **single-use on chain**, which is why none of this
needs a database.

`DungeonKnightsGameV4` is **deployed and live**; the server signer is a dedicated key that
holds no admin rights (§7).

### 6.4 Staking reads, and staking writes

The Staking Vault reads the wallet's **real holdings** from the collections on chain, the
same read path the game uses, so a wallet's actual knights appear rather than a fixture. It
can send **approve, stake, unstake and claim** transactions against the deployed staking
contracts.

Honesty about state is a design rule, not a badge that follows a deployment: a side whose
staking contract is not configured says it is a preview, because a plan against an empty
address is a button that cannot do anything. `lib/staking-config.js` holds the flag that
says the interface can send (`STAKING_WRITES_READY`, asserted by
`tools/check-staking.js` so it cannot be flipped without the transaction path behind it),
and the snapshot requires the contract address as well as the flag. Fixing one constant
cannot make a deployment look live that is not.

### 6.5 Points integrity

- **Sign-in is a signature.** The server issues a nonce, the wallet signs it, and the signer
  is recovered. What comes back is a small HMAC-signed token the browser stores and sends
  as a bearer header. Both halves are stateless; the store only records points.
- **One payout per event, ever.** Vault runs, the daily share, the follow claim and each
  quote-repost are guarded once per wallet (and once per X account for the follow), with
  concurrency proven under load rather than assumed.
- **One X account, one wallet.** The binding is permanent; there is no unbind, because an
  unbind is a farm.
- **The store is shared and permanent.** Points survive restarts and deployments; the local
  file driver exists for development only.
- **Every claim says what was checked.** A task card states what is verified and what is
  reviewed before credit; the review deadline is shown.

### 6.6 What this does and does not achieve

**Does:** no payout without a backend signature; no replay; the reward cannot exceed the
on-chain table; the minimum time is enforced on a clock the player does not control; the
legacy unsigned contract can be paused so both paths cannot be farmed at once; the vault
cannot pay beyond its budget or its runway.

**Does not:** prove a human watched. A bot that starts and finishes runs on schedule still
earns, but it must wait exactly as long as an honest player, and the on-chain daily caps
bound it either way. Proving gameplay is backend-verification work, not a contract change,
and it is on the roadmap (§10).

---

## 7. Contracts

### 7.1 The live set (Robinhood Chain testnet, chain ID 46630)

Nine contracts, deployed one step at a time by `tools/deploy-phase2.js`, which compiles
in-process, reads each contract's published numbers back and **refuses to continue if any
of them disagree with `lib/`**, then does the wiring as separate steps. Constructor
arguments are derived from `lib/`, never typed.

| Contract | Address | Role |
|---|---|---|
| `RewardVault` | `0x6Cc2cA52F24Df5fE752e2792E1acA8783413e0Cc` | Holds the 45% reward allocation; releases the weekly budget across four lines |
| `DNGToken` | `0x3D94e56E0d967633830f6d9E42CE43A64FFfD6Ca` | ERC-20, fixed 1,000,000,000 supply |
| `GenesisKnights` | `0xbd99CD46dd42472fAA7667d5c782eEbe0Abe9e5d` | ERC-721, 1,024 supply, on-chain hash power |
| `GenesisStaking` | `0x173cED7aeb1F0F6871c5110112Ade6f61106D7FD` | Genesis stake/unstake/claim; raffle tickets |
| `Knights` | `0x27Cfbb763188a50Fe1C0fFfBe2552b1945eE1B2D` | ERC-721, uncapped, summon and capsule mint |
| `Capsules` | `0x628ae2254fFE4aeC68D13b1E46E5628CCcbD2728` | ERC-1155 capsules, mintable only by the raffle, burns on open |
| `KnightsStaking` | `0x27fBBba5feCD0Bc4a83d51b4f2832a13c6E0a627` | Knights stake/unstake/claim; yield only |
| `RaffleContract` | `0xc26360C6CC4B67720558F71fB32Dc413e27E5b4C` | Weekly draw, 200 capsules, ticket ranges per entry |
| `DungeonKnightsGameV4` | `0xD60FfCb1df8ce1163e0a5137651E98BDC0Acd8a8` | Signed dungeon runs, reward re-derivation, daily caps |

Owner of all nine: `0x038d75aDb74d8e5Db82E6c6797f90dCdF82ef4C9` (the deployer). The backend
signer is a separate key, `0x69EF5fF256051DE3edF1AA64Efe10eDD6C2d643C`, which holds
`trustedSigner` and no admin role, so the key that signs runs cannot move the economy.

**State on chain today:** the vault holds the full **450,000,000 $DNG** allocation; the
Knights collection holds **23 knights** minted in the repaired set; the Genesis collection
holds **0**, because minting has not opened.

### 7.2 Lineage, retirements and the drained contracts

The lineage is not academic. The earliest versions were **exploited and emptied**, and the
recovery is where this project's trust model comes from. All four were drained and disabled
on 15 September 2026, with **320,339 $DNG recovered**.

| Address | Version | What went wrong |
|---|---|---|
| `0x45B905f6…0E17` | V1 | Self-signed rewards exploit |
| `0xb4cee9bA…1ec5` | V1 | Self-signed rewards exploit |
| `0xbA216A5f…797F` | V1 | Self-signed rewards exploit |
| `0xd6D40B6C…cFd5` | V2 | Stranded: 30-second cooldowns blocked claims |

**Do not interact with those addresses.** The V1 failure is the whole argument of this
paper in one incident: when the client signs its own rewards, the client *is* the attacker,
and the treasury is the loss ceiling. V3 removed the client's ability to invent runs; V4
removed the client's ability to invent *authorisation*.

**Superseded, and recorded on purpose.** `DungeonKnightsGameV3-Simple`
(`0xD8de9385Db7DfE925882E76849B6e067e47236e5`) pays the older table
**10 / 17 / 30 / 75 / 150** with caps 5/5/4/3/4 and is no longer what the site uses. It is
still callable and still unpaused, and it holds 384 $DNG of the **retired** first token
(`0xA8D54F6F…`). Closing it is a pause and a withdrawal (§11). Its reward numbers are shown
here because a repo whose source disagrees with the bytecode it produced should say so:
`tools/check-rarity.js` asserts both the published table on V4 and the divergence recorded
in this paragraph.

**The mint defect, kept because the reasoning matters.** The first Phase-2 deployment
shipped `Knights` and `Capsules` without the line that pulls the player's $DNG in before
funding the vault, so `summon()` asked the *collection* for money it had never held and
reverted with `ERC20InsufficientBalance`. Every capsule prize needs the raffle, the raffle
needs staked Genesis, and the collection could not be filled by any route until it was
fixed. Because `Capsules.knights`, `RaffleContract.capsules`, `GameV4.knightNFT` and
`StakingPool.collection` are `immutable`, the repair moved five contracts to new addresses
(the table in §7.1 is the repaired set). `DNGToken`, `RewardVault`, `GenesisKnights` and
`GenesisStaking` kept their state untouched, including the vault's allocation.

Two findings from that incident are now permanent checks. `tools/check-contracts.js`
asserts that every function which funds the vault pulls from `msg.sender` first, and the
summoning path applies a **gas buffer** to its estimate, because the first real summon
reverted out of gas: a Common roll writes zero into a zero slot (cheap) while any other
tier writes a fresh value (expensive), so an estimate taken against one block's randomness
can be ~20k short of the transaction that lands.

### 7.3 Security posture

**Present:** OpenZeppelin `Ownable2Step`, `SafeERC20`, `ReentrancyGuard`; immutable
cross-contract references; treasury balance checked before every transfer; nonce burned
before any external call; EIP-2 low-s enforcement in the signature recovery; receipt
expiry; admin actions limited to the reward table, daily caps, pause, signer rotation,
funding and withdrawal, each emitting an event. The owner key and the run-signing key are
separate.

**Not yet present, and this is the largest single risk in the project:**
**no third-party audit**, no timelock, no multisig (the owner is a single externally-owned
wallet), and no bug-bounty programme. These are Phase 3 items, and the V1 history above is
why they are treated as prerequisites rather than polish.

---

## 8. Delivery so far

| # | Shipped | State |
|---|---|---|
| 1 | Canvas engine: pathfinding, melee combat, stamina, five themed dungeons | Live |
| 2 | Knight NFTs with a five-tier rarity roll, Summoning Chamber, 500 $DNG summons | Live |
| 3 | Knight's Hall: roster, sort/filter, squad selection, up to 15 deployed | Live |
| 4 | Monsters that fight back: themed attacks, 3-tile domains, facing, 2-tile beams, static chests, no double damage | Live |
| 5 | On-chain rewards with daily caps, signed runs, and the funded vault behind them | Live |
| 6 | Hall of Fame and portfolio reads from real chain events | Live |
| 7 | Points Program: vault run, daily share, one-time tasks, referrals, leaderboard, permanent store | Live |
| 8 | Arya the gate keeper across six moments, including holding the screen during dungeon load | Live |
| 9 | Wallet facade with hardware-wallet and mobile paths, plus Privy embedded wallets | Live |
| 10 | Staking Vault: real holdings, live accrual, tickets, capsule odds, and a real transaction path | Live |
| 11 | Genesis page: collection, bands, captures, waitlist, and the Google Form the list also lands in | Live |
| 12 | Two hostnames: public campaign site and a password-gated game host | Live |
| 13 | Verification harnesses: 29 suites under `tools/`, covering contracts, the economy, points, staking, routing and in-browser behaviour | Live |

---

## 9. Phase 2 in full — Genesis, staking and the raffle

**Genesis.** A fixed 1,024-knight collection. Each carries an on-chain `hashPower` between
**300 and 1,000**, which is the only input to staking yield besides time. The rule is
deliberately simple to state: **1 hash power = 1 ticket per hour staked.** A 1,000-HP
knight banks 1,000 tickets an hour; a 300-HP knight exactly a third of that.

The distribution is **published before mint and machine-checked**: six bands, a bell with a
thin top, 64 knights at 900+, mean hash power 615.5, every count matching a test in
`tools/check-staking.js` so the promise cannot drift once knights are sold. Full tables
(tickets per hour, pool share and expected capsules per band) are in
[`GENESIS-HASH-POWER.md`](./GENESIS-HASH-POWER.md).

**Staking.** One pool per collection, and they are not interchangeable: Genesis stakes for
yield **and** raffle tickets, Knights for yield alone. `tickets = floor(min(stakedHours,
168) × hashPower)`. The 168-hour cap is shown in the interface rather than hidden in a
contract.

**The weekly raffle.** **200 capsules** are awarded each week, split in proportion to
ticket share, to staked Genesis knights only. The week turns over **Monday 00:00 UTC**,
computed from a fixed epoch so no timezone disagrees about which week it is. For the
minutes after the boundary, before the draw has run, the interface says *Drawing…* rather
than showing an expired countdown. At full Genesis participation a knight wins roughly
**0.2 capsules per week**, one every five weeks on average; the per-band tables are in the
Genesis paper.

**Capsules.** Minted only by the raffle, opened in the Summoning Chamber at the rising fee
in §5.7, burning the capsule and minting one Knight of the rolled tier. Odds are shown in
the interface, every table sums to exactly 100, and **no table offers a tier the reward
contracts cannot pay**.

**The weekly pool has a number, because it has funding.** Staking is not a separate
promise: it is the Genesis staking line (26.71%) and the Knights staking line (20.66%) of
the weekly budget the vault releases, and the interface shows DNG figures derived from the
same file the contracts were deployed from.

---

## 10. Roadmap

**Phase 1 — core game and live rewards** · *shipped*
Five dungeons, five-rarity NFTs, on-chain claims with daily caps, Points Program, Arya,
portfolio and Hall of Fame. (§8)

**Phase 2 — Genesis, staking, raffle, capsules** · *shipped*
The nine-contract set in §7 is deployed, wired and used by the site. Remaining inside the
phase: open the Genesis mint (price in ETH, decided at mint on OpenSea) and settle the
capsule-type split. (§9, §11)

**Phase 3 — mainnet** · *next*
Deploy the set to Robinhood Chain mainnet (ID 4663); split the remaining supply into its
published buckets, lock LP, and move ownership to a multisig with a timelock; publish the
signer rotation policy; commission the audit that has not happened yet.

**Phase 4 — depth**
Marketplace, equipment and upgrades as a token sink, guilds, seasons and resets,
leaderboard prizes, PvP tournaments, and backend verification of gameplay rather than of
timing alone.

---

## 11. Open items

Disclosed because a whitepaper that hides these is worth less than the paper it is printed
on. Each item is either dated or marked TBD, and closed items are recorded in §11.11.

1. **The Genesis mint has not happened.** Zero of 1,024 are minted, and the price in ETH is
   TBD; the mint runs on OpenSea, not on an in-app page. The waitlist on `/genesis` is open
   and stores both the email and the EVM address, mirrored into the team's Google Form.
2. **No audit, no multisig, no timelock.** §7.3. Phase 3.
3. **Three-quarters of the supply sits in one wallet.** Only the vault's 45% was required
   at construction; the liquidity, treasury and marketing buckets are still in the deployer
   wallet pending custody setup. Moving them needs no redeployment.
4. **The legacy contract is not paused.** `DungeonKnightsGameV3-Simple` still exposes its
   unsigned claim path and holds 384 $DNG of the retired first token. Closing it is
   `pause()` plus a withdrawal, one owner transaction; until then it is a documented open
   door to a token nothing else uses.
5. **The capsule-type split is TBD** — how the 200 weekly capsules divide across the four
   types. Nothing in the model depends on it, and the page does not invent it.
6. **`app.dungeonknights.io` does not resolve yet.** The apex redirects game paths to it, so
   until the DNS record lands, the working game address is
   `dungeon-knights.vercel.app`. The gate stays on that host, which is where the X webhook
   is registered.
7. **Follow and quote claims are reviewed, not instant.** The review window (30–45 minutes,
   shown on the card) keeps a throwaway account from being paid on the spot. The codebase
   carries the X-API verification path as well; it is not enabled in production today.
8. **The reference population is a judgement call, published.** 50 Genesis and 500 Knights
   active on a given day sets the budget. The mechanism does not depend on it being right:
   above the reference, one scale moves every number down together and the interface shows
   it.
9. **Knights staking thin out as the collection grows.** Both Knights lines are fixed
   shares of the budget, so a Knight's staking yield falls as the collection grows. This is
   intentional (extra knights split a fixed pot rather than creating new claims), and it is
   the honest alternative to an unfunded promise.
10. **The table's long-run funding depends on the mint.** Capsule opens cover 5.2M of the
   73,586,240 $DNG a year at the reference and about 32.1M once the collection passes
   5,746; the remainder has to come from Genesis mint proceeds converted into the vault.
   That is why the mint price matters beyond the mint.
11. **Closed since v1.0**, recorded so the history stays legible: the sixth-tier reward slot
   with no place to be paid (removed at the source and asserted); conflicting reward tables
   in three documents (one canonical model, harness-asserted); the unbounded capsule faucet
   (bounded by the budget, the never-free open and the risen open price); the weekly pool
   with no number (it is a line of the budget); the token source and the collection source
   not being in this repository (both are, and both are asserted); and the staking
   interface running on preview data (it reads and writes the live set).

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| Reward pool drain by scripted farming | On-chain per-knight daily caps, signed runs, reward re-derived on chain, weekly budget with per-line ceilings. Bounded, not eliminated |
| Contract bug or exploit | OpenZeppelin primitives, `ReentrancyGuard`, pause switch, check-before-transfer, separate owner and signer keys. **Not audited**, and the V1 deployments were exploited once; the four drained addresses are in §7.2 and must never be reused |
| Reward pool exhausted before the economy matures | The vault cannot release a week that shortens its runway below 12 weeks, and the scale mechanism moves every payout together rather than breaking a promise. Funding cadence is an operational duty |
| Signer key compromise | Rotatable `trustedSigner`; a compromised signer cannot overpay past the on-chain table, and it holds no admin role |
| $DNG price volatility | ROI is quoted in **clears**, never in USD, so a price move does not break a stated promise |
| Capsule faucet | Extra knights split a fixed pot instead of creating new claims, the open price is never zero and rises with the collection, and from ~5,746 knights the weekly opens cover the Knights lines outright |
| The live legacy contract pays an older table | **Recorded.** `DungeonKnightsGameV3-Simple` pays 10/17/30/75/150 and is not what the site uses; V4 pays the published table. `tools/check-rarity.js` fails if this record disappears |
| A points-to-$DNG conversion appears | Unmitigated by design: there is no conversion, and the harness asserts none has appeared |
| Off-chain scoring trust (points) | Server-issued nonces, HMAC sessions, once-per-wallet and once-per-account guards proven under concurrent load, permanent shared store |
| Thin liquidity at mainnet | 30% of supply reserved for liquidity with a 12-month lock, as a requirement rather than a hope |
| Wallets are free, so Sybils are cheap | One X account binds to one wallet permanently, and the points paid per account are one-time. Points carry no conversion, so the incentive to Sybil is bounded by the leaderboard rather than by a payout |

---

## 13. Closing

Most of the interesting work in this project is invisible when it is working. The dungeons
render, the monsters swing back, the chests stay put, and the DNG arrives. None of that is
the point. The point is that when the DNG arrives, a signature proves which run paid it,
the contract proves the amount was the table's amount, the daily cap proves nobody
exceeded their allowance, and the timestamps prove the run took at least as long as an
honest one would.

Everything else, the vault, the raffle, the capsule odds, the points program, is designed
to the same standard: **publish the number, or say TBD, and let a harness fail if the
two ever drift apart.**

---

*Dungeon Knights Whitepaper v2.0 · September 2026. Addresses and balances in this document
were read from the Robinhood Chain testnet on 22 September 2026. This document is a
description of software, not an offer, a solicitation, or financial advice; $DNG has no
guaranteed value, no audited contract, and no mainnet deployment. Verify every address
before interacting.*
