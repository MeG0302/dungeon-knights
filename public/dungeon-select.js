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

    // ---------------------------------------------------------------- the header pill
    // The Quest Board's pill is the wallet control every page has — it carries the menu that
    // opens My Portfolio. It also shows the balance, because the board spends it, and a pill
    // stuck on "0 DNG" beside a real balance is worse than no pill at all. Same two events
    // `landing.js` listens for, so a wallet connected on another page already reads correctly
    // by the time this one paints.
    const balanceEl = document.getElementById('questBoardBalance');

    async function paintBalance() {
        if (!balanceEl) return;
        const manager = window.walletManager;
        if (!manager || !manager.isConnected) {
            balanceEl.textContent = '0 DNG';
            return;
        }
        try {
            const balance = await manager.getDNGBalance();
            balanceEl.textContent = `${parseFloat(balance).toFixed(0)} DNG`;
        } catch (error) {
            // A failed read is said out loud rather than shown as a zero, and the menu still
            // opens, so the one thing the player actually needs here is not hidden by it.
            console.warn('Could not read the DNG balance:', error?.message || error);
            balanceEl.textContent = '— DNG';
        }
    }

    window.addEventListener('walletConnected', paintBalance);
    window.addEventListener('walletDisconnected', paintBalance);
    paintBalance();
});
