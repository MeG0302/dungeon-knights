# Genesis Hash Power — Distribution and Fairness Rules

**Version 1.0 · September 2026**

> **Status.** These are the rules we are prepared to be held to before a single Genesis
> Knight is minted. The distribution is **fixed, published and machine-checked** in the
> repository (`lib/staking-config.js`, asserted by `tools/check-staking.js`), so it cannot
> be altered after knights are sold without the change being visible in a commit and
> failing ten tests.
>
> **No GenesisNFT contract is deployed.** The mint price, the assignment transaction and
> the weekly DNG pool are still open — §9. Nothing in this document is on-chain yet.

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

The middle row is the whole system. A 1,000-HP knight banks 1,000 tickets an hour — 24,000
a day, 168,000 in a capped week. A 300-HP knight banks 300 an hour and 50,400 in a capped
week, **exactly one third as much**. Hash power is a yield multiplier, so the distribution
below is not a cosmetic trait: it is the split of every reward the vault will ever pay.

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

**The collection's expected mean hash power is 615.5** (total 630,320 across 1,024
midpoints). Because the band counts are fixed, the realised mean cannot wander far from
that: even in the impossible worst case where every knight landed on its band's floor the
mean would be 556, and at every ceiling 675. In practice it will sit on 615.5.

### Why this shape

A bell with a thin top is what makes the collection hold its value, and it is the honest
shape for a yield asset:

- **87% of knights sit in the middle four bands** (425–799) — the ordinary population, and
  the reason the mean lands near the range's middle rather than its floor.
- **Only 64 knights reach Genesis Prime (900+).** At 168 hours each banks 159,600 tickets.
  64 knights is 6.25% of the supply holding 9.6% of the collection's ticket power.
- **A 3.33× spread, not a 100× one.** The narrowest sensible band ratio keeps the collection
  tradeable: a Prime is worth 3.33 Spark knights in yield, not a different asset class.
  Early drafts of this range (1–100) implied a 100× spread, which would have made every
  non-top roll feel worthless and concentrated the entire raffle in a handful of tokens.

### How a specific knight gets its value — the part we are *not* promising

Rolls are **uniform inside a band**. We publish the **counts per band**, and that is the
promise. We do not publish, and cannot promise, which knight receives which band at mint,
because that depends on the assignment rule in §9.1.

The consequence is worth stating plainly to a buyer: **you cannot know your knight's hash
power before you mint it.** What you *can* know is the rate — 19.53% of knights are Spark,
6.25% are Genesis Prime, and the expected value of any one mint is the collection mean.

---

## 3. What each band earns

At the 168-hour cap, with the whole collection staked:

| Band | Tickets/hour | Tickets/day | Tickets/week | Share of the pool | Capsules/week | One capsule every |
|---|---:|---:|---:|---:|---:|---:|
| Spark | 362 | 8,688 | 60,816 | 0.0574% | 0.1149 | 8.7 weeks |
| Ember | 487 | 11,688 | 81,816 | 0.0773% | 0.1545 | 6.5 weeks |
| Forge | 612 | 14,688 | 102,816 | 0.0971% | 0.1942 | 5.1 weeks |
| Radiant | 737 | 17,688 | 123,816 | 0.1169% | 0.2338 | 4.3 weeks |
| Ascendant | 849 | 20,388 | 142,716 | 0.1348% | 0.2695 | 3.7 weeks |
| Genesis Prime | 950 | 22,800 | 159,600 | 0.1507% | 0.3014 | 3.3 weeks |

Tickets are shown at band midpoints. **Total tickets if all 1,024 staked at the cap:
105,893,760**, which is what the share column is measured against.

The average Genesis Knight — mid-band, 615.5 HP — holds **0.0976% of the weekly pool**.

---

## 4. The DNG pool: the one number still open

The pool is left `TBD` on purpose. The interface shows `TBD` rather than an invented
figure, and setting `WEEKLY_POOL_DNG` in the deployment turns every one of these cells
real with no code change. Here is exactly what each candidate pool pays a single knight
per week:

| Band | Pool share | 5,000 DNG | 15,000 DNG | 50,000 DNG | 350,000 DNG |
|---|---:|---:|---:|---:|---:|
| Spark | 0.0574% | 2.9 | 8.6 | 28.7 | 201.0 |
| Ember | 0.0773% | 3.9 | 11.6 | 38.6 | 270.4 |
| Forge | 0.0971% | 4.9 | 14.6 | 48.5 | 339.8 |
| Radiant | 0.1169% | 5.8 | 17.5 | 58.5 | 409.2 |
| Ascendant | 0.1348% | 6.7 | 20.2 | 67.4 | 471.7 |
| Genesis Prime | 0.1507% | 7.5 | 22.6 | 75.4 | 527.5 |

**Read this before choosing a pool size: staking cannot out-earn dungeon play, and it
should not try.** A Legendary summonable knight earns 150 DNG × 4 runs = **600 DNG a day,
4,200 a week**, from playing. For a single Genesis Prime to match that from staking, the
weekly pool would have to be **2.79 million DNG — nearly three times the entire token
supply.** The arithmetic is not a flaw to be fixed; it is what happens when a fixed 1,024
is split into a pool. Genesis staking is a **modest, passive share plus a real raffle
ticket**, not a wage, and it should be described that way.

---

## 5. The pool has to be funded, and by mints

$DNG has a fixed 1,000,000 supply and no emissions — dungeon rewards and staking rewards
are both paid from fees and reserves, not from new tokens. So a weekly pool is not a
setting, it is a **commitment with a required mint cadence** at 500 $DNG per summon:

| Weekly pool | Summons needed to fund it | Per year |
|---:|---:|---:|
| 5,000 DNG | 10 / week | 520 |
| 15,000 DNG | 30 / week | 1,560 |
| 50,000 DNG | 100 / week | 5,200 |
| 350,000 DNG | 700 / week | 36,400 |

The project has minted **78 knights in total**. A 15,000 DNG weekly pool alone demands 30
summons every week, forever, before dungeon rewards are counted at all. **The pool size
must be set against a mint cadence you can actually sustain**, and it is the single most
consequential number left in Phase 2.

---

## 6. Two findings that must be decided alongside this

Publishing hash power alone would be incomplete, because two other numbers decide whether
the vault is sustainable.

### 6.1 The capsule draw is thin, and that is arithmetic, not pessimism

**200 capsules a week across 1,024 stakers ≈ 0.2 capsules per knight per week.** The table
in §3 is the honest version of that: a Genesis Prime expects one capsule every 3.3 weeks;
a Spark, one every 8.7 weeks. Neither is wrong — it is what a fixed 200-capsule pot split
1,024 ways means — but it must be published, not discovered.

**Recommendation:** describe the raffle as a **lottery with published odds**, never as
yield, and let the DNG share be the passive reward. If the draw should feel less thin,
the lever is `CAPSULES_PER_WEEK`, and raising it is also raising the knight faucet in
§6.2 — so the two must move together.

### 6.2 Capsules mint free knights — and free knights are an unbounded claim

The stated design is that **capsules are free to open** (`CAPSULE_OPEN_COST_DNG = 0`) and
opening mints a new knight NFT. That is a second faucet into the collection whose only
gate today is the 500 $DNG summon price — and capsules bypass it.

| | |
|---|---:|
| Capsules per week | 200 |
| Free knights per year | **10,400** |
| Expected claim capacity per knight per year | **≈ 28,771 DNG** |
| Annual claim liability, full utilisation | **≈ 299,219,700 DNG** |
| Annual claim liability, 1% utilisation | **≈ 2,992,197 DNG** |
| Token supply, for comparison | **1,000,000 DNG** |

Claim capacity is `Σ(drop rate × reward × daily cap)` per day × 365, using the live
contract's table: **78.83 DNG/day per knight**. Even at **1% utilisation** — one run in a
hundred of the maximum — free capsules create claims worth **three times the entire token
supply, every year.**

**Recommendation:** set `CAPSULE_OPEN_COST_DNG` to the summon price (**500 $DNG**) or cut
capsule emission by one to two orders of magnitude. A paid open is the elegant fix,
because it restores exactly the funding gate that capsules currently bypass: the 500 DNG
re-enters the reward pool, and the capsule becomes a **rarity upgrade** rather than a free
knight. Capsules stay the prize; they stop being the leak.

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

**We do not promise:** which band a specific knight receives at mint (§9.1); the number of
capsules any individual knight wins, which is a draw; or the size of the weekly DNG pool,
which is **TBD and shown as TBD** until it is published here.

---

## 8. Where this lives in code

`lib/staking-config.js` holds the table, so the page, the API and the harness cannot
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
bands tile the range, `bandFor` round-trips and rejects out-of-range values, the pool
exposes one count per band, and 1 HP really does bank one ticket per hour. **A tampered
table fails the suite**: removing a knight, opening a one-wide gap, overlapping two bands,
or dropping the top band each fail a named check. That is what makes the §7 promises
enforceable rather than merely stated.

---

## 9. Open decisions

**9.1 How a knight receives its band.** The recommendation is a **mint-time draw from the
published counts** — draw a band, then roll uniformly inside it. It is verifiable, it makes
the §2 counts the only thing a buyer needs to trust, and it keeps value in the rarity
distribution rather than in transaction ordering. The alternative — assigning high rolls to
the earliest minters — turns mint into a race and makes the collection's value a function of
timing rather than of the asset. Whichever is chosen must be published before mint, because
it decides what a buyer is actually paying for.

**9.2 The weekly DNG pool** (§4) — the number the page is waiting on.

**9.3 `CAPSULE_OPEN_COST_DNG`** (§6.2) — currently **0**, which is the finding in §6.2.

**9.4 Genesis mint price** — still *to be revealed*, per the Phase 2 brief. It sets the
required mint cadence in §5, so it cannot stay open past the pool decision.

**9.5 Staking lock-up.** Whether a knight can be unstaked at any moment or after a minimum
period. Nothing in the current design locks it; tickets already cap themselves at a week,
so a lock-up would only be needed to stop last-minute enforcement of the draw.
