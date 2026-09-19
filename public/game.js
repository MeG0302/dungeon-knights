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
        
        // Initialize video background
        this.initVideoBackground();
        
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

        // Switch video background
        if (this.switchDungeonVideo) this.switchDungeonVideo(type);

        // Switch chest image in the right panel
        const chestImg = document.getElementById('chestImage');
        if (chestImg) {
            const chestMap = {
                crypts: 'assets/crypts/chest.png',
                mines: 'assets/mines/chest.png',
                temple: 'assets/temple/chest.png',
                magma: 'assets/magma/chest.png',
                void: 'assets/void/chest.png'
            };
            chestImg.src = chestMap[type] || chestMap.crypts;
        }

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
            // Pass the whole squad: knights may never share a tile, so each one has to
            // know where the others are standing before it takes a step.
            this.knightAI.updateKnight(knight, this.dungeon, deltaTime, deployedKnights);
        });

        // Idle monsters stroll around their spawn tile (and return to it)
        this.dungeon.updateLootNodes(deltaTime, deployedKnights);

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
    
    /**
     * Begin a new dungeon run with proper session management
     * @param {Array} knights - Array of knight objects with tokenId
     * @returns {boolean} Success status
     */
    beginRun(knights) {
        if (!window.dungeonSession || knights.length === 0) return false;

        // Always clear a stale session before starting a new one
        window.dungeonSession.abandonSession();

        const knightIds = knights.map(k => k.tokenId || k.id);
        const ok = window.dungeonSession.startDungeon(
            knightIds,
            this.selectedDungeon,
            this.dungeon.config.name
        );
        
        if (!ok) {
            console.error('Failed to start dungeon session — rewards will not accrue');
            this.logMessage('⚠️ Could not start run tracking. Recall and redeploy.');
        }
        
        this.dungeonStartTime = Date.now();
        return ok;
    }
    
    startDungeon() {
        if (this.isRunning) return;

        const availableKnights = this.knightManager.getAvailableKnights();
        if (availableKnights.length === 0) {
            this.logMessage('⚠️ No knights available! Rest your exhausted knights or recruit new ones.');
            return;
        }

        // Deploy up to 15 knights
        const deployCount = Math.min(availableKnights.length, 15);
        const takenSpawns = [];
        for (let i = 0; i < deployCount; i++) {
            const knight = availableKnights[i];
            // Each knight gets its own tile — units never share one
            const spawnPoint = this.dungeon.getFreeSpawnPoint(takenSpawns);
            takenSpawns.push(spawnPoint);
            knight.deploy(spawnPoint.x, spawnPoint.y);
        }

        this.isRunning = true;
        this.dungeonStartTime = Date.now(); // Track start time
        
        // Start blockchain session with all deployed knights
        if (window.dungeonSession && availableKnights.length > 0) {
            const deployedKnights = availableKnights.slice(0, deployCount);
            this.beginRun(deployedKnights);
            console.log(`🎮 Started blockchain session for ${deployCount} knight(s)`);
        }
        
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

        // Abandon any active blockchain session
        if (window.dungeonSession) {
            window.dungeonSession.abandonSession();
        }

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
        
        // Complete blockchain session
        if (window.dungeonSession && window.dungeonSession.currentSession) {
            const deployedKnights = this.knightManager.getDeployedKnights();
            if (deployedKnights.length > 0) {
                // Check if contract is deployed
                console.log('✅ Game contract deployed and ready!');
                // Pass full knight objects (with tokenId and rarity)
                window.dungeonSession.completeDungeon(deployedKnights)
                    .then(completion => {
                        if (completion) {
                            console.log(`💰 Earned ${completion.reward} $DNG (unclaimed)`);
                            this.logMessage(`💰 Earned ${completion.reward} $DNG! Click widget to claim.`);
                            // Update reward UI
                            if (window.rewardClaimUI) {
                                window.rewardClaimUI.updateDisplay();
                            }
                        }
                    })
                    .catch(error => {
                        console.error('Failed to complete blockchain session:', error);
                    });
            }
        } else {
            console.warn('⚠️ Blockchain session not started or dungeonSession not available');
        }
        
        // Play completion sound but keep music going for auto-continue
        if (window.audioManager) {
            window.audioManager.play('dungeon_complete');
        }
        
        // Show completion modal
        this.showCompletionModal(this.dungeon.config.name, goldEarned.toFixed(2), timeString);

        // Arya, the gate keeper, rises from the lower middle with the news. She is a
        // spectator only: nothing here waits on her.
        if (window.Arya) window.Arya.say('clear', { dungeon: this.dungeon.config.name });
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
        
        // The completion modal has no .modal-content wrapper (just .modal), so fall
        // back to it. This used to throw here on every clear, which silently skipped
        // the countdown AND the auto-progress timer set up below.
        const modalContent = modal.querySelector('.modal-content') || modal;
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
            const nextSpawns = [];
            deployedKnights.forEach(knight => {
                const spawnPoint = this.dungeon.getFreeSpawnPoint(nextSpawns);
                nextSpawns.push(spawnPoint);
                knight.position = { x: spawnPoint.x, y: spawnPoint.y };
                knight.gridPosition = { x: spawnPoint.x, y: spawnPoint.y };
                knight.state = 'idle';
                knight.target = null;
                knight.path = [];
            });
            
            this.isRunning = true;
            this.beginRun(deployedKnights); // Start new session for next dungeon
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
            const replaySpawns = [];
            deployedKnights.forEach(knight => {
                const spawnPoint = this.dungeon.getFreeSpawnPoint(replaySpawns);
                replaySpawns.push(spawnPoint);
                knight.position = { x: spawnPoint.x, y: spawnPoint.y };
                knight.gridPosition = { x: spawnPoint.x, y: spawnPoint.y };
                knight.state = 'idle';
                knight.target = null;
                knight.path = [];
            });
            
            this.isRunning = true;
            this.beginRun(deployedKnights); // Start new session for replay
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
        const deployedKnights = this.knightManager ? this.knightManager.getDeployedKnights() : [];
        const activeLoot = this.dungeon ? this.dungeon.getActiveLootNodes().length : 0;
        
        // Calculate DNG/min based on deployed knights' rarities
        let dngPerMinute = 0;
        if (deployedKnights.length > 0) {
            const totalDngPerRun = deployedKnights.reduce((sum, knight) => {
                const rarityData = window.RARITY?.[knight.rarity.tier];
                return sum + (rarityData?.dungeonReward || 10);
            }, 0);
            
            // Estimate ~1-2 minutes per dungeon based on knight power
            const avgMinutesPerDungeon = 1.5;
            dngPerMinute = totalDngPerRun / avgMinutesPerDungeon;
        }
        
        // Calculate estimated time to finish
        let estimatedTime = '--';
        if (this.isRunning && deployedKnights.length > 0 && activeLoot > 0) {
            // Calculate average team stats
            const avgSpeed = deployedKnights.reduce((sum, knight) => sum + (knight.stats.speed || 1), 0) / deployedKnights.length;
            const totalPower = deployedKnights.reduce((sum, knight) => sum + (knight.stats.power || 50), 0);
            
            // Loot node stats
            const avgLootHP = 100; // Average HP per loot node
            const avgDistance = 5; // Average distance between loot nodes
            
            // Time calculations
            const movementTimePerLoot = avgDistance / avgSpeed; // seconds to move between nodes
            const combatTimePerLoot = avgLootHP / totalPower; // seconds to kill one node
            const attackCooldown = 1.0; // 1 second between attacks
            
            // Total time = (movement + combat + cooldown overhead) * remaining loot
            const timePerLoot = movementTimePerLoot + combatTimePerLoot + (attackCooldown * 2);
            const totalSeconds = Math.ceil(timePerLoot * activeLoot);
            
            // Format as MM:SS
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            estimatedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
        
        return {
            goldBalance: Math.floor(this.goldBalance),
            activeKnights: deployedKnights.length,
            totalKnights: this.knightManager ? this.knightManager.knights.length : 0,
            isRunning: this.isRunning,
            dngPerMinute: dngPerMinute,
            estimatedTime: estimatedTime,
            dungeonName: this.dungeon ? this.dungeon.config.name : 'Unknown',
            activeLootNodes: activeLoot
        };
    }
    
    // Video Background System
    initVideoBackground() {
        this.videoElement = document.getElementById('dungeonBackground');
        if (!this.videoElement) {
            console.warn('⚠️ Video background element not found');
            return;
        }
        
        // Load initial dungeon video
        this.switchDungeonVideo(this.selectedDungeon);
        console.log('🎬 Video background initialized');
    }
    
    switchDungeonVideo(dungeonType) {
        if (!this.videoElement) return;
        
        const videoMap = {
            'crypts': 'maps/map/animated/crypts-map-animated.mp4',
            'mines': 'maps/map/animated/mines-map-animated.mp4',
            'temple': 'maps/map/animated/temple-map-animated.mp4',
            'magma': 'maps/map/animated/magma-map-animated.mp4',
            'void': 'maps/map/animated/void-map-animated.mp4'
        };
        
        const videoPath = videoMap[dungeonType];
        if (!videoPath) {
            console.warn(`⚠️ No video found for dungeon: ${dungeonType}`);
            return;
        }
        
        // Update video source
        const source = this.videoElement.querySelector('source');
        if (source) {
            source.src = videoPath;
        } else {
            const newSource = document.createElement('source');
            newSource.src = videoPath;
            newSource.type = 'video/mp4';
            this.videoElement.appendChild(newSource);
        }
        
        // Reload and play
        this.videoElement.load();
        this.videoElement.play().catch(err => {
            console.warn('Video autoplay failed (browser policy):', err);
        });
        
        console.log(`🎬 Switched to ${dungeonType} video: ${videoPath}`);
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

    // Leaving the game for the Knights tab — either the header's Knights link or the
    // Menu button. The trip is remembered rather than announced here, because a popup
    // fired on the click would be destroyed by the navigation a moment later.
    document.addEventListener('click', (e) => {
        const el = e.target && e.target.closest ? e.target.closest('a[href="menu.html"], #menuBtn') : null;
        if (el && window.Arya) window.Arya.setFlag('fromGame');
    }, true);
});
