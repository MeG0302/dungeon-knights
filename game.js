// Main Game Engine - Game Loop and State Management

class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.knightManager = new KnightManager();
        this.dungeon = null;
        this.dungeonRenderer = null;
        this.pathfinding = null;
        this.knightAI = null;
        this.combat = null;
        
        this.isRunning = false;
        this.lastTime = 0;
        this.goldBalance = 50; // Starting gold (enough for 5 recruits)
        this.selectedDungeon = this.getRandomDungeonType(); // Random start
        
        // Stop menu music when game loads
        if (window.audioManager) {
            window.audioManager.stopMenuMusic();
        }
        
        this.init();
    }
    
    getRandomDungeonType() {
        const dungeonTypes = ['crypts', 'mines', 'temple', 'magma', 'void'];
        return dungeonTypes[Math.floor(Math.random() * dungeonTypes.length)];
    }

    init() {
        // Load gold from menu (or default to 500)
        const savedGold = localStorage.getItem('gameGold');
        if (savedGold) {
            this.goldBalance = parseFloat(savedGold);
        } else {
            this.goldBalance = 500; // Default starting gold
        }
        
        // Load knights from menu selection
        const savedKnights = localStorage.getItem('selectedKnights');
        if (savedKnights) {
            try {
                const knightsData = JSON.parse(savedKnights);
                // Recreate knights from saved data
                knightsData.forEach(data => {
                    const knight = new Knight(data.id);
                    knight.rarity = data.rarity;
                    knight.stats = data.stats;
                    this.knightManager.knights.push(knight);
                    if (data.id >= this.knightManager.nextId) {
                        this.knightManager.nextId = data.id + 1;
                    }
                });
                console.log(`⚔️ Loaded ${knightsData.length} knights from menu`);
            } catch (e) {
                console.error('Failed to load knights:', e);
            }
        }
        
        // If no knights loaded, redirect to menu
        if (this.knightManager.knights.length === 0) {
            alert('⚠️ No knights selected! Returning to menu...');
            window.location.href = 'menu.html';
            return;
        }
        
        // Get selected dungeon from localStorage (set by dungeon-select.html)
        const selectedDungeon = localStorage.getItem('selectedDungeon');
        if (selectedDungeon) {
            this.selectedDungeon = selectedDungeon;
            console.log(`🗺️ Starting with selected dungeon: ${selectedDungeon}`);
            // Clear the selection so it's random after first dungeon
            localStorage.removeItem('selectedDungeon');
        } else {
            // If no selection (returning from game), use random
            this.selectedDungeon = this.getRandomDungeonType();
        }
        
        // Initialize with selected/random dungeon
        this.createDungeon(this.selectedDungeon);
        
        // Track dungeon start time
        this.dungeonStartTime = null;
        
        // Enable debug mode
        window.debugMode = true;
        window.checkGameState = () => {
            console.log('=== GAME STATE DEBUG ===');
            console.log('Running:', this.isRunning);
            console.log('Gold:', this.goldBalance);
            console.log('Active Loot:', this.dungeon.getActiveLootNodes().length);
            console.log('Deployed Knights:', this.knightManager.getDeployedKnights().length);
            const deployed = this.knightManager.getDeployedKnights();
            deployed.forEach(k => {
                console.log(`  Knight #${k.id}: State=${k.state}, Stamina=${Math.floor(k.stamina)}/${k.stats.maxStamina}, Target=${k.target ? 'YES' : 'NO'}`);
            });
            console.log('=======================');
        };
        
        // Start game loop
        this.lastTime = performance.now();
        this.gameLoop(this.lastTime);
        
        console.log('🎮 Dungeon Knights initialized!');
        console.log('💡 Type "checkGameState()" in console to debug');
    }

    createDungeon(type) {
        this.dungeon = new Dungeon(type);
        this.dungeonRenderer = new DungeonRenderer(this.canvas, this.dungeon);
        this.pathfinding = new PathfindingAI(this.dungeon);
        this.knightAI = new KnightAI(this.pathfinding);
        this.combat = new CombatSystem(this.dungeon, this.knightManager);
        this.selectedDungeon = type;
        
        console.log(`🗺️ Created ${this.dungeon.config.name} dungeon`);
    }

    gameLoop(currentTime) {
        requestAnimationFrame((time) => this.gameLoop(time));
        
        const deltaTime = (currentTime - this.lastTime) / 1000; // Convert to seconds
        this.lastTime = currentTime;

        // Cap delta time to prevent huge jumps
        const dt = Math.min(deltaTime, 0.1);

        this.update(dt);
        this.render();
    }

    update(deltaTime) {
        // Always update knights (even when not running, for stamina recovery)
        this.knightManager.update(deltaTime);

        if (!this.isRunning) {
            return;
        }

        // Update knight AI
        const deployedKnights = this.knightManager.getDeployedKnights();
        deployedKnights.forEach(knight => {
            this.knightAI.updateKnight(knight, this.dungeon, deltaTime);
        });

        // Update combat
        this.combat.update(deltaTime);

        // Check if dungeon is cleared (all loot nodes destroyed)
        const activeLoot = this.dungeon.getActiveLootNodes();
        
        // Debug logging
        if (window.debugMode && Math.random() < 0.01) { // Log occasionally
            console.log(`🎯 Active loot nodes: ${activeLoot.length}, Deployed knights: ${deployedKnights.length}`);
        }
        
        if (activeLoot.length === 0 && deployedKnights.length > 0) {
            console.log('🎉 All loot cleared! Triggering completion...');
            this.handleDungeonCleared();
        }
    }

    render() {
        if (!this.dungeon || !this.dungeonRenderer) {
            console.warn('Dungeon or renderer not initialized');
            return;
        }
        
        const knights = this.knightManager.knights;
        this.dungeonRenderer.render(knights);
    }

    // Game Actions
    startDungeon() {
        if (this.isRunning) return;

        const availableKnights = this.knightManager.getAvailableKnights();
        if (availableKnights.length === 0) {
            this.logMessage('⚠️ No knights available! Rest your exhausted knights or recruit new ones.');
            return;
        }

        // Deploy up to 15 knights
        const deployCount = Math.min(availableKnights.length, 15);
        for (let i = 0; i < deployCount; i++) {
            const knight = availableKnights[i];
            const spawnPoint = this.dungeon.getRandomSpawnPoint();
            knight.deploy(spawnPoint.x, spawnPoint.y);
        }

        this.isRunning = true;
        this.dungeonStartTime = Date.now(); // Track start time
        this.logMessage(`⚔️ Deployed ${deployCount} knight(s) into ${this.dungeon.config.name}!`);
        
        // Play deploy sound
        if (window.audioManager) {
            window.audioManager.play('deploy');
            // Start background music
            window.audioManager.startMusic();
        }
    }

    stopDungeon() {
        if (!this.isRunning) return;

        // Recall all knights
        const deployedKnights = this.knightManager.getDeployedKnights();
        deployedKnights.forEach(knight => {
            knight.isDeployed = false;
            knight.state = 'idle';
            knight.target = null;
            knight.path = [];
        });

        this.isRunning = false;
        this.logMessage('🏰 Squad recalled to base.');
        
        // Stop background music
        if (window.audioManager) {
            window.audioManager.stopMusic();
        }
    }

    handleDungeonCleared() {
        // Don't stop dungeon - keep knights deployed for auto-continuation
        const wasRunning = this.isRunning;
        this.isRunning = false; // Temporarily stop to prevent further combat
        
        // Calculate completion time
        const timeElapsed = this.dungeonStartTime ? (Date.now() - this.dungeonStartTime) / 1000 : 0;
        const minutes = Math.floor(timeElapsed / 60);
        const seconds = Math.floor(timeElapsed % 60);
        const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        
        // Gold already earned per kill, just get the total
        const goldEarned = this.combat.getTotalEarned();
        
        this.logMessage(`🎉 Dungeon cleared! Earned ${goldEarned.toFixed(2)} gold in ${timeString}!`);
        
        // Play completion sound but keep music going for auto-continue
        if (window.audioManager) {
            window.audioManager.play('dungeon_complete');
        }
        
        // Show completion modal
        this.showCompletionModal(this.dungeon.config.name, goldEarned.toFixed(2), timeString);
    }
    
    showCompletionModal(dungeonName, goldEarned, timeString) {
        const modal = document.getElementById('completionModal');
        document.getElementById('completedDungeon').textContent = dungeonName;
        document.getElementById('completionGold').textContent = goldEarned;
        document.getElementById('completionTime').textContent = timeString;
        
        modal.classList.remove('hidden');
        
        // Show countdown in the modal
        let secondsLeft = 60;
        const countdownDisplay = document.createElement('p');
        countdownDisplay.id = 'autoProgressCountdown';
        countdownDisplay.style.cssText = 'color: #a8a29e; font-style: italic; margin-top: 1rem;';
        countdownDisplay.textContent = `⏰ Auto-progressing to next dungeon in ${secondsLeft}s...`;
        
        const modalContent = modal.querySelector('.modal-content');
        const existingCountdown = document.getElementById('autoProgressCountdown');
        if (existingCountdown) {
            existingCountdown.remove();
        }
        modalContent.appendChild(countdownDisplay);
        
        // Update countdown every second
        const countdownInterval = setInterval(() => {
            secondsLeft--;
            if (secondsLeft > 0 && countdownDisplay) {
                countdownDisplay.textContent = `⏰ Auto-progressing to next dungeon in ${secondsLeft}s...`;
            } else {
                clearInterval(countdownInterval);
            }
        }, 1000);
        
        // Store interval so we can clear it if user clicks button
        this.countdownInterval = countdownInterval;
        
        // Auto-progress to next dungeon after 60 seconds (1 minute)
        if (this.autoRestartTimer) {
            clearTimeout(this.autoRestartTimer);
        }
        
        this.autoRestartTimer = setTimeout(() => {
            clearInterval(countdownInterval);
            this.logMessage('⏰ Auto-progressing to next dungeon...');
            this.nextDungeon(); // Auto-progress to next dungeon type
        }, 60000); // 60 seconds = 1 minute
    }
    
    hideCompletionModal() {
        const modal = document.getElementById('completionModal');
        modal.classList.add('hidden');
        
        // Clear auto-restart timer and countdown
        if (this.autoRestartTimer) {
            clearTimeout(this.autoRestartTimer);
            this.autoRestartTimer = null;
        }
        
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = null;
        }
        
        // Remove countdown display
        const countdownDisplay = document.getElementById('autoProgressCountdown');
        if (countdownDisplay) {
            countdownDisplay.remove();
        }
    }
    
    nextDungeon() {
        const dungeonOrder = ['crypts', 'mines', 'temple', 'magma', 'void'];
        const currentIndex = dungeonOrder.indexOf(this.selectedDungeon);
        const nextIndex = (currentIndex + 1) % dungeonOrder.length;
        
        // Remember which knights were deployed
        const deployedKnights = this.knightManager.getDeployedKnights();
        
        // Select next dungeon in order
        this.selectedDungeon = dungeonOrder[nextIndex];
        this.createDungeon(this.selectedDungeon);
        this.hideCompletionModal();
        this.logMessage(`🗺️ Moved to ${this.dungeon.config.name}!`);
        
        // Re-deploy the same knights at spawn points
        if (deployedKnights.length > 0) {
            deployedKnights.forEach(knight => {
                const spawnPoint = this.dungeon.getRandomSpawnPoint();
                knight.position = { x: spawnPoint.x, y: spawnPoint.y };
                knight.gridPosition = { x: spawnPoint.x, y: spawnPoint.y };
                knight.state = 'idle';
                knight.target = null;
                knight.path = [];
            });
            
            this.isRunning = true;
            this.dungeonStartTime = Date.now();
            this.logMessage(`⚔️ ${deployedKnights.length} knight(s) automatically deployed!`);
            
            // Keep music playing
            if (window.audioManager && !window.audioManager.isMusicPlaying) {
                window.audioManager.startMusic();
            }
        }
    }
    
    replayDungeon() {
        // Remember which knights were deployed
        const deployedKnights = this.knightManager.getDeployedKnights();
        
        // Generate new instance of same dungeon
        this.createDungeon(this.selectedDungeon);
        this.hideCompletionModal();
        this.logMessage(`🔄 New ${this.dungeon.config.name} generated!`);
        
        // Re-deploy the same knights at spawn points
        if (deployedKnights.length > 0) {
            deployedKnights.forEach(knight => {
                const spawnPoint = this.dungeon.getRandomSpawnPoint();
                knight.position = { x: spawnPoint.x, y: spawnPoint.y };
                knight.gridPosition = { x: spawnPoint.x, y: spawnPoint.y };
                knight.state = 'idle';
                knight.target = null;
                knight.path = [];
            });
            
            this.isRunning = true;
            this.dungeonStartTime = Date.now();
            this.logMessage(`⚔️ ${deployedKnights.length} knight(s) automatically deployed!`);
            
            // Keep music playing
            if (window.audioManager && !window.audioManager.isMusicPlaying) {
                window.audioManager.startMusic();
            }
        }
    }
    
    restAllHeroes() {
        // Stop the dungeon and recall all knights
        this.isRunning = false;
        
        const deployedKnights = this.knightManager.getDeployedKnights();
        deployedKnights.forEach(knight => {
            knight.isDeployed = false;
            knight.sendToTavern();
        });
        
        // Stop music
        if (window.audioManager) {
            window.audioManager.stopMusic();
        }
        
        this.hideCompletionModal();
        this.logMessage(`🍺 All heroes are resting in the tavern!`);
    }

    changeDungeon(type) {
        if (this.isRunning) {
            this.logMessage('⚠️ Recall your squad before changing dungeons!');
            return;
        }

        this.createDungeon(type);
        this.logMessage(`🗺️ Switched to ${this.dungeon.config.name}`);
    }

    recruitKnight(cost = 10) {
        if (this.goldBalance < cost) {
            this.logMessage('⚠️ Not enough gold to recruit a knight!');
            return null;
        }

        this.goldBalance -= cost;
        
        const knight = this.knightManager.recruitKnight();
        this.logMessage(`⚔️ Recruited ${knight.rarity.name} Knight #${knight.id}!`);
        
        // Play recruit sound - rare drop sound for epic+ knights
        if (window.audioManager) {
            const sound = ['EPIC', 'LEGENDARY', 'MYTHIC'].includes(knight.rarity.tier) ? 
                'rare_drop' : 'recruit';
            window.audioManager.play(sound);
        }
        
        return knight;
    }

    sendKnightToTavern(knightId) {
        const knight = this.knightManager.getKnight(knightId);
        if (!knight) return;

        if (knight.isDeployed) {
            this.logMessage('⚠️ Recall the knight from the dungeon first!');
            return;
        }

        knight.sendToTavern();
        this.logMessage(`🍺 Knight #${knightId} is now resting in the tavern.`);
    }

    wakeKnight(knightId) {
        const knight = this.knightManager.getKnight(knightId);
        if (!knight || knight.state !== 'resting') return;

        knight.state = 'idle';
        this.logMessage(`⚔️ Knight #${knightId} is ready for duty!`);
    }

    logMessage(message) {
        if (window.ui) {
            window.ui.addLogEntry(message);
        }
        console.log(message);
    }

    // Getters for UI
    getGameState() {
        return {
            goldBalance: Math.floor(this.goldBalance),
            activeKnights: this.knightManager.getDeployedKnights().length,
            totalKnights: this.knightManager.knights.length,
            isRunning: this.isRunning,
            goldPerMinute: this.combat.getGoldPerMinute(),
            dungeonName: this.dungeon.config.name,
            activeLootNodes: this.dungeon.getActiveLootNodes().length
        };
    }
}

// Initialize game when DOM is loaded
let game;
let ui;

window.addEventListener('DOMContentLoaded', () => {
    console.log('🎮 Initializing Dungeon Knights...');
    
    try {
        game = new Game();
        window.game = game; // Make accessible globally
        
        // Initialize UI after game is created
        ui = new UI(game);
        window.ui = ui;
        
        console.log('✅ Game initialized successfully!');
        console.log('📊 Starting knights:', game.knightManager.knights.length);
        console.log('💰 Starting gold:', game.goldBalance);
    } catch (error) {
        console.error('❌ Failed to initialize game:', error);
    }
});
