// Dungeon Selection Screen Logic

document.addEventListener('DOMContentLoaded', () => {
    const questScrollCards = document.querySelectorAll('.quest-scroll-card');
    const loadingTransition = document.getElementById('loadingTransition');
    const loadingDungeonName = document.getElementById('loadingDungeonName');

    const dungeonNames = {
        'crypts': 'Forgotten Crypts',
        'mines': 'Goblin Mines',
        'temple': 'Overgrown Temple',
        'magma': 'Magma Chambers',
        'void': 'Void Rift'
    };

    questScrollCards.forEach(card => {
        const acceptBtn = card.querySelector('.accept-quest-btn');

        card.addEventListener('click', (e) => {
            if (e.target === acceptBtn || acceptBtn.contains(e.target)) return;
            acceptBtn.click();
        });

        acceptBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const dungeonType = card.dataset.dungeon;
            const dungeonName = dungeonNames[dungeonType];

            localStorage.setItem('selectedDungeon', dungeonType);
            loadingDungeonName.textContent = `Entering ${dungeonName}...`;
            loadingTransition.classList.remove('hidden');

            if (window.audioManager) window.audioManager.play('button_click');

            setTimeout(() => {
                window.location.href = 'index.html';
            }, 1500);
        });

        card.addEventListener('mouseenter', () => {
            if (window.audioManager) window.audioManager.play('hover');
        });
    });

    if (typeof AudioManager !== 'undefined') {
        window.audioManager = new AudioManager();
    }
});
