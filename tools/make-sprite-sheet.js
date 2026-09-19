#!/usr/bin/env node
/**
 * Turn a folder of animation frames into a sprite sheet the game can play.
 *
 * Every frame is normalised onto an equal square canvas first (scaled to fit,
 * padded with transparency, anchored bottom-centre so feet stay planted), then
 * the frames are tiled left-to-right into one horizontal strip. The result is
 * exactly what dungeon.js's SpriteSheet player expects.
 *
 * Requires ffmpeg on PATH. For extracting the frames from a video clip first,
 * see tools/ingest-animation-clip.js.
 *
 * Usage:
 *   node tools/make-sprite-sheet.js <frames-dir> <out.png> [options]
 *
 * Options:
 *   --size <px>        Frame canvas size (default 512)
 *   --id <sheetId>     Register the sheet in public/sprites/manifest.json,
 *                      e.g. --id knight:walk
 *   --fps <n>          Playback rate recorded in the manifest (default 10)
 *   --once             One-shot sheet (attack, chest-open). Default is looping.
 *   --manifest <path>  Manifest to update (default public/sprites/manifest.json)
 *
 * Examples:
 *   node tools/make-sprite-sheet.js frames/knight-walk public/sprites/knights/walk.png --id knight:walk
 *   node tools/make-sprite-sheet.js frames/knight-attack public/sprites/knights/attack.png --id knight:attack --once --fps 14
 */
const fs = require('fs');
const L = require('./sprite-sheet-lib');

function parseArgs(argv) {
    const positional = [];
    const options = { size: 512, fps: 10, loop: true, id: null, manifest: 'public/sprites/manifest.json' };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--size') options.size = Number(argv[++i]);
        else if (arg === '--fps') options.fps = Number(argv[++i]);
        else if (arg === '--id') options.id = argv[++i];
        else if (arg === '--manifest') options.manifest = argv[++i];
        else if (arg === '--once') options.loop = false;
        else if (arg === '--loop') options.loop = true;
        else if (arg.startsWith('--')) L.fail(`Unknown option: ${arg}`);
        else positional.push(arg);
    }

    if (positional.length < 2) {
        L.fail('Usage: node tools/make-sprite-sheet.js <frames-dir> <out.png> [--size 512] [--id knight:walk] [--fps 10] [--once]');
    }
    if (!Number.isFinite(options.size) || options.size <= 0) L.fail('--size must be a positive number');
    if (!Number.isFinite(options.fps) || options.fps <= 0) L.fail('--fps must be a positive number');

    return { framesDir: positional[0], outFile: positional[1], options };
}

function main() {
    const { framesDir, outFile, options } = parseArgs(process.argv.slice(2));
    L.requireFfmpeg();

    const frames = L.collectFrames(framesDir);
    if (frames.length === 1) {
        console.warn('⚠️  Only one frame found — a single-frame sheet renders as a still image.');
    }
    console.log(`\n🎞️  Building sprite sheet from ${frames.length} frame(s) in ${framesDir}`);

    const entries = frames.map(name => require('path').join(framesDir, name));
    const tempDir = L.makeTempDir();
    try {
        L.normaliseFrames(entries, options.size, tempDir);
        L.tileFrames(tempDir, outFile, entries.length);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }

    L.registerInManifest({
        id: options.id,
        outFile,
        fps: options.fps,
        loop: options.loop,
        count: entries.length,
        manifestPath: options.manifest
    });

    console.log(`\n✅ Done. Strip: ${outFile} (${options.size * entries.length}×${options.size})`);
    if (!options.id) console.log('   Tip: pass --id knight:walk (etc.) to register it automatically.');
}

main();
