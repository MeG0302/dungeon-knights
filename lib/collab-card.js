/**
 * The collab announcement card — the owner's artwork with real profile pictures in its two portraits.
 *
 * The artwork is the card. It already carries the composition, the frame, the lettering and the two
 * circular portraits, so this module does not draw a card of its own on top of it: it draws the
 * painting, then **replaces the two painted faces** — the knight on the left with ours, the lion on
 * the right with the partner's — and sets the partner's own words in the quiet band along the floor
 * of the picture, where the painting has nothing to lose.
 *
 * That constraint is the whole design, and it is why the numbers below are *measured* rather than
 * chosen. `PAINTED_PORTRAITS` is where the artwork's two rims actually are — found by looking for a
 * bright closed curve in each half of the frame, then reading the rim's own outer edge and the dark
 * seam just inside it off a radial brightness profile — and every position on the card is derived
 * from it. Two consequences are worth stating, because they are what the measurements bought:
 *
 *   - **The two portraits are not the same size in the artwork**, and the rims are not the same
 *     thickness. Their radii are 0.202 and 0.207 of the painting's height and their centres sit a
 *     percent apart. A card that forced them equal would put one picture off its painted circle,
 *     which looks like a mistake; following the painting means each picture lands inside the ring
 *     that was drawn for it.
 *   - **Each picture is filled to its own rim**, which is what `fill` is: a picture that stopped
 *     short of the dark seam would leave a crescent of the portrait the painting came with. The two
 *     fractions differ (0.874 and 0.919) because the two rims do.
 *
 * Three further decisions, all deliberate:
 *
 *   - **It is drawn in the browser, on a canvas, from this module.** The alternative — rendering it
 *     on the server — needs either an image library the project does not have or a headless browser,
 *     and either way the *text* is the problem: an SVG rendered server-side has no access to the
 *     site's faces, so the card would come out in whatever generic serif the host happens to have,
 *     and a Vercel container is not the machine the design was judged on. In the browser the page has
 *     already loaded Cinzel, so the card is drawn in the real typeface and rasterised to a real PNG
 *     by `canvas.toBlob`, and a blank canvas is never what gets downloaded.
 *   - **The layout is a pure function of the size.** `cardLayout()` returns plain numbers — no
 *     measuring, no randomness, no DOM — so the same call gives the same card, and the offline
 *     harness can assert the geometry (the portraits inside their rims, the two lines on the card,
 *     nothing against an edge) without a browser.
 *   - **The text is fitted at draw time, never truncated.** `drawCard` measures with the real context
 *     and steps a font down until the line fits, so a 15-character handle or a long prize line is
 *     shrunk rather than clipped. A card that silently cut `@kingdomofnothing` at fourteen
 *     characters would be a card posted with the wrong name on it.
 *
 * **The painting file** (`collab-card-art.webp`) is the owner's 2752×1536 original, downscaled to
 * 1600 wide — the same picture, at the size the card is drawn at. It is one file rather than one per
 * crop because there is one crop: the painting is 1.79:1, and a 1:1 version of it would have to cut
 * the two portraits, which are what the card is for. Our own profile picture is a local file for the
 * same reason it is everywhere else on this page, and one more: a canvas that draws a cross-origin
 * image is tainted, and a tainted canvas cannot produce a PNG at all.
 */

import { OUR_PFP } from './collab-content.js';

/** The page's palette, repeated as literals because a canvas cannot read a CSS variable. */
export const CARD_PALETTE = Object.freeze({
    stone: '#0D0A08',
    bronze: '#B08D57',
    bronzeDark: '#5A4A2C',
    gold: '#D4AF37',
    bone: '#E8E2D7',
    muted: '#8A8177',
});

/** The words that are on every card. The partner's handle and prize line are the only variables. */
export const CARD_WORDS = Object.freeze({
    ours: 'DUNGEON KNIGHTS',
    joiner: ' · ',
    fallbackPrize: 'FREE KNIGHT CAPSULES + GENESIS NFT WHITELIST',
});

/**
 * The owner's artwork, as delivered.
 *
 * Only its aspect ratio is used here — the file that ships is a 1600-wide downscale of it — but the
 * proportion is what the portrait geometry below is expressed against, so the two have to agree.
 */
export const PAINTING = Object.freeze({ width: 2752, height: 1536 });

/**
 * The two portraits already painted into the artwork, in fractions of the painting.
 *
 * Measured, not chosen. `u`/`v` are the centre of each painted circle and `r` is the outer edge of
 * its rim — the ring's brightness was swept over centre and radius to find where the painted curve
 * actually is. `fill` is how much of that radius the profile picture covers: the radial profile of
 * each rim is bright, then falls to a dark seam where the painted face ends, so a picture drawn to
 * that seam (plus a pixel or two) replaces the face exactly and leaves the ring intact.
 *
 * `u` is a fraction of the painting's **width** and `v`/`r` of its **height**, because that is what a
 * uniform scale preserves — and a uniform scale is the only one a picture is ever drawn at here.
 *
 * The knight is the left portrait in the artwork and the lion the right one; the knight's circle is
 * ours, the lion's is the partner's.
 */
export const PAINTED_PORTRAITS = Object.freeze({
    knight: { u: 0.31659, v: 0.56667, r: 0.20222, fill: 0.874 },
    lion: { u: 0.68466, v: 0.58111, r: 0.20667, fill: 0.919 },
});

/** The crops the card is made in. One: the painting's own shape, which is the post's shape too. */
export const CARD_SIZES = Object.freeze({
    post: { key: 'post', width: 1600, height: 900, suffix: 'post', note: '1600×900 — the post, and the painting’s own shape' },
});

export const CARD_SIZE_KEYS = Object.freeze(Object.keys(CARD_SIZES));

/** The painted ground of the card: the owner's artwork, at the size the card is drawn at. */
export const CARD_ART = '/assets/collab/collab-card-art.webp';

/** A tiny seeded generator. Kept because the harness uses it to build a repeating context. */
function seeded(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const round1 = (value) => Math.round(value * 10) / 10;

/**
 * The geometry of one card, in pixels, for a size key.
 *
 * Everything is derived: the painting is *covered* onto the canvas (uniform scale, cropped from the
 * centre, never stretched), the portraits are placed through that same transform, and the two lines
 * of type sit in the band along the floor of the picture. Nothing is measured, so the harness can
 * assert all of it, and `drawCard` uses these numbers rather than recomputing anything from the
 * loaded image — which is what makes the asserted geometry the drawn geometry.
 */
export function cardLayout(size = 'post') {
    const spec = CARD_SIZES[size] || CARD_SIZES.post;
    const { width: w, height: h } = spec;

    // 1. the painting, covered onto the canvas
    const scale = Math.max(w / PAINTING.width, h / PAINTING.height);
    const art = { width: PAINTING.width * scale, height: PAINTING.height * scale };
    art.x = (w - art.width) / 2;
    art.y = (h - art.height) / 2;

    const place = (portrait) => ({
        x: round1(art.x + portrait.u * art.width),
        y: round1(art.y + portrait.v * art.height),
        radius: round1(portrait.r * art.height),
    });
    const withFill = (circle, portrait) => ({ ...circle, portrait: round1(circle.radius * portrait.fill) });

    const left = withFill(place(PAINTED_PORTRAITS.knight), PAINTED_PORTRAITS.knight);
    const right = withFill(place(PAINTED_PORTRAITS.lion), PAINTED_PORTRAITS.lion);

    // 2. the type. The painting's own lettering runs out around 0.89 of its height and the last tenth
    //    of the picture is quiet, so that is where the two lines go — under everything the artwork
    //    itself says, and clear of the portraits by a wide margin.
    const pad = Math.round(Math.min(w, h) * 0.045);
    const band = { y: round1(h * 0.885), height: round1(h * 0.115) };
    const prizePx = Math.max(14, Math.round(h * 0.041));
    const signaturePx = Math.max(11, Math.round(h * 0.023));

    return {
        ...spec,
        pad,
        art: { x: round1(art.x), y: round1(art.y), width: round1(art.width), height: round1(art.height), scale: round1(scale * 1000) / 1000 },
        left,
        right,
        band,
        prize: { y: round1(h * 0.938), px: prizePx, maxWidth: w - 2 * pad },
        signature: { y: round1(h * 0.972), px: signaturePx, maxWidth: w - 2 * pad },
        // What the painting's own lettering would have to be behind for the type to read, as the
        // fraction of the card's darkest ground the scrim adds at its heaviest.
        scrim: 0.62,
    };
}

/** What the file is called when it is saved. Deterministic, and it names the partner. */
export function cardFilename(handle, size = 'post') {
    const spec = CARD_SIZES[size] || CARD_SIZES.post;
    const clean = String(handle || 'partner').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'partner';
    return `dungeon-knights-collab-${clean}-${spec.suffix}.png`;
}

/**
 * The prize line on the card.
 *
 * The project's own words, from the request that was approved — not a line we invent and not a
 * hash-power table. What is printed on the card has to be what was agreed, and the request is where
 * the agreement is.
 */
export function prizeLineFor(request) {
    const text = String(request?.prize || '').replace(/\s+/g, ' ').trim();
    return text || CARD_WORDS.fallbackPrize;
}

/** The handle as it appears on the card: one `@`, whatever it was stored as. */
export function cardHandle(handle) {
    const clean = String(handle || '').replace(/^@+/, '').trim();
    return clean ? `@${clean}` : '';
}

/** The signature line: who made the card, and for whom. */
export function signatureLine(handle) {
    const partner = cardHandle(handle);
    return partner ? `${CARD_WORDS.ours}${CARD_WORDS.joiner}${partner}` : CARD_WORDS.ours;
}

/**
 * Draw tracked text — letter by letter, because `ctx.letterSpacing` is not in every browser and a
 * card that is spaced on one machine and cramped on another is not the same artifact.
 *
 * Returns the width it drew, which is what the fitting loop measures against.
 */
export function trackedWidth(ctx, text, spacing) {
    const characters = [...String(text)];
    if (!spacing) return ctx.measureText(String(text)).width;
    return characters.reduce((sum, character) => sum + ctx.measureText(character).width + spacing, 0) - spacing;
}

function drawTracked(ctx, text, cx, y, spacing) {
    const characters = [...String(text)];
    const width = trackedWidth(ctx, text, spacing);
    let x = cx - width / 2;
    for (const character of characters) {
        ctx.fillText(character, x, y);
        x += ctx.measureText(character).width + spacing;
    }
    return width;
}

/** Step a font down until the line fits the width it is given. Never truncates. */
function fitFont(ctx, text, basePx, maxWidth, family, spacing = 0) {
    let px = basePx;
    while (px > 8 && trackedWidth(ctx, text, spacing) > maxWidth) px -= 1;
    ctx.font = family(px);
    return px;
}

const DISPLAY = (px) => `900 ${px}px "Cinzel Decorative", "Cinzel", serif`;
const HEADING = (px) => `700 ${px}px "Cinzel", "Cinzel Decorative", serif`;

/**
 * Draw a picture so it fills the box, cropping from the centre rather than stretching.
 *
 * The painting is not the canvas's exact shape — 1.79:1 against 16:9 — so this crops a few pixels
 * off each side rather than squashing the artwork by a percent, which is the kind of distortion that
 * is invisible in a listing and obvious in the two circles.
 */
function drawCover(ctx, image, x, y, w, h) {
    const iw = Number(image?.naturalWidth || image?.width || 0);
    const ih = Number(image?.naturalHeight || image?.height || 0);
    if (!iw || !ih) {
        ctx.drawImage(image, x, y, w, h);
        return;
    }
    const scale = Math.max(w / iw, h / ih);
    const sw = w / scale;
    const sh = h / scale;
    ctx.drawImage(image, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}

/**
 * Replace one painted portrait with a real picture.
 *
 * The picture is clipped to the circle inside the painted rim and centred in its own frame, so a
 * profile picture that is not square is cropped from its middle rather than squashed. Nothing is
 * drawn over the rim: that is the artwork's, and it is what makes the result look painted rather
 * than pasted.
 */
function drawPortrait(ctx, image, cx, cy, radius) {
    const iw = Number(image?.naturalWidth || image?.width || 0);
    const ih = Number(image?.naturalHeight || image?.height || 0);
    const side = Math.min(iw || radius * 2, ih || radius * 2);

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    const sx = iw ? Math.round((iw - side) / 2) : 0;
    const sy = ih ? Math.round((ih - side) / 2) : 0;
    ctx.drawImage(image, sx, sy, side, side, cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.restore();
}

/**
 * Paint one card. Takes a canvas 2D context and two already-loaded pictures; returns a small report
 * of what it actually drew, which is the part worth asserting: the sizes the fitting settled on, and
 * whether a painting went under the card at all.
 */
export function drawCard(ctx, { layout, left, right, art = null, handle = '', prize = '' } = {}) {
    const spec = layout || cardLayout('post');
    const { width: w, height: h } = spec;

    // 1. the artwork, and only the artwork. There is no wash over it and no plate under the type: the
    //    card is the painting, and the painting is dark enough where the words go.
    ctx.save();
    ctx.fillStyle = CARD_PALETTE.stone;
    ctx.fillRect(0, 0, w, h);
    if (art) drawCover(ctx, art, 0, 0, w, h);
    ctx.restore();

    // 2. the band: a gradient that starts transparent and ends as the card's own ground, so the two
    //    lines have a floor to sit on whatever the painting does down there. It never begins above
    //    the artwork's own lettering, so nothing the painting says is covered by it.
    ctx.save();
    const scrim = ctx.createLinearGradient(0, spec.band.y, 0, spec.band.y + spec.band.height);
    scrim.addColorStop(0, 'rgba(13, 10, 8, 0)');
    scrim.addColorStop(1, `rgba(13, 10, 8, ${spec.scrim})`);
    ctx.fillStyle = scrim;
    ctx.fillRect(0, spec.band.y, w, spec.band.height);
    ctx.restore();

    // 3. the two portraits, into the two rims the painting drew for them.
    ctx.save();
    drawPortrait(ctx, left, spec.left.x, spec.left.y, spec.left.portrait);
    drawPortrait(ctx, right, spec.right.x, spec.right.y, spec.right.portrait);
    ctx.restore();

    // 4. the prize line, then the signature under it. Both fitted to the card's width.
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = CARD_PALETTE.bone;
    const prizePx = fitFont(ctx, prize, spec.prize.px, spec.prize.maxWidth, HEADING, Math.round(spec.prize.px * 0.08));
    const prizeWidth = drawTracked(ctx, prize, w / 2, spec.prize.y, Math.round(prizePx * 0.08));
    ctx.fillStyle = CARD_PALETTE.bronze;
    const signature = signatureLine(handle);
    const signaturePx = fitFont(ctx, signature, spec.signature.px, spec.signature.maxWidth, DISPLAY, Math.round(spec.signature.px * 0.30));
    const signatureWidth = drawTracked(ctx, signature, w / 2, spec.signature.y, Math.round(signaturePx * 0.30));
    ctx.restore();

    return {
        layout: spec.key,
        prizePx,
        signaturePx,
        prizeWidth: Math.round(prizeWidth),
        signatureWidth: Math.round(signatureWidth),
        // What the drawing actually did about the ground, which is the part a harness can assert and a
        // reader of the code cannot: whether the painting went under the card at all.
        painting: !!art,
        scrim: spec.scrim,
        // The circles as drawn: where, and how much of the painted rim is left showing.
        portraits: [
            { ...spec.left, rim: Math.round((spec.left.radius - spec.left.portrait) * 10) / 10 },
            { ...spec.right, rim: Math.round((spec.right.radius - spec.right.portrait) * 10) / 10 },
        ],
        words: { prize, signature, handle: cardHandle(handle) },
    };
}

// ------------------------------------------------------------------- the browser-only helpers

/** Load a picture the canvas can draw. Same-origin or a data URL — never a third-party URL. */
export function loadImage(src) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = 'sync';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`could not load ${String(src).slice(0, 60)}`));
        image.src = src;
    });
}

/**
 * Draw a card onto a canvas at its own size. The canvas is the preview *and* the artifact: it is
 * left at its intrinsic resolution and scaled by CSS, so what is downloaded is what was drawn.
 *
 * The fonts are awaited first, because a card drawn before Cinzel arrives is a card drawn in the
 * fallback face — and this is the artifact that gets posted.
 */
export async function renderCard(canvas, { size = 'post', leftSrc, rightSrc, handle = '', prize = '', art = true } = {}) {
    if (typeof document !== 'undefined' && document.fonts?.ready) {
        try { await document.fonts.ready; } catch { /* a font that never loads is not a failed card */ }
    }
    const layout = cardLayout(size);
    // The painting is the one thing here that is allowed to be missing — without it the card is drawn
    // on the plain stone ground, which is a duller card and still a usable one. A missing profile
    // picture is a different matter — there is a card to make or there is not — so that one rejects.
    const painting = art
        ? await loadImage(typeof art === 'string' ? art : CARD_ART).catch(() => null)
        : null;
    const [left, right] = await Promise.all([loadImage(leftSrc), loadImage(rightSrc)]);

    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext('2d');
    return drawCard(ctx, { layout, left, right, art: painting, handle, prize });
}

/** The card as a PNG blob, which is what a download is. */
export function canvasToPng(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('the canvas produced no picture'))), 'image/png');
    });
}

export { seeded, OUR_PFP };
