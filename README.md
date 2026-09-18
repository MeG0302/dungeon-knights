# Dungeon Knights — Blockchain Idle RPG

An NFT-based idle RPG. Mint knight NFTs in six rarity tiers, deploy squads of up to
15 knights, clear five themed dungeons, and earn **$DNG** tokens on Robinhood Chain.

- **Live:** https://dungeon-knights.vercel.app
- **Stack:** Next.js 14 (App Router) · React 18 · vanilla-JS canvas game engine ·
  ethers.js v5 (vendored) · Vercel

## Features

- **NFT knights** — six rarity tiers (Common → Mythic) with stat multipliers
- **Idle gameplay** — knights pathfind (A\*), melee-attack loot nodes, earn gold per kill
- **Squad management** — sort/filter by rarity, power, speed, stamina; deploy up to 15
- **Five dungeons** — Forgotten Crypts, Goblin Mines, Overgrown Temple,
  Magma Chambers, Void Rift
- **Play-to-earn** — $DNG token rewards per dungeon clear (see Tokenomics)
- **Wallet-ready** — MetaMask / RainbowKit / Privy integration code staged in
  `public/js/web3/` (wiring into React UI is on the roadmap)
- **SEO** — per-route metadata, Open Graph, sitemap, robots, JSON-LD, PWA manifest
- **Mobile-first phones** — `viewport-fit=cover` notch support, `dvh` toolbar-safe
  heights, 44px+ touch targets, `touch-action` (no tap delay), fluid canvas,
  bottom-sheet squad panel (`public/css/mobile.css`)

## Quickstart

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm start        # serve production build
```

No Python server, no static `.html` files. Routes are clean by default:

| Route       | Page                                     |
| ----------- | ---------------------------------------- |
| `/`         | Landing (enter / summon)                 |
| `/mint`     | Summon knights (qty 1–5, off-chain)      |
| `/menu`     | Squad management + deploy                |
| `/dungeons` | Dungeon select                           |
| `/game`     | Canvas battle (requires selected squad)  |

Legacy `.html` URLs (`/menu.html`, …) permanently redirect to the clean routes
(see `next.config.js`).

### Environment

| Variable                | Default                              | Purpose                                    |
| ----------------------- | ------------------------------------ | ------------------------------------------ |
| `NEXT_PUBLIC_SITE_URL`  | `https://dungeon-knights.vercel.app` | Canonicals, OG URLs, sitemap, robots       |

Game state persists in browser `localStorage` (no backend yet):

| Key                | Content                              | Written by       |
| ------------------ | ------------------------------------ | ---------------- |
| `allKnights`       | Full knight collection (JSON)        | `/mint`          |
| `selectedKnights`  | Deployed squad (JSON)                | `/menu` → Play   |
| `selectedDungeon`  | Chosen dungeon id                    | `/dungeons`      |
| `gameGold`         | Gold balance                         | `/menu`, `/game` |

## Architecture

Next.js App Router shell around the battle-tested canvas engine. Each route is a
**server component** (`page.js`, crawler-visible metadata) rendering a
**client component** (`client.js`, interactivity):

```
app/
├── layout.js            # root layout, global metadata, viewport
├── page.js              # /           (metadata + VideoGame JSON-LD)
├── landing-client.js    # /           (router.push navigation, menu music)
├── menu/page.js         # /menu       (metadata)
├── menu/client.js       # /menu       (roster, sort/filter, squad select)
├── mint/page.js         # /mint       (metadata)
├── mint/client.js       # /mint       (qty selector, rarity roll, collection)
├── dungeons/page.js     # /dungeons   (metadata)
├── dungeons/client.js   # /dungeons   (cards → localStorage → /game)
├── game/page.js         # /game       (metadata)
├── game/client.js       # /game       (canvas markup + engine boot)
├── sitemap.js           # /sitemap.xml
├── robots.js            # /robots.txt
└── manifest.js          # /manifest.webmanifest

lib/
├── site.js              # SITE_URL, names, description, keywords, OG image
└── knights.js           # rarity roll + stat gen (mirrors engine math)

public/                  # served verbatim at /
├── assets/              # images/{characters,monsters,maps,obstacles}, audio/*.mp3
├── css/                 # legacy stylesheets, loaded per-page via <link>
└── js/
    ├── core/            # canvas engine: audio, characters, dungeon,
    │                    # pathfinding, combat, ui, game (classic scripts)
    ├── web3/            # staged wallet integrations (config, web3, rainbowkit,
    │                    # privy, wallet-widget) — not yet wired to React UI
    ├── vendor/          # ethers-5.7.2.umd.min.js (pinned, offline-capable)
    └── window-bridge.js # exposes engine globals as window.* for React
```

### Key design decisions

1. **Engine reuse, not rewrite.** `/game` renders the exact DOM ids the engine
   expects (`gameCanvas`, `gameLog`, …), injects the seven `core/` scripts in
   order, then re-fires `DOMContentLoaded` (dynamically injected scripts miss the
   real event) so the engine's own boot code runs `new Game()` → `new UI(game)`.
   Unmount sets `game.isRunning = false` and drops `window.game` so re-entry
   boots cleanly.
2. **Global-CSS rule compliance.** App Router allows global CSS only from
   layouts; to preserve the original cascade exactly, each page loads its legacy
   stylesheets via `<link href="/css/…">` from `public/`.
3. **Absolute asset paths.** Engine `Audio`/`Image` sources use `/assets/…` so
   they resolve identically from every nested route.
4. **No backend (yet).** There is no API layer; `localStorage` is the store and
   `lib/knights.js` replicates `Knight` roll/stat math so mint/menu behave
   identically to the engine.

### Data flow

```
/ → /mint → allKnights ─┐
/ → /menu → selectedKnights (+ gameGold) → /dungeons → selectedDungeon → /game
                                                                    (engine reads
                                                                     all three keys)
```

## Game design (code-canonical)

Rarity distribution and multipliers are defined once in the engine
(`public/js/core/characters.js`, mirrored in `lib/knights.js`):

| Rarity    | Drop rate | Power × | Base speed |
| --------- | --------- | ------- | ---------- |
| Common    | 65%       | 1.0     | 1          |
| Uncommon  | 20%       | 1.5     | 1.5        |
| Rare      | 10%       | 2.2     | 2.14       |
| Epic      | 4.5%      | 3.5     | 3          |
| Legendary | 1.2%      | 5.0     | 7.5        |
| Mythic    | 0.3%      | 8.0     | 15         |

- Power: `(10 + rand·15) · multiplier · variance(0.8–1.2)`
- Stamina: `(300 + rand·100) · multiplier`; recovery `(5 + rand·5) · multiplier`
- Melee only (range 1), 1s attack cooldown; monsters 500 HP, chests 250 HP
- Squad cap: **15** knights; starting gold: **500**

## Tokenomics

- **Token:** $DNG · **Supply:** 1,000,000 · **Network:** Robinhood Chain
- **Distribution:** 35% rewards · 30% liquidity · 15% treasury · 10% marketing ·
  10% team (vested)
- Testnet mint price: `0.001` ETH/knight · Mainnet pricing: `100` $DNG/knight
  (`public/js/web3/config.js`, `USE_MAINNET: false` default)
- Full breakdown: [`tokenomics.md`](./tokenomics.md)

## Smart contracts

| Network | Chain ID | NFT contract |
| ------- | -------- | ------------ |
| Robinhood Chain testnet | 46630 (`0xb626`) | `0xEA37B1D036a880DfF372bCdd8b2A3AEeEe01e55A` |
| Robinhood Chain mainnet | 4663 (`0x1237`) | TBD |

Explorer: https://robinhoodchain.blockscout.com · Operational guides: [`docs/`](./docs)

## Deployment

Vercel auto-detects Next.js (`vercel.json` pins `framework: nextjs`).
`NEXT_PUBLIC_SITE_URL` should match the production domain.

## Roadmap

- [ ] Wire wallet integrations (`public/js/web3/`) into React UI
- [ ] Backend API (`/api/*`) replacing `localStorage` persistence
- [ ] Marketplace, PvP tournaments, equipment, staking
- [ ] Guilds, seasons, leaderboards

## Contributing

1. Fork · 2. feature branch · 3. commit · 4. pull request.
Run `npm run build` before opening a PR.

## License

MIT
