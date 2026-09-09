// UI Controller - Dashboard and User Interactions

class UI {
    constructor(game) {
        this.game = game;
        this.selectedKnight = null;
        this.squadPanelOpen = false;
        
        this.initElements();
        this.bindEvents();
        this.startUILoop();
    }

    initElements() {
        // New top bar elements
        this.dungeonNameDisplay = document.getElementById('dungeonNameDisplay');
        this.dungeonProgress = document.getElementById('dungeonProgress');
        this.knightsCount = document.getElementById('knightsCount');
        this.treasureAmount = document.getElementById('treasureAmount');
        
        // Buttons
        this.mintKnightBtn = document.getElementById('mintKnight');
        this.startDungeonBtn = document.getElementById('startDungeon');
        this.stopDungeonBtn = document.getElementById('stopDungeon');
        this.muteBtn = document.getElementById('muteBtn');
        this.muteMusicBtn = document.getElementById('muteMusicBtn');
        this.returnMenuBtn = document.getElementById('returnMenuBtn');

        // New UI elements
        this.goldRate = document.getElementById('goldRate');
        this.activeKnights = document.getElementById('activeKnights');
        this.activeLoot = document.getElementById('activeLoot');
        this.atmosphereText = document.getElementById('atmosphereText');
        this.activeKnightPortraits = document.getElementById('activeKnightPortraits');
        this.gameMain = document.getElementById('gameMain');
        
        // Squad panel elements
        this.squadPanel = document.getElementById('squadPanel');
        this.squadToggle = document.getElementById('squadToggle');
        this.deployedKnights = document.getElementById('deployedKnights');
        this.allKnightsRoster = document.getElementById('allKnightsRoster');
        this.restingKnights = document.getElementById('restingKnights');
        this.gameLog = document.getElementById('gameLog');
        this.deployedCount = document.getElementById('deployedCount');
        this.totalKnightsCount = document.getElementById('totalKnightsCount');
        
        // Debug log
        console.log('🎮 UI Elements initialized:', {
            squadPanel: !!this.squadPanel,
            squadToggle: !!this.squadToggle,
            deployedKnights: !!this.deployedKnights,
            allKnightsRoster: !!this.allKnightsRoster,
            restingKnights: !!this.restingKnights
        });
    }

    bindEvents() {
        // Button clicks
        if (this.mintKnightBtn) {
            this.mintKnightBtn.addEventListener('click', () => {
                const knight = this.game.recruitKnight(10);
                if (knight) {
                    this.updateKnightRoster();
                }
            });
        }

        if (this.startDungeonBtn) {
            this.startDungeonBtn.addEventListener('click', () => {
                this.game.startDungeon();
            });
        }

        if (this.stopDungeonBtn) {
            this.stopDungeonBtn.addEventListener('click', () => {
                this.game.stopDungeon();
            });
        }
        
        // Mute button
        if (this.muteBtn) {
            this.muteBtn.addEventListener('click', () => {
                if (window.audioManager) {
                    const isMuted = window.audioManager.toggleMute();
                    this.muteBtn.textContent = isMuted ? '🔇' : '🔊';
                    this.muteBtn.title = isMuted ? 'Unmute Sound Effects' : 'Mute Sound Effects';
                }
            });
        }
        
        // Music mute button
        if (this.muteMusicBtn) {
            this.muteMusicBtn.addEventListener('click', () => {
                if (window.audioManager) {
                    const isMuted = window.audioManager.toggleMusicMute();
                    this.muteMusicBtn.textContent = isMuted ? '🔇' : '🎵';
                    this.muteMusicBtn.title = isMuted ? 'Unmute Music' : 'Mute Music';
                }
            });
        }
        
        // Return to menu button
        if (this.returnMenuBtn) {
            this.returnMenuBtn.addEventListener('click', () => {
                // Save current gold back to localStorage
                localStorage.setItem('gameGold', this.game.goldBalance);
                // Save all knights data
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

        // Squad panel toggle
        if (this.squadToggle) {
            console.log('✅ Binding squad toggle button');
            this.squadToggle.addEventListener('click', (e) => {
                console.log('🖱️ Squad toggle clicked!');
                e.preventDefault();
                e.stopPropagation();
                this.toggleSquadPanel();
            });
        } else {
            console.error('❌ Squad toggle button not found!');
        }
        
        // Help button
        const helpBtn = document.getElementById('helpBtn');
        if (helpBtn) {
            helpBtn.addEventListener('click', () => {
                this.toggleShortcuts();
            });
        }
        
        // Shortcuts close button
        const shortcutsClose = document.getElementById('shortcutsClose');
        if (shortcutsClose) {
            shortcutsClose.addEventListener('click', () => {
                this.toggleShortcuts();
            });
        }

        // Completion modal buttons
        const nextDungeonBtn = document.getElementById('nextDungeonBtn');
        const restHeroesBtn = document.getElementById('restHeroesBtn');
        const replayDungeonBtn = document.getElementById('replayDungeonBtn');
        
        if (nextDungeonBtn) {
            nextDungeonBtn.addEventListener('click', () => {
                this.game.nextDungeon();
            });
        }

        if (restHeroesBtn) {
            restHeroesBtn.addEventListener('click', () => {
                this.game.restAllHeroes();
            });
        }

        if (replayDungeonBtn) {
            replayDungeonBtn.addEventListener('click', () => {
                this.game.replayDungeon();
            });
        }
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            this.handleKeyPress(e);
        });
    }
    
    toggleSquadPanel() {
        console.log('🎯 Toggle squad panel called');
        console.log('  Current state:', this.squadPanelOpen);
        console.log('  Panel element:', this.squadPanel);
        
        this.squadPanelOpen = !this.squadPanelOpen;
        
        if (this.squadPanel) {
            this.squadPanel.classList.toggle('open', this.squadPanelOpen);
            console.log('  New state:', this.squadPanelOpen);
            console.log('  Classes:', this.squadPanel.className);
        } else {
            console.error('  ❌ Squad panel element not found!');
        }
        
        if (window.audioManager) {
            window.audioManager.play('button_click');
        }
    }
    
    toggleShortcuts() {
        const overlay = document.getElementById('shortcutsOverlay');
        if (overlay) {
            overlay.classList.toggle('hidden');
        }
        if (window.audioManager) {
            window.audioManager.play('button_click');
        }
    }
    
    handleKeyPress(e) {
        // Don't handle if typing in input field
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
            return;
        }
        
        switch(e.key.toLowerCase()) {
            case ' ': // Space - Deploy
                e.preventDefault();
                if (!this.game.isRunning) {
                    this.game.startDungeon();
                }
                break;
            case 'escape': // Esc - Recall
                e.preventDefault();
                if (this.game.isRunning) {
                    this.game.stopDungeon();
                }
                break;
            case 's': // Toggle SFX
                e.preventDefault();
                if (this.muteBtn) {
                    this.muteBtn.click();
                }
                break;
            case 'm': // Toggle Music
                e.preventDefault();
                if (this.muteMusicBtn) {
                    this.muteMusicBtn.click();
                }
                break;
            case 'h': // Show shortcuts
                e.preventDefault();
                this.toggleShortcuts();
                break;
            case 'q': // Toggle squad panel
                e.preventDefault();
                console.log('🔤 Q key pressed - toggling squad panel');
                this.toggleSquadPanel();
                break;
        }
    }

    startUILoop() {
        // Initial update
        this.update();
        
        // Set initial theme
        this.updateTheme(this.game.selectedDungeon);
        
        // Then update every 100ms
        setInterval(() => this.update(), 100);
    }

    update() {
        // Safety check
        if (!this.game || !this.game.getGameState) {
            return;
        }

        const state = this.game.getGameState();

        // Update top bar stats
        this.dungeonNameDisplay.textContent = state.dungeonName;
        this.treasureAmount.textContent = state.goldBalance;
        this.knightsCount.textContent = state.activeKnights;
        
        // Update progress (loot remaining)
        this.dungeonProgress.textContent = `Loot: ${state.activeLootNodes}`;

        // Update quick stats
        this.goldRate.textContent = state.goldPerMinute;
        this.activeKnights.textContent = `${state.activeKnights}/15`;
        if (this.activeLoot) {
            this.activeLoot.textContent = state.activeLootNodes;
        }

        // Update knight portraits in sidebar
        this.updateActiveKnightPortraits();

        // Update squad panel if open
        if (this.squadPanelOpen) {
            this.updateDeployedKnights();
            this.updateAllKnightsRoster();
            this.updateRestingKnights();
            this.updateSquadStats();
        }
        
        // Update atmospheric text
        this.updateAtmosphereText();
    }
    
    updateAllKnightsRoster() {
        const allKnights = this.game.knightManager.knights;
        
        if (!this.allKnightsRoster) return;
        
        if (allKnights.length === 0) {
            this.allKnightsRoster.innerHTML = '<p class="placeholder-text">No knights available</p>';
            if (this.totalKnightsCount) this.totalKnightsCount.textContent = '0';
            return;
        }
        
        if (this.totalKnightsCount) {
            this.totalKnightsCount.textContent = allKnights.length;
        }
        if (this.deployedCount) {
            this.deployedCount.textContent = this.game.knightManager.getDeployedKnights().length;
        }
        
        this.allKnightsRoster.innerHTML = '';
        
        allKnights.forEach(knight => {
            const card = document.createElement('div');
            card.className = 'knight-mini-card';
            card.style.borderLeftColor = knight.rarity.color;
            
            const staminaPercent = (knight.stamina / knight.stats.maxStamina) * 100;
            const stateIcon = knight.state === 'attacking' ? '⚔️' : 
                             knight.state === 'moving' ? '🏃' : 
                             knight.state === 'exhausted' ? '💤' : 
                             knight.state === 'resting' ? '🍺' :
                             knight.isDeployed ? '🛡️' : '💼';
            
            const statusText = knight.isDeployed ? 'Deployed' : 
                              knight.state === 'exhausted' ? 'Exhausted' :
                              knight.state === 'resting' ? 'Resting' : 'Ready';
            
            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.3rem;">
                    <span style="font-weight: bold; color: ${knight.rarity.color};">Knight #${knight.id}</span>
                    <span style="font-size: 11px;">${stateIcon} ${statusText}</span>
                </div>
                <div style="font-size: 11px; color: #78716c; margin-bottom: 0.3rem;">
                    ${knight.rarity.name} | ⚔️${knight.stats.power} ⚡${knight.stats.speed}
                </div>
                <div class="knight-portrait-stamina">
                    <div class="knight-portrait-stamina-fill" style="width: ${staminaPercent}%"></div>
                </div>
                <div style="margin-top: 0.3rem; font-size: 10px; color: #a8a29e;">
                    Stamina: ${Math.floor(staminaPercent)}%
                </div>
            `;
            
            this.allKnightsRoster.appendChild(card);
        });
    }

    updateTheme(dungeonType) {
        // Update theme attribute for CSS styling
        this.gameMain.setAttribute('data-theme', dungeonType);
    }

    updateAtmosphereText() {
        const atmosphericTexts = {
            'crypts': ['WHISPERS...', 'SILENCE...', 'DARKNESS...', 'BONES...'],
            'mines': ['DRIP... DROP...', 'ECHOES...', 'DEPTHS...', 'GLIMMER...'],
            'temple': ['VINES...', 'GROWTH...', 'ANCIENT...', 'ROOTS...'],
            'magma': ['BURNING...', 'HEAT...', 'MOLTEN...', 'ASH...'],
            'void': ['VOID...', 'STARS...', 'INFINITY...', 'COSMOS...']
        };
        
        const dungeonType = this.game.selectedDungeon;
        const texts = atmosphericTexts[dungeonType] || [];
        
        // Randomly show atmospheric text
        if (Math.random() < 0.02 && this.game.isRunning) {
            const text = texts[Math.floor(Math.random() * texts.length)];
            this.atmosphereText.textContent = text;
            this.atmosphereText.style.opacity = '1';
            
            setTimeout(() => {
                this.atmosphereText.style.opacity = '0';
            }, 3000);
        }
    }

    updateActiveKnightPortraits() {
        const deployedKnights = this.game.knightManager.getDeployedKnights();
        
        if (!this.activeKnightPortraits) return;
        
        this.activeKnightPortraits.innerHTML = '';
        
        if (deployedKnights.length === 0) {
            this.activeKnightPortraits.innerHTML = '<p class="placeholder-text" style="font-size: 11px; padding: 1rem;">No knights deployed</p>';
            return;
        }
        
        deployedKnights.forEach(knight => {
            const portrait = document.createElement('div');
            portrait.className = 'knight-portrait';
            portrait.style.borderColor = knight.rarity.color;
            portrait.title = `Knight #${knight.id} - ${knight.rarity.name}`;
            
            const staminaPercent = (knight.stamina / knight.stats.maxStamina) * 100;
            
            portrait.innerHTML = `
                <div class="knight-portrait-name">Knight #${knight.id}</div>
                <div class="knight-portrait-stamina">
                    <div class="knight-portrait-stamina-fill" style="width: ${staminaPercent}%"></div>
                </div>
            `;
            
            this.activeKnightPortraits.appendChild(portrait);
        });
    }
    
    updateDeployedKnights() {
        const deployedKnights = this.game.knightManager.getDeployedKnights();
        
        if (!this.deployedKnights) return;
        
        if (deployedKnights.length === 0) {
            this.deployedKnights.innerHTML = '<p class="placeholder-text">No knights deployed</p>';
            return;
        }
        
        this.deployedKnights.innerHTML = '';
        
        deployedKnights.forEach(knight => {
            const card = document.createElement('div');
            card.className = 'knight-mini-card';
            card.style.borderLeftColor = knight.rarity.color;
            
            const staminaPercent = (knight.stamina / knight.stats.maxStamina) * 100;
            const stateIcon = knight.state === 'attacking' ? '⚔️' : 
                             knight.state === 'moving' ? '🏃' : 
                             knight.state === 'exhausted' ? '💤' : '🛡️';
            
            let wakeButton = '';
            if (knight.canManualWake && knight.canManualWake()) {
                wakeButton = `<button class="btn-wake-knight" data-knight-id="${knight.id}" title="Wake up this knight (${Math.floor(staminaPercent)}% stamina)">👋 Wake</button>`;
            }
            
            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.3rem;">
                    <span style="font-weight: bold;">Knight #${knight.id}</span>
                    <span>${stateIcon} ${knight.state === 'exhausted' ? 'Sleeping' : ''}</span>
                </div>
                <div class="knight-portrait-stamina">
                    <div class="knight-portrait-stamina-fill" style="width: ${staminaPercent}%"></div>
                </div>
                <div style="margin-top: 0.3rem; font-size: 11px; color: #a8a29e;">
                    Stamina: ${Math.floor(staminaPercent)}%
                </div>
                ${wakeButton}
            `;
            
            this.deployedKnights.appendChild(card);
        });
        
        // Bind wake buttons
        this.deployedKnights.querySelectorAll('.btn-wake-knight').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const knightId = parseInt(btn.dataset.knightId);
                const knight = this.game.knightManager.getKnight(knightId);
                if (knight && knight.manualWake()) {
                    this.game.logMessage(`👋 Knight #${knightId} woken up manually!`);
                    if (window.audioManager) {
                        window.audioManager.play('button_click');
                    }
                }
            });
        });
    }
    
    updateSquadStats() {
        const deployedKnights = this.game.knightManager.getDeployedKnights();
        
        if (deployedKnights.length === 0) {
            if (document.getElementById('totalPower')) {
                document.getElementById('totalPower').textContent = '0';
                document.getElementById('avgSpeed').textContent = '0';
                document.getElementById('totalStamina').textContent = '0';
            }
            return;
        }
        
        const totalPower = deployedKnights.reduce((sum, k) => sum + k.stats.power, 0);
        const avgSpeed = (deployedKnights.reduce((sum, k) => sum + k.stats.speed, 0) / deployedKnights.length).toFixed(1);
        const totalStamina = Math.floor(deployedKnights.reduce((sum, k) => sum + k.stamina, 0));
        
        if (document.getElementById('totalPower')) {
            document.getElementById('totalPower').textContent = totalPower;
            document.getElementById('avgSpeed').textContent = avgSpeed;
            document.getElementById('totalStamina').textContent = totalStamina;
        }
    }

    updateKnightRoster() {
        const knights = this.game.knightManager.knights;
        
        this.knightRoster.innerHTML = '';
        
        knights.forEach(knight => {
            const knightCard = document.createElement('div');
            knightCard.className = 'knight-card';
            knightCard.dataset.knightId = knight.id;
            
            if (knight.id === this.selectedKnight?.id) {
                knightCard.classList.add('selected');
            }

            const rarityColor = knight.rarity.color;
            const staminaPercent = knight.getStaminaPercent();
            
            let statusIcon = '⚔️';
            let statusClass = 'ready';
            if (knight.isDeployed) {
                statusIcon = '🏃';
                statusClass = 'deployed';
            } else if (knight.state === 'exhausted') {
                statusIcon = '💤';
                statusClass = 'exhausted';
            } else if (knight.state === 'resting') {
                statusIcon = '🍺';
                statusClass = 'resting';
            }

            knightCard.innerHTML = `
                <div class="knight-card-header" style="border-left: 3px solid ${rarityColor}">
                    <span class="knight-status ${statusClass}">${statusIcon}</span>
                    <span class="knight-id">#${knight.id}</span>
                    <span class="knight-rarity" style="color: ${rarityColor}">${knight.rarity.name}</span>
                </div>
                <div class="knight-stamina-bar">
                    <div class="stamina-fill" style="width: ${staminaPercent}%"></div>
                </div>
                <div class="knight-stats-mini">
                    <span title="Power">⚔️${knight.stats.power}</span>
                    <span title="Range">🎯${knight.stats.range}</span>
                    <span title="Speed (1-10)">⚡${knight.stats.speed}</span>
                </div>
            `;

            knightCard.addEventListener('click', () => {
                this.selectKnight(knight);
            });

            this.knightRoster.appendChild(knightCard);
        });
    }

    selectKnight(knight) {
        this.selectedKnight = knight;
        this.updateKnightDetails(knight);
        this.updateKnightRoster(); // Refresh to show selection
    }

    updateKnightDetails(knight) {
        if (!knight) return;

        const staminaPercent = knight.getStaminaPercent();
        const rarityColor = knight.rarity.color;

        this.knightDetails.innerHTML = `
            <div class="knight-detail-card">
                <div class="detail-header">
                    <h3 style="color: ${rarityColor}">Knight #${knight.id}</h3>
                    <span class="rarity-badge" style="background: ${rarityColor}">${knight.rarity.name}</span>
                </div>
                
                <div class="detail-stats">
                    <div class="stat-row">
                        <span class="stat-icon">⚔️</span>
                        <span class="stat-name">Power:</span>
                        <span class="stat-value">${knight.stats.power}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-icon">🎯</span>
                        <span class="stat-name">Range:</span>
                        <span class="stat-value">${knight.stats.range}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-icon">⚡</span>
                        <span class="stat-name">Speed:</span>
                        <span class="stat-value">${knight.stats.speed}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-icon">💪</span>
                        <span class="stat-name">Max Stamina:</span>
                        <span class="stat-value">${knight.stats.maxStamina}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-icon">🔄</span>
                        <span class="stat-name">Recovery:</span>
                        <span class="stat-value">${knight.stats.recoveryRate}/s</span>
                    </div>
                </div>

                <div class="stamina-section">
                    <div class="stamina-label">
                        <span>Stamina</span>
                        <span>${Math.floor(knight.stamina)}/${knight.stats.maxStamina}</span>
                    </div>
                    <div class="stamina-bar-large">
                        <div class="stamina-fill-large" style="width: ${staminaPercent}%"></div>
                    </div>
                </div>

                <div class="detail-info">
                    <p><strong>State:</strong> ${this.getStateLabel(knight.state)}</p>
                    <p><strong>Gold Earned:</strong> ${Math.floor(knight.totalEarned)}</p>
                </div>

                <div class="detail-actions">
                    ${this.getKnightActions(knight)}
                </div>
            </div>
        `;

        // Bind action buttons
        this.bindKnightActions(knight);
    }

    getStateLabel(state) {
        const labels = {
            'idle': '🟢 Ready',
            'moving': '🏃 Moving',
            'attacking': '⚔️ Attacking',
            'exhausted': '💤 Exhausted',
            'resting': '🍺 Resting'
        };
        return labels[state] || state;
    }

    getKnightActions(knight) {
        let actions = '';

        if (knight.state === 'resting') {
            actions += '<button class="btn-action" data-action="wake">Wake Up</button>';
        } else if (!knight.isDeployed && knight.state !== 'exhausted') {
            actions += '<button class="btn-action" data-action="rest">Send to Tavern</button>';
        } else if (knight.state === 'exhausted') {
            actions += '<button class="btn-action" data-action="rest">Rest in Tavern</button>';
        }

        return actions || '<p class="placeholder-text">No actions available</p>';
    }

    bindKnightActions(knight) {
        const actionButtons = this.knightDetails.querySelectorAll('[data-action]');
        
        actionButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                
                if (action === 'rest') {
                    this.game.sendKnightToTavern(knight.id);
                } else if (action === 'wake') {
                    this.game.wakeKnight(knight.id);
                }
                
                this.updateKnightDetails(knight);
            });
        });
    }

    updateRestingKnights() {
        const restingKnights = this.game.knightManager.knights.filter(k => k.state === 'resting' || k.stamina < k.stats.maxStamina * 0.5);
        
        if (!this.restingKnights) return;
        
        if (restingKnights.length === 0) {
            this.restingKnights.innerHTML = '<p class="placeholder-text">No knights resting</p>';
            return;
        }

        this.restingKnights.innerHTML = '';
        
        restingKnights.forEach(knight => {
            const card = document.createElement('div');
            card.className = 'knight-mini-card';
            card.style.borderLeftColor = knight.rarity.color;
            
            const staminaPercent = (knight.stamina / knight.stats.maxStamina) * 100;
            
            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.3rem;">
                    <span style="font-weight: bold;">Knight #${knight.id}</span>
                    <span>😴 ${Math.floor(staminaPercent)}%</span>
                </div>
                <div class="knight-portrait-stamina">
                    <div class="knight-portrait-stamina-fill" style="width: ${staminaPercent}%"></div>
                </div>
            `;
            
            this.restingKnights.appendChild(card);
        });
    }

    addLogEntry(message) {
        const entry = document.createElement('p');
        entry.className = 'log-entry';
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        
        this.gameLog.appendChild(entry);
        
        // Keep only last 20 entries
        while (this.gameLog.children.length > 20) {
            this.gameLog.removeChild(this.gameLog.firstChild);
        }
        
        // Auto-scroll to bottom
        this.gameLog.scrollTop = this.gameLog.scrollHeight;
    }
}

// Make UI class available globally
window.UI = UI;
