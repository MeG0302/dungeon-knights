# sprites/

Optional frame art for the dungeon renderer. Everything here is **additive** — if
a sheet is absent the game animates the existing static PNGs procedurally, so an
empty (or missing) manifest is a perfectly valid state.

- `manifest.json` — which sheets exist. The game fetches this once per scene.
- `knights/` — `walk.png`, `attack.png` (optionally per-rarity prefixes)
- `monsters/` — `<file-stem>-idle.png`, `<file-stem>-attack.png`
- `chests/` — reserved for chest-open sheets

Sheets are horizontal strips of square, transparent, 512×512 frames, side-view,
with the character's feet anchored on the same line in every frame.

Assemble and register one with:

```bash
node tools/make-sprite-sheet.js <frames-dir> public/sprites/knights/walk.png --id knight:walk
```

Full details, including the ID lookup order and the AI-video workflow:
[`docs/SPRITE-SHEETS.md`](../../docs/SPRITE-SHEETS.md).
