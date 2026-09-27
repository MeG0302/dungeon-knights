/**
 * Bake the dungeon map surfaces.
 *
 *   node tools/bake-map-surfaces.js            # write the baked surfaces + the manifest
 *   node tools/bake-map-surfaces.js --report   # sizes only, write nothing
 *
 * The kit's art is beautiful and enormous: the crypts floor tile alone is
 * 2.5 MB at 1636x1636, the border and corner pieces are 2-3 MB each, and the
 * game draws every one of them at a 30-40px tile pitch. Loading that cost the
 * map about 20 MB — more than the mp4 backdrops this replaced — for pixels no
 * screen can show. This tool downscales each piece once, at a size the renderer
 * can actually use (2x the tile pitch for tiles, 96px for props), and writes the
 * manifest the renderer and the loading gate read together:
 *
 *   public/assets/<theme>/surface/*.png
 *   public/maps/map-surfaces.js          (window.MAP_SURFACES)
 *
 * Sizes are chosen off the engine's tile pitch (40px): tiles at 80px so retina
 * screens and zoomed canvases still resolve them, the floor texture at 192px so
 * a 36-tile-wide arena repeats it eight times instead of 36. Nothing here needs
 * ffmpeg: `tools/derive-map-grid.js` does, and there is no ffmpeg-static in this
 * checkout, so the PNG work is done by `tools/png-tools.js` instead.
 */
const fs = require('fs');
const path = require('path');
const { decode, encode, resize, fit } = require('./png-tools');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const REPORT_ONLY = process.argv.includes('--report');

const FLOOR_SIZE = 192;   // one repeat per ~5 tiles at the 40px pitch
const TILE_SIZE = 80;     // 2x the tile pitch: rims, corners, wall pieces
const PROP_SIZE = 96;     // bigger than a tile on purpose: props overhang

const bytes = (n) => n >= 1048576 ? (n / 1048576).toFixed(2) + ' MB' : (n / 1024).toFixed(0) + ' KB';

/** Resolve a source file by prefix — the kit's names carry mojibake and spaces. */
function pick(dir, prefix) {
    const full = path.join(ROOT, dir);
    const hit = fs.readdirSync(full).find((f) => f.startsWith(prefix));
    if (!hit) throw new Error(`no file starting with "${prefix}" in ${dir}`);
    return path.join(dir, hit);
}

const asset = (theme, name) => path.posix.join('assets', theme, name);

/**
 * What every theme's surface is made of.
 *
 * tiles/floor come from the theme's own kit in public/assets/<theme>/ — the same
 * pieces the engine has been loading since the painted maps were introduced.
 * Props are the small objects the kit drew for that theme; crypts has none of
 * its own under public/, so its three come from the source kit in `maps
 * elements/` (the folder the public copies were made from: the same artwork,
 * same dimensions, 1466x1467 and 1413x1708).
 */
const THEMES = {
    crypts: {
        floor: asset('crypts', 'floor-tile.png'),
        rimH: asset('crypts', 'border-horizontal.png'),
        rimV: asset('crypts', 'border-vertical.png'),
        corners: {
            tl: asset('crypts', 'corner-tl.png'),
            tr: asset('crypts', 'corner-tr.png'),
            bl: asset('crypts', 'corner-bl.png'),
            br: asset('crypts', 'corner-br.png')
        },
        props: {
            torch: pick('maps elements', 'Stone_wall_tile_with_torch'),
            block: pick('maps elements', 'Stone_brick_corner_decoration_2K_'),
            decor: pick('maps elements', 'Skull_resource_icon_pixel_art'),
            crypt: pick('maps elements', 'Crypt_corner_pixel_art_decoration')
        }
    },
    mines: {
        floor: asset('mines', 'floor-tile.png'),
        rimH: asset('mines', 'border-horizontal.png'),
        rimV: asset('mines', 'border-vertical.png'),
        corners: {
            tl: asset('mines', 'corner-tl.png'),
            tr: asset('mines', 'corner-tr.png'),
            bl: asset('mines', 'corner-bl.png'),
            br: asset('mines', 'corner-br.png')
        },
        props: {
            block: pick('public/assets/mines', 'Pixel_art_corner_decoration'),
            decor: pick('public/assets/mines', 'Glowing_green_emerald_crystal'),
            flower: pick('public/assets/mines', 'Tropical_jungle_flower')
        }
    },
    magma: {
        floor: asset('magma', 'floor-tile.png'),
        rimH: asset('magma', 'border-horizontal.png'),
        rimV: asset('magma', 'border-vertical.png'),
        corners: {
            tl: asset('magma', 'corner-tl.png'),
            tr: asset('magma', 'corner-tr.png'),
            bl: asset('magma', 'corner-bl.png'),
            br: asset('magma', 'corner-br.png')
        },
        props: {
            torch: pick('public/assets/magma', 'Magma_chamber_flame'),
            block: pick('public/assets/magma', 'Lava_rock_corner_decoration'),
            decor: pick('public/assets/magma', 'Flame_lava_drop')
        }
    },
    temple: {
        floor: asset('temple', 'floor-tile.png'),
        rimH: asset('temple', 'border-horizontal.png'),
        rimV: asset('temple', 'border-vertical.png'),
        corners: {
            tl: asset('temple', 'corner-tl.png'),
            tr: asset('temple', 'corner-tr.png'),
            bl: asset('temple', 'corner-bl.png'),
            br: asset('temple', 'corner-br.png')
        },
        props: {
            block: pick('public/assets/temple', 'Temple_corner_decoration'),
            decor: pick('public/assets/temple', 'Jungle_leaf_pixel_art_icon'),
            flower: pick('public/assets/temple', 'Corner_decoration_asset_pixel_art')
        }
    },
    void: {
        floor: asset('void', 'floor-tile.png'),
        rimH: asset('void', 'border-horizontal.png'),
        rimV: asset('void', 'border-vertical.png'),
        corners: {
            tl: asset('void', 'corner-tl.png'),
            tr: asset('void', 'corner-tr.png'),
            bl: asset('void', 'corner-bl.png'),
            br: asset('void', 'corner-br.png')
        },
        props: {
            block: pick('public/assets/void', 'Pixel_art_obsidian_shards_decora'),
            decor: pick('public/assets/void', 'Purple_void_energy_orb_icon'),
            shard: pick('public/assets/void', 'Obsidian_shards_floating_decoration')
        }
    }
};

/** Downscale one source into public/assets/<theme>/surface/<name>.png. */
function bakeOne(theme, name, src, width, height, mode) {
    const from = path.join(ROOT, src);
    const outDir = path.join(PUBLIC, 'assets', theme, 'surface');
    const out = path.join(outDir, `${name}.png`);
    const before = fs.statSync(from).size;
    const image = decode(fs.readFileSync(from));
    const scaled = mode === 'fit' ? fit(image, width, height) : resize(image, width, height);
    const encoded = encode(scaled);
    if (!REPORT_ONLY) {
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(out, encoded);
    }
    return { theme, name, from: src, out: path.posix.join('assets', theme, 'surface', `${name}.png`),
             w: scaled.w, h: scaled.h, before, after: encoded.length };
}

const manifest = {};
const rows = [];

for (const [theme, spec] of Object.entries(THEMES)) {
    const floor = bakeOne(theme, 'floor', spec.floor, FLOOR_SIZE, FLOOR_SIZE, 'resize');
    const rimH = bakeOne(theme, 'rim-h', spec.rimH, TILE_SIZE, TILE_SIZE, 'fit');
    const rimV = bakeOne(theme, 'rim-v', spec.rimV, TILE_SIZE, TILE_SIZE, 'fit');
    const corners = {};
    for (const [key, src] of Object.entries(spec.corners)) {
        corners[key] = bakeOne(theme, `corner-${key}`, src, TILE_SIZE, TILE_SIZE, 'fit');
    }
    const props = {};
    for (const [key, src] of Object.entries(spec.props)) {
        props[key] = bakeOne(theme, `prop-${key}`, src, PROP_SIZE, PROP_SIZE, 'fit');
    }

    manifest[theme] = {
        floor: floor.out,
        rimH: rimH.out,
        rimV: rimV.out,
        corners: Object.fromEntries(Object.entries(corners).map(([k, v]) => [k, v.out])),
        props: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v.out]))
    };

    rows.push(floor, rimH, rimV, ...Object.values(corners), ...Object.values(props));
    console.log(`\n${theme}`);
    rows.filter((r) => r.theme === theme).forEach((r) => {
        console.log(`  ${r.name.padEnd(12)} ${String(r.w).padStart(3)}x${String(r.h).padEnd(3)}  ` +
                    `${bytes(r.before).padStart(8)} -> ${bytes(r.after).padStart(7)}   ${r.from}`);
    });
}

const before = rows.reduce((n, r) => n + r.before, 0);
const after = rows.reduce((n, r) => n + r.after, 0);
console.log(`\nmap surfaces: ${rows.length} pieces, ${bytes(before)} -> ${bytes(after)} ` +
            `(${(100 * after / before).toFixed(1)}% of the source art)`);

const file = `// Baked dungeon map surfaces. Generated by tools/bake-map-surfaces.js — do not edit.
//
// The kit's art ships at 1400-1800px and 2-3 MB a piece; the engine draws it at a
// 40px tile pitch. This is the same artwork at the size the map can actually use:
// tiles at 80px (2x the pitch), props at 96px, the floor texture at 192px. Together
// the five themes weigh ${bytes(after)} instead of ${bytes(before)}.
//
// Keys: floor (tiled), rimH/rimV (the arena's edge, drawn as a pattern), corners
// {tl,tr,bl,br}, props (named per theme, referenced by maps/map-layouts.js).
const MAP_SURFACES = ${JSON.stringify(manifest, null, 4)};

if (typeof window !== 'undefined') window.MAP_SURFACES = MAP_SURFACES;
`;
if (!REPORT_ONLY) {
    fs.writeFileSync(path.join(PUBLIC, 'maps', 'map-surfaces.js'), file);
    console.log('wrote public/maps/map-surfaces.js');
}
