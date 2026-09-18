# PROJECT-INSPECT — Dungeon Knights

> Updated 2026-09-18. Stack: Next.js 14.2.5 + React 18.3.1 (App Router),
> vanilla-JS canvas engine served from `public/js/core/`, no backend, no tests,
> no contracts in-repo. Legacy root `*.html` pages removed; clean routes only.

## 1. What this project is

**Dungeon Knights** is a browser-based **blockchain idle RPG**:

1. Player summons Knight NFTs (`/mint`, currently off-chain; on-chain mint via
   Robinhood Chain testnet contract `0xEA37…e55A` is staged but not wired to UI).
2. Player selects a squad in `/menu` (max 15), picks a dungeon in `/dungeons`.
3. In `/game` knights **autonomously** pathfind (A\*), melee-attack loot nodes
   (monsters/chests), earn gold per kill, clear the dungeon, then auto-progress.
4. Off-chain gold + `localStorage` persistence; `$DNG` payouts described in
   `tokenomics.md` but **not wired to a token contract** (mainnet addresses TODO).

Live entry: `/`. Legacy `/landing.html`-style URLs 301-redirect to clean routes.

## 2. How to run

```bash
npm install
npm run dev      # http://localhost:3000
npm run build && npm start   # production
```

No Python, no static server. `NEXT_PUBLIC_SITE_URL` (default
`https://dungeon-knights.vercel.app`) drives canonicals/OG/sitemap.

## 3. Structure

```
dungeon-knights/
├── app/                   # Next.js routes (server page.js + client.js per route)
│   ├── page.js / landing-client.js        # /
│   ├── menu|mint|dungeons|game/{page,client}.js
│   ├── layout.js          # global metadata + viewport
│   └── sitemap.js / robots.js / manifest.js
├── lib/
│   ├── site.js            # URL, names, description, keywords, OG image
│   └── knights.js         # rarity roll + stat gen (mirrors engine)
├── public/                # served verbatim
│   ├── assets/images/{characters,maps,monsters/*,obstacles} + audio/*.mp3
│   ├── css/               # 7 legacy stylesheets (per-page <link>)
│   └── js/
│       ├── core/          # engine: audio, characters, dungeon, pathfinding,
│       │                  # combat, ui, game (classic scripts, globals)
│       ├── web3/          # config, web3-integration, rainbowkit, privy,
│       │                  # wallet-widget (STAGED, not loaded by any route)
│       ├── vendor/        # ethers-5.7.2.umd.min.js
│       └── window-bridge.js  # copies engine globals onto window.*
├── docs/                  # 11 operational guides (deployment, privy, …)
├── next.config.js         # .html → clean-route 301s
├── vercel.json            # framework: nextjs
└── README.md / tokenomics.md
```

Removed 2026-09-18: root `landing|menu|mint|dungeon-select|index.html`
(superseded by `app/`), `tools/sprite-viewer.html` (broken, missing sheets),
`public/js/pages/` (vanilla page controllers superseded by React),
root `js/ css/ assets/` duplicates (single copy now lives in `public/`).

## 4. Architecture

```
┌────────────────────────┐  localStorage (gameGold/allKnights/  ┌───────────┐
│ /,/mint,/menu,/dungeons │  selectedKnights/selectedDungeon)    │   /game   │
│ React client components │─────────────────────────────────────▶│  engine   │
└────────────────────────┘  lib/knights.js == engine math       │ Game + UI │
        │ router.push (no .html)                                └─────┬─────┘
        ▼                                                     per-frame│canvas
  Next.js server pages (metadata/OG/JSON-LD per route)                ▼
```

**Route layer (`app/`)** — server `page.js` exports metadata (title, desc,
canonical, OG); `client.js` holds UI state and `localStorage` I/O.
**Engine (`public/js/core/`, classic scripts)** — loaded in order only by
`/game` via sequential `<script>` injection; `window-bridge.js` exposes
`AudioManager/Knight/KnightManager/Dungeon/…/Game` on `window`; a manual
`DOMContentLoaded` dispatch triggers the engine's own `new Game()` boot.
Unmount stops the loop (`isRunning = false`) and clears `window.game`.
**Web3 (`public/js/web3/`)** — present but unloaded; `USE_MAINNET:false`,
testnet chain `46630`, mint `0.001` ETH.

**Persistence keys**: `gameGold`, `allKnights`, `selectedKnights`,
`selectedDungeon`. No backend.

## 5. Data & economy (code-canonical)

`public/js/core/characters.js` ≡ `lib/knights.js`:
Common 65 / Uncommon 20 / Rare 10 / Epic 4.5 / Legendary 1.2 / Mythic 0.3;
multipliers 1.0/1.5/2.2/3.5/5.0/8.0; melee range 1; 1s cooldown;
monster 500 HP / chest 250 HP; squad cap 15; starting gold 500.
(Requested/MVP docs elsewhere may disagree — code wins.)

## 6. Known issues / risks

1. No tests, no lint gate; ethers pinned v5 (fine offline, stale).
2. Web3 staged but unwired — mint is off-chain until React wallet wiring lands.
3. `alert()`-based UX in spots; balance constants tuned by comment, not test.
4. `docs/` guides predate the Next.js migration (paths/commands may be stale).
5. `Game`/`UI` re-boot relies on manual `DOMContentLoaded` re-dispatch —
   fragile if engine boot code changes shape.

## 7. Suggested next steps

- Wire `public/js/web3/` into React (or replace with wagmi/RainbowKit React).
- Add `/api/*` + DB to replace `localStorage`.
- `package.json` scripts for ref-check/SEO smoke (`/sitemap.xml`, meta tags).
- Reconcile `docs/` with the Next.js layout; add Playwright smoke for
  `/ → /mint → /menu → /dungeons → /game`.
