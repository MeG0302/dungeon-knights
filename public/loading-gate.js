/* ==========================================================================
   loading-gate.js — the gate Arya holds while a dungeon is coming through.

   Landing on /game used to show the crypts map for a beat (the page markup's
   own background video, plus a crypts chest in the side panel) before snapping
   to the dungeon the player actually chose, and the chosen map then drew in
   front of an empty floor while its monster art, knight sprites and obstacle
   tiles were still on the wire. So the first seconds of every run showed a
   half-built dungeon.

   This module owns the opaque gate that covers all of it. It collects what the
   chosen dungeon is about to draw — its floor tile, decoration sheet and chest,
   every monster it can spawn, the knight sprites for the rarities actually in
   the squad, the small obstacle art the renderer fetches on its first frame,
   and the map video's first frame — and opens the gate only once they have all
   settled. Arya stands on it and asks the player to hold on for as long as that
   takes, which is the one moment in the game where waiting is on purpose.

   It cannot trap the player: a failed asset counts as settled (the engine
   degrades on its own), the engine is only waited for up to a cap, and the
   whole thing opens on MAX_MS no matter what.
   ========================================================================== */
(function () {
    'use strict';

    const MIN_MS = 900;      // a fully cached load must not flash the gate
    const MAX_MS = 15000;    // a hung request must never hold the map hostage
    const TICK_MS = 100;     // how often the engine is looked for

    const gate = document.getElementById('mapLoadingGate');
    if (!gate) return;       // a page without the gate just skips all of this

    const nameEl = document.getElementById('mapGateName');
    const labelEl = document.getElementById('mapGateLabel');
    const barEl = document.getElementById('mapGateBar');
    const countEl = document.getElementById('mapGateCount');

    const NAMES = {
        crypts: 'Forgotten Crypts',
        mines: 'Goblin Mines',
        temple: 'Overgrown Temple',
        magma: 'Magma Chambers',
        void: 'Void Rift',
    };
    const chosen = localStorage.getItem('selectedDungeon');
    if (nameEl) nameEl.textContent = NAMES[chosen] || 'your dungeon';

    const started = Date.now();
    let opened = false;
    let asked = false;
    let total = 0;
    let settled = 0;

    // ---------------------------------------------------------------- waiting
    function watchImage(img) {
        if (!img) return;
        total += 1;
        // A complete image is either decoded or failed — the browser has finished
        // with it either way, which is all the gate is waiting for.
        if (img.complete) { settled += 1; return; }
        const done = () => { settled += 1; paint(); checkDone(); };
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
    }

    function watchVideo(video) {
        if (!video) return;
        total += 1;
        if (video.readyState >= 2) { settled += 1; return; }
        const done = () => { settled += 1; paint(); checkDone(); };
        ['loadeddata', 'canplay', 'error'].forEach((ev) => video.addEventListener(ev, done, { once: true }));
    }

    function squadRarities() {
        try {
            const raw = JSON.parse(localStorage.getItem('selectedKnights') || '[]');
            const out = [];
            raw.forEach((k) => {
                // `rarity` is saved as the whole object by the roster, with the tier
                // inside it; a plain string shows up from the older saves.
                const tier = k && k.rarity && (k.rarity.tier || k.rarity);
                if (tier && out.indexOf(tier) === -1) out.push(tier);
            });
            return out;
        } catch { return []; }
    }

    /** Everything the chosen dungeon is about to draw. */
    function collect(game) {
        const renderer = game.dungeonRenderer;
        const config = game.dungeon.config || {};
        const type = game.selectedDungeon || 'crypts';
        if (nameEl) nameEl.textContent = config.name || NAMES[type] || 'your dungeon';

        if (renderer.floorTiles) watchImage(renderer.floorTiles[type]);
        if (renderer.decorationSprites) watchImage(renderer.decorationSprites[type]);
        if (renderer.chestImages) watchImage(renderer.chestImages[type]);

        (config.monsters || []).forEach((file) => {
            const path = `monsters/${config.monsterFolder}/${file}`;
            if (renderer.monsterImages) watchImage(renderer.monsterImages[path]);
        });

        // Only the rarities in this squad: the renderer loads all six, which is ~9 MB,
        // and the other five can never appear on this map.
        const knightImages = renderer.knightImages || {};
        squadRarities().forEach((tier) => watchImage(knightImages[tier]));

        // The renderer allocates these on its first frame, which is why a map used to
        // gain its obstacles a second or two in. Loading them here puts them in the
        // HTTP cache first, so that first frame draws them.
        const seen = {};
        (game.dungeon.decorations || []).forEach((dec) => {
            if (!dec.imagePath || seen[dec.imagePath]) return;
            seen[dec.imagePath] = true;
            const img = new Image();
            img.src = dec.imagePath;
            watchImage(img);
        });

        watchVideo(game.videoElement);

        total = Math.max(total, 1);
        paint();
        checkDone();
    }

    // ------------------------------------------------------------------- paint
    function paint() {
        const pct = Math.round((settled / Math.max(1, total)) * 100);
        if (barEl) barEl.style.width = `${Math.max(3, pct)}%`;
        if (countEl) countEl.textContent = total > 1 ? `${settled} / ${total}` : '';
        if (labelEl) {
            labelEl.textContent = pct < 45 ? 'Unrolling the map…' : 'Waking the monsters…';
        }
    }

    // -------------------------------------------------------------------- arya
    // She speaks for the whole load and this module takes her down — a timer would
    // either leave too early or talk over the map once it arrives.
    function askArya() {
        if (asked || !window.Arya) return;
        asked = true;
        window.Arya.say('hold', { duration: MAX_MS + 5000 });
    }

    // -------------------------------------------------------------------- open
    function checkDone() {
        if (opened || settled < total) return;
        open('ready');
    }

    function open(reason) {
        if (opened) return;
        opened = true;
        clearTimeout(failsafe);
        clearInterval(poll);
        if (labelEl) labelEl.textContent = 'The gate is open.';
        if (countEl) countEl.textContent = '';
        if (barEl) barEl.style.width = '100%';
        if (reason === 'timeout') {
            console.warn('[MapGate] opened on the failsafe — some art may still be loading');
        }
        const held = Math.max(0, MIN_MS - (Date.now() - started));
        setTimeout(() => {
            gate.classList.add('is-open');
            // She steps off as the map arrives rather than hovering over the first move.
            if (window.Arya) setTimeout(() => window.Arya.hide(), 900);
            setTimeout(() => gate.remove(), 800);
        }, held);
    }

    const failsafe = setTimeout(() => open('timeout'), MAX_MS);

    // The engine is built on the re-fired DOMContentLoaded, after every legacy script
    // has loaded, so it is polled for rather than assumed.
    const poll = setInterval(() => {
        if (!asked) askArya();
        const game = window.game;
        if (!game || !game.dungeon || !game.dungeonRenderer || !game.videoElement) return;
        clearInterval(poll);
        askArya();
        collect(game);
    }, TICK_MS);

    paint();
})();
