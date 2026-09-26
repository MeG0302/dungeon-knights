/* ==========================================================================
   loading-gate.js — the gate Arya holds while a dungeon is coming through.

   Landing on /game used to show the crypts map for a beat (the page markup's
   own background video, plus a crypts chest in the side panel) before snapping
   to the dungeon the player actually chose, and the chosen map then drew in
   front of an empty floor while its monster art, knight sprites and obstacle
   tiles were still on the wire. So the first seconds of every run showed a
   half-built dungeon.

   The same thing happened *later* in the run, and worse: sixty seconds after a
   clear the squad auto-progresses to the next dungeon, which rebuilt the map
   and swapped the background video underneath the player, no screen and no
   notice. That is the second caller of `raise()` below — the gate is one
   component with two entries now, not a one-shot page cover.

   It collects what the chosen dungeon is about to draw — its floor tile,
   decoration sheet and chest, every monster it can spawn, the knight sprites
   for the rarities actually in the squad, the small obstacle art the renderer
   fetches on its first frame, and the map video's first frame — and opens the
   gate only once they have all settled. Arya stands on it and asks the player
   to hold on for as long as that takes, which is the one moment in the game
   where waiting is on purpose.

   It cannot trap the player: a failed asset counts as settled (the engine
   degrades on its own), the engine is only waited for up to a cap, and the
   whole thing opens on MAX_MS no matter what.

   `window.MapGate` is the API the engine uses:
       MapGate.raise('temple')          // cover the screen, name the dungeon
       MapGate.follow(game, onReady)    // watch its art; call onReady, then lift
   ========================================================================== */
(function () {
    'use strict';

    const MIN_MS = 900;      // a fully cached load must not flash the gate
    const MAX_MS = 15000;    // a hung request must never hold the map hostage
    const TICK_MS = 100;     // how often the engine is looked for

    // The gate is page markup (lib/static-pages.js) and it is *kept* here rather than
    // removed when it lifts, because the map change after a clear needs it again. Its
    // lifted state is `is-open`: transparent and untouchable, so it costs one node.
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

    let started = Date.now();
    let opened = false;
    let asked = false;
    let total = 0;
    let settled = 0;
    // Every watch belongs to one raising of the gate. An image that lands after the gate
    // has opened must not push the *next* map's counter, so late callers are dropped.
    let generation = 0;
    let openHandlers = [];
    // Both are armed at the bottom of this file and re-armed by `raise()`, which is why
    // they are declared here rather than where they are first set: a `const` timer cannot
    // be re-armed, and the second map of the day needs exactly that.
    let failsafe = null;
    let poll = null;

    // ---------------------------------------------------------------- waiting
    function watchImage(img) {
        if (!img) return;
        const gen = generation;
        total += 1;
        // A complete image is either decoded or failed — the browser has finished
        // with it either way, which is all the gate is waiting for.
        if (img.complete) { settled += 1; return; }
        const done = () => {
            if (opened || gen !== generation) return;
            settled += 1; paint(); checkDone();
        };
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
    }

    function watchVideo(video) {
        if (!video) return;
        const gen = generation;
        total += 1;
        if (video.readyState >= 2) { settled += 1; return; }
        const done = () => {
            if (opened || gen !== generation) return;
            settled += 1; paint(); checkDone();
        };
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
            labelEl.textContent = pct >= 100 ? 'Opening the gate…'
                : pct < 45 ? 'Unrolling the map…'
                : 'Waking the monsters…';
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
        failsafe = null;
        clearInterval(poll);
        poll = null;
        if (countEl) countEl.textContent = '';
        if (barEl) barEl.style.width = '100%';
        if (reason === 'timeout') {
            console.warn('[MapGate] opened on the failsafe — some art may still be loading');
        }
        const held = Math.max(0, MIN_MS - (Date.now() - started));
        setTimeout(() => {
            // Said here rather than in `open()`: everything is settled a beat before the
            // gate is allowed to lift, and "the gate is open" over a screen that is still
            // covered is the sort of sentence that makes a loading screen feel broken.
            if (labelEl) labelEl.textContent = 'The gate is open.';
            // The squad's next run opens the moment the gate starts to lift, not when it
            // has finished fading: the map underneath is already the real one, and the run
            // clock should start when its knights do.
            const handlers = openHandlers.splice(0);
            handlers.forEach((fn) => {
                try { fn(); } catch (error) { console.warn('[MapGate] ready handler failed:', error && error.message); }
            });
            gate.classList.add('is-open');
            // She steps off as the map arrives rather than hovering over the first move.
            if (window.Arya) setTimeout(() => window.Arya.hide(), 900);
        }, held);
    }

    // -------------------------------------------------------------------- raise
    /**
     * Cover the screen and name the dungeon that is coming through.
     *
     * A re-raise must not *fade in* over the very map it is meant to be hiding, so the
     * 500ms opacity transition is switched off for the show, the style is flushed so the
     * browser does not animate from the old value, and the transition is handed back
     * before the gate is lifted again.
     */
    function raise(name) {
        generation += 1;
        openHandlers = [];
        total = 0;
        settled = 0;
        opened = false;
        asked = false;
        started = Date.now();

        gate.style.transition = 'none';
        gate.classList.remove('is-open');
        void gate.offsetHeight;
        gate.style.transition = '';

        if (nameEl) nameEl.textContent = NAMES[name] || 'your dungeon';
        if (labelEl) labelEl.textContent = 'Unrolling the map…';
        if (countEl) countEl.textContent = '';
        if (barEl) barEl.style.width = '3%';

        clearTimeout(failsafe);
        failsafe = setTimeout(() => open('timeout'), MAX_MS);
        askArya();
    }

    /**
     * Watch everything the dungeon on screen is about to draw. `onReady` runs once, as
     * the gate lifts — that is where the engine puts the squad back down and starts the
     * run, so nothing fights behind a loading screen.
     */
    function follow(game, onReady) {
        if (typeof onReady === 'function') openHandlers.push(onReady);
        if (game && game.dungeon && game.dungeonRenderer) collect(game);
    }

    window.MapGate = { raise, follow, open, isUp: () => !opened };

    failsafe = setTimeout(() => open('timeout'), MAX_MS);
    poll = setInterval(() => {
        if (!asked) askArya();
        const game = window.game;
        if (!game || !game.dungeon || !game.dungeonRenderer || !game.videoElement) return;
        clearInterval(poll);
        poll = null;
        askArya();
        collect(game);
    }, TICK_MS);

    paint();
})();
