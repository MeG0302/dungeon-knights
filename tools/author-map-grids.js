/**
 * Author the collision grids for the painted dungeon maps and write
 * maps/map-grids.js.
 *
 * All five maps share a layout motif: a decorative stone frame around the edge,
 * an open floor of walkable props, and a central chamber outlined around
 * x 11-24, y 7-17. Magma paints that outline as bright lava, so its grid is
 * traced straight off the art by tools/derive-map-grid.js. On the other four the
 * outline is a faint shadow seam that no detector separates from the seams
 * between floor props, so their chambers are laid out here by hand, on the same
 * anchor the art uses, with per-map doorways and features.
 *
 * Walls are placed only where the art already reads as solid, so the knights
 * never stop against empty floor.
 *
 * Usage:
 *   node tools/author-map-grids.js             # write maps/map-grids.js
 *   node tools/author-map-grids.js --preview   # also write overlay PNGs
 */
const L = require('./map-grid-lib');
const { deriveGrid } = require('./derive-map-grid');

// The chamber the art outlines on every map.
const CX1 = 11, CX2 = 24, CY1 = 7, CY2 = 17;

const hline = (g, x1, x2, y) => { for (let x = x1; x <= x2; x++) g[y][x] = 1; };
const vline = (g, x, y1, y2) => { for (let y = y1; y <= y2; y++) g[y][x] = 1; };
const rect  = (g, x1, y1, x2, y2) => {
    hline(g, x1, x2, y1); hline(g, x1, x2, y2);
    vline(g, x1, y1, y2); vline(g, x2, y1, y2);
};
const carve = (g, x1, y1, x2, y2) => {
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) g[y][x] = 0;
};

function frame(g) {
    for (let x = 0; x < L.GW; x++) { g[0][x] = 1; g[L.GH - 1][x] = 1; }
    for (let y = 0; y < L.GH; y++) { g[y][0] = 1; g[y][L.GW - 1] = 1; }
}

const AUTHORED = {
    // Shadowed sarcophagus hall. The chamber outline is closed except for a
    // door on each side, so the vault reads as a sealed crypt with four ways in.
    crypts() {
        const g = L.blank();
        frame(g);
        rect(g, CX1, CY1, CX2, CY2);
        carve(g, 17, CY1, 18, CY1);          // north door
        carve(g, 17, CY2, 18, CY2);          // south door
        carve(g, CX1, 11, CX1, 12);          // west door
        carve(g, CX2, 11, CX2, 12);          // east door
        // the two shadowed pillars standing inside the vault
        rect(g, 14, 10, 15, 13);
        rect(g, 20, 10, 21, 13);
        return g;
    },

    // Bright lava channels - the one map whose walls are painted plainly enough
    // to trace straight off the art.
    magma() {
        return deriveGrid('magma');
    },

    // Open cavern: rock columns rising out of the water, staggered so the
    // knights have to weave rather than walk one straight lane.
    mines() {
        const g = L.blank();
        frame(g);
        vline(g, 10, 4, 12);
        vline(g, 14, 8, 16);
        vline(g, 18, 3, 11);
        vline(g, 22, 8, 16);
        vline(g, 26, 4, 12);
        // the flooded basin in the middle of the cavern
        rect(g, 15, 5, 17, 6);
        rect(g, 19, 13, 21, 14);
        return g;
    },

    // Overgrown sanctum. The art leaves the chamber's south wall wide open, so
    // the layout keeps only the corner stubs there.
    temple() {
        const g = L.blank();
        frame(g);
        hline(g, CX1, CX2, CY1);
        vline(g, CX1, CY1, CY2);
        vline(g, CX2, CY1, CY2);
        hline(g, CX1, 13, CY2);
        hline(g, 22, CX2, CY2);
        carve(g, 17, CY1, 18, CY1);          // north door
        carve(g, CX1, 12, CX1, 13);          // west door
        // root-choked alcoves off the sanctum's inner walls
        rect(g, 13, 9, 14, 10);
        rect(g, 21, 14, 22, 15);
        return g;
    },

    // Void rift. The tendrils tear the chamber outline open on both flanks, so
    // the walls come in broken runs rather than a closed rectangle.
    void() {
        const g = L.blank();
        frame(g);
        vline(g, CX1, CY1, 11);
        vline(g, CX1, 14, CY2);
        vline(g, CX2, CY1, 10);
        vline(g, CX2, 13, CY2);
        hline(g, CX1, 16, CY1);
        hline(g, 19, CX2, CY1);
        hline(g, CX1, 15, CY2);
        hline(g, 20, CX2, CY2);
        // the rift core, an island the knights have to walk around
        rect(g, 16, 11, 19, 13);
        return g;
    }
};

const grids = {};
for (const theme of L.THEMES) {
    const g = AUTHORED[theme]();
    for (let y = 1; y < 5; y++) for (let x = 1; x < 5; x++) g[y][x] = 0;   // spawn corner
    const orphaned = L.sealUnreachable(g);
    grids[theme] = g;

    const walls = g.flat().filter(v => v === 1).length;
    console.log(`\n=== ${theme}  walls ${walls}/${L.GW * L.GH} ` +
                `(${(100 * walls / (L.GW * L.GH)).toFixed(0)}%)  sealed-off ${orphaned}`);
    console.log(L.ascii(g));
    if (process.argv.includes('--preview')) console.log(L.preview(theme, g, 'authored'));
}

console.log('\nwrote ' + L.writeGrids(grids, 'Authored with tools/author-map-grids.js.'));
