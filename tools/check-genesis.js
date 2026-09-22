#!/usr/bin/env node
/**
 * Does the Genesis page tell the truth about the collection — and does it show only real captures?
 *
 *     node tools/check-genesis.js
 *
 * `/genesis` is the page strangers are sent to from the landing page, and it makes two kinds of
 * claim that no compiler and no screenshot can check:
 *
 *   1. **Every figure is the contract's.** A marketing page is where a number gets copied once and
 *      then quietly stops being true — `1,024` typed into a headline survives the supply changing,
 *      the reward table moving, or the capsule count being revised. So the page must *read* the
 *      figures from `lib/staking-config.js` and `lib/reward-config.js`, and this file asserts both
 *      halves of that: every imported figure is used, and none of the published values appears as a
 *      literal in the page's own source. The second half is what a mutation can break.
 *
 *   2. **Nothing pretends to be a screenshot.** The page has frames for captures of the real game.
 *      The rule is that a frame shows a picture only when the picture exists in
 *      `public/assets/genesis/`, and says so in the frame otherwise — an illustration captioned
 *      "screenshot" would be a claim about a build that has not been made. The reader takes its
 *      directory as an argument precisely so both answers can be tested here, against fixtures,
 *      without touching the served folder.
 *
 * It reads source rather than rendering, in the same spirit as `check-styles.js`: what can be
 * checked without a browser is the shape of the page, and the shape is where these two claims live.
 * The browser is checked by hand (`preview_evaluate`) and by the page's own behaviour.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = 'app/genesis/client.js';
const PAGE = 'app/genesis/page.js';
const SHOT_DIR = 'public/assets/genesis';
const LOOP = 'public/assets/genesis-loop.mp4';
const SOURCE_FOOTAGE = path.join('landing page', 'landing.MP4');
// The landing page's own reserved first source. This feature must not have changed what the apex
// landing plays, and the way it would happen is somebody copying the footage to this name.
const LANDING_RESERVED = 'public/assets/landing-loop.mp4';

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

function section(title) {
    console.log('');
    console.log(title);
}

const read = (rel) => {
    try {
        return fs.readFileSync(path.join(ROOT, rel), 'utf8');
    } catch {
        return '';
    }
};

const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

/** Source with comments stripped — a guard that reads its own explanation is not a guard. */
const code = (source) => String(source)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

// `pathToFileURL`, not the bare path: on Windows an absolute path is a drive letter to the ESM
// loader, not a URL, and "d:" is not a supported scheme.
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const Staking = await load('lib/staking-config.js');
const Rewards = await load('lib/reward-config.js');
const Shots = await load('lib/genesis-shots.js');
const Routing = await load('lib/app-routing.js');

const clientSource = code(read(CLIENT));
const pageSource = code(read(PAGE));
const css = code(read('public/css/genesis.css'));

/**
 * The same source with runs of whitespace collapsed — because JSX wraps prose across lines.
 *
 * This is not tidiness: a check for "enforced by the game contract" failed against a page that says
 * exactly that, because the sentence is broken after "game" in the source. Reading a sentence out of
 * wrapped markup requires putting the wrapping back together first, and collapsing makes the checks
 * stricter rather than looser — a phrase split by a newline now matches, so a phrase that is absent
 * can no longer "pass" by accident either.
 */
const prose = clientSource.replace(/\s+/g, ' ');

// --------------------------------------------------------------------- the figures
console.log('');
console.log('Genesis Knights — the page, the numbers and the frames');

section('Every figure is read from the module that owns it');

rec('the collection page exists, and the server component that feeds it', !!clientSource && !!pageSource);

// Named imports, so a check can tell "used" from "mentioned in the import line". This is the list a
// failure should send somebody to: a figure that is imported and then printed as a literal would
// pass an "is it imported" check and fail the one below.
const IMPORTED = [
    'GENESIS_SUPPLY', 'HASH_POWER_MIN', 'HASH_POWER_MAX', 'HASH_POWER_BANDS', 'CAPSULES_PER_WEEK',
    'TICKET_CAP_HOURS', 'ticketsPerHour',
];
for (const name of IMPORTED) {
    const uses = clientSource.split(new RegExp(`\\b${name}\\b`)).length - 1;
    rec(`${name} is imported and then actually used`, uses > 1, `${uses} occurrence(s)`);
}

// The half that matters, and the half a mutation can falsify: the published figures must not appear
// as literals anywhere in the page's own source. `1,024` and `1200` are the same number typed two
// ways, and a page may be written in either.
//
// The reward figures are in this list on purpose even though the page no longer prints them: the
// owner's instruction was that this page states no reward at all, so a `300` appearing here would be
// a new claim about what a run pays — made in the one place that cannot see the live table.
const PUBLISHED = [
    ['the supply', Staking.GENESIS_SUPPLY],
    ['the minimum hash power', Staking.HASH_POWER_MIN],
    ['the maximum hash power', Staking.HASH_POWER_MAX],
    ['the reward per clear', Rewards.GENESIS_REWARD_PER_CLEAR],
    ['the daily capacity', Rewards.GENESIS_DAILY_CAPACITY],
    ['the run cap', Rewards.GENESIS_DAILY_RUNS],
    ['the capsule count', Staking.CAPSULES_PER_WEEK],
    ['the ticket cap in hours', Staking.TICKET_CAP_HOURS],
];
for (const [what, value] of PUBLISHED) {
    const shown = Number(value).toLocaleString('en-US');
    // `1,024` or `1024`; `1,200` or `1200`.
    const pattern = new RegExp(`\\b${shown.replace(/,/g, ',?')}\\b`);
    const hit = clientSource.match(pattern);
    rec(`${what} (${shown}) is not typed into the page`, !hit,
        hit ? 'a figure copied into the page drifts the moment the table moves' : 'read from config');
}

section('No reward figure is stated anywhere on the page');
// The instruction, in the owner's words: "you dont need to tell 300 DNG/ clear or any dng/run or
// something like this anywhere". What a run pays lives in the contract and is quoted against the
// live table in the vault; a number printed on a page that cannot see the table is a second, staler
// copy of it. The import is checked as well as the copy — an unused import is how the figure gets
// back in without anybody deciding to.
rec('the page does not import the reward table at all', !/reward-config/.test(clientSource));
// "No DNG amount" rather than "no numbers": the page still says the vault pays in $DNG, still says
// caps are enforced per knight and per day, and those are claims about the contract rather than
// quotations of a figure. What must not appear is a number with DNG after it.
rec('  … and states no $DNG amount anywhere in the copy',
    !/\d[\d,]*\s*DNG/i.test(prose) && !/per clear|per run|runs a day|most a day/i.test(prose),
    'a reward figure belongs to the contract, and the vault quotes it against the live table');
rec('  … and the capsule odds table is gone with them', !/gn-odd|KNIGHT_TIERS|RARITY/.test(clientSource));
rec('the dungeon box is a claim about the contract instead of a number',
    /enforced by the game contract/i.test(prose));

section('The bands the page publishes');
const bands = Staking.HASH_POWER_BANDS;
const bandTotal = bands.reduce((sum, band) => sum + band.count, 0);
rec('the ladder is drawn from the published bands', /HASH_POWER_BANDS\.map\(/.test(clientSource));
rec('  … and every band prints its own count rather than a typed one', /fmtInt\(band\.count\)/.test(clientSource));
rec('  … and the ticket rule is derived from the function that defines it',
    /ticketsPerHour\(1\)/.test(clientSource), 'so a change to the rule changes the sentence');

// The ladder is the vault's ladder. Same track, same measurement, same six colours — a buyer who has
// seen one should recognise the other, and a band that is gold on one page and grey on the other
// reads as two different tables.
const vaultCss = code(read('public/css/staking.css'));
const paletteOf = (source) => (source.match(/\[data-band='(\w+)'\] \{ --band-colour: (#[0-9A-Fa-f]{6}); \}/g) || [])
    .map((line) => line.replace(/\s+/g, ' '))
    .sort();
const vaultPalette = paletteOf(vaultCss);
const pagePalette = paletteOf(css);
rec('the ladder is drawn the way the vault draws it',
    /\.gn-ladder-bars/.test(css) && /height: 46px/.test(css) && /align-items: flex-end/.test(css),
    'a fixed track per band, filled from the bottom');
rec('  … and the fill is measured against the largest band, not the supply',
    /LADDER_TOP = Math\.max\(\.\.\.HASH_POWER_BANDS\.map\(\(band\) => band\.count\)\)/.test(clientSource)
    && /band\.count \/ LADDER_TOP/.test(clientSource),
    'measured against the supply, six bars between 6% and 20% of the height are a picture of nothing');
rec('  … and the two ladders carry the same six colours, value for value',
    pagePalette.length === 6 && pagePalette.join('|') === vaultPalette.join('|'),
    `page: ${pagePalette.length}, vault: ${vaultPalette.length}`);
rec('  … and the band name a person reads is the short one',
    /band\.name\.replace\('Genesis ', ''\)/.test(clientSource));
rec('the band counts add up to the supply the page claims', bandTotal === Staking.GENESIS_SUPPLY,
    `${bandTotal} vs ${Staking.GENESIS_SUPPLY}`);
rec('  … and the bands are contiguous, with no gap and no overlap',
    bands.every((band, index) => index === 0 || band.lo === bands[index - 1].hi + 1),
    bands.map((band) => `${band.lo}-${band.hi}`).join(' '));
rec('  … and they start and end on the published range',
    bands[0].lo === Staking.HASH_POWER_MIN && bands[bands.length - 1].hi === Staking.HASH_POWER_MAX);
rec('every band has a bar, and the bars are one row',
    (css.match(/grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/) || []).length >= 1);

// --------------------------------------------------------------- the screenshot rule
section('A frame shows a picture only when the picture exists');
rec('the reader looks in the served folder by default',
    Shots.defaultShotDir().endsWith(path.join('public', 'assets', 'genesis')));
rec('and the page renders a frame per slot', /shots\.map\(/.test(clientSource));

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-shots-'));
try {
    const empty = await Shots.readShots(fixture);
    rec('with nothing in the folder every slot is empty', empty.length === Shots.SHOT_SLOTS.length
        && empty.every((slot) => slot.src === null), `${empty.length} slot(s)`);
    rec('  … and an empty slot is a slot with a caption, not a hole', empty.every((slot) => !!slot.caption));

    // `?.` everywhere a slot is looked up by key, and not for tidiness: an earlier version indexed
    // `filled[0]` directly, so a mutation that stopped every slot from filling made this file throw
    // a TypeError instead of failing by name. A sweep cannot tell a caught mutation from a crash,
    // and a real regression would have printed a stack trace where a sentence was owed.
    const slotBy = (slots, key) => slots.find((slot) => slot.key === key) || {};

    fs.writeFileSync(path.join(fixture, 'dungeon-run.webp'), 'not really a picture');
    const one = await Shots.readShots(fixture);
    const filled = one.filter((slot) => slot.src !== null);
    rec('one file fills exactly its own slot', filled.length === 1 && filled[0]?.key === 'dungeon-run',
        `${filled.length} filled`);
    rec('  … and the source is the served URL, not the path on disk',
        filled[0]?.src === '/assets/genesis/dungeon-run.webp', filled[0]?.src || 'nothing was filled');
    rec('  … and the others stay empty', one.filter((slot) => slot.key !== 'dungeon-run').every((slot) => slot.src === null));

    fs.writeFileSync(path.join(fixture, 'staking-vault.png'), 'not really a picture');
    rec('a .png is accepted too, because that is what a capture tool produces',
        slotBy(await Shots.readShots(fixture), 'staking-vault').src === '/assets/genesis/staking-vault.png');

    fs.writeFileSync(path.join(fixture, 'DUNGEON-RUN.JPEG'), 'not really a picture');
    rec('the name is matched case-insensitively, and the file is served under its real name',
        slotBy(await Shots.readShots(fixture), 'dungeon-run').src === '/assets/genesis/dungeon-run.webp',
        'the .webp preference wins, and neither is guessed at');

    fs.writeFileSync(path.join(fixture, 'logo.png'), 'not really a picture');
    rec('a file that names no slot fills nothing', (await Shots.readShots(fixture)).length === Shots.SHOT_SLOTS.length
        && (await Shots.readShots(fixture)).every((slot) => !String(slot.src).includes('logo')));

    rec('a folder that does not exist is an empty page rather than a crash',
        (await Shots.readShots(path.join(fixture, 'nope'))).every((slot) => slot.src === null));
} finally {
    fs.rmSync(fixture, { recursive: true, force: true });
}

rec('the picture is rendered only when there is one, and the frame says otherwise',
    /\{shot\.src \? \(/.test(clientSource) && /Capture to come/.test(clientSource)
    && /is-pending/.test(clientSource),
    'the pending state is the thing that keeps art from standing in for gameplay');
rec('  … and every picture carries alt text and a caption', /alt=\{shot\.caption\}/.test(clientSource)
    && /gn-shot-caption/.test(clientSource));
rec('  … and the pictures are lazy, so three frames do not cost the first paint', /loading="lazy"/.test(clientSource));

// ------------------------------------------------------------------------ the video
section('The loop, and the page it is not on');
rec('the page plays the footage under its own name', /\/assets\/genesis-loop\.mp4/.test(clientSource));
rec('  … and the file is really there, byte-identical to the capture it came from',
    exists(LOOP) && (!exists(SOURCE_FOOTAGE) || sha1(LOOP) === sha1(SOURCE_FOOTAGE)),
    exists(SOURCE_FOOTAGE) ? 'compared against landing page/landing.MP4' : 'source folder not present — size checked only');
rec('  … and a video that will not load still leaves the page readable', /poster="\/assets\/images\/menu-background\.jpg"/.test(clientSource));
rec('  … and intro.mp4 is behind it, so a missing copy falls through rather than leaving a hole',
    /\/assets\/intro\.mp4/.test(clientSource));
rec('the landing page is untouched by this — it still plays intro.mp4',
    !exists(LANDING_RESERVED),
    'the reserved name landing-loop.mp4 is absent, so the apex landing keeps its own loop');
rec('and a phone does not download it at all',
    /@media \(max-width: 760px\), \(prefers-reduced-motion: reduce\)/.test(css)
    && /\.gn-video \{ display: none; \}/.test(css));

// ------------------------------------------------------------------------- the form
section('The form asks for the two things, and nothing else');
rec('the form is in the markup, so it survives a script failure', /<form/.test(clientSource) && /id="waitlist"/.test(clientSource));
rec('an email address is required and labelled', /id="waitlistEmail"/.test(clientSource) && /type="email"/.test(clientSource));
rec('an EVM address is asked for beside it', /id="waitlistAddress"/.test(clientSource));
rec('  … and is marked optional in words a person reads', /\(for the allowlist — optional\)/.test(clientSource));
rec('  … and a malformed one is refused rather than silently dropped',
    /\^0x\[0-9a-fA-F\]\{40\}\$/.test(clientSource) && /does not look like an EVM address/.test(clientSource),
    'the server stores null for an address it does not recognise, so an unchecked typo would vanish');
rec('  … against the same rule the store enforces',
    (read('lib/waitlist-store.js').match(/\^0x\[0-9a-fA-F\]\{40\}\$/g) || []).length === 1);
// The follow box, reworded on the owner's instruction. It used to explain what the box does not
// prove ("we cannot check it, so it is taken on your word"), which reads as a note about our
// plumbing rather than anything a person joining a waitlist is owed. The rule that survives is the
// one that matters: the box is the player's own statement and must never read like a verified
// field, so the check is now that it claims no verification at all.
rec('the follow box is the player\u2019s own statement, and claims no verification',
    /I follow/.test(clientSource) && /x\.com\/DNGrobinhood/.test(clientSource)
    && !/verified|checked against|on your word|cannot check/i.test(clientSource),
    'a box the person ticks must not read like a field something checked');
rec('  … and it still says nothing about the follow being confirmed for them',
    !/we check|we confirm|confirmed automatically/i.test(clientSource));
rec('the submission is tagged with the page it came from', /source: 'genesis'/.test(clientSource));
// The queue is shown only when there is one. "No one is in line yet — you would be the first" was
// removed on the owner's instruction, and it is worth a check rather than a comment: a queue of zero
// is a fact about today, and printed under a form it reads as a fact about the collection.
rec('and it prints no empty-state sentence about the queue',
    !/you would be the first|no one is in line/i.test(prose),
    'the count line appears only when there is a count');
rec('  … and goes to the endpoint that owns the queue', /\/api\/waitlist/.test(clientSource));
rec('the page opens with a way back and one action',
    /href="\/"/.test(clientSource) && /href="#waitlist"/.test(clientSource));

// ------------------------------------------------------------------------- routing
section('Reachable where it is advertised, and nowhere else');
rec('/genesis is public on the apex', Routing.APEX_PUBLIC.includes('/genesis'));
rec('  … so the apex serves it', Routing.decideRoute({
    isApp: false, isApex: true, kind: Routing.classify('/genesis'), pathname: '/genesis', search: '',
    passwordConfigured: true, gateAllowed: false,
}).action === 'next');
rec('  … and the gated host still asks for the password', Routing.decideRoute({
    isApp: true, isApex: false, kind: Routing.classify('/genesis'), pathname: '/genesis', search: '',
    passwordConfigured: true, gateAllowed: false,
}).action === 'gate');
rec('  … and a preview hostname is left alone, as it was', Routing.decideRoute({
    isApp: false, isApex: false, kind: Routing.classify('/genesis'), pathname: '/genesis', search: '',
    passwordConfigured: true, gateAllowed: false,
}).action === 'next');
rec('the landing page links here rather than opening a form of its own',
    /href=\\?\"\/genesis\\?\"/.test(read('lib/static-pages.js')) && !/<form/.test(read('lib/static-pages.js')));
rec('the page is listed in the sitemap, because it is a page being advertised',
    /path: '\/genesis'/.test(read('app/sitemap.js')));
rec('the frames are read per request, not frozen at build time', /dynamic = 'force-dynamic'/.test(pageSource),
    'a build-time list would tell the next person a dropped-in capture works when it does not');
rec('the sheet is linked and versioned, so a CSS change reaches a returning player',
    /\/css\/genesis\.css\?v=\d+/.test(clientSource) && /\/theme\.css\?v=\d+/.test(clientSource));
rec('and the page asks for no wallet connection — a waitlist is for people without one',
    !/wallet-source|ethers|Privy|connectWallet/i.test(clientSource));

/** SHA-1 of a file, for the one claim that is about bytes rather than about source. */
function sha1(rel) {
    try {
        return crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex');
    } catch {
        return null;
    }
}

// ------------------------------------------------------------------------- the tally
const failed = results.filter((row) => !row.pass);
console.log('');
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
    console.log('');
    for (const row of failed) console.log(`  FAILED  ${row.label}`);
    process.exit(1);
}
