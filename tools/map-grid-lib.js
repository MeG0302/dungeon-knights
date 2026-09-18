/**
 * Shared helpers for the dungeon map grid tools.
 *
 * The painted maps live in maps/<theme>.png, extracted from the source videos
 * by tools/extract-map-frames.js. Their collision grids are 36x20 - the tile
 * pitch the art is drawn on - and are written to maps/map-grids.js.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('ffmpeg-static');

const ROOT = path.join(__dirname, '..');
const GW = 36, GH = 20;
const SRC_W = 1280, SRC_H = 720;
const THEMES = ['crypts', 'magma', 'mines', 'temple', 'void'];

const inBounds = (x, y) => x >= 0 && x < GW && y >= 0 && y < GH;
const blank = () => Array.from({ length: GH }, () => Array(GW).fill(0));

/** Decode a map PNG to raw RGB at the requested size. */
function rgbAt(theme, w, h) {
    return execFileSync(ffmpeg, [
        '-v', 'error', '-i', path.join(ROOT, 'maps', `${theme}.png`),
        '-vf', `scale=${w}:${h}:flags=area`,
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'
    ], { maxBuffer: 1 << 28 });
}

/** Fill any floor the knights cannot reach from the spawn corner. */
function sealUnreachable(grid, sx = 1, sy = 1) {
    const seen = grid.map(r => r.map(() => false));
    const queue = [[sx, sy]];
    seen[sy][sx] = true;
    while (queue.length) {
        const [x, y] = queue.pop();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, ny = y + dy;
            if (inBounds(nx, ny) && !seen[ny][nx] && grid[ny][nx] === 0) {
                seen[ny][nx] = true; queue.push([nx, ny]);
            }
        }
    }
    let orphaned = 0;
    for (let y = 1; y < GH - 1; y++) {
        for (let x = 1; x < GW - 1; x++) {
            if (grid[y][x] === 0 && !seen[y][x]) { grid[y][x] = 1; orphaned++; }
        }
    }
    return orphaned;
}

function ascii(grid) {
    const head = '    ' + [...Array(GW).keys()].map(i => i % 10).join('');
    const rows = grid.map((r, y) => String(y).padStart(3) + ' ' + r.map(v => (v ? '#' : '.')).join(''));
    return [head, ...rows].join('\n');
}

/**
 * Write maps/_grid/<theme>-overlay.png: the real art with wall cells tinted red,
 * a white cell grid and a brighter line every 5 cells so coordinates are
 * countable by eye. Pass a blank grid to get a plain coordinate view.
 */
function preview(theme, grid, suffix = 'overlay') {
    const buf = Buffer.from(rgbAt(theme, SRC_W, SRC_H));
    const cw = SRC_W / GW, ch = SRC_H / GH;
    for (let y = 0; y < SRC_H; y++) {
        const gy = Math.min(GH - 1, Math.floor(y / ch));
        for (let x = 0; x < SRC_W; x++) {
            const gx = Math.min(GW - 1, Math.floor(x / cw));
            const p = (y * SRC_W + x) * 3;
            if (grid[gy][gx]) {
                buf[p] = Math.min(255, buf[p] * 0.45 + 150);
                buf[p + 1] *= 0.45;
                buf[p + 2] *= 0.45;
            }
            const onX = x % cw < 1, onY = y % ch < 1;
            const major = (onX && gx % 5 === 0) || (onY && gy % 5 === 0);
            if (major) { buf[p] = 255; buf[p + 1] = 230; buf[p + 2] = 40; }
            else if (onX || onY) { buf[p] = 235; buf[p + 1] = 235; buf[p + 2] = 235; }
        }
    }
    const dir = path.join(ROOT, 'maps', '_grid');
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `${theme}-${suffix}.png`);
    execFileSync(ffmpeg, [
        '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
        '-s', `${SRC_W}x${SRC_H}`, '-i', '-', '-vf', 'scale=900:506', out
    ], { input: buf });
    return out;
}

/** Serialise every grid to maps/map-grids.js. */
function writeGrids(grids, note) {
    let s = '// Collision grids for the painted dungeon maps (maps/<theme>.png).\n';
    s += '// 0 = floor, 1 = wall.\n';
    s += `// ${note}\n`;
    s += `// Grid is ${GW}x${GH} - the tile pitch the map art is drawn on.\n`;
    s += 'const MAP_GRIDS = {\n';
    THEMES.forEach((t, i) => {
        s += `    ${t}: [\n`;
        s += grids[t].map(r => '        [' + r.join(',') + ']').join(',\n');
        s += `\n    ]${i < THEMES.length - 1 ? ',' : ''}\n`;
    });
    s += '};\n\nif (typeof window !== \'undefined\') window.MAP_GRIDS = MAP_GRIDS;\n';
    const out = path.join(ROOT, 'maps', 'map-grids.js');
    fs.writeFileSync(out, s);
    return out;
}

module.exports = { ROOT, GW, GH, SRC_W, SRC_H, THEMES, inBounds, blank,
                   rgbAt, sealUnreachable, ascii, preview, writeGrids };
