// Landing Page - Navigation Controller

class LandingPage {
    constructor() {
        this.musicStarted = false;
        this.initElements();
        this.bindEvents();
        this.setupMusicStarter();
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
        
        // Also try on any click
        document.addEventListener('click', startMusic, { once: true });
    }
    
    initElements() {
        this.enterDungeonBtn = document.getElementById('enterDungeonBtn');
        this.summonKnightBtn = document.getElementById('summonKnightBtn');
        this.marketplaceBtn = document.getElementById('marketplaceBtn');
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
    }
}

// Initialize landing page
window.addEventListener('DOMContentLoaded', () => {
    new LandingPage();
});
