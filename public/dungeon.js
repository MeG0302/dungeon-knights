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
        monsterHealth: 500, // Increased for slower clear time
        chestHealth: 250,   // Increased for slower clear time
        monsterFolder: 'void rift',
        monsters: [
            'Pixel_art_angler_fish_beast_2K_202609041636-removebg-preview.png',
            'Pixel_art_cosmic_jellyfish_2K_202609041636-removebg-preview.png',
            'Pixel_art_crab_monster_2K_202609041636-removebg-preview.png',
            'Pixel_art_electric_eel_2K_202609041636-removebg-preview.png'
        ],
        atmosphericText: ['VOID CALLS...', 'INFINITY...', 'COSMOS...', 'STARS FADE...']
    }
};

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

    getRandomSpawnPoint() {
        return this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)];
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
        // Knight art comes from the single rarity config (config.js)
        const tiers = window.RARITY_TIERS || [];
        const config = window.RARITY_CONFIG || {};

        tiers.forEach(tier => {
            const entry = config[tier];
            if (!entry?.image) return;
            const key = tier.toUpperCase();
            const img = new Image();
            img.onload = () => {
                console.log(`✅ Loaded ${key} knight sprite`);
            };
            img.onerror = () => {
                console.warn(`⚠️ Failed to load ${key} knight: ${entry.image}`);
            };
            img.src = entry.image;
            this.knightImages[key] = img;
        });
    }

    render(knights) {
        const ctx = this.ctx;
        const dungeon = this.dungeon;
        const tileSize = dungeon.config.tileSize * this.zoom;

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

        // Render loot nodes
        dungeon.getActiveLootNodes().forEach(node => {
            const screenPos = dungeon.gridToScreen(node.gridX, node.gridY);
            const screenX = screenPos.x * this.zoom + this.offsetX;
            const screenY = screenPos.y * this.zoom + this.offsetY;
            this.renderLootNode(screenX, screenY, node, tileSize);
        });

        // Render knights
        knights.forEach(knight => {
            if (knight.isDeployed) {
                const screenPos = dungeon.gridToScreen(knight.gridPosition.x, knight.gridPosition.y);
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

    renderLootNode(x, y, node, tileSize) {
        const ctx = this.ctx;
        const centerX = x + tileSize / 2;
        const centerY = y + tileSize / 2;
        
        // Update animation time
        node.animationTime += 0.016; // Roughly 60fps
        
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
            
            // Idle animation - bounce up and down
            const bounceOffset = Math.sin(node.animationTime * 3) * 4;
            const finalMonsterY = centerY + bounceOffset;
            
            // Shadow beneath monster
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.beginPath();
            ctx.ellipse(centerX, centerY + monsterSize * 0.45, monsterSize * 0.35, monsterSize * 0.12, 0, 0, Math.PI * 2);
            ctx.fill();
            
            // Try to draw the monster's individual PNG image
            if (node.monsterImage && this.monsterImages[node.monsterImage]) {
                const monsterImg = this.monsterImages[node.monsterImage];
                
                if (monsterImg.complete && monsterImg.naturalWidth > 0) {
                    ctx.save();
                    
                    // Glow aura matching theme
                    const glowIntensity = 0.2 + Math.sin(node.animationTime * 2) * 0.1;
                    const glowGradient = ctx.createRadialGradient(centerX, finalMonsterY, 0, centerX, finalMonsterY, monsterSize * 0.7);
                    glowGradient.addColorStop(0, this.dungeon.config.theme.accent + '40');
                    glowGradient.addColorStop(1, this.dungeon.config.theme.accent + '00');
                    ctx.globalAlpha = glowIntensity;
                    ctx.fillStyle = glowGradient;
                    ctx.fillRect(centerX - monsterSize * 0.7, finalMonsterY - monsterSize * 0.7, monsterSize * 1.4, monsterSize * 1.4);
                    ctx.globalAlpha = 1.0;
                    
                    // Draw monster image
                    ctx.imageSmoothingEnabled = false; // Pixel-perfect rendering
                    ctx.drawImage(
                        monsterImg,
                        centerX - monsterSize / 2, 
                        finalMonsterY - monsterSize / 2,
                        monsterSize,
                        monsterSize
                    );
                    
                    ctx.restore();
                } else {
                    // Fallback if image not loaded
                    this.renderFallbackMonster(ctx, centerX, finalMonsterY, monsterSize);
                }
            } else {
                // Fallback monster
                this.renderFallbackMonster(ctx, centerX, finalMonsterY, monsterSize);
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

    renderKnight(x, y, knight, tileSize) {
        const ctx = this.ctx;
        const centerX = x + tileSize / 2;
        const centerY = y + tileSize / 2;
        const knightSize = tileSize * 2.0; // 2.5x scale (was 0.8)
        
        // Apply attack animation offset
        let offsetX = 0;
        let offsetY = 0;
        if (knight.attackAnimation.active) {
            const progress = knight.attackAnimation.progress;
            // Lunge forward and back
            if (progress < 0.5) {
                offsetY = -tileSize * 0.3 * (progress * 2); // Move up
            } else {
                offsetY = -tileSize * 0.3 * (2 - progress * 2); // Move back
            }
            
            // Shake effect
            offsetX = Math.sin(progress * Math.PI * 4) * 3;
        }
        
        const drawX = centerX + offsetX;
        const drawY = centerY + offsetY;
        
        // Try to use actual knight image if loaded
        const img = this.knightImages[knight.rarity.tier];
        if (img && img.complete && img.naturalWidth > 0) {
            // Image loaded successfully - draw it
            ctx.save();
            
            // Flash white during attack
            if (knight.attackAnimation.active && knight.attackAnimation.progress < 0.3) {
                ctx.globalAlpha = 0.5;
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(drawX - knightSize / 2, drawY - knightSize, knightSize, knightSize);
                ctx.globalAlpha = 1.0;
            }
            
            ctx.drawImage(img, drawX - knightSize / 2, drawY - knightSize, knightSize, knightSize);
            ctx.restore();
        } else {
            // Fallback: draw colored knight shape with rarity color
            
            // Glow effect during attack
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
        
        // Attack slash effect
        if (knight.attackAnimation.active && knight.target) {
            const targetPos = this.dungeon.gridToScreen(knight.target.gridX, knight.target.gridY);
            const targetScreenX = targetPos.x * this.zoom + this.offsetX + tileSize / 2;
            const targetScreenY = targetPos.y * this.zoom + this.offsetY + tileSize / 2;
            
            const progress = knight.attackAnimation.progress;
            const alpha = 1 - progress;
            
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = knight.rarity.color;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(drawX, drawY - knightSize * 0.2);
            ctx.lineTo(targetScreenX, targetScreenY);
            ctx.stroke();
            
            // Sword slash arc
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(drawX, drawY - knightSize * 0.2, knightSize * 0.6, 
                -Math.PI / 4 - progress * Math.PI / 2, 
                Math.PI / 4 - progress * Math.PI / 2);
            ctx.stroke();
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
            }
        });
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

