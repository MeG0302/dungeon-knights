/**
 * Extract one still frame from each dungeon map video into maps/<theme>.png
 *
 * The videos are static-camera top-down maps; frame-to-frame change is almost
 * entirely MP4 compression shimmer on the pixel-art edges, so a single frame
 * carries the whole map. Run:  node tools/extract-map-frames.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('ffmpeg-static');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'maps', 'main vid');
const OUT = path.join(ROOT, 'maps');

// dungeon.js theme key -> source video
const MAPPING = {
    crypts: 'Pixel_art_dungeon_map_animation_20260918044104_processed.mp4',
    magma: 'Pixel_art_magma_dungeon_map_20260918044059_processed.mp4',
    mines: 'goblin mine.mp4',
    temple: 'overgrown temple.mp4',
    void: 'void rift.mp4'
};

const AT = '1.0'; // seconds; content is static so any frame works

for (const [theme, file] of Object.entries(MAPPING)) {
    const src = path.join(SRC, file);
    const dst = path.join(OUT, `${theme}.png`);

    if (!fs.existsSync(src)) {
        console.error(`MISSING source for ${theme}: ${file}`);
        continue;
    }

    execFileSync(ffmpeg, [
        '-y',
        '-ss', AT,
        '-i', src,
        '-frames:v', '1',
        dst
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    const kb = (fs.statSync(dst).size / 1024).toFixed(0);
    console.log(`${theme.padEnd(7)} <- ${file.padEnd(58)} ${kb} KB`);
}
