/* ===========================================================================
 * gate-check.js — tests for public/loading-gate.js
 *
 *   node tools/gate-check.js
 *
 * The gate holds the map until the chosen dungeon's art has arrived, and it runs
 * before any framework is up, so it is verified here against a stub DOM and stub
 * timers rather than by watching a browser: a real local load finishes in under two
 * seconds, which is exactly the window it is hard to catch by hand. What matters is
 * the parts that are invisible when they work —
 *
 *   · it waits for the chosen dungeon's chest, monsters and squad tiers, and for the
 *     map video's first frame;
 *   · a failed or already-complete asset settles immediately (it can never hang);
 *   · it opens once, and only once;
 *   · a page with no gate is left alone entirely;
 *   · and the failsafe opens it even if the engine never turns up.
 * =========================================================================== */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'loading-gate.js'), 'utf8');
let failures = 0;
const results = [];

function ok(name, pass, detail) {
    results.push({ name, pass: !!pass, detail });
    if (!pass) failures += 1;
}

// ------------------------------------------------------------------ fake DOM
function fakeEl(id) {
    const classes = new Set();
    return {
        id,
        hidden: false,
        style: {},
        textContent: '',
        removed: false,
        listeners: {},
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            contains: (c) => classes.has(c),
        },
        addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
        remove() { this.removed = true; },
        fire(ev) { (this.listeners[ev] || []).forEach((fn) => fn()); },
    };
}

class FakeImage {
    constructor() {
        FakeImage.made.push(this);
        this.complete = false;
        this.src = '';
        this.listeners = {};
    }
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
    fire(ev) { (this.listeners[ev] || []).forEach((fn) => fn()); }
    finish() { this.complete = true; this.fire('load'); }
}
FakeImage.made = [];

function fakeTimers() {
    let now = 0;
    let seq = 0;
    const timers = new Map();
    return {
        now: () => now,
        set(fn, ms, repeat) { const id = ++seq; timers.set(id, { fn, at: now + (ms || 0), every: repeat ? (ms || 1) : 0 }); return id; },
        clear(id) { timers.delete(id); },
        advance(ms) {
            const target = now + ms;
            for (;;) {
                let next = null;
                timers.forEach((t, id) => { if (t.at <= target && (!next || t.at < next.t.at)) next = { id, t }; });
                if (!next) break;
                now = next.t.at;
                if (next.t.every) next.t.at = now + next.t.every;
                else timers.delete(next.id);
                next.t.fn();
            }
            now = target;
        },
    };
}

// --------------------------------------------------------------- harness run
/**
 * @param {{selected?: string, squad?: Array, gateInDom?: boolean, completeImages?: boolean,
 *          failImages?: boolean, engine?: boolean, videoReady?: number, arya?: boolean}} opts
 */
function run(opts = {}) {
    const timers = fakeTimers();
    const elements = {};
    const ids = ['mapLoadingGate', 'mapGateName', 'mapGateLabel', 'mapGateBar', 'mapGateCount'];
    ids.forEach((id) => { elements[id] = fakeEl(id); });
    if (opts.gateInDom === false) delete elements.mapLoadingGate;

    // Reset BEFORE the renderer is built — its images are what the gate has to wait for.
    FakeImage.made = [];

    const video = fakeEl('dungeonBackground');
    video.readyState = opts.videoReady === undefined ? 0 : opts.videoReady;

    const renderer = {
        floorTiles: { void: gateImages(opts), crypts: gateImages(opts) },
        decorationSprites: { void: gateImages(opts) },
        chestImages: { void: gateImages(opts) },
        monsterImages: { 'monsters/void rift/a.png': gateImages(opts), 'monsters/void rift/b.png': gateImages(opts) },
        knightImages: { LEGENDARY: gateImages(opts), COMMON: gateImages(opts), MYTHIC: gateImages(opts) },
    };
    function gateImages(o) {
        const img = new FakeImage();
        img.isGateArt = true;
        if (o.completeImages) img.complete = true;
        if (o.failImages) img.fail = true;
        return img;
    }

    const game = {
        selectedDungeon: 'void',
        videoElement: video,
        dungeonRenderer: renderer,
        dungeon: {
            config: { name: 'Void Rift', monsterFolder: 'void rift', monsters: ['a.png', 'b.png'] },
            decorations: [{ imagePath: 'assets/void/obstacle-1.png' }, { imagePath: 'assets/void/obstacle-1.png' }, { imagePath: 'assets/void/obstacle-2.png' }],
        },
    };

    const aryaCalls = [];
    const win = { Arya: opts.arya === false ? undefined : { say: (kind, o) => aryaCalls.push({ kind, o }), hide: () => aryaCalls.push({ kind: 'hide' }) } };
    if (opts.engine !== false) win.game = game;

    const storage = { selectedDungeon: opts.selected === undefined ? 'void' : opts.selected, selectedKnights: JSON.stringify(opts.squad === undefined ? [{ rarity: { tier: 'LEGENDARY' } }, { rarity: 'COMMON' }] : opts.squad) };

    const document = {
        getElementById: (id) => elements[id] || null,
        querySelector: () => null,
    };

    // eslint-disable-next-line no-new-func
    new Function('window', 'document', 'localStorage', 'Image', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'console', SRC)(
        win, document, { getItem: (k) => (k in storage ? storage[k] : null) }, FakeImage,
        (fn, ms) => timers.set(fn, ms, false), (fn, ms) => timers.set(fn, ms, true),
        (id) => timers.clear(id), (id) => timers.clear(id), { warn: () => {}, log: () => {} },
    );

    // Finish everything the gate is waiting on: the map video's first frame, the art the
    // renderer preloaded, and the obstacle images the module fetches for itself.
    const settleAll = () => {
        if (!video.complete) { video.readyState = 3; video.complete = true; video.fire('loadeddata'); }
        FakeImage.made.forEach((img) => { if (!img.complete) { img.complete = true; img.fire('load'); } });
    };

    const state = () => ({
        open: elements.mapLoadingGate.classList.contains('is-open'),
        removed: elements.mapLoadingGate.removed,
        count: elements.mapGateCount.textContent,
        label: elements.mapGateLabel.textContent,
        bar: elements.mapGateBar.style.width,
        videoReady: video.readyState,
        images: FakeImage.made.map((i) => (i.isGateArt ? 'art' : 'owned') + (i.complete ? ':done' : ':wait')),
    });

    return { elements, video, renderer, game, aryaCalls, timers, win, settleAll, images: FakeImage.made, state };
}

// ------------------------------------------------------------------- cases
// 1. Every tag on the page: it opens as soon as the art is there, once.
{
    const h = run({ completeImages: true, videoReady: 3 });
    h.timers.advance(300);
    const gate = h.elements.mapLoadingGate;
    ok('complete art: gate still up while it holds the minimum', !gate.classList.contains('is-open'), JSON.stringify(h.state()));
    h.settleAll();
    h.timers.advance(2500);
    ok('complete art: gate opens', gate.classList.contains('is-open'), JSON.stringify(h.state()));
    ok('complete art: it is removed after the fade', gate.removed, JSON.stringify(h.state()));
    ok('it asked Arya exactly once, with the hold line', h.aryaCalls.filter((c) => c.kind === 'hold').length === 1);
    ok('Arya is held, not timed out quickly', h.aryaCalls[0] && h.aryaCalls[0].o.duration > 15000);
    ok('she is taken down when the map arrives', h.aryaCalls.some((c) => c.kind === 'hide'));
    ok('the label says the gate is open', h.elements.mapGateLabel.textContent === 'The gate is open.');
    ok('the bar ends full', h.elements.mapGateBar.style.width === '100%');
    ok('it named the chosen dungeon', h.elements.mapGateName.textContent === 'Void Rift');
}

// 2. The real case: art that is still on the wire must keep the gate shut.
{
    const h = run({});
    h.timers.advance(2000);
    const gate = h.elements.mapLoadingGate;
    ok('loading art: gate stays up', !gate.classList.contains('is-open') && !gate.removed);
    ok('loading art: the bar is short of full', parseInt(h.elements.mapGateBar.style.width, 10) < 100);
    ok('loading art: progress is counted', /^\d+ \/ \d+$/.test(h.elements.mapGateCount.textContent));

    // Everything but the last asset: still shut.
    const waiters = FakeImage.made.slice();
    waiters.slice(0, -1).forEach((img) => { img.complete = true; img.fire('load'); });
    h.video.readyState = 3;
    h.video.complete = true;
    h.video.fire('loadeddata');
    h.timers.advance(300);
    ok('loading art: one asset left keeps it shut', !gate.classList.contains('is-open'));

    const last = waiters[waiters.length - 1];
    last.complete = true;
    last.fire('load');
    h.timers.advance(2600);
    ok('loading art: opens once the last asset settles', gate.classList.contains('is-open'), JSON.stringify(h.state()));
    ok('loading art: and only then', gate.removed, JSON.stringify(h.state()));

    // The obstacle art the renderer used to allocate on its first frame is waited for
    // too, deduplicated, which is what stops it popping in after the map appears.
    const own = FakeImage.made.filter((i) => !i.isGateArt);
    ok('it fetches the obstacle art itself', own.length === 2, `${own.length} distinct obstacle images`);
}

// 3. Something that never loads must not trap the player.
{
    const h = run({});
    h.timers.advance(20000);
    ok('failsafe: the gate opens anyway', h.elements.mapLoadingGate.classList.contains('is-open'));
}

// 4. A broken asset counts as settled — the engine degrades on its own.
{
    const h = run({});
    h.timers.advance(200);
    h.video.readyState = 3;
    h.video.complete = true;
    h.video.fire('loadeddata');
    FakeImage.made.forEach((img) => { img.complete = true; img.fire('error'); });
    h.timers.advance(1600);
    ok('failed art does not hold the gate', h.elements.mapLoadingGate.classList.contains('is-open'), JSON.stringify(h.state()));
}

// 5. It waits for the squad's tiers — not all six, and never none of them.
{
    const h = run({ completeImages: true, videoReady: 3 });
    h.timers.advance(300);
    ok('it fetches art to wait on at all', FakeImage.made.length > 0);
    ok('it does not preload the tiers the squad is not bringing', !FakeImage.made.some((i) => /MYTHIC|RARE|UNCOMMON/.test(i.src)));
}

// 6. A page without the gate is left completely alone.
{
    const h = run({ gateInDom: false, completeImages: true });
    h.timers.advance(3000);
    ok('no gate markup: no Arya call, no throw', h.aryaCalls.length === 0);
}

// 7. No engine (a script failed) — the failsafe still lets the player in.
{
    const h = run({ engine: false });
    h.timers.advance(20000);
    ok('no engine: failsafe opens the gate', h.elements.mapLoadingGate.classList.contains('is-open'));
}

// ------------------------------------------------------------------ report
results.forEach((r) => console.log(`${r.pass ? '  ok  ' : ' FAIL '} ${r.name}${r.pass || !r.detail ? '' : `\n        ${r.detail}`}`));
console.log(`\n${results.length - failures}/${results.length} checks passed`);
if (failures) {
    console.error(`${failures} FAILED`);
    process.exit(1);
}
