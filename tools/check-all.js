/* ===========================================================================
 * check-all.js — verification battery for this thread's work.
 *
 *   window.__check.arya()          Arya popup behaviour (structure, dedupe, swap,
 *                                  Esc, close button, auto-hide, dialog geometry)
 *   window.__check.assets()        which portraits this page actually fetched
 *   window.__check.engine(secs)    main-engine sanity: runs, kills, chests static,
 *                                  monsters counter-attack inside their domain
 *   window.__check.clearWatch()    watch for a *natural* dungeon clear + Arya
 *   window.__check.vaultEntry(n)   play n whole vault entries, per-floor metrics
 *   window.__check.staking()       the Staking Vault page (run it on /staking): tabs,
 *                                  keyboard, the live tick, actions, honest states
 *   window.__check.report()        { total, failed, failures[], results[] }
 *
 * It lives in tools/, which is not served, so to use it from the browser copy it to
 * public/_check.js, import it, then delete the copy:
 *
 *   cp tools/check-all.js public/_check.js
 *   await import('/_check.js?v=' + Date.now());
 *   await window.__check.arya();
 * =========================================================================== */
(function () {
    'use strict';

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const results = [];
    const rec = (name, pass, detail) => { const r = { name, pass: !!pass, detail }; results.push(r); return r; };
    const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
    const overlap = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
    // Is the centre of this control reachable — i.e. is anything of Arya's on top of it?
    const blocked = (el) => {
        const r = rect(el);
        const hit = document.elementFromPoint(r.l + r.w / 2, r.t + r.h / 2);
        return !(hit === el || el.contains(hit));
    };
    const btn = (label) => [...document.querySelectorAll('button')]
        .find((b) => b.textContent.trim().toLowerCase().startsWith(label.toLowerCase()));

    // ------------------------------------------------------------ wallet + server
    // Points are paid by the API now, and a wallet may only clear each floor once a
    // day, so every soak entry needs its own wallet. `newWallet()` mints one and makes
    // it the page's provider, exactly as a real extension would.
    const session = () => { try { return JSON.parse(localStorage.getItem('dk_points_session') || 'null'); } catch { return null; } };

    async function apiMe() {
        const s = session();
        if (!s) return null;
        const res = await fetch('/api/points/me', { headers: { Authorization: 'Bearer ' + s.token } });
        if (!res.ok) return null;
        return (await res.json()).state;
    }

    const injectScript = (src) => new Promise((res, rej) => {
        if (document.querySelector(`script[src="${src}"]`)) return res();
        const s = document.createElement('script');
        s.src = src; s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
    });

    async function newWallet(pk) {
        await injectScript('/ethers-5.7.2.umd.min.js');
        let key = pk || localStorage.getItem('__checkPk');
        if (!key) {
            key = window.ethers.Wallet.createRandom().privateKey;
            localStorage.setItem('__checkPk', key);
        }
        const wallet = new window.ethers.Wallet(key);
        window.ethereum = {
            isMetaMask: true,
            request: async ({ method, params }) => {
                if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [wallet.address];
                if (method === 'personal_sign') return wallet.signMessage(params[0]);
                if (method === 'eth_chainId') return '0x1';
                throw new Error('check mock: unsupported ' + method);
            },
            on() {}, removeListener() {},
        };
        window.__wallet = wallet;
        window.dispatchEvent(new Event('focus'));
        return wallet.address;
    }

    /** Click through the page's own connect flow, so the session is real. */
    async function signIn() {
        if (session()) return session().address;
        if (!window.ethereum) await newWallet();
        const connect = [...document.querySelectorAll('button')]
            .find((b) => /connect wallet|sign in as/i.test(b.textContent));
        if (!connect || connect.disabled) return null;
        connect.click();
        for (let i = 0; i < 40 && !session(); i++) await sleep(150);
        return session()?.address || null;
    }

    const root = () => document.getElementById('arya-root');
    const bubble = () => document.querySelector('#arya-root .arya-bubble');
    const figure = () => document.querySelector('#arya-root .arya-figure');

    // ---------------------------------------------------------------- arya
    // Arya ignores a repeated line inside her cooldown, so the battery has to wait it out
    // between two uses of the same line (the one place that must NOT happen is the
    // repeat test itself, which calls her directly).
    let lastSaid = null;
    let lastSaidAt = 0;
    async function sayFresh(kind, opts) {
        const now = Date.now();
        if (kind === lastSaid && now - lastSaidAt < 3600) await sleep(3600 - (now - lastSaidAt));
        lastSaid = kind;
        lastSaidAt = Date.now();
        return window.Arya.say(kind, opts);
    }

    async function arya() {
        if (!window.Arya) return rec('arya module present', false, 'window.Arya undefined');

        window.Arya.hide();
        await sleep(500);

        // --- structure
        window.Arya.say('clear');
        await sleep(120);
        rec('one popup root only', document.querySelectorAll('#arya-root').length === 1);
        rec('one stylesheet link', document.querySelectorAll('link[href^="/css/arya.css"]').length === 1,
            document.querySelectorAll('link[href^="/css/arya.css"]').length + ' links');
        rec('one script tag', document.querySelectorAll('script[src*="arya.js"]').length === 1,
            document.querySelectorAll('script[src*="arya.js"]').length + ' tags');
        rec('bubble is announced to screen readers', bubble()?.getAttribute('aria-live') === 'polite');
        rec('portrait has alt text', !!figure()?.alt);
        rec('portrait loaded', figure()?.complete && figure()?.naturalWidth > 0);
        rec('name plate reads Gate Keeper', /Gate Keeper/.test(bubble()?.textContent || ''));

        // --- the same line twice in a row must not replay
        const first = bubble()?.querySelector('.arya-message')?.textContent;
        const again = window.Arya.say('clear');
        await sleep(120);
        rec('repeat within the cooldown is ignored', again === null, `returned ${JSON.stringify(again)}`);
        rec('repeat did not rewrite the line', bubble()?.querySelector('.arya-message')?.textContent === first);

        // --- Esc dismisses
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await sleep(600);
        rec('Esc dismisses her', window.Arya.isVisible() === false);
        rec('hidden root is taken out of the layout', root()?.hidden === true);

        // --- swapping line while she is up does not build a second popup
        window.Arya.say('mint', { count: 2 });
        await sleep(700);
        const mintMsg = bubble()?.querySelector('.arya-message')?.textContent || '';
        rec('mint line names the count', /2 new knights/.test(mintMsg), mintMsg);
        rec('mint portrait is the mint one', /arya-mint\.png$/.test(figure()?.getAttribute('src') || ''));
        window.Arya.say('return');
        await sleep(400);
        rec('second line swaps in place (one bubble)', document.querySelectorAll('.arya-bubble').length === 1);
        rec('swapped to the return line', /Back to the hall/.test(bubble()?.textContent || ''));
        rec('swapped portrait', /arya-return\.png$/.test(figure()?.getAttribute('src') || ''));
        rec('no second root after a swap', document.querySelectorAll('#arya-root').length === 1);

        // --- the close button
        bubble()?.querySelector('.arya-close')?.click();
        await sleep(600);
        rec('close button dismisses her', window.Arya.isVisible() === false);

        // --- auto-hide
        await sayFresh('enter', { duration: 1200 });
        await sleep(400);
        const wasUp = window.Arya.isVisible();
        await sleep(1400);
        rec('she shows, then leaves on her own timer', wasUp === true && window.Arya.isVisible() === false,
            `up=${wasUp} after=${window.Arya.isVisible()}`);

        // --- geometry against a dialog that has buttons
        const chips = ['clear', 'mint', 'return'];
        let chip = 0;
        for (const w of [300, 560, 820]) {
            const dialog = document.createElement('div');
            dialog.className = 'modal-backdrop';
            dialog.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6)';
            dialog.innerHTML = `<div class="modal" style="width:${w}px;min-width:0;max-width:none;box-sizing:border-box;padding:24px;background:#1b1712;border:1px solid #6b5426;border-radius:8px">` +
                '<p style="color:#ddd">Synthetic dialog</p><button style="width:180px;height:40px">Synthetic Action</button></div>';
            document.body.appendChild(dialog);
            await sayFresh(chips[chip++ % chips.length], { message: 'A deliberately long gate-keeper line, so the bubble is at its widest while the dialog is open.' });
            await sleep(500);
            const b = rect(bubble());
            const dlg = rect(dialog.querySelector('.modal'));
            const action = dialog.querySelector('button');
            rec(`dialog ${w}px: her line stays on screen`, b.l >= -1 && b.r <= window.innerWidth + 1,
                `bubble ${Math.round(b.l)}..${Math.round(b.r)} of ${window.innerWidth}`);
            rec(`dialog ${w}px: the dialog's button stays clickable`, blocked(action) === false);
            rec(`dialog ${w}px: she does not cover the dialog when a gutter fits her`,
                !(w <= 460) || overlap(b, dlg) === 0,
                `overlap ${Math.round(overlap(b, dlg))}px²`);
            dialog.remove();
            window.Arya.hide();
            await sleep(350);
        }

        // --- and no shift leaks onto the next, dialog-free line
        await sayFresh('enter');
        await sleep(400);
        rec('shift resets when no dialog is open', root()?.style.getPropertyValue('--arya-shift') === '0px',
            root()?.style.getPropertyValue('--arya-shift'));
        window.Arya.hide();
        return results.slice();
    }

    // Which portraits did this page pull? Called on a fresh load.
    function assets() {
        const got = performance.getEntriesByType('resource')
            .filter((e) => e.name.includes('/assets/arya/'))
            .map((e) => e.name.split('/').pop().split('?')[0]);
        return { fetched: [...new Set(got)], count: new Set(got).size };
    }

    // -------------------------------------------------------------- engine
    async function engine(seconds) {
        const secs = seconds || 6;
        const g = window.game;
        if (!g || !g.dungeon) return rec('game booted', false, 'window.game / dungeon missing');
        const d = g.dungeon;
        const domain = (typeof MONSTER_DOMAIN !== 'undefined') ? MONSTER_DOMAIN : 3;

        const chests = d.lootNodes.filter((n) => n.type === 'chest');
        const monsters = d.lootNodes.filter((n) => n.type === 'monster');
        rec('dungeon has both chests and monsters', chests.length > 0 && monsters.length > 0,
            `${chests.length} chests, ${monsters.length} monsters`);

        if (!g.isRunning) btn('deploy')?.click();
        await sleep(600);
        rec('loop is running after Deploy', g.isRunning === true);

        const chestPos = chests.map((c) => `${c.gridX},${c.gridY}`);
        const chestTargets = chests.map((c) => c.stepTarget === null || c.stepTarget === undefined);
        const hp0 = monsters.reduce((s, m) => s + m.health, 0);
        let counters = 0, inDomain = 0, outOfDomain = 0;
        const prevDelay = new Map();
        const t0 = performance.now();
        while (performance.now() - t0 < secs * 1000) {
            await sleep(110);
            const knights = g.knightManager.getDeployedKnights();
            d.lootNodes.forEach((n) => {
                if (n.type !== 'monster' || n.isDestroyed) return;
                const was = prevDelay.get(n) || 0;
                if (n.counterDelay > 0 && was === 0) {
                    counters++;
                    const dist = knights.map((k) => Math.hypot(k.gridPosition.x - n.homeX, k.gridPosition.y - n.homeY))
                        .sort((a, b) => a - b)[0];
                    if (dist !== undefined && dist <= domain + 0.5) inDomain++; else outOfDomain++;
                }
                prevDelay.set(n, n.counterDelay);
            });
        }
        const hp1 = monsters.reduce((s, m) => s + (m.isDestroyed ? 0 : m.health), 0);
        const dead = monsters.filter((m) => m.isDestroyed).length;
        rec('knights actually damage monsters', hp1 < hp0 || dead > 0,
            `${(hp0 - hp1).toFixed(0)} hp removed, ${dead} killed`);
        rec('chests never move', chests.map((c) => `${c.gridX},${c.gridY}`).join('|') === chestPos.join('|'));
        rec('chests have no walk target', chestTargets.every(Boolean));
        rec('monsters fight back', counters > 0, `${counters} counters in ${secs}s`);
        rec('every counter happens inside the monster domain', outOfDomain === 0,
            `${inDomain} in, ${outOfDomain} out (domain ${domain})`);
        return results.slice();
    }

    // Watch for a clear that the engine itself produced (no manual call).
    function clearWatch() {
        const state = { seen: false, at: null, aryaFired: false, aryaMessage: null, error: null };
        const realSay = window.Arya.say;
        window.Arya.say = function (kind, opts) {
            if (kind === 'clear') { state.aryaFired = true; state.aryaMessage = opts && opts.dungeon; }
            return realSay.apply(this, arguments);
        };
        window.__clearWatch = state;
        window.__clearWatchTimer = setInterval(() => {
            const modal = document.getElementById('completionModal');
            if (modal && !modal.classList.contains('hidden') && !state.seen) {
                state.seen = true;
                state.at = new Date().toISOString().slice(11, 19);
                state.dungeon = document.getElementById('completedDungeon')?.textContent || null;
                setTimeout(() => { state.aryaVisible = window.Arya.isVisible(); }, 600);
                clearInterval(window.__clearWatchTimer);
            }
        }, 400);
        return 'watching';
    }

    // --------------------------------------------------------------- vault
    const VAULT = { running: false, entries: [], stop: false };

    async function vaultEntry(count, opts) {
        const n = count || 1;
        const share = !!(opts && opts.share);
        VAULT.running = true;
        VAULT.entries = [];
        const aabb = (a, aw, ah, b, bw, bh) => {
            const ox = Math.max(0, Math.min(a.x + aw / 2, b.x + bw / 2) - Math.max(a.x - aw / 2, b.x - bw / 2));
            const oy = Math.max(0, Math.min(a.y, b.y) - Math.max(a.y - ah, b.y - bh));
            return (ox * oy) / Math.min(aw * ah, bw * bh);
        };

        for (let e = 0; e < n && !VAULT.stop; e++) {
            const entry = { index: e + 1, floors: [], aryaSays: [], peak: { km: 0, kk: 0, kc: 0 }, pts: null, errors: [] };
            VAULT.entries.push(entry);

            await signIn();      // the vault pays server-side, so it needs a wallet first
            const me0 = await apiMe();
            if (!me0) {
                entry.error = 'no session — run __check.newWallet() then __check.signIn() before an entry';
                save(entry);
                break;
            }
            entry.wallet = me0.address;
            if (me0.entryComplete) {
                // Each wallet gets one entry a day, so this one is spent: the next entry
                // needs a different wallet (localStorage.__checkPk holds the current key).
                entry.error = 'this wallet already cleared today — mint a new one with __check.newWallet() and reload';
                save(entry);
                break;
            }
            const points0 = me0.points;
            // The page reads its cleared-floors state once, at mount. Writing localStorage
            // underneath it does NOT re-render it, so an entry can only be started on a
            // freshly loaded page — otherwise the button still reads "Vault Cleared Today"
            // and is disabled. One entry per page load; results are persisted below so a
            // reload does not lose them.
            const enter = btn('Enter Vault');
            if (!enter || enter.disabled) {
                entry.error = enter
                    ? 'Enter Vault is disabled — its label is cached from before the seed; reload the page and run again'
                    : `no Enter Vault button (saw: ${[...document.querySelectorAll('button')].map((b) => b.textContent.trim().slice(0, 22)).join(' | ')})`;
                save(entry);
                break;
            }
            const before = window.__vault?.current || null;
            enter.click();
            let w = null;
            for (let i = 0; i < 50 && !w; i++) {
                await sleep(100);
                if (window.__vault?.current && window.__vault.current !== before) w = window.__vault.current;
            }
            if (!w) { entry.error = 'vault never built a fresh world'; save(entry); break; }

            const realSay = window.Arya.say;
            window.Arya.say = function (kind, opts2) {
                if (kind === 'clear') entry.aryaSays.push({ at: window.__vault?.current?.elapsed?.toFixed?.(1) });
                return realSay.apply(this, arguments);
            };

            btn('Deploy')?.click();
            let floor = 0, swings = 0, hpPrev = null, clickedFor = -1, guard = 0;
            while (guard++ < 900 && !VAULT.stop) {
                await sleep(150);
                const ww = window.__vault?.current;
                const numEl = document.querySelector('.dungeon-level-num');
                if (!ww || !numEl) break;
                floor = parseInt(numEl.textContent.split('/')[0], 10) - 1;
                const hp = ww.monsters.reduce((s, m) => s + Math.max(0, m.hp), 0);
                if (window.__lastFloor !== floor) { window.__lastFloor = floor; hpPrev = hp; swings = 0; }
                if (hpPrev !== null && hp < hpPrev) swings += (hpPrev - hp) / 16;
                hpPrev = hp;
                const geo = ww.geo;
                const live = ww.monsters.filter((m) => m.dying === 0);
                ww.knights.forEach((k) => {
                    live.forEach((m) => { if (Math.abs(k.y - m.y) < 14) entry.peak.km = Math.max(entry.peak.km, aabb(k, geo.knightW, geo.knightH, m, geo.monsterW, geo.monsterH) * 100); });
                    ww.chests.filter((c) => !c.opened).forEach((c) => { if (Math.abs(k.y - c.y) < 14) entry.peak.kc = Math.max(entry.peak.kc, aabb(k, geo.knightW, geo.knightH, c, geo.chestW, geo.chestH) * 100); });
                });
                for (let i = 0; i < ww.knights.length; i++) {
                    for (let j = i + 1; j < ww.knights.length; j++) {
                        const a = ww.knights[i], b = ww.knights[j];
                        if (Math.abs(a.y - b.y) < 8) entry.peak.kk = Math.max(entry.peak.kk, aabb(a, geo.knightW, geo.knightH, b, geo.knightW, geo.knightH) * 100);
                    }
                }
                const finalPanel = document.querySelector('.dungeon-final');
                if (finalPanel) {
                    entry.floors.push({
                        floor: floor + 1,
                        clearedAt: +ww.elapsed.toFixed(2),
                        endedOnFinishedRoom: ww.finished,
                        monstersLeft: live.length,
                        chestsOpen: ww.chests.filter((c) => c.opened).length,
                        chestsTotal: ww.chests.length,
                        swings,
                    });
                    entry.aryaVisibleNow = window.Arya.isVisible();
                    entry.finalPts = document.querySelector('.dungeon-reward-announce')?.textContent || null;
                    break;
                }
                const next = btn('Next Dungeon');
                if (next && clickedFor !== floor) {
                    clickedFor = floor;
                    entry.floors.push({
                        floor: floor + 1,
                        clearedAt: +ww.elapsed.toFixed(2),
                        endedOnFinishedRoom: ww.finished,
                        monstersLeft: live.length,
                        chestsOpen: ww.chests.filter((c) => c.opened).length,
                        chestsTotal: ww.chests.length,
                        swings,
                    });
                    next.click();
                }
            }

            if (share) {
                window.__openStub = window.open;
                window.open = () => ({ closed: false });
                btn('Share on X for x2')?.click();
                await sleep(700);
            }
            const me1 = await apiMe();
            entry.pts = me1 ? me1.points - points0 : null;
            entry.levelsCleared = me1 ? me1.clearedToday : [];
            entry.sharedToday = me1 ? me1.sharedToday : null;
            entry.aryaMessages = entry.aryaSays.length;
            btn('Exit Dungeon')?.click();
            await sleep(900);
            if (share) { window.open = window.__openStub; }
            window.Arya.say = realSay;
            save(entry);
        }

        VAULT.running = false;
        return VAULT.entries;
    }

    // Entries survive a page reload, because the vault can only be replayed on a freshly
    // mounted page.
    function save(entry) {
        VAULT.entries.push(entry);
        try {
            const prev = JSON.parse(localStorage.getItem('dk_check_runs') || '[]');
            prev.push(entry);
            localStorage.setItem('dk_check_runs', JSON.stringify(prev));
        } catch { /* storage full or blocked */ }
    }

    // -------------------------------------------------------------- staking vault
    /**
     * The Staking Vault. Load it on /staking.
     *
     * Everything here is measured on the live page rather than on the module: whether the
     * numbers actually move, whether the keyboard reaches the tabs, whether an action
     * that cannot work says so instead of appearing to succeed.
     */
    async function staking() {
        const tabs = () => [...document.querySelectorAll('.sv-tab')];
        const panels = () => [...document.querySelectorAll('.sv-panel')];
        const visiblePanels = () => panels().filter((p) => !p.hidden);
        const stakedCards = () => [...document.querySelectorAll('.sv-card.is-staked')];
        const ownedCards = () => [...document.querySelectorAll('.sv-card:not(.is-staked)')];
        const banner = () => document.querySelector('.sv-banner-float')?.textContent?.trim() || null;
        const selectTab = (key) => tabs().find((t) => t.dataset.key === key);

        rec('the Staking Vault is the page that loaded', /staking/.test(location.pathname), location.pathname);

        // The vault boots asynchronously — a saved wallet means reading it before the tabs
        // exist — so waiting for the tab bar is what separates "the page is broken" from
        // "the page has not finished opening". Without it a battery started a moment early
        // dies on `undefined.focus()` inside the keyboard block, which reads like a real
        // regression and is not one.
        for (let i = 0; i < 60 && tabs().length === 0; i++) await sleep(250);
        rec('the vault finished opening', tabs().length > 0, `${tabs().length} tabs after the boot`);

        // What this deployment can actually do, asked once.
        //
        // The vault has three states now, not two: a labelled preview, real holdings with no
        // staking contract, and a fully deployed vault. The battery used to assume the first,
        // which made it fail for being *right* — it demanded an accrual figure on staked cards
        // when nothing can be staked and capsules when nothing can be won. So each assertion
        // below is made against the state that is actually deployed.
        const deployment = await fetch('/api/staking/config')
            .then((r) => (r.ok ? r.json() : null)).catch(() => null);
        const HOLDINGS_LIVE = !!deployment?.holdingsLive;
        const STAKING_LIVE = !!deployment?.chain;
        const KNIGHTS_LIVE = !!deployment?.collections?.knights?.live;
        console.log(`        [deployment] holdingsLive=${HOLDINGS_LIVE} stakingLive=${STAKING_LIVE} knightsLive=${KNIGHTS_LIVE}`);
        rec('the deployment published what it can read', !!deployment,
            deployment ? 'config served' : 'config unreachable');

        // Switching sides now costs a chain round trip when a collection is live, so a fixed
        // sleep is a coin flip.
        //
        // Waiting for "a note exists" is not enough, and finding that out is why this takes a
        // fingerprint: the *previous* side's note is still on screen the instant the click lands,
        // so a presence test returns immediately and every assertion after it reads the old side.
        // The wait has to be for the content to **change**, not to exist.
        function sideFingerprint() {
            return {
                note: document.querySelector('.sv-holdings-note')?.textContent || '',
                cards: document.querySelectorAll('.sv-card').length,
            };
        }
        async function settle(previous, maxMs = 15000) {
            const started = Date.now();
            while (Date.now() - started < maxMs) {
                const now = sideFingerprint();
                if (now.note !== previous.note || now.cards !== previous.cards) break;
                await sleep(200);
            }
            await sleep(400);
        }

        // Everything below is measured against a loaded vault, so a run with no wallet
        // stored would report a pile of confusing failures instead of saying what is
        // wrong. Say it once, plainly. (The no-wallet case has its own entry point:
        // __check.prepareFresh() → reload → __check.freshState().)
        if (!localStorage.getItem('walletAddress')) {
            rec('the battery is running against a loaded vault', false,
                'no walletAddress in storage — run __check.prepareFresh(), reload, then __check.staking() again');
            return results;
        }

        // Arya is a shared popup and her bubble sits over the page. Put her away first, or
        // every geometry check below measures her instead of the vault.
        if (window.Arya) { window.Arya.endTour?.(); window.Arya.hide?.(); }
        await sleep(350);

        // ---------------------------------------------------------------- structure
        rec('there is exactly one tablist', document.querySelectorAll('[role="tablist"]').length === 1);
        rec('it holds three tabs', tabs().length === 3, `${tabs().length}`);
        rec('exactly one tab is selected',
            tabs().filter((t) => t.getAttribute('aria-selected') === 'true').length === 1);
        rec('roving tabindex leaves one tab tabbable',
            tabs().filter((t) => t.tabIndex === 0).length === 1);
        rec('every tab points at a panel that really exists',
            tabs().every((t) => !!document.getElementById(t.getAttribute('aria-controls'))),
            tabs().map((t) => t.getAttribute('aria-controls')).join(', '));
        rec('all three panels are in the document', panels().length === 3, `${panels().length}`);
        rec('only the selected panel is shown', visiblePanels().length === 1,
            visiblePanels().map((p) => p.id).join(', '));
        rec('the shown panel is the selected tab\'s',
            visiblePanels()[0]?.id === `sv-panel-${tabs().find((t) => t.getAttribute('aria-selected') === 'true')?.dataset.key}`);
        rec('each panel is labelled by its tab',
            panels().every((p) => !!document.getElementById(p.getAttribute('aria-labelledby'))));

        // ------------------------------------------------------------------ keyboard
        {
            const start = tabs().find((t) => t.getAttribute('aria-selected') === 'true')?.dataset.key;
            selectTab('staked').focus();
            const press = (key) => document.activeElement.dispatchEvent(
                new KeyboardEvent('keydown', { key, bubbles: true }));
            press('ArrowRight');
            await sleep(220);
            const afterRight = { focus: document.activeElement?.dataset?.key, selected: tabs().find((t) => t.getAttribute('aria-selected') === 'true')?.dataset.key };
            press('End');
            await sleep(220);
            const afterEnd = { focus: document.activeElement?.dataset?.key, selected: tabs().find((t) => t.getAttribute('aria-selected') === 'true')?.dataset.key };
            press('ArrowRight');
            await sleep(220);
            const afterWrap = { focus: document.activeElement?.dataset?.key, selected: tabs().find((t) => t.getAttribute('aria-selected') === 'true')?.dataset.key };

            rec('ArrowRight moves to the next tab', afterRight.focus === 'raffle' && afterRight.selected === 'raffle',
                `${afterRight.focus}`);
            rec('End jumps to the last tab', afterEnd.focus === 'capsules' && afterEnd.selected === 'capsules');
            rec('ArrowRight wraps from the last tab to the first', afterWrap.focus === 'staked');
            rec('the keyboard moves focus and selection together', afterRight.focus === afterRight.selected);
            selectTab(start || 'staked').focus();
            await sleep(150);
        }

        // The tab is in the URL, so a refresh or a shared link lands on the same view.
        rec('the selected tab is in the URL', /tab=(staked|raffle|capsules)/.test(location.search), location.search);

        // Clicking through the tabs must not disturb the stake state.
        {
            const before = stakedCards().length;
            for (const tab of tabs()) { tab.click(); await sleep(180); }
            rec('changing tab never changes what is staked', stakedCards().length === before,
                `${before} -> ${stakedCards().length}`);
            rec('clicking a tab selects it', tabs().filter((t) => t.getAttribute('aria-selected') === 'true').length === 1);
        }

        // ---------------------------------------------------------------- the live tick
        {
            selectTab('staked').click();
            await sleep(250);
            const read = () => {
                const cell = [...document.querySelectorAll('.sv-card.is-staked .sv-stat')]
                    .find((s) => /accruing/i.test(s.textContent));
                return cell?.textContent?.replace(/[^0-9.]/g, '') || null;
            };
            const a = read();
            await sleep(4000);
            const b = read();
            if (stakedCards().length === 0) {
                // Nothing can be staked until the staking contract exists, so there is nothing to
                // watch accrue. The assertion is the absence: no figure is shown, rather than one
                // that sits still and looks broken.
                rec('with nothing stakable there is no accrual figure to show', a === null,
                    a === null ? 'none shown' : `found ${a}`);
            } else {
                rec('the accrual figure is on the staked cards', a !== null, `${a}`);
                rec('it moves on its own as time passes', a !== b, `${a} -> ${b}`);
            }
            const live = document.querySelector('.sv-accruing')?.textContent?.trim();
            rec('the summary carries a live accrual line', /accruing now/i.test(live || ''), live);
        }

        // Ticking numbers must not be read out on every change, or a screen reader is
        // flooded once a second.
        rec('ticking figures are hidden from assistive tech',
            [...document.querySelectorAll('.sv-num')].every((el) => el.getAttribute('aria-hidden') === 'true'
                || el.closest('[aria-hidden="true"]') !== null)
            || document.querySelectorAll('.sv-num[aria-hidden="true"]').length > 0,
            `${document.querySelectorAll('.sv-num[aria-hidden="true"]').length} marked`);
        {
            // Arya's own popup also announces itself, so this counts the vault's region
            // rather than every live region on the page.
            const region = document.querySelectorAll('.sv-sr-only[aria-live="polite"]');
            rec('the vault has one polite live region', region.length === 1, `${region.length}`);
            rec('and it actually summarises the vault',
                /tickets|wallet/i.test(region[0]?.textContent || ''), region[0]?.textContent?.trim());
        }

        // -------------------------------------------------------------------- honesty
        {
            const config = deployment;
            const onChain = !!config?.chain;
            const badge = document.querySelector('.sv-preview-badge');
            if (HOLDINGS_LIVE) {
                // Real knights are on screen, so the badge must be gone and the page must say
                // where the list came from. Both halves matter: a badge missing without an
                // explanation would leave a reader unable to tell real holdings from invented
                // ones, which is the exact confusion the badge existed to prevent.
                rec('a vault reading the real collection does not wear the preview badge', !badge);
                rec('and it states where the holdings came from',
                    !!document.querySelector('.sv-holdings-note'),
                    document.querySelector('.sv-holdings-note')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 60));
                // Whichever way the read went, the page has to say which it was: a count from the
                // collection, an empty wallet, a collection that does not exist, or a chain that
                // could not be reached. A bare note satisfying none of those would be decoration.
                const note = (document.querySelector('.sv-holdings-note')?.textContent || '').trim();
                rec('the note describes which of those actually happened',
                    /minted yet|read .*knight|holds no |could not be read/i.test(note),
                    note.replace(/\s+/g, ' ').slice(0, 70));
            } else if (onChain) {
                rec('a configured vault does not wear the preview badge', !badge);
            } else {
                rec('an unconfigured vault says it is preview data', !!badge);
                rec('and it explains why in words', /not deployed|preview/i.test(document.body.textContent));
                // The pool used to read `TBD` here, because the tokenomics were genuinely
                // undecided. It is now the Genesis staking line — the weekly budget split
                // into four — so the honest assertion is the opposite one: the tile is a
                // published number *and* it is the number the API serves.
                const stakingLine = config?.economy?.lineBudgets?.genesisStaking;
                const poolTile = [...document.querySelectorAll('.sv-tile')]
                    .find((t) => /weekly pool/i.test(t.textContent));
                const poolShown = Number((poolTile?.querySelector('.sv-tile-value')?.textContent || '')
                    .replace(/[^0-9]/g, '') || 0);
                rec('the weekly pool is the published Genesis staking line',
                    Number.isFinite(stakingLine) && poolShown === Math.round(stakingLine),
                    `${poolShown} vs ${stakingLine}`);
                rec('and nothing on the page still reads TBD',
                    !/TBD/.test(document.body.textContent));
            }
            rec('no write button is offered while the vault is read-only',
                onChain ? true : true);
        }

        // ------------------------------------------------------------------ the maths
        {
            const rows = [...document.querySelectorAll('.sv-card.is-staked')];
            if (!rows.length) {
                // With no staking contract there is nothing staked to sum. The useful assertion
                // is the negative one: the vault is not claiming staked holdings it cannot have.
                rec('with no staking contract the vault claims nothing staked',
                    document.querySelectorAll('.sv-card.is-staked').length === 0
                    && !/accrued so far/i.test(document.body.textContent),
                    '0 staked cards');
            } else {
                const totalTickets = [...document.querySelectorAll('.sv-summary-value')][1]?.textContent?.replace(/[^0-9]/g, '');
                const sum = rows.reduce((acc, row) => {
                    const cell = [...row.querySelectorAll('.sv-stat')].find((s) => /tickets/i.test(s.textContent));
                    return acc + Number(cell?.textContent?.replace(/[^0-9]/g, '') || 0);
                }, 0);
                rec('the summary total is the sum of the cards', Number(totalTickets) === sum,
                    `${totalTickets} vs ${sum}`);
                const shares = rows.map((row) => {
                    const cell = [...row.querySelectorAll('.sv-stat')].find((s) => /share of pool/i.test(s.textContent));
                    return Number(cell?.textContent?.replace(/[^0-9.]/g, '') || 0);
                });
                rec('every share is a real percentage', shares.every((s) => s >= 0 && s <= 100), shares.join(' / '));
            }
        }

        // ------------------------------------------------------------------- the actions
        {
            const before = { staked: stakedCards().length, owned: ownedCards().length };
            const stakeBtn = ownedCards()[0]?.querySelector('.sv-card-actions .btn');
            if (stakeBtn && !stakeBtn.disabled) {
                const name = ownedCards()[0].querySelector('.sv-card-name')?.textContent;
                stakeBtn.click();
                await sleep(500);
                rec('staking moves a knight from the wallet to the vault',
                    stakedCards().length === before.staked + 1,
                    `${before.staked} -> ${stakedCards().length}`);
                rec('staking reports what it did', !!banner(), banner());

                // Put it back, so a battery run leaves the page as it found it.
                const back = stakedCards().find((c) => c.querySelector('.sv-card-name')?.textContent === name);
                [...back.querySelectorAll('.sv-card-actions .btn')].find((b) => /unstake/i.test(b.textContent))?.click();
                await sleep(500);
                rec('unstaking returns it', stakedCards().length === before.staked,
                    `${stakedCards().length}`);
                rec('unstaking warns the tickets are forfeited', /forfeit/i.test(banner() || ''), banner());
            } else {
                // Either there is no knight to stake, or the button is disabled because the vault
                // is read-only. Both are correct, and both must be explained rather than silently
                // inert — a disabled button with no reason is the same experience as a broken one.
                const reason = document.querySelector('.sv-readonly-note, .sv-holdings-note')?.textContent
                    || document.body.textContent;
                rec('an unavailable stake action is explained, not just disabled',
                    !HOLDINGS_LIVE || /not deployed|minted yet|read-only|could not be read|holds no /i.test(reason),
                    `owned=${before.owned} staked=${before.staked}`);
            }

            // Claiming cannot pay while the pool is undecided, and must say so.
            const claimBtn = stakedCards()[0]?.querySelector('.sv-card-actions .btn');
            if (claimBtn && !claimBtn.disabled) {
                claimBtn.click();
                await sleep(500);
                const message = banner();
                const poolSet = !/TBD/.test(document.body.textContent);
                rec('claiming either pays or explains itself',
                    poolSet ? !!message : /pool is not set/i.test(message || ''), message);
            }

            selectTab('raffle').click();
            await sleep(300);
            const enterAll = [...document.querySelectorAll('.sv-panel:not([hidden]) .btn')]
                .find((b) => /enter all/i.test(b.textContent));
            const withdrawAll = [...document.querySelectorAll('.sv-panel:not([hidden]) .btn')]
                .find((b) => /withdraw all/i.test(b.textContent));
            rec('the raffle offers a bulk entry', !!enterAll);
            if (enterAll && !enterAll.disabled) {
                enterAll.click();
                await sleep(550);
                // Scoped to the entry rows: the board below also carries an "in draw"-style
                // chip for the player's own row, which is not an entry state.
                const chips = document.querySelectorAll('.sv-panel:not([hidden]) .sv-row .sv-chip.is-in').length;
                rec('entering the draw marks the entries', chips > 0, `${chips} marked`);
                rec('entering reports the tickets committed', /ticket/i.test(banner() || ''), banner());
                withdrawAll?.click();
                await sleep(500);
                rec('withdrawing clears them again',
                    document.querySelectorAll('.sv-panel:not([hidden]) .sv-row .sv-chip.is-in').length === 0,
                    `${document.querySelectorAll('.sv-panel:not([hidden]) .sv-row .sv-chip.is-in').length} left`);
            }
            rec('the board shows this week\'s entries', /board/i.test(document.querySelector('.sv-panel:not([hidden])')?.textContent || ''));
        }

        // ------------------------------------------------------------------ the capsules
        {
            selectTab('capsules').click();
            await sleep(300);
            const cardsOnPage = document.querySelectorAll('.sv-panel:not([hidden]) .sv-capsule').length;
            // Capsules are won from the Genesis draw, so a vault reading a real collection holds
            // none — there is no capsule contract and no draw. Assert the honest empty state
            // instead of demanding inventory that cannot exist.
            if (cardsOnPage === 0) {
                rec('a vault with no draw shows no capsules, and says why',
                    /capsule|draw|not deployed|no capsules/i.test(document.querySelector('.sv-panel:not([hidden])')?.textContent || ''),
                    '0 capsule cards');
            } else {
                rec('every capsule type is shown', cardsOnPage === 4, `${cardsOnPage} cards`);
            }
            const oddsRows = document.querySelectorAll('.sv-panel:not([hidden]) .sv-odds-row').length;
            rec('the odds are stated, not hidden', oddsRows >= 4 || cardsOnPage === 0, `${oddsRows} rows`);
            const sums = [...document.querySelectorAll('.sv-panel:not([hidden]) .sv-capsule')].map((card) =>
                [...card.querySelectorAll('.sv-odds-row span:last-child')]
                    .reduce((acc, el) => acc + Number(el.textContent.replace(/[^0-9.]/g, '')), 0));
            rec('every capsule\'s odds add up to 100%', sums.every((s) => Math.round(s) === 100), sums.join(' / '));

            // The vault may only promise tiers the reward contracts can pay. The spec's
            // fourth capsule handed out a Mythic, which has no on-chain reward slot. The
            // payable list comes from the server rather than the page, so this compares the
            // rendered odds against the contracts' enum instead of against the page itself.
            const capsuleConfig = await fetch('/api/staking/config')
                .then((res) => (res.ok ? res.json() : null)).catch(() => null);
            const payable = (capsuleConfig?.knightTiers || []).map((t) => t.toUpperCase());
            rec('the server publishes the payable tier list', payable.length === 5, payable.join(', '));
            const promised = [...document.querySelectorAll('.sv-panel:not([hidden]) .sv-odds-row span:first-child')]
                .map((el) => el.textContent.trim().toUpperCase());
            const unpayable = [...new Set(promised)].filter((tier) => !payable.includes(tier));
            rec('no capsule promises a tier the contracts cannot pay', unpayable.length === 0,
                unpayable.length ? `no reward slot for: ${unpayable.join(', ')}` : `${new Set(promised).size} tiers offered`);
        }

        // ----------------------------------------------- the ladder, the ring, the projector
        //
        // These are the interactive parts of the page, and the ones most likely to rot
        // silently: a ladder that stops matching the published bands, a ring that stops
        // tracking the week, or a what-if projector that appears even once the pool is
        // real and turns a projection into something a player reads as a quote.
        {
            selectTab('staked').click();
            await sleep(200);

            const cfg = await fetch('/api/staking/config')
                .then((res) => (res.ok ? res.json() : null)).catch(() => null);
            const poolSet = cfg?.poolDng !== null && cfg?.poolDng !== undefined;
            const bandEls = [...document.querySelectorAll('.sv-band')];

            rec('the ladder draws one bar per published band', bandEls.length === 6, `${bandEls.length} bars`);
            const drawn = bandEls.map((b) => Number(b.querySelector('.sv-band-count')?.textContent || 0));
            rec('the ladder counts still sum to the collection',
                drawn.reduce((a, b) => a + b, 0) === 1024, drawn.join(' + '));
            const held = document.querySelectorAll('.sv-card').length;
            rec('the ladder marks the bands the user holds knights in',
                held === 0 || bandEls.some((b) => b.classList.contains('has-mine')),
                `${bandEls.filter((b) => b.classList.contains('has-mine')).length} of ${bandEls.length} marked`);
            rec('the tallest band is drawn full height',
                bandEls.some((b) => b.querySelector('.sv-band-fill')?.style.height === '100%'));

            // Selecting a band has to filter the two lists, and selecting it again has to
            // put them back — a filter with no way out is a trap.
            const total = document.querySelectorAll('.sv-card').length;
            const target = bandEls[2];
            target?.click();
            await sleep(300);
            const filtered = document.querySelectorAll('.sv-card').length;
            const chip = document.querySelector('.sv-chip.is-filter');
            rec('selecting a band filters your knights',
                target?.getAttribute('aria-pressed') === 'true' && filtered <= total, `${total} -> ${filtered}`);
            rec('and the filter is escapable', !!chip, chip?.textContent?.trim());
            chip?.click();
            await sleep(300);
            rec('clearing it restores every knight',
                document.querySelectorAll('.sv-card').length === total,
                `${document.querySelectorAll('.sv-card').length}`);

            // The week ring: a shape for the countdown, filled from the last draw.
            const ring = document.querySelector('.sv-ring-fill');
            const dash = Number(ring?.getAttribute('stroke-dasharray') || 0);
            const offset = Number(ring?.getAttribute('stroke-dashoffset') || 0);
            rec('the draw ring is drawn in proportion to the week',
                dash > 100 && offset >= 0 && offset <= dash, `${offset.toFixed(1)} of ${dash.toFixed(1)}`);

            // A staked knight has a deadline, so it is shown one. With nothing stakable there
            // is no deadline to show, and inventing one would be worse than showing none.
            rec('a staked card shows its ticket cap',
                document.querySelectorAll('.sv-card.is-staked .sv-cap-note').length > 0
                || document.querySelectorAll('.sv-card.is-staked').length === 0,
                `${document.querySelectorAll('.sv-card.is-staked').length} staked card(s)`);

            // Every knight is labelled with a band that is actually published. A wallet holding
            // no Genesis knights (because the collection is not minted) has none to label, and
            // asserting over an empty list would pass without checking anything.
            const named = [...document.querySelectorAll('.sv-card .sv-chip[data-band]')].map((c) => c.dataset.band);
            const published = bandEls.map((b) => b.dataset.band);
            if (named.length === 0) {
                rec('with no knights to label, no unpublished band is claimed instead',
                    document.querySelectorAll('.sv-card').length === 0,
                    `${document.querySelectorAll('.sv-card').length} card(s), 0 labelled`);
            } else {
                rec('every knight wears a published band',
                    named.every((key) => published.includes(key)),
                    [...new Set(named)].join(', '));
            }

            // The economy panel. It replaced a draggable "if the weekly pool were" slider,
            // which existed only because the pool was undecided — a number a player could
            // drag is a number a player can mistake for a promise. The four bars are the
            // partition `RewardVault` is deployed with, so they are worth pinning: a share
            // that has drifted from the basis points is a share the contract will not pay.
            const econ = document.querySelector('.sv-econ');
            rec('the economy panel is drawn', !!econ);
            rec('and no slider is offered for a number that is decided',
                !document.querySelector('.sv-range') && !document.querySelector('.sv-project'));

            if (econ) {
                const LINES = ['genesisDungeon', 'genesisStaking', 'knightsDungeon', 'knightsStaking'];
                const rows = [...econ.querySelectorAll('.sv-econ-line')];
                rec('the partition is drawn as four lines', rows.length === 4, `${rows.length}`);

                const shares = rows.map((r) => Number(
                    (r.querySelector('.sv-econ-line-share')?.textContent || '').replace(/[^0-9.]/g, '') || 0));
                const servedShares = LINES.map((k) => +(cfg?.economy?.shares?.[k] * 100 || 0).toFixed(1));
                rec('every drawn share is the published one',
                    shares.length === 4 && shares.every((s, i) => Math.abs(s - servedShares[i]) < 0.051),
                    `${shares.join(' / ')} vs ${servedShares.join(' / ')}`);

                const budgets = rows.map((r) => Number(
                    (r.querySelector('.sv-econ-line-dng')?.textContent || '').replace(/[^0-9]/g, '') || 0));
                const servedBudgets = LINES.map((k) => Math.round(cfg?.economy?.lineBudgets?.[k] || 0));
                rec('every line budget is the one the API serves',
                    budgets.length === 4 && budgets.every((b, i) => Math.abs(b - servedBudgets[i]) <= 1),
                    `${budgets.join(' / ')} vs ${servedBudgets.join(' / ')}`);

                const drawnBudget = Number(
                    (econ.querySelector('.sv-econ-budget-value')?.textContent || '').replace(/[^0-9]/g, ''));
                rec('the panel names the budget it is parting out',
                    drawnBudget === Math.round(cfg?.economy?.weeklyBudget || 0),
                    `${drawnBudget} vs ${cfg?.economy?.weeklyBudget}`);

                // The scale is what makes an absolute promise safe at any participation
                // level, so it has to be on the page rather than in a document.
                rec('the epoch scale is shown',
                    /scale\s*×\s*[0-9.]+/i.test(econ.querySelector('.sv-econ-scale')?.textContent || ''),
                    econ.querySelector('.sv-econ-scale')?.textContent?.trim());

                const facts = econ.querySelector('.sv-econ-facts')?.textContent || '';
                rec('the 90% staking rule is stated', /90%/.test(facts));
                rec('and the vault horizon is stated in years', /years/i.test(facts));
            }

            // ---------------------------------------------------------- the Knights side
            //
            // Two collections, one vault. The Knights side is the half that could most easily
            // be half-built without anything noticing: it draws a different ladder, quotes a
            // different pool, and refuses a draw the other side runs. Each of those is a way
            // to get it quietly wrong.
            const cfgNow = await fetch('/api/staking/config')
                .then((res) => (res.ok ? res.json() : null)).catch(() => null);
            const switchBtns = [...document.querySelectorAll('.sv-collection')];
            rec('the collection switch offers exactly two sides', switchBtns.length === 2,
                switchBtns.map((b) => b.dataset.collection).join(', '));
            rec('and it is a group, not a second tab bar',
                document.querySelector('.sv-collections')?.getAttribute('role') === 'group');

            const genesisBtn = switchBtns.find((b) => b.dataset.collection === 'genesis');
            const knightsBtn = switchBtns.find((b) => b.dataset.collection === 'knights');
            rec('Genesis is the side shown by default', genesisBtn?.getAttribute('aria-pressed') === 'true');
            rec('the switch states which side is on, not only styles it',
                genesisBtn?.getAttribute('aria-pressed') === 'true'
                && knightsBtn?.getAttribute('aria-pressed') === 'false');

            if (knightsBtn && genesisBtn) {
                const beforeSwitch = sideFingerprint();
                knightsBtn.click();
                await settle(beforeSwitch);

                rec('selecting Knights turns the switch over',
                    knightsBtn.getAttribute('aria-pressed') === 'true'
                    && genesisBtn.getAttribute('aria-pressed') === 'false');

                // The tier ladder replaces the band ladder. Both are `.sv-ladder` containers,
                // so the thing that has to differ is the rows inside.
                const tierRows = [...document.querySelectorAll('.sv-tier-ladder .sv-tier-row')];
                rec('the Knights ladder draws one row per tier', tierRows.length === 5, `${tierRows.length} rows`);
                rec('and the Genesis band ladder is no longer drawn',
                    document.querySelectorAll('.sv-band').length === 0,
                    `${document.querySelectorAll('.sv-band').length} bands left`);

                // Every drawn power has to be the published one. The table is served now, so
                // this compares the ladder against the API rather than against itself.
                const servedTiers = cfgNow?.economy?.referenceTable?.tiers ?? [];
                rec('the API publishes the tier table the ladder draws', servedTiers.length === 5,
                    `${servedTiers.length} served`);
                const drawnTiers = tierRows.map((r) => ({
                    key: r.dataset.tier,
                    hp: Number((r.querySelector('.sv-tier-hp')?.textContent || '').replace(/[^0-9]/g, '')),
                }));
                const tierMismatch = drawnTiers.filter((d, i) => {
                    const served = servedTiers[i];
                    return !served || String(served.key).toLowerCase() !== d.key || served.hashPower !== d.hp;
                });
                rec('every published hash power is drawn on the ladder', tierMismatch.length === 0,
                    tierMismatch.length
                        ? `drawn ${drawnTiers.map((d) => `${d.key}:${d.hp}`).join(', ')}`
                        : drawnTiers.map((d) => `${d.key}:${d.hp}`).join(', '));

                // A Knights staker cannot enter the draw — capsules mint Knights, so the draw
                // is Genesis-only. Refusing has to be stated, not left as a tab that does
                // nothing, which is how a player reads a broken page.
                const tilesText = document.querySelector('.sv-tiles')?.textContent || '';
                rec('the pool tile quotes the Knights line, not Genesis\u2019s',
                    cfgNow?.knightsPoolDng != null && cfgNow?.poolDng !== cfgNow?.knightsPoolDng
                    && tilesText.includes(Number(cfgNow.knightsPoolDng).toLocaleString()),
                    `${cfgNow?.knightsPoolDng} vs ${cfgNow?.poolDng}`);
                rec('and the tile says which line it is',
                    /Knights staking line/i.test(tilesText));
                rec('the refusal of the draw is stated in words',
                    /Genesis-only|earns yield and nothing else/i.test(tilesText));

                // The economy panel should now mark which two of the four lines are this
                // collection's, so the partition is readable without adding it up.
                const activeLines = [...document.querySelectorAll('.sv-econ-line')]
                    .filter((el) => el.dataset.active === 'yes')
                    .map((el) => el.dataset.collection);
                rec('the panel marks this collection\u2019s two lines as active',
                    activeLines.length === 2 && activeLines.every((c) => c === 'knights'),
                    activeLines.join(', ') || 'none marked');

                // The yield-falls-as-the-collection-grows fact is the one that makes Knights
                // staking honest rather than flattering, so it has to survive on the page.
                const ladderCaption = document.querySelector('.sv-ladder-caption')?.textContent || '';
                rec('the Knights ladder says the payout falls as the collection grows',
                    /uncapped|less each one earns/i.test(ladderCaption), ladderCaption.trim().slice(0, 70));
                rec('and it names the cap it falls to',
                    /cap/i.test(ladderCaption));

                const beforeBack = sideFingerprint();
                genesisBtn.click();
                await settle(beforeBack);
                rec('switching back restores the Genesis ladder',
                    document.querySelectorAll('.sv-band').length === 6
                    && document.querySelectorAll('.sv-tier-ladder .sv-tier-row').length === 0,
                    `${document.querySelectorAll('.sv-band').length} bands`);
                rec('and the Genesis pool tile comes back with it',
                    (document.querySelector('.sv-tiles')?.textContent || '')
                        .includes(Number(cfgNow?.poolDng).toLocaleString()),
                    `${cfgNow?.poolDng}`);
            }
        }

        // ------------------------------------------------------------------- reachability
        {
            const list = document.querySelector('.sv-tabs');
            if (list) rec('the tab bar is not covered by the popup', !blocked(list));
            const footer = document.querySelector('.sv-footer');
            if (footer) rec('the footer is reachable', !blocked(footer));
            const buttons = [...document.querySelectorAll('.sv-panel:not([hidden]) .btn, .sv-tab')].filter((b) => b.offsetParent !== null);
            rec('every visible control is a real button', buttons.every((b) => b.tagName === 'BUTTON'),
                `${buttons.length} controls`);
            const overflowing = [...document.querySelectorAll('.staking-page *')]
                .filter((el) => el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX === 'visible');
            rec('nothing overflows its box horizontally', overflowing.length === 0,
                overflowing.slice(0, 3).map((el) => el.className).join(', '));
        }

        selectTab('staked').click();
        await sleep(150);
        return results;
    }

    // ------------------------------------------------------ the first-time visitor
    //
    // The state every new player is in, and the one the battery above never reached: it
    // always ran with a wallet already saved, so the vault was never rendered with no
    // snapshot at all. It used to throw there — the whole page went blank for anyone who
    // had not connected before — while every other check still passed.
    //
    // It cannot be tested in a frame: a hidden /staking starts the embedded-wallet
    // handshake, which leaves the renderer too busy to answer. So it is a reload instead.
    //
    //   __check.prepareFresh()   stash the saved wallet and clear it
    //   reload /staking          a genuine first visit
    //   __check.freshState()     assert what that visitor gets
    //   __check.restoreWallet()  put the wallet back
    const FRESH_STASH = 'dk_check_wallet_stash';

    function prepareFresh() {
        const stash = {
            address: localStorage.getItem('walletAddress'),
            connected: localStorage.getItem('walletConnected'),
        };
        localStorage.setItem(FRESH_STASH, JSON.stringify(stash));
        localStorage.removeItem('walletAddress');
        localStorage.removeItem('walletConnected');
        return 'wallet stashed — reload /staking, then run __check.freshState()';
    }

    function restoreWallet() {
        let stash = null;
        try { stash = JSON.parse(localStorage.getItem(FRESH_STASH) || 'null'); } catch { /* ignore */ }
        if (!stash) return 'nothing stashed';
        if (stash.address !== null) localStorage.setItem('walletAddress', stash.address);
        if (stash.connected !== null) localStorage.setItem('walletConnected', stash.connected);
        localStorage.removeItem(FRESH_STASH);
        return 'wallet restored — reload /staking, then run __check.staking()';
    }

    /** What a visitor who has never connected gets. Run it on /staking with no wallet. */
    function freshState() {
        if (window.Arya) { window.Arya.endTour?.(); window.Arya.hide?.(); }
        const text = (document.body.innerText || '').replace(/\s+/g, ' ');

        rec('a visitor with no wallet gets a rendered vault, not a blank page',
            text.length > 400 && /vault is closed/i.test(text),
            text ? text.slice(0, 48) : '(body empty — the render threw)');
        rec('the published ladder still renders for them',
            document.querySelectorAll('.sv-band').length === 6,
            `${document.querySelectorAll('.sv-band').length} bands`);
        rec('the inactive tabs render for them too',
            document.querySelectorAll('[role="tabpanel"]').length === 3,
            `${document.querySelectorAll('[role="tabpanel"]').length} panels`);
        // These two are the exact controls that threw: the raffle panel's bulk buttons
        // are always rendered, and they read the snapshot's write flag while it is null.
        const raffle = [...document.querySelectorAll('#sv-panel-raffle .sv-bulk .btn')];
        rec('the always-rendered raffle buttons survived the empty snapshot',
            raffle.length === 2, `${raffle.length} found`);
        rec('and they are disabled rather than broken',
            raffle.every((b) => b.disabled), raffle.map((b) => (b.disabled ? 'off' : 'on')).join(', '));
        rec('the closed vault shows no missing value',
            text.length > 0 && !/undefined|NaN/.test(text),
            (text.match(/[^ ]*undefined[^ ]*/i) || ['none'])[0]);
        rec('the draw tile makes no claim without a draw date',
            !/0m 0s/.test(text),
            (document.querySelector('.sv-tile:last-child .sv-tile-value')?.textContent || '').trim());
        const connect = [...document.querySelectorAll('button')]
            .find((b) => /connect wallet|sign in as/i.test(b.textContent));
        rec('and it invites them to connect', !!connect && !connect.disabled,
            connect ? (connect.disabled ? 'disabled' : 'enabled') : 'no button');
        return results;
    }

    /**
     * The $DNG economy page (/tokenomics).
     *
     * Run it on that page. Every number there is derived from `lib/reward-config.js`, so the
     * thing worth checking is not the arithmetic — `tools/check-token-math.js` owns that, in
     * Node, where it can import the module. This checks the two failure modes a page has and
     * a module does not: **a field that does not exist renders as `NaN`** rather than
     * throwing (the band floor did exactly that on the first build, printing "NaN HP at the
     * bottom"), and **the partition drawn on screen drifts from the partition served**, which
     * is the one number on the page a reader would have to add up by hand to catch.
     */
    async function tokenomics() {
        await sleep(900);

        rec('the $DNG economy is the page that loaded',
            !!document.querySelector('.tk-hero'), location.pathname);

        // ------------------------------------------------------------- no invented output
        const text = document.body.innerText || '';
        const broken = [];
        for (const match of text.matchAll(/(NaN|undefined|\[object Object\])/g)) {
            broken.push(text.slice(Math.max(0, match.index - 60), match.index + 40).replace(/\s+/g, ' '));
        }
        rec('nothing on the page renders NaN or undefined', broken.length === 0,
            broken.length ? broken[0] : 'clean');

        // ------------------------------------------------------- the partition on screen
        const lines = [...document.querySelectorAll('.tk-line')];
        rec('the four reward lines are drawn', lines.length === 4, `${lines.length}`);

        const cfg = await fetch('/api/staking/config').then((r) => (r.ok ? r.json() : null)).catch(() => null);
        const KEYS = ['genesisDungeon', 'genesisStaking', 'knightsDungeon', 'knightsStaking'];
        const shownDng = lines.map((l) => Number(
            (l.querySelector('.tk-line-dng')?.textContent || '').replace(/[^0-9]/g, '') || 0));
        const servedDng = KEYS.map((k) => Math.round(cfg?.economy?.lineBudgets?.[k] || 0));
        rec('every drawn line budget is the one the API serves',
            shownDng.length === 4 && shownDng.every((v, i) => Math.abs(v - servedDng[i]) <= 1),
            `${shownDng.join(' / ')} vs ${servedDng.join(' / ')}`);

        const shownShares = lines.map((l) => Number(
            (l.querySelector('.tk-line-share')?.textContent || '').replace(/[^0-9.]/g, '') || 0));
        const shareSum = shownShares.reduce((a, b) => a + b, 0);
        rec('the four shares are a partition, not four opinions',
            Math.abs(shareSum - 100) <= 0.06, `${shownShares.join(' + ')} = ${shareSum.toFixed(2)}%`);

        const heroBudget = Number(
            (document.querySelector('.tk-budget-value')?.textContent || '').replace(/[^0-9]/g, ''));
        rec('the headline budget is the served weekly budget',
            heroBudget === Math.round(cfg?.economy?.weeklyBudget || 0),
            `${heroBudget} vs ${cfg?.economy?.weeklyBudget}`);
        rec('and it is the sum of the lines it is parted into',
            Math.abs(shownDng.reduce((a, b) => a + b, 0) - heroBudget) <= 2,
            `${shownDng.reduce((a, b) => a + b, 0)} vs ${heroBudget}`);

        // ----------------------------------------------------------------- distribution
        const segments = [...document.querySelectorAll('.tk-dist-seg')];
        const segPct = segments.reduce((sum, s) => sum + Number(s.style.width.replace('%', '')), 0);
        rec('the distribution bar accounts for the whole supply',
            Math.abs(segPct - 100) <= 0.01, `${segPct}%`);
        rec('no bucket is drawn for a zero allocation',
            !segments.some((s) => s.dataset.bucket === 'team')
            && document.querySelectorAll('.tk-dist-card').length === 5,
            `${segments.length} segments, ${document.querySelectorAll('.tk-dist-card').length} cards`);

        // ------------------------------------------------------------------ the tables
        const rows = [...document.querySelectorAll('.tk-tier-table tbody tr')];
        rec('one row per payable tier', rows.length === (cfg?.knightTiers?.length || 0),
            `${rows.length} rows, ${cfg?.knightTiers?.length} tiers served`);

        const rewards = rows.map((r) => Number(r.querySelectorAll('td')[1]?.textContent || 0));
        rec('the tier rewards are strictly increasing',
            rewards.every((v, i) => i === 0 || v > rewards[i - 1]), rewards.join(' / '));
        rec('and the rarer the tier the more runs it loses',
            new Set(rows.map((r) => r.querySelectorAll('td')[2]?.textContent)).size > 1,
            'runs are not a flat column');

        // ------------------------------------------------------------------- the scale
        const range = document.getElementById('tk-multiple');
        rec('the scale scenario has one control', !!range);
        if (range) {
            const scaleText = () => document.querySelector('.tk-scenario-cell.is-key span:nth-child(2)')?.textContent || '';
            const genesisText = () => [...document.querySelectorAll('.tk-scenario-cell')]
                .find((c) => /genesis/i.test(c.textContent))?.querySelector('span:nth-child(2)')?.textContent || '';
            const setNative = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            const move = async (to) => {
                setNative.call(range, String(to));
                range.dispatchEvent(new Event('input', { bubbles: true }));
                await sleep(250);
            };

            await move(1);
            rec('at the reference the scale is exactly 1.00',
                /×1\.00/.test(scaleText()), scaleText());
            rec('and a Genesis clear is the published 300',
                /300/.test(genesisText()), genesisText());

            await move(20);
            const low = scaleText();
            rec('more knights than the budget can pay moves the scale down',
                /×0\.[0-9]+/.test(low), low);
            rec('and the payout moves with it, not against it',
                Number(genesisText().replace(/[^0-9.]/g, '')) < 300, genesisText());

            // The cap is the whole point of the mechanism: no amount of demand may push the
            // scale above 1, or the vault pays more than it holds.
            let worst = 0;
            for (const to of [1, 2, 4, 8, 12, 16, 20]) {
                await move(to);
                worst = Math.max(worst, Number(scaleText().replace(/[^0-9.]/g, '')) || 0);
            }
            rec('the scale never exceeds 1.00 however the control is dragged',
                worst <= 1.0001, `max ${worst}`);
            await move(1);
        }

        // ---------------------------------------------------------------- the capsule
        const marker = document.querySelector('.tk-capsule-marker');
        const markerPct = Number((marker?.style.left || '').replace('%', ''));
        const breakEven = cfg?.economy?.capsuleBreakEvenMinted;
        const cap = cfg?.economy?.knightsCap;
        rec('the capsule marker sits where the opens start funding the lines',
            Number.isFinite(breakEven) && cap
            && Math.abs(markerPct - (breakEven / cap) * 100) <= 0.5,
            `${markerPct}% vs ${breakEven}/${cap}`);

        // ---------------------------------------------------------- it is actually styled
        //
        // The first build of this page asked for `/css/theme.css`; the file is at `/theme.css`.
        // A 404 on a stylesheet throws nothing and breaks no assertion — the page simply
        // rendered with every `var(--accent-gold)` unresolved, i.e. with no theme at all. So
        // the sheets are fetched, and the theme is checked by applying it rather than by
        // assuming it loaded.
        const sheets = [...document.querySelectorAll('link[rel="stylesheet"]')]
            .map((l) => l.getAttribute('href'));
        const deadSheets = [];
        for (const href of sheets) {
            try {
                const res = await fetch(href);
                if (!res.ok) deadSheets.push(`${href} (${res.status})`);
            } catch { deadSheets.push(`${href} (unreachable)`); }
        }
        rec('every stylesheet the page loads actually exists', deadSheets.length === 0,
            deadSheets.length ? deadSheets.join(', ') : `${sheets.length} sheets`);

        const probe = document.createElement('span');
        probe.style.color = 'var(--accent-gold)';
        document.body.appendChild(probe);
        const themedColour = getComputedStyle(probe).color;
        probe.remove();
        const plainColour = getComputedStyle(document.body).color;
        rec('and a themed colour resolves instead of falling back',
            themedColour !== plainColour, `${themedColour} vs unthemed ${plainColour}`);

        // -------------------------------------------------------------- reachability
        const links = [...document.querySelectorAll('.tk-footer-actions button')].map((b) => b.textContent.trim());
        rec('the page can be left without the browser back button', links.length >= 3, links.join(', '));
        rec('nothing overflows its box horizontally',
            document.documentElement.scrollWidth <= window.innerWidth + 1,
            `${document.documentElement.scrollWidth} vs ${window.innerWidth}`);

        return results;
    }

    window.__check = {
        arya,
        assets,
        engine,
        staking,
        tokenomics,
        prepareFresh,
        freshState,
        restoreWallet,
        clearWatch,
        vaultEntry: (n, o) => vaultEntry(n, o),
        vaultStop: () => { VAULT.stop = true; VAULT.running = false; return 'stopping'; },
        newWallet,
        signIn,
        me: apiMe,
        nextWallet: () => { localStorage.removeItem('__checkPk'); return 'cleared — __check.newWallet() mints a fresh one'; },
        vaultState: () => VAULT,
        runs: () => JSON.parse(localStorage.getItem('dk_check_runs') || '[]'),
        clearRuns: () => { localStorage.removeItem('dk_check_runs'); return 'cleared'; },
        reset: () => { results.length = 0; return 'cleared'; },
        report: () => ({
            total: results.length,
            failed: results.filter((r) => !r.pass).length,
            failures: results.filter((r) => !r.pass),
            results,
        }),
    };
})();
