# $DNG Tokenomics — v3.0

**September 2026 · the funded-budget revision**

> **Read this first.** Every number in this document is *derived* in `lib/reward-config.js`
> and `lib/token-math.js` from the tables in `lib/knights.js` and `lib/staking-config.js`.
> `tools/check-token-math.js` fails the build if this page and the code disagree, and it also
> asserts the shapes — that the line shares sum to 100%, that staking pays 0.9× playing inside
> each collection, and that no reward can be paid that the vault does not hold. Nothing below
> is a figure someone typed into a sentence.

---

## 1. What changed, and why

This is the third revision, and the first two failed in the same way.

**v1** published a six-tier table ending in Mythic. Every reward contract indexes five rarity
slots, so a Mythic knight had no reward slot and would have reverted on every claim. Its
`d1000` roll listed 650/200/100/45/12/3 — **1,010 faces on a thousand-sided die**.

**v2** fixed the tier count and cleaned up the arithmetic (12/20/36/60/100 per clear, 300 for
Genesis), but kept publishing **absolute** rewards without ever bounding the total. The bound
is the token supply, and it did not fit:

| Claim | Truth |
|---|---|
| A Genesis clear pays 300 $DNG | Fine in isolation. All 1,024 Genesis playing **one day** claimed **1,228,800** — more than the entire supply at the time |
| A Legendary clear pays 100 $DNG | A fresh summon recoups its 500 $DNG in 5 clears — 1.3 days |
| Opening a capsule cost nothing | 200 a week was **10,400 knights a year**, each carrying a full year of claim capacity |
| The weekly pool is "TBD" | It had no funding source, so it was not a number waiting to be chosen — it was a number that could not be paid |

Nothing in v2 said what would happen when more players arrived than the table had been sized
for, because nothing in v2 *could*. **v3 makes that the central mechanism.**

The idea is one sentence: **a funded weekly budget, a reference table, and one scale.**

---

## 2. The token

| Item | Value |
|---|---|
| Name / symbol | Dungeon Token / **$DNG** |
| Standard | ERC-20, 18 decimals |
| Total supply | **1,000,000,000** — one mint, no inflation mechanism |
| Chain today | Robinhood Chain testnet (ID 46630); mainnet ID 4663 |

**Distribution:**

| Bucket | Share | Amount | Custody |
|---|---:|---:|---|
| **Reward vault** | **45%** | **450,000,000** | `RewardVault`, spent on claims |
| Liquidity | 30% | 300,000,000 | DEX LP, 12-month LP lock |
| Treasury | 15% | 150,000,000 | Multisig, quarterly release |
| Marketing / community | 10% | 100,000,000 | Multisig, **no cliff, no vesting** |
| Team | **0%** | — | none |
| | **100%** | **1,000,000,000** | |

Two consequences stated here rather than discovered later:

- **There is no team allocation.** The 15% treasury is therefore the *only* bucket funding
  operations and development.
- **Marketing is the only unvested bucket.** There is no cliff to enforce and no lock to point
  at, so its spend cadence is disclosed publicly instead.

---

## 3. The reward vault — the whole mechanism

Every $DNG the game pays — dungeon clears and staking alike — comes out of one contract. It
enforces four rules, and between them they are the difference between v2 and v3.

**One budget.** The vault releases

```
weekly budget W = min(configuredWeeklyBudget, vaultBalance / 12)
```

per week. The second term is why **the vault can never outlive itself**: as it empties the
release shrinks automatically, and no owner action, no bug and no luck can drain it inside a
week. Twelve weeks is a quarter of runway, and it is a constant rather than a setting because
it is a safety property, not a tuning knob.

**Four partitioned lines.** `W` is split by fixed, published shares:

| Line | Share | Reference burn | Pays |
|---|---:|---:|---|
| Genesis dungeon | 29.68% | 60,000/day | 300/clear |
| Genesis staking | 26.71% | 54,000/day | 90% of playing |
| Knights dungeon | 22.95% | 46,400/day | 12/20/36/60/100 |
| Knights staking | 20.66% | 41,760/day | 90% of playing |
| | **100%** | **W = 1,415,120/week** | |

The shares are not invented: they are each line's share of the reference burn, and the
harness asserts they sum to exactly 1. Because **Genesis's share is permanent**, the
uncapped Knights collection can never dilute a promise made to Genesis buyers — which was
the concrete failure a single shared pool would have caused, with Genesis's slice falling
from 86% to 55% in five years and onward to nothing.

**A hard ceiling per line, per week.** A claim that would exceed its line reverts. This is
what turns v2's weakest assumption — that payouts would stay somewhere near the level the
table was sized for — into something the chain enforces rather than hopes for.

**One published scale.** `epochScale = min(1, W / lastWeekBurn)` is settled once a week from
the burn the last week actually produced. Every payout is `table × scale`, so when the crowd
is larger than the reference, **every published ratio survives at a lower level**: the tier
ladder, the 90% staking rule, and the split between the two collections all hold exactly. The
scale is capped at 1 on purpose — the published table is a **maximum**, never a promise to
exceed. When participation falls the lines go under-spent and the vault lengthens its own
runway, which is what a funded pool should do.

---

## 4. The reference week

The table is sized for a stated population: **50 Genesis Knights and 500 Knights active on a
given day** — about **5% of each collection**.

| | |
|---|---:|
| Genesis clears a week | 1,400 |
| Knights clears a week | 16,660 |
| Weekly budget `W` | **1,415,120 $DNG** |
| Daily budget | 202,160 $DNG |
| Genesis clear at scale 1.0 | **300 $DNG** |
| Knights clears at scale 1.0 | **12 / 20 / 36 / 60 / 100** |
| A staked Genesis, a week | 7,560 vs 8,400 from play — **90.0%** |
| A staked Knight, a week | 585 vs 650 from play — **90.0%** |

The published meaning of the reference, in one sentence: **the full table is payable to about
5% of each collection playing daily; above that one scale moves every number down together,
and the interface shows today's live rate.**

---

## 5. Knights — the reward table

Five tiers, one per on-chain reward slot. Odds are the roll; reward and runs are the table.

| Rarity | Roll | Reward / clear | Runs / day | Capacity | Hash power | Staked earns |
|---|---:|---:|---:|---:|---:|---:|
| Common | 50% | 12 | 5 | 60 | 15 | 90.0% |
| Uncommon | 30% | 20 | 5 | 100 | 25 | 90.0% |
| Rare | 15% | 36 | 4 | 144 | 36 | 90.0% |
| Epic | 4% | 60 | 3 | 180 | 45 | 90.0% |
| Legendary | 1% | 100 | 4 | 400 | 100 | 90.0% |

- **Expected reward per clear: 20.80 $DNG.** Expected runs per day: 4.76.
- **Expected earning: 92.8 $DNG a day**, or **33,872 a year**, for a fresh summon running
  every daily clear.
- **Payback on a 500 $DNG summon: 24.04 clears = 5.39 days** of full play.
- The **whole supply is 29,523 knight-years** of full play.

Note what that daily figure is *not*: it is `Σ p · reward · runs`, a single weighted total. The
product of the two averages would say 99.01, because the tiers that pay most also get the most
runs. The harness asserts the two really do differ, so this stays a decision rather than an
accident.

**Hash power is `capacity ÷ 4` for every tier**, and that is what makes the 90% rule uniform.
An earlier table (5 / 8 / 15 / 40 / 100) was not proportional to earning power: under it a
Legendary staker earned **2.1×** its own dungeon income passively while a Common earned
**0.7×**. Deriving the value from capacity removes the judgement call entirely.

---

## 6. Genesis — flat pay, variable passive income

Every Genesis Knight pays a flat **300 $DNG a clear, 4 runs a day = 1,200 a day**, whatever its
hash power. Hash power moves its **staking income only**, which is the collection's whole
design: identical for playing, differentiated for holding.

Because pay is flat and hash power is not, an individual knight's staking ratio varies while
the collection's average sits on **90%**:

| Band | Hash power | Staked earns, as a share of its own dungeon income |
|---|---:|---:|
| Spark | 300–424 | 52.9% |
| Ember | 425–549 | 71.2% |
| Forge | 550–674 | 89.5% |
| Radiant | 675–799 | 107.8% |
| Ascendant | 800–899 | 124.2% |
| Genesis Prime | 900–1,000 | 138.9% |

That spread is deliberate and published. The full distribution, the fairness rules and the
proof that the counts cannot drift are in [`GENESIS-HASH-POWER.md`](./GENESIS-HASH-POWER.md).

---

## 7. Capsules, and why the collection has a ceiling

The raffle awards **200 capsules a week**, to Genesis stakers only. Opening one costs a rising
amount and mints a Knight at the standard odds:

```
openPrice = 500 + 4,500 × (minted / 10,000)
```

so it runs **500 → 5,000 $DNG** as the collection fills toward its **10,000 hard cap**.

Under v2 opening a capsule cost nothing, which made it the project's largest unbudgeted liability:
10,400 knights a year against a supply that could not pay them. Two things fix it now — the
open is **never free**, and the collection has a **ceiling**, so the worst case is a number
rather than an open question:

- **Each Knights line pays 5.0% of reference at the cap** (4.64 dungeon + 4.18 staking a day
  against 176.32). That floor is computed and asserted, not estimated.
- **From about 5,746 Knights onward the weekly opens alone cover the whole Knights lines**
  (617,120 $DNG a week at the break-even price). The second half of the collection funds
  itself.

Capsule rungs, expected value of the Knight inside:

| Capsule | Floor | Expected |
|---|---|---:|
| Common | Common | 86.6 $DNG/day |
| Rare | Uncommon | 163.6 |
| Legendary | Rare | 260.8 |
| Prime | Epic | 334.0 |

---

## 8. The horizon, and the bill

| | |
|---|---:|
| Reward vault | 450,000,000 $DNG |
| Full table at the reference, funded for | **2,226 days = 6.1 years** |
| Absolute worst case — all 1,024 Genesis **and** all 10,000 Knights playing and staking | **4,097,920 a day → 110 days**, scale falling to 4.9% of the table |
| To hold the full table **forever** | **73,586,240 $DNG a year** |

That last row is the honest cost of the published table, and it is why the reference
population is stated rather than implied. Capsule opens contribute about 5.2M $DNG a year at
the reference and about 32.1M from roughly 5,746 Knights on. The rest has to come from
Genesis mint proceeds converted into the vault — **which is why the mint price cannot stay
open past this decision.**

---

## 9. What is not claimed

- **No audit.** The V1 contracts were drained once already. Treat contract risk as real.
- **The deployed testnet contract pays a different table.** `DungeonKnightsGameV3-Simple`
  pays **10 / 17 / 30 / 75 / 150** and is what is live today. The table in §5 takes effect
  with `DungeonKnightsGameV4`, which is written and not yet deployed. The site advertises the
  published table, so **until V4 is deployed the site is advertising rates the live contract
  does not pay** — stated plainly here because it is exactly the class of gap this project
  refuses to hide. `tools/check-rarity.js` asserts both tables and fails if the record of the
  divergence disappears.
- **The vault is not seeded.** 450,000,000 $DNG is the intended allocation, not a balance.
- **Points do not convert.** They are an off-chain record with no ratio and no mechanism, and
  the harness asserts none has appeared.
- **The reference population is a calibration, not a forecast.** Nobody knows how many knights
  will play. That is the point of publishing it: the table's honesty does not depend on the
  guess being right.

---

*Dungeon Knights tokenomics v3.0 · September 2026. Derived from `lib/reward-config.js` and
asserted by `tools/check-token-math.js`. This document describes software, not an offer, a
solicitation, or financial advice.*
