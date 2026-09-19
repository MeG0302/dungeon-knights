/* ==========================================================================
   Arya — the dungeon gate keeper.

   One shared module for every surface of the game, legacy pages and the React
   Points Vault alike. Call it from anywhere:

       window.Arya.say('clear', { dungeon: 'Forgotten Crypts' });   // after clearing a dungeon
       window.Arya.say('enter', { dungeon: 'Void Rift' });          // a map was accepted
       window.Arya.say('mint',  { count: 3 });                      // knights summoned
       window.Arya.say('return');                                   // back on the Knights tab

   Each kind picks its own portrait from /assets/arya/. She always rises from the
   lower middle, says her line in a speech bubble, and leaves on her own — she never
   pauses the game and never swallows a click (only the bubble is interactive).
   ========================================================================== */

(function () {
    'use strict';

    const ASSETS = '/assets/arya/';
    const SHOW_MS = 8000;       // how long she stays once she has popped up
    const REPEAT_MS = 3500;     // the same line cannot fire twice inside this window

    // One portrait per moment, plus the words that go with it. `text` receives the
    // caller's vars, so a line can name the dungeon or the number of knights.
    const SAYINGS = {
        clear: {
            file: 'arya-clear.png',
            mood: 'Victory',
            text: (v) => (v.dungeon
                ? `<strong>${v.dungeon}</strong> is yours — the gate opens. Well fought, champion!`
                : 'The dungeon is yours — the gate opens. Well fought, champion!'),
        },
        enter: {
            file: 'arya-enter.png',
            mood: 'Battle ready',
            sound: 'deploy',
            text: (v) => (v.dungeon
                ? `${v.dungeon} lies beyond this gate. Steel yourself — I hold the door, you hold the line.`
                : 'The gate is open. Steel yourself — I hold the door, you hold the line.'),
        },
        mint: {
            file: 'arya-mint.png',
            mood: 'New recruit',
            sound: 'recruit',
            text: (v) => {
                const n = Number(v.count) || 1;
                return n > 1
                    ? `<strong>${n} new knights</strong> sworn to your banner. The hall grows stronger.`
                    : 'A <strong>new knight</strong> is sworn to your banner. The hall grows stronger.';
            },
        },
        return: {
            file: 'arya-return.png',
            mood: 'Come back soon',
            text: () => 'Back to the hall so soon? Your knights will keep the fire burning till the next run.',
        },
    };

    let root = null;
    let pop = null;
    let figure = null;
    let moodEl = null;
    let messageEl = null;
    let bubble = null;
    let hideTimer = null;
    let lastKind = null;
    let lastAt = 0;
    let visible = false;

    // The portraits are 1.0–1.4 MB PNGs each, so they are fetched once and then kept by
    // the browser cache. Prefetching all four would put ~4.8 MB on every page load, so a
    // page warms only the line it is most likely to need; the rest arrive on first use.
    const PAGE_DEFAULT = {
        '/game': 'clear',      // the completion modal is the next thing that happens here
        '/points': 'clear',    // the vault's last floor
        '/menu': 'return',     // greeted on arrival from a run
        '/mint': 'mint',       // summoned knights
        '/dungeons': 'enter',  // a map is about to be accepted
    };

    const prefetched = {};

    function prefetchFor(kind) {
        const key = SAYINGS[kind] ? kind : PAGE_DEFAULT[location.pathname] || 'clear';
        const file = SAYINGS[key].file;
        if (prefetched[file]) return;
        const img = new Image();
        img.src = ASSETS + file;
        prefetched[file] = img;
    }

    // Pages declare the stylesheet themselves; this is the safety net for a page that
    // only loaded the script.
    function ensureStyles() {
        // Versioned like every other hand-written stylesheet in this project, so a CSS
        // edit is not swallowed by the browser cache. Bump on change.
        const href = '/css/arya.css?v=1';
        if (document.querySelector(`link[href^="/css/arya.css"]`)) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        document.head.appendChild(link);
    }

    // The stylesheet goes in as soon as this script loads, so her first appearance is
    // already styled instead of flashing an unstyled bubble for a frame.
    ensureStyles();

    // Warming her portrait after the page has finished loading keeps it off the critical
    // path while still meaning she never pops up blank.
    if (document.readyState === 'complete') prefetchFor();
    else window.addEventListener('load', () => prefetchFor(), { once: true });

    function build() {
        if (root) return;
        root = document.createElement('div');
        root.id = 'arya-root';

        pop = document.createElement('div');
        pop.className = 'arya-pop';

        bubble = document.createElement('div');
        bubble.className = 'arya-bubble';
        bubble.setAttribute('role', 'status');
        bubble.setAttribute('aria-live', 'polite');
        bubble.title = 'Click to dismiss';
        bubble.innerHTML =
            '<button class="arya-close" type="button" aria-label="Dismiss">&#10005;</button>' +
            '<div class="arya-name"><span class="arya-dot"></span> Arya &middot; Gate Keeper<span class="arya-mood"></span></div>' +
            '<div class="arya-message"></div>';
        moodEl = bubble.querySelector('.arya-mood');
        messageEl = bubble.querySelector('.arya-message');

        const stage = document.createElement('div');
        stage.className = 'arya-stage';
        const halo = document.createElement('div');
        halo.className = 'arya-halo';
        figure = document.createElement('img');
        figure.className = 'arya-figure';
        figure.alt = 'Arya, the dungeon gate keeper';
        stage.appendChild(halo);
        stage.appendChild(figure);

        pop.appendChild(bubble);
        pop.appendChild(stage);
        root.appendChild(pop);
        document.body.appendChild(root);

        bubble.addEventListener('click', () => hide());
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && visible) hide();
        });
    }

    // She stands on top of a page's own bottom bar (the game's Deploy/Recall bar)
    // rather than in front of it.
    function seatAboveBottomBar() {
        const bar = document.querySelector('.control-bar, .dungeon-bottom');
        const h = bar ? bar.getBoundingClientRect().height : 0;
        root.style.setProperty('--arya-bottom', `${h > 8 ? Math.round(h - 6) : 0}px`);
    }

    // A dialog can be open when she arrives (the dungeon-clear modal, for instance),
    // and her speech bubble sits exactly where those buttons live. She is a spectator:
    // she steps aside rather than covering the Next Dungeon button. Dialogs without
    // buttons (a plain loading spinner) are left alone, so she still rises from the
    // middle in those moments.
    function avoidDialog() {
        const vw = window.innerWidth;
        let shift = 0;

        // Only a dialog the player must click through counts. A plain spinner can sit
        // under her; a panel full of buttons cannot.
        // NB: `position: fixed` elements report offsetParent === null even when they are
        // on screen, so visibility has to be judged from computed style and rect.
        let panel = null;
        document.querySelectorAll('.modal-backdrop, .modal-overlay, .loading-transition').forEach((dialog) => {
            if (panel) return;
            if (dialog.classList.contains('hidden')) return;
            const cs = getComputedStyle(dialog);
            if (cs.display === 'none' || cs.visibility === 'hidden') return;
            const candidate = dialog.querySelector('.modal') || dialog;
            if (!candidate.querySelector('button')) return;
            const r = candidate.getBoundingClientRect();
            if (r.width < 60 || r.height < 60) return;
            panel = candidate;
        });

        if (panel) {
            const rect = panel.getBoundingClientRect();
            const gutter = Math.max(rect.left, vw - rect.right);
            // A bubble too wide for the gutter would still sit on the dialog, so it is
            // narrowed to the space that actually exists beside it.
            root.style.setProperty('--arya-bubble-max', `${Math.max(190, Math.min(360, gutter - 26))}px`);
            const half = bubble.offsetWidth / 2 + 16;
            if (rect.left >= half) shift = rect.left - half - vw / 2;
            else if (vw - rect.right >= half) shift = rect.right + half - vw / 2;
            else if (vw - rect.right > rect.left) shift = rect.right + bubble.offsetWidth / 2 - vw / 2;
            else shift = rect.left - bubble.offsetWidth / 2 - vw / 2;
            // Never let the step aside push her off the screen.
            const limit = Math.max(0, vw / 2 - bubble.offsetWidth / 2 - 6);
            shift = Math.max(-limit, Math.min(limit, shift));
        } else {
            root.style.removeProperty('--arya-bubble-max');
        }

        root.style.setProperty('--arya-shift', `${Math.round(shift)}px`);
    }

    function hide() {
        if (!root || !visible) return;
        visible = false;
        clearTimeout(hideTimer);
        pop.classList.remove('is-in');
        pop.classList.add('is-out');
        setTimeout(() => {
            if (!visible && root) root.hidden = true;
        }, 420);
    }

    /**
     * Pop Arya up with one of the four lines.
     * @param {'clear'|'enter'|'mint'|'return'} kind
     * @param {{dungeon?: string, count?: number, message?: string, duration?: number}} [opts]
     */
    function say(kind, opts) {
        try {
            return sayNow(kind, opts);
        } catch (err) {
            // She is decoration. A bug in here must never take down the page that
            // called her — this threw out of the game's own dungeon-clear handler once.
            console.warn('[Arya] could not appear:', err);
            return null;
        }
    }

    function sayNow(kind, opts) {
        const saying = SAYINGS[kind];
        if (!saying) {
            console.warn(`[Arya] unknown line "${kind}"`);
            return null;
        }
        const vars = opts || {};
        const now = Date.now();
        // A page can fire the same event twice (a click handler plus a DOMContentLoaded
        // re-fire); the second one must not replay the whole entrance.
        if (kind === lastKind && now - lastAt < REPEAT_MS) return null;
        lastKind = kind;
        lastAt = now;

        build();
        seatAboveBottomBar();

        prefetchFor(kind);
        figure.src = ASSETS + saying.file;
        moodEl.textContent = saying.mood || '';
        messageEl.innerHTML = vars.message || saying.text(vars);

        // Un-hide BEFORE measuring: a hidden subtree has no layout, so the bubble would
        // report a width of 0 and she would be nudged aside by a bogus amount. This only
        // bit on the second and later appearances, which is exactly when it is easy to
        // miss. The sideways step is applied without a transition so she arrives already
        // in position instead of sliding across the screen.
        const wasHidden = root.hidden;
        root.hidden = false;
        if (wasHidden) root.classList.add('is-instant');
        avoidDialog();
        if (wasHidden) requestAnimationFrame(() => root.classList.remove('is-instant'));
        pop.classList.remove('is-out');

        if (saying.sound && window.audioManager && typeof window.audioManager.play === 'function') {
            try { window.audioManager.play(saying.sound); } catch { /* sound is optional */ }
        }

        if (visible) {
            // Already out: swap the line in place instead of replaying the whole rise.
            clearTimeout(hideTimer);
        } else {
            visible = true;
            // Next frame, so the slide-up transition actually runs.
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (visible) pop.classList.add('is-in');
                });
            });
        }

        clearTimeout(hideTimer);
        hideTimer = setTimeout(hide, vars.duration || SHOW_MS);
        return true;
    }

    // ---------------------------------------------------------------- flags
    // Small session helpers, used by the "left the game for the Knights tab" flow.
    function setFlag(name) {
        try { sessionStorage.setItem(`dk_arya_${name}`, '1'); } catch { /* private mode */ }
    }

    function takeFlag(name) {
        try {
            const key = `dk_arya_${name}`;
            const had = sessionStorage.getItem(key) === '1';
            if (had) sessionStorage.removeItem(key);
            return had;
        } catch { return false; }
    }

    window.Arya = {
        say,
        hide,
        setFlag,
        takeFlag,
        isVisible: () => visible,
        KINDS: Object.keys(SAYINGS),
    };
})();
