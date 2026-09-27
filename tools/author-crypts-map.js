/**
 * Author the Forgotten Crypts: its collision grid and its encounter layout.
 *
 *   node tools/author-crypts-map.js            # write both data files
 *   node tools/author-crypts-map.js --dry      # suit up, check everything, write nothing
 *
 * The other four dungeons keep whatever grids `tools/author-map-grids.js` gave
 * them — that tool traces the painted art and needs ffmpeg-static, which this
 * checkout does not have. Crypts is designed by hand now, because the art the
 * engine shipped was never the map: the collision grid approximated a painting,
 * the painting was a video, and the 50-70 loot nodes were scattered at random
 * across both. This file is the opposite: rooms carved on purpose, a corridor
 * that is genuinely a chokepoint, a vault behind it, and a spawn table that puts
 * every monster where the map says it belongs.
 *
 * It writes two files from one source of truth, so the grid and the encounters
 * can never drift apart:
 *
 *   public/maps/map-grids.js    collision: 0 floor, 1 wall, 2 pillar
 *   public/maps/map-layouts.js  zones, props, spawn table (window.MAP_LAYOUTS)
 *
 * ...and it refuses to write either one if the design breaks a rule the engine
 * depends on. The rules are in `check()` below; the interesting two are that a
 * monster must have a left-or-right strike tile (the melee system cannot hit a
 * monster walled in on both sides, so such a node could never be cleared) and
 * that the whole table must be clearable in waves from the spawn corner.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const GW = 36, GH = 20;
const DRY = process.argv.includes('--dry');

// ---------------------------------------------------------------- geometry
const grid = Array.from({ length: GH }, () => Array(GW).fill(1));   // solid rock
const carve = (x1, y1, x2, y2) => {
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) grid[y][x] = 0;
};
const pillar = (x1, y1, x2, y2) => {
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) grid[y][x] = 2;
};

/**
 * The rooms. Everything not carved stays solid, so a room is only ever
 * connected where a door is carved between it and its neighbour.
 */
const ROOMS = [
    [1, 1, 7, 5, 'antechamber'],     // the muster room, spawn corner inside it
    [8, 3, 8, 4, 'door:antechamber-east'],
    [9, 1, 18, 6, 'bells'],          // first hall, two pillars
    [13, 7, 14, 7, 'door:bells-south'],
    [11, 8, 24, 14, 'hall'],         // the sarcophagus hall
    [10, 10, 10, 11, 'door:hall-west'],
    [19, 3, 24, 4, 'gate-corridor'], // the walk up to the vault
    [25, 4, 25, 5, 'chokepoint'],    // two tiles wide: the vault's throat
    [26, 2, 34, 7, 'reliquary'],     // the chest vault
    [3, 6, 4, 14, 'west-run'],
    [3, 15, 4, 15, 'door:west-run-south'],
    [1, 16, 12, 18, 'ossuary'],
    [11, 15, 12, 15, 'door:ossuary'],
    [13, 17, 15, 17, 'under-passage'],
    [16, 16, 34, 18, 'flooded'],
    [17, 15, 18, 15, 'door:flooded']
];
ROOMS.forEach(([x1, y1, x2, y2]) => carve(x1, y1, x2, y2));

const PILLARS = [
    [12, 3, 12, 3], [15, 3, 15, 3],           // hall of bells
    [14, 10, 15, 10], [20, 10, 21, 10],       // the tomb blocks
    [17, 12, 18, 12],                         // the altar slab
    [28, 3, 28, 3], [31, 3, 31, 3],           // reliquary pillars
    [5, 17, 7, 17],                           // the ossuary tombs
    [24, 17, 25, 17], [29, 17, 30, 17]        // the flooded crypt islands
];
PILLARS.forEach(([x1, y1, x2, y2]) => pillar(x1, y1, x2, y2));

// The spawn corner the engine forces open, and where a squad lands.
const SPAWN = { x: 2, y: 2 };

// ------------------------------------------------------------------- zones
// Named space. `kind` is what the renderer dresses (rooms get props along their
// walls, corridors stay bare), and the encounter table below is tagged by zone
// so the map, the props and the spawns are all talking about the same places.
const ZONES = [
    ['antechamber', [1, 1, 7, 5], 'muster', 'The Muster'],
    ['bells', [9, 1, 18, 6], 'hall', 'Hall of Bells'],
    ['gate-corridor', [19, 3, 24, 4], 'corridor', 'The Long Walk'],
    ['chokepoint', [25, 4, 25, 5], 'gate', 'The Throat'],
    ['reliquary', [26, 2, 34, 7], 'vault', 'The Reliquary'],
    ['hall', [11, 8, 24, 14], 'hall', 'Sarcophagus Hall'],
    ['west-run', [3, 6, 4, 14], 'corridor', 'The Long Stair'],
    ['ossuary', [1, 16, 12, 18], 'hall', 'Ossuary'],
    ['under-passage', [13, 17, 15, 17], 'corridor', 'The Crawl'],
    ['flooded', [16, 16, 34, 18], 'hall', 'The Flooded Crypt']
];

// ---------------------------------------------------------- encounter table
// Every monster and chest in the run, in the order the map hands them over.
// `m` monsters need the tile beside them kept free — see check().
const MONSTER = 'm', CHEST = 'c';
const SPAWNS = [
    // the muster room: three, a knight's length from the deploy tiles
    [MONSTER, 5, 2], [MONSTER, 7, 4], [MONSTER, 2, 5],
    // hall of bells: the first real fight, in two loose clusters
    [MONSTER, 10, 2], [MONSTER, 13, 2], [MONSTER, 16, 2],
    [MONSTER, 11, 4], [MONSTER, 14, 4], [MONSTER, 17, 4],
    [MONSTER, 10, 5], [MONSTER, 16, 5], [MONSTER, 18, 3],
    // the sarcophagus hall: the long fight around the tombs
    [MONSTER, 12, 9], [MONSTER, 14, 8], [MONSTER, 16, 9], [MONSTER, 19, 9], [MONSTER, 23, 9],
    [MONSTER, 13, 11], [MONSTER, 19, 12], [MONSTER, 24, 11], [MONSTER, 22, 8],
    [MONSTER, 12, 13], [MONSTER, 17, 14], [MONSTER, 22, 14], [MONSTER, 23, 12],
    // the pair that owns the chokepoint: nothing reaches the vault until they die
    [MONSTER, 22, 3], [MONSTER, 23, 4],
    // the reliquary guard, and the vault itself
    [MONSTER, 27, 4], [MONSTER, 30, 6], [MONSTER, 33, 3], [MONSTER, 32, 6],
    [CHEST, 26, 3], [CHEST, 27, 2], [CHEST, 30, 2], [CHEST, 33, 2],
    [CHEST, 26, 6], [CHEST, 28, 5], [CHEST, 29, 6], [CHEST, 34, 3],
    // the long stair: one per landing
    [MONSTER, 3, 7], [MONSTER, 4, 9], [MONSTER, 3, 11], [MONSTER, 4, 13],
    // the ossuary
    [MONSTER, 2, 16], [MONSTER, 4, 16], [MONSTER, 8, 16], [MONSTER, 10, 16],
    [MONSTER, 4, 18], [MONSTER, 10, 18],
    [CHEST, 1, 18], [CHEST, 2, 18],
    // the flooded crypt: the deep end, and the pay-off
    [MONSTER, 17, 16], [MONSTER, 19, 16], [MONSTER, 21, 16], [MONSTER, 23, 16],
    [MONSTER, 26, 16], [MONSTER, 28, 16], [MONSTER, 31, 16], [MONSTER, 33, 16],
    [MONSTER, 18, 18], [MONSTER, 22, 18],
    [CHEST, 20, 18], [CHEST, 27, 18], [CHEST, 34, 18]
];

const zoneOf = (x, y) => {
    const hit = ZONES.find(([, [x1, y1, x2, y2]]) => x >= x1 && x <= x2 && y >= y1 && y <= y2);
    return hit ? hit[0] : null;
};

// ------------------------------------------------------------------- props
// Deterministic clutter, hung off the geometry rather than a hand-typed list:
// a torch in the wall either side of every doorway, stone blocks on the pillars,
// carved crypt-corner pieces at the four corners of the two big rooms, and a
// scattered bone here and there along walls a knight can see.
const props = [];
const propKeys = new Set();
// One prop per tile. The rules below overlap on purpose — a doorway torch and a carved
// corner can both want the same tile — and the first rule to reach it wins (torches,
// then the stone caps, then the carved corners, then the bones).
const addProp = (piece, x, y, layer) => {
    const key = `${x},${y}`;
    if (propKeys.has(key)) return;
    propKeys.add(key);
    props.push({ x, y, piece, layer });
};
const at = (x, y) => (y < 0 || y >= GH || x < 0 || x >= GW) ? 1 : grid[y][x];
const isNode = new Set(SPAWNS.map(([, x, y]) => `${x},${y}`));
const doors = ROOMS.filter(([, , , , id]) => id.startsWith('door:') || id === 'chokepoint' || id === 'under-passage');

// Torches: the wall tile on either side of every doorway, when it is a wall.
for (const [x1, y1, x2, y2] of doors) {
    const horizontal = (x2 - x1) >= (y2 - y1);
    if (horizontal) {
        const y = y1, mid = Math.floor((x1 + x2) / 2);
        [[mid - 2, y], [mid + 2, y]].forEach(([x, ty]) => {
            if (at(x, ty) === 1 && at(x, ty - 1) === 0 || at(x, ty) === 1 && at(x, ty + 1) === 0) {
                addProp('torch', x, ty, 'wall');
            }
        });
        [[x1 - 1, y - 1], [x2 + 1, y - 1]].forEach(([x, ty]) => {
            if (at(x, ty) === 1 && (at(x, ty + 1) === 0 || at(x - 1, ty) === 0 || at(x + 1, ty) === 0)) {
                addProp('torch', x, ty, 'wall');
            }
        });
    } else {
        [[x1 - 1, y1 - 1], [x1 - 1, y2 + 1]].forEach(([x, ty]) => {
            if (at(x, ty) === 1 && (at(x + 1, ty) === 0 || at(x, ty + 1) === 0 || at(x, ty - 1) === 0)) {
                addProp('torch', x, ty, 'wall');
            }
        });
    }
}
// The rim is already torch-lit masonry, and the halls get a sconce every so often:
// a wall tile that faces a room, every seventh one on the row-major walk.
let sconce = 0;
for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) {
    if (at(x, y) !== 1) continue;
    const faces = at(x - 1, y) === 0 || at(x + 1, y) === 0 || at(x, y - 1) === 0 || at(x, y + 1) === 0;
    if (!faces) continue;
    if (++sconce % 7 === 0) addProp('torch', x, y, 'wall');
}
// Stone blocks cap every pillar.
for (const [x1, y1, x2, y2] of PILLARS) {
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) addProp('block', x, y, 'obstacle');
}
// Carved corners at the mouth of the big rooms, and along the ossuary tombs.
[[11, 8], [24, 8], [11, 14], [24, 14], [26, 2], [34, 2], [26, 7], [34, 7],
 [1, 16], [12, 16], [1, 18], [12, 18], [4, 17], [8, 17], [10, 18], [2, 12]]
    .forEach(([x, y]) => { if (at(x, y) === 0) addProp('crypt', x, y, 'floor'); });
// Bones: floor tiles that hug a wall, on a fixed stride so every run is the same map.
let bone = 0;
for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) {
    if (at(x, y) !== 0 || isNode.has(`${x},${y}`)) continue;
    const hugs = at(x - 1, y) === 1 || at(x + 1, y) === 1 || at(x, y - 1) === 1 || at(x, y + 1) === 1;
    if (!hugs) continue;
    if (++bone % 11 === 0) addProp('decor', x, y, 'floor');
}

// ------------------------------------------------------------------- checks
function reachable() {
    const seen = new Set([`${SPAWN.x},${SPAWN.y}`]);
    const queue = [[SPAWN.x, SPAWN.y]];
    while (queue.length) {
        const [x, y] = queue.pop();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, ny = y + dy;
            if (at(nx, ny) !== 0 || seen.has(`${nx},${ny}`)) continue;
            seen.add(`${nx},${ny}`);
            queue.push([nx, ny]);
        }
    }
    return seen;
}

/**
 * Can the run finish? Walk the map the way the knights do: everything reachable
 * from the spawn is the killing floor, any node with a strike tile on it dies,
 * the node's tile opens up, and repeat. If anything is still alive at the end,
 * the design has a lock the player cannot pick.
 */
function clearWaves() {
    const alive = new Set(SPAWNS.map((_, i) => i));
    const pos = new Map();
    SPAWNS.forEach(([, x, y], i) => pos.set(`${x},${y}`, i));
    const passable = (x, y) => {
        if (at(x, y) !== 0) return false;
        const i = pos.get(`${x},${y}`);
        return i === undefined || !alive.has(i);
    };
    const waves = [];
    const waveOf = new Map();
    for (;;) {
        const seen = new Set([`${SPAWN.x},${SPAWN.y}`]);
        const queue = [[SPAWN.x, SPAWN.y]];
        while (queue.length) {
            const [x, y] = queue.pop();
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = x + dx, ny = y + dy;
                if (!passable(nx, ny) || seen.has(`${nx},${ny}`)) continue;
                seen.add(`${nx},${ny}`);
                queue.push([nx, ny]);
            }
        }
        const killed = [];
        for (const i of alive) {
            const [type, x, y] = SPAWNS[i];
            const strike = type === MONSTER ? [[x - 1, y], [x + 1, y]]
                                            : [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
            const open = strike.filter(([nx, ny]) => {
                if (at(nx, ny) !== 0) return false;
                const j = pos.get(`${nx},${ny}`);
                return j === undefined || !alive.has(j);
            });
            if (open.some(([nx, ny]) => seen.has(`${nx},${ny}`))) killed.push(i);
        }
        if (!killed.length) break;
        killed.forEach((i) => { alive.delete(i); waveOf.set(i, waves.length + 1); });
        waves.push(killed.length);
    }
    return { waves, waveOf, alive: [...alive].map((i) => SPAWNS[i]) };
}

function check(problems) {
    const add = (m) => problems.push(m);
    // frame
    for (let x = 0; x < GW; x++) if (at(x, 0) !== 1 || at(x, GH - 1) !== 1) add('the arena frame has a gap in row 0 or 19');
    for (let y = 0; y < GH; y++) if (at(0, y) !== 1 || at(GW - 1, y) !== 1) add('the arena frame has a gap in column 0 or 35');
    // the deploy corner the engine forces open
    for (let y = 1; y < 5; y++) for (let x = 1; x < 5; x++) if (at(x, y) !== 0) add(`spawn corner is not open at ${x},${y}`);
    // every zone is real space
    for (const [id, [x1, y1, x2, y2]] of ZONES) {
        let floor = 0;
        for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) if (at(x, y) === 0) floor++;
        if (!floor) add(`zone ${id} has no floor in it`);
    }
    // nothing walled off
    const seen = reachable();
    let orphans = 0;
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
        if (at(x, y) === 0 && !seen.has(`${x},${y}`)) orphans++;
    }
    if (orphans) add(`${orphans} floor tiles cannot be reached from the spawn`);
    // the encounter table
    const used = new Set();
    for (const [type, x, y] of SPAWNS) {
        const key = `${x},${y}`;
        if (used.has(key)) add(`two nodes share ${key}`);
        used.add(key);
        if (at(x, y) !== 0) add(`${type} at ${key} is not on floor`);
        if (!zoneOf(x, y)) add(`${type} at ${key} is not inside any zone`);
        if (type === MONSTER) {
            const open = [[x - 1, y], [x + 1, y]].some(([nx, ny]) => at(nx, ny) === 0 && !used.has(`${nx},${ny}`));
            if (!open) add(`monster at ${key} has no free left-or-right strike tile and could never be killed`);
        } else {
            const open = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([nx, ny]) => at(nx, ny) === 0);
            if (!open) add(`chest at ${key} has no adjacent floor tile`);
        }
    }
    if (SPAWNS.length < 50 || SPAWNS.length > 70) add(`the table has ${SPAWNS.length} nodes; the run budget is 50-70`);
    // the chokepoint stays clear: a node in the throat would make the vault's only door a fight
    for (const [x, y] of [[25, 4], [25, 5]]) if (used.has(`${x},${y}`)) add(`a node is standing in the chokepoint at ${x},${y}`);
    // the run can finish
    const { waves, waveOf, alive } = clearWaves();
    if (alive.length) add(`${alive.length} nodes can never be cleared: ${alive.map(([, x, y]) => `${x},${y}`).join(' ')}`);
    return { waves, waveOf, orphans };
}

// -------------------------------------------------------------------- output
const problems = [];
const { waves, waveOf, orphans } = check(problems);
const body = { name: 'Forgotten Crypts', authored: 'tools/author-crypts-map.js' };

const report = () => {
    const mark = new Map(SPAWNS.map(([t, x, y]) => [`${x},${y}`, t === MONSTER ? 'M' : 'C']));
    const glyph = ['.', '#', 'o'];
    console.log('');
    for (let y = 0; y < GH; y++) {
        console.log(String(y).padStart(2) + ' ' +
            grid[y].map((t, x) => mark.get(`${x},${y}`) || glyph[t]).join(''));
    }
    const floor = grid.flat().filter((v) => v === 0).length;
    const monsters = SPAWNS.filter(([t]) => t === MONSTER).length;
    console.log('');
    console.log(`floor ${floor}/${GW * GH} (${(100 * floor / (GW * GH)).toFixed(0)}%)  ` +
                `unreachable ${orphans}  nodes ${SPAWNS.length} (${monsters} monsters, ` +
                `${SPAWNS.length - monsters} chests)  props ${props.length}`);
    console.log(`clear waves: ${waves.join(' -> ')}`);
    console.log(`gold per node ${(10.0 / (SPAWNS.length * 0.8)).toFixed(4)} DNG, ` +
                `full clear ~${(10.0 / 0.8).toFixed(2)} DNG`);    const vault = SPAWNS.map(([, x, y], i) => ({ i, zone: zoneOf(x, y) }))
        .filter((n) => n.zone === 'reliquary').map((n) => waveOf.get(n.i));
    console.log(`gate tiles node-free: ${[[25, 4], [25, 5]].every(([x, y]) => !isNode.has(`${x},${y}`))}`);
    console.log(`reliquary opens on wave ${Math.min(...vault)} of ${waves.length} — ` +
                `${vault.length} nodes wait behind the two gate guards`);
    console.log('');
    if (problems.length) {
        console.log('DESIGN FAILED:');
        problems.forEach((p) => console.log('  ✗ ' + p));
    } else {
        console.log('design checks: all pass');
    }
};
report();

if (problems.length) {
    console.error('\nnothing written — fix the map first');
    process.exit(1);
}
if (DRY) process.exit(0);

// ------------------------------------------------------- serialize the grid
const gridsFile = path.join(ROOT, 'public', 'maps', 'map-grids.js');
const existing = fs.readFileSync(gridsFile, 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(existing, sandbox);
const grids = { ...sandbox.window.MAP_GRIDS };
const OTHERS = ['magma', 'mines', 'temple', 'void'];
const ORDER = ['crypts', ...OTHERS];
grids.crypts = grid;

let out = '// Collision grids for the dungeon maps.\n';
out += '// 0 = floor, 1 = wall, 2 = pillar (permanent obstacle).\n';
out += '// crypts is designed by hand in tools/author-crypts-map.js, which also writes\n';
out += '// maps/map-layouts.js: the zones, the props and the spawn table that go with it.\n';
out += `// ${OTHERS.join(', ')} keep the grids tools/author-map-grids.js traced from the old\n`;
out += '// painted art. Grid is 36x20.\n';
out += 'const MAP_GRIDS = {\n';
ORDER.forEach((t, i) => {
    out += `    ${t}: [\n`;
    out += grids[t].map((row) => '        [' + row.join(',') + ']').join(',\n');
    out += `\n    ]${i < ORDER.length - 1 ? ',' : ''}\n`;
});
out += '};\n\nif (typeof window !== \'undefined\') window.MAP_GRIDS = MAP_GRIDS;\n';

// ----------------------------------------------------- serialize the layout
// Written out by hand rather than JSON.stringify'd: a rect reads as `rect:
// [11, 8, 24, 14]`, and both lists carry a comment when they change zone or
// piece, so the file reads like the design it is.
const grouped = (items, keyOf, line) => {
    const out = [];
    let last = null;
    items.forEach((item, i) => {
        const key = keyOf(item);
        if (key !== last) { out.push(`            // ${key}`); last = key; }
        out.push(line(item, i) + (i === items.length - 1 ? '' : ','));
    });
    return out.join('\n');
};

let layout = '// The hand-designed dungeon layouts. Generated by tools/author-crypts-map.js.\n';
layout += '//\n';
layout += '// A layout is what the map knows that the collision grid cannot say: which\n';
layout += '// rooms are which, where the scenery goes, and where every monster and chest\n';
layout += '// stands. The engine reads it if it is there and falls back to the old\n';
layout += '// scatter if it is not, so the four dungeons still waiting for their pass\n';
layout += '// keep working.\n';
layout += 'const MAP_LAYOUTS = {\n';
layout += '    crypts: {\n';
layout += `        name: '${body.name}',\n`;
layout += `        authored: '${body.authored}',\n`;
layout += `        spawn: { x: ${SPAWN.x}, y: ${SPAWN.y} },\n`;
layout += '        zones: {\n';
layout += ZONES.map(([id, rect, kind, label]) =>
    `            '${id}': { rect: [${rect.join(', ')}], kind: '${kind}', label: '${label}' }`).join(',\n');
layout += '\n        },\n';
layout += '        props: [\n';
layout += grouped(props, (p) => p.piece,
    (p) => `            { x: ${p.x}, y: ${p.y}, piece: '${p.piece}', layer: '${p.layer}' }`);
layout += '\n        ],\n';
layout += '        spawns: [\n';
layout += grouped(SPAWNS, ([, x, y]) => zoneOf(x, y),
    ([type, x, y]) => `            { x: ${x}, y: ${y}, type: '${type === MONSTER ? 'monster' : 'chest'}', zone: '${zoneOf(x, y)}' }`);
layout += '\n        ]\n';
layout += '    }\n';
layout += '};\n\n';
layout += 'if (typeof window !== \'undefined\') window.MAP_LAYOUTS = MAP_LAYOUTS;\n';

fs.writeFileSync(gridsFile, out);
fs.writeFileSync(path.join(ROOT, 'public', 'maps', 'map-layouts.js'), layout);
// The root copy is what tools/map-grid-editor.html opens; keep the two identical.
fs.writeFileSync(path.join(ROOT, 'maps', 'map-grids.js'), out);
console.log('\nwrote public/maps/map-grids.js, public/maps/map-layouts.js and maps/map-grids.js');
