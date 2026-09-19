#!/usr/bin/env node
/**
 * Turn an animation clip (or a folder of frames) into a registered sprite sheet.
 *
 * This is the last mile of the workflow in docs/SPRITE-SHEETS.md: point it at
 * the clip an image-to-video model produced, or at a folder of frames you have
 * already cut out, and it extracts/normalises/tiles the strip and registers it
 * in public/sprites/manifest.json so the game plays real frames.
 *
 * Requires ffmpeg on PATH.
 *
 * Usage:
 *   node tools/ingest-animation-clip.js --clip <video> [clip options] <sheet options>
 *   node tools/ingest-animation-clip.js --dir <frames-dir> <sheet options>
 *
 * Clip options:
 *   --start <sec>          Start time (default 0)
 *   --end <sec>            End time (default: end of clip)
 *   --fps <n>              Sampling rate for extraction (default 10)
 *   --crop <w:h:x:y>       Fixed crop — keeps the character aligned between
 *                          frames; use the same crop for every frame
 *
 * Background removal:
 *   --key auto             Sample the top-left pixel of the first frame and key
 *                          that colour out (flat/green-screen backdrops)
 *   --key 0x00ff00         Key a specific colour
 *   --key none             Keep the background (default)
 *   --key-similarity <n>   colorkey similarity (default 0.28)
 *   --key-blend <n>        colorkey blend/soft edge (default 0.12)
 *
 * Sheet options:
 *   --id <sheetId>         Register the sheet, e.g. --id knight:attack
 *   --frames <n>           Keep at most n evenly-spaced frames (default: all)
 *   --size <px>            Frame canvas size (default 512)
 *   --fps-out <n>          Playback rate in the manifest (default 12)
 *   --once                 One-shot sheet (attack, chest-open). Default: looping
 *   --manifest <path>      Manifest to update (default public/sprites/manifest.json)
 *   --out <path>           Output strip path (default public/sprites/<id>.png)
 *
 * Examples:
 *   node tools/ingest-animation-clip.js --clip art/knights/walk.mp4 --key auto \
 *     --start 1.2 --end 3.0 --fps 12 --frames 8 --id knight:walk
 *   node tools/ingest-animation-clip.js --dir art/knights/attack-raw \
 *     --frames 6 --id knight:attack --once --fps-out 14
 */
const fs = require('fs');
const path = require('path');
const L = require('./sprite-sheet-lib');

function parseArgs(argv) {
    const options = {
        clip: null, dir: null, start: 0, end: null, sampleFps: 10, crop: null,
        key: 'none', similarity: 0.28, blend: 0.12,
        id: null, frames: 0, size: 512, fpsOut: 12, loop: true,
        manifest: 'public/sprites/manifest.json', out: null
    };

    const numeric = {
        '--start': 'start', '--end': 'end', '--fps': 'sampleFps',
        '--key-similarity': 'similarity', '--key-blend': 'blend',
        '--frames': 'frames', '--size': 'size', '--fps-out': 'fpsOut'
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (numeric[arg]) options[numeric[arg]] = Number(argv[++i]);
        else if (arg === '--clip') options.clip = argv[++i];
        else if (arg === '--dir') options.dir = argv[++i];
        else if (arg === '--crop') options.crop = argv[++i];
        else if (arg === '--key') options.key = argv[++i];
        else if (arg === '--id') options.id = argv[++i];
        else if (arg === '--manifest') options.manifest = argv[++i];
        else if (arg === '--out') options.out = argv[++i];
        else if (arg === '--once') options.loop = false;
        else if (arg === '--loop') options.loop = true;
        else L.fail(`Unknown option: ${arg}`);
    }

    if (!options.clip && !options.dir) {
        L.fail('Provide either --clip <video> or --dir <frames-dir>.\n' +
               'Example: node tools/ingest-animation-clip.js --clip art/knights/walk.mp4 --key auto --id knight:walk');
    }
    for (const key of ['sampleFps', 'size', 'fpsOut']) {
        if (!Number.isFinite(options[key]) || options[key] <= 0) L.fail(`--${key} must be a positive number`);
    }
    if (options.crop && !/^\d+:\d+:\d+:\d+$/.test(options.crop)) {
        L.fail('--crop must look like w:h:x:y, e.g. --crop 820:900:150:120');
    }

    return options;
}

function extractFromClip(options, tempDir) {
    if (!fs.existsSync(options.clip)) L.fail(`Clip not found: ${options.clip}`);

    const args = ['-y', '-v', 'error'];
    if (options.start) args.push('-ss', String(options.start));
    args.push('-i', options.clip);
    if (options.end) args.push('-t', String(Math.max(0.05, options.end - options.start)));

    const filters = [`fps=${options.sampleFps}`];
    if (options.crop) filters.push(`crop=${options.crop}`);
    args.push('-vf', filters.join(','));
    args.push(path.join(tempDir, 'src_%03d.png'));

    console.log(`\n🎬 Extracting frames from ${options.clip}` +
        `${options.crop ? ` (crop ${options.crop})` : ''} at ${options.sampleFps}fps`);
    L.ffmpeg(args);

    const extracted = fs.readdirSync(tempDir).filter(n => /^src_\d+\.png$/.test(n)).sort();
    if (extracted.length === 0) L.fail('No frames extracted — check --start/--end and the clip path.');

    // Keying needs a second pass; do it in place so ordering is preserved
    let entries = extracted.map(name => path.join(tempDir, name));
    if (options.key && options.key !== 'none') {
        const color = options.key === 'auto' ? L.samplePixel(entries[0]).hex : options.key;
        console.log(`🎨 Keying out ${options.key === 'auto' ? `${color} (auto-sampled)` : color}`);
        entries = entries.map((src, index) => {
            const dest = path.join(tempDir, `keyed_${String(index).padStart(3, '0')}.png`);
            L.keyBackground(src, dest, { color, similarity: options.similarity, blend: options.blend });
            return dest;
        });
    }

    console.log(`   extracted ${entries.length} frame(s)`);
    return entries;
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    L.requireFfmpeg();

    const tempDir = L.makeTempDir('ingest-');
    try {
        let entries = options.dir
            ? L.collectFrames(options.dir).map(name => path.join(options.dir, name))
            : extractFromClip(options, tempDir);

        if (entries.length === 1) {
            console.warn('⚠️  Only one frame available — a single-frame sheet renders as a still image.');
        }

        const picked = L.pickEvenly(entries, options.frames);
        if (picked.length !== entries.length) {
            console.log(`✂️  Keeping ${picked.length} of ${entries.length} frame(s)`);
        }
        if (picked.length < 4) {
            console.warn('⚠️  Fewer than 4 frames — the animation will look choppy. Sample more frames from the clip.');
        }

        const outFile = options.out
            || `public/sprites/${(options.id || 'sheet').replace(/[:]/g, '-')}.png`;

        const normaliseDir = L.makeTempDir('norm-');
        try {
            L.normaliseFrames(picked, options.size, normaliseDir);
            L.tileFrames(normaliseDir, outFile, picked.length);
        } finally {
            fs.rmSync(normaliseDir, { recursive: true, force: true });
        }

        L.registerInManifest({
            id: options.id,
            outFile,
            fps: options.fpsOut,
            loop: options.loop,
            count: picked.length,
            manifestPath: options.manifest
        });

        console.log(`\n✅ Done. Strip: ${outFile} (${options.size * picked.length}×${options.size})`);
        if (!options.id) console.log('   Tip: pass --id knight:walk (etc.) to register it automatically.');
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

main();
