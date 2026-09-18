/**
 * Wall detector for the painted dungeon maps.
 *
 * Every one of the five maps is built the same way: a decorative stone frame
 * around the edge, an open floor carrying props the knights are meant to walk
 * over, and a central chamber outlined somewhere around x 11-24, y 7-17.
 *
 * The outline only reads reliably on magma, where it is painted as bright lava.
 * On the other four it is a faint shadow seam no stronger than the seams between
 * floor props, so those layouts are hand-authored instead - see
 * tools/author-map-grids.js, which is what actually writes maps/map-grids.js.
 *
 * The detector marks a cell as wall when its luma differs from the median of its
 * own 7x7 neighbourhood by more than `delta` - locally, because these maps have
 * large dimly-lit chambers whose floor is as dark as another map's walls - and
 * then drops blobs smaller than `minBlob` as prop-shadow speckle.
 *
 * Usage:  node tools/derive-map-grid.js [theme ...]   # ASCII + overlay preview
 */
const L = require('./map-grid-lib');

const TUNING = {
    crypts: { delta: 9,  minBlob: 5 },
    magma:  { delta: 20, minBlob: 4 },
    mines:  { delta: 13, minBlob: 5 },
    temple: { delta: 13, minBlob: 5 },
    void:   { delta: 11, minBlob: 5 }
};

/** Flood the wall cells into connected blobs and drop the small ones. */
function dropSmallBlobs(grid, minBlob) {
    const seen = grid.map(r => r.map(() => false));
    for (let y = 0; y < L.GH; y++) {
        for (let x = 0; x < L.GW; x++) {
            if (grid[y][x] !== 1 || seen[y][x]) continue;
            const blob = [], queue = [[x, y]];
            seen[y][x] = true;
            while (queue.length) {
                const [cx, cy] = queue.pop();
                blob.push([cx, cy]);
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const nx = cx + dx, ny = cy + dy;
                    if (L.inBounds(nx, ny) && !seen[ny][nx] && grid[ny][nx] === 1) {
                        seen[ny][nx] = true; queue.push([nx, ny]);
                    }
                }
            }
            if (blob.length < minBlob) blob.forEach(([bx, by]) => grid[by][bx] = 0);
        }
    }
}

function deriveGrid(theme) {
    const { delta, minBlob } = TUNING[theme];
    const SS = 8, W = L.GW * SS, H = L.GH * SS;
    const buf = L.rgbAt(theme, W, H);

    // Pass 1 – local-luma deviation  (bright lava, dark shadow)
    const luma = [];
    for (let gy = 0; gy < L.GH; gy++) {
        for (let gx = 0; gx < L.GW; gx++) {
            let r = 0, g = 0, b = 0;
            for (let j = 0; j < SS; j++) {
                for (let i = 0; i < SS; i++) {
                    const p = ((gy * SS + j) * W + gx * SS + i) * 3;
                    r += buf[p]; g += buf[p + 1]; b += buf[p + 2];
                }
            }
            luma.push((0.299 * r + 0.587 * g + 0.114 * b) / (SS * SS));
        }
    }

    const R = 3;
    const grid = L.blank();
    for (let y = 1; y < L.GH - 1; y++) {
        for (let x = 1; x < L.GW - 1; x++) {
            const win = [];
            for (let j = -R; j <= R; j++) {
                for (let i = -R; i <= R; i++) {
                    const nx = x + i, ny = y + j;
                    if (nx > 0 && nx < L.GW - 1 && ny > 0 && ny < L.GH - 1) win.push(luma[ny * L.GW + nx]);
                }
            }
            win.sort((a, b) => a - b);
            if (Math.abs(luma[y * L.GW + x] - win[win.length >> 1]) >= delta) grid[y][x] = 1;
        }
    }

    // Pass 2 – drop bright point-light cells (torch sconces, font pools) that
    // the luma pass tagged as walls. Real structural walls have strong spatial
    // contrast across the cell; point lights have low edge energy.
    const EDGE_DROP = theme === 'magma' ? 3.5 : 5;
    for (let gy = 0; gy < L.GH; gy++) {
        for (let gx = 0; gx < L.GW; gx++) {
            if (grid[gy][gx] !== 1) continue;
            let edge = 0;
            for (let j = 0; j < SS; j++) {
                for (let i = 0; i < SS; i++) {
                    const x = gx * SS + i, y = gy * SS + j;
                    const a = buf[(y * W + x) * 3];
                    edge += (x + 1 < W ? Math.abs(a - buf[(y * W + x + 1) * 3]) : 0)
                          + (y + 1 < H ? Math.abs(a - buf[((y + 1) * W + x) * 3]) : 0);
                }
            }
            if (edge / (SS * SS) < EDGE_DROP) grid[gy][gx] = 0;
        }
    }

    dropSmallBlobs(grid, minBlob);

    for (let x = 0; x < L.GW; x++) { grid[0][x] = 1; grid[L.GH - 1][x] = 1; }
    for (let y = 0; y < L.GH; y++) { grid[y][0] = 1; grid[y][L.GW - 1] = 1; }
    for (let y = 1; y < 5; y++) for (let x = 1; x < 5; x++) grid[y][x] = 0;

    L.sealUnreachable(grid);
    return grid;
}

module.exports = { deriveGrid, TUNING };

if (require.main === module) {
    const themes = process.argv.slice(2).filter(a => !a.startsWith('-'));
    for (const theme of (themes.length ? themes : L.THEMES)) {
        const grid = deriveGrid(theme);
        const walls = grid.flat().filter(v => v === 1).length;
        console.log(`\n=== ${theme}  walls ${walls}/${L.GW * L.GH} (${(100 * walls / (L.GW * L.GH)).toFixed(0)}%)`);
        console.log(L.ascii(grid));
        console.log(L.preview(theme, grid, 'derived'));
    }
}
