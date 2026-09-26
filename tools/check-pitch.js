#!/usr/bin/env node
/**
 * Is the pitch deck still true?
 *
 *     node tools/check-pitch.js
 *
 * A deck is the one page on this site whose whole argument is that its numbers can be checked, so
 * the ways it can go wrong are specific and none of them are cosmetic:
 *
 *   - **It gets published by accident.** `/pitch` lives on the gated host and is private by
 *     *absence* — it is not in `APP_OPEN`, so the gate covers it. Adding it to an exemption list is
 *     one line, invisible in a browser, and turns an internal deck into a public one. The routing
 *     module is asked here, with a password configured and no cookie, for the answer.
 *   - **A slide quotes a number the repository does not.** Every figure comes out of `lib/`, which is
 *     what makes the deck defensible; a copy edit that types a number by hand is the way that stops
 *     being true. The two invariants that matter most are checked directly: the four line shares sum
 *     to 10,000 (the vault's constructor reverts otherwise) and the four line budgets sum to the
 *     weekly budget.
 *   - **A reader is sent to the wrong contract.** The addresses are compared character for
 *     character against `public/contract-addresses.js`, the file the site itself reads — both
 *     directions, so a contract added there must appear in the deck as well.
 *   - **A block renders nothing.** A slide is data interpreted by `app/pitch/client.js`; a block
 *     kind with no `case` is a silent hole on a slide, and neither `next build` nor a screenshot
 *     would tell you which sentence went missing.
 *   - **An inline marker is unbalanced.** `**bold**` and `` `code` `` are parsed by the renderer, so
 *     one stray asterisk prints as a literal asterisk on a slide about rigour.
 *
 * Every guard here was falsified by mutation before it was trusted — the rule broken on purpose, the
 * run watched to fail **by name**, then the rule restored. The mutations are listed in
 * `.freebuff/run.md` beside the checks they trip.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

function section(title) {
    console.log('');
    console.log(title);
}

const deckSource = read('lib/pitch-deck.js');
const clientSource = read('app/pitch/client.js');
const pageSource = read('app/pitch/page.js');
const siteAddresses = read('public/contract-addresses.js');

const Deck = await import(pathToFileURL(path.join(ROOT, 'lib', 'pitch-deck.js')).href);
const Routing = await import(pathToFileURL(path.join(ROOT, 'lib', 'app-routing.js')).href);
const Points = await import(pathToFileURL(path.join(ROOT, 'lib', 'points-config.js')).href);
const Reward = await import(pathToFileURL(path.join(ROOT, 'lib', 'reward-config.js')).href);
const Knights = await import(pathToFileURL(path.join(ROOT, 'lib', 'knights.js')).href);
const Pages = await import(pathToFileURL(path.join(ROOT, 'lib', 'static-pages.js')).href);

const { SLIDES, CONTRACTS, LINKS, MODEL } = Deck;

/** Every string inside a slide, wherever it sits in the block list. */
function stringsOf(value, out = []) {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) for (const item of value) stringsOf(item, out);
    else if (value && typeof value === 'object') for (const item of Object.values(value)) stringsOf(item, out);
    return out;
}

console.log('');
console.log('The pitch deck — /pitch');
console.log(`  ${SLIDES.length} slides, ${Object.keys(CONTRACTS).length} contracts, ${Deck.fmt(MODEL.budget)} $DNG a week`);

// ------------------------------------------------------------------ 1. it is still private
section('Where the deck lives');

const gateAnswer = Routing.decideRoute({
    isApp: true,
    kind: Routing.classify('/pitch'),
    pathname: '/pitch',
    passwordConfigured: true,
    gateAllowed: false,
});
rec('the deck is behind the gate: a stranger with no cookie is sent to the password screen',
    gateAnswer.action === 'gate' && gateAnswer.next === '/pitch', JSON.stringify(gateAnswer));

const withQuery = Routing.decideRoute({
    isApp: true,
    kind: Routing.classify('/pitch'),
    pathname: '/pitch',
    search: '?slide=7',
    passwordConfigured: true,
    gateAllowed: false,
});
rec('and it remembers where they were going, slide and all',
    withQuery.action === 'gate' && withQuery.next === '/pitch?slide=7', JSON.stringify(withQuery));

const inside = Routing.decideRoute({
    isApp: true,
    kind: Routing.classify('/pitch'),
    pathname: '/pitch',
    passwordConfigured: true,
    gateAllowed: true,
});
rec('once the password is in, the deck is served like any other page of the game',
    inside.action === 'next', JSON.stringify(inside));

rec('the deck is private by absence, not by a rule: the routing module never names it',
    !/pitch/.test(read('lib/app-routing.js')),
    'no exemption to forget about');

const apex = Routing.decideRoute({
    isApex: true,
    kind: Routing.classify('/pitch'),
    pathname: '/pitch',
    passwordConfigured: true,
});
rec('on the public apex it is not served either — the apex sends it to the gated host',
    apex.action === 'redirect' && String(apex.to).endsWith('/pitch'), JSON.stringify(apex));

rec('an extensionless route, so it cannot fall through as a static file',
    Routing.classify('/pitch') === 'other' && !Routing.isStaticFile('/pitch'),
    Routing.classify('/pitch'));

rec('the page itself asks not to be indexed, the way the hub does',
    /robots:\s*\{\s*index:\s*false/.test(pageSource.replace(/\s+/g, ' ')),
    'the same product under two hostnames is not two search results');

/* It has to be *reachable*, or it is a document nobody opens. The way in is a card on the Kingdom
 * Gate hub — the gated host's front page, which is the same host the deck is served from, so the
 * link can never point across the password. The public coming-soon page is checked in the other
 * direction: a card there would send a stranger to a password prompt. */
const hub = Pages.STATIC_PAGES.landing;
const hubBody = hub.body;
const landingScript = read('public/landing.js');
rec('the hub carries a card for the deck, so nobody has to know the URL',
    /id="pitchBtn"/.test(hubBody) && /\/pitch'/.test(landingScript),
    'the Pitch Deck card is in the Adventure panel');
rec('and its handler is the one that opens /pitch',
    /this\.pitchBtn\.addEventListener\('click'[\s\S]{0,300}?window\.location\.href = '\/pitch'/.test(landingScript),
    'a click handler, not a comment');
rec('  \u2026 with the script version bumped, so a browser holding the old shell still gets it',
    hub.scripts.some((src) => /^landing\.js\?v=(\d+)$/.test(src))
        && /landing\.js\?v=(\d+)/.exec(hub.scripts.join(' '))[1] !== '4',
    hub.scripts.find((src) => src.startsWith('landing.js')) || 'landing.js is not in the script list');
rec('and the public page does not point at it — that page is where the password would eat the click',
    !/pitchBtn/.test(Pages.STATIC_PAGES.home.body) && !/\/pitch/.test(Pages.STATIC_PAGES.home.body),
    'the apex keeps its two buttons');

// ---------------------------------------------------------------------- 2. the sheet and shell
section('The shell');

const linkMatch = /href="\/css\/pitch\.css\?v=(\d+)"/.exec(clientSource);
rec('the deck names its own stylesheet, versioned', Boolean(linkMatch), linkMatch ? `pitch.css?v=${linkMatch[1]}` : 'no versioned link');
rec('the stylesheet named there exists', exists('public/css/pitch.css'), 'public/css/pitch.css');
rec('theme.css is loaded from the root, where its tokens live',
    /href="\/theme\.css\?v=\d+"/.test(clientSource) && exists('public/theme.css'));
rec('the wallet pill is on this route, because My Portfolio is only reachable through its menu',
    /className="wallet-pill"/.test(clientSource) && /WalletMenu\.attach/.test(clientSource));
rec('the reveal animation is gated on a class the client adds, so no-JS still reads',
    /is-ready/.test(clientSource) && /is-ready\s+\.pitch-inner/.test(read('public/css/pitch.css')));

// ------------------------------------------------------------------------- 3. the slides
section('The slides');

const kinds = new Set();
for (const slide of SLIDES) for (const block of slide.blocks) kinds.add(block.kind);
const handled = new Set([...clientSource.matchAll(/case\s+'([a-z]+)':/g)].map((m) => m[1]));
const unhandled = [...kinds].filter((kind) => !handled.has(kind));
rec('every block kind a slide uses has a renderer, so no sentence goes missing',
    unhandled.length === 0,
    unhandled.length ? `no case for: ${unhandled.join(', ')}` : `${kinds.size} kinds: ${[...kinds].sort().join(' ')}`);

const noBlocks = SLIDES.filter((slide) => !slide.blocks || !slide.blocks.length).map((slide) => slide.id);
rec('and no slide is empty', noBlocks.length === 0 && SLIDES.length >= 10, noBlocks.join(', ') || `${SLIDES.length} slides`);

const ids = SLIDES.map((slide) => slide.id);
rec('slide ids are unique, because the hash and the React keys are built from them',
    new Set(ids).size === ids.length, ids.join(' '));
const navs = SLIDES.map((slide) => slide.nav || '');
rec('every slide carries a dot-rail label of its own',
    navs.every((label) => label.length > 0) && new Set(navs).size === navs.length, navs.join(' · '));

let unbalanced = [];
for (const slide of SLIDES) {
    for (const text of stringsOf(slide.blocks)) {
        // The renderer's own grammar, walked the same way: the markers are consumed left to right,
        // and what sits *between* them must contain no marker character at all. A count of markers
        // is not enough — one stray asterisk leaves the total even and still prints literally
        // ("**a** b * c"), which is exactly the failure this claims to catch.
        const pattern = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g;
        let balanced = true;
        let last = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
            if (/[*`]/.test(text.slice(last, match.index))) {
                balanced = false;
                break;
            }
            last = match.index + match[0].length;
        }
        if (balanced && /[*`]/.test(text.slice(last))) balanced = false;
        if (!balanced) unbalanced.push(`${slide.id}: ${text.slice(0, 60)}`);
    }
}
rec('every **bold**, *italic* and `code` marker in the copy is balanced, so none prints literally',
    unbalanced.length === 0, unbalanced.join(' | ') || `${SLIDES.length} slides of copy`);

// ------------------------------------------------------------------- 4. numbers and addresses
section('The numbers and the addresses');

const bps = MODEL.bps;
rec('the four line shares are the vault\'s own invariant — they sum to exactly 10,000',
    bps.length === 4 && bps.reduce((sum, v) => sum + v, 0) === 10000, bps.join(' + '));

const lineSum = Object.values(MODEL.lines).reduce((sum, v) => sum + v, 0);
rec('the four line budgets are a partition of the weekly budget, not four more numbers',
    Math.abs(lineSum - MODEL.budget) < 1e-6, `${Deck.fmt(lineSum)} of ${Deck.fmt(MODEL.budget)} $DNG`);

rec('the budget, the horizon and the break-even point are the model\'s own',
    MODEL.budget === Reward.weeklyBudgetDng()
        && MODEL.breakEvenKnights === Reward.capsuleBreakEvenMinted()
        && MODEL.horizonDays === Reward.horizonDays(Reward.REWARD_VAULT_DNG),
    `${Deck.fmt(MODEL.budget)} a week · ${Deck.fmt(MODEL.horizonDays)} days of runway`);

rec('the source of that model is named in the deck, so a reader knows where to check it',
    /reward-config\.js/.test(deckSource) || /reward-config\.js/.test(clientSource));

// The site's own file, read as text: importing it would bind this harness to a CommonJS/ESM edge it
// does not need, and a regex over nine known keys is easier to read than the alternative.
const SITE_KEYS = {
    token: 'DNG_TOKEN',
    vault: 'REWARD_VAULT',
    game: 'GAME_CONTRACT',
    knights: 'KNIGHT_NFT',
    genesis: 'GENESIS_NFT',
    capsules: 'CAPSULE_NFT',
    raffle: 'RAFFLE_CONTRACT',
    genesisStaking: 'GENESIS_STAKING',
    knightsStaking: 'KNIGHTS_STAKING',
};
const siteAddressesOf = {};
for (const [name, key] of Object.entries(SITE_KEYS)) {
    const found = new RegExp(`${key}:\\s*'(0x[0-9a-fA-F]{40})'`).exec(siteAddresses);
    siteAddressesOf[name] = found ? found[1] : null;
}
for (const [name, expected] of Object.entries(siteAddressesOf)) {
    rec(`the deck's ${name} address is the one the site resolves`,
        expected !== null && CONTRACTS[name] === expected,
        expected === null ? `public/contract-addresses.js has no ${SITE_KEYS[name]}` : `${CONTRACTS[name]}`);
}
const siteHexes = new Set([...siteAddresses.matchAll(/0x[0-9a-fA-F]{40}/g)].map((m) => m[0]));
const strayed = Object.values(CONTRACTS).filter((address) => !siteHexes.has(address));
const missed = [...siteHexes].filter((address) => !Object.values(CONTRACTS).includes(address));
rec('and it carries every contract the site does — a tenth one would have to be added here too',
    missed.length === 0, missed.join(', ') || `${siteHexes.size} addresses matched`);
rec('nor does it name a contract the site does not',
    strayed.length === 0, strayed.join(', ') || 'no strays');

// --------------------------------------------------------------------------- 5. the two claims
section('The claims that can go stale in a copy edit');

const slideOf = (id) => SLIDES.find((slide) => slide.id === id);
const growth = stringsOf(slideOf('points')?.blocks || []).join(' ');
rec('the growth slide still names the real prize and the real size of the draw',
    growth.includes(Points.DRAW_CAPSULE.name)
        && growth.includes(Deck.fmt(Points.DRAW_SIZE))
        && growth.includes(Points.PROGRAM_DAY_ONE),
    `${Deck.fmt(Points.DRAW_SIZE)} × ${Points.DRAW_CAPSULE.name} since ${Points.PROGRAM_DAY_ONE}`);

/* The loop slide is the one that has to stay in step with the game rather than with the economy:
 * three of its figures are the caps the contracts enforce, and the boundary they roll over on. They
 * are read back as the exact strings the slide prints, built here out of the same constants. */
const dayBlocks = slideOf('day')?.blocks || [];
const dayStats = (dayBlocks.find((block) => block.kind === 'stats')?.items || []).map((item) => item.value);
const dayFlow = dayBlocks.find((block) => block.kind === 'flow');
const capsLadder = Knights.KNIGHT_TIERS.map((key) => Knights.RARITY[key].dailyRuns).join(' / ');
const resetClock = `${String(Reward.GAME_RESET_HOUR_UTC).padStart(2, '0')}:00 UTC`;
rec('the loop slide\u2019s three figures are the code\u2019s: the cap ladder, the Genesis cap and the reset hour',
    dayStats.includes(capsLadder)
        && dayStats.includes(Deck.fmt(Reward.GENESIS_DAILY_RUNS))
        && dayStats.includes(resetClock),
    dayStats.join(' \u00b7 '));
rec('the flow on it is one numbered box per step, and the cap is named on the last one',
    dayFlow?.nodes?.length === 5
        && dayFlow.nodes.map((node) => node.step).join('') === '0102030405'
        && /runsUsed < dailyCap\[rarity\]/.test(dayFlow.nodes[4].text),
    dayFlow ? `${dayFlow.nodes.length} nodes: ${dayFlow.nodes.map((node) => node.title).join(' \u2192 ')}` : 'no flow block');
rec('  \u2026 and the caption says where the day rolls over, in the contracts\u2019 own terms',
    dayFlow?.caption?.includes(resetClock) && dayFlow.caption.includes('currentDayIndex()'),
    resetClock);

const economy = stringsOf(slideOf('economy')?.blocks || []).join(' ');
rec('the economy slide still prints the budget the vault releases, formatted as the page prints it',
    economy.includes(Deck.fmt(MODEL.budget)) && economy.includes(Deck.fmt(MODEL.vault)),
    `${Deck.fmt(MODEL.budget)} a week out of ${Deck.fmt(MODEL.vault)}`);

const shipped = stringsOf(slideOf('shipped')?.blocks || []).join(' ');
rec('the contract count on the delivery slide is the number of addresses the deck carries',
    shipped.includes(String(Object.keys(CONTRACTS).length)) && Object.keys(CONTRACTS).length === siteHexes.size,
    `${Object.keys(CONTRACTS).length} contracts`);

rec('the closing slide links the site, the game, the source and an explorer, all of them real',
    ['site', 'game', 'code'].every((key) => /^https:\/\//.test(LINKS[key]))
        && LINKS.explorer.startsWith('https://')
        && /dungeonknights/.test(LINKS.site + LINKS.game),
    `${LINKS.site} · ${LINKS.game} · ${LINKS.code}`);

// -------------------------------------------------------------------------------- the tally
const failed = results.filter((r) => !r.pass);
console.log('');
if (!results.length) {
    console.log('nothing was checked');
    process.exitCode = 1;
} else {
    console.log(`${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length) {
        console.log('');
        for (const f of failed) console.log(`  FAILED  ${f.label}`);
        process.exitCode = 1;
    }
}
