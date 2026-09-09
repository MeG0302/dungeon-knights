// Dungeon Selection Screen Logic

document.addEventListener('DOMContentLoaded', () => {
    const dungeonCards = document.querySelectorAll('.dungeon-card');
    const backToMenuBtn = document.getElementById('backToMenuBtn');
    const loadingTransition = document.getElementById('loadingTransition');
    const loadingDungeonName = document.getElementById('loadingDungeonName');
    
    // Dungeon names mapping
    const dungeonNames = {
        'crypts': 'Forgotten Crypts',
        'mines': 'Goblin Mines',
        'temple': 'Overgrown Temple',
        'magma': 'Magma Chambers',
        'void': 'Void Rift'
    };
    
    // Handle dungeon card clicks
    dungeonCards.forEach(card => {
        card.addEventListener('click', () => {
            const dungeonType = card.dataset.dungeon;
            const dungeonName = dungeonNames[dungeonType];
            
            // Save selected dungeon to localStorage
            localStorage.setItem('selectedDungeon', dungeonType);
            
            // Show loading transition
            loadingDungeonName.textContent = `Entering ${dungeonName}...`;
            loadingTransition.classList.remove('hidden');
            
            // Play sound if available
            if (window.audioManager) {
                window.audioManager.play('button_click');
            }
            
            // Transition to game after animation
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 2000);
        });
        
        // Hover sound effect
        card.addEventListener('mouseenter', () => {
            if (window.audioManager) {
                window.audioManager.play('hover');
            }
        });
    });
    
    // Back to menu button
    if (backToMenuBtn) {
        backToMenuBtn.addEventListener('click', () => {
            if (window.audioManager) {
                window.audioManager.play('button_click');
            }
            window.location.href = 'menu.html';
        });
    }
    
    // Load audio if available
    if (typeof AudioManager !== 'undefined') {
        window.audioManager = new AudioManager();
    }
});
