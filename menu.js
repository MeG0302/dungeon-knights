// Menu System - Main Menu and Knight Management

class MenuSystem {
    constructor() {
        this.goldBalance = 500; // Starting gold (will be removed later)
        this.knightManager = new KnightManager();
        this.selectedKnights = new Set(); // Knights selected for troops
        this.musicStarted = false;
        this.sortBy = 'id'; // Current sort method
        this.filterRarity = 'all'; // Current rarity filter
        this.knightImages = {}; // Store loaded knight images
        
        // Load gold and knights from storage
        this.loadGameData();
        
        // Load knight images
        this.loadKnightImages();
        
        this.initElements();
        this.bindEvents();
        this.updateDisplay();
        this.startAnimations();
        this.setupMusicStarter();
    }
    
    loadKnightImages() {
        // Map rarity tiers to actual image files
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
            img.src = path;
            this.knightImages[rarity] = img;
        });
    }
    
    loadGameData() {
        // Load gold from localStorage
        const savedGold = localStorage.getItem('gameGold');
        if (savedGold) {
            this.goldBalance = parseInt(savedGold);
        }
        
        // Load all knights from localStorage
        const savedKnights = localStorage.getItem('allKnights');
        if (savedKnights) {
            try {
                const knightsData = JSON.parse(savedKnights);
                knightsData.forEach(data => {
                    const knight = new Knight(data.id);
                    knight.rarity = data.rarity;
                    knight.stats = data.stats;
                    knight.stamina = data.stamina !== undefined ? data.stamina : data.stats.maxStamina;
                    knight.state = data.state || 'idle';
                    knight.totalEarned = data.totalEarned || 0;
                    this.knightManager.knights.push(knight);
                    if (data.id >= this.knightManager.nextId) {
                        this.knightManager.nextId = data.id + 1;
                    }
                });
                console.log(`✅ Loaded ${knightsData.length} knights from storage`);
            } catch (e) {
                console.error('Failed to load knights:', e);
            }
        }
    }
    
    setupMusicStarter() {
        // Try to start music immediately (will work if user already interacted)
        if (window.audioManager) {
            window.audioManager.startMenuMusic();
        }
        
        // Also set up fallback for first interaction if autoplay was blocked
        const startMusic = () => {
            if (!this.musicStarted && window.audioManager) {
                window.audioManager.startMenuMusic();
                this.musicStarted = true;
            }
        };
        
        // Try on any interaction
        document.addEventListener('click', startMusic, { once: true });
        document.addEventListener('mousemove', startMusic, { once: true });
    }
    
    initElements() {
        this.goldDisplay = document.getElementById('menuGold');
        this.playBtn = document.getElementById('playGameBtn');
        this.backMenuBtn = document.getElementById('backMenuBtn');
        this.knightRoster = document.getElementById('knightRoster');
        this.activeTroopsCount = document.getElementById('activeTroopsCount');
        this.totalKnightsCount = document.getElementById('totalKnightsCount');
        
        // Filter controls
        this.sortFilter = document.getElementById('sortFilter');
        this.rarityFilter = document.getElementById('rarityFilter');
        
        // Quick actions
        this.selectAllBtn = document.getElementById('selectAllBtn');
        this.deselectAllBtn = document.getElementById('deselectAllBtn');
        
        // Modal elements
        this.modal = document.getElementById('knightModal');
        this.modalClose = document.getElementById('modalClose');
        this.modalCloseBtn = document.getElementById('modalCloseBtn');
        this.modalSelectBtn = document.getElementById('modalSelectBtn');
        this.currentModalKnight = null;
    }
    
    bindEvents() {
        // Play Game button
        this.playBtn.addEventListener('click', () => {
            if (this.selectedKnights.size === 0) {
                alert('⚠️ You must select at least one knight to enter the dungeon!');
                return;
            }
            
            // Save selected knights and gold to localStorage
            const selectedKnightIds = Array.from(this.selectedKnights);
            const knightsData = this.knightManager.knights
                .filter(k => selectedKnightIds.includes(k.id))
                .map(k => ({
                    id: k.id,
                    rarity: k.rarity,
                    stats: k.stats,
                    stamina: k.stamina,
                    state: k.state,
                    totalEarned: k.totalEarned || 0
                }));
            
            localStorage.setItem('gameGold', this.goldBalance);
            localStorage.setItem('selectedKnights', JSON.stringify(knightsData));
            localStorage.setItem('allKnights', JSON.stringify(this.knightManager.knights.map(k => ({
                id: k.id,
                rarity: k.rarity,
                stats: k.stats,
                stamina: k.stamina,
                state: k.state,
                totalEarned: k.totalEarned || 0
            }))));
            
            // Play sound and STOP menu music
            if (window.audioManager) {
                window.audioManager.play('deploy');
                window.audioManager.stopMenuMusic(); // Stop menu music when entering game
            }
            
            // Redirect to dungeon selection
            window.location.href = 'dungeon-select.html';
        });
        
        // Back to main menu
        this.backMenuBtn.addEventListener('click', () => {
            if (window.audioManager) {
                window.audioManager.play('button_click');
            }
            window.location.href = 'landing.html';
        });
        
        // Sort filter
        this.sortFilter.addEventListener('change', (e) => {
            this.sortBy = e.target.value;
            this.updateDisplay();
            if (window.audioManager) {
                window.audioManager.play('button_click');
            }
        });
        
        // Rarity filter
        this.rarityFilter.addEventListener('change', (e) => {
            this.filterRarity = e.target.value;
            this.updateDisplay();
            if (window.audioManager) {
                window.audioManager.play('button_click');
            }
        });
        
        // Select all button
        this.selectAllBtn.addEventListener('click', () => {
            const visibleKnights = this.getFilteredAndSortedKnights();
            visibleKnights.slice(0, 15).forEach(k => {
                this.selectedKnights.add(k.id);
            });
            this.updateDisplay();
            if (window.audioManager) {
                window.audioManager.play('button_click');
            }
        });
        
        // Deselect all button
        this.deselectAllBtn.addEventListener('click', () => {
            this.selectedKnights.clear();
            this.updateDisplay();
            if (window.audioManager) {
                window.audioManager.play('button_click');
            }
        });
        
        // Modal close events
        this.modalClose.addEventListener('click', () => this.closeModal());
        this.modalCloseBtn.addEventListener('click', () => this.closeModal());
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.closeModal();
            }
        });
        
        // Modal select button
        this.modalSelectBtn.addEventListener('click', () => {
            if (this.currentModalKnight) {
                this.toggleKnightSelection(this.currentModalKnight.id);
            }
        });
    }
    
    getFilteredAndSortedKnights() {
        let knights = [...this.knightManager.knights];
        
        // Apply rarity filter
        if (this.filterRarity !== 'all') {
            knights = knights.filter(k => k.rarity.tier === this.filterRarity);
        }
        
        // Apply sorting
        knights.sort((a, b) => {
            switch(this.sortBy) {
                case 'rarity':
                    const rarityOrder = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'];
                    return rarityOrder.indexOf(b.rarity.tier) - rarityOrder.indexOf(a.rarity.tier);
                case 'power':
                    return b.stats.power - a.stats.power;
                case 'speed':
                    return b.stats.speed - a.stats.speed;
                case 'stamina':
                    return b.stamina - a.stamina;
                case 'id':
                default:
                    return a.id - b.id;
            }
        });
        
        return knights;
    }
    
    toggleKnightSelection(knightId) {
        if (this.selectedKnights.has(knightId)) {
            // Deselect
            this.selectedKnights.delete(knightId);
        } else {
            // Select (max 15)
            if (this.selectedKnights.size >= 15) {
                alert('⚠️ Maximum 15 knights can be deployed at once!');
                return;
            }
            this.selectedKnights.add(knightId);
        }
        
        if (window.audioManager) {
            window.audioManager.play('button_click');
        }
        
        this.updateDisplay();
    }
    
    showKnightDetails(knight) {
        this.currentModalKnight = knight;
        
        // Update modal content
        document.getElementById('modalKnightName').textContent = `Knight #${knight.id}`;
        document.getElementById('modalRarity').textContent = knight.rarity.name;
        document.getElementById('modalRarity').style.backgroundColor = knight.rarity.color + '30';
        document.getElementById('modalRarity').style.borderColor = knight.rarity.color;
        document.getElementById('modalRarity').style.color = knight.rarity.color;
        
        // Set knight image
        const modalImg = document.getElementById('modalKnightImage');
        const knightImg = this.knightImages[knight.rarity.tier];
        if (knightImg && knightImg.complete) {
            modalImg.src = knightImg.src;
        }
        
        // Set avatar border color
        document.querySelector('.modal-knight-avatar').style.borderColor = knight.rarity.color;
        
        // Stats
        document.getElementById('modalPower').textContent = knight.stats.power;
        document.getElementById('modalSpeed').textContent = knight.stats.speed.toFixed(1);
        document.getElementById('modalMaxStamina').textContent = knight.stats.maxStamina;
        
        // Stamina
        const staminaPercent = (knight.stamina / knight.stats.maxStamina) * 100;
        document.getElementById('modalStaminaText').textContent = `${Math.floor(knight.stamina)} / ${knight.stats.maxStamina}`;
        document.getElementById('modalStaminaBar').style.width = staminaPercent + '%';
        
        // Status
        let status = 'Ready';
        if (knight.state === 'resting') {
            status = '😴 Resting';
        } else if (knight.stamina < knight.stats.maxStamina * 0.5) {
            status = '⚡ Low Stamina';
        }
        document.getElementById('modalStatus').textContent = status;
        
        // Total earned
        document.getElementById('modalEarned').textContent = (knight.totalEarned || 0).toFixed(2) + ' Gold';
        
        // Update select button
        if (this.selectedKnights.has(knight.id)) {
            this.modalSelectBtn.textContent = 'Remove from Squad';
            this.modalSelectBtn.style.borderTopColor = 'rgba(239, 68, 68, 0.5)';
        } else {
            this.modalSelectBtn.textContent = 'Add to Squad';
            this.modalSelectBtn.style.borderTopColor = 'rgba(16, 185, 129, 0.5)';
        }
        
        // Show modal
        this.modal.classList.remove('hidden');
        
        if (window.audioManager) {
            window.audioManager.play('button_click');
        }
    }
    
    closeModal() {
        this.modal.classList.add('hidden');
        this.currentModalKnight = null;
        if (window.audioManager) {
            window.audioManager.play('button_click');
        }
    }
    
    updateDisplay() {
        // Update gold
        this.goldDisplay.textContent = this.goldBalance;
        
        // Update troops count
        this.activeTroopsCount.textContent = this.selectedKnights.size;
        this.totalKnightsCount.textContent = this.knightManager.knights.length;
        
        // Update knight roster
        this.renderKnightRoster();
    }
    
    renderKnightRoster() {
        const knights = this.getFilteredAndSortedKnights();
        
        if (knights.length === 0) {
            this.knightRoster.innerHTML = '<p class="empty-message">No knights match the current filter. Visit the Summoning Chamber to forge your first knight!</p>';
            return;
        }
        
        this.knightRoster.innerHTML = '';
        
        knights.forEach(knight => {
            const card = document.createElement('div');
            card.className = 'knight-card';
            if (this.selectedKnights.has(knight.id)) {
                card.classList.add('selected');
            }
            if (knight.state === 'resting' || knight.stamina < knight.stats.maxStamina * 0.5) {
                card.classList.add('sleeping');
            }
            
            // Get knight image
            const knightImg = this.knightImages[knight.rarity.tier];
            const imgHtml = knightImg && knightImg.complete ? 
                `<img src="${knightImg.src}" alt="Knight ${knight.id}">` : 
                '⚔️';
            
            // Calculate stamina percentage
            const staminaPercent = (knight.stamina / knight.stats.maxStamina) * 100;
            
            card.innerHTML = `
                <div class="knight-avatar rarity-${knight.rarity.tier}" style="border-color: ${knight.rarity.color}">
                    ${imgHtml}
                </div>
                <div class="knight-info">
                    <div class="knight-name">Knight #${knight.id}</div>
                    <div class="knight-rarity rarity-${knight.rarity.tier}" style="background: ${knight.rarity.color}30; border-color: ${knight.rarity.color}; color: ${knight.rarity.color}">
                        ${knight.rarity.name}
                    </div>
                    <div class="knight-stats">
                        <span class="knight-stat">⚡ ${knight.stats.power}</span>
                        <span class="knight-stat">🏃 ${knight.stats.speed.toFixed(1)}</span>
                        <span class="knight-stat">💪 ${knight.stats.maxStamina}</span>
                    </div>
                    <div class="knight-stamina-display">
                        <div class="knight-stamina-label">
                            <span>Stamina</span>
                            <span>${Math.floor(knight.stamina)} / ${knight.stats.maxStamina}</span>
                        </div>
                        <div class="stamina-bar">
                            <div class="stamina-fill" style="width: ${staminaPercent}%"></div>
                            <div class="stamina-threshold"></div>
                        </div>
                    </div>
                </div>
            `;
            
            // Click to select
            card.addEventListener('click', (e) => {
                // If clicking directly on card (not double-click), toggle selection
                if (e.detail === 1) {
                    setTimeout(() => {
                        if (e.detail === 1) {
                            this.toggleKnightSelection(knight.id);
                        }
                    }, 200);
                }
            });
            
            // Double-click to view details
            card.addEventListener('dblclick', () => {
                this.showKnightDetails(knight);
            });
            
            this.knightRoster.appendChild(card);
        });
    }
    
    startAnimations() {
        // Shield bash animation every 5 seconds
        setInterval(() => {
            const avatars = document.querySelectorAll('.knight-avatar');
            avatars.forEach((avatar, index) => {
                setTimeout(() => {
                    avatar.classList.add('shield-bash');
                    setTimeout(() => avatar.classList.remove('shield-bash'), 500);
                }, index * 100); // Stagger animations
            });
        }, 5000);
        
        // Update stamina recovery for resting knights
        setInterval(() => {
            let updated = false;
            this.knightManager.knights.forEach(knight => {
                if (knight.state === 'resting' && knight.stamina < knight.stats.maxStamina) {
                    knight.stamina = Math.min(knight.stats.maxStamina, knight.stamina + 1);
                    updated = true;
                    
                    // Wake up if reached 50% stamina
                    if (knight.stamina >= knight.stats.maxStamina * 0.5) {
                        knight.state = 'idle';
                    }
                }
            });
            
            if (updated) {
                this.updateDisplay();
                // Save to localStorage
                localStorage.setItem('allKnights', JSON.stringify(this.knightManager.knights.map(k => ({
                    id: k.id,
                    rarity: k.rarity,
                    stats: k.stats,
                    stamina: k.stamina,
                    state: k.state,
                    totalEarned: k.totalEarned || 0
                }))));
            }
        }, 1000); // Update every second
    }
}

// Initialize menu system when page loads
window.addEventListener('DOMContentLoaded', () => {
    window.menuSystem = new MenuSystem();
});
