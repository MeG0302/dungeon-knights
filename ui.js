// UI Controller - Themed Pixel Art Interface

class UI {
    constructor(game) {
        this.game = game;
        this.selectedKnight = null;
        
        // In-flight flags to prevent overlapping RPC calls
        this.isUpdatingClaimed = false;
        this.isUpdatingBalance = false;
        
        this.initElements();
        this.bindEvents();
        this.startUILoop();
        this.startAtmosphereLoop();
    }

    initElements() {
        // Header elements (wallet handled by shared-header.js)
        this.disconnectBtn = document.getElementById('disconnectBtn');
        
        // Decorative border elements
        this.cornerTL = document.getElementById('cornerTL');
        this.cornerTR = document.getElementById('cornerTR');
        this.cornerBL = document.getElementById('cornerBL');
        this.cornerBR = document.getElementById('cornerBR');
        this.borderTop = document.getElementById('borderTop');
        this.borderBottom = document.getElementById('borderBottom');
        this.borderLeft = document.getElementById('borderLeft');
        this.borderRight = document.getElementById('borderRight');
        
        // Game canvas and atmospheric text
        this.gameCanvas = document.getElementById('gameCanvas');
        this.atmosphereText = document.getElementById('atmosphereText');
        
        // Squad panel
        this.squadPanelTitle = document.getElementById('squadPanelTitle');
        this.squadList = document.getElementById('squadList');
        
        // Info panel
        this.ownerMarkTitle = document.getElementById('ownerMarkTitle');
        this.ownerMark = document.getElementById('ownerMark');
        this.resourcePoolTitle = document.getElementById('resourcePoolTitle');
        this.resourceIcon = document.getElementById('resourceIcon');
        this.resourceAmount = document.getElementById('resourceAmount');
        this.chestImage = document.getElementById('chestImage');
        this.rewardsTotal = document.getElementById('rewardsTotal');
        this.rewardsCompletions = document.getElementById('rewardsCompletions');
        this.claimAllBtn = document.getElementById('claimAllBtn');
        this.viewHistoryBtn = document.getElementById('viewHistoryBtn');
        
        // Control bar
        this.deployBtn = document.getElementById('deployBtn');
        this.recallBtn = document.getElementById('recallBtn');
        this.menuBtn = document.getElementById('menuBtn');
        this.statsBtn = document.getElementById('statsBtn');
        this.dngRate = document.getElementById('dngRate');
        this.activeKnights = document.getElementById('activeKnights');
        this.activeLoot = document.getElementById('activeLoot');
        this.estimatedTime = document.getElementById('estimatedTime');
        
        // Parchment note
        this.parchmentNote = document.getElementById('parchmentNote');
        
        // Modals
        this.completionModal = document.getElementById('completionModal');
        this.shortcutsOverlay = document.getElementById('shortcutsOverlay');
        
        console.log('✅ UI Elements initialized');
    }

    bindEvents() {
        // Deploy button
        if (this.deployBtn) {
            this.deployBtn.addEventListener('click', () => {
                this.game.startDungeon();
            });
        }

        // Recall button
        if (this.recallBtn) {
            this.recallBtn.addEventListener('click', () => {
                this.game.stopDungeon();
            });
        }
        
        // Menu button
        if (this.menuBtn) {
            this.menuBtn.addEventListener('click', () => {
                localStorage.setItem('gameGold', this.game.goldBalance);
                localStorage.setItem('allKnights', JSON.stringify(this.game.knightManager.knights.map(k => ({
                    id: k.id,
                    rarity: k.rarity,
                    stats: k.stats,
                    stamina: k.stamina,
                    state: k.state,
                    totalEarned: k.totalEarned || 0
                }))));
                window.location.href = 'menu.html';
            });
        }
        
        // Stats button
        if (this.statsBtn) {
            this.statsBtn.addEventListener('click', () => {
                console.log('Stats button clicked - feature coming soon!');
            });
        }
        
        // Claim All button
        if (this.claimAllBtn) {
            this.claimAllBtn.addEventListener('click', async () => {
                if (window.dungeonSession) {
                    // Trigger chest animation before claiming
                    this.animateChestClaim();
                    
                    // Wait a moment for animation to start
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    await window.dungeonSession.claimAllRewards();
                    this.updateRewardsDisplay();
                }
            });
        }
        
        // View History button
        if (this.viewHistoryBtn) {
            this.viewHistoryBtn.addEventListener('click', () => {
                console.log('History:', window.dungeonSession ? window.dungeonSession.getHistory() : []);
                alert('History feature coming soon! Check console for now.');
            });
        }
        
        // Completion modal buttons
        const nextDungeonBtn = document.getElementById('nextDungeonBtn');
        const replayDungeonBtn = document.getElementById('replayDungeonBtn');
        
        if (nextDungeonBtn) {
            nextDungeonBtn.addEventListener('click', () => {
                this.game.nextDungeon();
            });
        }
        
        if (replayDungeonBtn) {
            replayDungeonBtn.addEventListener('click', () => {
                this.game.replayDungeon();
            });
        }
        
        // Shortcuts overlay
        const shortcutsClose = document.getElementById('shortcutsClose');
        if (shortcutsClose) {
            shortcutsClose.addEventListener('click', () => {
                this.toggleShortcuts();
            });
        }
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            this.handleKeyPress(e);
        });
        
        console.log('✅ Events bound');
    }

    handleKeyPress(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
            return;
        }
        
        switch(e.key.toLowerCase()) {
            case ' ':
                e.preventDefault();
                if (!this.game.isRunning) {
                    this.game.startDungeon();
                }
                break;
            case 'escape':
                e.preventDefault();
                if (this.game.isRunning) {
                    this.game.stopDungeon();
                }
                break;
            case 'h':
                e.preventDefault();
                this.toggleShortcuts();
                break;
        }
    }

    // Fast update loop - 60fps for canvas rendering only
    updateCanvas() {
        // Canvas updates are handled by Game class renderer
        // This method reserved for future canvas-specific UI overlays
    }

    // Medium update loop - 1s for DOM updates
    updateDOM() {
        if (!this.game || !this.game.getGameState) {
            return;
        }

        const state = this.game.getGameState();

        // Update status bar
        if (this.dngRate) this.dngRate.textContent = state.dngPerMinute.toFixed(1);
        if (this.activeKnights) this.activeKnights.textContent = `${state.activeKnights}/15`;
        if (this.activeLoot) this.activeLoot.textContent = state.activeLootNodes;
        if (this.estimatedTime) this.estimatedTime.textContent = state.estimatedTime;

        // Update squad list
        this.updateSquadList();
        
        // Update rewards display
        this.updateRewardsDisplay();
    }

    // Slow update loop - 30s for blockchain queries
    async updateBlockchain() {
        // Update Total Historical $DNG Claimed (from blockchain)
        await this.updateTotalClaimedFromBlockchain();
    }

    async updateTotalClaimedFromBlockchain() {
        if (!this.resourceAmount) return;
        
        // Prevent overlapping RPC calls
        if (this.isUpdatingClaimed) {
            console.log('⏭️ Skipping claimed update - already in flight');
            return;
        }
        
        this.isUpdatingClaimed = true;
        
        try {
            // Check if wallet is connected and session exists
            if (!window.walletManager?.isConnected || !window.dungeonSession) {
                this.resourceAmount.textContent = '0 $DNG';
                return;
            }

            // Get total claimed from all deployed knights via blockchain
            const deployedKnights = this.game.knightManager.getDeployedKnights();
            let totalClaimed = 0;

            for (const knight of deployedKnights) {
                try {
                    const stats = await window.dungeonSession.getKnightStatsFromChain(knight.id);
                    if (stats && stats.totalClaimed) {
                        // Convert from Wei to DNG tokens
                        totalClaimed += parseFloat(ethers.utils.formatEther(stats.totalClaimed));
                    }
                } catch (err) {
                    console.warn(`Could not fetch stats for knight ${knight.id}:`, err);
                }
            }

            this.resourceAmount.textContent = `${Math.floor(totalClaimed)} $DNG`;
        } catch (error) {
            console.error('Failed to update total claimed from blockchain:', error);
            this.resourceAmount.textContent = '0 $DNG';
        } finally {
            this.isUpdatingClaimed = false;
        }
    }

    async updateWalletBalance() {
        if (!this.ownerMark) return;
        
        // Prevent overlapping RPC calls
        if (this.isUpdatingBalance) {
            console.log('⏭️ Skipping balance update - already in flight');
            return;
        }
        
        this.isUpdatingBalance = true;
        
        try {
            // Get actual $DNG token balance from blockchain
            if (window.walletManager?.isConnected) {
                const balance = await window.walletManager.getDNGBalance();
                this.ownerMark.textContent = `${Math.floor(parseFloat(balance))} $DNG`;
            } else {
                this.ownerMark.textContent = '0 $DNG';
            }
        } catch (error) {
            console.error('Failed to update wallet balance:', error);
            this.ownerMark.textContent = '0 $DNG';
        } finally {
            this.isUpdatingBalance = false;
        }
    }

    updateSquadList() {
        if (!this.squadList) return;
        
        const deployedKnights = this.game.knightManager.getDeployedKnights();
        
        if (deployedKnights.length === 0) {
            this.squadList.innerHTML = '<div style="padding: 30px 20px; text-align: center; opacity: 0.6; font-size: 13px;">No knights deployed</div>';
            return;
        }
        
        this.squadList.innerHTML = '';
        
        deployedKnights.forEach(knight => {
            const card = document.createElement('div');
            card.className = 'knight-card';
            
            const staminaPercent = Math.floor((knight.stamina / knight.stats.maxStamina) * 100);
            const remainingRuns = knight.getRemainingRuns ? knight.getRemainingRuns() : '?';
            const maxRuns = RARITY[knight.rarity.tier]?.dailyRuns || 5;
            
            card.innerHTML = `
                <div class="knight-portrait" style="border-color: ${knight.rarity.color};">
                    ⚔️
                </div>
                <div class="knight-info">
                    <div class="knight-name" style="color: ${knight.rarity.color};">
                        Knight #${knight.id}
                    </div>
                    <div class="knight-status">
                        ${knight.rarity.name} • ${staminaPercent}% Stamina
                    </div>
                    <div class="knight-status">
                        Runs: ${remainingRuns}/${maxRuns}
                    </div>
                </div>
            `;
            
            this.squadList.appendChild(card);
        });
    }
    
    updateRewardsDisplay() {
        if (!window.dungeonSession) return;
        
        const unclaimed = window.dungeonSession.getUnclaimedRewards();
        const completions = window.dungeonSession.getHistory().filter(d => !d.claimed);
        
        if (this.rewardsTotal) {
            this.rewardsTotal.textContent = `${unclaimed.toFixed(2)} $DNG`;
        }
        
        if (this.rewardsCompletions) {
            this.rewardsCompletions.textContent = `Completions: ${completions.length}`;
        }
        
        if (this.claimAllBtn) {
            this.claimAllBtn.disabled = completions.length === 0;
        }
    }

    animateChestClaim() {
        if (!this.chestImage) return;
        
        console.log('🎁 Animating chest claim!');
        
        // Add glow and movement animation
        this.chestImage.classList.add('chest-claiming');
        
        // Remove animation after completion
        setTimeout(() => {
            this.chestImage.classList.remove('chest-claiming');
        }, 2000);
    }

    updateTheme(dungeonType) {
        console.log(`🎨 Updating theme to: ${dungeonType}`);
        
        // Update body theme attribute
        const themeMap = {
            'crypts': 'crypts',
            'mines': 'mines',
            'magma': 'magma',
            'temple': 'temple',
            'void': 'void'
        };
        
        const theme = themeMap[dungeonType] || 'crypts';
        document.body.setAttribute('data-dungeon-theme', theme);
        
        // Update dungeon title
        const titleMap = {
            'crypts': 'FORGOTTEN CRYPTS',
            'mines': 'GOBLIN MINES',
            'magma': 'MAGMA CHAMBER',
            'temple': 'OVERGROWN TEMPLE',
            'void': 'VOID RIFT'
        };
        
        if (this.dungeonTitle) {
            this.dungeonTitle.textContent = titleMap[dungeonType] || 'FORGOTTEN CRYPTS';
        }
        
        // Update panel titles based on theme
        const squadTitleMap = {
            'crypts': 'Active Squad',
            'mines': 'Mining Crew',
            'magma': 'Active Squad',
            'temple': 'Active Squad',
            'void': 'Active Squad'
        };
        
        const resourceTitleMap = {
            'crypts': 'Total Historical $DNG Claimed',
            'mines': 'Total Historical $DNG Claimed',
            'magma': 'Total Historical $DNG Claimed',
            'temple': 'Total Historical $DNG Claimed',
            'void': 'Total Historical $DNG Claimed'
        };
        
        const ownerTitleMap = {
            'crypts': 'Wallet $DNG Balance',
            'mines': 'Wallet $DNG Balance',
            'magma': 'Wallet $DNG Balance',
            'temple': 'Wallet $DNG Balance',
            'void': 'Wallet $DNG Balance'
        };
        
        if (this.squadPanelTitle) {
            this.squadPanelTitle.textContent = squadTitleMap[dungeonType] || 'Active Squad';
        }
        
        if (this.resourcePoolTitle) {
            this.resourcePoolTitle.textContent = resourceTitleMap[dungeonType] || 'Total Historical $DNG Claimed';
        }
        
        if (this.ownerMarkTitle) {
            this.ownerMarkTitle.textContent = ownerTitleMap[dungeonType] || 'Wallet $DNG Balance';
        }
        
        console.log(`✅ Theme updated to ${theme}`);
    }

    startAtmosphereLoop() {
        const atmosphericTexts = {
            'crypts': [
                'DARKNESS...',
                'BONES...',
                'BURNING...',
                'MOSS...',
                'SILENCE...',
                'WHISPERS...'
            ],
            'mines': [
                'DARK DEPTHS...',
                'SHADOWED CORNERS...',
                'ECHOES...',
                'GLIMMER...',
                'DRIP... DROP...'
            ],
            'magma': [
                'HEAT...',
                'BURNING...',
                'MOLTEN...',
                'INFERNO...',
                'SCORCHING...'
            ],
            'temple': [
                'THORNS...',
                'VENOMOUS...',
                'OVERGROWTH...',
                'ANCIENT...',
                'FORGOTTEN...'
            ],
            'void': [
                'VOID...',
                'RIFT DEPTH...',
                'ETHEREAL...',
                'INFINITY...',
                'COSMOS...'
            ]
        };
        
        setInterval(() => {
            if (!this.game.isRunning || !this.atmosphereText) return;
            
            const dungeonType = this.game.selectedDungeon || 'crypts';
            const texts = atmosphericTexts[dungeonType] || atmosphericTexts['crypts'];
            
            if (Math.random() < 0.15) { // 15% chance every interval
                const randomText = texts[Math.floor(Math.random() * texts.length)];
                this.atmosphereText.textContent = randomText;
                this.atmosphereText.style.opacity = '0.15';
                
                // Fade out after 3 seconds
                setTimeout(() => {
                    if (this.atmosphereText) {
                        this.atmosphereText.style.opacity = '0';
                    }
                }, 3000);
            }
        }, 2000); // Check every 2 seconds
    }

    toggleShortcuts() {
        if (this.shortcutsOverlay) {
            this.shortcutsOverlay.classList.toggle('hidden');
        }
    }

    addLogEntry(message) {
        console.log(`[GAME] ${message}`);
    }

    startUILoop() {
        // Tier 1: Canvas rendering at 60fps (handled by Game class)
        const updateCanvas = () => {
            this.updateCanvas();
            requestAnimationFrame(updateCanvas);
        };
        updateCanvas();
        
        // Tier 2: DOM updates at 1 second intervals
        setInterval(() => {
            this.updateDOM();
        }, 1000);
        
        // Tier 3: Blockchain queries at 30 second intervals
        setInterval(() => {
            this.updateBlockchain();
        }, 30000);
        
        // Tier 4: Wallet balance at 15 second intervals
        setInterval(() => {
            this.updateWalletBalance();
        }, 15000);
        
        // Initial updates
        this.updateDOM();
        this.updateBlockchain();
        this.updateWalletBalance();
        
        console.log('✅ Multi-tier UI loop started (Canvas: 60fps, DOM: 1s, Blockchain: 30s, Balance: 15s)');
    }
}
