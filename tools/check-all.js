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

    window.__check = {
        arya,
        assets,
        engine,
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
