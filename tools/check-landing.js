#!/usr/bin/env node
/**
 * Is the landing page still cheap enough for the phone that opens it?
 *
 *     node tools/check-landing.js
 *
 * `dungeonknights.io` is the one page a stranger sees, and on September 22 it was carrying the
 * heaviest possible version of everything: a 37 MB 1080p loop autoplaying behind the wordmark, a
 * 965 KB JPEG painting a screen 390 points wide, a font sheet it could only discover *after*
 * `theme.css` had arrived and been parsed, a viewport meta that blocked pinch-zoom, and
 * `overflow: hidden` from `theme.css` — which, on a phone held sideways or a laptop window dragged
 * short, put the footer and the second button below an edge nothing could scroll past.
 *
 * None of that was visible to any other harness, and none of it was visible to `next build`. Every
 * file was valid; the page was just wrong for the device. So this file does two things, both of
 * which have already been done wrong once here:
 *
 *   1. it pins the **decisions** — the un-pinning query, the phone variant, the small-screen button,
 *      the tap and focus affordances, the font chain, the zoom the public page allows and the game
 *      does not; and
 *   2. it pins the **weights**, in bytes, because "we optimised it" is a claim that decays the first
 *      time somebody drops the master file back in.
 *
 * The numbers it asserts were measured in a browser, not guessed: at a 320pt width the primary
 * button was 284×64 with its label on two lines and is 284×44 after the `<=380px` rule; the column
 * needs 588px of height there, so the page scrolls on the smallest phones rather than clipping; and
 * nothing overflows horizontally at any phone width tested (320, 360, 375, 390, 430).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const size = (rel) => fs.statSync(path.join(ROOT, rel)).size;
const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

(async () => {
    const { STATIC_PAGES } = await import('../lib/static-pages.js');
    const home = STATIC_PAGES.home;
    const body = home.body;
    const css = read('public/css/home.css');
    const theme = read('public/theme.css');
    const layout = read('app/layout.js');
    const page = read('app/page.js');

    console.log('');
    console.log('The landing page — phones, landscape and short windows');

    // ---------------------------------------------------------------- the viewport, un-pinned
    // The one failure this fixes: a column taller than the viewport inside a box that cannot scroll.
    const unpinBlock = (css.match(/@media \(max-width: 760px\), \(max-height: 620px\) \{[\s\S]*?\n\}/) || [''])[0];
    rec('a query un-pins the document on phones AND on short viewports',
        unpinBlock.includes('max-width: 760px') && unpinBlock.includes('max-height: 620px'));
    rec('... letting the document scroll (html/body height auto + overflow-y auto)',
        /height:\s*auto/.test(unpinBlock) && /overflow-y:\s*auto/.test(unpinBlock));
    rec('... and letting the page itself grow past the viewport',
        /\.home-page\s*\{\s*overflow:\s*visible/.test(unpinBlock));

    // A plain `padding` must precede the `calc(… var(--home-foot-gap))` one: a browser without
    // `env()` would otherwise drop the declaration entirely and the footer would sit on the buttons.
    const pageRule = css.slice(css.indexOf('.home-page {'), css.indexOf('.home-video'));
    const padPlain = pageRule.indexOf('padding: 32px 24px 84px');
    const padVar = pageRule.indexOf('calc(84px + var(--home-foot-gap))');
    rec('the footer reservation has a plain fallback before its env() form', padPlain > -1 && padVar > padPlain);
    rec('the home indicator is subtracted from the footer',
        /--home-foot-gap:\s*max\(18px, env\(safe-area-inset-bottom/.test(css));

    // The reservation has to clear the footer, which the page-row made taller. Both numbers are read
    // off a live render rather than reasoned about: with this row the footer measures 79px on a
    // laptop and 125px at 390×844 (the nav wraps to two lines and the copyright and the follow link
    // each take their own), against 50px before. The reservation is the only thing keeping the two
    // buttons out from under it, and a label that grew a line is exactly what these floors catch.
    const reservation = Number((css.match(/padding: 32px 24px calc\((\d+)px/) || [])[1]);
    const phoneRule = css.slice(css.indexOf('@media (max-width: 560px)'));
    const phoneReservation = Number((phoneRule.match(/calc\((\d+)px \+ var\(--home-foot-gap\)\)/) || [])[1]);
    rec('the reservation clears the footer the page-row made taller',
        reservation >= 84 && phoneReservation >= 114,
        `${reservation}px on a laptop (+ the safe-area inset), ${phoneReservation}px on a phone — 79px and 125px measured`);

    // ------------------------------------------------------------------- the phone variant
    const phoneBlock = (css.match(/@media \(max-width: 760px\) \{[\s\S]*?\n\}/) || [''])[0];
    rec('phones never select a video source at all', /\.home-video\s*\{\s*display:\s*none/.test(phoneBlock));
    rec('phones paint the small background', phoneBlock.includes('menu-background-mobile.webp'));
    rec('reduced motion gets the same picture, without the phone rule',
        /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.home-video\s*\{\s*display:\s*none/.test(css));

    // ------------------------------------------------------------- thumb and keyboard quality
    rec('buttons declare touch-action: manipulation', /touch-action:\s*manipulation/.test(css));
    rec('the iOS tap highlight is suppressed', css.includes('-webkit-tap-highlight-color: transparent'));
    rec('iOS landscape text inflation is disabled', css.includes('-webkit-text-size-adjust: 100%'));
    rec('hover lift is guarded from touch screens', /@media \(hover: hover\) and \(pointer: fine\)/.test(css));
    rec('keyboard focus is visible on both controls',
        /\.home-btn:focus-visible,\s*\n?\s*\.home-footer a:focus-visible/.test(css));
    const tinyBlock = (css.match(/@media \(max-width: 380px\) \{[\s\S]*?\n\}/) || [''])[0];
    rec('the smallest phones get a button whose label fits one line',
        /\.home-btn\s*\{[^}]*font-size:\s*12px/.test(tinyBlock) && /letter-spacing:\s*1px/.test(tinyBlock));

    // ------------------------------------------------------------------ the markup it wears
    rec('the landing loads a versioned copy of its own sheet',
        (home.styles || []).some((s) => /^css\/home\.css\?v=/.test(s)),
        (home.styles || []).join(' + '));
    // Read the <source> tags themselves, not the body text: the comment above them names both files,
    // so an indexOf over the whole string answers a different question than the one being asked.
    const sources = [...body.matchAll(/<source src="([^"]+)"/g)].map((m) => m[1]);
    rec('the reserved landing-loop name is still first, so the new footage can drop in',
        sources[0] === '/assets/landing-loop.mp4' && sources[1] === '/assets/intro-web.mp4',
        sources.join(' then '));
    rec('the second source is the web-sized master, not the 37 MB one',
        body.includes('/assets/intro-web.mp4') && !/\/assets\/intro\.mp4/.test(body));
    rec('the poster is the WebP, not the 965 KB JPEG',
        body.includes('poster="/assets/images/menu-background.webp"')
        && !body.includes('poster="/assets/images/menu-background.jpg"'));
    rec('the crest is its own 46px cut, not the 167 KB panel icon',
        body.includes('/assets/ui/sword-crest.png') && !body.includes('src="/assets/ui/sword.png"'));
    rec('the video is muted, inline and looping (it autoplays nowhere otherwise)',
        /class="home-video"[^>]*autoplay[^>]*loop[^>]*muted[^>]*playsinline/.test(body)
        || /class="home-video"[^>]*autoplay[^>]*muted[^>]*playsinline[^>]*loop/.test(body));

    // ------------------------------------------------------------------- the footer's page row
    // Wayfinding, added after the collapse to a single public surface: the pages a stranger can
    // actually open, then the two places the project talks. The labels are pinned because this is a
    // second copy of the /docs footer's list — the two are edited apart — and the *absence* is
    // pinned because the owner asked that the repository not be shown to readers, which is the kind
    // of thing that comes back one helpful commit at a time.
    const nav = (body.match(/<nav class="home-footer-nav"[\s\S]*?<\/nav>/) || [''])[0];
    const navLabels = [...nav.matchAll(/>([A-Za-z@ ]+)<\/a>/g)].map((m) => m[1].trim());
    rec('the footer carries the public pages, in the docs footer\u2019s own order',
        navLabels.join(' · ') === 'Points · Genesis · Portfolio · X · Discord',
        navLabels.join(' · ') || 'no page row');
    rec('  \u2026 and every one of them is a link to somewhere that exists',
        ['href="/points"', 'href="/genesis"', 'href="/portfolio"'].every((href) => nav.includes(href))
        && /href="https:\/\/x\.com\//.test(nav) && /href="https:\/\/discord\.gg\//.test(nav)
        && [...nav.matchAll(/<a /g)].length === 5,
        `${[...nav.matchAll(/<a /g)].length} links`);
    rec('  \u2026 and no repository is named anywhere on the page',
        !/github/i.test(body) && !/github/i.test(css) && !/github/i.test(theme),
        'the source is not shown to readers');
    rec('  \u2026 and the row is styled rather than left as loose text',
        /\.home-footer-nav\s*\{[^}]*display:\s*flex/.test(css)
        && /\.home-footer-nav a\s*\{[^}]*text-transform:\s*uppercase/.test(css),
        'home-footer-nav');

    // --------------------------------------------------------------------- the font chain
    rec('both font origins are preconnected', (layout.match(/rel="preconnect"/g) || []).length >= 2);
    rec('the font sheet is a link the parser finds, not an @import', layout.includes('FONT_CSS')
        && /rel="stylesheet" href=\{FONT_CSS\}/.test(layout));
    rec('theme.css no longer hides an @import at its top', !/^\s*@import\s+url\(/.test(theme)
        && !theme.includes('fonts.googleapis.com/css2'));

    // ------------------------------------------------------------ zoom: public page vs game
    rec('the public page allows pinch-zoom (WCAG 1.4.4)', /userScalable:\s*true/.test(page)
        && /maximumScale:\s*5/.test(page));
    rec('the game still pins its own viewport', /maximumScale:\s*1/.test(layout)
        && /userScalable:\s*false/.test(layout));

    // ------------------------------------------------------------------- the weights
    const assets = [
        ['public/assets/intro-web.mp4', 5 * 1024 * 1024, 'the loop the desktop plays'],
        ['public/assets/images/menu-background.webp', 400 * 1024, 'the background, 1920px'],
        ['public/assets/images/menu-background-mobile.webp', 150 * 1024, 'the background, 900px'],
        ['public/assets/ui/sword-crest.png', 50 * 1024, 'the wordmark crest'],
    ];
    console.log('');
    for (const [rel, cap, what] of assets) {
        const bytes = size(rel);
        rec(`${rel} is under ${Math.round(cap / 1024)} KB`, bytes <= cap, `${kb(bytes)} — ${what}`);
    }
    const desk = size('public/assets/images/menu-background.webp');
    const mob = size('public/assets/images/menu-background-mobile.webp');
    rec('the phone background is genuinely the smaller one', mob < desk, `${kb(mob)} < ${kb(desk)}`);
    rec('the 37 MB master is still on disk for /hub, just not on this page',
        size('public/assets/intro.mp4') > 30 * 1024 * 1024 && !/\/assets\/intro\.mp4/.test(body),
        `${kb(size('public/assets/intro.mp4'))}`);

    console.log('');
    const failed = results.filter((r) => !r.pass);
    console.log(`${results.length - failed.length}/${results.length} checks passed`);
    for (const f of failed) console.log(`  FAILED: ${f.label}`);
    console.log('');
    process.exit(failed.length ? 1 : 0);
})().catch((error) => {
    console.error('Harness failed:', error);
    process.exit(1);
});
