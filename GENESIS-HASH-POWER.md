# Genesis Hash Power — Distribution and Fairness Rules

**Version 2.0 · September 2026**

> **Status.** These are the rules we are prepared to be held to before a single Genesis Knight
> is minted. The distribution is **fixed, published and machine-checked** in the repository
> (`lib/staking-config.js`, asserted by `tools/check-staking.js`), so it cannot be altered
> after knights are sold without the change being visible in a commit and failing ten tests.
>
> **No GenesisNFT contract is deployed.** The mint price and the assignment transaction are
> still open — §9. Nothing in this document is on-chain yet.

---

## 1. The rule

| Item | Value |
|---|---|
| Collection size | **1,024** Genesis Knights |
| Hash power range | **300 – 1,000**, whole numbers only |
| Tickets banked | **1 HP = 1 ticket per hour staked** |
| Staking cap | **168 hours (7 days)** — tickets stop after that |
| Draw | Every **Monday 00:00 UTC**, 200 capsules |
| Only stakable asset | Genesis (the contract validates the collection address) |

The middle row is the whole system. A 1,000-HP knight banks 1,000 tickets an hour — 24,000 a
day, 168,000 in a capped week. A 300-HP knight banks 300 an hour and 50,400 in a capped week,
**exactly one third as much**. Hash power is a yield multiplier, so the distribution below is
not a cosmetic trait: it is the split of the Genesis staking line, which is in turn a fixed
share of the reward vault's weekly budget.

---

## 2. The distribution

Six bands, highest is scarcest, each count fixed before mint:

| Band | Hash power | Knights | Share of collection |
|---|---|---:|---:|
| **Spark** | 300–424 | 200 | 19.53% |
| **Ember** | 425–549 | 210 | 20.51% |
| **Forge** | 550–674 | 210 | 20.51% |
| **Radiant** | 675–799 | 200 | 19.53% |
| **Ascendant** | 800–899 | 140 | 13.67% |
| **Genesis Prime** | 900–1,000 | **64** | 6.25% |
| | **Total** | **1,024** | **100%** |

**The collection's expected mean hash power is 615.5** (total 630,320 across 1,024 midpoints),
derived from the band table itself rather than typed in. Because the band counts are fixed, the
realised mean cannot wander far: even in the impossible worst case where every knight landed on
its band's floor the mean would be 556, and at every ceiling 675.

### Why this shape

A bell with a thin top is what makes the collection hold its value, and it is the honest shape
for a yield asset:

- **87% of knights sit in the middle four bands** (425–799) — the ordinary population, and the
  reason the mean lands near the range's middle rather than its floor.
- **Only 64 knights reach Genesis Prime (900+).** At 168 hours each banks 159,600 tickets. 64
  knights is 6.25% of the supply holding 9.6% of the collection's ticket power.
- **A 3.33× spread, not a 100× one.** The narrowest sensible band ratio keeps the collection
  tradeable: a Prime is worth 3.33 Spark knights in yield, not a different asset class. Early
  drafts of this range (1–100) implied a 100× spread, which would have made every non-top roll
  feel worthless and concentrated the entire raffle in a handful of tokens.

### How a specific knight gets its value — the part we are *not* promising

Rolls are **uniform inside a band**. We publish the **counts per band**, and that is the
promise. We do not publish, and cannot promise, which knight receives which band at mint,
because that depends on the assignment rule in §9.1.

**You cannot know your knight's hash power before you mint it.** What you *can* know is the
rate — 19.53% of knights are Spark, 6.25% are Genesis Prime, and the expected value of any one
mint is the collection mean.

---

## 3. What each band earns

There are two separate incomes, and conflating them is how the previous revisions went wrong.

**Playing pays the same for every Genesis Knight: 300 $DNG a clear, 4 runs a day, 1,200 a day.**
Hash power has no effect on it at all.

**Staking pays by hash power**, out of the Genesis staking line. The line is 0.9× the Genesis
dungeon line, so across the collection staking pays **90%** of what playing does. Individually,
a band's ratio varies because the pay is flat and the multiplier is not:

| Band | Tickets/hour | Tickets/week | Staked earns, vs the same knight's 8,400 from playing |
|---|---:|---:|---:|
| Spark | 362 | 60,816 | 52.9% |
| Ember | 487 | 81,816 | 71.2% |
| Forge | 612 | 102,816 | 89.5% |
| Radiant | 737 | 123,816 | 107.8% |
| Ascendant | 849 | 142,716 | 124.2% |
| Genesis Prime | 950 | 159,600 | 138.9% |

Tickets and ratios are shown at band midpoints; the count-weighted mean across the collection is
exactly **90%**, and `tools/check-token-math.js` asserts that with the counts applied, not by
averaging six midpoints.

Because the pay is flat, the ratio depends on how many knights are *staked* as well: stake alone
and your share of the line is larger. The interface shows the realised ratio for the current
week rather than a fixed promise.

---

## 4. The staking line is not a TBD any more

Previous revisions left the weekly pool blank and printed `TBD`, because there was no funding
source to set it from. The third revision derives it:

```
weekly budget W  =  min(configuredWeeklyBudget, vaultBalance / 12)
Genesis staking line  =  26.71% of W
```

The share is not invented — it is the Genesis staking burn at the reference population divided
by the total reference burn, and it is asserted to sum with the other three lines to exactly
100%. At the reference (50 Genesis and 500 Knights active daily, about 5% of each collection)
`W = 1,415,120 $DNG` a week and the Genesis staking line is **377,978 $DNG a week**. At scale
1.0 a fully-staked Genesis Knight earns **7,560 $DNG a week**, which is 90% of the 8,400 it
would earn from playing.

**Read this before choosing a staking strategy: staking and playing are deliberately
comparable, not identical.** Playing also carries the daily caps and needs the game open;
staking needs neither. The two together roughly double a knight's income, which is the
intended shape — an active player is paid for playing, and a holder is paid for holding.

---

## 5. The vault has to be funded, and the vault says so

$DNG has a fixed 1,000,000,000 supply and no emissions — dungeon rewards and staking rewards
are both paid from the reward vault, not from new tokens. The vault holds the **45%** bucket,
**450,000,000 $DNG**, and pays at most `balance / 12` a week. So a weekly pool is not a
setting, it is a **commitment with a required funding cadence**:

| | |
|---|---:|
| The table at the reference, funded for | **2,226 days (6.1 years)** |
| Absolute worst case — every knight plays and stakes | **110 days** |
| To hold the full table **forever** | **73,586,240 $DNG a year** |

The worst case is computable, which is the point: at 4,097,920 $DNG a day with all 1,024
Genesis and all 10,000 Knights playing and staking, the scale falls to 4.9% of the table and
the vault still cannot be emptied in less than 110 days. Capsule opens contribute about 5.2M
$DNG a year at the reference and about 32.1M once the Knights collection passes roughly 5,746,
so the remainder is Genesis mint proceeds converted into the vault — **which is why the mint
price cannot stay open past this decision.**

---

## 6. Two findings that must be read alongside this

### 6.1 The capsule draw is thin, and that is arithmetic, not pessimism

**200 capsules a week across 1,024 stakers ≈ 0.2 capsules per knight per week.** A Genesis
Prime expects one capsule every 3.3 weeks; a Spark, one every 8.7 weeks. Neither is wrong — it
is what a fixed 200-capsule pot split 1,024 ways means — but it must be published, not
discovered.

**Recommendation, now adopted:** the raffle is described as a **lottery with published odds**,
never as yield, and the DNG share is the passive reward. If the draw should feel less thin the
lever is `CAPSULES_PER_WEEK`, and raising it also raises the knights faucet — so the two must
move together.

### 6.2 Capsules mint knights, and they are no longer free

The design that made this the project's largest unbudgeted liability was that capsules were
**free to open** and opening mints a knight. 200 a week is **10,400 knights a year**, each
carrying a full year of claim capacity. Three things now bound that:

1. **The open is never free.** The price rises 500 → 5,000 $DNG as the collection fills.
2. **The collection has a hard cap of 10,000.** At the cap each Knights line pays **5.0%** of
   the reference table — computed in `lib/reward-config.js` and asserted, not estimated.
3. **From about 5,746 Knights the weekly opens cover the whole Knights lines**, so the second
   half of the collection funds itself.

Knight earning power, for comparison: **92.8 $DNG a day** expected for a fresh summon running
every daily clear, **33,872 a year** — the same figure the whitepaper quotes, derived from the
same table.

---

## 7. What we promise, and what we do not

**We promise** — each of these is fixed before mint and machine-checked:

| Promise | Enforced by |
|---|---|
| Exactly 1,024 Genesis Knights | `GENESIS_SUPPLY`, asserted |
| Band counts exactly as published in §2 | asserted, sums to 1,024 |
| Hash power always inside 300–1,000 | asserted on every band |
| Bands tile the range with **no gap and no overlap** | asserted |
| 1 HP = 1 ticket per hour, stated once in code | `ticketsPerHour`, asserted |
| Tickets stop at 168 hours | asserted |
| Draw at Monday 00:00 UTC from a fixed epoch | asserted across timezones |
| Capsule odds per type, each summing to 100% | asserted |
| Staking pays 90% of playing across the collection | asserted with band counts |
| Genesis's share of the reward budget never falls | four fixed line shares, asserted to sum to 100% |
| The vault can never release more than it holds | `balance / 12`, in the contract |

**We do not promise:** which band a specific knight receives at mint (§9.1); the number of
capsules any individual knight wins, which is a draw; or that the weekly scale will stay at
1.0, which depends on how many people play. The scale is **published every week** and the
interface shows today's live rate, which is the honest version of a table this size.

---

## 8. Where this lives in code

`lib/staking-config.js` holds the band table, so the page, the API and the harness cannot
disagree about it:

```js
export const HASH_POWER_BANDS = [
    { key: 'spark',     name: 'Spark',         lo: 300, hi: 424,  count: 200 },
    { key: 'ember',     name: 'Ember',         lo: 425, hi: 549,  count: 210 },
    { key: 'forge',     name: 'Forge',         lo: 550, hi: 674,  count: 210 },
    { key: 'radiant',   name: 'Radiant',       lo: 675, hi: 799,  count: 200 },
    { key: 'ascendant', name: 'Ascendant',     lo: 800, hi: 899,  count: 140 },
    { key: 'prime',     name: 'Genesis Prime', lo: 900, hi: 1000, count: 64 },
];
```

`tools/check-staking.js` asserts ten properties of it — the counts fill the collection, the
bands tile the range, `bandFor` round-trips and rejects out-of-range values, the pool exposes
one count per band, and 1 HP really does bank one ticket per hour. **A tampered table fails the
suite**: removing a knight, opening a one-wide gap, overlapping two bands, or dropping the top
band each fail a named check. That is what makes the §7 promises enforceable rather than merely
stated.

The staking ratio is derived in `lib/token-math.js` from this same table —
`genesisMeanHashPower()` reads the midpoints and counts, so the 615.5 above is not a constant
that can go stale if a band moves.

---

## 9. Open decisions

**9.1 How a knight receives its band.** The recommendation is a **mint-time draw from the
published counts** — draw a band, then roll uniformly inside it. It is verifiable, it makes the
§2 counts the only thing a buyer needs to trust, and it keeps value in the rarity distribution
rather than in transaction ordering. The alternative — assigning high rolls to the earliest
minters — turns mint into a race and makes the collection's value a function of timing rather
than of the asset. Whichever is chosen must be published before mint.

**9.2 Genesis mint price** — still *to be revealed*. It now sets the required funding cadence in
§5, because the vault's 450,000,000 funds the table for 6.1 years and the ongoing cost is
73,586,240 $DNG a year. It cannot stay open past the mint.

**9.3 Staking lock-up.** Nothing in the current design locks a knight; tickets already cap
themselves at a week, so a lock-up would only be needed to stop last-minute enforcement of the
draw.
