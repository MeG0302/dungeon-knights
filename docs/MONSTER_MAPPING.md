# Monster Sprite Mapping

This document shows which monster sprite is used for each dungeon theme.

## Dungeon → Monster Mapping

### 1. Forgotten Crypts (Difficulty 1)
- **Monster:** Undead/Skeleton
- **File:** `monsters/Pixel_art_dungeon_monsters_2K_202609041603.jpeg`
- **Sprite Coordinates:** x: 50, y: 50, w: 150, h: 150
- **Theme:** Dark crypts with bones and skulls

### 2. Goblin Mines (Difficulty 2)
- **Monster:** Goblin
- **File:** `monsters/Pixel_art_dungeon_monsters_2K_202609041603 (1).jpeg`
- **Sprite Coordinates:** x: 250, y: 50, w: 150, h: 150
- **Theme:** Underwater mines with crystal decorations

### 3. Overgrown Temple (Difficulty 3)
- **Monster:** Plant/Nature Creature
- **File:** `monsters/Pixel_art_dungeon_monsters_2K_202609041603 (2).jpeg`
- **Sprite Coordinates:** x: 50, y: 250, w: 150, h: 150
- **Theme:** Green temple with vines and mushrooms

### 4. Magma Chambers (Difficulty 4)
- **Monster:** Fire Demon
- **File:** `monsters/Pixel_art_dungeon_monsters_2K_202609041603 (3).jpeg`
- **Sprite Coordinates:** x: 450, y: 50, w: 150, h: 150
- **Theme:** Red magma chambers with lava

### 5. Void Rift (Difficulty 5)
- **Monster:** Void Creature
- **File:** `monsters/Five_pixel_art_dungeon_monsters_2K_202609041604.jpeg`
- **Sprite Coordinates:** x: 50, y: 50, w: 180, h: 180
- **Theme:** Purple void rift with cosmic effects

## Monster Features

Each monster:
- Has a glowing effect matching the dungeon theme
- Displays a health bar above them
- Uses actual pixel art sprites from the monsters folder
- Falls back to themed colored shapes if sprite fails to load
- Scales to fit the 40px tile size (90% fill for visibility)

## Technical Notes

- Monster sprites are loaded in `DungeonRenderer.loadDecorationSprites()`
- Rendering happens in `DungeonRenderer.renderLootNode()`
- Each dungeon config in `DUNGEONS` contains `monsterSprite` and `monsterCoords`
- Sprite coordinates may need adjustment based on actual sprite sheet layout
