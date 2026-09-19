# Sprite sheets

The game animates **with or without** frame art:

- **No sheet registered** → the renderer animates the existing static PNG
  procedurally (walk gait, attack swing, monster fight-back, chest opening).
- **Sheet registered** → the renderer plays real frames instead, per entity.

So art can be upgraded one sheet at a time, with no code changes.

## How the engine finds sheets

Sheets are declared in [`public/sprites/manifest.json`](./manifest.json). The
game fetches that file once per dungeon scene, so it never probes for art that
does not exist (no 404 noise in the console).

```json
{
  "sheets": [
    { "id": "knight:walk", "src": "sprites/knights/walk.png", "frames": 6, "fps": 10, "loop": true },
    { "id": "knight:attack", "src": "sprites/knights/attack.png", "frames": 6, "fps": 14, "loop": false },
    { "id": "monster:monster-1:idle", "src": "sprites/monsters/monster-1-idle.png", "frames": 4, "fps": 8 },
    { "id": "chest:crypts:open", "src": "sprites/chests/crypts-open.png", "frames": 4, "fps": 12, "loop": false }
  ]
}
```

| Field    | Meaning                                                          |
| -------- | ---------------------------------------------------------------- |
| `id`     | Lookup key (see the table below)                                  |
| `src`    | Path relative to the site root (i.e. relative to `public/`)       |
| `frames` | Optional — inferred from the strip's aspect ratio when omitted    |
| `fps`    | Playback rate (default 10)                                        |
| `loop`   | `true` (default) cycles; `false` holds the last frame             |

### Sheet spec

- **Horizontal strip** of **square** frames, left to right
- Transparent PNG
- Frame canvas **512×512** (the renderer scales to the on-screen size)
- Character **anchored bottom-centre** — feet on the same line in every frame
- **Side view**, facing right (the engine mirrors it when facing left)

Because frames are square, `frames` is inferred from the image dimensions
(a 3072×512 strip = 6 frames). Declaring it explicitly is still fine.

## Sheet IDs

The renderer asks for the most specific ID first and falls back:

| Entity  | Lookup order                                                                 |
| ------- | ---------------------------------------------------------------------------- |
| Knight  | `knight:<TIER>:walk` / `:idle` / `:attack` → `knight:walk` / `:idle` / `:attack` → `knight` |
| Monster | `monster:<file-stem>:attack` → `monster:<file-stem>:idle` → `monster`          |
| Chest   | not yet wired to a shared ID — chest victory uses the procedural open animation |

`<TIER>` is the rarity tier: `COMMON`, `UNCOMMON`, `RARE`, `EPIC`, `LEGENDARY`,
`MYTHIC`. `<file-stem>` is the monster sprite's filename without extension, so
`monsters/forgotten crypts/skeleton.png` → `skeleton`.

A single generic `knight:walk` sheet therefore upgrades **every** rarity at
once, while `knight:MYTHIC:walk` overrides just that tier.

## Making a sheet from your existing art

Your art is single-pose AI renders, so the practical route is to animate them
with AI video and extract frames:

1. **Animate** — feed the PNG to an image-to-video model (Kling, Runway, VEO,
   Luma, …):
   - "knight walks in place, side view, steady loop"
   - "knight swings sword once and returns to stance"
2. **Extract frames**
   ```bash
   ffmpeg -i clip.mp4 -vf fps=10 frames/knight-walk/%03d.png
   ```
3. **Pick 4–8 frames** where the character stays consistent, delete the rest.
4. **Background-remove each frame** (same tool that produced your
   `-autocrop-hair` assets, or any batch background remover).
5. **Build the strip** with the bundled tool — it normalises every frame onto an
   equal 512×512 canvas (feet anchored) and tiles them, then registers the sheet:
   ```bash
   node tools/make-sprite-sheet.js frames/knight-walk public/sprites/knights/walk.png --id knight:walk --fps 10
   node tools/make-sprite-sheet.js frames/knight-attack public/sprites/knights/attack.png --id knight:attack --once --fps 14
   ```
6. **Reload `/game`** — the knight now plays the real frames, everything else
   stays procedural.

Requires `ffmpeg` on PATH (already present in this project's dev environment).

### Alternative: skeletal animation

For the cleanest results, import the PNG into **DragonBones** (free) or
**Spine** (paid), rig arm/leg/torso as bone meshes, animate walk/attack, then
export a PNG sequence per animation and run step 5. One rig per character yields
unlimited animations while preserving the exact art style.

## What is already procedural

These need no sheet to look alive — sheets only *replace* them with real frames:

- **Knights** — facing flip, speed-scaled walk bob/rock, sub-tile glide, three-
  phase attack swing with a sweeping blade arc and impact spark
- **Monsters** — desynced idle breathing, hit flinch with knockback shake and
  red flash, fight-back lunge toward the knight that struck them, fading corpse
  on death
- **Chests** — lid hinged open on victory, gold light shaft and coin fountain

## Troubleshooting

- **Sheet ignored** → check the `src` path and that the ID matches the table
  above. The console logs `🎞️ Sprite sheets registered: N` on scene start.
- **Animation looks staggered** → frames were cropped to different sizes before
  assembly; let the tool normalise them instead of pre-cropping.
- **Feet drift between frames** → the character was not centred consistently in
  the source frames; re-check step 3 with the feet on a common baseline.
