// Landing Page - Navigation Controller

class LandingPage {
    constructor() {
        this.musicStarted = false;
        this.walletManager = window.walletManager;
        this.initElements();
        this.bindEvents();
        this.setupMusicStarter();
        this.updateStats();
        this.setupWalletListeners();
    }
    
    setupMusicStarter() {
        // Try to start music immediately
        if (window.audioManager) {
            window.audioManager.startMenuMusic();
        }
        
        // Start music on first user interaction (fallback if autoplay blocked)
        const startMusic = () => {
            if (!this.musicStarted && window.audioManager) {
                window.audioManager.startMenuMusic();
                this.musicStarted = true;
            }
        };
        
        // Add listeners to all buttons
        this.enterDungeonBtn.addEventListener('mouseenter', startMusic, { once: true });
        this.summonKnightBtn.addEventListener('mouseenter', startMusic, { once: true });
        this.marketplaceBtn.addEventListener('mouseenter', startMusic, { once: true });
        this.leaderboardBtn.addEventListener('mouseenter', startMusic, { once: true });
        
        // Also try on any click
        document.addEventListener('click', startMusic, { once: true });
    }
    
    initElements() {
        this.enterDungeonBtn = document.getElementById('enterDungeonBtn');
        this.summonKnightBtn = document.getElementById('summonKnightBtn');
        this.marketplaceBtn = document.getElementById('marketplaceBtn');
        this.leaderboardBtn = document.getElementById('leaderboardLandingBtn');
        
        // Stats elements
        this.totalKnightsEl = document.getElementById('totalKnights');
        this.totalVictoriesEl = document.getElementById('totalVictories');
        this.totalGoldEl = document.getElementById('totalGold');
        
        // Wallet elements
        this.walletWidget = document.getElementById('walletWidget');
        this.connectWalletBtn = document.getElementById('connectWalletBtn');
        this.dngBalanceHeader = document.getElementById('dngBalanceHeader');
    }
    
    setupWalletListeners() {
        // Listen for wallet connection
        window.addEventListener('walletConnected', () => {
            this.updateWalletDisplay();
            this.updateStats();
        });
        
        window.addEventListener('walletDisconnected', () => {
            this.updateWalletDisplay();
        });
        
        // Connect wallet button
        if (this.connectWalletBtn) {
            this.connectWalletBtn.addEventListener('click', async () => {
                if (this.walletManager.isConnected) {
                    await this.walletManager.disconnect();
                } else {
                    await this.walletManager.connect();
                }
            });
        }
        
        // Initial wallet state
        if (this.walletManager && this.walletManager.isConnected) {
            this.updateWalletDisplay();
        }
    }
    
    async updateWalletDisplay() {
        if (!this.walletManager) return;
        
        if (this.walletManager.isConnected) {
            // Update button text
            if (this.connectWalletBtn) {
                const shortAddress = this.walletManager.userAddress.slice(0, 6) + '...' + 
                                   this.walletManager.userAddress.slice(-4);
                this.connectWalletBtn.textContent = shortAddress;
            }
            
            // Update balance
            try {
                const balance = await this.walletManager.getDNGBalance();
                if (this.dngBalanceHeader) {
                    this.dngBalanceHeader.textContent = `${parseFloat(balance).toFixed(0)} DNG`;
                }
            } catch (error) {
                console.error('Failed to get balance:', error);
            }
            
            // Add connected class
            if (this.walletWidget) {
                this.walletWidget.classList.add('connected');
            }
        } else {
            // Update button text
            if (this.connectWalletBtn) {
                this.connectWalletBtn.textContent = 'Connect Wallet';
            }
            
            // Hide balance
            if (this.dngBalanceHeader) {
                this.dngBalanceHeader.textContent = '0 DNG';
            }
            
            // Remove connected class
            if (this.walletWidget) {
                this.walletWidget.classList.remove('connected');
            }
        }
    }
    
    async updateStats() {
        // Get stats from localStorage or contract
        try {
            // Total knights (from localStorage or contract)
            if (this.walletManager && this.walletManager.isConnected) {
                const knights = await this.walletManager.getMyKnights();
                if (this.totalKnightsEl) {
                    this.totalKnightsEl.textContent = knights.length;
                }
            }
            
            // Total victories (from localStorage)
            const completedRuns = localStorage.getItem('totalCompletedRuns') || '0';
            if (this.totalVictoriesEl) {
                this.totalVictoriesEl.textContent = completedRuns;
            }
            
            // Total gold claimed (from localStorage)
            const totalClaimed = localStorage.getItem('totalDNGClaimed') || '0';
            if (this.totalGoldEl) {
                this.totalGoldEl.textContent = parseFloat(totalClaimed).toFixed(0);
            }
        } catch (error) {
            console.error('Failed to update stats:', error);
        }
    }
    
    bindEvents() {
        // Enter Dungeon - Go to knight management/game
        this.enterDungeonBtn.addEventListener('click', () => {
            if (window.audioManager) {
                window.audioManager.play('button_click');
                // Keep menu music playing for knight selection
            }
            
            // Go to menu where players select knights
            window.location.href = 'menu.html';
        });
        
        // Summon Knight - Go to minting page
        this.summonKnightBtn.addEventListener('click', () => {
            if (window.audioManager) {
                window.audioManager.play('button_click');
                // Keep menu music playing
            }
            
            // Go to dedicated minting page
            window.location.href = 'mint.html';
        });
        
        // Marketplace - Coming soon
        this.marketplaceBtn.addEventListener('click', () => {
            alert('🏪 Marketplace coming soon!');
        });
        
        // Leaderboard - Show leaderboard modal
        this.leaderboardBtn.addEventListener('click', () => {
            if (window.audioManager) {
                window.audioManager.play('button_click');
            }
            
            if (window.leaderboardManager) {
                window.leaderboardManager.show();
            } else {
                alert('Leaderboard is loading...');
            }
        });
    }
}

// Initialize landing page
window.addEventListener('DOMContentLoaded', () => {
    new LandingPage();
});
