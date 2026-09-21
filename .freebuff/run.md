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

What is built, verified and **off**, waiting only on a value — no code change is needed to
switch any of these on. The rows that used to sit here for V4, capsules and real Genesis
holdings are **done**: all nine Phase 2 contracts are deployed on chain 46630 and the site reads
them (see `docs/DEPLOY-PHASE-2.md`, *The production switch*). So is **Points Program persistence**:
Upstash Redis was provisioned in this thread, `KV_REST_API_URL` + `KV_REST_API_TOKEN` are set for
Production, and the live deployment was measured reading the shared store — the evidence is in
*The Points Program is server-backed*, **KV: provisioned**.

| what | what is missing | where the steps are |
|---|---|---|
| The X-account gate | nothing — it is enforced server-side and works today. A **provisional** binding (a typed handle) is enough to earn; proving it needs Privy's Twitter method enabled on the app | *Earning on X* |
| The +500 engagement task | `X_CAMPAIGN_POST` — the campaign post's URL. Until it is set, `tasks.campaign` is `null` and the card hides itself rather than offering a reward with nothing to quote. `X_ENGAGEMENT_REWARD` (default 500) and `X_CAMPAIGN_KEYWORD` (an alternative to the site link) are optional | *Earning on X* |
| Mobile wallets | `PRIVY_APP_ID` (+ `PRIVY_CLIENT_ID`), and the chain enabled for the app | *Wallets: injected first…* |
| Phone gas | players fund their own embedded wallet | *Wallets: injected first…* |
| **Staking writes** | the approve/stake/claim transaction path, then `STAKING_WRITES_READY` in `lib/staking-config.js` — the page stays a labelled simulation until then, by design | *The Staking Vault* |
| **Checking a follow** | *only if you want it checked*: register `/api/x/events` with X, subscribe our own account, then set `FOLLOW_PROOF_MODE=webhook`, `X_CONSUMER_SECRET` and `X_FOLLOW_TARGET_ID` for Production. Until then the follow is taken on the player's word and the card says so | *Proving a follow: X's Activity API* |

One thing on chain is **not** a switch at all, because it touches custody: the old **V3** game
(`0xD8de…36e5`) is not paused and still holds 811 old-token DNG, so its unsigned claim path is
open to anyone who calls it directly. `tools/check-v4.js` fails on exactly this and nothing else,
and it is left undone on purpose — pausing V3 ends the legacy claim path the old collection uses,
and the follow-up `withdrawAllTokens()` moves funds. The intended order is `pause()` →
`withdrawAllTokens()` → fund V4, and both steps are the owner's call.

Until each one is set, the deployment is honest about it rather than pretending: the X-binding card
says a typed handle is enough to earn while proving it needs Privy's Twitter method, the campaign
card hides itself when there is no post to quote, and the Staking Vault labels itself a simulation.
(A fifth row used to sit here for points persistence. It no longer does — the store is live, and the
page's amber "not persistent" banner is gone with it.)

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
  the derived Genesis line; `KNIGHTS_POOL_DNG` overrides the Knights one. Neither needs a rebuild.
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
- **Preview vs chain** — `/api/staking/config` reports `chain: false` while any of the five
  addresses is missing (Genesis NFT, both staking contracts, raffle, capsules — the vault is
  reported separately because the economy is derived either way), and the left panel wears a
  **Preview data** badge. Holdings are seeded deterministically from the wallet, so the same
  address always sees the same knights on a deployment with no contracts configured.
- **"Deployed" and "this page can stake" are different facts, and the badge depends on the
  second.** `simulated` used to be derived from `chain`, which meant pointing a deployment at
  real addresses would have deleted the warning from a page whose buttons still send nothing.
  It now follows `STAKING_WRITES_READY` (`lib/staking-config.js`), reported by the config route
  as `writes`. Flip it only alongside an approve/stake/claim path — `tools/check-staking.js`
  fails if the flag and the client's code disagree, and the banner has a distinct sentence for
  each of the three states (no collection / contracts deployed but unwritable / reachable).
- **The two badges have two classes.** `sv-preview-badge` means the holdings are invented;
  `sv-sim-badge` means they are real and the stake is not. They shared `sv-preview-badge is-sim`
  once, so a check for the absence of one matched the other. A harness check now fails if they
  are merged again.
- **The board is labelled from the snapshot, not from the click.** `selectCollection` keeps the
  previous board on screen (`quiet`), so deriving `isKnights` from the selected collection
  captioned the old side's figures with the new side's words for the length of a read — a tile
  headed "The Genesis staking line" quoting the Knights pool. `boardCollection` reads the
  collection the snapshot actually describes.
- **Both collections are read the same way.** `collection=genesis` used to be refused with a
  hard-coded "not minted yet" while the config route reported the side live — one route claiming
  a thing the other denied. Both now resolve the address from `ADDRESSES.genesisNFT`, and a
  deployed-but-empty collection is an empty read (`ok: true, balance: 0`), not a refusal.
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
`0x27Cfbb763188a50Fe1C0fFfBe2552b1945eE1B2D` (env `KNIGHT_NFT_ADDRESS`, defaulted in
`lib/game-runs.js`). It used to show invented ones to every visitor.

> **This address is the third one, and the history matters more than the address** (September 21).
> The first collection, `0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512` (symbol `KNIGHT`, **not**
> enumerable, holding **47** knights in the owner wallet), is **no longer read by the app
> anywhere** — a deliberate choice, not an oversight, and those 47 knights are inert by decision.
> The second, `0xFB738bE682a0a60678A393eB7e23742B3137d4c5` (symbol `DKN`), was deployed but could
> not be minted into at all — `summon()` never collected the player's fee — so it was replaced
> first, not later. The live one is the repaired collection; **no new knight could exist before
> it, which is why the vault had nothing to show.** Everything further down that says "45
> knights", "cannot be enumerated" or "the deployed collection" is history.

- **Enumerability is asked, not assumed.** `readOwnedKnights` probes the collection it is handed —
  `supportsInterface(0x780e9d63)` — and `NFT_ENUMERATION.enumerable` is the *published expectation*
  that `tools/check-staking-chain.js` asserts the probe against. This is not pedantry: the reader
  was written when the answer was **false** and now runs against a collection where it is **true**,
  and a constant used as the reader's own switch would have been wrong in exactly one of those two
  eras. A collection that does not answer `supportsInterface` is treated as non-enumerable rather
  than as an error.

  | collection | `supportsInterface(0x780e9d63)` | `totalSupply()` | path taken |
  |---|---|---|---|
  | live `0x27Cfbb76…1B2D` (`DKN`) | **true** | 1 (Knight #1) | owner index |
  | retired `0x06c7D4b0…0512` (`KNIGHT`) | **false** | reverted | transfer logs |

- **Balance first, then ids.** The read asks `balanceOf` before anything else, so a wallet holding
  nothing is answered without a single per-token call or a chain-wide log query. Asking for ids
  first is what made an empty wallet look like a failed read.
- **The log scan is the fallback, and it is kept exercised.** `Transfer` is indexed on `to`, so one
  `eth_getLogs` filtered to the wallet returns every token it was ever sent — 47 ids for the owner
  wallet on the retired collection, in one request, with the cost independent of collection size.
  `tools/check-staking-chain.js` runs this path against that collection on every check, so the
  fallback cannot rot into untested code now that the live collection no longer needs it.
- **Do not "scan ids until a gap".** It is the obvious approach and it is wrong: ids in the
  retired collection are **not contiguous** — the harness reports *47 ids with 4 gap(s) between
  them* — so stopping at the first gap returns a short list that still looks successful. The
  harness pins this by comparing the confirmed count against the contract's own `balanceOf`, which
  catches the whole class at once.
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
- **A real knight can still be staked, and that is a simulation.** `chainSnapshot` used to answer
  `canWrite: false` for the whole vault the moment staking was undeployed, which turned 45 real
  knights into a page with **every control dead** — indistinguishable from a broken page, and it
  hid the mechanics the vault exists to show. A side with a real collection is now `canWrite: true`
  with `simulated: true`, and says what it is in three places: the badge (*"● Real knights ·
  simulated staking"*), an amber banner in the panel, and a **Simulated** chip on anything the
  player has staked. A side with **no** collection is still genuinely inert (`canWrite: false`,
  `simulated: false`) because there is nothing to act on.
- **Two different claims must never share one sentence.** "The knights are invented" (the preview
  badge) and "the knights are real, the stake is not" (the simulation badge) are separate claims,
  and a player acting on one must not be reading the other. The route's `reason` string used to end
  *"…so this vault is showing preview data"* and the simulation banner repeated it verbatim to a
  player looking at their own 45 knights. **The route now states the fact and carries no verdict**
  about what the page is showing; the snapshot and the page say what it means. Pinned by
  `check-staking`.
- **The node throttles, so a page load must not depend on one clean read.** A read is three calls
  (logs, `balanceOf`, the ownership batch) and one load can ask twice, and **HTTP 429** then
  produced *"the chain could not be read just now"* over a wallet's real knights. Two fixes:
  `rpcBatch` retries four times with exponential backoff **plus jitter** (a fixed pause
  synchronised across concurrent readers is the worst thing to send at a throttling node), and
  `/api/staking/holdings` holds a wallet's answer for **30 seconds** — 2.48s → 0.007s on a repeat
  request. It is a cache, not a store: failures are never remembered, so a throttle is followed by
  a real retry.
- **Ownership is read live even while staking is not.** `staked` starts empty because nothing has
  been staked yet, not as a placeholder.

Verify it:

```bash
node tools/check-staking.js        # 187 checks: week clock, tickets, capsule odds, actions,
                                   #   the real-holdings wiring and the simulated-stake state
                                   #   (fetch stubbed, no network)
node tools/check-staking-chain.js  # 19 checks: the collection's shape and a live wallet read
node tools/check-rarity.js         # 64 checks: the economy, capsule outcomes, and the two
                                   #   hall panels' art
node tools/check-arya.js           # 17 checks: who may open the walkthrough, and that the
                                   #   pages only ask for it unforced (see below)
node tools/check-wallet-menu.js    # 10 checks: every route derived from app/ has a wallet
                                   #   control and loads the module that opens My Portfolio
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

**87 checks on the current deployment** (more when nothing is live, because the preview-only
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
Knights rising to 5,000 at the 10,000 reference size, flat above it**, with the break-even
marker at **57.46%** of the track (5,746 Knights, where the 200 weekly opens alone start
covering both Knights reward lines). Three things about it are deliberate:

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
  | `/vault` | `POST {action}` | `clear` a floor, or `share` **with `url`** for the ×2 bonus — the only way points are awarded |
  | `/x` | `GET` / `POST {action}` | what this wallet has bound and whether this deployment can prove a link / `bind` (with an optional Privy `accessToken`) or `unbind` |
  | `/task` | `POST {action, task, url}` | `submit` the link to a post for `campaign` or `share`, or `check` a pending one again |
  | `/leaderboard` | `GET ?limit=` | the public board (`isYou` when a token is sent) |

### Earning on X — the gate, and the two verified rewards

Nothing in the program pays a wallet that has not **bound an X account**, and the two things done on
X are paid only after X itself has been asked about the post. Both rules live on the server:
`lib/points-program.js` refuses every award with `code: 'x-required'`, and `lib/x-verify.js` is the
only thing that decides whether a post exists, who wrote it, and what it says.

- **The verifier is free, and that is the point.** `lib/x-verify.js` asks X's public oEmbed
  endpoint (`publish.twitter.com/oembed`) — no key, no credits, no account — which returns the
  post's **author handle**, its **author URL** and its **text**. From those it proves everything the
  rewards need: the post exists, the *bound handle* wrote it, and it says what its task requires —
  the campaign's repost carries our site's host, a **share tags `@DNGrobinhood`** (`X_SHARE_TAG`,
  case-insensitive, boundary-matched so `@DNGrobinhoodFan` does not count). A 404 is "X has not
  indexed it yet" (retryable, held as `pending`); a **200 that is not a post** is the profile-URL
  case and is refused by validating the response *shape*, not just the status code. What oEmbed
  cannot prove is a *like*, a *retweet* or an **attachment** — those need paid API credits or a
  zkTLS proof. That last one is why the share's picture travels as the post's **link preview**
  instead (see below).
- **The binding is one X account, one wallet, and it cannot be handed back.** The index
  (`dk:points:xindex:<key>`) is written before the wallet record and is the arbiter, so two wallets
  racing for one account cannot both win. Three rules hold it together, and each exists because
  removing it handed out points twice:
  - **`unbind` is answered, never honoured** (`code: 'x-locked'`, HTTP 403). Binding an account to a
    second wallet is the farm loop: the floors, the share and the daily caps are all counted *per
    wallet*, so bind → earn → unbind → bind again paid both wallets. The button is gone from the
    card and the route still answers the action with the sentence, so an older bundle is told why.
  - **Every binding claims its handle (`handle:<name>`) as well as its account id.** The two keys
    used to be reachable separately: a wallet bound by id while another *typed* the same handle,
    and both earned for one X account. Switching to a different account is still allowed — the
    account left behind **keeps** the original wallet's claim, so it can never be handed on.
  - **A claim that has already earned cannot be taken over.** A *proved* binding (the server
    checked a Privy access token) still takes a **provisional** one over — that is how a typed
    handle that was never the player's ends up with the account that can prove it — but only if
    that claim has earned nothing. `pointsAtBind` on the binding is the snapshot that tells the two
    apart, and the refusal is computed **before any write**, so a refused bind leaves nothing behind.
  A provisional binding is what makes the feature work **today**, with no Privy dashboard change.
- **Proof without a secret.** `lib/privy-verify.js` verifies a Privy access token with
  `node:crypto` against the app's **public JWKS** (`auth.privy.io/api/v1/apps/<id>/jwks.json`) —
  signature, `iss`, `aud`, `exp` — and then reads the linked accounts from `GET /api/v1/users/me`
  with the same token. No `PRIVY_APP_SECRET`, no dependency, and no trust in the browser: the claim
  the page sends is only used when the proof cannot be made, and the record says which happened.
  What a *provisional* binding is worth is worth stating: **nothing can be earned with one**, because
  a post from that handle is what pays.
- **A share needs the tag, and the post is written for the player.** `shareEntry(address, url)` is
  the same verified task the campaign uses, with the day's doubled total as its reward. The text
  — *"I just cleared all three Points Vault dungeons today and racked up 1800 points @DNGrobinhood
  <their invite link>"* — is built **on the server** in `lib/points-config.js#sharePostText` and
  reaches the page as `state.share`, so the words the player posts and the words X is asked about
  are written by one function. The amount is fixed **at submission time**, so clearing another
  floor afterwards cannot raise the bonus on a post already published, and a share whose day rolls
  over before X confirms it is `expired` rather than paid.
- **The picture reaches the post two ways, and which one a device gets is decided *before* the
  click.** X's composer link (`twitter.com/intent/tweet?text=…`) can prefill **text only** — posting
  an image on a player's behalf needs the paid API — so `/points` declares `points-og.jpg` as its
  Open Graph / Twitter card in `app/points/page.js` and the invite link every share carries unfurls
  into that picture; that works everywhere with nothing to attach. For a real attachment there are
  two routes, picked by **pointer** rather than by poking at capabilities:
  - a **touch** pointer where `navigator.canShare({files})` agrees → the OS share sheet, the one path
    that puts the file *in* the post as a file;
  - everywhere else → the composer opens and the picture goes on the **clipboard** as a PNG
    (`toPngBlob` — the clipboard takes nothing but PNG and the card is a JPEG) to paste with Ctrl+V,
    falling back to a saved file when the write is refused.

  The picture is fetched and encoded **once, when the kit appears**, never inside the handler:
  `navigator.share()` and `window.open()` are both only allowed the gesture that started the click,
  and an `await` inside the handler spends it. What this cannot be is *verified* — oEmbed cannot see
  attachments, so X is asked about the author and the tag, and the card says as much rather than
  implying otherwise.

  **The share button did nothing at all on a desktop, and the shape of that bug is worth keeping.**
  `composeShare` tried the share sheet first, guarded on `navigator.share` **existing** — which it does
  on desktop Chrome/Edge — fetched the picture with an `await`, and then `return`ed from that branch.
  So on a computer it either handed the run card to the *Windows* share sheet (which has no X in it, so
  the composer never opened) or, when the sheet could not take files, reached `window.open` only after
  an `await` — a spent gesture a popup blocker may refuse. Measured by clicking the real button with
  `navigator.share`, `window.open` and `navigator.clipboard` instrumented, which is the only reason
  the branch was not guessed at:

  | condition | before | after |
  |---|---|---|
  | no `navigator.share` | composer in 5 ms | composer in 1 ms, PNG to clipboard |
  | `navigator.share`, files shareable (**desktop Chrome**) | **composer never opened** | composer in **0 ms**, PNG to clipboard |
  | touch + files shareable | share sheet (1 file) | share sheet (1 file) — unchanged |
  | `navigator.share`, files not shareable | composer after the fetch (12 ms) | composer in 0 ms, PNG to clipboard |

  The fix is the ordering, not a new feature: the sheet is offered only to a touch pointer, and the
  composer opens **synchronously in the same task as the click** — with the clipboard write *started*
  before it, since a new tab takes the focus and a background document cannot write to the clipboard.
  A refused `window.open` now says so on the card instead of leaving a dead-looking button, and it says
  whether the picture still made it to the clipboard, because that is enough to finish by hand.
- **The states, and the words for each.** `pending` (X has not indexed it — a real answer, not an
  error), `verified`, `failed` (X answered and the post is not yours / no tag / no link), `expired`
  (no good answer within the attempt ceiling, or the day ended first). The throttle is server-side
  and handed back as `retryInSeconds`, so the button counts down instead of looking broken.
- **The one-time tab, and a follow that can be checked or taken on trust.** The second tab on the
  left panel pays once per wallet, ever, under the same atomic claim the floors use (`claimGuard`) —
  and it requires a bound X account exactly as every other award does. Its first task is a **follow**,
  and no free X endpoint can see who a player follows (oEmbed has no view of follows, likes or
  reposts either), so the reward has **two modes** and the card is written from whichever is live:
  - **`claim`** — the default, and what production runs today. Nothing about the follow is checked,
    so a claim is **not paid on the spot either**: it is recorded as `pending`, given a window drawn
    once per claim (30–45 minutes, `review.minMinutes`/`maxMinutes` in `lib/points-config.js`), and
    credited when that window closes — on the player's next visit, or on a tap of **Check status**,
    since there is no scheduler here and the player's own request is the clock (`settleDueClaims`,
    called from `stateFor` and `claimOneTime`). The window is a real closure, not a flourish: an
    entry that still waits can be **turned down** before it pays, and a real follower can be paid
    early, through `tools/points-pending.js`. That is what the word "review" on the card is standing
    on — without that tool it would be a word the page said about nothing. A rejection is final
    (`state: 'rejected'` is refused by `claimOneTime` before anything else), and a claim already
    paid is never re-judged.
  - **`webhook`** — X pushes a `follow.follow` event to us (see below), so the reward is paid
    against **X's own record**. A wallet X has said nothing about is refused with
    `code: 'follow-required'` **before** the guard is taken, so a player who has not been seen
    following us yet is not locked out of the claim for the guard's ten minutes.
  The mode is decided by `followProofMode()` in `lib/x-webhook.js` and chosen by the **server**:
  `state.oneTime[].blurb` / `claimedNote` / `pendingNote` and `state.followProof.mode` are built in
  `lib/points-program.js`, because a page that answered that question from its own bundle could
  advertise a check nothing is running. What is *not* on their word in either mode is the account: a
  binding cannot be moved to a second wallet, so one X account cannot claim the same task twice. The
  record (`one:follow`) is namespaced so it cannot collide with the X tasks' ids, and its copy
  carries the handle as `{handle}` for the **server** to fill in — `X_SHARE_TAG` is not
  `NEXT_PUBLIC_`, so a client that read it would render "follow @undefined".
- **Four quote-reposts, one per campaign post, and each one is *checked*.** A second kind of
  one-time task lives beside the follow: `lib/points-config.js`'s `ONE_TIME_POSTS` names one of our
  posts per task (`X_QUOTE_REWARD`, 500 each), and `ONE_TIME_TASKS` spreads it with `proof: 'verify'`.
  The bargain is the one the campaign and the daily share already use — **paste the link to your
  post** and `submitTask` asks X about it — so the card is the same `XTaskCard`, and the claim
  endpoint is shut for them (`submit-required`), or the tap would pay a checked task with its
  verifier bypassed.
  - **What the check can and cannot see.** X's free embed carries only the *quoting* post's own text
    — the post it quotes is not in it — so neither the verifier nor anything else free can tell
    **which** post was quoted. X is therefore asked two things: that the post is the player's, and
    that it tags `@DNGrobinhood`. Quoting the post named on the card is on the player, and every
    card says so in those words (`QUOTE_CHECK_NOTE`), which is the same rule the follow card lives
    by: never imply a check that cannot run.
  - **Four asks are four chances to be paid once, so the wire refuses that.** `submitTask` records
    the post against the task that paid it and answers `post-already-used` to any other one-time
    task trying to file the same link, so a single post cannot collect all four. The worst case is
    four junk posts, not one post and 2,000 points.
  - **Different words per card, on purpose.** Four cards reading the same sentence read like one
    task repeated and give the player no way to tell which post a card is about without opening it,
    so each carries its own `title`, `cta` and `hint`; only the `QUOTE_CHECK_NOTE` sentence about
    what is checked is shared.
  - **`taskConfig` grew a `onetime:<id>` kind** (`lib/points-program.js`) that resolves through
    `oneTimeTaskByKind`, so the verified path and the claim path ask different questions of the
    registry: the claim path takes an **id**, the verified path takes a **kind**, and a task that is
    `claim` has no `kind` at all — which is what keeps the follow out of the post-paid path for good.
- **Proof is recorded per claim, not per task.** The record keeps `proof` as it was **on the day it
  was paid** (`claimedProof` in state), so wiring the webhook later does not retroactively upgrade a
  claim that was taken on trust — the card keeps saying "claimed on your word, no check ran" for
  exactly the claims that were. The `claimedNote` sentence is composed on the server for the same
  reason the blurbs are.
- **Privy's Twitter must be enabled for the *proved* path** (see the switches table): without it a
  player can still type a handle and earn. The bridge exposes `getXAccount()`, `linkX()` and
  `getAccessToken()` for exactly this.

**Do not run `next build` while the dev server is up.** Both write `.next`, so the build pulls the
plugin's state out from under the running server and `/points` starts answering **500** — which looks
like the change you were testing just broke the page. (Measured: a build during a live session took a
200 right to a 500 with nothing wrong in the code.) Stop the dev server, `rm -rf .next`, restart it,
and warm the route before believing anything. The same goes for verifying a fix locally *while*
deploying one.

A note on the live ones: a `next dev` that has been up for hours and recompiled many times starts
answering **404 to real routes** under a burst of requests, which reads exactly like a broken change.
It is the server, not the code — restart it and warm the routes with a couple of curls before
trusting a live harness (`for p in /points /api/points/session /api/points/vault; do curl -s -o
/dev/null -w "$p %{http_code}\n" localhost:3000$p; done`). This cost an hour of chasing a failure
that was never there.

```bash
node tools/check-points-x.js    # 161 checks, offline: a stubbed X and a stubbed Privy, real ES256
node tools/check-x-verify.js    # 63 checks: the verifier alone, against a stubbed oEmbed
node tools/check-x-webhook.js   # 51 checks: the follow webhook — real HMACs, both envelopes, no network
node tools/check-kv-store.js    # 6 checks: the guard across two processes (and why KV matters)
node tools/check-points-guard.js http://localhost:3000   # 21 checks: the live routes, gate included
node tools/points-pending.js                            # the review queue: list, --approve, --reject
node tools/check-follow-gate.js http://localhost:3100   # 17 checks: the follow gate, live — needs
                                                        # X_CONSUMER_SECRET + a server in webhook mode
node tools/check-follow-gate.js http://localhost:3000   # 11 checks: the review window, live — it
                                                        # closes its own window by hand on loopback
node tools/check-follow-gate.js https://dungeon-knights.vercel.app --read-only   # 1 check: which mode
                                                                                 # the deployment runs
node --env-file=<pulled.env> tools/check-follow-gate.js \   # 9 checks: the review window on the
  https://dungeon-knights.vercel.app --against-live          # live store — writes, then cleans up
```

`--against-live` **needs the store's credentials in this process** (`npx vercel env pull … --yes`),
because it has to take its own wallets back out again; without them the run refuses to write rather
than leaving test data in production. The pull is not optional and not a formality — see below.

#### The review window, verified on the deployment (September 21)

The deployment is the only place `claim` mode's window can be measured end to end, because it is the
only one whose store is shared — and that is also why the harness has to be *asked* to do it:

```
node tools/check-follow-gate.js https://dungeon-knights.vercel.app --read-only      → mode: claim
node --env-file=<pulled.env> tools/check-follow-gate.js … --against-live            → 9/9
  ok  the server publishes its follow-proof mode (claim)
  ok  this shell reaches the store the server uses (redis)         server redis · this process redis
  ok  a binding succeeds without a Privy proof
  ok  the claim is recorded rather than paid, and given a window   HTTP 200 credited 0 pending true
  ok    … and the balance is untouched while it waits              points 0
  ok    … and the deadline is inside the window the task declares  33 min of 30–45
  ok  a second claim repeats that deadline and pays nothing        HTTP 200 pending true
  .   window not closed by hand — the store is not the local file, so the claim stays pending
  ok  2 wallet(s) this run created: nothing of them is left in the store
  ok    … and the once-only guard slot the claim took              1 guard key(s) removed
```

and what the live page is *handed* for that wallet (a real signed session against the deployment,
`GET /api/points/me`) — these are the fields the card prints, so the card's sentence is the
**server's**, not the bundle's:

```json
{ "title": "Follow us on X", "reward": 500, "cta": "Follow @DNGrobinhood",
  "blurb": "Follow @DNGrobinhood on X, then claim. Follows are verified manually, so points are
            granted after review — usually within 30–45 minutes — and the task pays once per X
            account, ever.",
  "claimed": false, "pending": true, "rejected": false,
  "settleAt": "2026-09-21T18:53:00.432Z",
  "pendingNote": "Claim received · credited after review",
  "reviewWindow": { "minMinutes": 30, "maxMinutes": 45 } }
```

That renders as `Claim received · credited after review · by 6:53 PM` over a **Check status** button.
Both halves were confirmed present in the *deployed* chunk
(`/_next/static/chunks/app/points/page-*.js`, found by grepping every chunk `/points` references for
`Check status` / `credited after review` / `Not approved` / `settleAt`) — the card cannot be driven
from here, because the preview webview is loopback-only and there is no headless browser in
`node_modules`, so the render path is pinned by string and the *data* is pinned by the live API.

#### Cleaning up on a shared store — and why the run now does it itself

A shared store has no file to put back, so the first live run of this harness **left its test wallets
in production** — a pending claim, a binding, a guard key and a leaderboard entry, cleaned up by hand
with a one-off `SCAN`. That is not a state a harness should be able to get into, so it no longer can:

- **`purgeWallet(address, { ids, handles })`** (`lib/points-store.js`) removes one wallet completely —
  its record, its X-account claims, its guard slots, its review-queue member, its board entry, and the
  follow facts filed under the identities the caller says it created. It is **driven by
  `walletKeys(address, …)`**: that function finds every key naming the wallet, purge deletes what it
  returned, and then asks again — so `survived` is *measured*, and the one remaining piece of key-shape
  knowledge is the two member sets (`SREM`/`ZREM` rather than `DEL`). Every match is on the **whole
  address**, lower-cased; the X-account index is matched on its **value**, because the key is the
  account and that shape belongs to `points-program`. `ids`/`handles` are arguments rather than
derivations for a reason: a fact is filed against an X account, and guessing them would eventually
delete a fact about **our own** account — a real follower told they are not following.
- **The harness refuses to write to a store it cannot reach.** It compares the driver the *server*
  reports (`state.storage.driver`) with the driver its own process would use, and stops before the
  first binding if they differ, naming the fix. That is the guard that matters: the original mess was
  produced by `--against-live` from a shell with no credentials, where cleanup was impossible by
  construction. Measured: `--against-live` with no `--env-file` → `FAIL this shell reaches the store
  the server uses (redis) — server redis · this process file`, one check passed, nothing written, and
  the store census unchanged.
- **So does the residue check.** Two lenses, because they fail differently: the purge's own read-back
  catches a deletion that did not happen (a stubbed `DEL`, a key its scan never matched), and the
  store's *public* reads (`getWallet`, `rankOf`, `pendingList`, `xBindingOwner`, `followFact`) catch a
  record still answering questions after its keys are gone.
- **Two drivers, two shapes for the guard.** On `redis` the once-only guard is a key
  (`dk:points:guard:<name>`) and the purge removes it, which is asserted by name. On `file` and
  `memory` it is a slot in the **server's own process** (`memoryGuards`, TTL and nothing else), so
  there is no key to find and the check *says so* rather than failing — the first version of it
  reported "the guard scan matched nothing" on a clean file run, which is a check failing for being
  right. The file driver's purge is otherwise the same code and was verified directly, from a
  throwaway cwd: **5 labels found → 5 removed, 0 survived** (record, X binding, both follow facts,
  queue member), and `getWallet` / `rankOf` / `followFact` / `xBindingOwner` / `pendingList` all
  answering nothing afterwards. Worth doing directly because the loopback harness normally takes the
  *snapshot* path and never reaches the file purge at all — it only does when there is no store file
  yet, which is exactly a fresh checkout's first run.

Verified on the live store, key census before and after: **16 keys → 16 keys, 5 guard keys → 5, the
queue holding only the real claim, board 5 → 5, zero keys naming a test wallet.** (Guard keys carry a
600-second TTL, so later censuses read lower on their own — that is expiry, not cleanup.)

Three mutations were run against the cleanup, and each is caught by a *different* check:

| mutation | what the run reported |
|---|---|
| the queue-member `SREM` stubbed | `FAIL … dk:points:pending follow:0xa2b5… ; a pending claim` — both lenses name it |
| the guard-key `DEL` stubbed | `… BUT 1 SURVIVED`, then `FAIL … dk:points:guard:one-time:0x2e05…:follow` |
| the guard **scan** made to match nothing | `FAIL … and the once-only guard slot the claim took — the guard scan matched nothing` |

The second row is the one that earned the rewrite: that mutation originally passed **9/9**, because
the guard check counted what purge *said* it deleted. The third is why the discovery check exists at
all — a read-back only sees what the purge looked at, so "did it even find the key?" has to be asked
separately.

**One pitfall from building this, worth a line:** the throwaway mutation script first kept its
backup across edits, and a later `--restore` silently reverted a rewrite of `purgeWallet` made after
that backup was taken. It now takes the backup fresh on every apply and refuses to apply over a file
that already carries a mutation. A backup is a claim about a moment; reusing it makes the claim false.

Every guard added for the share and the lock was **falsified by mutation** before it was trusted —
and two of them had to be broken *twice*: the earned-claim rule and the handle claim are each
enforced in two places, so weakening one left the behaviour intact and the checks still green. Only
breaking both made them fail by name. That is the point of the exercise; an equivalent mutant looks
exactly like a working guard.

The review window's guards were falsified the same way, and **two of the seven mutants survived the
first attempt** — which is the whole reason for doing it. "A refused claim cannot be paid when its
window closes" passed because the harness only ever back-dated *pending* records, so the rejected
one's deadline never arrived; "a settled claim pays once" passed because the record state is checked
in two places, and removing one left the other holding. Both checks were rewritten and both mutants
now fail by name. The other five: the window removed (six checks fail), the deadline recomputed on
every read (the card's deadline moves under a refresh), a refused claim made claimable again, a claim
inside its window treated as unknown, and an approving tool with both its guard and its paid-check
gone (the second approval pays a second 500).

The follow webhook's guards were falsified the same way — eight mutations, each caught by the check
that names it: an unconfigured deployment accepting an unsigned delivery, an unknown event type
being guessed into a follow, the mode turning on with no secret, the route parsing the body before
checking the signature over it, a claim paid without asking what X said, a claim re-labelled as
checked by a redeploy, the handle fallback removed so a typed binding cannot find its fact, and the
direction check dropped so an event where *we* followed somebody would pay as a follower (45/48,
failing on that check by name).

The four quote-reposts' guards were falsified the same way. Each mutation removes exactly one rule,
and each is caught by name — three of them by a check that only exists because the mutation was run:

| mutation | what the run reported |
|---|---|
| the claim path stops refusing a `verify` task | `FAIL a checked task cannot be claimed with no post at all`, `FAIL … and the balance is unmoved by the attempt` |
| the one-post-one-task guard dropped | `FAIL the same post cannot pay a second one-time task`, `FAIL … and nothing was credited for trying`, `FAIL a post of its own pays the next task` |
| the `@DNGrobinhood` requirement dropped | `FAIL a post that does not tag us never pays` … and, in the quote section, `FAIL and a post of theirs that does not tag us is refused` |
| a registry entry flipped to `proof: 'claim'` | 16 failures, from `the registry carries a quote-repost per campaign post` down to `every task renders the shape its card needs` |

**Two of those mutations crashed the suite instead of failing it, and that mattered more than the
mutations.** Dropping the tag requirement made the *next* check dereference the `reason` of a task
that had not failed — `reason` is `null` exactly when a guard is broken — so the run ended at
`TypeError` with every check after it unreported; and a registry with no quote tasks made the section
throw on its first dereference. A guard that turns a failure into a stack trace is a guard that hides
the next one, so both were rewritten: `reason` is now read through a string (`reasonOf`), and the
quote section reads its tasks through `quoteTaskAt(n)`, which hands back a **task-shaped hole** — a
kind the engine refuses and a reward `Number.NaN` equals nothing — so each check below fails on its
own merits rather than not being run at all. The registry mutation went from one `TypeError` to 16
named failures, and the tag mutation from one `TypeError` to 8.

**What the live page was actually handed and did** (`:3000`, `driver: file`, a throwaway wallet with
a real signed session, purged afterwards with `purgeWallet`). `GET /api/points/me` returned **five**
one-time tasks — the follow (`proof: 'claim'`, `followProof.mode: 'claim'`) and the four quotes
(`proof: 'verify'`), each with its own `postUrl`, `title`, `cta` and `hint`, and the shared
`QUOTE_CHECK_NOTE` sentence. In the DOM all four render as `.x-task` cards with an **Open…** button,
a *Paste the link to your post* input and a **Verify** button, and the left tab carries the count
badge `5`. The two refusals, measured through the page's own session rather than asserted:

```
POST /api/points/task { action:'claim', task:'quote-points' }
  → 400 { code: 'submit-required',
          error: 'That task is paid against a post — paste the link to the post you made.' }
POST /api/points/task { action:'submit', task:'onetime:quote-points', url:<our own post> }
  → { credited: 0, verdict: { code: 'wrong-author',
        reason: 'That post was written by @dngrobinhood, but this wallet has @knighttester bound to it.',
        post: { author: 'dngrobinhood', text: '⚔️ The Points Program is coming to Dungeon Knights…' } } }
  points 0 → 0
```

The second one is the one worth keeping: the verifier **fetched the real post**, read its author and
text off X, and refused on the mismatch — so the check is live, not a stub wearing a card. A wallet
with no X bound gets `Bind your X account first…` on the same button instead. The service worker for
the preview webview is not composited in this environment, so `preview_screenshot` fails here; the
DOM and the API are the evidence, not a picture.

**`tools/check-follow-gate.js` is the half the offline harness cannot reach**: that a *running
server* wires those rules to a wallet's points. It signs in a fresh wallet the way the page does
(real challenge, real signature), then proves the sequence that matters — refused with
`follow-required` while X has said nothing, **nothing paid and no claim recorded** so the refusal did
not spend the once-only guard, paid 500 the moment a signed follow event lands, nothing on a second
claim — plus an unfollow taking it away again, an unsigned delivery and one whose body changed after
signing both refused 401, a signed event of an unknown type accepted with `recorded: 0` (billed, but
not a retry storm), and an event where **we** followed somebody recorded as nothing. Deliveries are
signed here because X cannot be asked to follow us on demand: the transport is real and the event is
synthetic, which is why a real follow stays the last step rather than this file. Two mutations were
run against it — taking the once-only guard before reading the fact (14/17, failing *the claim is
PAID once X's own record says so*, which is the lock-out), and recording every fact as a follow
(16/17, failing *the claim is refused again — the latest fact is what counts*).

Against a loopback server it snapshots and restores `.data/points.json`, so the local leaderboard
does not collect test wallets. `--read-only` asks only which mode the deployment runs and stops
before anything is bound or paid, which is how production was measured as `claim`. To reproduce the
refusal locally, a server in webhook mode with a secret of your own choosing — `.env.local` is
deliberately not used, so nothing here can point at the live store:

```bash
X_CONSUMER_SECRET=dev-follow-secret FOLLOW_PROOF_MODE=webhook X_FOLLOW_TARGET_ID=123456789 \
  PORT=3100 npm run dev &
X_CONSUMER_SECRET=dev-follow-secret X_FOLLOW_TARGET_ID=123456789 \
  node tools/check-follow-gate.js http://localhost:3100
```

#### Proving a follow: X's Activity API

X's 2026 rate card is the reason this is shaped like a webhook rather than a poll.
`Following/Followers: Read` is **$0.010 per account row returned** and there is no "does A follow B"
endpoint left (v1.1's `friendships/show` is gone), so *asking* means paging a player's following list
and paying per name — a player who follows 300 accounts costs about $3 to check once. `Owned Reads`
($0.001) apply only to the app owner's own data. The `follow.follow` event is **$0.010 per delivered
event**, deduplicated for 24 hours, and afterwards a check costs nothing because the fact is already
in the store.

The receiver is `app/api/x/events/route.js` and the logic is `lib/x-webhook.js`. **Both signature
checks use the app's consumer secret**, and the delivery one is computed over the **raw request
body** — the route reads `request.text()` and never `request.json()`, because re-serialising a parsed
body changes the bytes and would make every genuine delivery fail. A delivery that passes the
signature is answered **200 even when unreadable**: X retries anything that is not a 2xx, every
delivered event is billed, and a shape we have never seen should cost one log line rather than a
retry storm.

**X has delivered activity to webhooks two ways, and the parser reads both.** The Account Activity
API sends a **list of typed events** — `{ for_user_id, follow_events: [{ type: 'follow', source,
 target }] }` — and is documented as deprecated; the X Activity API sends **one event with a dotted
name** — `{ data: { event_type: 'follow.follow', filter, tag, payload } }`. The XAA *payload* schema
is not published in a form that can be read offline, so both envelopes are accepted and every event
has to resolve to one thing the program can act on: **this actor started following us**. Party names
differ between the two, so a small set of keys is read on each side (`source`/`follower`/`actor`,
`target`/`followed`) and the **ids** decide — including the direction, because `follow.follow` fires
for both and an event where *we* did the following is not somebody following us. Anything else is
skipped and counted, never guessed at: skipping a real follow refuses a claim and the log says why,
while inventing one pays 500 points for something that did not happen.

The route is **deployed to production** (`/api/x/events` answers `400 {"error":"no consumer secret
configured"}` there today) and **not yet wired**: the three variables below do not exist in
Production, so no CRCs can be answered and no deliveries can be verified. The registration sequence,
the moment those values exist:

**The order below is not decoration — step 0 fails until step −1 is done.** The CRC is answered by the
*deployment*, with its own copy of the secret, so `X_CONSUMER_SECRET` has to be in Production and
deployed **before** the preflight can pass; today the live route answers
`400 {"error":"no consumer secret configured"}` to any challenge, which is the correct answer for a
deployment that has none. Then the mode is flipped **last**, after a delivery has actually been seen:
another way round, every player is refused while X is silent.

```bash
# -1. The secret into Production FIRST, then redeploy (an env change does not reach a live build).
#     `npx vercel env add X_CONSUMER_SECRET production` — a dashboard job or a piped value, and the
#     same value goes into the shell for the steps below. NEVER into .env.local.

# 0. Preflight. Registering makes X call our URL with a CRC challenge, and it answers only
#    `CrcValidationFailed` — with no detail. This asks our own URL the same question and compares the
#    answer to the HMAC it computes locally, so it can say which half is wrong.
node tools/x-webhook-register.js
#    → "the route is not deployed" | "the deployment has no X_CONSUMER_SECRET set"
#    | "the deployment is answering with a different secret than the one set here"

# 1. Register the webhook (POST /2/webhooks, bearer). X runs the CRC right there; a failure here is
#    refused *before* the call if the preflight did not pass.
node tools/x-webhook-register.js --register

# 2. Subscribe both verbs — POST /2/activity/subscriptions, $0.010 each. Idempotent: an existing
#    subscription for the same event type and account is skipped rather than duplicated.
node tools/x-webhook-register.js --subscribe
#    a bare 403 here is the known case where the endpoint wants user context: retry --auth oauth1

# 3. What X holds now, at any point
node tools/x-webhook-register.js --status

# 4. The follows that happened BEFORE the subscription — billed per row, so it will not run
#    without --yes, and --max-pages bounds it:
node tools/x-followers-backfill.js --yes --max-pages 1

# 5. LAST: flip the mode, once a delivery has actually been seen. Until then the card keeps saying the
#    follow is taken on the player's word, which is true — and a mode turned on early refuses
#    everybody for as long as X stays silent.
npx vercel env add FOLLOW_PROOF_MODE production   # webhook
npx vercel env add X_FOLLOW_TARGET_ID production # our numeric id, as the tool prints on a missing
                                                 # one: GET /2/users/by/username/DNGrobinhood
#    then redeploy, and check it took: node tools/check-follow-gate.js <url> --read-only
```

Needed for that sequence, all from the X developer portal for the app that owns @DNGrobinhood:
`X_CONSUMER_SECRET` (the API secret key — the same value the deployment verifies deliveries with),
`X_BEARER_TOKEN` (app-only, for `/2/webhooks`), and `X_FOLLOW_TARGET_ID` (our numeric account id:
`GET /2/users/by/username/DNGrobinhood`). `--auth oauth1` additionally uses `X_CONSUMER_KEY`,
`X_ACCESS_TOKEN` and `X_ACCESS_TOKEN_SECRET`, signed in the tool with `node:crypto`.

Two operational facts worth knowing: **X re-runs the CRC every hour**, and a webhook that starts
failing it is marked `valid: false` and **stops receiving events** until it passes again —
`PUT /2/webhooks/:id` forces a re-check, and `GET /2/webhooks` reports the flag. And a follow is only
ever delivered *after* the subscription exists, which is what the backfill is for.

Environment variables (production, via `npx vercel env add …` — **never** in `.env.local`, which
would put a live consumer secret on a dev machine):

| Variable | Used for |
| --- | --- |
| `FOLLOW_PROOF_MODE` | `webhook` to check follows. Anything else, or unset, is `claim` — the honest default |
| `X_CONSUMER_SECRET` | Verifies the CRC handshake **and** every delivery. Without it the mode stays `claim`, because a deployment that cannot tell a forgery from a delivery must not say "verified" |
| `X_FOLLOW_TARGET_ID` | Our own numeric account id — filters deliveries to our account and fills the claim's sentence |
| `X_BEARER_TOKEN` | App-only, and used **only by the tools** — `/2/webhooks` and `/2/activity/subscriptions` in `x-webhook-register.js`, and the followers read in `x-followers-backfill.js`. The receiver itself needs no read token, so this one never has to be on the deployment |

Two things to know before switching it on. **Production runs `claim` mode today** — the variables
above do not exist there, so `followProofMode()` returns `claim`; the tab therefore pays after the
review window rather than instantly, and says so. That is the safe direction: the mode only turns on
when there is a secret to check with. The review window applies **only while the follow is
unverified**: once X is telling us, a claim is decided at the moment it is made (`reviewMinutes` is
null) and there is nothing to wait for.
**This build is deployed, and the review window is live** (September 21, `dungeon-knights-lx9kknkvv`).
Production runs `claim` mode *with* the window, so the card says so in the present tense: *"Follows are
verified manually, so points are granted after review — usually within 30–45 minutes — and the task
pays once per X account, ever."* Measured on the deployment, not read off the code — the transcript is
under *the review window, verified live* above.
And **deliveries can silently not arrive**: an unsubscribed, unauthorised or over-limit account gets
no events at all, which at this end is indistinguishable from "nobody followed us". Every accepted
delivery is logged (`[x-events] …`), so the two can be told apart from the log — subscribers on X's
own developer forum reported webhooks that validated, subscribed, and then delivered nothing, which
is why this is a half-hour spike before building anything on top of it.

The backfill has one honest limitation: it adds follows, and cannot see an unfollow that happened
before the subscription either (the two are the same absence). Those are corrected by the next
unfollow event — the store treats the **latest** fact as the truth, so an account whose last event is
an unfollow is refused again — or by hand in the store.

The share's two pictures are generated from one source file, which is **not** served:

```bash
# source: points/daily share/share-card.jpg (the photo the campaign uses, 1337×746)
ffmpeg -y -i "points/daily share/share-card.jpg" -vf "scale=1200:-2,setsar=1" \\
  -c:v mjpeg -q:v 3 public/assets/points/share-card.jpg      # 1200×670, the attachable one
ffmpeg -y -i "points/daily share/share-card.jpg" -vf "scale=1200:-2,crop=1200:630,setsar=1" \\
  -c:v mjpeg -q:v 3 public/assets/points/points-og.jpg       # 1200×630, the card X unfurls
```

The crop is ours rather than X's on purpose: `summary_large_image` renders at 1.91:1, so handing it
the photo's own 1.79:1 would let X choose which part of the knight to cut off. `check-points-x.js`
reads the JPEG's frame header and asserts **1200×630**, which is the only way to tell that from
"it looks fine".

`check-points-x.js` runs everything in **one sandboxed process** (a throwaway `cwd` for the file
driver, `globalThis.fetch` replaced by a stub), which is what makes the awkward answers testable:
`404` for a post X has not indexed, Privy answering with a token but no X link, a post that exists
and is written by somebody else. The Privy half uses a **real P-256 keypair** generated in the
harness and published as this app's JWKS, so the signature check is genuinely exercised — including
an edited payload and an `alg: HS256` token (the classic confusion bug).

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

### Wallets: Privy's login, and one seam the legacy pages read

The login is Privy's, and it is a **React** provider — mounted for real, not imitated from the
low-level core SDK the way the first version of this was.

| file | what it owns |
|---|---|
| `app/providers.js` | `PrivyProvider` around every route: the login modal, its wallets and email, and the embedded wallet created for players who arrive without one. |
| `app/privy-bridge.js` | Publishes the signed-in wallet as `window.privyBridge` (`isReady`, `isAuthenticated`, `getAddress`, `getWalletType`, `getProvider`, `login`, `logout`, plus `privyBridgeReady` / `privyAuthChanged`) and **settles the chain** before handing the provider over. |
| `public/wallet-source.js` | The seam the legacy pages read (`window.DKWallet`), plus the EIP-1193 shim so `window.ethereum` follows the same wallet. Loaded on all six legacy pages immediately before `wallet.js`, and appended by the Points and Staking routes. |
| `lib/privy-chains.js` | The chain objects (`46630` testnet, `4663` mainnet) and the `wallet_addEthereumChain` params, taken from the same numbers `/api/wallet/config` publishes. |

Every page is a React route — the game, the Hall and the mint render their legacy bodies through
`app/legacy-page.js` — so one provider at the root covers all of them, which is what makes this
workable at all.

Resolution order in the seam: **a signed-in Privy session** (asked for its provider, and while it
lives it wins everywhere, `window.ethereum` included, so no two pages can disagree about who is
playing) → **an injected extension** (left exactly as it was, never shadowed, including when it
arrives late) → **nothing**, at which point `unavailableMessage()` says what to do. A bridge that
is mounted but logged out deliberately does *not* win: a logged-out Privy user must still get
their own MetaMask.

**Dormant by default, and that is the whole point.** `app/layout.js` reads `PRIVY_APP_ID` on the
server and passes it down; with it unset `Providers` renders its children unwrapped, no bridge is
ever published, and the seam behaves exactly as it did before any of this existed. Verified with
the App ID absent: `window.DKWallet` present, `window.ethereum` still `undefined`, nothing added
to the page, `connect()` returns null, and the desktop message still offers the MetaMask download.

```bash
node tools/check-wallet-source.js    # 45 checks: dormant, injected-wins, a session that owns the
                                    # wallet, a logged-out bridge, a late bridge, a closed login,
                                    # sign-out, chain mismatch — against a fake bridge and stub DOM
```

**Two things the first version did that this one does not**, and both were deliberate: it opened
its own email-code modal, and it loaded Privy's `js-sdk-core` from a CDN. Privy document that
library as low-level and not for general use, and two Privy clients on one page is how a site ends
up with two ideas of who the player is. `@privy-io/react-auth` replaced both.

`next.config.js` now carries one line of webpack config for it: an `IgnorePlugin` for
`@farcaster/mini-app-solana`, which Privy imports dynamically and which this EVM-only project will
never call. Without it the build fails resolving a package that is not installed.

To switch it on, set this on the Vercel project and redeploy:

| variable | why |
|---|---|
| `PRIVY_APP_ID` | **Needed at build time**, not only at runtime: the layout bakes it into the prerendered payload. Public by design — it identifies the app to Privy's hosted UI, not a credential. |

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

**The modal really opens, and it is Privy's.** Driven in the browser on `/menu`: the bridge mounts
and reports ready, *Connect Wallet* opens Privy's own dialog — *"Log in or sign up"* with email and
*"Continue with a wallet"* — and that leads to *"Select your wallet"*, searchable across 599
wallets, MetaMask and Coinbase Wallet first. Every chunk it needs loads from the app's own origin
(`…/privy-io_react-auth_dist_esm_LandingScreen-*.js`, `AuthenticateWithWalletScreen-*.js`) and the
WalletConnect logo API answers, so the connector set is live too.

One rough edge came out of that run and is fixed: closing the modal without signing in logged
*"Privy reported no wallet after login — the session may still be settling"*, which reports a
player changing their mind as a fault. The seam now only says that when Privy **did** report a
session and handed over no provider, and logs `the login was closed without signing in`
otherwise. Both paths are in the harness (**45/45**).

Still unproven, and only a human can close these:

- **Completing a sign-in.** The modal was opened and its wallet list rendered; entering an email
  and receiving a code needs a mailbox, and connecting MetaMask needs the extension. Neither was
  driven from here.
- **The chain has to be settled by the wallet, not only reported.** `app/privy-bridge.js` now
  *switches* the wallet to Robinhood Chain Testnet (46630 / `0xb626`) and, for a wallet that has
  never heard of it, tries `wallet_addEthereumChain` with the params in `lib/privy-chains.js`. If
  the wallet still refuses, the seam reports the mismatch with the exact decimal id
  (`capabilities().chainMismatch`) instead of letting the first transaction fail anonymously —
  which is the signal to enable the network for the app in the Privy dashboard.
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

### Two pictures per tier: the map sprite and the portrait

A tier carries two images, and which one a screen draws is a rule rather than a preference:

| field | what it is | where it is drawn |
|---|---|---|
| `image` | the map **sprite**, `characters/*.png` (≈1–2 MB each) | the dungeon: `public/dungeon.js`'s own `imageMap`, and the loading gate that preloads it |
| `pfp` | the **portrait**, `/assets/pfp/<tier>.webp` (18–65 KB each) | the screens that *list* knights: the Hall's roster (`public/menu.js`), the Summoning Chamber (`public/mint-page.js`), the Staking Vault (`app/staking/client.js`) |

**The map is not a gallery.** A sprite is read at 32–64px against a busy tileset and has to stay
legible there; a portrait is read at card size against a dark panel, where the sprite reads as mud.
So `public/dungeon.js` keeps `image` and must keep it — `tools/check-rarity.js` sweeps **every**
page script and fails if a portrait path appears outside `config.js`, `menu.js` and `mint-page.js`.

The source art is the `knights pfp'` folder next to the project (1000² PNG / 2048² JPG, 0.9–4 MB).
The served files are centre-cropped squares, generated with ffmpeg (present on this machine at
`…/WinGet/Packages/Gyan.FFmpeg…/ffmpeg.exe`):

```bash
ffmpeg -y -i "<source>" \
  -vf "scale=512:512:force_original_aspect_ratio=increase,crop=512:512" \
  -c:v libwebp -quality 86 public/assets/pfp/<tier>.webp
```

`legendry.jpg` in the source folder is the Legendary portrait (the filename's spelling is not
repeated in the asset name), and `genesis (1).png` is the Genesis collection's — Genesis has no
tiers, so `GENESIS_PFP` in `lib/knights.js` is the whole table for that side.

The two tables are `public/config.js` (`RARITY_CONFIG[tier].pfp`, read by the two page scripts) and
`lib/knights.js` (`KNIGHT_PFP` / `GENESIS_PFP` / `knightPortrait()`, read by the vault).
`tools/check-rarity.js` asserts they agree, that each file resolves, that a Knight is drawn with its
own tier's portrait while a Genesis Knight is drawn with the collection's, and that a Knight whose
tier did not come back falls back to the drawn glyph rather than an empty frame.

Speaking of that CSS: `.knight-avatar img` and `.knight-image img` in `public/theme.css` (and
`.sv-art img` in `public/css/staking.css`) used to force `image-rendering: pixelated`, which is
correct for a sprite drawn at its own size and wrong for a 512px painting scaled to 80px — it drops
whole rows of pixels and turns the portrait into a mosaic. They are `auto` now. **`theme.css` is
loaded by every legacy page and carries no `?v=` history, so it was versioned `?v=1` in
`lib/static-pages.js` when it changed; `public/menu.css` is a dead file (nothing loads it — checked,
left alone).**

`public/config.js`, `public/menu.js` and `public/mint-page.js` are served scripts, so all three were
version-bumped (`config.js?v=1789953300`, `menu.js?v=1` — it had no version at all, and the
check-copies report had been naming it — and `mint-page.js?v=5`).

### The hall panels: map art behind two screens

The Knight's Hall and the Summoning Chamber carry the hall art behind their **right-hand panel** —
the roster on `/menu`, the gallery on `/mint` — with the landing page's treatment: `cover`,
centred, and a dark gradient over it so the copy stays readable.

Where each half of that lives, because neither half is visible from the other file:

| piece | file |
|---|---|
| which panel carries which picture | `lib/static-pages.js` — `class="side-panel hall-bg hall-bg-knight"` / `hall-bg-summon` on the two `<main>` elements |
| the picture, the scrim and the phone variant | `public/theme.css` — `.hall-bg`, `--hall-art`, and the `@media (max-width: 860px)` swap |
| the files | `public/assets/hall/knight-hall.webp`, `summon-hall.webp` (+ `-mobile`) |

**The art is painted on the panel, not on `.side-panel-body`, and that is the whole trick.** The
body is the scrolling element (`overflow-y: auto`), so a background on it would scroll away with the
roster and rescale as the list grew — `cover` sizes to the element's box, not the window. On the
panel it holds still, and the visible art is still only the body, because `.side-panel-header`
paints its own opaque strip over the top. The scrim is a second *background layer* rather than an
overlay, so it can neither fog the header nor sit on top of the knight cards.

Regenerate the four files from the 2752×1536 sources in `maps/hall/` (which is not served — only
`public/` is; the originals are left where they are):

```bash
ffmpeg -i "maps/hall/knight hall.jpg" -vf "scale=1920:-2" -c:v libwebp -quality 78 public/assets/hall/knight-hall.webp
ffmpeg -i "maps/hall/summon hall.jpg" -vf "scale=1920:-2" -c:v libwebp -quality 78 public/assets/hall/summon-hall.webp
ffmpeg -i "maps/hall/knight hall.jpg" -vf "scale=900:-2"  -c:v libwebp -quality 72 public/assets/hall/knight-hall-mobile.webp
ffmpeg -i "maps/hall/summon hall.jpg" -vf "scale=900:-2"  -c:v libwebp -quality 72 public/assets/hall/summon-hall-mobile.webp
```

That lands at 219 KB / 161 KB for the pair on desktop and 65 KB / 44 KB for the phone variants. The
scrim (`0.45 → 0.82`, against the landing page's `0.4 → 0.85`) was chosen from the pictures' own
measurements rather than by eye: mean luma is only 51–74 of 255, and the copy on both panels sits at
the *top* of the picture where both halls are lit from above, so that is the end that needed the
extra darkness.

`tools/check-rarity.js` grew seven checks for this: the four files exist, each class is on the panel
it belongs to and on no third one, `theme.css` resolves every one of them, the phone variant swaps
at the same 860px the mobile sheets use, and no page *script* paints the art (CSS only). `theme.css`
is versioned, so it went `?v=1` → `?v=2` → `?v=3`.

**The roster's empty state needed its own rules, and the report was "the font doesn't match".**
It was not a font being wrong — it was no rule at all. `public/menu.js` writes
`.empty-state` / `-icon` / `-title` / `-text` into `#knightRoster`, and nothing in any sheet
touched those four classes, so the block fell back to the browser's default sans and, worse,
`#knightRoster` is a *grid* (`repeat(auto-fill, minmax(130px, 1fr))`) — the empty state was laid
into one 130px cell, which is why "Your roster is empty…" wrapped after three words. The rules
are now in `theme.css`, scoped to `#knightRoster` on purpose (`/points` loads the same sheet and
has its own empty state in `public/css/points.css`, which must keep winning): `grid-column: 1 / -1`
so it spans the row, the title in `--font-heading` uppercased like every other panel label, the
body in `--font-body` at 13px capped to 420px.

Those rules also give the block **its own ground** — a soft radial veil, not another scrim on the
panel. The room art is behind that panel now and both halls are lit from above, so the empty state
lands on the brightest part of the picture (the chandelier on `/menu`); a veil under the copy keeps
it readable without fogging the room for everyone who *does* have knights.

### Arya explains it once, and only once

Both the Staking Vault and the Points Program open with Arya walking a newcomer through the page.
The rule is: **first visit only** — after that the page leaves her alone, and the footer's
*Ask Arya* is the one way back. The mechanism is entirely in `public/arya.js`, not in the pages:
`startTour(id, opts)` refuses when `hasSeenTour(id)` is true and `opts.force` is not, and remembers
the id in `localStorage` under `dk_arya_tour_<id>`. So `app/staking/client.js` (`staking-v1`) and
`app/points/client.js` (`points-v1`) each call it exactly twice — once from a mount effect with no
`force`, once from the button with `force: true` — and neither page needs to know what "seen" means.

Every way out writes the flag, which is the part worth keeping: skipping, finishing, **the overlap
path** (a new walkthrough ends the one in progress), and `pagehide`. That last one is the likeliest
decline of all — a player who closes the tab mid-tour runs no other code of ours, so without it the
walkthrough would come back on every visit until they clicked Skip. Test it for real by leaving the
page mid-tour and returning; the flag appears during the navigation away.

`tools/check-arya.js` splits the job with `tools/check-all.js`: the browser battery drives the
module (unseen → starts, skip → remembered, second call → refused, `force` → starts), which is the
only half a page can show. `check-arya.js` is the half a browser cannot — that `stopTour` is the
single teardown writing the flag, that nobody calls `stopTour(false)`, and that each page passes
`force` *only* from the button handler. Two of its checks are negative on purpose (the overlap path
and `pagehide` are asserted by pattern, not by structure); moving the flag write out of `stopTour`
fails it by name.

### My Portfolio (`/portfolio`)

One wallet's holdings in one place, entered from the header's wallet menu (*My Portfolio*), which
`public/wallet-menu.js` links on every route that has a wallet control. Before it, the answer to
"what do I own?" was spread over four screens — DNG in whichever page's pill you were looking at,
knights in the Hall, Genesis and reward on the vault — and no screen could show a total.

**Five reads, and all five of them are the server's.** The sections are `$DNG`, `Knights`,
`Genesis`, `Points` and `Recent activity`, built from:

| section | source |
|---|---|
| $DNG (balance) | `/api/wallet/balance` → `readDngBalance` in `lib/staking-chain.js` |
| staked / claimable | the `stake` block of both `/api/staking/holdings` responses |
| Knights | `/api/staking/holdings?collection=knights` |
| Genesis + supply + bands | `/api/staking/holdings?collection=genesis` |
| Points | `/api/points/me`, through `fetchMe()` |
| Recent activity | `/api/game/history?address=` (the contract's own events) |

The browser contributes an **address and nothing else** — the page loads no chain library at all.
That is the second version of it. The first read the balance from the wallet's own provider with one
`eth_call`, which is the obvious thing and produced a page whose other four sections showed real
chain data while its headline read *"the wallet is not available in this browser"*: a saved address
and a live extension are two different facts, and a browser with the first and not the second is not
an edge case, it is most of them. `readDngBalance` asks the token for its own `symbol` and
`decimals` rather than assuming 18 — a balance scaled by a guessed decimal count is wrong by a
billion and looks precise — and it is verified against the token directly: the page printed
549,982,095 for a wallet the public RPC's `balanceOf` decodes to 549,982,095.231.

**Failure is per section.** The five settle through `Promise.allSettled`, so a node that is down
cannot turn "you own 47 knights" into "you own none": the failed section prints its own sentence in
`.pf-warn` and the other four keep their numbers. A failed balance renders `—`, never `0`, because
zero is a claim about a wallet nobody managed to ask about.

**Three states that are not errors**, and each says which it is:

- **No wallet** — an empty state with the chest, what the page will show, and a Connect button.
- **Not signed in to Points** — a sentence and a link, because a wallet that has never signed into
the Points Program has no points, and that is not a fault.
- **Signed in as a different wallet** — a 30-day session outlives the wallet that made it, and
`/api/points/me` answers for whoever *signed*. So the session's address is checked against the
wallet on screen and a mismatch is a sentence naming the other wallet, not that wallet's points
printed under yours. Test it by signing in on `/points`, switching accounts, and returning here.

**The art.** Two pictures, and until this change the page had neither of its own: it borrowed
`knight-hall.webp`, which is the roster's room — the Portfolio is a different place and now has a
different picture. The chest in the empty state is the third file here. Sources live in
`points/portfolio and hall of fame tab/` (not served — only `public/` is; the originals stay where
they are). `ffmpeg` is on this machine at `…/WinGet/Packages/Gyan.FFmpeg…/ffmpeg.exe`.

```bash
# the Portfolio's own room, desktop + phone
ffmpeg -y -i "points/portfolio and hall of fame tab/portfolio.jpg" -vf "scale=1920:-2" -c:v libwebp -quality 78 public/assets/hall/portfolio.webp
ffmpeg -y -i "points/portfolio and hall of fame tab/portfolio.jpg" -vf "scale=900:-2"  -c:v libwebp -quality 72 public/assets/hall/portfolio-mobile.webp

# the Hall of Fame's room, desktop + phone
ffmpeg -y -i "points/portfolio and hall of fame tab/hall of fame.jpg" -vf "scale=1920:-2" -c:v libwebp -quality 78 public/assets/hall/hall-of-fame.webp
ffmpeg -y -i "points/portfolio and hall of fame tab/hall of fame.jpg" -vf "scale=900:-2"  -c:v libwebp -quality 72 public/assets/hall/hall-of-fame-mobile.webp

# the chest (alpha preserved — see the note below)
ffmpeg -y -i "public/assets/points/Wooden_treasure_chest_illustration_2K_20260919015044-autocrop-hair.png" \
  -vf "scale=192:-2" -pix_fmt yuva420p -c:v libwebp -quality 88 public/assets/hall/portfolio-chest.webp
```

That lands at 260 KB / 172 KB on desktop and 79 KB / 51 KB on phones, all 1920×1072 and 900×502.
`-pix_fmt yuva420p` is the part that matters on the chest — without it the WebP is opaque and it
gets a black box around it on the scrim.

**Both scrims were set from the pictures' own measurements, not by eye**, which is the only reason
the numbers differ between the four halls. `ffmpeg -i <file> -vf "signalstats,metadata=mode=print:file=-" -f null -`
reports mean luma (YAVG): this room is **79 of 255**, the Hall of Fame's **81**, the Knight's Hall's
**74** and the Summoning Chamber's **71**. The two new pictures are the brightest of the four, so
they wear the heaviest scrims — the Portfolio's runs `0.50 → 0.86` against the hall panels'
`0.45 → 0.82`, and the Hall of Fame's is a radial `0.55 → 0.88` centred where the table is, because
it is a full-viewport backdrop behind a floating card with no panel to catch the light. Phones then
swap to the small files *and* darken further, at the hall panels' own 860px breakpoint so art and
layout change over together.

**One stylesheet move this page forced.** The header's disconnect chip (`.wallet-chip`,
`.wallet-chip-dot`) was defined twice — in `points.css` and in `staking.css`, because each route
loads only its own sheet and neither could serve the other. A third route made that a third copy, so
the two rules now live in `theme.css`, which every route loads and which already owns `.wallet-pill`
and the `.wallet-menu-*` family. `theme.css` therefore moved to `?v=5` (and `staking.css` to
`?v=9`). `tools/check-styles.js` found the whole thing: it reports any class a route's markup uses
that none of that route's sheets defines, which is also how the vault's missing chip rules were
found the first time.

**Checking it.** `node tools/check-portfolio.js` — 30 checks. The ones worth knowing: every
`/api/…` path the page reads is checked against the filesystem (a one-word typo there is a section
that says "the chain could not be read" forever, which looks like a node problem and is a bug); the
page must not contain a chain call, a signer or a provider; the Genesis bands must come from the
collection's own table rather than a second copy of it; and the whole file is checked with its
comments stripped, because a guard that reads prose fails on its own explanation — the first draft
reported an `eth_call` that existed only in a comment saying the page deliberately avoids one.
Every guard was falsified before it was trusted: moving `PORTFOLIO_HREF`, restoring the ethers tag,
and reintroducing `HASH_POWER_BANDS` each fail by name.

### The Hall of Fame, and the card that could not reach it

The Hall of Fame is **not a route** — it is a modal `public/leaderboard.js` injects into
`document.body` on load, which is why it has a stylesheet (`leaderboard.css`) rather than a page.
That distinction is what hid a real bug: `landing.css`/`leaderboard.js` were wired into the **game**
entry in `lib/static-pages.js` only, while the "Hall of Fame" card is on the **landing** page. So
the one button named after the modal loaded neither the module that builds it nor the sheet that
styles it, and `public/landing.js` fell through to `alert('Leaderboard is loading...')`. The landing
entry now carries both (`leaderboard.css?v=2`, `leaderboard.js?v=3`).

The module is appended as a `<script>` by `app/legacy-page.js` in a `useEffect`, so **neither
appears in the served HTML** — grepping the response for `leaderboard.js` finds nothing on a page
that loads it perfectly well. (`leaderboard.css` *is* a `<link>` in the response; the two halves of
this wiring are visible in different places, which is part of how the bug lasted.)

`tools/check-styles.js` now guards it, in a section that exists because the sweep could not see
this on its own. The sweep reads a route's scripts into its sources, so it *does* see markup those
scripts build — but only for scripts the route actually loads, and here the card, the handler and
the module that builds the modal are three different files. So it saw a card, no
`leaderboard-modal` class anywhere readable, and reported "all styled". The new section (`RUNTIME_DEPS`)
names a script on a route, a global that script calls, and the element in that route's markup the
global serves; when all three hold, the providing file and its sheet must be loaded too. Each half
was falsified — dropping `leaderboard.js` and `leaderboard.css` from the landing entry fails by
name with exit 1, and with `leaderboard.js` present the sweep also reads its injected markup, so the
stylesheet half is checked twice over by two different mechanisms.

**The backdrop** is the Hall of Fame's own picture now, full-viewport behind the card
(`public/leaderboard.css`, `.leaderboard-modal`), with the phone file swapped in at 860px. Same
measured-scrim rule as above; the shape is a radial gradient rather than a linear one because the
table occupies the middle of a floating card, so the darkness has to gather there rather than fall
top-to-bottom.

**The backdrop is fetched eagerly, and that is deliberate.** `.leaderboard-modal` hides itself with
`opacity: 0`, not `display: none`, so the element is laid out and its background resolves at load —
the art arrives *before* anyone presses the card, which is what stops the backdrop popping in past a
finished fade. It costs 168 KB on the landing and game pages; the landing page autoplays a 36 MB
`intro.mp4`, so that is about 0.5% of the video sitting next to it. If you would rather pay nothing
until the first open, move the `url(…)` layer from `.leaderboard-modal` to
`.leaderboard-modal.active` — the trade is a flat backdrop for the first half-second of the first fade.

**One unrelated 404 this turned up.** The landing page's own backdrop was written as
`assets/ui/menu-background.jpg`, which does not exist — the file is at
`public/assets/images/menu-background.jpg`, and every other reference in the repo (`landing.css`,
`menu.css`, `mint.css`, `styles.css`, and `lib/site.js`'s OG image) already said `assets/images/`.
A one-segment typo in `lib/static-pages.js`, fixed. It was invisible because the intro video paints
over that div.

### The wallet menu is on **every** route

My Portfolio is only reachable through the header's wallet menu, so "every page" is a claim about
nine separate files — and the way it fails is by omission, which is exactly what had happened:
`/dungeons` shipped an **empty** `header-actions` (no control at all, and therefore no way to reach
the portfolio, or to connect a wallet, from the Quest Board), and `/tokenomics` put a
**token-supply readout inside `.wallet-pill`** — a label wearing a control's class, so the menu hung
off it and offered to *Connect Wallet* over a number about the supply.

Both are fixed at the source rather than patched in the module:

| route | control | how the menu arrives |
|---|---|---|
| `/`, `/menu`, `/mint`, `/game`, `/dungeons` | the legacy `.wallet-pill` in the page body | the module's own DOM scan |
| `/points`, `/portfolio`, `/staking`, `/tokenomics` | a pill the React route renders | `WalletMenu.attach(el, { onDisconnect })` by hand |

`/dungeons` also had no balance anywhere in its header, so its pill would have read `0 DNG`
forever; `public/dungeon-select.js` now fills it from `walletManager.getDNGBalance()` on the same
two events `landing.js` listens for, and prints `— DNG` rather than a zero it did not read.
`/tokenomics` reads its balance from `/api/wallet/balance` like `/portfolio` does, because that page
loads no chain library; the supply moved next to the pill as `.tk-supply`, which is a label and now
looks like one. `dungeon-select.js` went to `?v=2`, `tokenomics.css` to `?v=2`.

**A route that renders its pill conditionally must re-run the attach.** React runs
the effect once on mount, and the vault renders its pill only *after* the reading phase — so on a
cold load `walletPill.current` was null, the effect bailed, and `/staking` ended up with a control
and no menu on it. The dependency is now `[pillRendered]`. `/points` has the same shape one
interaction deeper: its pill is unmounted while a player is inside the vault dungeon, so coming back
mounts a *new* element, and the effect re-runs on `[inDungeon]`. `/portfolio` and `/tokenomics`
render their header in every branch and need no dependency — which is why only two of the four were
broken.

**Checking it.** Two harnesses, because the claim has a source half and a behaviour half:

```bash
node tools/check-wallet-menu.js                       # 10 checks
cp tools/check-all.js public/_check.js                # then, in the browser, per route:
# await import('/_check.js'); await window.__check.walletMenu();   # 9 checks each
rm public/_check.js
```

The node half derives the route list from `app/` rather than listing it, so **a new route fails
until it carries the control** — that is the whole point, since this bug is an omission, not a typo.
It resolves each route to either its `STATIC_PAGES` entry or its client files, then checks that the
control is there, that the module is loaded, and that each React route calls `attach`. It counts a
`.wallet-pill` or one of the three legacy pill ids and **deliberately not `.wallet-chip`**: the
module leaves the chip out of its triggers, and an earlier draft of this file accepted the chip and
so passed a route whose pill had just been renamed away. Falsified all three ways — dropping the
module from `/dungeons`, renaming the `/tokenomics` pill, and deleting one `attach` — each fails by
name.

The browser half (`window.__check.walletMenu()`) runs **on whichever route you are on**: the control
is hosted, the menu is attached and closed, a **tap** opens it (there is no hover on a phone), *My
Portfolio* is an item inside, and Escape closes it. Two of its assertions had to be loosened for
reasons that are not defects: `is-open` is the transition class and lands on the next animation
frame, which a backgrounded tab throttles (assert on `hidden` + `aria-expanded` instead), and
`hide()` sets `hidden` after 180 ms, so the close is *polled* rather than slept on once — a fixed
sleep passed on five routes and failed on the one that re-renders every second. It is what found
the `/staking` bug above.

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
| Knights size | **No supply limit.** 10,000 is a *reference size*, not a cap: at it a knight earns **5.00%** of its reference income, and half that at 20,000 — both Knights lines are fixed shares divided by however many knights exist, so per-knight yield falls without a floor. Genesis is protected regardless, because the lines are fixed shares |
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

### Solidity: the phase 2 contract set, and how it is checked

Nine contracts are the deployment set, and `contracts/DNGToken.sol` has the full picture:

| contract | what it is |
|---|---|
| `DNGToken` | 1B supply, minted once into four published buckets, no owner and no mint function |
| `Knights` | five tiers, **unlimited supply**, summoned for 500 DNG or minted by a capsule |
| `GenesisKnights` | 1,024 fixed, hash power rolled from the six published bands |
| `Capsules` | ERC-1155, four rungs with published odds, open price ramping 500 → 5,000 DNG |
| `RewardVault` | the four funded lines every payout is charged against |
| `GenesisStaking` | vault line 1, plus the raffle's ticket ledger and staker registry |
| `KnightsStaking` | vault line 3, yield only — no tickets |
| `RaffleContract` | 200 capsules a week, drawn from Genesis tickets |
| `DungeonKnightsGameV4` | the signed-run dungeon payout path |

**`forge` is still not installed here, so `forge build` cannot run — but `solc` is**, as a
project-local devDependency, and it is enough to make compiling a gate instead of a hope:

```bash
npm run check:contracts        # compile + 28 checks against lib/       (solc 0.8.28)
npm run check:contracts -- --sizes   # and every deployed size
npm run check:opcodes          # prove this chain runs PUSH0/MCOPY
npm run deploy:args            # every constructor argument, derived from lib/
npm run test:contracts         # forge test — needs Foundry; test/ does not exist yet
```

`tools/check-contracts.js` is the one that matters. It compiles every file in `contracts/`, then
reads the published numbers back out of the Solidity and compares them to `lib/`: the reward
table and daily caps in `DungeonKnightsGameV4`, the hash powers and drop rates in `Knights`, the
six bands in `GenesisKnights`, the supply split in `DNGToken`, the four capsule odds tables in
`Capsules`, the 200-a-week in `RaffleContract`, and the line shares and runway floor in
`RewardVault`. Every one of those comparisons was shown to fail when tampered with.

#### The payment bug this caught (and the fix that is not deployed yet)

Both places a player is **charged** were missing the line that collects the money.
`RewardVault.fund(amount)` pulls from `msg.sender`, and inside that call the sender is the calling
*contract* — so `Knights.summon()` and `Capsules.open()` each approved the vault and asked it to
collect DNG the contract had never held. `summon()` is the **only** mint path into the live
collection (capsule prizes need the raffle, which needs staked Genesis, and the Genesis supply is
0), so the collection could not be filled at all:

```
eth_call summon() from the owner wallet, as deployed
  → 0xe450d38c  ERC20InsufficientBalance(address,uint256,uint256)
    arg0 = 0xfb738be682a0a60678a393eb7e23742b3137d4c5   ← the collection, which holds 0 DNG
```

The fix is one line in each contract — `safeTransferFrom(msg.sender, address(this), <amount>)`
before the `forceApprove`/`fund` pair — and `tools/check-contracts.js` now asserts it for every
function that funds the vault, firing on a tampered `Knights.sol` with
*"Knights.sol:summon() funds the vault without pulling from msg.sender"*.

**The first deployed set had the bug and the fix is now deployed.** The contracts are immutable, so
`Knights` could not be repaired in place — and `Capsules.knights`, `RaffleContract.capsules`,
`GameV4.knightNFT` and `StakingPool.collection` are all `immutable`, which is what a fixed
collection costs. Before that redeploy, what made the fix certain rather than plausible was an
`eth_call` with the collection's DNG balance overridden to exactly what the missing line would
leave there: it **succeeds and mints tokenId 1**, so nothing downstream of the pull was broken.

Then it was shipped and proven twice over:

```bash
tools/redeploy-mint-fix.js            # 5 deploys, 7 wiring txs, 39 checks, all read from the chain
tools/redeploy-mint-fix.js --verify   # the same checks, sending nothing
tools/redeploy-mint-fix.js --summon   # approve -> summon() -> Knight #1, Common, 15 hp
```

| contract | was | now |
|---|---|---|
| `Knights` | `0xFB738bE6…d4c5` | **`0x27Cfbb76…1B2D`** |
| `Capsules` | `0x8772ee6f…8926` | **`0x628ae225…2728`** |
| `RaffleContract` | `0x56A25ddB…5c7f` | **`0xc26360C6…5b4C`** |
| `KnightsStaking` | `0x5B17C62E…EcD2` | **`0x27fBBba5…a627`** |
| `DungeonKnightsGameV4` | `0xF0727532…d895` | **`0xD60FfCb1…d8a8`** |

The vault, the token and both Genesis contracts were **not** redeployed. The two checks that matter
are read from the chain rather than the source: `summon()` with no allowance must fail with
`ERC20InsufficientAllowance(spender <new Knights>, 0, 500e18)` — the collection asking for *the
player's* fee — where the broken set failed with `ERC20InsufficientBalance(<Knights>)`, the vault
asking the collection for money it never held. Same call, two errors, and the difference is the
whole bug.

**The first real summon failed out of gas, and that lesson is live code.** `_mintTier` writes
`rarityOf[tokenId] = rarity`, so a Common roll is a zero-into-zero SSTORE (100 gas) instead of
20,000 — and `eth_estimateGas` runs against one block's randomness. An estimate taken when the draw
is Common is ~20k short of a tx that lands on any other tier, so it reverts with `status 0`,
`gasUsed == gasLimit`, and the player pays. Buffered in both places: `+30%` in the redeploy script
and `wallet.summonGasLimit` in `public/wallet.js`, which is the Hall's summon button.

**`evmVersion = cancun`, and that was measured.** The chain is Arbitrum Nitro
(`nitro/v3.12.0-rc.2`), where the usual advice is `paris` — and under paris OpenZeppelin v5 does
not compile at all, because `Bytes.sol` uses `MCOPY` (reached from `ERC721` through `Strings`).
`npm run check:opcodes` shows why cancun is right: the deployed token, knight NFT and game V3 all
**already execute `MCOPY` and `PUSH0`**, and an `eth_call` with those opcodes as its target still
executes them today. The disassembly walks PUSH immediates — a byte scan finds `0x5e` inside push
data and lies about it.

**The contracts are deployed.** All nine are live on chain 46630, wired, and verified on chain —
see `docs/DEPLOY-PHASE-2.md` for the addresses and the three things that are unfinished on
purpose (the game's signer is the deployer key, 55% of the token sits in the deployer wallet,
and nothing on the site points at the new set yet). `deployed-phase2.json` is the record.

```bash
node tools/deploy-phase2.js --verify   # re-check the whole deployment, read-only
node tools/deploy-phase2.js --list     # what a fresh deploy would do, and with which arguments
```

**No test has executed a single function of them, though.** There is no Foundry here, so `test/`
does not exist and `forge test` has never run. Compilation, the published-number checks and the
post-deploy reads are all green; behavioural testing is the gap, and the deploy was verified
only in the ways a read can verify it. (One thing the deploy did prove by accident: the vault
cannot be read at all before its token exists — `balance()` calls `balanceOf` on an address
with no code, which the ABI decoder reports as a revert.)

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

**The last deploy** (September 22): `dungeon-knights-qhfbkph32-meglast320-1694` — the domain
switchover, the four quote-repost tasks, and the `www` redirect. It replaced
`dungeon-knights-9mtzahslz-meglast320-1694` (env var set, `/:path*` redirect that missed the root) and
`dungeon-knights-lx9kknkvv-meglast320-1694` (the one-time tab's review window).

**The four quote-repost tasks went live with the domain switchover** (September 22): the deploy that
set `NEXT_PUBLIC_SITE_URL` was built from the working tree, so it carried them. Verified afterwards on
the live deployment — `/api/points/me` returns **five** one-time tasks (the follow plus the four quote
posts). Note the shape of that: a `vercel --prod` uploads the **working directory**, not a commit, so
anything uncommitted ships. That is why the run doc records what is outstanding.

**Not committed as of this writing:** the quote-repost work and the domain change —
`lib/points-config.js`, `lib/points-program.js`, `app/points/client.js`, `lib/points-client.js`,
`lib/points-store.js`, `public/css/points.css`, `vercel.json` and the two harnesses are modified, plus
`tools/check-follow-gate.js` and `tools/points-pending.js` as untracked files. Production is therefore
running code that git does not have yet. Two operational details from it: `vercel env pull` writes the **sensitive** values as
`[SENSITIVE]` placeholders (8 of them — `GAME_RUN_SECRET`, `POINTS_SESSION_SECRET`, the signer key and
the rest), while `KV_REST_API_URL` / `KV_REST_API_TOKEN` **do** come through, which is what lets
`tools/points-pending.js` read the production queue at all; and that pull needs **`--yes`**, or it
stops on a prompt that looks exactly like a hang (a 180 s timeout, twice).

### The custom domain — `dungeonknights.io`

Bought from **Namecheap** on 2026-09-21T18:50:29Z (the registry's `add period` runs for the first five
days). **Live since September 22** — DNS on Namecheap's BasicDNS (`dns1/dns2.registrar-servers.com`),
both hosts answering from Vercel, TLS issued per host.

Two things about reading a domain's state, both of which misled me once:

- **`rdap.org` can be wrong; the registry is not.** It returned 404 for this domain while the .io
  registry's own RDAP (`https://rdap.identitydigital.services/rdap/domain/<d>`) returned 200 with the
  registration. `rdap.org` is a proxy, and its redirect for `.io` did not resolve the record. Ask the
  registry.
- **NXDOMAIN right after a purchase is negative caching, not a failed registration.** `8.8.8.8`
  answered NXDOMAIN because the name genuinely did not exist minutes earlier; it had cached that
  answer. `nslookup <domain> dns1.registrar-servers.com` asks the authoritative server and skips the
  cache entirely — that is how the records were confirmed *before* Vercel's own check ran.

Read the record set off Vercel itself rather than from memory — `vercel domains verify <domain>`
prints it, and it is the only authority on what the deployment expects:

```bash
npx vercel domains verify dungeonknights.io     --scope meglast320-1694
npx vercel domains verify www.dungeonknights.io --scope meglast320-1694
```

At Namecheap (Advanced DNS), apex and `www` need **different** record types:

| Type | Host | Value |
|---|---|---|
| A | `@` | `216.198.79.1` |
| A | `@` | `64.29.17.1` |
| CNAME | `www` | `03e3c9616dec48fa.vercel-dns-017.com.` |

(`vercel domains inspect` suggests the older shared `A dungeonknights.io 76.76.21.21` instead. Both
route, but the pair above is what this domain is actually assigned, so use that.)

#### The switchover, in the order it has to happen

`NEXT_PUBLIC_SITE_URL` was **unset** in Production, so `lib/site.js` fell back to
`https://dungeon-knights.vercel.app` — which is also what `SITE_LINK_HOST` derives from, and that host
is what the **campaign task requires a player's post to link to**. Flipping the env var before DNS
answered would make production demand links to a domain serving a parking page and hand every player a
`share.text` pointing there, so the order is: records → `√ Valid Configuration` → env var → rebuild →
re-point every host. Done that way. What moves with the env var: the share text and its `intentUrl`,
the OG/canonical URLs, and `SITE_LINK_HOST`. What does **not**: the player's own invite-link box, which
is built from `window.location.origin` (`lib/points-client.js` → `refLink`) and so follows whichever
host the player is on.

`NEXT_PUBLIC_*` is inlined at **build** time, so this is a rebuild and not a config toggle.

**Two traps, both found by verifying instead of assuming.**

1. **`vercel domains add` pins an alias to the deployment that existed at that moment, and it does
   *not* follow later `--prod` deploys.** After the first switchover deploy, `dungeon-knights.vercel.app`
   served the new build while both new domains still served the *previous* one — the alias list showed
   them pinned to `dungeon-knights-lx9kknkvv-…` with an age of 16 minutes. So **every** deploy has to
   re-point **all** the hosts, not just the `.vercel.app` one:

   ```bash
   NEW=dungeon-knights-<hash>-meglast320-1694.vercel.app
   for d in dungeonknights.io www.dungeonknights.io dungeon-knights.vercel.app; do
     npx vercel alias set "$NEW" "$d" --scope meglast320-1694
   done
   ```

2. **`"source": "/:path*"` does not match the bare root.** The first `vercel.json` redirect left
   `https://www.dungeonknights.io/` answering **200** while `/points` and `/game` correctly 308'd — and
   it was not caching (a cache-buster and `Cache-Control: no-cache` both still got 200). `"/(.*)"` with
   `"destination": "https://dungeonknights.io/$1"` is the form that includes the root.

Both are verified rather than asserted, by comparing the built chunk name every host serves — equal
means the same build:

```bash
for h in https://dungeonknights.io https://dungeon-knights.vercel.app https://$NEW; do
  printf '%-45s ' "$h"; curl -s "$h/" | grep -oE '/_next/static/chunks/main-app-[a-z0-9]+\.js' | head -1
done
# all three: /_next/static/chunks/main-app-be3d940aef6bd3eb.js

curl -sI https://www.dungeonknights.io/        → 308 → https://dungeonknights.io/
curl -sI https://www.dungeonknights.io/game?x=1 → 308 → https://dungeonknights.io/game?x=1
```

A throwaway probe (signed in the way the page does, then purged) read the **live** `/api/points/me` and
confirmed what the switchover put in front of players: `linkHost: dungeonknights.io`, `share.text`
carrying `https://dungeonknights.io/points?ref=…`, store `redis`, and the one-time tab at **five**
tasks — the follow plus the four quote-reposts on their own posts.

**Keep `dungeon-knights.vercel.app` alive** — `tools/x-webhook-register.js` defaults the webhook URL to
`https://dungeon-knights.vercel.app/api/x/events`, and re-pointing a registration is another billed
management call to X.

#### Still external — dashboards, not code

- **Privy: add `https://dungeonknights.io` to the app's allowed origins.** `app/providers.js` mounts
  `PrivyProvider` with only an `appId` and a `config` — the origin allowlist lives in Privy's own
  dashboard, not in this repo, and Privy's hosted components are origin-checked. This is the one thing
  about the switchover that **could not be verified from here** (the preview webview only reaches
  loopback, so the public domain cannot be driven from the tools, and the Privy dashboard is not
  readable from this shell). Worth opening the app in a real browser and signing in with an embedded
  wallet on the new domain specifically.
- **X developer app:** nothing to change. The webhook stays registered on
  `dungeon-knights.vercel.app`, which is why that alias is kept alive; the app's website field is
  cosmetic.
- **Search/marketing:** the new host is where canonical URLs now point, so Search Console (or any
  similar) should be re-verified for it whenever that matters — nothing in the app depends on it.

#### The one consequence to accept knowingly

The campaign task's `expect.host` now reads `dungeonknights.io`, so a post that links the **old** domain
no longer qualifies for that reward. That is the derivation in `SITE_LINK_HOST` working as designed ("a
custom domain moves the rule with it"), and the daily share and the four quote tasks are unaffected
because they check the `@DNGrobinhood` tag only. If a transition window is wanted, the fix is to accept
either host rather than to keep the old one in the config.

### Environment variables (production)

`vercel env ls production` is the source of truth; env changes need a **redeploy** to apply.

| variable | why it is required |
|---|---|
| `PRIVY_APP_ID` | **Set** (type `config`). Turns the embedded wallet on for the phone flow. Before it was set, production answered `embedded: null` and the whole embedded path stayed dormant. Env changes need a **redeploy** — the route is `force-dynamic`, but the deployment still has to exist. |
| `POINTS_SESSION_SECRET` | **Set.** Sessions are HMACs. Without it each serverless instance generates its own random secret, so a token minted by one instance is rejected by the next: a player connects, clears a floor, and is randomly logged out. Measured before/after: 1-of-8 authenticated calls succeeded, then 8-of-8 once set. |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) | **Set, in this thread** — the Upstash store below. Before it, the store fell back to per-instance memory. |
| `NEXT_PUBLIC_SITE_URL` | **Set to `https://dungeonknights.io` (Production only), September 22.** Before it, every built link fell back to `https://dungeon-knights.vercel.app` in `lib/site.js`. Set only *after* the domain answered — see the domain section above for what it moves, why the old URL stays aliased, and the campaign-link consequence. Preview/Development deliberately leave it unset. |

Without a shared store the once-per-day rule is enforced **per instance**, so under concurrent
traffic the numbers go wrong in exactly the way a rewards program must not. Measured on a
production deployment with no KV, same wallet, same day:

```
sequential: floor 1 credited 100 PTS
ten concurrent balance reads -> 100, 100, 100, 100, 0, 100, 100, 100, 100, 100   (inconsistent)
six concurrent re-clears of the SAME floor -> credited 100, 100, 100, 0, 100, 0  (paid 5x)
```

That is why the page reports the driver and shows an amber banner when `persistent` is false.

### KV: provisioned (this thread)

The earlier choice in this project was to stay on the in-memory store. The user has since asked for
a shared one, and it is now **live in production** — nothing else in the code had to change, because
the driver is picked by environment.

**How it was done, and the one step that needs a human.** `vercel storage` is still not a
subcommand, but the marketplace path exists and halts only at the terms page:

```bash
npx vercel integration add upstash/upstash-kv -e production
# first run → "status": "action_required", "reason": "integration_terms_acceptance_required",
#   "verification_uri": "https://vercel.com/<scope>/~/integrations/accept-terms/upstash?source=cli"
#   (nothing is created — `npx vercel integration installations` still printed "No … found")
# → the account owner opened that URL and accepted the terms
# second run, unchanged → creates the database, connects it to this project, pulls env
```

Only the account owner can accept the terms: `vercel integration accept-terms` documents that it
needs an interactive terminal and a human confirmation, so it is deliberately not scriptable. The
dashboard route to the same place is Storage → Create Database → Upstash for Redis.

The install also pushed two agent "skills" (`.agents/`, `.claude/skills/`, `skills-lock.json`) and
added `.env*` to `.gitignore`. Those were removed — they are the installer's, not the project's.

**What Vercel wrote** (`npx vercel env ls production`): `KV_REST_API_URL`, `KV_REST_API_TOKEN`,
`KV_URL`, `REDIS_URL`, `KV_REST_API_READ_ONLY_TOKEN`, all Production, all created by the install.
`UPSTASH_REDIS_REST_*` is not written — the `KV_*` pair is the one this project uses, and the other
pair is only a fallback in `lib/points-store.js`.

**Then a redeploy**, because env changes do not apply to an existing deployment:

```bash
npx vercel --prod --yes --scope meglast320-1694
npx vercel alias set <deployment> dungeon-knights.vercel.app --scope meglast320-1694
```

**The evidence, and why it needed a round trip rather than an env listing.** An env var being set
is not the same as the deployment using it, and a 200 from the leaderboard does not tell the two
drivers apart — a fresh `memory` store answers `[]` exactly like a fresh Redis does. So a sentinel
wallet was written *through the shared store* and then asked for **through the live deployment**:

```
the driver the production variables pick    → "redis"
write + read through those credentials      → points 7, probe "kv-wiring-check"
GET <new deployment>/api/points/leaderboard → {"rows":[{"address":"0xabab…abab",…}]}  ✅ the same store
GET dungeon-knights.vercel.app (pre-alias)  → {"rows":[]}  ← the deployment that still had no KV
```

The sentinel was then deleted (`DEL` → 1, `ZREM` → 1, `ZCARD` → 0) and the pulled `.env` file
removed. **The shared board starts empty and that is not a loss:** the points that existed before
only ever lived in one process's memory, so they were already being reset by every redeploy.

**And permanence was tested rather than assumed**, because "shared" and "survives a deploy" are not
the same claim. A second sentinel was written, then production was redeployed, and the **brand-new
deployment was asked for a wallet that existed before it did**:

```
write 0xcdcd…cdcd (42 PTS)      → shared store, driver "redis"
npx vercel --prod --yes --scope meglast320-1694   → a new deployment, a new set of processes
GET <brand-new deployment>/api/points/leaderboard → {"rows":[{"address":"0xcdcd…cdcd","points":42,…}]}  ✅
```

That is the whole question answered: nothing in the app's memory could have carried that write across
a deploy. The sentinel was deleted afterwards and the domain re-aliased (`GET …/api/points/leaderboard`
→ `{"rows":[]}`).

**Confirming it later.** `check-kv-store.js` is the concurrency measurement; for the live driver,
`GET /api/points/me` reports `storage.driver = "redis", persistent: true` after a real sign-in, and
the amber banner on the page is driven by that same field — so the banner is gone on any deployment
whose store is shared. `curl .../api/points/leaderboard` still 401s for nobody, but it only proves
the route answers; the two drivers cannot be told apart from a public read alone (both are empty
until someone plays), which is exactly why the sentinel round trip above is the test that counts.

### The once-a-day guard (`claimGuard`)

The floors and the share bonus are each claimed atomically before anything is paid. Without it,
`getWallet` + `updateWallet` are two steps and two overlapping requests both pass the "not cleared
yet" check:

```
six concurrent re-clears of the same floor -> credited 100, 100, 100, 100, 0, 100, 0
```

Redis does this with `SET … NX EX` (atomic across instances); the file and memory drivers use an
in-process set, which is only enough inside one process. **The guard is cross-instance now that KV
exists**, which it did not used to be — the measurement below was taken on the live deployment while
it was still on the memory driver, and is kept here because it is the reason the store was
provisioned at all. Twelve simultaneous clears of today's first floor on one wallet, signed in as a
throwaway wallet through the real challenge/signature flow:

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
node tools/check-points-guard.js http://localhost:3000   # 21 checks through the live routes: the X gate,
                                                         #   8-way concurrency, unpriced shares, the throttle
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
