#!/usr/bin/env node
/**
 * Is the map a map?
 *
 *     node tools/check-map-design.js
 *
 * `/game` used to paint its arena behind the canvas: a looping 3-5.5 MB mp4 per theme,
 * a collision grid that only approximated the painting, and 50-70 loot nodes scattered
 * at random over both. Nothing here could tell — the renderer's tile function was four
 * empty branches and the canvas cleared to transparent, so the map *was* the video.
 *
 * This is the guard for the other arrangement, and it mostly runs the data instead of
 * reading it: MAP_GRIDS, MAP_LAYOUTS and MAP_SURFACES are loaded into a throwaway `vm`
 * with a stub `window`, and the run is simulated on them the way the knights walk it.
 * The checks that matter are the ones no code review can see:
 *
 *   · the arena is sealed by a frame, the spawn corner is open, and nothing is walled off
 *   · every monster has a left-or-right strike tile — the melee system cannot reach a
 *     monster walled in on both sides, so such a node would be unkillable and the run
 *     could never end
 *   · the whole table clears in waves from the spawn, which is the actual statement that
 *     a run can finish
 *   · the chokepoint is clear, and the vault behind it is guarded
 *   · props sit on the layer they claim (wall props on walls, blocks on pillars, bones
 *     on floor) and every piece the layout names has art in MAP_SURFACES
 *   · every baked surface exists, and none of them is heavier than the tile it draws
 *   · the engine still wires it up: a tile painter that draws, a baked layer, no mp4 left
 *     in the game's own scripts, and a loading gate that waits on the surfaces rather
 *     than on a video that no longer exists
 *
 * Comment-stripped source is used for the engine checks: a guard that matches prose is a
 * guard that passes on a comment (this repo has already shipped that mistake once).
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const GW = 36, GH = 20;
const THEMES = ['crypts', 'mines', 'temple', 'magma', 'void'];
const TYPES = { FLOOR: 0, WALL: 1, PILLAR: 2 };

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}
const section = (name) => { console.log(''); console.log(name); };

/** Load a classic script's data with no DOM: these three files assign to `window`. */
function loadData(file) {
    const sandbox = { window: {} };
    vm.runInNewContext(read(file), sandbox, { filename: file });
    return sandbox.window;
}

/**
 * Source with comments gone. Line comments keep a `:` in front of them so `https://`
 * survives, which is the only `//` in these files that is not a comment.
 */
function code(file) {
    return read(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// ------------------------------------------------------------------- the data
section('The data the map is made of');

const MAP_GRIDS = loadData('public/maps/map-grids.js').MAP_GRIDS;
rec('map-grids.js defines MAP_GRIDS', !!MAP_GRIDS, MAP_GRIDS ? Object.keys(MAP_GRIDS).join(' ') : 'missing');
rec('all five dungeons have a grid',
    !!MAP_GRIDS && THEMES.every((t) => Array.isArray(MAP_GRIDS[t]) && MAP_GRIDS[t].length === GH));
rec('every grid is 36x20 of floor / wall / pillar',
    !!MAP_GRIDS && THEMES.every((t) => MAP_GRIDS[t].every((row) =>
        row.length === GW && row.every((v) => v === 0 || v === 1 || v === 2))));

const MAP_LAYOUTS = loadData('public/maps/map-layouts.js').MAP_LAYOUTS;
const crypts = MAP_LAYOUTS && MAP_LAYOUTS.crypts;
rec('map-layouts.js carries the crypts design', !!crypts && !!crypts.zones && !!crypts.spawns,
    crypts ? `${Object.keys(crypts.zones).length} zones, ${crypts.spawns.length} nodes` : 'missing');
rec('  … and it names the tool that authored it',
    !!crypts && crypts.authored === 'tools/author-crypts-map.js' && fs.existsSync(path.join(ROOT, 'tools/author-crypts-map.js')),
    crypts && crypts.authored);

const MAP_SURFACES = loadData('public/maps/map-surfaces.js').MAP_SURFACES;
rec('map-surfaces.js covers all five themes',
    !!MAP_SURFACES && THEMES.every((t) => !!MAP_SURFACES[t]));

// -------------------------------------------------------------- the arena
section('The crypts arena');

const grid = MAP_GRIDS.crypts;
const at = (x, y) => (y < 0 || y >= GH || x < 0 || x >= GW) ? TYPES.WALL : grid[y][x];
const isFloor = (x, y) => at(x, y) === TYPES.FLOOR;

let frameGaps = 0;
for (let x = 0; x < GW; x++) if (at(x, 0) !== TYPES.WALL || at(x, GH - 1) !== TYPES.WALL) frameGaps++;
for (let y = 0; y < GH; y++) if (at(0, y) !== TYPES.WALL || at(GW - 1, y) !== TYPES.WALL) frameGaps++;
rec('the arena is sealed by a frame of wall', frameGaps === 0, `${frameGaps} gaps in the outer ring`);

let cornerOpen = true;
for (let y = 1; y < 5; y++) for (let x = 1; x < 5; x++) if (at(x, y) !== TYPES.FLOOR) cornerOpen = false;
rec('the spawn corner is open floor', cornerOpen, 'the engine forces 1..4 x 1..4 open, so it must be part of a room');

const floors = grid.flat().filter((v) => v === 0).length;
const pillars = grid.flat().filter((v) => v === 2).length;
rec('the arena is a designed space, not a field',
    floors > GW * GH * 0.4 && floors < GW * GH * 0.62,
    `${floors}/${GW * GH} floor (${Math.round(100 * floors / (GW * GH))}%), ${pillars} pillar tiles`);
rec('  … and it is not a maze of single tiles',
    grid[8].slice(11, 25).every((v) => v === 0 || v === 2),
    'the sarcophagus hall is 14 tiles wide, walkable in every direction');

const spawn = (crypts && crypts.spawn) || { x: 1, y: 1 };
if (!isFloor(spawn.x, spawn.y)) rec('the layout spawn is floor', false, `${spawn.x},${spawn.y}`);
const seen = new Set([`${spawn.x},${spawn.y}`]);
const queue = [[spawn.x, spawn.y]];
while (queue.length) {
    const [x, y] = queue.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!isFloor(nx, ny) || seen.has(`${nx},${ny}`)) continue;
        seen.add(`${nx},${ny}`);
        queue.push([nx, ny]);
    }
}
const orphans = [];
for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (isFloor(x, y) && !seen.has(`${x},${y}`)) orphans.push(`${x},${y}`);
rec('every floor tile is reachable from the spawn', orphans.length === 0,
    orphans.length ? `walled off: ${orphans.slice(0, 6).join(' ')}` : 'one connected arena');

// ------------------------------------------------------------------- zones
section('The rooms');

const zoneIds = Object.keys(crypts.zones);
const inside = (z, x, y) => x >= z.rect[0] && x <= z.rect[2] && y >= z.rect[1] && y <= z.rect[3];
const zoneOf = (x, y) => zoneIds.find((id) => inside(crypts.zones[id], x, y)) || null;

rec('every zone is inside the arena', zoneIds.every((id) => {
    const r = crypts.zones[id].rect;
    return r.length === 4 && r[0] >= 0 && r[1] >= 0 && r[2] < GW && r[3] < GH && r[0] <= r[2] && r[1] <= r[3];
}), `${zoneIds.length} zones`);

let overlaps = [];
for (let i = 0; i < zoneIds.length; i++) for (let j = i + 1; j < zoneIds.length; j++) {
    const a = crypts.zones[zoneIds[i]].rect, b = crypts.zones[zoneIds[j]].rect;
    const ox = Math.min(a[2], b[2]) - Math.max(a[0], b[0]) + 1;
    const oy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]) + 1;
    if (ox > 0 && oy > 0) overlaps.push(`${zoneIds[i]}/${zoneIds[j]}`);
}
rec('no two zones claim the same ground', overlaps.length === 0, overlaps.join(' ') || 'disjoint');

const emptyZones = zoneIds.filter((id) => {
    const r = crypts.zones[id].rect;
    let floor = 0;
    for (let y = r[1]; y <= r[3]; y++) for (let x = r[0]; x <= r[2]; x++) if (isFloor(x, y)) floor++;
    return floor === 0;
});
rec('every zone actually opens into the arena', emptyZones.length === 0, emptyZones.join(' ') || 'all carved');

const kinds = new Set(zoneIds.map((id) => crypts.zones[id].kind));
rec('the zones are typed (muster / hall / corridor / gate / vault)',
    ['muster', 'hall', 'corridor', 'gate', 'vault'].every((k) => kinds.has(k)), [...kinds].join(' '));
rec('  … and every zone is named', zoneIds.every((id) => crypts.zones[id].label && crypts.zones[id].label.length > 2),
    zoneIds.map((id) => crypts.zones[id].label).join(' · '));

// ---------------------------------------------------------------- the props
section('The props');

const props = crypts.props || [];
const propAt = new Set();
let propProblems = [];
for (const prop of props) {
    const key = `${prop.x},${prop.y}`;
    if (propAt.has(key)) propProblems.push(`two props on ${key}`);
    propAt.add(key);
    const want = prop.layer === 'wall' ? TYPES.WALL : prop.layer === 'obstacle' ? TYPES.PILLAR : TYPES.FLOOR;
    if (at(prop.x, prop.y) !== want) {
        propProblems.push(`${prop.piece} at ${key} is on tile ${at(prop.x, prop.y)}, not ${prop.layer}`);
    }
    if (!MAP_SURFACES.crypts.props[prop.piece]) propProblems.push(`${prop.piece} has no art`);
}
rec('every prop sits on the layer it claims', propProblems.length === 0, propProblems.slice(0, 5).join('; ') || `${props.length} props`);
rec('the scenery is spread over the arena',
    propAt.size > 40 && new Set(props.map((p) => p.piece)).size >= 3,
    [...new Set(props.map((p) => p.piece))].join(' '));

// ---------------------------------------------------------------- encounters
section('The encounter table');

const spawns = crypts.spawns || [];
const nodeAt = new Map();
let nodeProblems = [];
for (const node of spawns) {
    const key = `${node.x},${node.y}`;
    if (nodeAt.has(key)) nodeProblems.push(`two nodes on ${key}`);
    nodeAt.set(key, node);
    if (!isFloor(node.x, node.y)) nodeProblems.push(`${node.type} on tile ${at(node.x, node.y)} at ${key}`);
    if (!zoneOf(node.x, node.y)) nodeProblems.push(`${node.type} at ${key} is outside every room`);
    if (node.type !== 'monster' && node.type !== 'chest') nodeProblems.push(`unknown node type ${node.type}`);
    if (node.type === 'monster') {
        // The melee system fights side-on: a monster with walls or nodes on both sides
        // has no strike tile, so no knight can ever kill it and the run cannot end.
        const strike = [[node.x - 1, node.y], [node.x + 1, node.y]]
            .filter(([x, y]) => isFloor(x, y) && !nodeAt.has(`${x},${y}`));
        if (!strike.length) nodeProblems.push(`monster at ${key} has no free left-or-right strike tile`);
    } else {
        const approach = [[node.x - 1, node.y], [node.x + 1, node.y], [node.x, node.y - 1], [node.x, node.y + 1]]
            .some(([x, y]) => isFloor(x, y));
        if (!approach) nodeProblems.push(`chest at ${key} has no adjacent floor`);
    }
}
rec('every node stands where the engine can reach it', nodeProblems.length === 0,
    nodeProblems.slice(0, 5).join('; ') || `${spawns.length} nodes`);
rec('the run is the length it has always been',
    spawns.length >= 50 && spawns.length <= 70,
    `${spawns.length} nodes (the scatter placed 50-70, worth the same gold)`);
rec('chests are the minority, and they are the reward',
    spawns.filter((n) => n.type === 'chest').length >= 8
    && spawns.filter((n) => n.type === 'chest').length < spawns.length * 0.3,
    `${spawns.filter((n) => n.type === 'chest').length} chests, ${spawns.filter((n) => n.type === 'monster').length} monsters`);

const gateTiles = [[25, 4], [25, 5]];
rec('the chokepoint is clear', gateTiles.every(([x, y]) => !nodeAt.has(`${x},${y}`)),
    'a node in the throat would turn the vault door into a fight');
rec('  … and the arena has exactly one chokepoint that narrow',
    zoneIds.filter((id) => crypts.zones[id].kind === 'gate').length === 1,
    'one gate, four ways into the hall around it');

// The actual statement that a run can finish: walk the map the way the knights do and
// clear node by node, and see whether anything is still standing at the end.
function clearWaves() {
    const alive = new Set(spawns.map((_, i) => i));
    const pos = new Map(spawns.map((n, i) => [`${n.x},${n.y}`, i]));
    const waves = [];
    const waveOf = new Map();
    for (;;) {
        const reach = new Set([`${spawn.x},${spawn.y}`]);
        const open = [[spawn.x, spawn.y]];
        while (open.length) {
            const [x, y] = open.pop();
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = x + dx, ny = y + dy;
                const node = pos.get(`${nx},${ny}`);
                if (!isFloor(nx, ny) || (node !== undefined && alive.has(node)) || reach.has(`${nx},${ny}`)) continue;
                reach.add(`${nx},${ny}`);
                open.push([nx, ny]);
            }
        }
        const killed = [];
        for (const i of alive) {
            const node = spawns[i];
            const strike = node.type === 'monster'
                ? [[node.x - 1, node.y], [node.x + 1, node.y]]
                : [[node.x - 1, node.y], [node.x + 1, node.y], [node.x, node.y - 1], [node.x, node.y + 1]];
            const canHit = strike.some(([x, y]) => reach.has(`${x},${y}`) && isFloor(x, y));
            const approachFree = node.type !== 'monster' || strike.some(([x, y]) => {
                const j = pos.get(`${x},${y}`);
                return isFloor(x, y) && (j === undefined || !alive.has(j));
            });
            if (canHit && approachFree) killed.push(i);
        }
        if (!killed.length) break;
        killed.forEach((i) => { alive.delete(i); waveOf.set(i, waves.length + 1); });
        waves.push(killed.length);
    }
    return { waves, waveOf, stranded: [...alive].map((i) => `${spawns[i].type}@${spawns[i].x},${spawns[i].y}`) };
}
const { waves, waveOf, stranded } = clearWaves();
rec('the run can always finish', stranded.length === 0,
    stranded.length ? `never clearable: ${stranded.join(' ')}` : `cleared in ${waves.length} waves: ${waves.join(' -> ')}`);

const vaultWave = spawns.map((n, i) => ({ i, zone: zoneOf(n.x, n.y) }))
    .filter((n) => n.zone === 'reliquary').map((n) => waveOf.get(n.i));
rec('the vault is behind its guards', vaultWave.length > 0 && Math.min(...vaultWave) > 1,
    `${vaultWave.length} nodes open on wave ${Math.min(...vaultWave)} of ${waves.length}`);
rec('  … and the muster room is not', (() => {
    const ante = spawns.map((n, i) => zoneOf(n.x, n.y) === 'antechamber' ? waveOf.get(i) : null).filter(Boolean);
    return ante.length > 0 && Math.max(...ante) === 1;
})(), 'the first monsters are the ones a knight can see from the deploy tiles');

// --------------------------------------------------------------- the surfaces
section('The baked surfaces');

const surfaceFiles = [];
for (const theme of THEMES) {
    const s = MAP_SURFACES[theme];
    ['floor', 'rimH', 'rimV'].forEach((key) => surfaceFiles.push([theme, key, s[key]]));
    ['tl', 'tr', 'bl', 'br'].forEach((key) => {
        if (!s.corners || !s.corners[key]) surfaceFiles.push([theme, `corner-${key}`, null]);
        else surfaceFiles.push([theme, `corner-${key}`, s.corners[key]]);
    });
    if (!s.props || !Object.keys(s.props).length) surfaceFiles.push([theme, 'props', null]);
    Object.entries(s.props || {}).forEach(([key, file]) => surfaceFiles.push([theme, `prop-${key}`, file]));
}
const missingFiles = surfaceFiles.filter(([, , file]) => !file || !fs.existsSync(path.join(ROOT, 'public', file)));
rec('every surface the manifest names exists on disk', missingFiles.length === 0,
    missingFiles.length ? missingFiles.map(([t, k]) => `${t}/${k}`).join(' ') : `${surfaceFiles.length} files`);

// Only the files that are there: a missing surface is already reported above, and
// statting it here would throw before that report reaches the screen.
const onDisk = (f) => !!f && fs.existsSync(path.join(ROOT, 'public', f));
const sizes = surfaceFiles.filter(([, , f]) => onDisk(f)).map(([theme, key, file]) => ({
    theme, key, bytes: fs.statSync(path.join(ROOT, 'public', file)).size
}));
const heavy = sizes.filter((s) => s.bytes > 200 * 1024);
rec('no surface is heavier than the tile it draws', heavy.length === 0,
    heavy.length ? heavy.map((s) => `${s.theme}/${s.key} ${Math.round(s.bytes / 1024)}KB`).join(' ')
                 : `heaviest ${Math.round(Math.max(0, ...sizes.map((s) => s.bytes)) / 1024)}KB`);
const total = sizes.reduce((n, s) => n + s.bytes, 0);
const sourceTotal = ['floor-tile.png', 'border-horizontal.png', 'border-vertical.png', 'corner-tl.png']
    .map((f) => fs.statSync(path.join(ROOT, 'public/assets/crypts', f)).size)
    .reduce((a, b) => a + b, 0);
rec('  … and the whole set is smaller than one theme of source art',
    total < sourceTotal * THEMES.length,
    `${Math.round(total / 1024)} KB baked against ${Math.round(sourceTotal * THEMES.length / 1048576)} MB of source art`);

for (const [theme, key, file] of surfaceFiles.filter(([, , f]) => onDisk(f))) {
    const p = path.join(ROOT, 'public', file);
    const header = fs.readFileSync(p).subarray(0, 8).toString('hex');
    if (header !== '89504e470d0a1a0a') rec(`${theme}/${key} is a PNG`, false, p);
}
rec('the surfaces are real PNGs', true, 'checked every header');

// --------------------------------------------------------------------- the engine
section('The engine that draws it');

const dungeon = code('public/dungeon.js');
const game = code('public/game.js');
const gate = code('public/loading-gate.js');
const pages = read('lib/static-pages.js');   // a data file: no comments to strip in the body

rec('a tile painter exists and it draws',
    /paintTile\s*\(/.test(dungeon)
    && /ctx\.drawImage\(floor/.test(dungeon) && /ctx\.fillRect\(x, y, tileSize, tileSize\)/.test(dungeon),
    'floor from the baked tile, walls and pillars from the palette');
// The kit's floor art is not equally usable — magma's and void's tiles are transparent
// to the last pixel, because they were overlays on the mp4 this change removed. Without
// a base coat under the surface those arenas are a hole onto the shadow behind the map.
rec('  … with a palette base coat under the surface',
    /ctx\.fillStyle = type === 3 \? theme\.floorAlt : theme\.floor;[\s\S]{0,220}?ctx\.drawImage\(floor, x, y, tileSize, tileSize\)/.test(dungeon),
    'a transparent floor tile still lands on the theme’s own floor colour');
rec('  … and the no-op it replaced is gone',
    !/INVISIBLE/.test(dungeon) && !/video background only/.test(dungeon),
    'the four empty branches said the map was the video');
rec('renderTile still paints, through the painter',
    /renderTile\(x, y, type, gridX, gridY, tileSize\)\s*\{[\s\S]{0,120}paintTile\(this\.ctx/.test(dungeon),
    'the method the engine has always called');
rec('the static map is baked once',
    /bakeMapLayer\s*\(/.test(dungeon) && /this\.paintTile\(layer/.test(dungeon)
    && /this\.paintRim\(layer/.test(dungeon) && /this\.paintScenery\(layer/.test(dungeon),
    'every tile, the rim, then the scenery');
rec('  … and the frame loop draws the baked layer',
    /drawMapLayer\(ctx\)/.test(dungeon) && /ctx\.drawImage\(this\.mapLayer/.test(dungeon),
    'one scaled drawImage instead of 720 tiles');
rec('the whole arena is on screen and centred',
    /this\.offsetX = Math\.round\(\(canvas\.width - mapWidth \* this\.zoom\) \/ 2\)/.test(dungeon)
    && /this\.offsetY = Math\.round\(\(canvas\.height - mapHeight \* this\.zoom\) \/ 2\)/.test(dungeon),
    'fit zoom 0.75 on a 1140x600 canvas leaves 30px either side');
rec('only the theme on screen is fetched',
    !/Object\.entries\(DUNGEONS\)/.test(dungeon) && /surfaceImages\[this\.dungeon\.type\]/.test(dungeon),
    'the five-theme preload is gone; the sheet and the bestiary are scoped too');
rec('the layout decides where everything stands',
    /spawnFromLayout\(/.test(dungeon) && /placeLayoutProps\(/.test(dungeon)
    && /this\.layout = \(typeof MAP_LAYOUTS/.test(dungeon),
    'nodes and props from the map, with the old scatter as the fallback');
// Both paths: the layout one that crypts uses at spawnFromLayout, and the scatter
// fallback the four untouched dungeons still take. One edit is enough to halve a run.
const goldTargets = dungeon.match(/totalGoldTarget = 10\.0/g) || [];
rec('  … and the reward math is unchanged',
    goldTargets.length >= 2 && /spawns\.length \* 0\.8/.test(dungeon),
    `${goldTargets.length} paths still target 10 DNG a clear`);

rec('the engine never asks for a background video', !/\.mp4/.test(game) && !/videoElement/.test(game)
    && !/switchDungeonVideo|initVideoBackground/.test(game),
    'the map is painted, not played');
rec('  … and the page has no video element',
    !/dungeonBackground/.test(pages) && !/dungeon-video-bg/.test(pages),
    'the canvas is the whole of the canvas area');
// Comments are stripped first: the replacement note names the class, and a guard that
// matches prose is a guard that passes on a comment.
const layoutCss = read('public/layout.css').replace(/\/\*[\s\S]*?\*\//g, '');
rec('  … and its stylesheet rule went with it',
    !/dungeon-video-bg/.test(layoutCss),
    'dead CSS nothing emits, which check-styles.js cannot see');
rec('the loading gate waits on the surfaces',
    /surfaceImages/.test(gate) && /images\.rimH/.test(gate) && !/videoElement|watchVideo/.test(gate),
    'a gate still waiting on the mp4 would open on its failsafe every load');
rec('the map data loads before the engine',
    pages.indexOf('"maps/map-grids.js"') < pages.indexOf('"dungeon.js?v=')
    && pages.indexOf('"maps/map-layouts.js"') < pages.indexOf('"dungeon.js?v=')
    && pages.indexOf('"maps/map-surfaces.js"') < pages.indexOf('"dungeon.js?v='),
    'grid, layout and surfaces all resolve before the first Dungeon is built');
rec('the mp4s are still on disk for the menu and the intro',
    fs.readdirSync(path.join(ROOT, 'public/maps/map/animated')).filter((f) => f.endsWith('.mp4')).length === 5,
    'the game stopped loading them; nothing deleted them');
rec('the root and served grid files are the same file',
    read('maps/map-grids.js') === read('public/maps/map-grids.js'),
    'tools/map-grid-editor.html opens the root copy');

// The design tool re-derives the grid and the table and runs the same checks; if the two
// data files and the tool have drifted, it exits non-zero.
let toolOk = true;
let toolOut = '';
try {
    toolOut = execFileSync(process.execPath, [path.join(ROOT, 'tools/author-crypts-map.js'), '--dry'], { encoding: 'utf8' });
} catch (error) {
    toolOk = false;
    toolOut = String(error.stdout || error.message);
}
rec('the authoring tool still agrees with the data it wrote', toolOk && /design checks: all pass/.test(toolOut),
    toolOk ? (toolOut.match(/nodes \d+ \([^)]*\)/) || ['design checks: all pass'])[0] : toolOut.split('\n').slice(-3).join(' '));

// ------------------------------------------------------------------- verdict
const failed = results.filter((r) => !r.pass);
console.log('');
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
    console.log('');
    failed.forEach((f) => console.log(`  FAILED  ${f.label}`));
    process.exitCode = 1;
}
