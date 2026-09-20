# Run doc — Dungeon Knights (Next.js)

Thread workspace == main checkout: `D:\free buff\kiro edited\dungeon knights robinhood`

## 1. Reproduce the uncommitted artifacts

A fresh checkout needs these local-only pieces before it will run:

- **`.env.local`** — git-ignored, lives in the main checkout. Copy it, never symlink:
  `cp "<main checkout>/.env.local" .`
  (Next.js reads it automatically; the dev server log line `- Environments: .env.local` confirms it was picked up.)
- **Dependencies** — npm project (`package-lock.json` present): `npm ci` (or `npm install`).
  `node_modules/` is already present in this checkout.

Nothing else is required to boot. The engine scripts are served **verbatim** from `public/` — the
browser fetches `/dungeon.js?v=…` straight off disk, not from a bundle:

- **`public/` is the source of truth.** Edit `public/dungeon.js`, never a copy at the root: those
  copies were deleted ("One source of truth" below), and `tools/check-copies.js` fails if one
  comes back.
- **Bump the `?v=`** in `lib/static-pages.js` when you change a served script, or a returning player
  keeps the old copy. Versions also live in one `next/script` tag in `app/points/client.js`.
- `next.config.js` 308-redirects the old root `*.html` names (`/menu.html`, `/index.html`, …) to the
  real routes, so those files are unreachable by design.

### Switches that still need a human

Four things are built and verified but **off**, each waiting only on a value. Nothing else is
blocked; every one of them is a redeploy away, and no code change is needed.

| what | what is missing | where the steps are |
|---|---|---|
| Points Program persistence | `KV_REST_API_URL` + `KV_REST_API_TOKEN` (Upstash/Vercel KV) | *The Points Program is server-backed* |
| Mobile wallets | `PRIVY_APP_ID` (+ `PRIVY_CLIENT_ID`), and the chain enabled for the app | *Wallets: injected first…* |
| Server-signed payouts (V4) | the contract deployed in Remix, then `GAME_CONTRACT_V4` + `GAME_SIGNER_PRIVATE_KEY` | *Server-signed runs (Game V4)*, `docs/DEPLOY-GAME-V4.md` |
| Phone gas | players fund their own embedded wallet | *Wallets: injected first…* |
| The Capsules collection | a deployed `Capsules.sol`: `CAPSULE_CONTRACT` in `public/config.js` (empty string = not deployed) and `CAPSULE_NFT` for the vault's own read | *The Staking Vault*, and the capsule panel on `/mint` |
| Real Genesis holdings | the four Phase 2 contracts deployed, then `GENESIS_NFT`, `STAKING_CONTRACT`, `RAFFLE_CONTRACT`, `CAPSULE_NFT` | *The Staking Vault* |

Until the first two are set, the deployment is honest about it: the Points page shows its amber
"not persistent" banner, and the wallet facade stays dormant.

Confirm a served file on the live domain is the one you edited — hashes, not eyeballing:

```bash
node --input-type=module -e "import {createHash} from 'crypto'; import {readFileSync} from 'fs';\
for (const f of ['dungeon.js','wallet.js','leaderboard.js']) {\
  const local = readFileSync('public/'+f);\
  const remote = Buffer.from(await (await fetch('https://dungeon-knights.vercel.app/'+f)).arrayBuffer());\
  console.log(f, createHash('sha256').update(local).digest('hex') === createHash('sha256').update(remote).digest('hex') ? 'identical' : 'DIFFERENT'); }"
```

### Arya, the dungeon gate keeper

She is one shared popup, not four separate ones: `public/arya.js` defines
`window.Arya`, and `public/css/arya.css` styles her. Any page can call

```js
window.Arya.say('clear', { dungeon: 'Forgotten Crypts' });
// or 'enter' | 'mint' | 'return' | 'ready' | 'alarm' | 'brace' | 'think'
```

`window.Arya.say()` is wrapped in try/catch on purpose — she is decoration and must never
take down a page that called her (an early version threw straight out of the game's
dungeon-clear handler). She rises from the lower middle, auto-hides after 8s, dismisses on
click/Esc, and **steps aside when a dialog with buttons is open**, narrowing her bubble to
the gutter so that dialog stays clickable. She is seated above a page's own bottom bar
(`.control-bar`, `.dungeon-bottom`) and ignores pointer events except on her bubble.

| line | portrait | fires from |
|---|---|---|
| `clear` | `arya-clear.png` | root `game.js` `handleDungeonCleared()`; also the vault's last floor in `app/points/dungeon.js` |
| `enter` | `arya-enter.png` | `dungeon-select.js` accept handler (transition extended 1500 → 2200 ms for her screen time) |
| `mint` | `arya-mint.png` | `public/mint-page.js` `handleMint()` success (replaces the old `alert`) |
| `return` | `arya-return.png` | the game remembers the trip (`Arya.setFlag('fromGame')` on a click of `a[href="menu.html"]` or `#menuBtn`); `menu.js` consumes the flag on load |
| `ready` | `arya-ready.png` | `/points` wallet connect succeeded (replaced the `enter` battle-cry there — the helmet-and-shield portrait reads wrong for signing in) |
| `alarm` | `arya-alarm.png` | `/points` signature declined |
| `brace` | `arya-brace.png` | the walkthrough's vault and leaderboard steps |
| `think` | `arya-think.png` | the walkthrough's framing steps (and her fallback expression) |

- Art: `public/assets/arya/` — eight portraits renamed from the `arya/` folder in the
  project root, which is left untouched as the source. All have real alpha, so she needs no
  backing panel. The second batch (`ready`, `alarm`, `brace`, `think`) arrived with the
  walkthrough; `alarm` is the wide-eyed hands-up pose, `brace` the sword-and-shield scowl,
  `think` the chin-in-hand pose, `ready` the hand-on-hilt grin.
- The four legacy pages get the script from `lib/static-pages.js`; `/points` is a React
  route and pulls it in with `next/script` from `app/points/client.js`. **Bump `arya.js?v=` in
  both places after editing the module, and `arya.css?v=` after editing the CSS** (the module
  injects the stylesheet itself as a fallback for pages that only load the script).
- Each of the four portraits is 1.0–1.4 MB, so a page prefetches only the line it is most
  likely to need (`PAGE_DEFAULT` in the module maps `/game` and `/points` → `clear`,
  `/menu` → `return`, `/mint` → `mint`, `/dungeons` → `enter`); the others are fetched on
  first use and cached. Prefetching all four put ~4.8 MB on every page load.
- She only appears while the page is on screen, so a backgrounded preview shows nothing —
  that is the same rAF pause the vault has, not a bug.
- Measured pitfalls worth keeping fixed: the popup must be un-hidden **before** its bubble
  is measured (a hidden subtree reports width 0, which steered her with a bogus offset on
  every appearance after the first), and `say()` must stay wrapped in try/catch (an early
  version threw out of the game's own dungeon-clear handler).

#### The walkthrough (`window.Arya.tour`)

The Points Program gets a guided tour **on every visit**, not only a newcomer's first one —
Skip is one click, so a returning player pays nothing for it. `app/points/client.js` supplies
the steps (it is the only part that knows its own DOM) and the module drives the rest:

```js
window.Arya.tour('points-v1', { steps: [{ kind, text, mood, target }], force });
window.Arya.hasSeenTour('points-v1');   // → localStorage `dk_arya_tour_points-v1`
window.Arya.forgetTour('points-v1');    // replay for the next visitor
```

- A step's `kind` may be a **function**, and its `text` a string or a function — the wallet
  step reads both live, so it is alarmed with no wallet, thoughtful while unsigned, sworn-in
  once bound, and its line names the address and rank.
- **The module still defaults to once-ever** (`hasSeenTour`); the Points page opts out by
  passing `force: true`, which is the same flag that makes a replay mid-visit work. So the
  `dk_arya_tour_points-v1` flag is an identity, not a latch — nothing depends on it there.
- It opens **once per visit**, guarded by the `tourOpened` ref: connecting a wallet or
  returning from the vault re-runs the effect that starts it, and must not drag her back.
  Navigating away and back is a fresh mount, so she greets you again.
- A step's `target` is a CSS selector. The module dims the whole page with a single fixed
  box carrying a 9999px spread shadow (`#arya-spot`, z-index 1150, below her 1200) and rings
  the target — and **steps her aside** when her bubble would sit on top of it
  (`seatForStep()`; the Points page's share and referral rows are under her, the leaderboard
  is beside her). She is measured from a centred bubble first, or step 2 would be judged from
  where step 1 pushed her.
- While a tour runs her bubble **does not auto-hide** and `say()` is ignored, so a page event
  (connecting mid-tour fires one) cannot stomp the step being read. Esc, **Skip**, and
  finishing all mark it seen; **entering the vault ends it** (`endTour()` in
  `handleEnterDungeon`), because the vault covers the page.
- The footer's **Ask Arya** chip replays it on demand (`force: true`).
- Since it greets repeat visitors, the opening step's copy must read correctly to someone who
  has cleared the vault ten times — it is "Welcome", not "First time here".
- Verify from a console: skip or finish the tour, reload, and it starts again (~1 s after the
  page settles) with `dk_arya_tour_points-v1` already `"1"`. `tools/check-all.js`'s battery
  also covers her plain popups (29 checks) — run it with the tour stopped, since it drives
  `say()` directly.

### The map loading gate (`public/loading-gate.js`)

`/game` used to open on the wrong map: the page markup carried a hard-coded crypts
background video and a crypts chest in the side panel, so a player who chose Void Rift saw
Crypts paint first and then snap away — and the chosen map then drew in front of an empty
floor while its monster art, knight sprites and obstacle tiles were still on the wire.

Now the game page's own markup carries an opaque gate (`#mapLoadingGate`, styles in
`theme.css`, z-index 1900) that covers all of it from the first paint, and
`loading-gate.js` — the **first** script in the page's list — takes it down only once the
chosen dungeon's art has settled. Arya stands on the gate at z-index 2200 saying `hold`
("the map is still coming through the gate"), and the module takes her down with it.

- What it waits for: the dungeon's floor tile, decoration sheet and chest; every monster it
  can spawn; the knight sprites for **the rarities in this squad**; the obstacle art the
  renderer allocates on its first frame (that is what used to pop in after the map appeared);
  and the map video's first frame (`readyState >= 2`).
- It can never trap the player: an image that is already complete or that fails counts as
  settled, and the failsafe opens the gate at **15 s** regardless (`console.warn` says so).
  It holds for a minimum of 900 ms so a fully cached load does not flash.
- The page markup must keep its **empty** `<source type="video/mp4">`: the engine sets the
  real video in `switchDungeonVideo()`, and re-adding a hard-coded crypts source brings the
  flash (and a multi-MB download of a map the player did not choose) straight back.
- Verification is `node tools/gate-check.js` — 22 checks against a stub DOM and stub timers,
  because a real local load finishes in under two seconds and is nearly impossible to catch
  mid-flight by hand. It covers the wait list, one-asset-left, failed art, the once-only
  open, a page with no gate, and the failsafe.

**Related: the renderer no longer preloads art it cannot draw.** `DungeonRenderer` used to
fetch every dungeon's chest (~13 MB of PNG at ~2.6 MB each) and all six knight tiers (~9 MB)
on every load, competing with the art the gate is waiting for. It now loads the chosen
dungeon's chest and the squad's tiers (`squadKnightTiers()`), with `chestImageFor()` /
`knightImageFor()` fetching anything else lazily, so a missing entry can never draw blank.
Measured on a Void Rift load: **1 chest fetched instead of 5, 3 knight sprites instead of 6,
and only the void map video.**

### The Staking Vault (`/staking`)

Phase 2's page, built UI-first: it runs on a labelled preview until the four contracts exist, and
switches to real holdings on its own when they do.

- **Page** — `app/staking/client.js` (React, like `/points`) with its rules in
  `lib/staking-config.js` and its data in `lib/staking-source.js`. Styles are scoped under
  `.staking-page` in `public/css/staking.css`, so `theme.css` and `layout.css` are untouched.
- **One place for every number** — `lib/staking-config.js` for the staking rules, and
  `lib/reward-config.js` for the economy they are paid from. Tickets are
  `floor(min(stakedHours, 168) × hashPower)`. The pool is no longer a `TBD`: it is the
  collection's own line of the vault partition (`lineBudgets().genesisStaking` = 378,000 a week
  for Genesis, `knightsStaking` = 292,320 for Knights), so a fresh vault shows real DNG.
- **The pool is set by env, not by code.** `WEEKLY_POOL_DNG=15000` in the deployment overrides
  the derived Genesis line; `KNIGHTS_STAKING_POOL_DNG` overrides the Knights one. Neither needs
  a rebuild.
- **Two collections, one vault — the switch at the top of the left panel.** Genesis stakers earn
  yield *and* the weekly draw; Knights stakers earn yield only, because a capsule mints a Knight
  and so the draw is Genesis-only. That refusal is stated in words on the tile rather than left
  as a tab that does nothing. Each side draws its own ladder: Genesis the six published hash-power
  bands (counts summing to 1,024), Knights a five-row tier ladder whose powers are
  `capacity ÷ 4` — 15/25/36/45/100 — because the collection is uncapped, so there are no counts
  to draw and hash power is the only thing an owner can plan around. The economy panel dims the
  two lines that are not the side you are on.
- **Switching sides must not blank the page.** `selectCollection` calls `load(address, { quiet: true })`,
  which keeps the current board on screen while the new snapshot is fetched. Without `quiet` the
  whole vault is replaced by "OPENING THE VAULT" for a switch, which is a network round trip of
  blank page on a chain deployment — the moment a player is most likely to think the vault broke.
- **Preview vs chain** — `/api/staking/config` reports `chain: false` while any of the four
  addresses is missing, and the left panel wears a **Preview data** badge. Holdings are seeded
  deterministically from the wallet, so the same address always sees the same knights.
- **The live figure is the accrual line** under the summary (`Accruing now · …`). While the pool is
  `TBD` it counts the share of the pool, printed to five decimals because a week of
  seconds is a small number and two decimals would sit still for half a minute.
- **Actions are pure functions** in `lib/staking-source.js` (`applyAction`), so every path — stake,
  unstake, claim, enter, withdraw, open a capsule — is proven without a wallet.
- **The interactive layer**, and the rules that keep it honest:
  - **Power ladder** (top of *My Genesis*) — one bar per band of `HASH_POWER_BANDS`, heights
    against the largest band (200/210/210/200/140/64, so the thin top is the first thing you
    see), the wallet's own knights marked at each bar's base, and the band's name in gold when
    it holds one. Selecting a band filters both knight lists; the filter chip next to *Sort*
    clears it. The counts are the published table's, never recomputed here.
  - **Knight labels are bands, not rarities.** `bandFor(hashPower)` supplies the chip and the
    art colour, because the band is a *checkable* label — this collection publishes no
    per-token rarity, and the old hard-coded `data-rarity="legendary"` was decoration that
    claimed something untrue.
  - **The economy panel replaced the pool projector.** A range input labelled "if the weekly
    pool were" existed only because the pool was genuinely undecided; a number a player can drag
    is a number a player can mistake for a promise. In its place is the partition `RewardVault`
    is deployed with — four lines, their shares as bars, their weekly budgets, the epoch scale,
    the 90% rule and the horizon — drawn from `economy` on `/api/staking/config` and compared
    against it by the battery rather than against literals. It renders **before** a wallet
    connects, because the economy is a fact about the vault and not about the wallet.
  - **Draw ring** — the week drawn as a ring, filled from the last draw to the next
    (`strokeDashoffset = C × (1 - weekProgress)`), gold-pulsed in the final hour.
  - **Ticket cap** — a staked card draws its progress toward the 168-hour cap and says how many
    hours of tickets are left, with its hourly rate beside it, because the cap is the one
    deadline a staker has to plan around.
- **Phones get their own block in the same sheet** — `@media (max-width: 760px)` at the foot of
  `public/css/staking.css`, shaped like `menu-mobile.css` and `mint-mobile.css`: `html, body` come
  off `height: 100%; overflow: hidden` and `.page` off its fixed `100vh`, so the route scrolls as
  one document. `/staking` was the page this hurt most, because the row carried `overflow: hidden`
  and the vault column `flex: 1` as **inline styles**, and an inline style outranks every media
  query. The row could never be told to scroll, so the knight column filled all 735px of it and the
  vault column measured **1px** — the tiles, the tabs and the capsules were not on the phone at
  all. That layout now lives in the stylesheet (`.sv-main-row`, `.sv-aside`, `.sv-vault`); **do not
  move it back into the component**, and edit it here to change it. Measure it by loading the route
  in a width-set `<iframe>` — media queries resolve against the frame's viewport, which is the only
  way to see phone rules without a phone.
- **Capsules may only promise tiers the contracts pay.** The spec's fourth capsule was the
  *Mythic* capsule, handing out a tier with no on-chain reward slot 2–30% of the time — a card
  that would revert on every claim. It is the **Prime Capsule** now, named for the top
  hash-power band rather than a knight tier, and its Mythic share moved to Legendary. The
  ladder raises the floor rung by rung: Common 60/25/10/4/1, Rare 30/40/20/10, Legendary
  20/40/40, Prime 30/70. `/api/staking/config` serves `knightTiers` (from `lib/knights.js`)
  so a client can check its odds against the contracts' enum instead of against itself.
  **Still open:** how the 200 weekly capsules split across the four types is undefined, and it
  is the number that actually sets the raffle's economy.

#### Real holdings — how the vault reads the chain

The vault shows the knights a wallet **actually owns**, read from the deployed collection at
`0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512` (env `KNIGHT_NFT_ADDRESS`, defaulted in
`lib/game-runs.js`). It used to show invented ones to every visitor.

- **The collection cannot be enumerated.** Measured, not assumed, and asserted by
  `tools/check-staking-chain.js` so the premise is checked rather than trusted:

  | call | answer |
  |---|---|
  | `supportsInterface(0x780e9d63)` (ERC721Enumerable) | **false** |
  | `totalSupply()` | reverted |
  | `nextTokenId()` | reverted |
  | `tokenOfOwnerByIndex(...)` | reverted |

- **So candidates come from the logs, not a scan.** `Transfer` is indexed on `to`, so one
  `eth_getLogs` filtered to the wallet returns every token it was ever sent — 45 ids in one
  request. Cost is independent of collection size.
- **Do not "scan ids until a gap".** It is the obvious approach and it is wrong: ids in this
  collection are **not contiguous** (one real wallet holds 10–13, 22–55, 67–74, and id `0`
  exists), so stopping at the first gap reports 4 knights for a wallet with 45. The harness pins
  this by comparing the confirmed count against the contract's own `balanceOf`, which catches the
  whole class at once.
- **Logs give candidates, not holdings** — you keep receiving `Transfer`s for tokens you later
  send away — so ownership is confirmed afterwards with `getKnightInfo`, which also supplies the
  rarity the page needs.
- **`rpcBatch` in `lib/game-runs.js` is the transport, and its limits are measured:** 50
  `eth_call`s in one POST returns 200, **100 returns 429**, so batches are capped at 50 and a 429
  is retried with a widening pause. A revert is returned as `{ error }`, not thrown — for a reader
  asking whether a token exists, "execution reverted" *is* the answer.
- **Lower-case the address before any ABI encoding.** `ethers` refuses to encode an address whose
  case does not match its EIP-55 checksum, and it **throws** rather than reverting — so a wallet
  address pasted in the wrong case was reported as *"the chain could not be read"* without the
  chain ever being asked. `INVALID_ARGUMENT` is now its own message, because that one is our fault
  and never the node's.
- **Three states, not two.** Ownership and staking are separate facts, and collapsing them is what
  kept real knights off the page: `chain: false` (correctly — three contracts are missing) was
  also hiding the one collection that *does* exist. `/api/staking/config` now reports per side:
  `collections.genesis.live`, `collections.knights.live`, `holdingsLive` and `stakingLive`.
  `chain` still means what it always did. Precedence in `loadVault`: a live collection → real
  holdings; else deployed staking contracts → the vault itself; else the labelled preview.
- **Preview seeding stops the moment anything is live.** The Genesis side has no collection, so it
  shows an empty amber state saying *"Genesis Knights have not been minted yet"* rather than five
  invented knights sitting next to 45 real ones. Two sources of truth on one page is worse than
  either alone.
- **An incomplete read must travel as incomplete.** `readOwnedKnights` returns `complete`, which
  means exactly one thing: the confirmed count equals `balanceOf`. When it is false the page says
  the list is short and how many the contract reports. That is the case the whole interface exists
  for — an unenumerable contract can produce a partial answer, and the only bad outcome is a
  partial answer that looks finished.
- **Ownership is read live even while staking is not.** `staked` is always empty and that is not a
  placeholder: nothing can be staked until the staking contract exists.

Verify it:

```bash
node tools/check-staking.js        # 143 checks: week clock, tickets, capsule odds, actions,
                                   #   and the real-holdings wiring (fetch stubbed, no network)
node tools/check-staking-chain.js  # 19 checks: the collection's shape and a live wallet read
node tools/check-rarity.js         # 44 checks: the economy, incl. capsule outcomes
node tools/check-identifiers.js    # 4 checks: every name a bundled module uses is defined
```

`check-identifiers.js` is the one to run before believing a page works. It runs ESLint's
`no-undef` over `app/` and `lib/` — the bundled modules, where a name is either imported or a
browser global — and it exists because of a specific blank page: the Knights ladder rendered
`{pct(knightsCap.ratioOfReference)}` for a `pct` that was never defined. **`next build` compiles
that happily and no Node harness notices**, because none of them render React; the page just
went *completely blank* the instant a player switched to the Knights side, a `ReferenceError`
during render having unmounted the tree. It reports a line number instead. `public/` is
deliberately excluded — those are classic scripts sharing globals across seventeen files by
design, so every cross-file reference would be a false positive.

In the browser, on `/staking`, after copying the battery into `public/`:

```js
window.__check.reset(); await window.__check.staking(); window.__check.report();
```

**77 checks on the current deployment** (86 when nothing is live, because the preview-only
branches have more to assert) — tab ARIA wiring, arrow keys and the URL, no horizontal overflow,
and every capsule offering only a payable tier (checked against the tier list the server returns,
not against the page). It also covers the interactive layer: the ladder draws six bars whose
counts sum to 1,024 and marks the bands the wallet holds, a selected band really filters the lists
and the chip really clears them, the ring's offset stays inside its

**The battery branches on what is deployed, and it has to.** It used to assume the preview, which
made it fail *for being right*: it demanded an accrual figure on staked cards when nothing can be
staked, and four capsule cards when there is no draw. It now reads `/api/staking/config` once into
`HOLDINGS_LIVE` / `STAKING_LIVE` / `KNIGHTS_LIVE` and asserts whichever state it is looking at — so
"nothing is staked" is a *pass* that also requires the page to explain itself, rather than a
failure. When you add a state, branch on it here; do not soften an assertion into `|| true`.

**Switching sides needs a fingerprint, not a presence test.** A collection switch now costs a
chain round trip, and the wait cannot be "until a holdings note exists" — the *previous* side's
note is still on screen the instant the click lands, so it returns immediately and every
assertion after it reads the old side. `settle(before)` waits for the content to **change**:
`sideFingerprint()` is the note text plus the card count, captured before the click.

> This battery earned its keep again: it caught that the only way to **clear a band filter** lived
> inside the `{mine.length > 1 && …}` Sort row, so a wallet holding none or one could select a band,
> watch the list empty, and have nothing on screen to undo it. The escape now renders outside that
> row, because a filter with no way out is a trap regardless of how many knights are behind it.
circumference, every knight wears a *published* band, and the **economy panel draws the partition the vault is
deployed with** — four lines whose shares and budgets are compared against what
`/api/staking/config` serves, the weekly budget it is parting out, the epoch scale, the 90%
rule and the horizon. The projector those checks used to cover is gone: it existed because the
pool was undecided, and a number a player can drag is a number a player can mistake for a
promise. The battery puts back any knight it stakes.

> The one check that can fail for a reason that is not the code: *"it moves on its own as time
> passes"*. A hidden page has its timers throttled, and the preview webview is often not
> composited — check `document.hidden` before believing that failure. The economy page's
> battery has the same exposure and is documented there in full. I checked these are not vacuous the same way as the rarity guards: with
`has-mine` dropped, the bar height pinned to 50% and the filter chip removed, five named checks
fail and the rest still pass.

**Known and deliberate**, so it is not mistaken for a bug: with 200 capsules a week and few
knights staked, one entry can expect most of a draw. That is the formula working; the raffle tab
states the expected share rather than hiding it.

### The economy page (`/tokenomics`)

```bash
# in the browser, on /tokenomics:  cp tools/check-all.js public/_check.js
#                                  await import('/_check.js?v=' + Date.now())
#                                  await window.__check.tokenomics()   # 23 checks
```

The token maths is asserted in Node and spent on `/staking` and `/mint`, but it had no
*home*: the numbers a player would want to read were only in `WHITEPAPER.md`. `/tokenomics` is
that home, and it is derived from `lib/reward-config.js` rather than from markup or an API, so
a page that disagrees with the contract is not a reachable state.

What it shows: the supply and the five-bucket distribution with each bucket's custody; the
vault, its weekly budget and the four lines with the shares and budgets the vault is deployed
with; the reward table at scale 1.00 for both collections; the capsule price curve with its
break-even marker; and a **"what is not true yet"** list — the vault is unfunded, the
contracts are undeployed, participation is an assumption, the Genesis mint price is undecided,
and Points are a closed loop.

**The one control is the scale demonstration**, and it is worth knowing why it is allowed to
exist when the vault's pool slider was deleted: the pool was *unknowable*, while the scale is a
published formula — `scale = min(1, budget ÷ last week's burn)` — whose behaviour at 1× is
exactly the published table. The control is labelled a scenario, and the battery proves the cap
holds at every position it can be dragged to.

The battery is worth reading as a list of things a page can get wrong that a module cannot.
It caught two real bugs on the first build:

| Bug | How it rendered |
|---|---|
| Genesis bands carry `lo`/`hi`, not `hashPower` | *"1,024 knights, **NaN HP** at the bottom"* — a missing field, not a throw |
| The page asked for `/css/theme.css`; the file is `/theme.css` | **No `box-sizing` reset and no `--accent-gold` at all.** Every DOM assertion still passed, because a 404 stylesheet throws nothing |

The second is why the battery now fetches every stylesheet href and checks that a themed
colour actually *applies* (`rgb(212, 175, 55)` not the inherited `rgb(232, 224, 212)`) rather
than assuming it loaded. Both guards were proven non-vacuous by reinstating each bug:
`/css/theme.css (404)`, an unresolvable colour, and `999 vs 975` horizontal overflow, in three
named failures. The same missing reset also caused that overflow, so the two are one bug.

**One environment note that will waste an hour if you don't know it.** A hidden page throttles
its timers, and the preview webview is often not composited. A battery that sleeps between
steps appears to *hang* rather than fail — one run took 7 minutes and still passed. Check
`document.hidden` before believing a timeout.

### Capsules are opened on `/mint`, not here

The vault's Capsules tab shows what the wallet holds and hands the player off; the *opening*
happens on the Summoning Chamber, in a panel drawn by `public/mint-page.js` (bumped to
`?v=2`). It reads its price from the same `economy` object as the vault — **500 DNG at zero
Knights rising to 5,000 at the 10,000 cap**, with the break-even marker at **57.46%** of the
track (5,746 Knights, where the 200 weekly opens alone start covering both Knights reward
lines). Three things about it are deliberate:

- **The price is never typed into the markup.** A price that lives in two places is a price
  that will eventually disagree with the contract; the panel quotes the model, and
  `wallet.openCapsules()` sizes its approval from the contract's own `openPrice()`.
- **`config.reason` is ignored on purpose.** That string explains why the *Staking Vault* is in
  preview mode, which is not a fact about this page.
- **The button says why it is dead.** `public/config.js` gained `CAPSULE_CONTRACTS` +
  `getCapsuleContract()`, where an **empty string means "not deployed"** — a state the panel
  reports in words rather than by attempting a call against nothing. Setting that one address
  (and `CAPSULE_NFT` for the vault's read) is the whole switch.

### The Points Vault is not an engine dungeon

It is a scripted mini-game on the Points Program page (`app/points/`), reachable only from that
page's **Enter Vault** button — it is deliberately absent from `DUNGEONS`, the quest board and the
random rotation, because as an engine dungeon it would make every `/game` load preload ~7 MB of
vault monster art no dungeon could ever show. Its React sources need no `public/` copy, but its
stylesheet does:

- `public/css/points.css` — served verbatim, and the page links it as `/css/points.css?v=N`.
  **Bump that `?v=` in `app/points/client.js` after editing the CSS**, or the browser keeps serving
  the old file and the vault renders unstyled.
- Vault art lives in `public/assets/points/` (map video `background.mp4`, `dummy-knight.png`,
  `monster-1..3.png`, `chest.png`).
### The Points Program is server-backed

Points are no longer `localStorage`. `lib/points.js` (the old browser-only module) is **deleted**;
the rules now live in `lib/points-config.js` (the table: 100/300/500, 15%/5% commissions) and
`lib/points-program.js` (the rules: what a floor pays, once a day, in order, plus commissions).
The browser asks; it never decides.

- **Storage** — `lib/points-store.js`, two drivers chosen by environment:
  - *file* (default in dev): `.data/points.json`, which is **gitignored**. To start fresh,
    delete it **and restart the server** — the running process caches the file in memory, so
    deleting it underneath a live server does nothing until the next cold start.
  - *redis* (Upstash-compatible REST): set `KV_REST_API_URL` + `KV_REST_API_TOKEN`, or
    `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`. Production falls back to in-memory
    when neither is set, which loses points on redeploy and warns loudly on every write.
- **Sessions** — `lib/points-session.js`. The wallet signs a nonce challenge
  (`personal_sign`), `ethers.verifyMessage` recovers the signer, and the API returns an
  HMAC-signed token the page keeps in `localStorage.dk_points_session` for 30 days. Set
  `POINTS_SESSION_SECRET` in production; without it a random per-process secret is used, which
  still works but signs everyone out on each cold start.
- **Endpoints** (all `app/api/points/…`, `force-dynamic`, node runtime):

  | route | method | purpose |
  |---|---|---|
  | `/session` | `GET ?address=` / `POST` | the message to sign / exchange a signature for a token |
  | `/me` | `GET` / `POST {ref}` | the page's state / claim a referral code |
  | `/vault` | `POST {action}` | `clear` a floor, or `share` for the ×2 bonus — **the only way points are awarded** |
  | `/leaderboard` | `GET ?limit=` | the public board (`isYou` when a token is sent) |

- Wallet connection is `lib/points-client.js`, deliberately **not** `public/wallet.js`: the
  React route does not load the legacy script stack. It talks to `window.ethereum` and writes
  the same `walletConnected` / `walletAddress` keys the legacy pages use, so one connect serves
  the whole site. Wallet detection happens in an effect (plus `focus` and
  `ethereum#initialized`) so a late-injecting wallet does not leave the button dead.
- Old localStorage keys (`dk_points`, `dk_vault_levels`, `dk_vault_share`,
  `dk_all_wallet_points`) are dead but may still be in a browser profile from earlier runs;
  nothing reads or writes them any more.
- `tools/check-all.js` is the verification battery for everything in this thread. It is
  outside `public/`, so serve it temporarily to use it:

  ```bash
  cp tools/check-all.js public/_check.js
  # then, in the page console:
  #   await import('/_check.js?v=' + Date.now());
  #   window.__check.arya()        // 29 popup checks: structure, dedupe, swap, Esc,
  #                                // close button, auto-hide, dialog geometry
  #   window.__check.engine(8)     // main engine: runs, kills, chests static, counters
  #   window.__check.assets()      // which portraits this page actually fetched
  #   window.__check.clearWatch()  // then watch for a real dungeon clear + her line
  #   window.__check.vaultEntry(1) // play a whole vault entry, per-floor metrics
  #   await window.__check.staking()  // the vault, 62 checks — RUN IT ON /staking
  #   window.__check.report()      // { total, failed, failures[], results[] }
    rm public/_check.js            # and take it out again
    ```

  **`engine()` needs a squad whose shape the engine accepts**, or it reports checks that look
  like engine bugs but are the fixture's fault. Store real `Knight` objects, not hand-written
  stats — `range: 1` is what makes a knight melee, and `rarity` is an object, not a tier name:

  ```js
  // on /game, where characters.js is loaded
  const knights = [0, 1, 2, 3, 4].map((i) => {
      const k = new Knight(i + 1);
      return { id: k.id, rarity: k.rarity, stats: k.stats, stamina: k.stamina, state: k.state, totalEarned: 0 };
  });
  localStorage.setItem('selectedKnights', JSON.stringify(knights));
  localStorage.setItem('selectedDungeon', 'crypts');   // one of DUNGEONS' keys, not a display name
  ```

  `selectedDungeon` must be one of `crypts / mines / temple / magma / void`. Any other value
  crashes the engine at boot (`Dungeon.addObstacleDecoration` reads `this.config.name` while
  `this.config` is `undefined`) — see the open question at the end of this file.

  **The first-time visitor is a separate entry point, and it is the state the battery used to
  miss.** `staking()` always ran with a wallet already saved, so the vault was never rendered
  with **no snapshot at all** — the case that used to throw during render and leave the whole
  page blank. The state needs a reload, so it is driven in four steps:

  ```js
  window.__check.prepareFresh();   // stash walletAddress, clear it
  // reload /staking, then:
  window.__check.freshState();     // 8 checks on what a brand-new visitor gets
  window.__check.restoreWallet();  // put the wallet back
  // reload /staking, then: await window.__check.staking()
  ```

  Do not try to test this in an `iframe`. A hidden `/staking` starts the embedded-wallet
  handshake and leaves the renderer too busy to answer anything, and it took the page out for
  minutes. A reload is cheaper and exact.

  `node tools/gate-check.js` is the other half: it is a plain node test (no browser, no
  dependencies) for the map loading gate, and it exits non-zero on failure.

  Three constraints it encodes, all learned the hard way:

  1. **One entry per wallet per day is now a server rule**, so a soak run needs a fresh wallet
     per entry. The harness mints one itself — it loads `/ethers-5.7.2.umd.min.js`, keeps a key
     in `localStorage.__checkPk`, installs a mock `window.ethereum` that signs the page's own
     challenge, and clicks through the real connect button:

     ```js
     await window.__check.newWallet();   // fresh key + mock provider (idempotent)
     await window.__check.signIn();      // drives the page's Connect flow for real
     window.__check.vaultEntry(1);       // one entry; run newWallet() again for the next
     window.__check.me();                // the server's view of this wallet
     ```

     `vaultEntry` refuses to start on a spent wallet and says so instead of spinning.
  2. The vault can only be replayed on a **freshly loaded** `/points`, and `vaultEntry` reads
     the payout from `GET /api/points/me` rather than from a counter.
  3. Arya's own cooldown means a test that calls the same line twice has to wait it out. Vault
     entries are persisted to `localStorage.dk_check_runs`, so they survive the reload between
     them.

- `tools/vault-soak.js` is a dev-only soak harness: paste it into the console on `/points`
  (it is outside `public/`, so the browser cannot fetch it) and it plays whole entries on its
  own — plain, shared on X, and one with a mid-floor Exit — checking payouts, sprite overlap,
  bounds and effect-array growth. Read `window.__soak.summary()`, stop with `window.__soak.stop()`.
  It polls `GET /api/points/me` on every tick and settles each payout once the server has
  answered, so its numbers come from the API, not from a local counter. It stops after the
  wallet's entry for the day (see constraint 1 above) rather than complaining forever about a
  locked **Vault Cleared Today** button.
- The vault's clock is driven by `requestAnimationFrame`, so it **pauses while the tab is not
  being composited** (backgrounded, occluded, or a preview surface with no visible client).
  That is intentional — no dungeon time is lost — but it means a headless soak only progresses
  while the page is actually being rendered.

### Server-signed runs (Game V4)

The claim path used to trust the browser completely. `batchClaimRewards` on the deployed V3
checks ownership, rarity and the daily cap — **and nothing else**. There is no time check at
all: the `max(30, 300/√knights)` minimum in `KNIGHT-SCALING.md` lives only in the client, so a
script that never opens the game can claim 15 knights × 5 runs = **75 payouts in one
transaction**.

V4 (`contracts/DungeonKnightsGameV4.sol`) closes it. Every run must carry a signature from the
backend, over that exact run, bound to the chain id and the contract address:

```
startDungeon  → POST /api/game/start     server-stamped run token (HMAC over address + squad
                                         + *its own* start time, so the browser cannot backdate)
completeDungeon → POST /api/game/complete  validates, then prices the run from on-chain rarity
                                         and signs a receipt (single-use nonce, short expiry)
Claim All     → V4.claimSignedRuns(...)  verifies the signature, burns the nonce, recomputes
                                         the reward from on-chain rarity, pays the difference
```

Nothing needs a database: the single-use nonce is enforced on chain (`usedNonce`), and both the
run token and the receipt are stateless MACs. `GAME_CONTRACT_V4` is served to the browser by
`GET /api/game/config`, so the address lives in exactly one place — the server's env.

**Honest limit.** This stops a script from paying itself without playing, and from claiming
faster than the minimum time. It cannot prove a human watched the knights: a bot that starts and
finishes runs on schedule still earns, though it must wait as long as an honest player and the
on-chain daily caps bound it either way.

**Transition order matters.** V3 must stay unpaused until the new client is live, so runs already
sitting in a player's `localStorage` can still be paid. `flushLegacyRuns()` does that
automatically — once per browser session, only when a wallet is already connected — and it is why
the client classifies runs as `signed` (has a receipt), `legacy` (has neither receipt nor token)
or retryable (has a token, receipt failed on a hiccup; valid for hours).

| variable | why |
|---|---|
| `GAME_CONTRACT_V4` | **Unset today** — the app records runs exactly as before and claims on V3. Setting it is what switches the site over, not the deploy. |
| `GAME_SIGNER_PRIVATE_KEY` | The backend run signer. `node tools/gen-signer.js` prints a fresh pair; the private key goes here, the address into the V4 constructor. |
| `GAME_RUN_SECRET` | Keys the run tokens. Falls back to `POINTS_SESSION_SECRET`, then to a dev constant. |
| `GAME_RPC_URL`, `GAME_CHAIN_ID`, `GAME_MIN_BASE_SECONDS`, `GAME_MIN_FLOOR_SECONDS`, `GAME_RECEIPT_TTL_SECONDS` | Overrides; defaults are the testnet RPC, 46630, 300, 30 and 900. |

Deploying: **`docs/DEPLOY-GAME-V4.md`** (Remix, step by step, including pausing V3 and sweeping
its treasury), then `node tools/check-v4.js 0x…` to confirm the wiring read-only.

```bash
node tools/check-runs.js                                    # 16 unit checks
node tools/check-runs.js http://localhost:3000 http://localhost:3001   # + live API checks
node tools/check-session.js                                 # 34 client checks (sandbox)
```

The live phase needs a server started with GAME_CONTRACT_V4 + GAME_SIGNER_PRIVATE_KEY and the
same `POINTS_SESSION_SECRET` the harness uses; it mints a session for a knight owner it finds on
chain, so the real ownership, timing and forgery paths are exercised without a wallet.

**Two gotchas this cost time on:**

- **Ethers' provider cannot do network I/O inside a Next server route.** `new JsonRpcProvider()`
  bundles into the route and fails with `could not detect network (noNetwork)`, while the same
  call works in a plain Node script. `lib/game-runs.js` therefore does its chain reads over plain
  `fetch` with `utils.Interface` for the ABI encoding — pure JS, no bundling surprises.
- **Two `next dev` servers in one project share `.next`** and clobber each other's route cache:
  one starts 404-ing routes that worked a minute earlier. Run them one at a time.

### Wallets: injected first, embedded when configured

Every page reaches the chain through `window.ethereum`, which is fine on a desktop with an
extension and impossible on a phone, where no wallet injects anything into the page.
`public/wallet-source.js` is the single place that decides where that provider comes from, and
installs one when the browser has none of its own. It is loaded on all six pages, immediately
before `wallet.js`, and by the Points route itself (it is a React route, not a legacy page, so it
appends the script tag in `app/points/client.js`).

Resolution order: **injected** (an extension always wins — no round trip, no modal, and it is
never overwritten while it is there) → **embedded, restored silently** (a returning phone session
is signed back in on load with no UI) → **embedded, on demand** (the provider exists from the
start with no account, exactly like a locked extension; the first `eth_requestAccounts` runs an
email-code sign-in) → **nothing**, at which point `unavailableMessage()` says what to do.

**Dormant by default, and that is the whole point.** `/api/wallet/config` reads
`PRIVY_APP_ID`; with it unset the route answers `embedded: null`, and the facade then loads no
third-party script, mounts no iframe, and never touches `window.ethereum`. Verified live with the
App ID unset: `window.DKWallet` present, `window.ethereum` still `undefined`, no modal, no iframe,
and `walletManager.connect()` still shows the desktop message and opens the MetaMask download page
— unchanged behaviour on every page.

```bash
node tools/check-wallet-source.js    # 47 checks: dormant, injected-wins, restore, sign-in, cancel,
                                    # chain mismatch, sign-out — against a fake SDK and stub DOM
```

To switch it on, set these on the Vercel project and redeploy (no code change):

| variable | why |
|---|---|
| `PRIVY_APP_ID` | Turns the embedded path on. Public by design — it identifies the app to Privy's hosted UI, not a credential. |
| `PRIVY_CLIENT_ID` | Optional, from the dashboard under Settings → Clients. |
| `PRIVY_SDK_URL` | Optional. Defaults to the pinned `@privy-io/js-sdk-core@0.76.1` in the route; override only to move the pin or self-host the bundle. |

**Switched on in this thread.** The App ID is `cmu9rk7lo034q0cl24jlo2mr7`. It lives in
`.env.local` locally and in **Vercel production** (added as type `config`, not `secret` — it is
public by design and the team should be able to read it back):

```bash
printf '%s' '<app-id>' | vercel env add PRIVY_APP_ID production --type config --scope meglast320-1694
vercel env rm PRIVY_APP_ID production --yes --scope meglast320-1694   # to replace it
```

Piping the value is what makes this non-interactive. Two notes: the CLI still prompts for a
**git branch** when the environment is `preview` (`vercel env add … preview`), so preview is
**not set** and needs a human on a terminal; and `--type config` matters because the default is
`secret`, which hides a value nobody needs hidden.

**The real handshake now runs.** Verified against the live SDK, not a fake: the secure-context
iframe mounts for *this* app id
(`auth.privy.io/apps/cmu9rk7lo034q0cl24jlo2mr7/embedded-wallets`), and signing in with a
non-routable `.invalid` address returns **`POST auth.privy.io/api/v1/passwordless/init → 200`**
and advances to the code step. Nothing real was mailed.

One bug came out of that first real run and is fixed: **`privy.user.get()` throws
`No tokens found in storage`** when nobody is signed in — it is not a null-returning getter — so
on 0.76.1 the first *Connect Wallet* on a phone died before any sign-in UI appeared.
`public/wallet-source.js` now catches that specific case; the fake in `check-wallet-source.js`
throws the same way so the regression cannot come back (**47/47**, was 41).

Still unproven, and only a human can close these:

- **The embedded wallet has to be on Robinhood Chain Testnet (46630 / `0xb626`).** Our chain is an
  app choice, not a wallet one, so the facade asks the wallet what chain it is on and **warns with
the exact decimal id** when they disagree rather than letting the first transaction fail
  anonymously (`capabilities().chainMismatch` carries the same value). Enable the network for the
  app in the Privy dashboard.
- **It needs gas** — an embedded wallet is the player's own, non-custodial wallet, and it starts
  empty. Fund it from a faucet before minting or claiming.

### One source of truth (and the cache-bust rule)

The repository used to carry a second copy of the whole client at its root — `dungeon.js`,
`menu.js`, `leaderboard.js`, `wallet.js` and 17 more — while the browser fetched `public/<same
name>`. Only `public/` is served: `/wallet.js` and `/dungeon.js` return 200 from there, and the
root `*.html` pages that used the root copies are not served at all (`next.config.js` 308-redirects
`/menu.html`, `/index.html` and friends to the real routes). So the root copies were dead weight
that had drifted — 81 lines in `dungeon.js`, 688 in `leaderboard.js` — and one of them cost real
time: `dungeon.js` was loaded with a `?v=` that had never been bumped, so a fix would never have
reached a returning player however many times it was deployed.

**They are deleted, along with the abandoned wallet integrations** (`public/js/web3/*`,
`privy-integration.js`, `privy-config.js`, `rainbowkit-integration.js`, `dungeon-session-OLD.js`,
`_vidprobe.html`) — none of them was loaded by any page or imported by anything. The one-shot
contract scripts at the root (`check-*.js`, `deploy-*.js`, `fund-*.js`) are **not** duplicates and
were left alone; they are the user's manual tools.

Two rules follow, and `tools/check-copies.js` enforces the first pair:

```bash
node tools/check-copies.js   # fails on a root duplicate, or a script loaded from a path that does not exist
```

- **Never keep a same-named copy of a served file at the root.** Edit `public/`. The check fails
  the moment a duplicate reappears, which is how it would otherwise come back.
- **Bump `?v=` whenever you edit a served script.** The versions live in `lib/static-pages.js` (and
  one `next/script` tag in `app/points/client.js`). Loading a file with no version at all is the
  same hazard in slow motion; the check lists the ones that currently do, so the next person to
  edit one knows to add a version rather than assume the browser will notice.

### The token maths (`lib/reward-config.js`, `tools/check-token-math.js`)

```bash
node tools/check-token-math.js    # 61 checks
```

**The economy is in its third revision, and the change of shape is the whole story.** The
first two published *absolute reward promises* — "a Legendary clear pays 100 DNG, a Genesis
clear pays 300" — and never bounded the total. The bound is the token supply, and at those
rates all 1,024 Genesis Knights playing for a **single day** would have claimed **123% of it**.
Nothing in the design said what happens when more players arrive than the table was sized for,
because nothing in the design could.

What replaced it, in `lib/reward-config.js`:

| | v3 |
|---|---|
| Supply | **1,000,000,000 $DNG**, 18 decimals — distribution **45% reward vault / 30% liquidity / 15% treasury / 10% marketing (unvested) / 0% team** |
| Reward vault | **450,000,000** — the only bucket that is spent |
| Reference population | **50 Genesis (4.88%) + 500 Knights (5.0%)**, i.e. ~5% of each collection playing daily |
| Weekly budget `W` | **1,415,120** (202,160/day), partitioned 29.68 / 26.71 / 22.95 / 20.66 across Genesis-dungeon, Genesis-staking, Knights-dungeon, Knights-staking |
| As basis points | `2968 / 2671 / 2295 / 2066`, which is what `RewardVault`'s constructor takes — it reverts unless they sum to 10,000 |
| Table at scale 1.0 | Genesis **300/clear × 4 runs**; Knights **12/20/36/60/100** on 5/5/4/3/4 runs |
| Staking rule | **90% of dungeon income, per collection** — structural (`staking = 0.9 × dungeon`), not an amount |
| Horizon | **2,226 days = 6.1 years** at the reference; **110 days** if every knight plays *and* stakes, with the scale falling to **×0.35** |
| Knights cap | **10,000**; at the cap a knight earns **5.00%** of its reference income, because both Knights lines are fixed shares divided by twenty times as many knights |
| Capsules | **200 a week**, open price ramping **500 → 5,000 DNG**; the crossover is **~5,746 Knights**, from which the weekly opens alone cover both Knights lines |

**The mechanism that makes it safe is one scale.** Every payout is `table × epochScale`, where
`epochScale = min(1, budget / lastWeekBurn)`. Above the reference the scale falls and **every
published number moves down together**, so the tier ratios, the 90% rule and the split between
the collections survive at whatever level is fundable. Two hard ceilings enforce it:
`spentThisWeek ≤ lineBudget` per line, and `W = min(configured, vaultBalance ÷ 12 weeks)` — so
**the vault can never outlive itself**, and a bug cannot drain it in a week. `RewardVault.sol`
is where those live; see *Solidity: Foundry, and what is not installed*.

**Why the reference population is published.** It is what sets `W`, and therefore the whole
scale of the economy. Calibrating it to 250 Genesis and 1,000 Knights — ~24% of the collection
— funded the same table for only **1.3 years**; at ~5% of each collection it funds it for
**6.1 years**, with the same table and the same vault. The honest sentence to publish is
*"the full table is payable to about 5% of each collection playing daily; above that, one
scale moves every number down together, and the interface shows today's rate."*

**Two figures that are already derived and must not be re-derived.** Expected daily earning is
`Σ p · reward · runs`, **not** `E[reward/clear] × E[runs/day]` — the tiers that pay most also
get the most runs, so the product of averages overstates it. And both Knights lines are
returned *separately*: quoting a combined dungeon-and-staking figure against dungeon-only
earnings is how an earlier draft of this plan arrived at "10% of reference" when the truth is
**5%**, and the harness pins each line so that basis error cannot come back.

The pages read this from one place. `app/api/staking/config` serves the model's `economy`
object, and **`check-token-math` asserts that every field the two pages read is actually served**
— the capsule panel once read `economy.capsulesPerWeek`, which the route carried only at the
top level, and rendered *"the NaN weekly opens alone cover..."* with nothing failing anywhere.

#### Superseded — the v2 arithmetic (history, not current state)

Everything from here to the end of this subsection describes the **second** revision: a
1,000,000 supply, a six-tier 10/17/30/75/150 table and a `TBD` pool. It is kept because the
failure mode is the reason this section exists — three documents doing their own sums from two
different tables, and a `TBD` that stayed `TBD` — not because any of the numbers are still
true. The current numbers are the table above.


The economy is described in three documents — `WHITEPAPER.md`, `GENESIS-HASH-POWER.md` and
`tokenomics.md` — and each of them used to do its own sums. They disagreed with the code and
with each other:

| Claimed | Truth |
|---|---|
| An expected **78.8 $DNG/day** and a **6.3-day** payback (whitepaper §5.3, Genesis §6.2) | **83.5 $DNG/day**, **5.99 days** (26.18 clears). The old figure came from a six-tier table summing to **100.7%** that predated the removal of Mythic |
| A `d1000` roll of 650/200/100/45/12/3 (`tokenomics.md`) | **1,010 faces on a thousand-sided die**, and 101% of outcomes |
| Six tiers, 12–150 per clear, mint 500 | Five tiers, **10/17/30/75/150**. Every reward contract declares `RARITY_COUNT = 5`, so a sixth tier has no slot and reverts on claim |
| One knight can claim ~28,771 $DNG a year | **30,478** — and the whole 1,000,000 supply is **32.8 knight-years** of full play |

**The fix is that the numbers are now computed, not typed.** `lib/token-math.js` derives every
published figure from `lib/knights.js` (`RARITY`) and `lib/staking-config.js` (capsule odds),
and `tools/check-token-math.js` asserts both that the arithmetic is internally sound (Σp = 1,
the tier count matches the contracts' slot count, a day of capacity is reward × runs) **and
that the documents quote it** — a changed reward table fails the suite until the prose changes
with it. `tokenomics.md` was rewritten as v2.0 around this; it is no longer a second universe.

The harness also pins the payback comments in `public/characters.js`, which said *"25 dungeon
ROI baseline"* for Uncommon long after the table had moved to 17 per clear — the note a
developer reads while changing a reward was the stale one.

**Two derivations worth not re-deriving.** Expected daily earning is
`Σ p·reward·runs` = 83.5, **not** `E[reward/clear] × E[runs/day]` = 90.92: the tiers that pay
most also get the most runs, so the product of averages overstates the truth by 9%. And the
capsule yields (78.3 / 178.5 / 354.0 / 487.5 $DNG/day) are the same weighted-capacity figure
per capsule — they were already correct.

**The funding invariant, which is what any pool decision turns on.** A summon is the only
inflow (500 $DNG) and there is no emission, so a weekly pool is a *mint cadence*: 15,000 $DNG a
week means **30 summons every week, forever** (1,560 a year), and the published 35% reward
bucket (350,000) is **11.48 knight-years** of play. The project has minted 78 knights in total.
The interface shows `TBD` rather than an invented figure, and `WEEKLY_POOL_DNG` stays `null`
until the cadence exists to fund it.

**Still open, with a known cost each** (see `tokenomics.md` §9): the weekly pool, the capsule
open cost (`CAPSULE_OPEN_COST_DNG = 0` today, which makes opening a capsule mint a knight for
nothing — 10,400 free knights a year at **317× the total supply** of claim capacity), the split
of the 200 weekly capsules across four types, and the Genesis mint price. Points are a
**closed loop** (1,800/day ceiling, no conversion anywhere): that is safe only while nothing
converts them, and `check-token-math` asserts no such conversion has appeared quietly.

### One rarity economy (`tools/check-rarity.js`)

The rarity table used to be written down in four places — `public/config.js`, the engine's
`public/characters.js`, the React helpers in `lib/knights.js`, and the constructor of every reward
contract — and they had drifted. The mint page advertised **six** tiers ending in Mythic at 0.3%,
while the engine rolled five; because `rollRarity()` accumulates the `dropRate`s and falls through
to `Common` past the last entry, the sixth tier could not be rolled at all. Players were quoted odds
the game did not honour.

There are now **five tiers, one per on-chain enum slot** — Common 50%, Uncommon 30%, Rare 15%,
Epic 4%, Legendary 1%, paying 10/17/30/75/150 $DNG with 5/5/4/3/4 runs a day. `Mythic` is gone from
the economy, the odds table is drawn from `config.js` rather than hard-coded in the markup, the
mint price comes from `CONFIG.getMintPrice()` instead of a literal `500`, and the dungeon's
per-tier art now agrees with the cards.

```bash
node tools/check-rarity.js   # fails the moment any of the four tables drifts from the others
```

It loads `config.js` and `characters.js` into a `vm` sandbox with a stub `window`, reads the five
`.sol` constructors as text, and pins: the same five tier names everywhere, every field equal across
the three JS tables, odds summing to exactly 1, the contracts' `rarityReward`/`dailyCap` matching
the tier at the same index, every tier's art resolving on disk, and `lib/static-pages.js` still
carrying the `#rarityChances` container the odds are drawn into.

### Solidity: Foundry, and what is not installed

`foundry.toml` configures `forge` against `contracts/` with `node_modules` as its lib path, so the
contracts can be compiled and inspected without Hardhat:

```bash
npm install            # @openzeppelin/contracts is a devDependency, for the solc imports
forge build            # requires Foundry; `forge` is NOT installed in this environment
```

**`forge` is not on PATH here**, so the ported contract changes are reviewed rather than compiled.
Install Foundry (`foundryup`) before trusting a build result; the sources changed only in ways
`tools/check-rarity.js` can see, plus signatures no tool in this repo can check.

## 2. Run the server

- Script: `npm run dev` (`next dev`).
- **Port:** this environment exports `PORT=0`, which makes Next allocate a random free port on
  every start. Port 3000 is free and is the project default, so pin it for a stable URL:

  ```powershell
  powershell -NoProfile -Command '$env:PORT="3000"; (Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev" -RedirectStandardOutput "<log>" -RedirectStandardError "<log>.err" -WindowStyle Hidden -PassThru).Id'
  ```

  Start-Process must name the executable exactly (`npm.cmd`, not `npm`); stdout and stderr need
  **different** files. The command may appear to hang the calling shell — the detached server is
  fine; confirm it instead of retrying:

  ```bash
  powershell -NoProfile -Command "if (Get-Process -Id <pid> -ErrorAction SilentlyContinue) { 'pid alive' } else { 'pid DEAD' }"
  curl -s -o /dev/null -w "%{http_code}\n" --max-time 20 http://localhost:3000/
  ```

- **Do not run `npm run build` while the dev server is up** — it overwrites `.next/`, and the dev
  server then 404s its own chunks (`/_next/static/chunks/...`). Restart it after any build.

  The failure mode is worse than it sounds, and worth knowing because it is silent: the server
  **stays up and keeps answering 200**, so the page renders its server HTML and looks merely
  early — no error, no overlay. What is missing is `/main-app.js`, so **React never hydrates** and
  the page is frozen exactly as the server sent it. A vault that had been working sits on
  "OPENING THE VAULT" forever, and every DOM reading is consistent with it.

  The check that separates this from "the code is broken": ask whether React attached. Zero
  elements carrying a `__reactFiber$…` key means hydration never ran, which is a server problem,
  not a page problem:

  ```js
  [...document.querySelectorAll('div')].filter((el) => Object.keys(el).some((k) => k.startsWith('__react'))).length
  // 0 → hydrate never ran: restart the dev server with a clean .next/
  // >0 → React is live, so read the console for the real error
  ```

  `rm -rf .next` before restarting; the dev server rebuilds it. Servicing the same question from
  the shell: fetch every chunk the HTML references and confirm none is a 404. The bare
  `/main-app.js` may 404 while `/main-app.js?v=<hash>` is fine — the `?v=` is part of how Next's
  dev manifest resolves, so always test the URL as the page writes it.
- Then register the preview: `register_preview` with `url: http://localhost:3000` and the
  listener pid from `netstat -ano | grep LISTENING | grep ":3000"`.

## 3. Deploying to Vercel (production)

The project deploys with the **CLI**, not a git integration: `vercel ls` shows deployments
authored by `meglast320-1694`, and a `git push` does not trigger a build. From this worktree:

```bash
vercel --prod --yes --scope meglast320-1694
vercel alias set <the-new-deployment-url> dungeon-knights.vercel.app --scope meglast320-1694
```

**Pass `--scope` explicitly.** Without it the CLI reads `.vercel/project.json`'s `orgId`
(`team_PBaj3VVHW4j3Jp0BpN2vczV8`) and the deploy dies with a bare `Error: Not authorized`,
even though `vercel whoami` succeeds and `vercel project ls` lists the project — reads resolve
the scope fine, only the write is refused, so the error points at the wrong place. Naming the
scope makes the same command succeed (`✓ Ready in 41s`).

**The second command is not optional.** `--prod` publishes to and aliases
dungeon-knights-meglast320-1694.vercel.app, and leaves the project's custom domain
`dungeon-knights.vercel.app` pointing at whatever it pointed at before — so a successful deploy
is invisible at the URL people actually open. Always re-alias, then verify the *custom* domain,
not the deployment URL.

### Environment variables (production)

`vercel env ls production` is the source of truth; env changes need a **redeploy** to apply.

| variable | why it is required |
|---|---|
| `PRIVY_APP_ID` | **Set** (type `config`). Turns the embedded wallet on for the phone flow. Before it was set, production answered `embedded: null` and the whole embedded path stayed dormant. Env changes need a **redeploy** — the route is `force-dynamic`, but the deployment still has to exist. |
| `POINTS_SESSION_SECRET` | **Set.** Sessions are HMACs. Without it each serverless instance generates its own random secret, so a token minted by one instance is rejected by the next: a player connects, clears a floor, and is randomly logged out. Measured before/after: 1-of-8 authenticated calls succeeded, then 8-of-8 once set. |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) | **NOT set — required before the Points Program means anything.** Without it the store falls back to per-instance memory. |

Without a shared store the once-per-day rule is enforced **per instance**, so under concurrent
traffic the numbers go wrong in exactly the way a rewards program must not. Measured on a
production deployment with no KV, same wallet, same day:

```
sequential: floor 1 credited 100 PTS
ten concurrent balance reads -> 100, 100, 100, 100, 0, 100, 100, 100, 100, 100   (inconsistent)
six concurrent re-clears of the SAME floor -> credited 100, 100, 100, 0, 100, 0  (paid 5x)
```

That is why the page reports the driver and shows an amber banner when `persistent` is false.
Provisioning a store needs the account owner: `vercel integration add` requires an interactive
terminal and a human accepting marketplace terms.

**Decision, updated in this thread: provision KV.** The earlier choice was to stay on the
in-memory store; the user has since asked for a shared one, so the code is ready and waiting on
two env vars. Nothing else has to change — the driver is already picked by environment.

**Click-through (needs the account owner; `vercel integration add` is interactive and requires a
human to accept marketplace terms, so it cannot be scripted):**

1. Vercel → project → **Storage** → **Create Database** → **Upstash for Redis** → free tier.
2. Connect it to this project, **Production and Preview**. Vercel writes `KV_REST_API_URL` and
   `KV_REST_API_TOKEN` into the project automatically (an Upstash-direct pair,
   `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, is picked up too).
3. **Redeploy** — env changes do not apply to an existing deployment.
4. Confirm it took: `curl -s https://dungeon-knights.vercel.app/api/points/me` will still 401, so
   check the page instead — the amber "points are not persistent" banner disappears on its own,
   because it is driven by the store's own report:

   ```bash
   curl -s https://dungeon-knights.vercel.app/api/points/leaderboard | head -c 200
   # after a real sign-in, GET /api/points/me reports storage.driver = "redis", persistent = true
   ```

### The once-a-day guard (`claimGuard`)

The floors and the share bonus are each claimed atomically before anything is paid. Without it,
`getWallet` + `updateWallet` are two steps and two overlapping requests both pass the "not cleared
yet" check:

```
six concurrent re-clears of the same floor -> credited 100, 100, 100, 100, 0, 100, 0
```

Redis does this with `SET … NX EX` (atomic across instances); the file and memory drivers use an
in-process set, which is only enough inside one process. **The guard is therefore only
cross-instance once KV exists** — and production does not have KV yet, which was measured on the
live deployment rather than assumed. Twelve simultaneous clears of today's first floor on one
wallet, signed in as a throwaway wallet through the real challenge/signature flow:

```
said-credited: 12 of 12, final balance: 100
```

Every instance kept its own ledger and paid the floor, and the balance still *looked* right only
because each of them wrote `0 + 100` over its own copy. The visible symptom before that is
milder and easier to attribute: two requests read different balances, and the leaderboard
reshuffles between reloads.

The floor's record is written **before** it is paid. A failure in between credits nothing (logged
loudly with the address, day and amount) — a missed payment can be replayed by hand, a double
payment cannot be taken back.

```bash
node tools/check-points-guard.js http://localhost:3000   # 9 checks, 8-way concurrency, one process
node tools/check-kv-store.js                             # 6 checks, two processes, no account needed
```

`check-kv-store.js` is how the guard gets proven *before* KV exists: it runs the real
`clearLevel` in two child processes against one shared store — a fake that speaks the Upstash REST
dialect, with `SET NX` atomic — so the redis path is exercised for real. With a shared store, two
processes × 8 overlapping clears produce **exactly one** payout and both read back the same
balance; without one, they each pay the same floor. It is also the regression test for the
multi-instance bug, since nothing else in the repo can produce two "instances" at once.

### `.vercelignore` — anchor every root-only path

Patterns are gitignore-style, so an unanchored `points/` also matches `app/points/`,
`app/api/points/` and `public/assets/points/`. That shipped a deployment which **built green and
had no Points Program at all**: `/points` 404'd and the vault had no art, while the build log
looked perfect. Only `/art/`, `/arya/`, `/points/`, `/tools/`, `/docs/` are excluded, all anchored.

Quick post-deploy check that catches that class of failure:

```bash
for p in / /points /menu /mint /dungeons /game \
         "/api/points/session?address=0x1111111111111111111111111111111111111111" \
         /assets/points/background.mp4 /css/points.css /sprites/manifest.json; do
  printf '%-70s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "https://dungeon-knights.vercel.app$p")"
done
```

### The Hall of Fame and a player's record (on-chain events)

Both read the game contract's own logs, server-side, with no indexer and nothing to keep in
sync:

```bash
curl -s 'http://localhost:3000/api/game/leaderboard?limit=5' | head -c 300
curl -s 'http://localhost:3000/api/game/history?address=0x038d…' | head -c 300
node tools/check-logs.js      # 28 checks: signatures, decoding, sweeping, then the live chain
```

Three things worth knowing, each of which was a real defect before this existed:

- **The event signature is the whole query.** `public/leaderboard.js` used to query
  `DungeonCompleted(address,uint256,uint256,uint256,uint256,uint256)` from the browser while the
  contract emits `(address,uint256,uint256,uint8,uint256,uint256)` — a different topic hash, so it
  matched nothing and the board said "no claims yet" forever, which looks exactly like a quiet
  game. `tools/check-logs.js` pins both hashes and re-encodes logs through the same interface, so
  the round trip is proven rather than assumed.
- **The sweep starts at the contract's deployment block**, found by an `eth_getCode` binary search
  (~27 calls) and cached, not at block 0 — the chain is 121 million blocks tall, and walking it in
  20,000-block windows is over 6,000 RPC calls. A node that refuses a wide `eth_getLogs` outright
  still gets swept in windows, which is why both paths exist. Set `GAME_FROM_BLOCK` to skip even
  the search.
- **The ranking is money that actually moved**: `RewardsClaimed` (emitted after the transfer),
  not `DungeonCompleted`. 900 DNG of runs nobody claimed is not an achievement yet. A player's
  own record lists both, so the page can show a run they have not claimed.

The game's **History** button opens that record (it used to navigate to `claim-history.html`, a
file outside `public/` that the site never served — a 404), and **Stats**, which logged *"feature
coming soon"*, now opens the same panel.

### Watching the game

`/game` redirects to `/menu` unless a squad is selected (`localStorage.selectedKnights`). To drive
it headlessly, seed a squad and click DEPLOY:

```js
const L = { name:'Legendary', multiplier:15.0, color:'#FFD700', tier:'LEGENDARY', dropRate:0.01, dungeonReward:150, dailyRuns:4 };
localStorage.setItem('selectedKnights', JSON.stringify(
  [1,2,3,4,5].map(i => ({ id: 500+i, rarity: L,
    stats: { power:250, range:1, speed:15, maxStamina:6000, recoveryRate:90 },
    stamina:6000, state:'idle', totalEarned:0 }))));
```

Freezing the animation loop for a screenshot breaks the rAF chain — restore it with
`game.gameLoop = game.constructor.prototype.gameLoop` and re-kick
`requestAnimationFrame(t => game.gameLoop(t))`, or the game stays frozen forever.

Building the squad with the engine's own class is safer than hand-writing the objects
(`new Knight(id)` gives `stats.range: 1`, which is what makes it melee, and a `rarity`
*object* rather than a tier name — a squad missing `range` deploys, reports `attacking`,
and deals no damage at all, which reads exactly like a broken engine).

**`selectedDungeon` must be one of `crypts / mines / temple / magma / void`** — the keys of
`DUNGEONS`, not a display name. Any other value, including a stale key left in a browser from
an earlier map rename, throws at boot and the game never starts:

```
❌ Failed to initialize game: TypeError: Cannot read properties of undefined (reading 'name')
    at Dungeon.addObstacleDecoration (dungeon.js:369)   // this.config is undefined
```

`new Dungeon(type)` sets `this.config = DUNGEONS[type]` and then uses it unguarded. Not fixed
here — the dungeon keys and the map art are being changed by hand right now, which is exactly
when a stale `selectedDungeon` reaches a player, and defaulting an unknown key to `crypts` is a
one-line call someone should make deliberately.
