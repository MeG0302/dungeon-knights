/* ==========================================================================
   Arya — the dungeon gate keeper.

   One shared module for every surface of the game, legacy pages and the React
   Points Vault alike. Call it from anywhere:

       window.Arya.say('clear', { dungeon: 'Forgotten Crypts' });   // after clearing a dungeon
       window.Arya.say('enter', { dungeon: 'Void Rift' });          // a map was accepted
       window.Arya.say('mint',  { count: 3 });                      // knights summoned
              window.Arya.say('return');                                   // back on the Knights tab
       window.Arya.say('hold');                                     // a map is still loading

   Each kind picks its own portrait from /assets/arya/. She always rises from the
   lower middle, says her line in a speech bubble, and leaves on her own — she never
   pauses the game and never swallows a click (only the bubble is interactive).

   She also walks a newcomer through a page when asked. The caller supplies the steps
   (it is the only part that knows its own DOM), she drives the rest:

       window.Arya.tour('points', {
           steps: [
               { kind: 'think', mood: 'Welcome', text: 'First time? Let me explain.' },
               { kind: 'brace', text: 'Three floors.', target: '[data-arya="vault"]' },
           ],
       });

   while (window.Arya.hasSeenTour('points') === false). A step leaves its bubble up
   (no timer), dims the page around the element its `target` selector points at, and
   offers Back / Next / Skip. Finishing, skipping, and leaving the page mid-walkthrough
   are all remembered in localStorage, so **a walkthrough meant for newcomers runs once**
   and a returning player goes straight to the page.

   `force: true` is the opt-out, and it exists for the buttons rather than the pages: the
   Staking Vault's and the Points Program's footer "Ask Arya" controls pass it to replay
   the walkthrough on request, which is why being quiet by default costs the player
   nothing. A page's own automatic call should not pass it.
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
        // The second batch of expressions. `ready` and `alarm` are the two halves of
        // the wallet moment, `brace` is the fight being described, `think` narrates.
        ready: {
            file: 'arya-ready.png',
            mood: 'Sworn in',
            sound: 'deploy',
            text: (v) => `Your wallet is bound to the vault${v.rank ? ` — rank <strong>#${v.rank}</strong>` : ''}. What you earn here is yours, not this browser's.`,
        },
        alarm: {
            file: 'arya-alarm.png',
            mood: 'Hold on',
            text: () => 'There is no wallet in this browser, so the vault stays shut. Install MetaMask (or any Web3 wallet), reload, and I will bind it to your name.',
        },
        brace: {
            file: 'arya-brace.png',
            mood: 'Steel yourself',
            text: (v) => (v.dungeon
                ? `<strong>${v.dungeon}</strong> does not fight fair — and neither should you.`
                : 'They do not fight fair in there — and neither should you.'),
        },
        think: {
            file: 'arya-think.png',
            mood: 'Asking',
            text: () => 'Ask away — the rules are mine to explain.',
        },
        // The map gate's line (public/loading-gate.js). The alarmed pose is the right
        // one for it — hands up, "wait a moment" — and she is held until the dungeon's
        // art has arrived, so this one has no timer of its own.
        hold: {
            file: 'arya-alarm.png',
            mood: 'Hold on',
            text: () => 'Hold on, champion — the map is still coming through the gate. The monsters are waking and your knights are taking their places.',
        },
        // The wheel's two answers (app/redeem/client.js). The *page* passes the sentence, built
        // from the same table the reels read, so the card the middle reel stops on and the card
        // she names cannot drift apart; what these carry is the pose, the mood and the sound,
        // which is the part that is hers. Both poses are portraits she already had — `clear` for
        // a win, `alarm` for a miss — so dedicated happy/sad art is one filename each when it
        // arrives, and nothing else has to change.
        redeem_win: {
            file: 'arya-clear.png',
            mood: 'Winner',
            sound: 'rare_drop',
            text: () => 'That is a card, champion — your code is on the page. Redeem it well.',
        },
        redeem_lose: {
            file: 'arya-alarm.png',
            mood: 'No luck',
            text: () => 'Not this time. The reels answer to no one — spin again when the vault has paid you.',
        },
    };

    let root = null;
    let pop = null;
    let figure = null;
    let moodEl = null;
    let messageEl = null;
    let bubble = null;
    let tourBar = null;
    let tourDots = null;
    let spot = null;
    let spotTarget = null;
    let spotEl = null;
    let hideTimer = null;
    let lastKind = null;
    let lastAt = 0;
    let visible = false;

    // The walkthrough, if one is running. `say()` is ignored while it is (a page event
    // must not stomp the step being read, and a connect during the tour is exactly that
    // kind of event), and her bubble stops auto-hiding until it ends.
    let tour = null;

    // The portraits are 1.0–1.4 MB PNGs each, so they are fetched once and then kept by
    // the browser cache. Prefetching all four would put ~4.8 MB on every page load, so a
    // page warms only the line it is most likely to need; the rest arrive on first use.
    const PAGE_DEFAULT = {
        // The map gate speaks first here ("hold on"), then the completion modal — both
        // are certain enough to be worth warming, and two portraits is still less than
        // half of what prefetching all of them used to cost.
        '/game': ['hold', 'clear'],
        '/points': 'clear',    // the vault's last floor (or the newcomer's walkthrough)
        '/menu': 'return',     // greeted on arrival from a run
        '/mint': 'mint',       // summoned knights
        '/dungeons': 'enter',  // a map is about to be accepted
    };

    const prefetched = {};

    function warm(kind) {
        const saying = SAYINGS[kind];
        if (!saying || prefetched[saying.file]) return;
        const img = new Image();
        img.src = ASSETS + saying.file;
        prefetched[saying.file] = img;
    }

    function prefetchFor(kind) {
        if (SAYINGS[kind]) { warm(kind); return; }
        const fallback = PAGE_DEFAULT[location.pathname] || 'clear';
        if (Array.isArray(fallback)) fallback.forEach(warm);
        else warm(fallback);
    }

    // Pages declare the stylesheet themselves; this is the safety net for a page that
    // only loaded the script.
    function ensureStyles() {
        // Versioned like every other hand-written stylesheet in this project, so a CSS
        // edit is not swallowed by the browser cache. Bump on change.
        const href = '/css/arya.css?v=3';
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
            '<div class="arya-message"></div>' +
            '<div class="arya-tour" hidden>' +
            '<div class="arya-tour-dots" aria-hidden="true"></div>' +
            '<div class="arya-tour-actions">' +
            '<button class="arya-tour-btn" type="button" data-act="back">Back</button>' +
            '<button class="arya-tour-btn is-primary" type="button" data-act="next">Next</button>' +
            '<button class="arya-tour-btn is-ghost" type="button" data-act="skip">Skip</button>' +
            '</div>' +
            '</div>';
        moodEl = bubble.querySelector('.arya-mood');
        messageEl = bubble.querySelector('.arya-message');
        tourBar = bubble.querySelector('.arya-tour');
        tourDots = bubble.querySelector('.arya-tour-dots');
        // Her own click-to-dismiss must not swallow a step button, and the controls are
        // their own little toolbar inside the bubble.
        tourBar.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-act]');
            if (!btn) return;
            e.stopPropagation();
            advance(btn.dataset.act);
        });

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

        // During a walkthrough a stray click on her bubble must not dismiss the step
        // being read — the Skip button is the way out (and Escape still works).
        bubble.addEventListener('click', () => {
            if (!tour) hide();
        });
        window.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || !visible) return;
            if (tour) endTour();
            else hide();
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
        // Leaving the page mid-walkthrough counts as having seen it.
        if (tour) stopTour(true);
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
            // A walkthrough owns the bubble while it is running. A page event landing in
            // the middle of a step (connecting a wallet fires one) would otherwise wipe
            // the line the player is still reading.
            if (tour) return null;
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

    // ------------------------------------------------------------- walkthrough
    // A walkthrough is a list of steps the calling page hands in — it is the only part
    // that knows its own DOM. Each step names a selector; she dims everything else,
    // points at it, and offers Back / Next / Skip. Finishing or skipping is remembered
    // in localStorage, so a walkthrough meant for newcomers only ever runs for them.

    function tourKey(id) {
        return `dk_arya_tour_${id}`;
    }

    function hasSeenTour(id) {
        try { return localStorage.getItem(tourKey(id)) === '1'; } catch { return false; }
    }

    function markTourSeen(id) {
        try { localStorage.setItem(tourKey(id), '1'); } catch { /* private mode */ }
    }

    function forgetTour(id) {
        try { localStorage.removeItem(tourKey(id)); } catch { /* private mode */ }
    }

    function ensureSpot() {
        if (spot) return;
        spot = document.createElement('div');
        spot.id = 'arya-spot';
        spot.hidden = true;
        document.body.appendChild(spot);
        // Whatever she is pointing at can scroll away underneath her (a panel has its
        // own scrollbar, so this listens in the capture phase), so the hole follows it.
        window.addEventListener('scroll', () => placeSpot(), true);
        window.addEventListener('resize', () => {
            placeSpot();
            if (tour) seatForStep(spotEl);
        });
    }

    // She stands at the bottom of the middle of the screen, which is exactly where a
    // page's lower controls live — on the Points page her bubble covers the share and
    // referral rows she is talking about. When she would end up on top of the thing she
    // is pointing at, she steps to the other side instead.
    function seatForStep(el) {
        if (!bubble || !root) return;
        const vw = window.innerWidth;
        const centre = () => vw / 2 - bubble.offsetWidth / 2 - 6;
        if (!el) {
            root.style.setProperty('--arya-shift', '0px');
            return;
        }
        // Measure from a centred bubble, or a step after a step would be judged from
        // wherever the last one pushed her.
        root.style.setProperty('--arya-shift', '0px');
        const b = bubble.getBoundingClientRect();       // read forces the reflow
        const r = el.getBoundingClientRect();
        const crosses = Math.min(b.right, r.right) - Math.max(b.left, r.left) > 0
            && Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top) > 0;
        const limit = Math.max(0, centre());
        const sameSide = r.left + r.width / 2 < vw / 2;
        const shift = crosses ? (sameSide ? limit : -limit) : 0;
        root.style.setProperty('--arya-shift', `${Math.round(shift)}px`);
    }

    function placeSpot() {
        if (!spot) return;
        if (!spotTarget) { spot.hidden = true; return; }
        const el = document.querySelector(spotTarget);
        if (!el) { spot.hidden = true; return; }
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) { spot.hidden = true; return; }
        const pad = 6;
        spot.hidden = false;
        spot.style.top = `${Math.round(r.top - pad)}px`;
        spot.style.left = `${Math.round(r.left - pad)}px`;
        spot.style.width = `${Math.round(r.width + pad * 2)}px`;
        spot.style.height = `${Math.round(r.height + pad * 2)}px`;
    }

    function setSpot(target) {
        ensureSpot();
        spotTarget = target || null;
        spotEl = null;
        if (spotTarget) {
            const el = document.querySelector(spotTarget);
            // `nearest`, so a target that is already on screen does not yank the page.
            if (el && el.scrollIntoView) {
                spotEl = el;
                el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
        }
        // After the reflow the scroll above can cause, and un-hid (see showStep), so both
        // the hole and the step aside are measured from real layout.
        requestAnimationFrame(() => {
            placeSpot();
            if (tour) seatForStep(spotEl);
        });
    }

    function stepAt(i) {
        return (tour && tour.steps[i]) || null;
    }

    function paintDots() {
        if (!tourDots || !tour) return;
        if (tourDots.childElementCount !== tour.steps.length) {
            tourDots.innerHTML = '';
            for (let i = 0; i < tour.steps.length; i += 1) tourDots.appendChild(document.createElement('span'));
        }
        Array.prototype.forEach.call(tourDots.children, (dot, i) => {
            dot.className = i === tour.index ? 'is-on' : (i < tour.index ? 'is-done' : '');
        });
    }

    // A step may pick its expression at the moment it shows (the wallet step is alarmed
    // with no wallet, sworn-in with one), so `kind` is allowed to be a function.
    function stepKind(step) {
        let raw = step.kind;
        try {
            if (typeof raw === 'function') raw = raw(step.vars || {});
        } catch { raw = null; }
        return SAYINGS[raw] ? raw : 'think';
    }

    function stepText(step, saying) {
        const raw = step.text !== undefined ? step.text : saying.text;
        try {
            return typeof raw === 'function' ? raw(step.vars || {}) : raw;
        } catch { return ''; }
    }

    function showStep() {
        const step = stepAt(tour.index);
        if (!step) return;
        const kind = stepKind(step);
        const saying = SAYINGS[kind];
        prefetchFor(kind);

        figure.src = ASSETS + saying.file;
        moodEl.textContent = step.mood || saying.mood || '';
        messageEl.innerHTML = stepText(step, saying);
        bubble.classList.add('is-touring');
        tourBar.hidden = false;
        paintDots();

        const next = tourBar.querySelector('button[data-act="next"]');
        if (next) next.textContent = tour.index >= tour.steps.length - 1 ? 'Got it' : 'Next';
        const back = tourBar.querySelector('button[data-act="back"]');
        if (back) back.disabled = tour.index === 0;

        // Same order as sayNow: un-hide before measuring, so her step aside is computed
        // from real layout instead of a zero-width hidden subtree.
        const wasHidden = root.hidden;
        root.hidden = false;
        if (wasHidden) root.classList.add('is-instant');
        avoidDialog();
        if (wasHidden) requestAnimationFrame(() => root.classList.remove('is-instant'));
        pop.classList.remove('is-out');

        if (!visible) {
            visible = true;
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (visible) pop.classList.add('is-in');
                });
            });
        }

        // No timer while she is explaining — a step stays until the player moves on.
        clearTimeout(hideTimer);
        hideTimer = null;
        setSpot(step.target);

        // Warm the next portrait after this one has painted, so no step arrives blank,
        // but never make this step wait on a 1.3 MB decode.
        const ahead = stepAt(tour.index + 1);
        if (ahead) setTimeout(() => prefetchFor(stepKind(ahead)), 80);
    }

    function stopTour(seen) {
        if (!tour) return false;
        const id = tour.id;
        tour = null;
        if (seen !== false) markTourSeen(id);
        if (tourBar) tourBar.hidden = true;
        if (bubble) bubble.classList.remove('is-touring');
        setSpot(null);
        return true;
    }

    /** Move on, back, or give up. */
    function advance(act) {
        if (!tour) return;
        if (act === 'skip') { endTour('skip'); return; }
        if (act === 'back') {
            tour.index = Math.max(0, tour.index - 1);
            showStep();
            return;
        }
        if (tour.index >= tour.steps.length - 1) { endTour('done'); return; }
        tour.index += 1;
        showStep();
    }

    /** She lingers a beat after the last step, then leaves on her usual timer. */
    function endTour(reason) {
        if (!stopTour(true)) return null;
        clearTimeout(hideTimer);
        hideTimer = setTimeout(hide, 5000);
        return reason || 'done';
    }

    /**
     * Walk the page through a list of steps.
     * @param {string} id   the walkthrough's name, and the key it is remembered under
     * @param {{steps: Array<{kind?: string, text?: string|Function, mood?: string,
     *          target?: string, vars?: object}>, force?: boolean}} [opts]
     * @returns {boolean} whether she started
     */
    function startTour(id, opts) {
        const options = opts || {};
        const steps = (Array.isArray(options.steps) ? options.steps : []).filter(Boolean);
        if (!steps.length) return false;
        if (!options.force && hasSeenTour(id)) return false;
        // A second walkthrough cannot overlap the first.
        if (tour) stopTour(true);

        build();
        tour = { id, steps, index: 0 };
        showStep();
        return true;
    }

    // Leaving the tab mid-walkthrough is the likeliest way a player declines it — and the
    // only exit that runs no code of ours, so nothing above ever gets to mark it. A player
    // who closes the tour by closing the page has still seen it; coming back must not start
    // it over. `pagehide` fires for a normal navigation and for the back-forward cache,
    // unlike `unload`, which browsers increasingly skip.
    window.addEventListener('pagehide', () => {
        if (tour) stopTour(true);
    });

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
        tour: startTour,
        endTour,
        hasSeenTour,
        forgetTour,
        isTouring: () => !!tour,
        setFlag,
        takeFlag,
        isVisible: () => visible,
        KINDS: Object.keys(SAYINGS),
    };
})();
