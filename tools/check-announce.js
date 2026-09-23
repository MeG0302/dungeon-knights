#!/usr/bin/env node
/**
 * Does the announcements panel promise only what the program can deliver?
 *
 *     node tools/check-announce.js
 *
 * The panel is copy, and copy cannot be executed — so what is checked here is the part of it that
 * *can* be wrong in a way nobody notices until it matters:
 *
 *   - **The promise, word for word.** A prize announced on a page is a commitment: the leaderboard
 *     wallets, a free Knight capsule, decided when the season closes. If any of the three goes
 *     missing the panel still renders and still looks fine, which is exactly why it is asserted.
 *   - **No number, and no date.** The count of capsules and the day of the snapshot are ours to set
 *     later, so the page must not carry one. A count in the copy would be walked back in public the
 *     moment it changed — a digit in the panel is a failure here, not a nicety.
 *   - **The art it names exists, and is not the 250 KB original.** The panel shows the capsule the
 *     Staking Vault ships, cut to 320px for a sidebar; a path that 404s renders as a hole in a
 *     poster, and shipping the master would cost every visitor a quarter of a megabyte.
 *   - **A visitor with no wallet still sees it.** The rule is what the panel is for; the standing
 *     row is the only part that needs a wallet, and the panel must not be gated behind one.
 *   - **The `New` badge is a pointer, not a decoration.** It is cleared by opening the tab, and the
 *     browser is read in an effect rather than during render, so the server's paint and the first
 *     client paint agree.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CLIENT = path.join(ROOT, 'app', 'points', 'client.js');

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

/** The panel, from its opening comment to the closing of its block. */
function announceBlock(source) {
    const start = source.indexOf('{panel === \'announce\' && (');
    if (start === -1) return null;
    // The panel ends at the `)}` that closes it, which is the last one before the panel column does.
    const end = source.indexOf('</>\n                            )}', start);
    return end === -1 ? source.slice(start) : source.slice(start, end);
}

(async () => {
    const source = fs.readFileSync(CLIENT, 'utf8');
    const block = announceBlock(source);
    const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'points.css'), 'utf8');

    console.log('');
    console.log('The announcements tab');

    rec('the panel exists, and is a third tab rather than a banner', block !== null,
        block === null ? 'no `panel === \'announce\'` block found' : `${block.length} characters of panel`);

    rec('and the tab is labelled, wired to that panel, and keyboard-reachable',
        /aria-selected=\{panel === 'announce'\}/.test(source)
        && /role="tab"/.test(source)
        && /onClick=\{\(\) => openAnnouncements\(\)\}/.test(source),
        'role=tab · aria-selected · onClick');

    rec('a visitor with no wallet still reads the rule',
        block !== null && /<h3 className="announce-title">/.test(block)
        && !/connected\s*&&\s*\(\s*<>\s*<div className="panel-section-title">/.test(block),
        'the panel renders whatever the wallet says; only the standing row needs one');

    // ----------------------------------------------------------------- the promise
    console.log('');
    console.log('What it promises');

    const claims = [
        ['the leaderboard is what decides it', /leaderboard/i],
        ['the prize is a free Knight capsule', /free\s+Knight\s+capsule/i],
        ['it is decided when the season closes', /season closes/i],
        ['and the snapshot is at that close, not before', /season&rsquo;s close|season's close/i],
    ];
    rec('the announcement states the rule in four parts',
        block !== null && claims.every(([, re]) => re.test(block)),
        claims.map(([what, re]) => (re.test(block || '') ? '✓' : `missing: ${what}`)).join(' · '));

    rec('the standing row is the visitor’s own, not a sample',
        block !== null && /Your standing/.test(block) && /state\?\.rank/.test(block)
        && /points\.toLocaleString\(\)/.test(block),
        'rank, players and points all read from the wallet’s own state');

    rec('the capsule is named as the thing capsules open into, where they open',
        block !== null && /href="\/mint"/.test(block),
        'the panel links to /mint rather than explaining the tiers again');

    // ------------------------------------------------------- what it must NOT say
    console.log('');
    console.log('What it must not promise yet');

    // A count of winners, or a count of capsules: both are settable later, and a page cannot
    // un-promise a number it has already printed.
    const counted = block ? block.match(/\b(?:top|first|best)\s+\d+|\b\d{2,}\s+(?:wallets?|knights?|capsules?)\b/gi) : null;
    rec('no number of wallets, and no number of capsules',
        !counted || counted.length === 0,
        counted && counted.length ? `invented: ${counted.join(', ')}` : 'the count is announced, not baked in');

    // A date would read as a promise too, and the snapshot date is not ours to invent here.
    const dated = block ? block.match(/\b20\d{2}\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\b/g) : null;
    rec('and no date for the snapshot',
        !dated || dated.length === 0,
        dated && dated.length ? `dated: ${dated.join(', ')}` : 'the panel says when it is decided, not when');

    rec('the tab does not print a count of entries, tasks or wallet addresses',
        !/\b\d[\d,]*\s*(?:PTS|wallets|players)\b/.test(block || ''),
        'the leaderboard beside it carries the numbers; this panel carries the rule');

    // ------------------------------------------------------------------- the art
    console.log('');
    console.log('The capsule it shows');

    // The panel writes `${ASSETS}capsule-panel.png`, so the assertion resolves it the way the page
    // does rather than against a path typed here — a moved prefix would otherwise pass this file
    // and 404 in the browser.
    const assetsPrefix = (/const ASSETS = '([^']+)'/.exec(source) || [])[1] || '';
    const art = `${assetsPrefix}capsule-panel.png`;
    const artPath = path.join(ROOT, 'public', art.replace(/^\//, ''));
    const exists = assetsPrefix === '/assets/points/' && fs.existsSync(artPath);
    const bytes = exists ? fs.statSync(artPath).size : 0;
    const dims = exists
        ? `${fs.readFileSync(artPath).readUInt32BE(16)}x${fs.readFileSync(artPath).readUInt32BE(20)}`
        : '—';

    rec('the panel names a capsule file that exists', block !== null && block.includes('capsule-panel.png') && exists,
        `${art} · ${dims} · ${Math.round(bytes / 1024)} KB`);
    rec('and it is a cut of the capsule the vault ships, not the master',
        exists && bytes > 0 && bytes < 160 * 1024,
        bytes < 160 * 1024 ? 'under the 160 KB line' : `${Math.round(bytes / 1024)} KB is the master's weight`);
    rec('it is drawn pixelated, because the source is pixel art', /\.announce-art img\s*\{[^}]*pixelated/s.test(css),
        'image-rendering: pixelated');

    // -------------------------------------------------------- the badge and the motion
    console.log('');
    console.log('The badge, and the motion');

    rec('the New badge is cleared by opening the tab, and remembered by the browser',
        /ANNOUNCE_SEEN_KEY = 'dk_points_announce_seen'/.test(source)
        && /setItem\(ANNOUNCE_SEEN_KEY, '1'\)/.test(source)
        && /getItem\(ANNOUNCE_SEEN_KEY\) === '1'/.test(source),
        'one key, written on open and read on mount');

    rec('and it is read in an effect, so the server and the first client paint agree',
        /useEffect\(\(\) => \{\s*try \{\s*setAnnounceRead\(window\.localStorage\.getItem\(ANNOUNCE_SEEN_KEY\)/.test(source),
        'never during render');

    rec('the halo behind the capsule is the only decorative motion, and it yields',
        /@keyframes announce-halo/.test(css)
        && /@media \(prefers-reduced-motion: reduce\) \{\s*\.announce-art::before \{ animation: none; \}/.test(css),
        'prefers-reduced-motion turns it off');

    // ----------------------------------------------------------------- who tells the player
    console.log('');
    console.log('Arya teaches it');

    // Her walkthrough is where most players will hear about the giveaway at all, so it makes the
    // same promise as the panel — and is held to the same rules: the tab, because the panel's
    // contents are only in the DOM while it is open, and no count or date in what she says.
    const tour = source.slice(source.indexOf('function pointsTourSteps'), source.indexOf('One verified X task'));
    const step = /target: '\[data-arya="announce-tab"\]'[\s\S]{0,320}?text: '([^']+)'/.exec(tour);

    // Anchored to the button, not to the string: her step contains the same literal (it names the
    // target), so a bare search for it would pass with the attribute deleted from the tab — the
    // spotlight would aim at nothing and this file would say everything was fine.
    const hooked = /onClick=\{\(\) => openAnnouncements\(\)\}[\s\S]{0,160}?data-arya="announce-tab"/.test(source);
    rec('the tab carries the spotlight target she aims at', hooked,
        hooked ? 'data-arya on the tab button itself, not only in her step' : 'the hook is missing from the tab');

    rec('and she has a step for it', step !== null,
        step ? `${step[1].length} characters of dialogue` : 'no step targets the announcements tab');

    rec('her step makes the same promise, and names the tab it lives on',
        step !== null && /free Knight capsule/i.test(step[1]) && /Announcements/.test(step[1]),
        step ? 'the prize, and where to read it' : '—');

    const overstated = step ? step[1].match(/\b(?:top|first|best)\s+\d+|\b\d{2,}\s+(?:wallets?|knights?|capsules?)\b|\b20\d{2}\b/g) : null;
    rec('and she promises no number and no date either',
        !overstated || overstated.length === 0,
        overstated && overstated.length ? `overstated: ${overstated.join(', ')}` : 'same rule as the panel');

    rec('the step count she opens with is counted, so a new step cannot make her wrong',
        /steps\[0\]\.text = `I am Arya[\s\S]{0,120}?\$\{steps\.length - 1\}/.test(source),
        'the greeting reads steps.length - 1');

    console.log('');
    const failed = results.filter((r) => !r.pass);
    console.log(`${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length) {
        console.log('');
        for (const f of failed) console.log(`  FAILED: ${f.label}`);
    }
    console.log('');
    process.exitCode = failed.length ? 1 : 0;
})().catch((error) => {
    console.error('Harness failed:', error);
    process.exit(1);
});
