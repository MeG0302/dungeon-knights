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

            // Arya, the gate keeper, sees the squad off as the map opens. The extra beat
            // on the transition is her screen time — at the old 1.5s she was still rising
            // when the page navigated away.
            if (window.Arya) window.Arya.say('enter', { dungeon: dungeonName, duration: 2600 });

            setTimeout(() => {
                window.location.href = 'index.html';
            }, 2200);
        });

        card.addEventListener('mouseenter', () => {
            if (window.audioManager) window.audioManager.play('hover');
        });
    });

    if (typeof AudioManager !== 'undefined') {
        window.audioManager = new AudioManager();
    }
});
