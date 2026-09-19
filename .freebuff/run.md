# Run doc — Dungeon Knights (Next.js)

Thread workspace == main checkout: `D:\free buff\kiro edited\dungeon knights robinhood`

## 1. Reproduce the uncommitted artifacts

A fresh checkout needs these local-only pieces before it will run:

- **`.env.local`** — git-ignored, lives in the main checkout. Copy it, never symlink:
  `cp "<main checkout>/.env.local" .`
  (Next.js reads it automatically; the dev server log line `- Environments: .env.local` confirms it was picked up.)
- **Dependencies** — npm project (`package-lock.json` present): `npm ci` (or `npm install`).
  `node_modules/` is already present in this checkout.

Nothing else is required to boot. Note that the game engine scripts are served **verbatim** from
disk, not bundled:

- Root `dungeon.js`, `game.js`, `combat.js`, `characters.js`, … are the **source of truth** you edit.
- `public/` holds the copies the browser actually fetches (`/dungeon.js?v=…`).
- After editing a root engine file, sync it into `public/`:
  `cp dungeon.js game.js combat.js characters.js pathfinding.js dungeon-select.js dungeon-session.js public/`
  `public/dungeon.js` must be **byte-identical** to the root file — confirm with
  `diff dungeon.js public/dungeon.js` (empty output).

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
  #   window.__check.vaultEntry(1) // play a whole vault entry, per-floor metrics    #   window.__check.report()      // { total, failed, failures[], results[] }
    rm public/_check.js            # and take it out again
    ```

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
node tools/check-wallet-source.js    # 41 checks: dormant, injected-wins, restore, sign-in, cancel,
                                    # chain mismatch, sign-out — against a fake SDK and stub DOM
```

To switch it on, set these on the Vercel project and redeploy (no code change):

| variable | why |
|---|---|
| `PRIVY_APP_ID` | Turns the embedded path on. Public by design — it identifies the app to Privy's hosted UI, not a credential. |
| `PRIVY_CLIENT_ID` | Optional, from the dashboard under Settings → Clients. |
| `PRIVY_SDK_URL` | Optional. Defaults to `https://esm.sh/@privy-io/js-sdk-core`; **pin an exact version once tested**, or self-host the bundle and point this at it. |

**What has not been proven, and cannot be until an App ID exists:** the facade is built to
Privy's documented core-SDK API (`initialize`, `user.get`, `embeddedWallet.getURL /
onMessage / create / getEthereumProvider`, `auth.email.sendCode / loginWithCode`, `auth.logout`)
and driven end to end against a fake of it, but the real handshake has never run. Two things will
need checking first:

- **The embedded wallet has to be on Robinhood Chain Testnet (46630 / `0xb626`).** Our chain is an
  app choice, not a wallet one, so the facade asks the wallet what chain it is on and **warns with
the exact decimal id** when they disagree rather than letting the first transaction fail
  anonymously (`capabilities().chainMismatch` carries the same value). Enable the network for the
  app in the Privy dashboard.
- **It needs gas** — an embedded wallet is the player's own, non-custodial wallet, and it starts
  empty. Fund it from a faucet before minting or claiming.

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
- Then register the preview: `register_preview` with `url: http://localhost:3000` and the
  listener pid from `netstat -ano | grep LISTENING | grep ":3000"`.

## 3. Deploying to Vercel (production)

The project deploys with the **CLI**, not a git integration: `vercel ls` shows deployments
authored by `meglast320-1694`, and a `git push` does not trigger a build. From this worktree:

```bash
vercel --prod --yes
vercel alias set <the-new-deployment-url> dungeon-knights.vercel.app
```

**The second command is not optional.** `--prod` publishes to and aliases
dungeon-knights-meglast320-1694.vercel.app, and leaves the project's custom domain
`dungeon-knights.vercel.app` pointing at whatever it pointed at before — so a successful deploy
is invisible at the URL people actually open. Always re-alias, then verify the *custom* domain,
not the deployment URL.

### Environment variables (production)

`vercel env ls production` is the source of truth; env changes need a **redeploy** to apply.

| variable | why it is required |
|---|---|
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
