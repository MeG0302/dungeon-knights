/**
 * Shared helpers for building sprite sheets (see docs/SPRITE-SHEETS.md).
 *
 * Used by tools/make-sprite-sheet.js (frames already on disk) and
 * tools/ingest-animation-clip.js (frames extracted from a video clip).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

function fail(message) {
    console.error(`\n❌ ${message}\n`);
    process.exit(1);
}

function ffmpeg(args, options = {}) {
    return execFileSync('ffmpeg', args, { stdio: 'pipe', ...options });
}

function requireFfmpeg() {
    try {
        execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    } catch {
        fail('ffmpeg not found on PATH. Install it (https://ffmpeg.org) and re-run.');
    }
}

function collectFrames(framesDir) {
    if (!fs.existsSync(framesDir)) fail(`Frames folder not found: ${framesDir}`);
    const frames = fs
        .readdirSync(framesDir)
        .filter(name => IMAGE_EXT.test(name))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (frames.length === 0) fail(`No image frames found in ${framesDir}`);
    return frames;
}

/** Keep at most `count` frames, spread evenly and always keeping first + last. */
function pickEvenly(frames, count) {
    if (!count || count >= frames.length) return frames;
    if (count < 2) return [frames[Math.floor(frames.length / 2)]];

    const picked = [];
    for (let i = 0; i < count; i++) {
        const index = Math.round((i * (frames.length - 1)) / (count - 1));
        picked.push(frames[index]);
    }
    return [...new Set(picked)];
}

/**
 * Read the colour of a single pixel (default top-left) as 0xRRGGBB — used to
 * auto-detect a flat backdrop for chroma keying.
 */
function samplePixel(imagePath, x = 0, y = 0) {
    const out = ffmpeg([
        '-v', 'error',
        '-i', imagePath,
        '-vf', `crop=1:1:${x}:${y}`,
        '-frames:v', '1',
        '-f', 'rawvideo',
        '-pix_fmt', 'rgb24',
        'pipe:1'
    ]);
    const [r, g, b] = out;
    return { r, g, b, hex: `0x${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}` };
}

/** Remove a flat background colour, leaving alpha behind. */
function keyBackground(src, dest, { color, similarity = 0.28, blend = 0.12 }) {
    ffmpeg([
        '-y', '-v', 'error',
        '-i', src,
        '-vf', `colorkey=${color}:${similarity}:${blend}`,
        '-pix_fmt', 'rgba',
        dest
    ]);
}

/**
 * Fit a frame onto a square canvas without distortion, anchored bottom-centre
 * so the character's feet stay on one line across the whole sheet.
 */
function normaliseFrame(src, dest, size) {
    ffmpeg([
        '-y', '-v', 'error',
        '-i', src,
        '-vf', [
            `scale=${size}:${size}:force_original_aspect_ratio=decrease`,
            `pad=${size}:${size}:(ow-iw)/2:oh-ih:color=black@0`
        ].join(','),
        '-pix_fmt', 'rgba',
        dest
    ]);
}

function normaliseFrames(entries, size, tempDir, { quiet = false } = {}) {
    entries.forEach((entry, index) => {
        const out = path.join(tempDir, `f${String(index).padStart(3, '0')}.png`);
        if (!quiet) console.log(`   frame ${index + 1}/${entries.length}: ${path.basename(entry)}`);
        normaliseFrame(entry, out, size);
    });
}

function tileFrames(tempDir, outFile, count) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    console.log(`\n🧵 Tiling ${count} frame(s) -> ${outFile}`);
    ffmpeg([
        '-y', '-v', 'error',
        '-framerate', '1',
        '-i', path.join(tempDir, 'f%03d.png'),
        '-filter_complex', `tile=${count}x1`,
        '-frames:v', '1',
        '-pix_fmt', 'rgba',
        outFile
    ]);
}

function registerInManifest({ id, outFile, fps, loop, count, manifestPath }) {
    if (!id) return;

    let manifest = { sheets: [] };
    if (fs.existsSync(manifestPath)) {
        try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch {
            fail(`${manifestPath} is not valid JSON — fix it or run without --id`);
        }
    }
    if (!Array.isArray(manifest.sheets)) manifest.sheets = [];

    // The game serves public/ at the site root, so strip that prefix from src
    const src = outFile.split(path.sep).join('/').replace(/^public\//, '');
    const entry = { id, src, frames: count, fps, loop };

    const existing = manifest.sheets.findIndex(sheet => sheet && sheet.id === id);
    if (existing >= 0) manifest.sheets[existing] = entry;
    else manifest.sheets.push(entry);

    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`📝 Registered "${id}" in ${manifestPath}`);
    console.log(`   ${count} frame(s) × ${fps}fps, ${loop ? 'looping' : 'one-shot'}`);
}

function makeTempDir(prefix = 'sheet-') {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

module.exports = {
    IMAGE_EXT,
    fail,
    ffmpeg,
    requireFfmpeg,
    collectFrames,
    pickEvenly,
    samplePixel,
    keyBackground,
    normaliseFrame,
    normaliseFrames,
    tileFrames,
    registerInManifest,
    makeTempDir
};
