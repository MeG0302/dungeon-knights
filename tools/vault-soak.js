/* Points Vault soak harness — development only, never served or bundled.
 *
 * Drives whole vault entries on /points (Deploy / Next / Share / Exit, recall probes,
 * a mid-floor exit) while sampling the live room for movement invariants: sprites
 * standing inside each other, out-of-bounds knights, leaked effect arrays, wrong
 * payouts, dead floors.
 *
 * Usage: open /points, then paste the file into the console (it is not served, so the
 * browser cannot fetch it). It runs three entries on its own: 1 plain, 1 shared on X,
 * and 1 with a mid-floor Exit / re-entry. The vault's day is reset between entries.
 *
 * Read the results with window.__soak.summary(); stop early with window.__soak.stop().
 * The vault exposes its room as window.__vault (mirrors window.game in the main engine).
 */
(() => {
    const ASPECT = {
        knight: 0.889321468298109,
        monsters: [1.0755925688661114, 1.0660216277746157, 0.7550316273720529],
        chest: 1.166432584269663,
    };
    const DEPTH_TOLERANCE = 34;   // sprites whose feet are this close are on the same row
    const HARD_OVERLAP = 0.3;     // fraction of a knight sprite that has to collide to matter
    const CLICK_COOLDOWN = 1500;  // a stale completion button must not be double-clicked

    const S = (window.__soak = {
        run: true, phase: 'enter', entries: Number(window.__soakEntries || 3), entryNo: 0, levelLabel: '', cur: null, entry: null,
        floors: [], entryTotals: [], problems: [], recallTests: [], midExits: [],
        samples: 0, consoleErrors: 0, errors: [], lastClick: 0, sharePending: false, midExitDone: false, recallArmed: true,
        unresolvedFloors: [], unresolvedEntries: [],
        sameDepth: { kk: 0, km: 0, kc: 0 }, maxSameDepth: { kk: 0, km: 0, kc: 0 }, maxAny: { kk: 0, km: 0, kc: 0 },
    });
    const KEY = { '1/3': 100, '2/3': 300, '3/3': 500 };
    const P = (m) => { if (S.problems.length < 100) S.problems.push(m); };
    // Points live on the server now. `refreshMe()` polls them and everything else reads
    // the cached copy, because the tick loop is synchronous.
    let ME = null;
    const session = () => { try { return JSON.parse(localStorage.getItem('dk_points_session') || 'null'); } catch { return null; } };
    async function refreshMe() {
        const s = session();
        if (!s) { ME = null; return null; }
        const res = await fetch('/api/points/me', { headers: { Authorization: 'Bearer ' + s.token } });
        ME = res.ok ? (await res.json()).state : null;
        return ME;
    }
    const pts = () => (ME ? ME.points : null);
    const world = () => (window.__vault && window.__vault.current) || null;
    const byText = (re) => [...document.querySelectorAll('button')].find((b) => re.test(b.textContent.trim()));
    const txt = (sel) => { const e = document.querySelector(sel); return e ? e.textContent.trim() : ''; };
    const n = (v, d) => (Number.isFinite(v) ? +v.toFixed(d) : String(v));

    const origError = console.error;
    console.error = function (...a) {
        S.consoleErrors++;
        if (S.errors.length < 20) S.errors.push(a.map(String).join(' ').slice(0, 180));
        return origError.apply(console, a);
    };

    const rect = (o, aspect, h) => { const w = h * aspect; return { x1: o.x - w / 2, x2: o.x + w / 2, y1: o.y - h, y2: o.y }; };
    const area = (r) => (r.x2 - r.x1) * (r.y2 - r.y1);
    const overlap = (a, b) => {
        const ox = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
        const oy = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
        return ox > 0 && oy > 0 ? ox * oy : 0;
    };

    function pair(key, ra, rb, dy, label) {
        const frac = overlap(ra, rb) / area(ra);
        S.maxAny[key] = Math.max(S.maxAny[key], +frac.toFixed(3));
        if (Math.abs(dy) > DEPTH_TOLERANCE) return;   // renderer sorts by depth, so this is hidden
        S.sameDepth[key]++;
        S.maxSameDepth[key] = Math.max(S.maxSameDepth[key], +frac.toFixed(3));
        if (frac > HARD_OVERLAP) P(`${key} overlap ${(frac * 100).toFixed(0)}% same depth — ${label}`);
    }

    function sample(w) {
        S.samples++;
        const K = w.knights, M = w.monsters, C = w.chests;
        const scale = Math.min(1.25, Math.max(0.7, w.W / 1100));
        const knightH = 62 * scale, monsterH = 72 * scale, chestH = 40 * scale;
        [...K, ...M, ...C].forEach((o) => { if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) P('non-finite sprite position'); });
        K.forEach((k) => {
            if (k.x < 22 || k.x > w.W - 22 || k.y < w.floorTop - 1 || k.y > w.floorBottom + 1) P(`knight out of bounds (${n(k.x, 0)},${n(k.y, 0)})`);
        });
        for (let i = 0; i < K.length; i++) {
            for (let j = i + 1; j < K.length; j++) {
                pair('kk', rect(K[i], ASPECT.knight, knightH), rect(K[j], ASPECT.knight, knightH), K[i].y - K[j].y,
                    `knights ${i}/${j} d=${n(Math.hypot(K[i].x - K[j].x, K[i].y - K[j].y), 0)}`);
            }
        }
        K.forEach((k, ki) => M.forEach((m, mi) => {
            if (m.dying !== 0) return;
            pair('km', rect(k, ASPECT.knight, knightH), rect(m, ASPECT.monsters[m.art], monsterH), k.y - m.y,
                `knight ${ki} monster ${mi} target=${k.target === m} d=${n(Math.hypot(k.x - m.x, k.y - m.y), 0)}`);
        }));
        K.forEach((k, ki) => C.forEach((c) => {
            if (c.opened) return;
            pair('kc', rect(k, ASPECT.knight, knightH), rect(c, ASPECT.chest, chestH), k.y - c.y,
                `knight ${ki} chest target=${k.target === c} d=${n(Math.hypot(k.x - c.x, k.y - c.y), 0)}`);
        }));
        C.forEach((c) => { if (c.opened && c.__openAt === undefined) c.__openAt = n(w.elapsed, 2); });
        if (w.elapsed > 30) P('floor ran past its cap: ' + n(w.elapsed, 1));
        ['particles', 'slashes', 'spits', 'coins'].forEach((key) => { if (w[key].length > 2500) P(`${key} array unreleased (${w[key].length})`); });
        const f = S.cur;
        if (!f) return;
        f.samples++;
        f.lastElapsed = w.elapsed;
        f.chestsOpen = C.filter((c) => c.opened).length;
        f.chestsTotal = C.length;
        f.chestTimes = C.map((c) => c.__openAt).filter((v) => v !== undefined);
        f.monstersAlive = M.filter((m) => m.dying === 0).length;
        f.monstersTotal = M.length;
        f.seconds = +w.elapsed.toFixed(1);
    }

    function closeFloor(via, outcome) {
        const f = S.cur;
        if (!f) return;
        f.via = via;
        f.outcome = outcome || (f.lastElapsed >= 21.9 ? 'timeout' : 'clear');
        f.seconds = +f.lastElapsed.toFixed(1);
        f.awarded = null;                       // resolved on a later tick (see resolveAwards)
        f.awardOutcome = via === 'exit-mid' ? 'abort' : 'clear';
        S.unresolvedFloors.push(f);
        S.floors.push(f);
        S.cur = null;
    }

    /**
     * Payouts are decided by the API and land a moment after a floor or entry ends, so
     * they are resolved on later ticks rather than read from the clock that just stopped.
     * The amounts themselves are fixed by lib/points-config.js, so a mismatch means the
     * mini-game and the payout table have drifted apart.
     */
    function resolveAwards() {
        if (!ME) return;
        while (S.unresolvedFloors.length) {
            const f = S.unresolvedFloors.shift();
            f.awarded = ME.points - f.ptsStart;
            if (f.awardOutcome === 'abort') {
                if (f.awarded !== 0) P(`aborted floor ${f.floor} still paid ${f.awarded}`);
            } else if (f.pointsExpected !== undefined && f.awarded !== f.pointsExpected) {
                P(`floor ${f.floor} paid ${f.awarded}, expected ${f.pointsExpected}`);
            }
        }
        while (S.unresolvedEntries.length) {
            const e = S.unresolvedEntries.shift();
            e.gained = ME.points - e.ptsStart;
            S.entryTotals.push({ entry: e.entry, gained: e.gained, expected: e.expected, share: e.share });
            if (e.gained !== e.expected) P(`entry ${e.entry} paid ${e.gained}, expected ${e.expected}`);
        }
    }

    function openFloor(label) {
        S.cur = {
            entry: S.entryNo, floor: label, name: txt('.dungeon-level-name'), ptsStart: pts(), samples: 0,
            lastElapsed: 0, recallTested: false, pointsExpected: KEY[label],
        };
    }

    function closeEntry() {
        const e = S.entry;
        if (!e) return;
        e.gained = null;                        // resolved on a later tick
        e.expected = e.share ? 1800 : 900;
        S.unresolvedEntries.push(e);
    }

    S.summary = () => ({
        samples: S.samples, entryNo: S.entryNo, phase: S.phase, running: S.run,
        problems: [...new Set(S.problems)], recallTests: S.recallTests, midExits: S.midExits,
        sameDepth: S.sameDepth, maxSameDepth: S.maxSameDepth, maxAny: S.maxAny,
        entryTotals: S.entryTotals, consoleErrors: S.consoleErrors, errors: S.errors.slice(0, 6),
        floors: S.floors.map((f) => ({
            e: f.entry, f: f.floor, via: f.via, out: f.outcome, s: f.seconds, paid: f.awarded,
            chests: `${f.chestsOpen}/${f.chestsTotal}`, openedAt: f.chestTimes, seconds: f.seconds,
            alive: `${f.monstersAlive}/${f.monstersTotal}`, samples: f.samples, recallTested: f.recallTested,
        })),
    });
    S.stop = () => { S.run = false; clearInterval(S.tick); return S.summary(); };

    S.tick = setInterval(() => {
        if (!S.run) return;
        // Refresh the server's numbers in the background and settle any payout that has
        // landed since; the rest of the tick stays synchronous on purpose (it reads the
        // world every 300 ms and must not be delayed by the network).
        refreshMe().then(resolveAwards).catch(() => { /* keep the last known points */ });
        // Watchdog: if the floor is running and no Deploy control is available, we are not
        // waiting on the player — never stall in the deploy phase.
        if (S.phase === 'deploy') {
            const label = txt('.dungeon-level-num');
            const deployBtn = byText(/^Deploy$/i);
            if (label && (!deployBtn || deployBtn.disabled || deployBtn.offsetParent === null)) S.phase = 'fight';
        }
        const w = world();
        if (w && S.cur) sample(w);
        const levelNum = txt('.dungeon-level-num');
        if (levelNum && levelNum !== S.levelLabel) {
            closeFloor('level-advanced');
            S.levelLabel = levelNum;
            openFloor(levelNum);
            S.recallArmed = true;
        }
        const enter = byText(/Enter Vault/i);
        const deploy = byText(/^Deploy$/i);
        const recall = byText(/^Recall$/i);
        const next = byText(/Next Dungeon/i);
        const exitDungeon = byText(/Exit Dungeon/i);
        const share = byText(/Share on X/i);
        const exitControl = byText(/^Exit$/i);
        const cold = Date.now() - S.lastClick > CLICK_COOLDOWN;

        if (S.phase === 'enter') {
            if (enter && !enter.disabled && cold) {
                S.entryNo++;
                S.levelLabel = '';
                S.sharePending = S.entryNo % 2 === 0;
                S.midExitDone = false;
                S.cur = null;
                S.entry = { entry: S.entryNo, ptsStart: pts(), share: S.sharePending };
                S.lastClick = Date.now();
                enter.click();
                S.phase = 'deploy';
            }
            return;
        }
        if (S.phase === 'deploy') {
            if (deploy && !deploy.disabled && cold) {
                S.lastClick = Date.now();
                deploy.click();
                S.phase = 'fight';
            }
            return;
        }
        if (S.phase === 'recalltest') {
            const held = Date.now() - S.recallStart.at;
            if (held < 2000) return;
            const moved = w ? +(w.elapsed - S.recallStart.elapsed).toFixed(3) : null;
            S.recallTests.push({ floor: S.levelLabel, heldMs: held, movedWhileHeld: moved, timerText: txt('.dungeon-timer-text') });
            if (moved !== 0) P(`clock kept running while recalled (${moved}s)`);
            if (S.cur) S.cur.recallTested = true;
            if (deploy && !deploy.disabled) { S.lastClick = Date.now(); deploy.click(); S.phase = 'fight'; }
            return;
        }
        // fighting
        if (next && cold && w && w.elapsed > 0.6) {
            closeFloor('next');
            S.recallArmed = true;
            S.lastClick = Date.now();
            next.click();
            // "Next Dungeon" deploys the following floor itself, so there is no Deploy
            // click to wait for; go straight back to fighting.
            S.phase = 'fight';
            return;
        }
        if (exitDungeon) {
            closeFloor('final');
            if (S.sharePending && share && !share.disabled && cold) {
                S.sharePending = false;
                S.lastClick = Date.now();
                share.click();
                return;
            }
            if (!cold) return;
            closeEntry();
            S.lastClick = Date.now();
            exitDungeon.click();
            S.phase = 'enter';
            // One entry per wallet per day is now a server rule, not a localStorage
            // value the harness can clear. Running further entries means signing in a
            // fresh wallet (tools/check-all.js has `newWallet()` for that) and reloading,
            // so the soak stops here and says so instead of looping forever on a locked
            // "Vault Cleared Today" button.
            if (S.entryNo >= S.entries) {
                S.run = false;
                clearInterval(S.tick);
                S.entryLimit = `stopped after ${S.entryNo} entr${S.entryNo === 1 ? 'y' : 'ies'} — this wallet is spent for today (server-enforced)`;
            }
            return;
        }
        if (S.entryNo === 3 && !S.midExitDone && exitControl && cold && w && w.elapsed > 5 && S.levelLabel === '2/3') {
            S.midExitDone = true;
            S.midExits.push({ entry: S.entryNo, atSeconds: n(w.elapsed, 1), pointsAtExit: pts() });
            closeFloor('exit-mid', 'aborted');
            S.lastClick = Date.now();
            exitControl.click();
            S.phase = 'enter';
            return;
        }
        if (recall && !recall.disabled && S.recallArmed && cold && w && w.elapsed > 3 && w.elapsed < 9) {
            S.recallArmed = false;
            S.recallStart = { elapsed: w.elapsed, at: Date.now() };
            S.lastClick = Date.now();
            recall.click();
            S.phase = 'recalltest';
        }
    }, 300);

    window.open = () => null;   // keep the share popup from opening a tab
    return S;
})();
