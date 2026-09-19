// Dungeon System - Top-Down 2D Grid Rendering and Map Generation

const DUNGEONS = {
    crypts: {
        name: 'Forgotten Crypts',
        difficulty: 1,
        theme: { 
            floor: '#2a3a3a',
            floorAlt: '#243232',
            wall: '#1a2828',
            wallHighlight: '#3a4a4a',
            pillar: '#2d4040',
            pillarTop: '#405555',
            accent: '#4dff4d',
            accentDark: '#2d9a2d',
            glowColor: '#4dff4d',
            shadowColor: '#0a1414',
            decorations: ['skull', 'bones', 'torch']
        },
        tileSize: 40,
        monsterHealth: 500, // Increased for slower clear time
        chestHealth: 250,   // Increased for slower clear time
        monsterFolder: 'forgotten crypts',
        monsters: [
            'Pixel_art_crystal_wraith_2K_202609041636-removebg-preview.png',
            'Pixel_art_dungeon_monster_2K_202609041636-removebg-preview.png',
            'Pixel_art_dungeon_monster_2K_202609041636__2_-removebg-preview.png',
            'Pixel_art_zombie_guard_2K_202609041636-removebg-preview.png',
            'Skeleton_warrior_holding_sword_2K_202609041637-removebg-preview.png'
        ],
        atmosphericText: ['WHISPERS...', 'SILENCE...', 'DARKNESS...', 'BONES RATTLE...']
    },
    mines: {
        name: 'Goblin Mines',
        difficulty: 1,
        theme: { 
            floor: '#2a3a4a',
            floorAlt: '#243440',
            wall: '#1a2838',
            wallHighlight: '#3a4a5a',
            pillar: '#2d4050',
            pillarTop: '#405565',
            accent: '#4dddff',
            accentDark: '#2d8a9a',
            glowColor: '#4dddff',
            shadowColor: '#0a1420',
            decorations: ['coral', 'seaweed', 'crystal']
        },
        tileSize: 40,
        monsterHealth: 500, // Increased for slower clear time
        chestHealth: 250,   // Increased for slower clear time
        monsterFolder: 'goblin mines',
        monsters: [
            'Pixel_art_goblin_diver_2K_202609041636-removebg-preview.png',
            'Pixel_art_leaf-winged_harpy_2K_202609041636-removebg-preview.png',
            'Pixel_art_lich_holding_staff_2K_202609041636-removebg-preview.png',
            'Pixel_art_toxic_mushroom_monster_2K_202609041636-removebg-preview.png'
        ],
        atmosphericText: ['DRIP... DROP...', 'ECHOES...', 'DEPTHS...', 'WATER FLOWS...']
    },
    temple: {
        name: 'Overgrown Temple',
        difficulty: 1,
        theme: { 
            floor: '#3a4a2a',
            floorAlt: '#344024',
            wall: '#283a1a',
            wallHighlight: '#4a5a3a',
            pillar: '#405030',
            pillarTop: '#556540',
            accent: '#ddff4d',
            accentDark: '#8a9a2d',
            glowColor: '#ddff4d',
            shadowColor: '#14200a',
            decorations: ['vine', 'mushroom', 'flower']
        },
        tileSize: 40,
        monsterHealth: 500, // Increased for slower clear time
        chestHealth: 250,   // Increased for slower clear time
        monsterFolder: 'overgrown temple',
        monsters: [
            'Pixel_art_carnivorous_plant_2K_202609041637-removebg-preview.png',
            'Pixel_art_coral_golem_2K_202609041636-removebg-preview.png',
            'Pixel_art_dungeon_monster_2K_202609041636__1_-removebg-preview (1).png',
            'Pixel_art_mossy_treant_dungeon_2K_202609041637-removebg-preview.png'
        ],
        atmosphericText: ['VINES GROW...', 'ANCIENT...', 'ROOTS...', 'NATURE WHISPERS...']
    },
    magma: {
        name: 'Magma Chambers',
        difficulty: 1,
        theme: { 
            floor: '#4a2a2a',
            floorAlt: '#402424',
            wall: '#381a1a',
            wallHighlight: '#5a3a3a',
            pillar: '#502d2d',
            pillarTop: '#654040',
            accent: '#ff6644',
            accentDark: '#9a2d2d',
            glowColor: '#ff6644',
            shadowColor: '#200a0a',
            decorations: ['lava', 'ember', 'crack']
        },
        tileSize: 40,
        monsterHealth: 500, // Increased for slower clear time
        chestHealth: 250,   // Increased for slower clear time
        monsterFolder: 'magma chambers',
        monsters: [
            'Pixel_art_armored_beetle_2K_202609041636-removebg-preview.png',
            'Pixel_art_fire-breathing_red_lizard_2K_202609041636-removebg-preview.png',
            'Pixel_art_lava_slime_dungeon_2K_202609041637-removebg-preview.png',
            'Pixel_art_phoenix_whelp_2K_202609041636-removebg-preview.png',
            'Pixel_art_rock_elemental_dungeon__2K_202609041637-removebg-preview.png'
        ],
        atmosphericText: ['BURNING...', 'HEAT RISES...', 'MOLTEN...', 'ASH FALLS...']
    },
    void: {
        name: 'Void Rift',
        difficulty: 1,
        theme: {
            floor: '#3a2a4a',
            floorAlt: '#342440',
            wall: '#281a38',
            wallHighlight: '#4a3a5a',
            pillar: '#402d50',
            pillarTop: '#554065',
            accent: '#dd4dff',
            accentDark: '#7a2d9a',
            glowColor: '#dd4dff',
            shadowColor: '#140a20',
            decorations: ['void', 'star', 'portal']
        },
        tileSize: 40,
        monsterHealth: 500,
        chestHealth: 250,
        monsterFolder: 'void rift',
        monsters: [
            'Pixel_art_angler_fish_beast_2K_202609041636-removebg-preview.png',
            'Pixel_art_cosmic_jellyfish_2K_202609041636-removebg-preview.png',
            'Pixel_art_crab_monster_2K_202609041636-removebg-preview.png',
            'Pixel_art_electric_eel_2K_202609041636-removebg-preview.png'
        ],
        atmosphericText: ['VOID CALLS...', 'INFINITY...', 'COSMOS...', 'STARS FADE...']
    }
    // NOTE: the Points Vault is deliberately NOT a dungeon here. It is a scripted
    // mini-game on the Points Program page (app/points/dungeon.js) that plays with
    // dummy knights, so defining it as an engine dungeon would make every /game
    // load preload ~7 MB of vault monster art that no dungeon can ever show.
};

// How far an idle monster wanders from the tile it spawned on, and how long a
// single strolling step takes. gridX/gridY stay authoritative for targeting;
// stepTarget + moveTimer give the renderer a smooth sub-tile glide.
const PATROL_RANGE = 2;        // tiles
const PATROL_STEP_TIME = 1.15; // seconds per tile

// The patch of ground a monster owns: it strolls within this many tiles of its
// spawn tile and it only ever spits back at knights standing inside it. Measured
// radially, so diagonals count the same as straight lines, and used by both the
// domain check and the attack's maximum reach.
const MONSTER_DOMAIN = 3;      // tiles

// A monster answers a knight's swing a beat LATER, never on the same frame, so the
// two attacks read as a back-and-forth instead of one simultaneous clash. Roughly
// the length of the knight's own swing (0.3s).
const COUNTER_WINDUP = 0.3;    // seconds

class LootNode {
    constructor(x, y, type, maxHealth, reward, monsterImage = null) {
        this.gridX = x;
        this.gridY = y;
        this.type = type; // 'chest' or 'monster'
        this.maxHealth = maxHealth;
        this.health = maxHealth;
        this.reward = reward;
        this.isDestroyed = false;
        this.monsterImage = monsterImage; // Store which monster image to use
        this.animationTime = Math.random() * 10; // Random start time for animation variety
        this.animPhase = Math.random() * Math.PI * 2; // desync idle breathing
        this.hitTime = 0;         // seconds of flinch remaining
        this.counterTime = 0;     // seconds of fight-back lunge remaining
        this.counterDelay = 0;    // wind-up left before the lunge (and the spit) starts
        this.counterCooldown = 0; // seconds until this monster may lunge again
        this.counterFrom = null;  // direction toward the knight that struck it

        // Idle stroll: wander up to PATROL_RANGE tiles from the spawn tile (the
        // "mean" position) and then walk back to it.
        this.homeX = x;
        this.homeY = y;
        this.stepTarget = null;   // tile being walked into (null = standing)
        this.stepDuration = PATROL_STEP_TIME;
        this.moveTimer = 0;       // seconds accumulated toward stepTarget
        this.patrolPause = 1 + Math.random() * 2.5;
        this.patrolLeg = 'out';   // 'out' (drifting from home) | 'home' (returning)
        this.facing = 1;
        this.engaged = false;     // true while a knight is attacking it
        this.alerted = false;     // true while a knight is inside its domain
        this.alertTime = 0;       // seconds left of the "spotted you" flare
    }

    // Called by the combat system on every landed hit. Drives the flinch and,
    // for monsters, the fight-back spit (purely cosmetic — no effect on damage,
    // rewards or stamina). Returns true when a counter was started.
    onHit(knight) {
        if (this.isDestroyed) return false;
        this.hitTime = 0.3;

        if (this.type !== 'monster' || this.counterCooldown > 0 || !knight) return false;
        if (!knight.gridPosition) return false;

        // A monster only fights back inside its own domain: the knight has to be
        // within MONSTER_DOMAIN tiles of the tile this monster spawned on (or right
        // on top of it). Radial, so it covers every direction including diagonals.
        // Anything further away just gets to hack away.
        const fromHome = Math.hypot(knight.gridPosition.x - this.homeX,
                                    knight.gridPosition.y - this.homeY);
        const fromMonster = Math.hypot(knight.gridPosition.x - this.gridX,
                                       knight.gridPosition.y - this.gridY);
        // 1.5 rather than 1 so a knight standing diagonally adjacent still counts as
        // "right on top of it" and never turns the monster into a free punching bag.
        if (fromHome > MONSTER_DOMAIN && fromMonster > 1.5) return false;

        this.counterCooldown = 1.6;
        // Wind up first — the knight's swing is still playing out. The spit effect
        // carries the same delay, so the body lunge and the spit start together.
        this.counterDelay = COUNTER_WINDUP + Math.random() * 0.12;
        this.counterFrom = {
            dx: Math.sign(knight.gridPosition.x - this.gridX),
            dy: Math.sign(knight.gridPosition.y - this.gridY)
        };
        return true;
    }

    takeDamage(amount) {
        if (this.isDestroyed) return false;
        
        this.health -= amount;
        if (this.health <= 0) {
            this.health = 0;
            this.isDestroyed = true;
            return true;
        }
        return false;
    }

    getHealthPercent() {
        return (this.health / this.maxHealth) * 100;
    }
}

class Dungeon {
    constructor(type = 'crypts') {
        this.type = type; // Store the dungeon type ('mines', 'magma', 'void', 'temple', 'crypts')
        this.config = DUNGEONS[type];
        this.gridWidth = 36; // 36 columns (70px tiles)
        this.gridHeight = 20; // 20 rows (70px tiles) = 720 total tiles
        this.lootNodes = [];
        this.spawnPoints = [];
        this.decorations = [];

        // Use fixed collision grid from map-grids.js when available
        const painted = (typeof MAP_GRIDS !== 'undefined') ? MAP_GRIDS[type] : null;
        if (painted) {
            this.grid = painted.map(r => [...r]); // deep copy
            this.usePainted = true;
        } else {
            this.grid = this.generateGrid();
            this.usePainted = false;
        }

        // Ensure spawn corner is always walkable
        for (let y = 1; y < 5; y++) {
            for (let x = 1; x < 5; x++) {
                if (this.grid[y]) this.grid[y][x] = 0;
                this.spawnPoints.push({ x, y });
            }
        }

        if (!this.usePainted) {
            this.generateDecorations();
        }
        this.generateLootNodes();
    }

    generateGrid() {
        const grid = [];
        
        // Create grid with guaranteed paths - modified Bomberman style
        for (let y = 0; y < this.gridHeight; y++) {
            const row = [];
            for (let x = 0; x < this.gridWidth; x++) {
                // Border walls
                if (x === 0 || x === this.gridWidth - 1 || y === 0 || y === this.gridHeight - 1) {
                    row.push(1); // Wall
                }
                // Permanent obstacles - ONLY on even x AND even y (not every tile)
                // This ensures corridors between obstacles
                else if (x % 2 === 0 && y % 2 === 0) {
                    row.push(2); // Permanent obstacle (decorative pillar/rock)
                }
                // Random breakable obstacles - REDUCED to 15% for more open space
                else if (Math.random() < 0.15) {
                    row.push(3); // Breakable obstacle (crate/destructible)
                }
                else {
                    row.push(0); // Walkable floor
                }
            }
            grid.push(row);
        }

        // Clear spawn area (top-left corner 4x4)
        for (let y = 1; y < 5; y++) {
            for (let x = 1; x < 5; x++) {
                grid[y][x] = 0;
                this.spawnPoints.push({ x, y });
            }
        }
        
        // Ensure main corridors are clear (every odd row and column is guaranteed walkable)
        for (let y = 1; y < this.gridHeight - 1; y += 2) {
            for (let x = 1; x < this.gridWidth - 1; x++) {
                if (grid[y][x] === 3) { // Remove breakables from corridors
                    grid[y][x] = 0;
                }
            }
        }
        
        for (let x = 1; x < this.gridWidth - 1; x += 2) {
            for (let y = 1; y < this.gridHeight - 1; y++) {
                if (grid[y][x] === 3) { // Remove breakables from corridors
                    grid[y][x] = 0;
                }
            }
        }

        return grid;
    }

    generateRooms(grid) {
        // Not needed for Bomberman-style grid
        // Keeping function for compatibility but empty
    }

    generateDecorations() {
        // NEW: Spawn 15-20 random obstacle decorations (purely visual, walkable)
        const obstacleCount = 15 + Math.floor(Math.random() * 6); // 15-20 obstacles
        
        for (let i = 0; i < obstacleCount; i++) {
            // Find random walkable floor tile
            let x, y, attempts = 0;
            do {
                x = 1 + Math.floor(Math.random() * (this.gridWidth - 2));
                y = 1 + Math.floor(Math.random() * (this.gridHeight - 2));
                attempts++;
            } while (this.grid[y][x] !== 0 && attempts < 50); // Only place on walkable floor (type 0)
            
            if (attempts < 50) {
                this.addObstacleDecoration(x, y);
            }
        }
        
        console.log(`🎨 Generated ${obstacleCount} obstacle decorations`);
    }

    addObstacleDecoration(x, y) {
        // NEW: Use actual obstacle images from assets folders
        const dungeonType = this.config.name;
        let imagePath;
        
        if (dungeonType.includes('Crypts')) {
            // Crypts decorations (will add later if you provide images)
            imagePath = null; // Skip for now
        } else if (dungeonType.includes('Mines')) {
            // Goblin Mines obstacles
            const options = [
                'Emerald_stone_corner_decoration_ΓÇª_2K_20260911012857-autocrop-hair.png',
                'Glowing_green_emerald_crystal_2K_20260911012918-autocrop-hair.png',
                'Pixel_art_corner_decoration_2K_20260911012922-autocrop-hair.png',
                'Pixel_art_green_emerald_decoration_2K_20260911012902-autocrop-hair.png',
                'Pixel_iron_pickaxe_icon_2K_20260911012928-autocrop-hair.png'
            ];
            imagePath = `assets/mines/${options[Math.floor(Math.random() * options.length)]}`;
        } else if (dungeonType.includes('Temple')) {
            // Overgrown Temple obstacles
            const options = [
                'Corner_decoration_asset_pixel_art_2K_20260911013023-autocrop-hair.png',
                'Jungle_leaf_pixel_art_icon_2K_20260911013100-autocrop-hair.png',
                'Temple_corner_decoration_pixel_art_2K_20260911013107-autocrop-hair.png',
                'Treasure_chest_pixel_art_2K_20260911013116-autocrop-hair.png'
            ];
            imagePath = `assets/temple/${options[Math.floor(Math.random() * options.length)]}`;
        } else if (dungeonType.includes('Magma')) {
            // Magma Chamber obstacles
            const options = [
                'Basalt_rock_with_lava_channels_2K_20260911013002-autocrop-hair.png',
                'Bottom-right_lava_rock_decoration_2K_20260911012949-autocrop-hair.png',
                'Flame_lava_drop_pixel_art_2K_20260911013053-autocrop-hair.png',
                'Lava_rock_corner_decoration_pixel_2K_20260911012945-autocrop-hair.png',
                'Magma_chamber_bottom-left_cornerΓÇª_2K_20260911012932-autocrop-hair.png',
                'Magma_chamber_flame_pixel_art_2K_20260911012959-autocrop-hair.png',
                'Pixel_art_treasure_chest_2K_20260911012935-autocrop-hair.png'
            ];
            imagePath = `assets/magma/${options[Math.floor(Math.random() * options.length)]}`;
        } else if (dungeonType.includes('Void')) {
            // Void Rift obstacles
            const options = [
                'Header_icon_pixel_art_void_2K_20260911013016-autocrop-hair.png',
                'Obsidian_shards_floating_decoration_2K_20260911013038-autocrop-hair.png',
                'Obsidian_shards_floating_pixel_art_2K_20260911013034-autocrop-hair.png',
                'Pixel_art_obsidian_shards_decoraΓÇª_2K_20260911013042-autocrop-hair.png',
                'Purple_void_energy_orb_icon_2K_20260911013020-autocrop-hair.png',
                'Treasure_chest_pixel_art_2K_20260911013025-autocrop-hair.png'
            ];
            imagePath = `assets/void/${options[Math.floor(Math.random() * options.length)]}`;
        } else {
            imagePath = null;
        }
        
        if (imagePath) {
            this.decorations.push({ 
                x, y, 
                imagePath,
                layer: 'obstacle'
            });
        }
    }

    addFloorDecoration(x, y, dungeonType) {
        let spriteX, spriteY, spriteW, spriteH, spriteSheet;
        
        if (dungeonType.includes('Crypts')) {
            // Crypt decorations: skulls, bones, torches (off)
            spriteSheet = 'crypts';
            const options = [
                { sx: 50, sy: 80, sw: 80, sh: 80 },   // Skull pile 1
                { sx: 200, sy: 80, sw: 80, sh: 80 },  // Skull pile 2
                { sx: 450, sy: 80, sw: 80, sh: 80 },  // Bones scattered
                { sx: 750, sy: 80, sw: 80, sh: 80 }   // Skull pile 3
            ];
            const choice = options[Math.floor(Math.random() * options.length)];
            spriteX = choice.sx;
            spriteY = choice.sy;
            spriteW = choice.sw;
            spriteH = choice.sh;
        } else if (dungeonType.includes('Mines') || dungeonType.includes('Goblin')) {
            // Underwater: coral, seaweed, crystals, shells, rocks
            spriteSheet = 'mines';
            const options = [
                { sx: 50, sy: 100, sw: 80, sh: 80 },   // Pink coral
                { sx: 200, sy: 100, sw: 80, sh: 80 },  // Cyan coral
                { sx: 400, sy: 100, sw: 80, sh: 80 },  // Blue coral
                { sx: 50, sy: 250, sw: 80, sh: 80 },   // Seaweed
                { sx: 200, sy: 250, sw: 80, sh: 80 },  // Seaweed variant
                { sx: 50, sy: 600, sw: 100, sh: 80 },  // Crystal cluster
                { sx: 250, sy: 600, sw: 80, sh: 80 },  // Crystal variant
                { sx: 50, sy: 900, sw: 100, sh: 60 },  // Rock pile
                { sx: 300, sy: 900, sw: 80, sh: 60 }   // Rocks
            ];
            const choice = options[Math.floor(Math.random() * options.length)];
            spriteX = choice.sx;
            spriteY = choice.sy;
            spriteW = choice.sw;
            spriteH = choice.sh;
        } else if (dungeonType.includes('Temple')) {
            // Nature: mushrooms, flowers, vines, grass, bushes
            spriteSheet = 'temple';
            const options = [
                { sx: 50, sy: 80, sw: 80, sh: 80 },    // Red mushrooms
                { sx: 200, sy: 80, sw: 80, sh: 80 },   // Purple mushrooms
                { sx: 50, sy: 450, sw: 80, sh: 80 },   // Orange mushrooms
                { sx: 200, sy: 200, sw: 80, sh: 80 },  // Yellow flowers
                { sx: 50, sy: 200, sw: 80, sh: 80 },   // Yellow flowers 2
                { sx: 750, sy: 200, sw: 100, sh: 100 }, // Bush
                { sx: 750, sy: 350, sw: 100, sh: 100 }, // Grass patch
                { sx: 750, sy: 600, sw: 100, sh: 80 }   // Leaves
            ];
            const choice = options[Math.floor(Math.random() * options.length)];
            spriteX = choice.sx;
            spriteY = choice.sy;
            spriteW = choice.sw;
            spriteH = choice.sh;
        } else if (dungeonType.includes('Magma')) {
            // Check if magma sprite sheet loads properly
            spriteSheet = 'magma';
            spriteX = 50;
            spriteY = 50;
            spriteW = 80;
            spriteH = 80;
        } else {
            // Void - Check if void sprite sheet loads
            spriteSheet = 'void';
            spriteX = 50;
            spriteY = 50;
            spriteW = 80;
            spriteH = 80;
        }
        
        this.decorations.push({ 
            x, y, 
            spriteSheet, 
            spriteX, spriteY, spriteW, spriteH,
            layer: 'floor'
        });
    }

    addWallDecoration(x, y, dungeonType) {
        let spriteX, spriteY, spriteW, spriteH, spriteSheet;
        
        if (dungeonType.includes('Crypts')) {
            // Wall torches and chains
            spriteSheet = 'crypts';
            const options = [
                { sx: 80, sy: 350, sw: 100, sh: 150 },  // Lit torch
                { sx: 280, sy: 350, sw: 100, sh: 150 }, // Lit torch 2
                { sx: 50, sy: 700, sw: 120, sh: 200 },  // Chain long
                { sx: 250, sy: 700, sw: 100, sh: 150 }  // Chain short
            ];
            const choice = options[Math.floor(Math.random() * options.length)];
            spriteX = choice.sx;
            spriteY = choice.sy;
            spriteW = choice.sw;
            spriteH = choice.sh;
        } else if (dungeonType.includes('Mines') || dungeonType.includes('Goblin')) {
            // Hanging seaweed
            spriteSheet = 'mines';
            const options = [
                { sx: 450, sy: 280, sw: 100, sh: 120 },  // Hanging seaweed
                { sx: 600, sy: 280, sw: 100, sh: 120 }   // Hanging seaweed 2
            ];
            const choice = options[Math.floor(Math.random() * options.length)];
            spriteX = choice.sx;
            spriteY = choice.sy;
            spriteW = choice.sw;
            spriteH = choice.sh;
        } else if (dungeonType.includes('Temple')) {
            // Hanging vines
            spriteSheet = 'temple';
            const options = [
                { sx: 350, sy: 80, sw: 80, sh: 150 },   // Vine 1
                { sx: 450, sy: 80, sw: 80, sh: 150 },   // Vine 2
                { sx: 550, sy: 80, sw: 80, sh: 150 }    // Vine 3
            ];
            const choice = options[Math.floor(Math.random() * options.length)];
            spriteX = choice.sx;
            spriteY = choice.sy;
            spriteW = choice.sw;
            spriteH = choice.sh;
        } else {
            spriteSheet = dungeonType.includes('Magma') ? 'magma' : 'void';
            spriteX = 50;
            spriteY = 50;
            spriteW = 80;
            spriteH = 100;
        }
        
        this.decorations.push({ 
            x, y, 
            spriteSheet, 
            spriteX, spriteY, spriteW, spriteH,
            layer: 'wall'
        });
    }

    generateLootNodes() {
        const nodeCount = 50 + Math.floor(Math.random() * 20); // 50-70 nodes for longer idle gameplay
        const spawnPoint = this.getRandomSpawnPoint();
        const totalGoldTarget = 10.0; // Higher target gold for longer dungeons
        
        // Calculate gold per node to reach target
        const avgGoldPerNode = totalGoldTarget / (nodeCount * 0.8); // Assume 80% kill rate
        
        for (let i = 0; i < nodeCount; i++) {
            let x, y, attempts = 0;
            let foundValid = false;
            
            // Find valid walkable position with guaranteed path
            do {
                x = 1 + Math.floor(Math.random() * (this.gridWidth - 2));
                y = 1 + Math.floor(Math.random() * (this.gridHeight - 2));
                attempts++;
                
                // Must be walkable and not occupied
                if (this.grid[y][x] === 0 && !this.hasLootNodeAt(x, y)) {
                    // Ensure minimum spacing between entities (3 tiles apart to prevent overlap at large sizes)
                    const minDist = 3;
                    const tooClose = this.lootNodes.some(n => {
                        const dx = n.gridX - x;
                        const dy = n.gridY - y;
                        return Math.abs(dx) < minDist && Math.abs(dy) < minDist;
                    });
                    if (tooClose) continue;

                    // Quick reachability check: verify at least one adjacent tile is walkable
                    const directions = [
                        {dx: 0, dy: -1}, {dx: 1, dy: 0}, {dx: 0, dy: 1}, {dx: -1, dy: 0}
                    ];
                    
                    for (const dir of directions) {
                        const adjX = x + dir.dx;
                        const adjY = y + dir.dy;
                        if (this.grid[adjY] && this.grid[adjY][adjX] === 0) {
                            foundValid = true;
                            break;
                        }
                    }
                }
            } while (!foundValid && attempts < 50);
            
            if (foundValid) {
                const type = Math.random() < 0.7 ? 'monster' : 'chest'; // More monsters than chests
                const health = type === 'chest' ? this.config.chestHealth : this.config.monsterHealth;
                
                // Gold per kill: random variance around average to reach target
                const goldVariance = 0.5 + Math.random(); // 0.5x to 1.5x
                const reward = Math.round((avgGoldPerNode * goldVariance) * 100) / 100; // Round to 2 decimals
                
                // Assign random monster image if it's a monster
                let monsterImage = null;
                if (type === 'monster' && this.config.monsters && this.config.monsters.length > 0) {
                    const randomMonster = this.config.monsters[Math.floor(Math.random() * this.config.monsters.length)];
                    monsterImage = `monsters/${this.config.monsterFolder}/${randomMonster}`;
                }
                
                this.lootNodes.push(new LootNode(x, y, type, health, reward, monsterImage));
            }
        }
        
        console.log(`📦 Generated ${this.lootNodes.length} loot nodes (avg ${avgGoldPerNode.toFixed(2)} gold each, target ~${totalGoldTarget} total)`);
    }

    hasLootNodeAt(x, y) {
        return this.lootNodes.some(node => !node.isDestroyed && node.gridX === x && node.gridY === y);
    }

    getLootNodeAt(x, y) {
        return this.lootNodes.find(node => !node.isDestroyed && node.gridX === x && node.gridY === y);
    }

    getActiveLootNodes() {
        return this.lootNodes.filter(node => !node.isDestroyed);
    }

    isWalkable(x, y) {
        if (x < 0 || x >= this.gridWidth || y < 0 || y >= this.gridHeight) {
            return false;
        }
        return this.grid[y][x] === 0;
    }

    // Idle monsters stroll: they walk up to PATROL_RANGE tiles away from the
    // tile they spawned on (their mean position) and then walk back to it.
    // While a knight is fighting them they stand their ground. Movement is
    // purely visual bookkeeping — gridX/gridY follow the steps so targeting,
    // pathfinding and combat keep working untouched.
    updateLootNodes(deltaTime, deployedKnights = []) {
        const knights = deployedKnights || [];

        this.lootNodes.forEach(node => {
            if (node.isDestroyed) return;

            // Only monsters stroll — chests are fixed scenery that opens where it
            // stands once its hit points are gone.
            if (node.type !== 'monster') {
                node.stepTarget = null;
                node.moveTimer = 0;
                return;
            }

            // Fight-back wind-up: the monster holds still and counters only after the
            // knight's swing has played out. Ticked here (not at render time) so it
            // keeps counting even while the monster is off screen.
            if (node.counterDelay > 0) {
                node.counterDelay = Math.max(0, node.counterDelay - deltaTime);
                if (node.counterDelay === 0) node.counterTime = 0.35;
            }

            // Sense anyone who has stepped into its domain: turn to face them and
            // stop strolling. This is what makes a monster look like it notices a
            // knight arriving, rather than being hacked at while facing away.
            const sensed = this.senseKnight(node, knights);
            node.alerted = !!sensed;
            if (sensed) {
                if (sensed.facing !== node.facing) node.alertTime = 0.45;
                node.facing = sensed.facing;
            }
            if (node.alertTime > 0) node.alertTime = Math.max(0, node.alertTime - deltaTime);

            // Engaged = a knight is targeting it or standing right next to it
            node.engaged = knights.some(knight => {
                if (!knight || !knight.gridPosition) return false;
                if (knight.target === node) return true;
                return Math.abs(knight.gridPosition.x - node.gridX) +
                       Math.abs(knight.gridPosition.y - node.gridY) <= 1;
            });

            // Fighting, spotted, flinching, winding up or counter-attacking: freeze
            // the stroll so a monster holds its ground while it stares someone down
            if (node.engaged || node.alerted || node.hitTime > 0 || node.counterDelay > 0 || node.counterTime > 0) {
                node.stepTarget = null;
                node.moveTimer = 0;
                return;
            }

            // Finish the step currently in progress
            if (node.stepTarget) {
                node.moveTimer += deltaTime;
                if (node.moveTimer >= node.stepDuration) {
                    // Arriving is not guaranteed: another monster may have taken the
                    // tile while this one was in flight. Stand still and pick again
                    // rather than sharing a tile with it.
                    if (this.isOccupiedByOther(node, node.stepTarget.x, node.stepTarget.y)) {
                        node.stepTarget = null;
                        node.moveTimer = 0;
                        node.patrolPause = 0.2 + Math.random() * 0.6;
                        return;
                    }
                    node.gridX = node.stepTarget.x;
                    node.gridY = node.stepTarget.y;
                    node.stepTarget = null;
                    node.moveTimer = 0;
                    node.patrolPause = 0.35 + Math.random() * 1.5;
                }
                return;
            }

            // Stand around between steps
            if (node.patrolPause > 0) {
                node.patrolPause -= deltaTime;
                return;
            }

            const next = this.pickPatrolStep(node, knights);
            if (!next) {
                node.patrolPause = 1 + Math.random() * 1.5;
                return;
            }

            node.facing = Math.sign(next.x - node.gridX) || node.facing;
            node.stepTarget = next;
            node.stepDuration = PATROL_STEP_TIME;
            node.moveTimer = 0;
        });
    }

    // Is another live loot node standing on this tile? Used as a last check before
    // a monster commits to a step, so two can never occupy one tile.
    isOccupiedByOther(node, x, y) {
        return (this.lootNodes || []).some(other =>
            other !== node && !other.isDestroyed && other.gridX === x && other.gridY === y);
    }

    // Has another monster already claimed this tile as the destination of a step it
    // is part-way through? A monster's grid position only updates when the step
    // completes, so without this its destination would look empty to everyone else.
    isReservedByOther(node, x, y) {
        return (this.lootNodes || []).some(other =>
            other !== node && !other.isDestroyed && other.stepTarget &&
            other.stepTarget.x === x && other.stepTarget.y === y);
    }

    // Which knight a monster has noticed: the nearest one standing inside its own
    // domain, if any. The direction is what the monster turns to face, so a knight
    // walking in from the left is met head-on instead of being ignored.
    senseKnight(node, knights = []) {
        let best = null;
        let bestDist = Infinity;

        for (const knight of knights) {
            if (!knight || !knight.gridPosition) continue;
            const dx = knight.gridPosition.x - node.gridX;
            const dy = knight.gridPosition.y - node.gridY;
            const dist = Math.hypot(dx, dy);
            if (dist > MONSTER_DOMAIN) continue;
            if (dist < bestDist) {
                bestDist = dist;
                // Sprites are side-on, so facing is left/right only: a knight directly
                // above or below keeps the monster's current heading.
                best = { dx, dy, facing: dx === 0 ? (node.facing === -1 ? -1 : 1) : (dx > 0 ? 1 : -1) };
            }
        }

        return best;
    }

    // Pick the next tile of a monster's stroll: drift outwards while under
    // PATROL_RANGE from home, then head back to home. Only walkable tiles that
    // are free of other loot and knights qualify.
    pickPatrolStep(node, knights = []) {
        const distHome = Math.abs(node.gridX - node.homeX) + Math.abs(node.gridY - node.homeY);

        // Back at the mean position: rest a moment, then drift out again
        if (distHome === 0 && node.patrolLeg === 'home') {
            node.patrolLeg = 'out';
            node.patrolPause = 1.2 + Math.random() * 2.5;
            return null;
        }
        if (distHome >= PATROL_RANGE) {
            node.patrolLeg = 'home';
        }

        const returning = node.patrolLeg === 'home';
        const dirs = [
            { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }
        ];

        // Score directions. Returning monsters want the smallest distance to
        // home; strolling monsters want to keep drifting outwards (they only turn
        // back once they've reached PATROL_RANGE). Walls and occupied tiles lose.
        const scored = dirs
            .map(dir => {
                const x = node.gridX + dir.x;
                const y = node.gridY + dir.y;
                const d = Math.abs(x - node.homeX) + Math.abs(y - node.homeY);
                let score = returning ? d : 0;
                if (!returning && d < distHome) score += 50;              // don't head home mid-stroll
                if (d > PATROL_RANGE) score += 100;                       // outside the stroll radius
                if (!this.isWalkable(x, y)) score += 1000;                // wall
                if (this.hasLootNodeAt(x, y)) score += 500;               // occupied
                // Two monsters must never end up on the same tile, and a monster
                // mid-stride still counts as owning where it is walking to —
                // otherwise both would drift onto one tile together.
                if (this.isReservedByOther(node, x, y)) score += 500;     // someone is headed there
                if (knights.some(k => k.gridPosition && k.gridPosition.x === x && k.gridPosition.y === y)) {
                    score += 500;                                         // knight standing there
                }
                return { dir, x, y, score: score + Math.random() };
            })
            .sort((a, b) => a.score - b.score);

        const best = scored[0];
        if (!best || best.score >= 100) return null;
        return { x: best.x, y: best.y };
    }

    getRandomSpawnPoint() {
        return this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)];
    }

    // A spawn tile no other knight already holds — a squad deploys side by side
    // instead of piling onto one tile, since units never share a tile.
    getFreeSpawnPoint(taken = []) {
        const free = this.spawnPoints.filter(p =>
            !taken.some(t => t.x === p.x && t.y === p.y) &&
            this.isWalkable(p.x, p.y) &&
            !this.hasLootNodeAt(p.x, p.y));
        const pool = free.length ? free : this.spawnPoints;
        return pool[Math.floor(Math.random() * pool.length)] || { x: 1, y: 1 };
    }

    // Top-down 2D coordinate conversion (no isometric needed)
    gridToScreen(gridX, gridY) {
        const tileSize = this.config.tileSize;
        
        return {
            x: gridX * tileSize,
            y: gridY * tileSize
        };
    }

    screenToGrid(screenX, screenY) {
        const tileSize = this.config.tileSize;
        
        return {
            x: Math.floor(screenX / tileSize),
            y: Math.floor(screenY / tileSize)
        };
    }
}

// Dungeon Renderer - Top-Down 2D View
// ---------------------------------------------------------------------------
// Sprite sheet support
// ---------------------------------------------------------------------------
// Sheets live under public/sprites/ and are declared in
// public/sprites/manifest.json, so the engine never probes for files that do
// not exist. A sheet is a horizontal strip of square frames; when the manifest
// omits "frames" the count is inferred from the strip's aspect ratio.
//
// Every entity keeps a procedural fallback (canvas transforms applied to the
// existing static PNG), so the game animates with or without sheets, and art
// can be upgraded one sheet at a time with no code changes.
class SpriteSheet {
    constructor(entry) {
        this.id = entry.id;
        this.declaredFrames = entry.frames || 0;
        this.frames = Math.max(1, this.declaredFrames || 1);
        this.fps = entry.fps || 10;
        this.loop = entry.loop !== false;
        this.loaded = false;
        this.frame = 0;
        this.elapsed = 0;
        this.image = new Image();
        this.image.onload = () => {
            // Infer the frame count from a square-frame strip when undeclared
            if (!this.declaredFrames && this.image.naturalHeight > 0) {
                this.frames = Math.max(1, Math.round(this.image.naturalWidth / this.image.naturalHeight));
            }
            this.loaded = true;
        };
        this.image.onerror = () => {
            this.loaded = false;
            console.warn(`⚠️ Sprite sheet failed to load: ${entry.src}`);
        };
        this.image.src = entry.src;
    }

    // Loop sheets cycle forever; one-shots hold their final frame.
    advance(deltaTime) {
        if (!this.loaded || this.frames <= 1) return;
        this.elapsed += deltaTime;
        const step = 1 / this.fps;
        while (this.elapsed >= step) {
            this.elapsed -= step;
            if (this.frame < this.frames - 1) this.frame += 1;
            else if (this.loop) this.frame = 0;
            else break;
        }
    }

    reset() {
        this.frame = 0;
        this.elapsed = 0;
    }

    // Draws the current frame anchored at its feet, centred on (cx, cy).
    draw(ctx, cx, cy, size, facing = 1) {
        if (!this.loaded || this.image.naturalWidth === 0) return false;
        const frameWidth = this.image.naturalWidth / this.frames;
        const frameHeight = this.image.naturalHeight;

        ctx.save();
        ctx.translate(cx, cy);
        if (facing < 0) ctx.scale(-1, 1);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(
            this.image,
            this.frame * frameWidth, 0, frameWidth, frameHeight,
            -size / 2, -size, size, size
        );
        ctx.restore();
        return true;
    }
}

class DungeonRenderer {
    constructor(canvas, dungeon) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.dungeon = dungeon;
        
        // Calculate zoom to FILL entire canvas (no padding)
        const mapWidth = dungeon.gridWidth * dungeon.config.tileSize;
        const mapHeight = dungeon.gridHeight * dungeon.config.tileSize;
        
        // Fill canvas completely - no empty space
        const zoomX = canvas.width / mapWidth;
        const zoomY = canvas.height / mapHeight;
        this.zoom = Math.min(zoomX, zoomY); // Use smallest to ensure it fits
        
        // No offset - map starts at 0,0 and fills canvas
        this.offsetX = 0;
        this.offsetY = 0;

        // Load decoration sprite sheets
        this.decorationSprites = {};
        this.loadDecorationSprites();
        
        // Load knight images
        this.knightImages = {};
        this.loadKnightImages();

        // Optional sprite sheets (procedural animation is the fallback)
        this.spriteSheets = {};
        this.loadSpriteSheets();

        // Load chest images for each dungeon type
        this.chestImages = {};
        const chestMap = {
            'crypts': 'assets/crypts/chest.png',
            'mines': 'assets/mines/chest.png',
            'temple': 'assets/temple/chest.png',
            'magma': 'assets/magma/chest.png',
            'void': 'assets/void/chest.png'
        };
        Object.entries(chestMap).forEach(([key, path]) => {
            const img = new Image();
            img.onload = () => console.log(`✅ Loaded ${key} chest`);
            img.onerror = () => console.warn(`⚠️ Failed to load ${key} chest: ${path}`);
            img.src = path;
            this.chestImages[key] = img;
        });
    }

    loadDecorationSprites() {
        const sprites = {
            'crypts': 'assets/crypts/crypts-sheet.jpeg',
            'mines': 'assets/mines/mines-sheet.jpeg',
            'temple': 'assets/temple/temple-sheet.jpeg',
            'magma': 'assets/magma/magma-sheet.jpeg',
            'void': 'assets/void/void-sheet.jpeg'
        };

        Object.entries(sprites).forEach(([key, path]) => {
            const img = new Image();
            img.onload = () => {
                console.log(`✅ Loaded ${key} decoration sprites`);
            };
            img.onerror = () => {
                console.warn(`⚠️ Failed to load ${key} decorations: ${path}`);
            };
            img.src = path;
            this.decorationSprites[key] = img;
        });
        
        // Load floor tile images for each theme
        this.floorTiles = {};
        const floorTileMap = {
            'mines': 'assets/mines/floor-tile.png',
            'magma': 'assets/magma/floor-tile.png',
            'void': 'assets/void/floor-tile.png',
            'temple': 'assets/temple/floor-tile.png',
            'crypts': 'assets/crypts/floor-tile.png'
        };
        
        Object.entries(floorTileMap).forEach(([key, path]) => {
            const img = new Image();
            img.onload = () => {
                console.log(`✅ Loaded ${key} floor tile`);
            };
            img.onerror = () => {
                console.warn(`⚠️ Failed to load ${key} floor tile: ${path}`);
            };
            img.src = path;
            this.floorTiles[key] = img;
        });
        
        // Load individual monster images
        this.monsterImages = {}; // Store loaded monster images by path
        this.monsterLoadStatus = {};
        
        // Preload all monster images from all dungeons
        Object.entries(DUNGEONS).forEach(([dungeonKey, config]) => {
            if (config.monsters && config.monsters.length > 0) {
                config.monsters.forEach(monsterFile => {
                    const monsterPath = `monsters/${config.monsterFolder}/${monsterFile}`;
                    
                    if (!this.monsterImages[monsterPath]) {
                        const img = new Image();
                        
                        img.onload = () => {
                            this.monsterLoadStatus[monsterPath] = 'loaded';
                            console.log(`✅ Loaded monster: ${monsterFile}`);
                        };
                        
                        img.onerror = (err) => {
                            this.monsterLoadStatus[monsterPath] = 'failed';
                            console.error(`❌ Failed to load monster: ${monsterPath}`, err);
                        };
                        
                        img.src = monsterPath;
                        this.monsterImages[monsterPath] = img;
                        this.monsterLoadStatus[monsterPath] = 'loading';
                    }
                });
            }
        });
        
        const totalMonsters = Object.keys(this.monsterImages).length;
        console.log(`🎨 Loading ${totalMonsters} unique monster images`);
        
        // Debug: log monster load status after 2 seconds
        setTimeout(() => {
            const loaded = Object.values(this.monsterLoadStatus).filter(s => s === 'loaded').length;
            const failed = Object.values(this.monsterLoadStatus).filter(s => s === 'failed').length;
            console.log(`🔍 Monster Load Status: ${loaded} loaded, ${failed} failed out of ${totalMonsters}`);
        }, 2000);
    }

    loadKnightImages() {
        // Map rarity tiers to actual image files (correct filenames with .png)
        const imageMap = {
            'LEGENDARY': 'characters/Knight_in_golden_armor_stands_2K_202609041404_jpeg_2K_202609041417.png',
            'MYTHIC': 'characters/Pixel_knight_holding_cosmic_shield_2K_202609041402_jpeg_2K_202609041417.png',
            'EPIC': 'characters/Pixel_knight_holding_wooden_shield_2K_202609041402_jpeg_2K_202609041417.png',
            'RARE': 'characters/Pixel_knight_standing_on_floor_2K_202609041402_jpeg_2K_202609041417.png',
            'UNCOMMON': 'characters/Pixelated_knight_standing_on_tile_2K_202609041402_jpeg_2K_202609041417.png',
            'COMMON': 'characters/Pixelated_knight_standing_on_tile_2K_202609041402_jpeg_2K_202609041417.png'
        };

        Object.entries(imageMap).forEach(([rarity, path]) => {
            const img = new Image();
            img.onload = () => {
                console.log(`✅ Loaded ${rarity} knight sprite`);
            };
            img.onerror = () => {
                console.warn(`⚠️ Failed to load ${rarity} knight: ${path}`);
            };
            img.src = path;
            this.knightImages[rarity] = img;
        });
    }

    // Sprite sheets are optional: public/sprites/manifest.json lists whatever
    // frame art exists, and everything else falls back to procedural animation.
    loadSpriteSheets() {
        this.spriteSheets = {};
        if (typeof fetch !== 'function') return;

        fetch('sprites/manifest.json', { cache: 'no-store' })
            .then(res => (res.ok ? res.json() : null))
            .then(manifest => {
                if (!manifest || !Array.isArray(manifest.sheets)) return;
                manifest.sheets.forEach(entry => {
                    if (!entry || !entry.id || !entry.src) return;
                    this.spriteSheets[entry.id] = new SpriteSheet(entry);
                });
                const count = Object.keys(this.spriteSheets).length;
                if (count > 0) console.log(`🎞️ Sprite sheets registered: ${count}`);
            })
            .catch(() => { /* no manifest yet — procedural animation only */ });
    }

    // Look up a sheet by id, trying each candidate in order (most specific first).
    getSheet(...ids) {
        for (const id of ids) {
            if (id && this.spriteSheets && this.spriteSheets[id]) return this.spriteSheets[id];
        }
        return null;
    }

    // Grid position with sub-tile interpolation so knights glide between tiles
    // instead of hopping. moveKnight() snaps one tile per 1/speed seconds and
    // keeps the accumulator, which is exactly the interpolation ratio.
    getKnightRenderGrid(knight) {
        const grid = knight.gridPosition;
        const t = knight.getMoveProgress ? knight.getMoveProgress() : 0;
        if (t <= 0 || !knight.path || knight.path.length < 2) return { x: grid.x, y: grid.y };
        const next = knight.path[1];
        return {
            x: grid.x + (next.x - grid.x) * t,
            y: grid.y + (next.y - grid.y) * t
        };
    }

    render(knights) {
        const ctx = this.ctx;
        const dungeon = this.dungeon;
        const tileSize = dungeon.config.tileSize * this.zoom;

        // Frame delta for sprite-sheet playback (clamped so a stalled tab or a
        // debugger pause cannot fast-forward the animations)
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        this.frameDelta = this._lastFrameTime ? Math.min(0.1, (now - this._lastFrameTime) / 1000) : 1 / 60;
        this._lastFrameTime = now;

        // Clear canvas (transparent — video background shows through)
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Render grid overlay tiles
        for (let y = 0; y < dungeon.gridHeight; y++) {
            for (let x = 0; x < dungeon.gridWidth; x++) {
                const cell = dungeon.grid[y][x];
                // When using painted maps, skip floor — video shows through
                if (dungeon.usePainted && cell === 0) continue;

                const screenPos = dungeon.gridToScreen(x, y);
                const screenX = screenPos.x * this.zoom + this.offsetX;
                const screenY = screenPos.y * this.zoom + this.offsetY;

                this.renderTile(screenX, screenY, cell, x, y, tileSize);
            }
        }

        // Render glowing knight trails BEFORE knights
        knights.forEach(knight => {
            if (knight.isDeployed && knight.trail.length > 0) {
                this.renderKnightTrail(knight, tileSize);
            }
        });

        // Render floor decorations
        dungeon.decorations.filter(d => d.layer === 'floor').forEach(dec => {
            const screenPos = dungeon.gridToScreen(dec.x, dec.y);
            const screenX = screenPos.x * this.zoom + this.offsetX;
            const screenY = screenPos.y * this.zoom + this.offsetY;
            this.renderDecoration(screenX, screenY, dec, tileSize);
        });

        // Render obstacle decorations (on type 2 tiles)
        dungeon.decorations.filter(d => d.layer === 'obstacle').forEach(dec => {
            const screenPos = dungeon.gridToScreen(dec.x, dec.y);
            const screenX = screenPos.x * this.zoom + this.offsetX;
            const screenY = screenPos.y * this.zoom + this.offsetY;
            this.renderDecoration(screenX, screenY, dec, tileSize);
        });

        // Render wall decorations
        dungeon.decorations.filter(d => d.layer === 'wall').forEach(dec => {
            const screenPos = dungeon.gridToScreen(dec.x, dec.y);
            const screenX = screenPos.x * this.zoom + this.offsetX;
            const screenY = screenPos.y * this.zoom + this.offsetY;
            this.renderDecoration(screenX, screenY, dec, tileSize);
        });

        // Render loot nodes (interpolated so strolling monsters glide)
        dungeon.getActiveLootNodes().forEach(node => {
            const pos = this.getNodeRenderGrid(node);
            const screenPos = dungeon.gridToScreen(pos.x, pos.y);
            const screenX = screenPos.x * this.zoom + this.offsetX;
            const screenY = screenPos.y * this.zoom + this.offsetY;
            this.renderLootNode(screenX, screenY, node, tileSize);
        });

        // Render knights (interpolated so they glide between tiles)
        knights.forEach(knight => {
            if (knight.isDeployed) {
                const pos = this.getKnightRenderGrid(knight);
                const screenPos = dungeon.gridToScreen(pos.x, pos.y);
                const screenX = screenPos.x * this.zoom + this.offsetX;
                const screenY = screenPos.y * this.zoom + this.offsetY;
                this.renderKnight(screenX, screenY, knight, tileSize);
            }
        });

        // Render combat effects
        if (window.game && window.game.combat) {
            this.renderCombatEffects(window.game.combat.activeEffects, tileSize);
        }
        
        // Render atmospheric text overlays
        this.renderAtmosphericText();

        // Render decorative border frame (DISABLED - using CSS borders instead)
        // this.renderBorderFrame();

        // Render minimap
        this.renderMinimap();
    }

    updateCamera(knights, tileSize) {
        const deployedKnights = knights.filter(k => k.isDeployed);
        if (deployedKnights.length === 0) {
            // Center on spawn area
            this.camera.x = this.canvas.width / 2 - (2 * tileSize);
            this.camera.y = this.canvas.height / 2 - (2 * tileSize);
            return;
        }

        // Center camera on average knight position
        const avgX = deployedKnights.reduce((sum, k) => sum + k.gridPosition.x, 0) / deployedKnights.length;
        const avgY = deployedKnights.reduce((sum, k) => sum + k.gridPosition.y, 0) / deployedKnights.length;
        
        const targetX = this.canvas.width / 2 - (avgX * tileSize);
        const targetY = this.canvas.height / 2 - (avgY * tileSize);
        
        // Smooth camera movement
        this.camera.x += (targetX - this.camera.x) * 0.05;
        this.camera.y += (targetY - this.camera.y) * 0.05;
    }

    renderTile(x, y, type, gridX, gridY, tileSize) {
        const ctx = this.ctx;
        const theme = this.dungeon.config.theme;
        
        if (type === 1) {
            // Border walls - INVISIBLE (video background only)
            // No walls rendered
            
        } else if (type === 2) {
            // Permanent obstacles - INVISIBLE (video background only)
            // No obstacles rendered
            
        } else if (type === 3) {
            // Breakable obstacles - INVISIBLE (video background only)
            // No breakable obstacles rendered
            
        } else {
            // Floor tiles - COMPLETELY INVISIBLE (0% opacity, video only)
            // No floor tiles rendered - video background shows through completely
        }
    }

    renderDecoration(x, y, dec, tileSize) {
        const ctx = this.ctx;
        const centerX = x + tileSize / 2;
        const centerY = y + tileSize / 2;
        
        // NEW: Handle image-based decorations
        if (dec.imagePath) {
            // Load image if not already loaded
            if (!this.obstacleImages) {
                this.obstacleImages = {};
            }
            
            if (!this.obstacleImages[dec.imagePath]) {
                this.obstacleImages[dec.imagePath] = new Image();
                this.obstacleImages[dec.imagePath].src = dec.imagePath;
            }
            
            const img = this.obstacleImages[dec.imagePath];
            
            if (img.complete && img.naturalWidth > 0) {
                ctx.save();
                // Draw the obstacle image filling the tile
                ctx.drawImage(img, x, y, tileSize, tileSize);
                ctx.restore();
            }
            return;
        }
        
        // OLD: Handle sprite sheet-based decorations (legacy)
        const spriteSheet = this.decorationSprites[dec.spriteSheet];
        
        if (spriteSheet && spriteSheet.complete && spriteSheet.naturalWidth > 0) {
            ctx.save();
            ctx.drawImage(
                spriteSheet,
                dec.spriteX, dec.spriteY, dec.spriteW, dec.spriteH,
                x, y, tileSize, tileSize
            );
            ctx.restore();
        } else {
            // Fallback - draw visible colored shapes
            ctx.save();
            ctx.fillStyle = this.dungeon.config.theme.accent;
            ctx.fillRect(x + tileSize * 0.2, y + tileSize * 0.2, tileSize * 0.6, tileSize * 0.6);
            ctx.restore();
        }
    }

    // Sub-tile position of a loot node: monsters interpolate from the tile they
    // stand on toward the tile they are walking into.
    getNodeRenderGrid(node) {
        if (!node.stepTarget || !node.stepDuration) {
            return { x: node.gridX, y: node.gridY };
        }
        const t = Math.max(0, Math.min(1, (node.moveTimer || 0) / node.stepDuration));
        return {
            x: node.gridX + (node.stepTarget.x - node.gridX) * t,
            y: node.gridY + (node.stepTarget.y - node.gridY) * t
        };
    }

    renderLootNode(x, y, node, tileSize) {
        const ctx = this.ctx;
        const centerX = x + tileSize / 2;
        const centerY = y + tileSize / 2;
        
        // Animation clocks — advance with the frame delta when available
        const dt = this.frameDelta || 0.016;
        node.animationTime += dt;

        // Decay the hit / fight-back timers set by the combat system
        if (node.hitTime > 0) node.hitTime = Math.max(0, node.hitTime - dt);
        if (node.counterTime > 0) node.counterTime = Math.max(0, node.counterTime - dt);
        if (node.counterCooldown > 0) node.counterCooldown = Math.max(0, node.counterCooldown - dt);
        
        if (node.type === 'chest') {
            // Draw chest using actual image if loaded
            const chestImg = this.chestImages[this.dungeon.type];
            const chestSize = tileSize * 1.75; // 2.5x scale

            // Floating animation
            const floatOffset = Math.sin(node.animationTime * 2) * 3;

            if (chestImg && chestImg.complete && chestImg.naturalWidth > 0) {
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(
                    chestImg,
                    centerX - chestSize / 2,
                    centerY - chestSize / 2 + floatOffset,
                    chestSize, chestSize
                );
            } else {
                // Fallback: simple gold square
                ctx.fillStyle = '#d4af37';
                ctx.fillRect(centerX - chestSize / 2, centerY - chestSize / 2 + floatOffset, chestSize, chestSize);
                ctx.strokeStyle = '#8B6914';
                ctx.lineWidth = 2;
                ctx.strokeRect(centerX - chestSize / 2, centerY - chestSize / 2 + floatOffset, chestSize, chestSize);
            }
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1.0;
            
        } else {
            // Draw monster with individual PNG image
            const monsterSize = tileSize * 2.7;

            // Idle breathing + flinch + fight-back lunge
            const breathe = 1 + Math.sin(node.animationTime * 2 + (node.animPhase || 0)) * 0.025;
            const flinch = Math.min(1, (node.hitTime || 0) / 0.3);
            const counter = Math.min(1, (node.counterTime || 0) / 0.35);
            const lungeCurve = Math.sin(counter * Math.PI);
            const lungeX = node.counterFrom ? node.counterFrom.dx * monsterSize * 0.3 * lungeCurve : 0;
            const lungeY = node.counterFrom ? node.counterFrom.dy * monsterSize * 0.3 * lungeCurve : 0;
            const shake = flinch > 0 ? Math.sin(node.animationTime * 90) * 4 * flinch : 0;

            // Idle bounce (desynced per monster by animationTime's random start)
            const bounceOffset = Math.sin(node.animationTime * 3) * 4;
            const drawSize = monsterSize * breathe;
            const monsterX = centerX + lungeX + shake;
            const finalMonsterY = centerY + bounceOffset + lungeY;

            // Walk cycle: a lumbering waddle while strolling, upright in combat.
            // Facing keeps the monster looking where it walks (and where it hits).
            const strolling = !!node.stepTarget;
            const waddle = strolling
                ? Math.sin((node.moveTimer || 0) * 9) * 0.07
                : 0;
            const facing = node.facing === -1 ? -1 : 1;

            // Shadow beneath monster
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.beginPath();
            ctx.ellipse(monsterX, centerY + monsterSize * 0.45, monsterSize * 0.35, monsterSize * 0.12, 0, 0, Math.PI * 2);
            ctx.fill();

            // "Spotted you" flare the moment it turns to face a knight
            if (node.alertTime > 0) {
                const t = 1 - node.alertTime / 0.45;
                ctx.save();
                ctx.globalAlpha = (1 - t) * 0.6;
                ctx.strokeStyle = this.dungeon.config.theme.accent;
                ctx.lineWidth = Math.max(1.5, monsterSize * 0.03);
                ctx.beginPath();
                ctx.arc(monsterX, centerY, monsterSize * (0.28 + 0.3 * t), 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }

            // Frame art wins when a sheet is registered for this monster
            const monsterId = this.monsterSheetId(node);
            let monsterDrawn = false;
            if (monsterId) {
                const monsterSheet = this.getSheet(`monster:${monsterId}:attack`, `monster:${monsterId}:idle`, 'monster');
                if (monsterSheet) {
                    monsterSheet.advance(dt);
                    monsterDrawn = monsterSheet.draw(ctx, monsterX, finalMonsterY + drawSize / 2, drawSize);
                }
            }

            // Try to draw the monster's individual PNG image
            if (!monsterDrawn && node.monsterImage && this.monsterImages[node.monsterImage]) {
                const monsterImg = this.monsterImages[node.monsterImage];
                
                if (monsterImg.complete && monsterImg.naturalWidth > 0) {
                    ctx.save();
                    
                    // Glow aura matching theme, brighter while fighting back
                    const glowIntensity = 0.2 + Math.sin(node.animationTime * 2) * 0.1 + lungeCurve * 0.25 + flinch * 0.2 + (node.alerted ? 0.12 : 0);
                    const glowGradient = ctx.createRadialGradient(monsterX, finalMonsterY, 0, monsterX, finalMonsterY, monsterSize * 0.7);
                    glowGradient.addColorStop(0, this.dungeon.config.theme.accent + '40');
                    glowGradient.addColorStop(1, this.dungeon.config.theme.accent + '00');
                    ctx.globalAlpha = Math.min(1, glowIntensity);
                    ctx.fillStyle = glowGradient;
                    ctx.fillRect(monsterX - monsterSize * 0.7, finalMonsterY - monsterSize * 0.7, monsterSize * 1.4, monsterSize * 1.4);
                    ctx.globalAlpha = 1.0;
                    
                    // Draw monster image (breathing scales it, while walking it
                    // waddles and flips to face its heading)
                    ctx.imageSmoothingEnabled = false; // Pixel-perfect rendering
                    ctx.save();
                    ctx.translate(monsterX, finalMonsterY);
                    ctx.rotate(waddle);
                    ctx.scale(facing, 1);
                    ctx.drawImage(monsterImg, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
                    ctx.restore();
                    
                    // Hurt flash while flinching from a landed hit
                    if (flinch > 0) {
                        // Soft hurt flash that fades out at the edges — the earlier
                        // hard fillRect read as a red box pasted over the art
                        const hurtR = drawSize * 0.5;
                        const hurt = ctx.createRadialGradient(
                            monsterX, finalMonsterY, hurtR * 0.12,
                            monsterX, finalMonsterY, hurtR
                        );
                        hurt.addColorStop(0, `rgba(255,82,82,${(flinch * 0.5).toFixed(3)})`);
                        hurt.addColorStop(0.7, `rgba(255,82,82,${(flinch * 0.26).toFixed(3)})`);
                        hurt.addColorStop(1, 'rgba(255,82,82,0)');
                        ctx.fillStyle = hurt;
                        ctx.beginPath();
                        ctx.arc(monsterX, finalMonsterY, hurtR, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    
                    ctx.restore();
                } else {
                    // Fallback if image not loaded
                    this.renderFallbackMonster(ctx, monsterX, finalMonsterY, drawSize);
                }
            } else if (!monsterDrawn) {
                // Fallback monster
                this.renderFallbackMonster(ctx, monsterX, finalMonsterY, drawSize);
            }
        }
        
        // Health bar
        const healthPercent = node.getHealthPercent();
        if (healthPercent < 100) {
            const barWidth = tileSize * 0.8;
            const barHeight = 4;
            const barX = x + (tileSize - barWidth) / 2;
            const barY = y - 8;
            
            // Background
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(barX, barY, barWidth, barHeight);
            
            // Health
            const healthColor = healthPercent > 50 ? '#10b981' : (healthPercent > 25 ? '#fbbf24' : '#ef4444');
            ctx.fillStyle = healthColor;
            ctx.fillRect(barX, barY, barWidth * (healthPercent / 100), barHeight);
            
            // Border
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.lineWidth = 1;
            ctx.strokeRect(barX, barY, barWidth, barHeight);
        }
    }
    
    renderFallbackMonster(ctx, centerX, centerY, monsterSize) {
        // Fallback pixel art monster
        ctx.save();
        
        // Body with gradient
        const bodyGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, monsterSize * 0.35);
        bodyGradient.addColorStop(0, this.dungeon.config.theme.accent);
        bodyGradient.addColorStop(0.7, this.dungeon.config.theme.pillar);
        bodyGradient.addColorStop(1, this.dungeon.config.theme.wall);
        ctx.fillStyle = bodyGradient;
        ctx.beginPath();
        ctx.arc(centerX, centerY, monsterSize * 0.35, 0, Math.PI * 2);
        ctx.fill();
        
        // Dark outline
        ctx.strokeStyle = this.dungeon.config.theme.shadowColor;
        ctx.lineWidth = 3;
        ctx.stroke();
        
        // Glowing eyes
        ctx.fillStyle = this.dungeon.config.theme.glowColor;
        ctx.shadowColor = this.dungeon.config.theme.glowColor;
        ctx.shadowBlur = 10;
        
        // Left eye
        ctx.beginPath();
        ctx.arc(centerX - monsterSize * 0.12, centerY - monsterSize * 0.1, monsterSize * 0.06, 0, Math.PI * 2);
        ctx.fill();
        
        // Right eye
        ctx.beginPath();
        ctx.arc(centerX + monsterSize * 0.12, centerY - monsterSize * 0.1, monsterSize * 0.06, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.shadowBlur = 0;
        ctx.restore();
    }

    // Monster sheets are keyed by the sprite's filename stem ("monster-1.png"
    // -> "monster-1"), so new art can be dropped in without touching config.
    monsterSheetId(node) {
        if (!node.monsterImage) return null;
        const file = String(node.monsterImage).split('/').pop();
        return file.replace(/\.[^.]+$/, '');
    }

    renderKnight(x, y, knight, tileSize) {
        const ctx = this.ctx;
        const centerX = x + tileSize / 2;
        const centerY = y + tileSize / 2;
        const knightSize = tileSize * 2.0;

        // --- Facing + walk cycle -------------------------------------------
        const facing = knight.getFacingDirection ? knight.getFacingDirection() : 1;
        knight.facing = facing;
        const moving = knight.state === 'moving';
        const speed = knight.stats.speed || 1;
        const walkPhase = knight.walkPhase || 0;
        const animPhase = knight.animPhase || 0;

        // Stride scales with rarity speed, so legendary knights visibly run
        const bobAmp = moving
            ? Math.min(tileSize * 0.14, tileSize * 0.05 + speed * tileSize * 0.006)
            : tileSize * 0.012;
        const bob = Math.abs(Math.sin(walkPhase)) * bobAmp;
        let tilt = moving ? Math.sin(walkPhase) * 0.05 : Math.sin(animPhase) * 0.012;
        let stretch = moving ? 1 + Math.cos(walkPhase * 2) * 0.03 : 1 + Math.sin(animPhase) * 0.01;

        // --- Attack swing: windup -> slash -> recover -----------------------
        const swing = knight.attackAnimation.active ? knight.attackAnimation.progress : 0;
        let lungeX = 0;
        let lungeY = 0;
        if (swing > 0) {
            const windup = Math.min(1, swing / 0.25);
            const slash = Math.max(0, Math.min(1, (swing - 0.25) / 0.3));
            const recover = Math.max(0, Math.min(1, (swing - 0.55) / 0.45));
            tilt += swing < 0.25 ? -0.16 * windup
                  : swing < 0.55 ? -0.16 + 0.46 * slash
                  : 0.3 * (1 - recover);
            const reach = swing < 0.55 ? tileSize * 0.38 * slash : tileSize * 0.38 * (1 - recover);
            lungeX = facing * reach * 0.75;
            lungeY = -reach * 0.45;
            stretch *= 1 + slash * 0.04;
        }

        const drawX = centerX + lungeX;
        const drawY = centerY + lungeY - bob;

        // --- Body: real frames when sheets exist, else the static art -------
        const frameDelta = this.frameDelta || 1 / 60;
        let drawn = false;

        if (swing > 0) {
            const attackSheet = this.getSheet(`knight:${knight.rarity.tier}:attack`, 'knight:attack', 'knight');
            if (attackSheet) {
                attackSheet.advance(frameDelta);
                drawn = attackSheet.draw(ctx, drawX, drawY, knightSize, facing);
            }
        } else {
            const idleSheet = this.getSheet(
                moving ? `knight:${knight.rarity.tier}:walk` : `knight:${knight.rarity.tier}:idle`,
                moving ? 'knight:walk' : 'knight:idle',
                'knight'
            );
            if (idleSheet) {
                idleSheet.advance(frameDelta);
                drawn = idleSheet.draw(ctx, drawX, drawY, knightSize, facing);
            }
        }

        const img = this.knightImages[knight.rarity.tier];
        if (!drawn && img && img.complete && img.naturalWidth > 0) {
            drawn = true;
            ctx.save();
            ctx.imageSmoothingEnabled = false;
            // Pivot at the feet so the gait and the swing read as weight
            ctx.translate(drawX, drawY);
            if (facing < 0) ctx.scale(-1, 1);
            ctx.rotate(tilt);
            ctx.scale(1, stretch);
            ctx.drawImage(img, -knightSize / 2, -knightSize, knightSize, knightSize);

            // Impact flash: white during the swing, red while being hit back
            const flash = (swing > 0 && swing < 0.3)
                ? 0.5
                : Math.min(0.5, (knight.hitFlash || 0) * 1.6);
            if (flash > 0) {
                ctx.globalAlpha = flash;
                ctx.fillStyle = (knight.hitFlash || 0) > 0 ? '#ff6b6b' : '#ffffff';
                ctx.fillRect(-knightSize / 2, -knightSize, knightSize, knightSize);
                ctx.globalAlpha = 1.0;
            }
            ctx.restore();
        } else if (!drawn) {
            // Fallback: draw colored knight shape with rarity color
            if (knight.attackAnimation.active) {
                ctx.shadowColor = knight.rarity.color;
                ctx.shadowBlur = 20;
            }

            // Body (circle with rarity color)
            ctx.fillStyle = knight.rarity.color;
            ctx.beginPath();
            ctx.arc(drawX, drawY - knightSize * 0.2, knightSize * 0.4, 0, Math.PI * 2);
            ctx.fill();

            // White outline
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            ctx.stroke();

            // Inner glow
            ctx.strokeStyle = knight.rarity.color;
            ctx.lineWidth = 2;
            ctx.stroke();

            // Helmet top (triangle)
            ctx.fillStyle = knight.rarity.color;
            ctx.beginPath();
            ctx.moveTo(drawX, drawY - knightSize * 0.6);
            ctx.lineTo(drawX - knightSize * 0.2, drawY - knightSize * 0.3);
            ctx.lineTo(drawX + knightSize * 0.2, drawY - knightSize * 0.3);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.shadowBlur = 0;
        }

        // --- Weapon arc: sweeping slash with a fading blade trail -----------
        if (swing > 0 && knight.target && !knight.target.isDestroyed) {
            const targetPos = this.dungeon.gridToScreen(knight.target.gridX, knight.target.gridY);
            const targetScreenX = targetPos.x * this.zoom + this.offsetX + tileSize / 2;
            const targetScreenY = targetPos.y * this.zoom + this.offsetY + tileSize / 2;

            const swingT = Math.max(0, Math.min(1, (swing - 0.2) / 0.55));
            const pivotY = drawY - knightSize * 0.35;
            const angleToTarget = Math.atan2(targetScreenY - pivotY, targetScreenX - drawX);
            const radius = knightSize * 0.78;
            const sweep = Math.PI * 0.85;
            const leading = angleToTarget - sweep / 2 + sweep * swingT;

            ctx.save();
            ctx.translate(drawX, pivotY);

            // Motion trail behind the leading edge
            for (let i = 3; i >= 1; i--) {
                const trailT = swingT - i * 0.08;
                if (trailT <= 0) continue;
                const arcStart = angleToTarget - sweep / 2 + sweep * Math.max(0, trailT - 0.16);
                ctx.globalAlpha = (1 - swingT * 0.5) * (0.1 + i * 0.05);
                ctx.strokeStyle = knight.rarity.color;
                ctx.lineWidth = 7 - i;
                ctx.beginPath();
                ctx.arc(0, 0, radius, arcStart, arcStart + sweep * 0.18);
                ctx.stroke();
            }

            // Bright leading edge of the blade
            ctx.globalAlpha = 1 - swingT * 0.45;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 4;
            ctx.lineCap = 'round';
            ctx.shadowColor = knight.rarity.color;
            ctx.shadowBlur = 14;
            ctx.beginPath();
            ctx.arc(0, 0, radius, leading - 0.4, leading + 0.1);
            ctx.stroke();

            // Impact spark where the arc meets the target
            if (swingT > 0.55) {
                ctx.globalAlpha = (swingT - 0.55) / 0.45;
                ctx.fillStyle = '#fff2b0';
                ctx.beginPath();
                ctx.arc(targetScreenX - drawX, targetScreenY - pivotY, tileSize * 0.18, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }
        
        // State indicator emoji (above knight) with animations
        ctx.font = `${Math.max(12, tileSize * 0.4)}px Arial`;
        const time = Date.now() / 1000; // Current time in seconds
        
        if (knight.state === 'exhausted') {
            // Sleeping animation - Z's floating upward
            ctx.save();
            
            // Draw 3 Z's at different heights
            for (let i = 0; i < 3; i++) {
                const zOffset = ((time * 0.5 + i * 0.3) % 1) * tileSize * 0.5; // Float upward
                const alpha = 1 - ((time * 0.5 + i * 0.3) % 1); // Fade out as they rise
                const xOffset = Math.sin(time * 2 + i) * 5; // Slight wave
                
                ctx.globalAlpha = alpha;
                ctx.fillStyle = '#a5b4fc'; // Light blue color for Z's
                ctx.fillText('Z', 
                    centerX - tileSize * 0.15 + xOffset, 
                    centerY - knightSize * 0.7 - zOffset);
            }
            
            ctx.restore();
            
            // Knight opacity - breathing effect while sleeping
            ctx.save();
            ctx.globalAlpha = 0.7 + Math.sin(time * 2) * 0.1; // Gentle breathing
            ctx.restore();
            
        } else if (knight.state === 'attacking' && !knight.attackAnimation.active) {
            ctx.fillText('⚔️', centerX - tileSize * 0.2, centerY - knightSize * 0.7);
        }
        
        // Stamina bar below knight
        const barWidth = knightSize;
        const barHeight = Math.max(4, tileSize * 0.12);
        const staminaPercent = knight.getStaminaPercent() / 100;
        const barY = y + tileSize + 2;
        
        // Background
        ctx.fillStyle = '#000000';
        ctx.fillRect(centerX - barWidth / 2, barY, barWidth, barHeight);
        
        // Stamina fill - different color when exhausted
        if (knight.state === 'exhausted') {
            // Red to yellow gradient as stamina recovers
            if (staminaPercent < 0.5) {
                ctx.fillStyle = '#dc2626'; // Red when below 50%
            } else {
                ctx.fillStyle = '#f59e0b'; // Orange when recovering
            }
        } else {
            ctx.fillStyle = staminaPercent > 0.5 ? '#3b82f6' : staminaPercent > 0.25 ? '#f59e0b' : '#dc2626';
        }
        ctx.fillRect(centerX - barWidth / 2, barY, barWidth * staminaPercent, barHeight);
        
        // 50% recovery line when exhausted
        if (knight.state === 'exhausted') {
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(centerX, barY);
            ctx.lineTo(centerX, barY + barHeight);
            ctx.stroke();
        }
        
        // Border
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(centerX - barWidth / 2, barY, barWidth, barHeight);
    }

    renderMinimap() {
        const ctx = this.ctx;
        const minimapSize = 120;
        const minimapX = this.canvas.width - minimapSize - 10;
        const minimapY = 10;
        const tileScale = minimapSize / Math.max(this.dungeon.gridWidth, this.dungeon.gridHeight);
        
        // Minimap background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(minimapX, minimapY, minimapSize, minimapSize);
        
        // Minimap tiles
        for (let y = 0; y < this.dungeon.gridHeight; y++) {
            for (let x = 0; x < this.dungeon.gridWidth; x++) {
                const px = minimapX + x * tileScale;
                const py = minimapY + y * tileScale;
                
                if (this.dungeon.grid[y][x] === 1) {
                    ctx.fillStyle = '#555555';
                } else {
                    ctx.fillStyle = '#222222';
                }
                ctx.fillRect(px, py, tileScale, tileScale);
            }
        }
        
        // Minimap border
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(minimapX, minimapY, minimapSize, minimapSize);
    }

    renderCombatEffects(effects, tileSize) {
        const ctx = this.ctx;
        
        effects.forEach(effect => {
            // A delayed counter waits for the knight's swing to finish before it
            // starts drawing, so the two attacks never land on the same frame.
            if (effect.delay > 0) return;

            const screenPos = this.dungeon.gridToScreen(effect.gridX, effect.gridY);
            const screenX = screenPos.x * this.zoom + this.offsetX + tileSize / 2;
            const screenY = screenPos.y * this.zoom + this.offsetY + tileSize / 2;
            const progress = 1 - (effect.life / effect.startLife);
            
            if (effect.type === 'hit') {
                // Floating damage number
                const alpha = effect.life / effect.startLife;
                const offsetY = progress * tileSize * 0.5;
                
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.font = `bold ${Math.max(14, tileSize * 0.4)}px Arial`;
                ctx.fillStyle = '#ffff00';
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 3;
                ctx.strokeText(effect.damage, screenX - 10, screenY - offsetY - tileSize * 0.3);
                ctx.fillText(effect.damage, screenX - 10, screenY - offsetY - tileSize * 0.3);
                ctx.restore();
                
                // Impact flash
                if (progress < 0.3) {
                    ctx.save();
                    ctx.globalAlpha = (0.3 - progress) / 0.3;
                    ctx.fillStyle = '#ffff00';
                    ctx.beginPath();
                    ctx.arc(screenX, screenY, tileSize * 0.4, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.restore();
                }
            } else if (effect.type === 'coin') {
                // Floating coin animation with "+X gold" text
                const alpha = effect.life / effect.startLife;
                const offsetY = progress * tileSize * 0.8; // Float upward
                const scale = 1 + Math.sin(progress * Math.PI) * 0.3; // Bounce effect
                
                ctx.save();
                ctx.globalAlpha = alpha;
                
                // Gold coin icon
                ctx.fillStyle = '#FFD700';
                ctx.strokeStyle = '#DAA520';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(screenX, screenY - offsetY, tileSize * 0.2 * scale, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                
                // Coin sparkle
                ctx.fillStyle = '#FFFFE0';
                ctx.beginPath();
                ctx.arc(screenX - tileSize * 0.08, screenY - offsetY - tileSize * 0.08, tileSize * 0.05, 0, Math.PI * 2);
                ctx.fill();
                
                // "+X" text
                ctx.font = `bold ${Math.max(16, tileSize * 0.45)}px Arial`;
                ctx.fillStyle = '#FFD700';
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 4;
                ctx.textAlign = 'center';
                const text = `+${effect.amount.toFixed(2)}`;
                ctx.strokeText(text, screenX, screenY - offsetY - tileSize * 0.4);
                ctx.fillText(text, screenX, screenY - offsetY - tileSize * 0.4);
                
                ctx.restore();
            } else if (effect.type === 'destroy') {
                // The defeated monster drops away as a fading corpse instead of
                // blinking out of existence.
                if (effect.monsterImage && this.monsterImages[effect.monsterImage]) {
                    const corpse = this.monsterImages[effect.monsterImage];
                    if (corpse.complete && corpse.naturalWidth > 0) {
                        const corpseSize = tileSize * 2.7 * (1 - progress * 0.45);
                        ctx.save();
                        ctx.globalAlpha = Math.max(0, 1 - progress * 1.15);
                        ctx.translate(screenX, screenY + progress * tileSize * 0.35);
                        ctx.rotate(progress * 0.35);
                        ctx.imageSmoothingEnabled = false;
                        ctx.drawImage(corpse, -corpseSize / 2, -corpseSize / 2, corpseSize, corpseSize);
                        ctx.restore();
                    }
                }

                // Explosion particles
                const numParticles = 8;
                ctx.save();
                
                for (let i = 0; i < numParticles; i++) {
                    const angle = (Math.PI * 2 * i) / numParticles;
                    const distance = progress * tileSize;
                    const px = screenX + Math.cos(angle) * distance;
                    const py = screenY + Math.sin(angle) * distance;
                    const alpha = 1 - progress;
                    
                    ctx.globalAlpha = alpha;
                    ctx.fillStyle = effect.targetType === 'chest' ? '#ffd700' : '#ff4444';
                    ctx.beginPath();
                    ctx.arc(px, py, Math.max(3, tileSize * 0.1 * (1 - progress)), 0, Math.PI * 2);
                    ctx.fill();
                }
                
                // Center flash
                if (progress < 0.5) {
                    ctx.globalAlpha = (0.5 - progress) / 0.5;
                    ctx.fillStyle = '#ffffff';
                    ctx.beginPath();
                    ctx.arc(screenX, screenY, tileSize * 0.6 * progress, 0, Math.PI * 2);
                    ctx.fill();
                }
                
                ctx.restore();
            } else if (effect.type === 'chestOpen') {
                // Chest victory: the lid swings on its hinge, a shaft of gold
                // light bursts up and coins fountain out of the cavity.
                const chestImg = this.chestImages[effect.dungeonType];
                const size = tileSize * 1.75;
                const open = Math.min(1, progress * 1.6);
                const cx = screenX;
                const cy = screenY + Math.sin(progress * Math.PI) * -4;
                const hingeY = cy - size / 2 + size * 0.42;

                ctx.save();

                // Shaft of light escaping the open lid
                const beam = ctx.createLinearGradient(cx, cy, cx, cy - tileSize * 2.2);
                beam.addColorStop(0, `rgba(255, 214, 90, ${0.55 * (1 - progress)})`);
                beam.addColorStop(1, 'rgba(255, 214, 90, 0)');
                ctx.fillStyle = beam;
                ctx.beginPath();
                ctx.moveTo(cx - size * 0.3 * open, cy - size * 0.1);
                ctx.lineTo(cx + size * 0.3 * open, cy - size * 0.1);
                ctx.lineTo(cx + size * 0.62 * open, cy - tileSize * 2.2);
                ctx.lineTo(cx - size * 0.62 * open, cy - tileSize * 2.2);
                ctx.closePath();
                ctx.fill();

                if (chestImg && chestImg.complete && chestImg.naturalWidth > 0) {
                    const nw = chestImg.naturalWidth;
                    const nh = chestImg.naturalHeight;
                    const lidBand = 0.42;

                    ctx.imageSmoothingEnabled = false;

                    // Glowing cavity revealed between the base and the raised lid
                    const cavity = ctx.createLinearGradient(0, hingeY, 0, hingeY - size * 0.3 * open);
                    cavity.addColorStop(0, 'rgba(255, 226, 130, 0.9)');
                    cavity.addColorStop(1, 'rgba(255, 160, 40, 0.15)');
                    ctx.fillStyle = cavity;
                    ctx.fillRect(cx - size * 0.44, hingeY - size * 0.05 - size * 0.3 * open, size * 0.88, size * 0.3 * open + size * 0.06);

                    // Base: only the lower part of the same art
                    ctx.drawImage(
                        chestImg,
                        0, nh * lidBand, nw, nh * (1 - lidBand),
                        cx - size / 2, hingeY, size, size * (1 - lidBand)
                    );

                    // Lid: the top band rotated about its own bottom edge (hinge)
                    ctx.save();
                    ctx.translate(cx, hingeY);
                    ctx.rotate(-1.15 * open);
                    ctx.drawImage(
                        chestImg,
                        0, 0, nw, nh * lidBand,
                        -size / 2, -size * lidBand, size, size * lidBand
                    );
                    ctx.restore();
                }

                // Coin fountain out of the chest
                for (let i = 0; i < 8; i++) {
                    const angle = -Math.PI / 2 + (i - 3.5) * 0.28;
                    const dist = Math.sin(Math.min(1, progress * 1.6) * Math.PI) * tileSize * 1.1;
                    const px = cx + Math.cos(angle) * dist;
                    const py = cy - size * 0.3 + Math.sin(angle) * dist;
                    ctx.globalAlpha = Math.max(0, 1 - progress);
                    ctx.fillStyle = '#FFD700';
                    ctx.strokeStyle = '#DAA520';
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.arc(px, py, tileSize * 0.11, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                }
                ctx.globalAlpha = 1.0;
                ctx.restore();
            } else if (effect.type === 'monsterAttack') {
                this.renderMonsterAttack(effect, progress, tileSize);
            }
        });
    }

    // A monster fighting back: every dungeon spits its own flavour of pain at the
    // knight that struck it. Purely cosmetic — damage stays in the combat system.
    // The spit leaves the monster's mouth and can never stretch further than
    // MONSTER_DOMAIN tiles in any direction.
    renderMonsterAttack(effect, progress, tileSize) {
        const ctx = this.ctx;
        const source = effect.source;
        const target = effect.target;
        // A spit already in flight keeps drawing even if the monster died from the
        // same blow that provoked it — otherwise a strong squad kills monsters
        // faster than their fight-back can be seen.
        if (!source || !target || !target.gridPosition) return;

        const from = this.dungeon.gridToScreen(source.gridX, source.gridY);
        const to = this.dungeon.gridToScreen(target.gridPosition.x, target.gridPosition.y);
        const baseX = from.x * this.zoom + this.offsetX + tileSize / 2;
        const baseY = from.y * this.zoom + this.offsetY + tileSize / 2;
        let x1 = to.x * this.zoom + this.offsetX + tileSize / 2;
        let y1 = to.y * this.zoom + this.offsetY + tileSize / 2 - tileSize * 0.45;

        // Hard cap: no spit reaches past the monster's domain
        const maxReach = MONSTER_DOMAIN * tileSize;
        let dx = x1 - baseX;
        let dy = y1 - baseY;
        let dist = Math.hypot(dx, dy);
        if (dist > maxReach && dist > 0) {
            const k = maxReach / dist;
            x1 = baseX + dx * k;
            y1 = baseY + dy * k;
            dx *= k;
            dy *= k;
            dist = maxReach;
        }

        // Mouth: the sprite is 2.7 tiles tall and centred on the tile, so the
        // spit leaves the face (well above the ground) at the sprite's forward
        // edge rather than the middle of the floor.
        const monsterSize = tileSize * 2.7;
        const ux = dist > 0 ? dx / dist : (source.facing === -1 ? -1 : 1);
        const uy = dist > 0 ? dy / dist : 0;
        const x0 = baseX + ux * monsterSize * 0.26;
        const y0 = baseY - tileSize * 0.5 + uy * tileSize * 0.2;

        const theme = effect.theme || this.dungeon.config.theme || 'crypts';
        const reach = Math.min(1, progress / 0.32);  // strike extends fast
        const fade = progress < 0.62 ? 1 : 1 - (progress - 0.62) / 0.38;

        // Muzzle flash at the mouth, so the eye is grabbed the moment it spits
        if (reach > 0) this.drawMuzzleFlash(ctx, x0, y0, monsterSize, reach, fade, theme, ux, uy);

        ctx.save();
        switch (theme) {
            case 'magma':
                this.drawFlameStream(ctx, x0, y0, x1, y1, reach, fade, tileSize, progress);
                break;
            case 'mines':
                this.drawVomitBeam(ctx, x0, y0, x1, y1, reach, fade, tileSize, progress);
                break;
            case 'temple':
                this.drawVineWhip(ctx, x0, y0, x1, y1, reach, fade, tileSize, progress);
                break;
            case 'void':
                this.drawCosmicBeam(ctx, x0, y0, x1, y1, reach, fade, tileSize, progress);
                break;
            case 'crypts':
            default:
                this.drawDarkBeam(ctx, x0, y0, x1, y1, reach, fade, tileSize, progress);
                break;
        }
        ctx.restore();

        // A small burst where the spit lands
        if (progress > 0.4) {
            const burst = Math.min(1, (progress - 0.4) / 0.3);
            this.drawAttackImpact(ctx, x1, y1, tileSize, burst, Math.max(0, fade));
        }
    }

    // Monsters are drawn at 2.7 tiles tall, so the spit has to be sized against
    // the SPRITE rather than the tile — against the tile it is a hairline next to
    // the art. Shared by all five flavours so they read at one scale.
    monsterSpitRadius(tileSize, t) {
        const size = tileSize * 2.7;
        const mouth = size * 0.075;   // slim: ~a fifth of the old mouth width
        const tip = size * 0.016;
        return mouth * (1 - t) + tip * t;
    }

    // Points along a spit: bowed sideways so the stream curves instead of reading
    // as a rigid rod, with an optional droop for the ones that should arc.
    spitPoints(x0, y0, x1, y1, bow, phase, droop) {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.hypot(dx, dy) || 1;
        const nx = dy / len;
        const ny = -dx / len;
        const steps = Math.max(8, Math.min(22, Math.ceil(len / 4)));
        const pts = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const wob = Math.sin(phase + t * Math.PI * 1.6) * bow * Math.sin(t * Math.PI * 0.9);
            pts.push({
                x: x0 + dx * t + nx * wob,
                y: y0 + dy * t + ny * wob + (droop || 0) * t * t
            });
        }
        return pts;
    }

    // Fill a tapered ribbon through a polyline: w0 half-width at the mouth falling
    // to w1 at the tip. This is what keeps a spit reading as a slim lash rather
    // than a tube of fat stamped circles.
    fillTaperedRibbon(ctx, pts, w0, w1) {
        const n = pts.length;
        if (n < 2) return;
        const left = [];
        const right = [];
        for (let i = 0; i < n; i++) {
            const p = pts[i];
            const a = pts[Math.max(0, i - 1)];
            const b = pts[Math.min(n - 1, i + 1)];
            let tx = b.x - a.x;
            let ty = b.y - a.y;
            const tl = Math.hypot(tx, ty) || 1;
            tx /= tl;
            ty /= tl;
            const t = i / (n - 1);
            const w = Math.max(0.7, w0 * (1 - t) + w1 * t);
            left.push({ x: p.x - ty * w, y: p.y + tx * w });
            right.push({ x: p.x + ty * w, y: p.y - tx * w });
        }
        ctx.beginPath();
        ctx.moveTo(left[0].x, left[0].y);
        for (let i = 1; i < n; i++) ctx.lineTo(left[i].x, left[i].y);
        for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
        ctx.closePath();
        ctx.fill();
    }

    // How many circles to stamp along a spit so it reads as a smooth stream at
    // any zoom (roughly one stamp every 6 on-screen pixels)
    streamSteps(x0, y0, x1, y1, tileSize) {
        const len = Math.hypot(x1 - x0, y1 - y0);
        return Math.max(8, Math.min(28, Math.ceil(len / Math.max(3, tileSize * 0.12))));
    }

    // Point along a quadratic curve — used by the vine whip
    quadPoint(x0, y0, cx, cy, x1, y1, t) {
        const mt = 1 - t;
        return {
            x: mt * mt * x0 + 2 * mt * t * cx + t * t * x1,
            y: mt * mt * y0 + 2 * mt * t * cy + t * t * y1
        };
    }

    // Tint each dungeon's muzzle flash so the source of the spit reads instantly
    monsterSpitColor(theme) {
        switch (theme) {
            case 'magma': return { glow: '#ff7a18', core: '#ffe08a' };
            case 'mines': return { glow: '#7fbf14', core: '#e4ff7a' };
            case 'temple': return { glow: '#57a63a', core: '#c8ff8a' };
            case 'void': return { glow: '#4dd8ff', core: '#eafcff' };
            default: return { glow: '#7e3fff', core: '#e6d0ff' };
        }
    }

    // A short bloom at the mouth: charge-up while the strike extends, then flash.
    // Directional and sized off the monster sprite, so it reads as something being
    // spat forward rather than a flat disc sitting on the floor.
    drawMuzzleFlash(ctx, x, y, monsterSize, reach, fade, theme, ux, uy) {
        const c = this.monsterSpitColor(theme);
        const grow = Math.min(1, reach);
        const ang = Math.atan2(uy || 0, ux || 1);
        const rad = monsterSize * 0.11 * grow;
        const cxo = monsterSize * 0.08 * grow;  // pushed out in front of the mouth

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ang);
        ctx.globalAlpha = fade * 0.5;
        const g = ctx.createRadialGradient(cxo, 0, 0, cxo, 0, rad);
        g.addColorStop(0, c.glow);
        g.addColorStop(0.55, c.glow);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.scale(1.45, 1);                     // stretched along the spit
        ctx.beginPath();
        ctx.arc(cxo, 0, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Hot core right at the mouth
        ctx.save();
        ctx.translate(x, y);
        ctx.globalAlpha = fade * 0.95;
        ctx.shadowColor = c.core;
        ctx.shadowBlur = monsterSize * 0.13;
        ctx.fillStyle = c.core;
        ctx.beginPath();
        ctx.arc(0, 0, monsterSize * 0.028 * grow, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // Impact burst where a monster's attack lands — sized to the sprite too
    drawAttackImpact(ctx, x, y, tileSize, burst, fade) {
        const unit = tileSize * 2.7;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1.5, unit * 0.018);
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = unit * 0.1;
        ctx.beginPath();
        ctx.arc(x, y, unit * 0.05 + burst * unit * 0.14, 0, Math.PI * 2);
        ctx.stroke();
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI * 2 * i) / 6 + burst;
            const d = burst * unit * 0.18;
            ctx.globalAlpha = fade * (1 - burst);
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(x + Math.cos(angle) * d, y + Math.sin(angle) * d, unit * 0.02, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    // CRYPTS: a glowy black beam — violet halo wrapped around a void-dark core
    drawDarkBeam(ctx, x0, y0, x1, y1, reach, fade, tileSize, progress) {
        const tipX = x0 + (x1 - x0) * reach;
        const tipY = y0 + (y1 - y0) * reach;
        const unit = tileSize * 2.7;
        const w0 = this.monsterSpitRadius(tileSize, 0);
        const w1 = this.monsterSpitRadius(tileSize, 1);
        const pts = this.spitPoints(x0, y0, tipX, tipY, tileSize * 0.1, progress * 12);
        ctx.save();
        // Violet halo
        ctx.globalAlpha = fade * 0.7;
        ctx.shadowColor = '#8f4dff';
        ctx.shadowBlur = unit * 0.1;
        ctx.fillStyle = '#8f4dff';
        this.fillTaperedRibbon(ctx, pts, w0 * 1.35, w1 * 1.35);
        // Void-dark core
        ctx.globalAlpha = fade;
        ctx.shadowColor = '#a35bff';
        ctx.shadowBlur = unit * 0.06;
        ctx.fillStyle = '#08030f';
        this.fillTaperedRibbon(ctx, pts, w0 * 0.75, w1 * 0.75);
        // Deathly orb at the tip
        ctx.globalAlpha = fade;
        ctx.shadowColor = '#a35bff';
        ctx.shadowBlur = unit * 0.2;
        // Bright violet rim around a void-dark core, so it reads on a dark floor
        ctx.strokeStyle = '#c79bff';
        ctx.lineWidth = Math.max(1.5, unit * 0.02);
        ctx.beginPath();
        ctx.arc(tipX, tipY, w1 * 2.6, 0, Math.PI * 2);
        ctx.fillStyle = '#0a0514';
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    // VOID RIFT: a cosmic beam — nebula stream with a hot core and drifting stars
    drawCosmicBeam(ctx, x0, y0, x1, y1, reach, fade, tileSize, progress) {
        const tipX = x0 + (x1 - x0) * reach;
        const tipY = y0 + (y1 - y0) * reach;
        const unit = tileSize * 2.7;
        const w0 = this.monsterSpitRadius(tileSize, 0);
        const w1 = this.monsterSpitRadius(tileSize, 1);
        const pts = this.spitPoints(x0, y0, tipX, tipY, tileSize * 0.14, progress * 14);
        ctx.save();
        // Nebula body
        ctx.globalAlpha = fade * 0.85;
        ctx.shadowColor = '#4dd8ff';
        ctx.shadowBlur = unit * 0.1;
        ctx.fillStyle = '#583cff';
        this.fillTaperedRibbon(ctx, pts, w0 * 1.4, w1 * 1.2);
        // Cyan leading half
        ctx.globalAlpha = fade * 0.9;
        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur = unit * 0.1;
        ctx.fillStyle = '#00e5ff';
        this.fillTaperedRibbon(ctx, pts.slice(Math.floor(pts.length * 0.45)), w0 * 0.9, w1);
        // Hot hairline core
        ctx.globalAlpha = fade;
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = unit * 0.05;
        ctx.fillStyle = '#ffffff';
        this.fillTaperedRibbon(ctx, pts, w0 * 0.34, w1 * 0.34);
        // Stars dragged along the beam
        for (let i = 0; i < 5; i++) {
            const t = ((i / 4) * reach + progress * 0.3) % 1;
            const px = x0 + (x1 - x0) * t + Math.sin(progress * 14 + i * 2.1) * tileSize * 0.07;
            const py = y0 + (y1 - y0) * t + Math.cos(progress * 12 + i * 1.3) * tileSize * 0.07;
            ctx.globalAlpha = fade * (0.4 + 0.5 * Math.random());
            ctx.fillStyle = i % 3 === 0 ? '#b98cff' : '#d6f9ff';
            ctx.beginPath();
            ctx.arc(px, py, tileSize * 0.045, 0, Math.PI * 2);
            ctx.fill();
        }
        // Rift ring at the far end
        ctx.globalAlpha = fade;
        ctx.shadowBlur = unit * 0.08;
        ctx.shadowColor = '#5bc8ff';
        ctx.strokeStyle = '#9be8ff';
        ctx.lineWidth = Math.max(1.5, unit * 0.016);
        ctx.beginPath();
        ctx.arc(tipX, tipY, w1 * 6 + tileSize * 0.08, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    // GOBLIN MINES: a green-yellow vomit beam that arcs and spits droplets
    drawVomitBeam(ctx, x0, y0, x1, y1, reach, fade, tileSize, progress) {
        const tipX = x0 + (x1 - x0) * reach;
        const tipY = y0 + (y1 - y0) * reach;
        const unit = tileSize * 2.7;
        const w0 = this.monsterSpitRadius(tileSize, 0);
        const w1 = this.monsterSpitRadius(tileSize, 1);
        // Droops as it flies — it is a spew, not a straight beam
        const pts = this.spitPoints(x0, y0, tipX, tipY, tileSize * 0.12, progress * 9, tileSize * 0.16);
        ctx.save();
        ctx.globalAlpha = fade * 0.9;
        ctx.shadowColor = '#b6ff2e';
        ctx.shadowBlur = unit * 0.08;
        ctx.fillStyle = '#7fbf14';
        this.fillTaperedRibbon(ctx, pts, w0 * 1.25, w1);
        // Chunky bright highlights riding the stream
        ctx.globalAlpha = fade * 0.95;
        ctx.shadowBlur = unit * 0.05;
        ctx.fillStyle = '#c8ff3d';
        this.fillTaperedRibbon(ctx, pts, w0 * 0.55, w1 * 0.55);
        // Droplets flung off the stream
        for (let i = 0; i < 5; i++) {
            const t = (i / 4) * reach;
            const px = x0 + (x1 - x0) * t + Math.sin(progress * 15 + i * 2) * tileSize * 0.12;
            const py = y0 + (y1 - y0) * t + tileSize * 0.1 + ((progress * 40 + i * 7) % 10);
            ctx.globalAlpha = fade * (1 - t) * 0.85;
            ctx.fillStyle = i % 2 ? '#a8e02a' : '#e4ff7a';
            ctx.beginPath();
            ctx.arc(px, py, tileSize * 0.055, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    // MAGMA CHAMBERS: a flame stream — orange flame sheathing a yellow core
    drawFlameStream(ctx, x0, y0, x1, y1, reach, fade, tileSize, progress) {
        const tipX = x0 + (x1 - x0) * reach;
        const tipY = y0 + (y1 - y0) * reach;
        const unit = tileSize * 2.7;
        const w0 = this.monsterSpitRadius(tileSize, 0);
        const w1 = this.monsterSpitRadius(tileSize, 1);
        const pts = this.spitPoints(x0, y0, tipX, tipY, tileSize * 0.11, progress * 18);
        ctx.save();
        // Outer flame, then the hot core on top
        ctx.globalAlpha = fade * 0.75;
        ctx.shadowColor = '#ff7a18';
        ctx.shadowBlur = unit * 0.1;
        ctx.fillStyle = '#ff7a18';
        this.fillTaperedRibbon(ctx, pts, w0 * 1.3, w1 * 1.15);
        // Hot core
        ctx.globalAlpha = fade * 0.95;
        ctx.shadowColor = '#ffd23f';
        ctx.shadowBlur = unit * 0.05;
        ctx.fillStyle = '#ffe08a';
        this.fillTaperedRibbon(ctx, pts, w0 * 0.5, w1 * 0.45);
        // Embers drifting up
        for (let i = 0; i < 4; i++) {
            const t = (i / 3) * reach;
            const px = x0 + (x1 - x0) * t + Math.sin(progress * 20 + i) * tileSize * 0.12;
            const py = y0 + (y1 - y0) * t - ((progress * 50 + i * 9) % 14);
            ctx.globalAlpha = fade * (1 - t) * 0.9;
            ctx.fillStyle = '#ffe08a';
            ctx.beginPath();
            ctx.arc(px, py, tileSize * 0.05, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    // OVERGROWN TEMPLE: a vine whip that cracks out with leaves flying
    drawVineWhip(ctx, x0, y0, x1, y1, reach, fade, tileSize, progress) {
        const tipX = x0 + (x1 - x0) * reach;
        const tipY = y0 + (y1 - y0) * reach;
        const dx = x1 - x0;
        const dy = y1 - y0;
        // Whip crack: the curve swings across its own path as it extends
        const whip = Math.sin(progress * Math.PI * 2.3) * tileSize * 0.5;
        const cx = (x0 + tipX) / 2 - dy * 0.15 + whip * 0.2;
        const cy = (y0 + tipY) / 2 + dx * 0.15 + whip;
        const steps = this.streamSteps(x0, y0, tipX, tipY, tileSize);
        const w0 = this.monsterSpitRadius(tileSize, 0);
        const w1 = this.monsterSpitRadius(tileSize, 1);
        const pts = [];
        for (let i = 0; i <= steps; i++) {
            pts.push(this.quadPoint(x0, y0, cx, cy, tipX, tipY, i / steps));
        }
        ctx.save();
        // One slim lash tapering to a whip-thin tip
        ctx.globalAlpha = fade;
        ctx.shadowColor = '#2f6b1f';
        ctx.shadowBlur = tileSize * 0.14;
        ctx.fillStyle = '#3f8a2b';
        this.fillTaperedRibbon(ctx, pts, w0 * 1.05, Math.max(0.7, w1 * 0.8));
        // Sunlit top edge riding just inside the vine's upper side, so it never
        // pokes past the silhouette and scallops the outline
        const hi = pts.map(p => ({ x: p.x, y: p.y - w0 * 0.18 }));
        ctx.globalAlpha = fade * 0.8;
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#8ae05a';
        this.fillTaperedRibbon(ctx, hi, w0 * 0.22, 0.7);
        // Leaves along the vine, alternating sides so it reads as a vine
        for (let i = 1; i <= 4; i++) {
            const t = i / 5.5;
            const p = this.quadPoint(x0, y0, cx, cy, tipX, tipY, t);
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate((i % 2 ? -1 : 1) * 1.05 + Math.sin(progress * 16 + i) * 0.5);
            ctx.globalAlpha = fade * 0.95;
            ctx.shadowColor = '#2f6b1f';
            ctx.shadowBlur = tileSize * 0.12;
            ctx.fillStyle = i % 2 ? '#57a63a' : '#3f8a2b';
            ctx.beginPath();
            ctx.ellipse(tileSize * 0.11, 0, tileSize * 0.11, tileSize * 0.045, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        // Thorned tip
        ctx.globalAlpha = fade;
        ctx.fillStyle = '#d9ff8a';
        ctx.shadowColor = '#9bff5c';
        ctx.shadowBlur = tileSize * 0.2;
        ctx.beginPath();
        ctx.moveTo(tipX + tileSize * 0.07, tipY);
        ctx.lineTo(tipX - tileSize * 0.03, tipY - tileSize * 0.05);
        ctx.lineTo(tipX - tileSize * 0.03, tipY + tileSize * 0.05);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    // Render glowing trail effect for knight movement
    renderKnightTrail(knight, tileSize) {
        const ctx = this.ctx;
        const theme = this.dungeon.config.theme;
        
        knight.trail.forEach((point, index) => {
            const screenPos = this.dungeon.gridToScreen(point.x, point.y);
            const screenX = screenPos.x * this.zoom + this.offsetX + tileSize / 2;
            const screenY = screenPos.y * this.zoom + this.offsetY + tileSize / 2;
            
            const alpha = point.life * 0.6;
            const radius = tileSize * 0.4 * point.life;
            
            // Outer glow
            const gradient = ctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, radius);
            gradient.addColorStop(0, theme.glowColor + Math.floor(alpha * 255).toString(16).padStart(2, '0'));
            gradient.addColorStop(0.5, theme.glowColor + Math.floor(alpha * 128).toString(16).padStart(2, '0'));
            gradient.addColorStop(1, theme.glowColor + '00');
            
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    // Render atmospheric floating text
    renderAtmosphericText() {
        if (!this.atmosphericTexts) {
            this.atmosphericTexts = [];
        }
        
        const ctx = this.ctx;
        const theme = this.dungeon.config.theme;
        
        // Randomly spawn new atmospheric text
        if (Math.random() < 0.005 && this.atmosphericTexts.length < 3) {
            const texts = this.dungeon.config.atmosphericText || ['...'];
            const text = texts[Math.floor(Math.random() * texts.length)];
            const x = Math.random() * (this.canvas.width - 200) + 100;
            const y = Math.random() * (this.canvas.height - 200) + 100;
            
            this.atmosphericTexts.push({
                text: text,
                x: x,
                y: y,
                life: 1.0,
                maxLife: 4.0
            });
        }
        
        // Render and update atmospheric texts
        this.atmosphericTexts.forEach((textObj, index) => {
            const alpha = Math.min(textObj.life / textObj.maxLife, 0.3);
            
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.font = '24px serif';
            ctx.fillStyle = theme.accent;
            ctx.shadowColor = theme.accent;
            ctx.shadowBlur = 20;
            ctx.textAlign = 'center';
            ctx.fillText(textObj.text, textObj.x, textObj.y);
            ctx.restore();
            
            textObj.life -= 0.016; // Fade over time
        });
        
        // Remove dead texts
        this.atmosphericTexts = this.atmosphericTexts.filter(t => t.life > 0);
    }

    // Render decorative border frame with torches
    renderBorderFrame() {
        const ctx = this.ctx;
        const theme = this.dungeon.config.theme;
        const frameWidth = 80;
        
        // Left pillar
        ctx.fillStyle = theme.wall;
        ctx.fillRect(0, 0, frameWidth, this.canvas.height);
        
        // Right pillar
        ctx.fillRect(this.canvas.width - frameWidth, 0, frameWidth, this.canvas.height);
        
        // Add glowing torches on left side
        const torchCount = 6;
        for (let i = 0; i < torchCount; i++) {
            const y = (this.canvas.height / (torchCount + 1)) * (i + 1);
            this.renderTorch(frameWidth / 2, y, theme);
        }
        
        // Add glowing torches on right side
        for (let i = 0; i < torchCount; i++) {
            const y = (this.canvas.height / (torchCount + 1)) * (i + 1);
            this.renderTorch(this.canvas.width - frameWidth / 2, y, theme);
        }
    }

    // Render individual torch with glow
    renderTorch(x, y, theme) {
        const ctx = this.ctx;
        const time = Date.now() / 1000;
        const flicker = Math.sin(time * 5 + x) * 0.2 + 0.8;
        
        // Glow effect
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, 30 * flicker);
        gradient.addColorStop(0, theme.glowColor);
        gradient.addColorStop(0.5, theme.glowColor + '80');
        gradient.addColorStop(1, theme.glowColor + '00');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, 30 * flicker, 0, Math.PI * 2);
        ctx.fill();
        
        // Torch flame
        ctx.fillStyle = theme.glowColor;
        ctx.beginPath();
        ctx.arc(x, y, 8 * flicker, 0, Math.PI * 2);
        ctx.fill();
    }

    // Render minimap with decorative frame
    renderMinimap() {
        const minimapCanvas = document.getElementById('minimapCanvas');
        if (!minimapCanvas) return;
        
        const ctx = minimapCanvas.getContext('2d');
        const size = 150;
        const theme = this.dungeon.config.theme;
        const tileScale = (size - 20) / Math.max(this.dungeon.gridWidth, this.dungeon.gridHeight);
        const offsetX = 10;
        const offsetY = 10;
        
        // Clear
        ctx.fillStyle = theme.shadowColor;
        ctx.fillRect(0, 0, size, size);
        
        // Draw tiles
        for (let y = 0; y < this.dungeon.gridHeight; y++) {
            for (let x = 0; x < this.dungeon.gridWidth; x++) {
                const px = offsetX + x * tileScale;
                const py = offsetY + y * tileScale;
                const tile = this.dungeon.grid[y][x];
                
                if (tile === 1) {
                    ctx.fillStyle = theme.wall;
                } else if (tile === 2) {
                    ctx.fillStyle = theme.pillar;
                } else if (tile === 3) {
                    ctx.fillStyle = theme.wallHighlight;
                } else {
                    ctx.fillStyle = theme.floor;
                }
                ctx.fillRect(px, py, Math.max(1, tileScale), Math.max(1, tileScale));
            }
        }
        
        // Draw loot nodes
        ctx.fillStyle = '#FFD700';
        this.dungeon.getActiveLootNodes().forEach(node => {
            const px = offsetX + node.gridX * tileScale;
            const py = offsetY + node.gridY * tileScale;
            ctx.fillRect(px, py, Math.max(2, tileScale * 1.5), Math.max(2, tileScale * 1.5));
        });
        
        // Draw knights
        if (window.game) {
            const knights = window.game.knightManager.getDeployedKnights();
            knights.forEach(knight => {
                const px = offsetX + knight.gridPosition.x * tileScale;
                const py = offsetY + knight.gridPosition.y * tileScale;
                
                ctx.fillStyle = theme.glowColor;
                ctx.shadowColor = theme.glowColor;
                ctx.shadowBlur = 3;
                ctx.beginPath();
                ctx.arc(px, py, Math.max(2, tileScale), 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
            });
        }
        
        // Decorative border
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 3;
        ctx.strokeRect(2, 2, size - 4, size - 4);
        
        // Corner decorations
        ctx.fillStyle = theme.glowColor;
        ctx.fillRect(0, 0, 8, 8);
        ctx.fillRect(size - 8, 0, 8, 8);
        ctx.fillRect(0, size - 8, 8, 8);
        ctx.fillRect(size - 8, size - 8, 8, 8);
    }
}

