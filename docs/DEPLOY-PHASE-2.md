# Phase 2 — deploying the full contract set

The contract set the published economy actually needs, in the order it has to go down, with
the arguments derived rather than typed.

```
npm run check:contracts        # compiles every contract and checks it against lib/
npm run check:opcodes          # proves the chain runs the opcodes we compile to
node tools/deploy-phase2.js --list     # the nine steps, their arguments, predicted addresses
node tools/deploy-phase2.js            # deploy every remaining step, verifying each
node tools/deploy-phase2.js --verify   # read-only re-check of the whole set
npm run deploy:args            # every constructor argument, as text, derived from lib/
```

`tools/deploy-phase2.js` is the deployer. It compiles in-process with the same settings as
`foundry.toml`, deploys **one contract per step**, reads each one's published numbers back and
refuses to continue if any of them disagree with `lib/`, then does the wiring as separate
steps. Progress is written to `deployed-phase2.json`, so a re-run resumes and `--verify`
re-checks without sending anything.

## What is deployed on chain 46630

| contract | address | replaced 21 Sept |
|---|---|---|
| `RewardVault` | `0x6Cc2cA52F24Df5fE752e2792E1acA8783413e0Cc` | |
| `DNGToken` | `0x3D94e56E0d967633830f6d9E42CE43A64FFfD6Ca` | |
| `GenesisKnights` | `0xbd99CD46dd42472fAA7667d5c782eEbe0Abe9e5d` | |
| `GenesisStaking` | `0x173cED7aeb1F0F6871c5110112Ade6f61106D7FD` | |
| `Knights` | `0x27Cfbb763188a50Fe1C0fFfBe2552b1945eE1B2D` | was `0xFB738bE6…d4c5` |
| `Capsules` | `0x628ae2254fFE4aeC68D13b1E46E5628CCcbD2728` | was `0x8772ee6f…8926` |
| `KnightsStaking` | `0x27fBBba5feCD0Bc4a83d51b4f2832a13c6E0a627` | was `0x5B17C62E…EcD2` |
| `RaffleContract` | `0xc26360C6CC4B67720558F71fB32Dc413e27E5b4C` | was `0x56A25ddB…5c7f` |
| `DungeonKnightsGameV4` | `0xD60FfCb1df8ce1163e0a5137651E98BDC0Acd8a8` | was `0xF0727532…d895` |

Owner of all nine: `0x038d75aDb74d8e5Db82E6c6797f90dCdF82ef4C9` (the deployer).

**Five contracts were replaced on 21 September**, by `tools/redeploy-mint-fix.js`, for the reason
set out in *Defect in the first deployed set* below: `Knights` and `Capsules` each shipped without
the line that collects a player's DNG, and because `Capsules.knights`, `RaffleContract.capsules`,
`GameV4.knightNFT` and `StakingPool.collection` are all `immutable`, a repaired collection drags
four contracts with it. The four that were **not** replaced — the vault, the token, and both
Genesis contracts — kept their state untouched, including the vault's 450M DNG. The retired
addresses above are recorded so nobody re-adopts one by accident; nothing in this project points
at them any more.

Three things about this deployment were unfinished at deploy time. Two are now closed and one is
a decision rather than an omission:

1. **The backend signer has been rotated off the owner key.** The constructor trusted the
   deployer, which meant the key that signs runs also held `setPayer`, `setLineBps` and
   `withdrawTokens` — one server compromise would have taken the whole economy. A fresh key was
   generated (`0x69EF5fF256051DE3edF1AA64Efe10eDD6C2d643C`), `game.setTrustedSigner(...)` was sent
   from the owner, and the private key lives only in the deployment's `GAME_SIGNER_PRIVATE_KEY`
   (Vercel secret) and the local `.env.local`. The owner key no longer signs anything the site
   produces. Rotating again is one owner transaction plus one env change.
2. **55% of the token is in the deployer wallet**, not in liquidity, treasury or marketing
   custody — the three bucket holders were not known at deploy time. Redistributing is an
   ordinary ERC-20 transfer, so nothing needs redeploying; only the vault's 45% had to be
   right at construction, and it is.
3. **The site reads and writes this deployment.** The switch is done: `/api/staking/config` and
   `/api/game/config` serve these addresses, `STAKING_WRITES_READY` is `true`, and the vault's
   approve/stake/unstake/claim path sends real transactions. The one thing that did *not* work
   when this was written was minting — see *Defect in the first deployed set* below, now fixed.

`check-v4.js` is green on the new game contract except one line, which is real:

```
FAIL  V3 is paused  — the unsigned claim path is still open
      V3 still holds 811.0 DNG
```

The old unsigned claim path is still callable. Closing it is `pause()` on
`0xD8de9385Db7DfE925882E76849B6e067e47236e5`, followed by `withdrawAllTokens()` if the 811 DNG
should move.

## Defect in the first deployed set — nothing could be minted

> **Fixed and replaced on 21 September.** Five contracts were redeployed with the one-line repair,
> by `tools/redeploy-mint-fix.js`: `Knights` `0x27Cfbb76…1B2D`, `Capsules` `0x628ae225…2728`,
> `RaffleContract` `0xc26360C6…5b4C`, `KnightsStaking` `0x27fBBba5…a627`, `DungeonKnightsGameV4`
> `0xD60FfCb1…d8a8`. The old five are retired and nothing points at them. Everything below is the
> diagnosis as it was found, kept because the reasoning is what makes the repair legible.
>
> **Verified on chain, not by reading the source.** `summon()` as deployed fails with
> `ERC20InsufficientBalance(0xfb738be6…)` — the vault asking the *collection* for money it has never
> held. The repaired collection fails the same call with
> `ERC20InsufficientAllowance(spender 0x27Cfbb76…1B2D, allowance 0, needed 500e18)` — the collection
> asking **the player's** allowance for the fee, which is what the page collects. Then, with
> `--summon`: approve → `summon()` → **Knight #1, Common, 15 hp**, owned by the summoning wallet,
> with the vault's balance up by exactly 500 DNG. `deployed-mint-fix.json` records the tx.
>
> **The first real summon failed, and the reason is worth keeping.** It reverted out of gas
> (`status 0`, `gasUsed == gasLimit == 246,527`). `_mintTier` writes `rarityOf[tokenId] = rarity`,
> so a **Common** roll (tier `0`) is a zero-into-zero SSTORE at 100 gas instead of 20,000 — and
> `eth_estimateGas` runs against *one* block's randomness. An estimate taken when the draw is Common
> is ~20k short of a transaction that lands on any other tier, so the tx dies having paid. The fix
> is a buffer on the estimate, and it is applied in two places: `tools/redeploy-mint-fix.js`
> (+30%) and `public/wallet.js#summonGasLimit`, which is the Hall's own summon button. Both halves
> matter — a player's summon would have hit the same wall.

**`Knights.summon()` reverts, and it is the only way a knight can enter the live collection.**
Capsule prizes need the raffle, the raffle needs staked Genesis, and the Genesis supply is still 0 —
so with `summon()` broken the collection cannot be filled by any route, and the Staking Vault and
the Knight's Hall are correct when they say the wallet holds nothing.

`RewardVault.fund(amount)` collects from **`msg.sender`**. Inside `summon()` and
`Capsules.open()` that sender is the calling *contract*, not the player, and neither one ever pulls
the money in from the player first — so the vault is asked to collect DNG the contract has never
held, while the page has already had the player approve 500 DNG that is then never spent.

```
eth_call summon() from the owner wallet, as deployed
  0xe450d38c  ERC20InsufficientBalance(address,uint256,uint256)
  arg0 = 0xfb738be682a0a60678a393eb7e23742b3137d4c5   ← the collection, which holds 0 DNG
```

Only these two functions are affected, and that is what makes it easy to see once found: every
other contract in the set — `DungeonKnightsGameV2/V3/V3.1/V4`, `RewardVault` — has the pull.

**The fix is one line each**, before the `forceApprove`/`fund` pair:

```solidity
dngToken.safeTransferFrom(msg.sender, address(this), SUMMON_PRICE);   // Knights.summon()
dngToken.safeTransferFrom(msg.sender, address(this), cost);           // Capsules.open()
```

It is applied in this repo, and `tools/check-contracts.js` now asserts it for every function that
funds the vault — tampering with `Knights.sol` makes it fail with *"Knights.sol:summon() funds the
vault without pulling from msg.sender"*. That nothing downstream of the pull is broken is not an
assumption: an `eth_call` with the collection's DNG balance overridden to exactly what the missing
line would leave there **succeeds and returns tokenId 1**.

**Shipping the fix meant redeploying five contracts, and that was arithmetic, not preference.**
`Knights.capsules` is one-shot (`require(capsules == address(0))`), and `Capsules.knights`,
`RaffleContract.capsules`, `DungeonKnightsGameV4.knightNFT` and `StakingPool.collection` are all
`immutable`. A repaired `Knights` therefore arrives at a new address and drags `Capsules` →
`RaffleContract` → `DungeonKnightsGameV4` → `KnightsStaking` with it. **`DNGToken`, `RewardVault`,
`GenesisKnights` and `GenesisStaking` stayed exactly where they are** — their state is untouched,
and only the vault's line-payer grants needed re-setting for the two new payers.

Nothing of value was lost by redeploying, and that was read rather than assumed: the collection
was empty (`totalSupply` 0), the capsule supply was 0, and no week of the raffle had drawn. The
script also refuses to revoke a retired pool's vault line unless that pool reads back as holding
no staked hash power — retiring a line is the only destructive act in it, so "I could not check"
and "I checked and it is empty" are deliberately not the same outcome.

## What was wrong before this

Nine contracts are required. Two existed (`RewardVault.sol`, `DungeonKnightsGameV4.sol`) and
**neither had ever been compiled by anyone** — they were written, reviewed in prose and quoted
in the interface's copy, and no compiler had read them. The other seven did not exist at all,
while the staking page, the tokenomics page, the mint page and three Node harnesses all
described the economy they were supposed to implement.

That is the state this document ends. Everything below compiles under `solc 0.8.28` with
OpenZeppelin v5.6, and `tools/check-contracts.js` fails if any published number — the reward
table, the daily caps, the hash powers, the drop rates, the bands, the capsule odds, the
supply split, the weekly budget, the runway floor — stops matching `lib/`.

## The order, and why it is this order

Two pairs of contracts each need the other's address, and both are resolved the same way: one
of them is deployed with a one-time setter that can only ever be called once.

| # | Contract | Constructor |
|---|---|---|
| 1 | `DNGToken` | `(rewardVault, liquidity, treasury, marketing)` — the vault address is needed here, so deploy the vault first if you prefer, or pass the address of the vault you are about to create |
| 2 | `RewardVault` | `(dngToken, configuredWeeklyBudget, lineBps[4])` |
| 3 | `GenesisKnights` | `()` |
| 4 | `Knights` | `(dngToken, rewardVault)` — no supply ceiling |
| 5 | `Capsules` | `(dngToken, rewardVault, knights, uri)` |
| 6 | `GenesisStaking` | `(genesisNFT, vault)` — vault line 1 |
| 7 | `KnightsStaking` | `(knightsNFT, vault)` — vault line 3 |
| 8 | `RaffleContract` | `(capsules, genesisStaking, stock[4])` |
| 9 | `DungeonKnightsGameV4` | `(knightNFT, dngToken, trustedSigner)` |

`DNGToken` mints its whole supply in the constructor, so its four bucket addresses must be
final before it is deployed. The vault address is one of them (45%), which is the only
circularity — deploy `RewardVault` first with the token address it will receive, then deploy
the token. Nothing in the vault calls the token until someone pays a claim.

**The wiring, after all nine exist** (`npm run deploy:args` prints this list too):

```
Knights.setCapsules(capsules)              one time only
Capsules.setRaffle(raffle)                 one time only
RewardVault.setPayer(0, gameV4, true)      genesis dungeon line
RewardVault.setPayer(2, gameV4, true)      knights dungeon line
RewardVault.setPayer(1, genesisStaking, true)
RewardVault.setPayer(3, knightsStaking, true)
RewardVault.fund(budget)                   from the DNG bucket
GameV4.setRewardVault(vault)
GameV4.setGenesisNFT(genesisKnights)
```

The payer grants are **per line**, not per address. That is not decoration: with a single
`payers[address] = true` list, the Genesis staking pool could spend the Knights dungeon line,
and the only thing that would notice is a budget being drawn down by the wrong product.

## The numbers, derived

`lib/reward-config.js` sizes the table against a reference population — 50 Genesis and 500
Knights playing daily, about 5% of each collection — and the vault is funded to pay that table
for **6.1 years** out of 45% of the supply.

| argument | value | where it comes from |
|---|---|---|
| `configuredWeeklyBudget` | `1415120000000000000000000` (1,415,120 DNG) | `weeklyBudgetDng()` |
| `lineBps` | `[2968, 2671, 2295, 2066]` | `lineBps()`, largest-remainder so it sums to exactly 10,000 |
| `MIN_WEEKS` | `12` | a constant in the vault, not a setting |
| Knights `MAX_SUPPLY` | **none — unlimited by design** | the collection is the product's own faucet |
| Capsules `PRICE_ANCHOR` | `10,000` | `KNIGHTS_REFERENCE_SIZE` — a ramp schedule, flat above it |
| capsule stock | 200/week total | `CAPSULES_PER_WEEK` — the **split** is yours to choose |

The four lines, in order: Genesis dungeon, Genesis staking, Knights dungeon, Knights staking.
The staking lines are derived as `0.9 ×` their collection's dungeon line, which is what makes
"staking pays 90% of playing" hold at any participation level rather than only at the one used
to size it.

## The one decision this cannot make for you

**The weekly budget is larger than the token that is live today.**

The deployed DNG token at `0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910` has a total supply of
**1,000,000** and calls itself "Dungeon Token". The published economy is **1,000,000,000** —
`lib/reward-config.js#DNG_SUPPLY`, quoted on `/tokenomics` — with 45% of it funding the vault.

Point the vault at the live token and the arithmetic does not merely get tight, it inverts:

- 45% of 1,000,000 is 450,000 DNG in the vault.
- The weekly budget is 1,415,120 DNG, which is **3.1× the entire vault**.
- The vault's runway ceiling is `balance / 12`, so the most it could ever release is 37,500
  DNG a week — and the epoch scale would settle at roughly **2.6% of the published table**.

So `DNGToken` is not a formality here, and deploying it creates a *second* token. That is a
decision about which token is canonical, and it is yours, not the contracts'. The options are:

1. **Deploy the new token** and treat it as the reward token, with the old one retired. The
   published table then holds as written.
2. **Re-scale the economy to 1,000,000** — a change to `lib/reward-config.js` and to
   `WHITEPAPER.md`, and every published figure moves by 1000×. The reward table (12/20/36/60/
   100 DNG a clear) would then be 0.012–0.1 DNG a clear, which is not a number anyone can
   advertise.
3. **Keep 1B and mint the remainder** into the vault on the existing token — but the live
   token has no mint function, so this is option 1 by another route.

## Caveats worth reading before a deploy

- **Nothing here has been run — and the first execution found a bug.** The contracts compile and
  their published numbers are checked against `lib/`, but **no test has executed a single function
  of any of them**. There is no Foundry in the environment they were written in, so `forge test`
  has never run and `test/` does not exist yet. Compilation proves the code is well-formed, not
  that it behaves. This is not theoretical: the first time anyone tried to use the deployed set for
  real, `summon()` reverted — see **Defect in this deployed set** above. Read that as the cost of
  the missing behavioural tests, not as bad luck.
- **The front end does not write to these yet.** The Staking Vault currently says
  *"simulated staking"* and is honest about it, because there is no transaction path: no
  approve, no stake, no claim. Deploying these makes the economy exist on chain; wiring the
  page to it (and setting `DNG_TOKEN_ADDRESS`, `KNIGHT_NFT_ADDRESS`, `GENESIS_NFT`,
  `STAKING_CONTRACT`, `RAFFLE_CONTRACT`, `CAPSULE_NFT`, `REWARD_VAULT`) is the next piece of
  work.
- **Staking takes custody of the knight.** A staked knight lives in the staking contract, so
  `DungeonKnightsGameV4` will not accept it in a run — its owner is not the player. That is
  the intended reading of the 90% rule: staking is the alternative to playing, not an addition
  to it. The alternative (a flag rather than custody) double-pays and cannot see marketplace
  transfers, because the collection cannot notify the pool.
- **Genesis has no mint price and no sale contract.** `ownerMint` is the only way in, because
  *how* the 1,024 are sold is a decision, and pinning one into the token would make the other
  options a redeploy.
- **The raffle's randomness is not a VRF.** It mixes `prevrandao`, the previous block hash and
  the week. A validator who produces a block *and* holds tickets can choose between candidate
  seeds; `RaffleContract.sol` says so where it can be read, and a commit–reveal or an oracle
  is the fix when the stakes justify it.
- **`evmVersion = cancun` is measured, not assumed.** The chain is Arbitrum Nitro, where the
  usual advice is `paris` — and under paris OpenZeppelin v5 will not compile at all
  (`Bytes.sol` uses `MCOPY`). `npm run check:opcodes` shows both halves of the evidence: the
  deployed token, NFT and game V3 already execute `MCOPY`, and `eth_call` executes it today.

## The production switch — how it is wired

The nine addresses reach the site as **environment variables, never as code**. Nothing about a
contract's address is compiled in, so a deployment can be re-pointed without a code change and
the repository never contains a network-specific default it should not.

The deployment needs these eleven names set (**the values are deliberately not written down
here** — read them from `deployed-phase2.json` and the Vercel dashboard):

| name | which contract |
|---|---|
| `KNIGHT_NFT_ADDRESS` | `Knights` (the summonable collection) |
| `DNG_TOKEN_ADDRESS` | `DNGToken` |
| `GAME_CONTRACT_V4` | `DungeonKnightsGameV4` |
| `GENESIS_NFT` | `GenesisKnights` |
| `GENESIS_STAKING` | `GenesisStaking` (falls back to `STAKING_CONTRACT` if unset) |
| `KNIGHTS_STAKING` | `KnightsStaking` |
| `RAFFLE_CONTRACT` | `RaffleContract` |
| `CAPSULE_NFT` | `Capsules` |
| `REWARD_VAULT` | `RewardVault` |
| `GAME_SIGNER_PRIVATE_KEY` | backend signer, matches the contract's `trustedSigner` — a **secret** |
| `GAME_RUN_SECRET` | HMAC key for run tokens — a **secret** |

`GAME_CONTRACT_V3` deliberately keeps pointing at the old contract: the legacy claim path is
still the one the old collection uses, and it is not part of this deployment.

Switching a deployment:

1. Set the eleven names for the production environment (`vercel env add <NAME> production`).
   Pass a value on stdio, not on the command line, for the two secrets; `vercel env add` hangs
   waiting on stdin unless it is closed or fed, which looks identical to a slow network.
2. `vercel --prod`, then **alias the custom domain explicitly** — `--prod` moves only the
   team domain, so a custom domain keeps serving the previous build while the deploy looks
   successful: `vercel alias set <deployment> <custom-domain>`.
3. Verify on the custom domain: `/api/staking/config` should report `chain: true`,
   `writes: false` and both staking addresses; `/api/game/config` should report the new V4 and
   `signing: true`.

### What the switch changes on screen

**Both collections now read as empty, and that is correct.** The new `Knights` and
`GenesisKnights` hold nothing until they are minted into, so the vault's roster and the game's
knight list are empty rather than wrong. The old 45-knight collection is no longer read by
anything on the site.

**The vault still calls itself a simulation.** Configuring addresses used to be enough to
remove the warning, because `simulated` was derived from *are the contracts deployed*. The page
can send nothing to them, so that derivation was one environment variable away from shipping a
vault that looked live and silently did nothing. `simulated` now follows `STAKING_WRITES_READY`
in `lib/staking-config.js` — an explicit statement that the interface can stake — and
`tools/check-staking.js` fails if the flag and the code disagree.

## Verifying a deploy

```
node tools/check-v4.js <v4 address>          # NFT, token, signer, funding, V3 paused
node tools/check-contracts.js --sizes        # what you built, and how big
node tools/check-opcodes.js                  # the chain still runs the bytecode
```

Read-only, no key, nothing to mis-sign. `check-v4.js` exits non-zero on a failed check, so it
can gate the step that flips `GAME_CONTRACT_V4` in the environment.
