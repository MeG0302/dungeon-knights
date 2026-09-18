/**
 * Print two per-cell feature maps for one dungeon map, as percentile digits 0-9.
 *
 *   brightness  - mean luma of the cell (dark floor vs lit object)
 *   edge        - mean gradient magnitude (flat floor vs structured object)
 *
 * Used to pick a detector that finds the *objects* in the art rather than the
 * shadow gaps between them.  Usage: node tools/probe-map-features.js crypts
 */
const { execFileSync } = require('child_process');
const path = require('path');
const ffmpeg = require('ffmpeg-static');

const ROOT = path.join(__dirname, '..');
const GW = 36, GH = 20, SS = 8;
const W = GW * SS, H = GH * SS;

const theme = process.argv[2] || 'crypts';

const buf = execFileSync(ffmpeg, [
    '-v', 'error', '-i', path.join(ROOT, 'maps', `${theme}.png`),
    '-vf', `scale=${W}:${H}:flags=area`,
    '-f', 'rawvideo', '-pix_fmt', 'gray', '-'
], { maxBuffer: 1 << 26 });

const at = (x, y) => buf[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];

const bright = [], edge = [];
for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
        let sum = 0, grad = 0;
        for (let j = 0; j < SS; j++) {
            for (let i = 0; i < SS; i++) {
                const x = gx * SS + i, y = gy * SS + j;
                sum += at(x, y);
                grad += Math.abs(at(x + 1, y) - at(x, y)) + Math.abs(at(x, y + 1) - at(x, y));
            }
        }
        bright.push(sum / (SS * SS));
        edge.push(grad / (SS * SS));
    }
}

function digits(vals) {
    const sorted = [...vals].sort((a, b) => a - b);
    const rank = v => {
        let lo = 0, hi = sorted.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
        return Math.min(9, Math.floor(10 * lo / sorted.length));
    };
    const head = '    ' + [...Array(GW).keys()].map(i => i % 10).join('');
    const rows = [];
    for (let y = 0; y < GH; y++) {
        rows.push(String(y).padStart(3) + ' ' +
            vals.slice(y * GW, y * GW + GW).map(v => rank(v)).join(''));
    }
    return [head, ...rows].join('\n');
}

const stat = v => `min ${Math.min(...v).toFixed(1)} max ${Math.max(...v).toFixed(1)}`;
console.log(`=== ${theme} brightness (${stat(bright)})`);
console.log(digits(bright));
console.log(`\n=== ${theme} edge energy (${stat(edge)})`);
console.log(digits(edge));
