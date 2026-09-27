/**
 * The smallest PNG kit that can turn a 2K artwork into a 192px texture.
 *
 * The dungeon kit's art is 1400-1800px PNGs of 2-3 MB each, and the game draws
 * them at a 40px tile pitch. Shipping them at source size cost the map more
 * bandwidth than the mp4 backdrops it replaced, so `tools/bake-map-surfaces.js`
 * downscales them once, here, with no image dependency: the repo has no
 * ffmpeg-static installed and the map tools that need it cannot run.
 *
 * What it supports is exactly what the kit is: 8-bit truecolour PNGs, with or
 * without alpha, not interlaced (every file in `public/assets/<theme>/` and
 * `maps elements/` is colourType 6 / depth 8 / interlace 0 — see the bake tool's
 * header). Anything else throws rather than guessing.
 *
 *   decode(buf)              -> { w, h, bpp, data }   // RGBA rows, top down
 *   encode({w,h,data})       -> Buffer                // colourType 6, one IDAT
 *   resize(src, ow, oh)      -> { w, h, data }        // area-average, premultiplied
 *   fit(src, boxW, boxH)     -> { w, h, data }        // resize inside the box, centred, transparent
 *   lut(src, fn)             -> { w, h, data }        // per-pixel RGBA rewrite
 */
const zlib = require('zlib');

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// --------------------------------------------------------------------- crc32
const CRC = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
    }
    return table;
})();

function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

// --------------------------------------------------------------------- decode
function decode(buf) {
    if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('not a PNG');
    let i = 8;
    let w = 0, h = 0, depth = 0, colorType = 0, interlace = 0;
    const idat = [];
    while (i + 8 <= buf.length) {
        const len = buf.readUInt32BE(i);
        const type = buf.toString('latin1', i + 4, i + 8);
        const data = buf.subarray(i + 8, i + 8 + len);
        if (type === 'IHDR') {
            w = data.readUInt32BE(0);
            h = data.readUInt32BE(4);
            depth = data[8];
            colorType = data[9];
            interlace = data[12];
        } else if (type === 'IDAT') {
            idat.push(data);
        } else if (type === 'IEND') {
            break;
        }
        i += 12 + len;
    }
    if (depth !== 8 || (colorType !== 6 && colorType !== 2) || interlace !== 0) {
        throw new Error(`unsupported PNG: depth ${depth}, colorType ${colorType}, interlace ${interlace}`);
    }

    const bpp = colorType === 6 ? 4 : 3;
    const stride = w * bpp;
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const data = Buffer.alloc(h * stride);

    let pos = 0;
    for (let y = 0; y < h; y++) {
        const filter = raw[pos++];
        const line = raw.subarray(pos, pos + stride);
        pos += stride;
        const cur = data.subarray(y * stride, (y + 1) * stride);
        const prev = y ? data.subarray((y - 1) * stride, y * stride) : null;
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? cur[x - bpp] : 0;
            const b = prev ? prev[x] : 0;
            const c = prev && x >= bpp ? prev[x - bpp] : 0;
            let v = line[x];
            if (filter === 1) v += a;
            else if (filter === 2) v += b;
            else if (filter === 3) v += (a + b) >> 1;
            else if (filter === 4) {
                const p = a + b - c;
                const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            } else if (filter !== 0) {
                throw new Error(`bad row filter ${filter}`);
            }
            cur[x] = v & 0xff;
        }
    }
    return { w, h, bpp, data };
}

// --------------------------------------------------------------------- encode
function chunk(type, data) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
}

function encode(img) {
    const { w, h } = img;
    const rgba = img.bpp === 4 ? img.data : toRgba(img);
    const stride = w * 4;
    const raw = Buffer.alloc(h * (stride + 1));
    for (let y = 0; y < h; y++) {
        raw[y * (stride + 1)] = 0;                       // filter: none
        rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8;    // bit depth
    ihdr[9] = 6;    // truecolour + alpha
    return Buffer.concat([
        PNG_SIG,
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

function toRgba(img) {
    const out = Buffer.alloc(img.w * img.h * 4);
    for (let p = 0, q = 0; p < img.h * img.w; p++, q += 3) {
        out[p * 4] = img.data[q];
        out[p * 4 + 1] = img.data[q + 1];
        out[p * 4 + 2] = img.data[q + 2];
        out[p * 4 + 3] = 255;
    }
    return out;
}

// --------------------------------------------------------------------- resize
/**
 * Area-average downscale. Averages in premultiplied alpha so the transparent
 * edges of a sprite do not bleach its colour toward black, then unpremultiplies.
 */
function resize(src, ow, oh) {
    const rgba = src.bpp === 4 ? src.data : toRgba(src);
    const out = Buffer.alloc(ow * oh * 4);
    const sx = src.w / ow, sy = src.h / oh;

    for (let y = 0; y < oh; y++) {
        const y0 = y * sy, y1 = (y + 1) * sy;
        for (let x = 0; x < ow; x++) {
            const x0 = x * sx, x1 = (x + 1) * sx;
            let r = 0, g = 0, b = 0, a = 0, area = 0;
            for (let py = Math.floor(y0); py < Math.ceil(y1); py++) {
                const wy = Math.min(y1, py + 1) - Math.max(y0, py);
                if (wy <= 0) continue;
                for (let px = Math.floor(x0); px < Math.ceil(x1); px++) {
                    const wx = Math.min(x1, px + 1) - Math.max(x0, px);
                    if (wx <= 0) continue;
                    const weight = wx * wy;
                    const i = (py * src.w + px) * 4;
                    const alpha = rgba[i + 3] / 255;
                    r += rgba[i] * alpha * weight;
                    g += rgba[i + 1] * alpha * weight;
                    b += rgba[i + 2] * alpha * weight;
                    a += rgba[i + 3] * weight;
                    area += weight;
                }
            }
            const o = (y * ow + x) * 4;
            const alpha = area ? a / area : 0;
            const scale = alpha > 0 ? 255 / alpha / area : 0;
            out[o] = Math.min(255, Math.round(r * scale));
            out[o + 1] = Math.min(255, Math.round(g * scale));
            out[o + 2] = Math.min(255, Math.round(b * scale));
            out[o + 3] = Math.round(alpha);
        }
    }
    return { w: ow, h: oh, bpp: 4, data: out };
}

/** Resize to fit inside a box, centred, on transparent padding. */
function fit(src, boxW, boxH) {
    const f = Math.min(boxW / src.w, boxH / src.h);
    const ow = Math.max(1, Math.round(src.w * f));
    const oh = Math.max(1, Math.round(src.h * f));
    const scaled = resize(src, ow, oh);
    if (ow === boxW && oh === boxH) return scaled;

    const out = Buffer.alloc(boxW * boxH * 4);
    const ox = Math.floor((boxW - ow) / 2);
    const oy = Math.floor((boxH - oh) / 2);
    for (let y = 0; y < oh; y++) {
        scaled.data.copy(out, ((y + oy) * boxW + ox) * 4, y * ow * 4, (y + 1) * ow * 4);
    }
    return { w: boxW, h: boxH, bpp: 4, data: out };
}

/** Rewrite every pixel, in place-safe form: fn(r,g,b,a) -> [r,g,b,a]. */
function lut(src, fn) {
    const rgba = Buffer.from(src.bpp === 4 ? src.data : toRgba(src));
    for (let i = 0; i < rgba.length; i += 4) {
        const [r, g, b, a] = fn(rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]);
        rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
    }
    return { w: src.w, h: src.h, bpp: 4, data: rgba };
}

module.exports = { decode, encode, resize, fit, lut, crc32 };
