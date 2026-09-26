#!/usr/bin/env node
/**
 * Is `/docs` still true?
 *
 *     node tools/check-docs.js
 *
 * A documentation page is the one page on this site whose entire value is that a reader can check
 * it, so the ways it goes wrong are specific:
 *
 *   - **It quotes a figure the repository does not.** Every number on the page is computed in
 *     `lib/docs-content.js` from the modules the contracts were deployed from, which is what makes
 *     the page defensible. A copy edit that types one of those figures by hand is how that stops
 *     being true — and it is invisible, because a typed `1,415,120` renders identically to a
 *     derived one. So the check is on the *source*: each figure the config owns must appear inside
 *     an interpolation, never as literal text.
 *   - **It sends a reader to a contract nothing signs for.** The addresses are not restated here;
 *     they are resolved through the deck's own table, which `tools/check-pitch.js` already compares
 *     character for character against `public/contract-addresses.js`. What is asserted here is that
 *     every row still *resolves* — a renamed key would render `undefined` in the address column.
 *   - **A slot's art lands and is never used.** The page renders a stand-in until a piece of art
 *     arrives. That is a fine arrangement for a week and a lie after a month: the new file sits in
 *     `public/` while the page shows the old one, and nothing anywhere notices. A slot whose file
 *     exists and is not being rendered fails this by name.
 *   - **The page stops being reachable.** `/docs` is the only route whose whole job is to be read by
 *     somebody who has not arrived yet, so it is asked of the routing module directly: on the apex it
 *     must be served, not redirected to the password.
 *   - **It advertises something held back.** The wheel is unpublished (`REDEEM_LIVE`), and a docs
 *     page is exactly where a link to it would get written by somebody who did not know.
 *
 * Every guard was falsified by mutation before it was trusted — the rule broken on purpose, the run
 * watched to fail **by name**, then the rule restored. The mutations are listed in `.freebuff/run.md`
 * beside the checks they trip.
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

const contentSource = read('lib/docs-content.js');
const clientSource = read('app/docs/client.js');
const pageSource = read('app/docs/page.js');
const sheet = read('public/css/docs.css');
const siteAddresses = read('public/contract-addresses.js');

const Docs = await import(pathToFileURL(path.join(ROOT, 'lib', 'docs-content.js')).href);
const Routing = await import(pathToFileURL(path.join(ROOT, 'lib', 'app-routing.js')).href);
const Deck = await import(pathToFileURL(path.join(ROOT, 'lib', 'pitch-deck.js')).href);
const Points = await import(pathToFileURL(path.join(ROOT, 'lib', 'points-config.js')).href);
const Reward = await import(pathToFileURL(path.join(ROOT, 'lib', 'reward-config.js')).href);
const Staking = await import(pathToFileURL(path.join(ROOT, 'lib', 'staking-config.js')).href);
const Knights = await import(pathToFileURL(path.join(ROOT, 'lib', 'knights.js')).href);
const Sitemap = await import(pathToFileURL(path.join(ROOT, 'app', 'sitemap.js')).href);

const { fmt } = Deck;
const { ART, SECTIONS, NAV, FAQ, CONTRACTS_SECTION, NUMBERS, POINTS, DRAW, START, LORE, HERO, TICKER, FOOTER } = Docs;

console.log('');
console.log('The docs page — /docs');
console.log(`  ${SECTIONS.length} sections, ${ART.length ?? Object.keys(ART).length} art slots, ${FAQ.items.length} questions`);

// ======================================================== 1. what the page refuses to say
section('The page quotes no tokenomics');

/**
 * Every comment out of a source file, so the scan below reads the code rather than the prose about
 * it.
 *
 * This is not a nicety: the guard caught its own first fix. The line that interpolates the reset
 * hour explains itself in a comment containing `12:00`, and a reader that scanned the whole file
 * reported that comment as a typed figure. A comment is not a number a reader sees, and a check that
 * cannot tell the difference is a check somebody will switch off — the same lesson
 * `tools/check-board-map.js` learned when a tag regex matched the words `<video autoPlay>` inside a
 * comment.
 *
 * `[^:]` before `//` so a URL is not read as the start of a comment.
 */
function stripComments(text) {
    return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Replace every `${…}` in a template with a marker, counting braces.
 *
 * Counting matters rather than matching: the copy contains `${(REFERRAL_1ST_PCT * 100).toFixed(0)}%`
 * and `` `${VAULT_LEVELS.map((level) => `${level.name} **${fmt(level.points)}**`).join(', ')}` `` —
 * nested holes. A reader that stopped at the first `}` would carry on *inside* the interpolation and
 * report the remainder as literal text, which is a finding about the reader rather than the page.
 */
function stripInterpolations(text) {
    let out = '';
    let index = 0;
    while (index < text.length) {
        if (text[index] === '$' && text[index + 1] === '{') {
            let depth = 1;
            index += 2;
            while (index < text.length && depth > 0) {
                if (text[index] === '{') depth += 1;
                else if (text[index] === '}') depth -= 1;
                index += 1;
            }
            out += ' ';
        } else {
            out += text[index];
            index += 1;
        }
    }
    return out;
}

const code = stripComments(contentSource);
const literalText = stripInterpolations(code);

/** Every string a reader can see, anywhere in the content module. */
function stringsOf(value, out = []) {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) for (const item of value) stringsOf(item, out);
    else if (value && typeof value === 'object') for (const item of Object.values(value)) stringsOf(item, out);
    return out;
}

const rendered = stringsOf({ HERO, TICKER, LORE, START, NUMBERS, POINTS, DRAW, CONTRACTS_SECTION, FAQ, FOOTER, NAV }).join('\n');

/*
 * The absence, asserted by pattern rather than by a list of forbidden words.
 *
 * A list would only catch the figures somebody thought of; the one that leaks is the one whose
 * spelling nobody predicted. These three patterns are the *kinds* of disclosure — a price, a share,
 * a big number — and they hold whether the number arrives from the config, from a hand-typed string
 * or from a sentence nobody expected.
 */
const dngAmounts = rendered.match(/\d[\d,.]*\s*\$DNG/g) || [];
rec('no price in $DNG is quoted anywhere on the page', dngAmounts.length === 0,
    dngAmounts.join(', ') || 'the summon price and the reward table are withheld');

const shares = rendered.match(/\d+(?:\.\d+)?%\s*(?:of|in)\b/gi) || [];
rec('no share of a supply is quoted', shares.length === 0, shares.join(', ') || 'the vault share is withheld');
rec('and the vault\u2019s own share of the supply is nowhere in the copy',
    !rendered.includes(`${Reward.REWARD_VAULT_PCT}%`), `${Reward.REWARD_VAULT_PCT}%`);

// Four digits or more, years excepted. This is the pattern behind the supply, the vault balance and
// the weekly release all at once — and the `20xx` exemption is the one number a page is allowed to
// state about itself, a date it did something.
const bigNumbers = (rendered.match(/\b\d{1,3}(?:,\d{3})+\b|\b\d{4,}\b/g) || []).filter((n) => !/^(?:19|20)\d\d$/.test(n));
rec('no number of four digits or more appears, other than a year', bigNumbers.length === 0,
    bigNumbers.join(', ') || 'supply, vault balance and weekly release all withheld');

// The other half of a refusal: a reader who came for the number has to be told where it will be, or
// the silence reads as the page having forgotten to say.
const tba = NUMBERS.stats.filter((stat) => stat.value === 'To be announced' && stat.tba === true);
// Labels *and* their sub-lines: the word "supply" is in the card's explanation rather than its
// heading, and a guard that read only the heading would have called that card missing.
const topics = NUMBERS.stats.map((stat) => `${stat.label} ${stat.sub}`.toLowerCase()).join(' | ');
rec('every withheld figure has a \u201cto be announced\u201d home in the numbers section',
    tba.length === NUMBERS.stats.length && NUMBERS.stats.length >= 4
    && /supply/.test(topics) && /(pays|reward)/.test(topics) && /(summon|cost|price)/.test(topics) && /(sale|sell)/.test(topics),
    NUMBERS.stats.map((stat) => stat.label).join(' · '));
// The *quoted* token, not the bare name. The first draft of this guard passed on a comment inside
// the JSX that mentions `docs-stat-value-tba` to explain itself — the third time in this project a
// check has been fooled by prose rather than code, which is why the needle here carries its quotes.
rec('  \u2026 and the long placeholder wears the modifier the sheet sized for it',
    /' docs-stat-value-tba'/.test(clientSource) && /\.docs-stat-value-tba \{/.test(sheet));
rec('the FAQ answers \u201chow much does it cost\u201d with a date rather than a number',
    FAQ.items.some((item) => /how much/i.test(item.q) && /to be announced/i.test(item.a) && /before launch/i.test(item.a)),
    FAQ.items.find((item) => /how much/i.test(item.q))?.q || 'no such question');
rec('and the page says so in its own voice beside the placeholders',
    /nothing on this page quotes a supply, a price or a reward/i.test(NUMBERS.note));

// ======================================================= 2. what it does state is derived
section('What the page does state comes from the config');

/**
 * The figures the page *is* allowed to state: the name, and the literal text that would appear on
 * the page if somebody typed the figure instead of interpolating it.
 *
 * The literal carries its unit rather than being the bare digits, and that is what makes short
 * figures checkable at all: `900` on its own is a substring of half the file, while `900 points` is
 * a claim about the vault entry and nothing else. An earlier draft filtered short values out and
 * quietly stopped checking two of the five.
 */
const OWNED = {
    'the vault entry total': `${fmt(Points.VAULT_ENTRY_TOTAL)} points`,
    'the streak bonus': `${fmt(Points.STREAK_BASE)} points`,
    'the streak ceiling': `${Points.STREAK_MAX_MULTIPLIER}×`,
    'the referral shares': `${(Points.REFERRAL_1ST_PCT * 100).toFixed(0)}%`,
    'the reset hour': `${String(Reward.GAME_RESET_HOUR_UTC).padStart(2, '0')}:00`,
};
const owned = Object.entries(OWNED);

rec('there are figures to check, so this section cannot pass by having nothing in it',
    owned.length >= 5, owned.map(([name, value]) => `${name}=${value}`).join(' · '));

for (const [name, value] of owned) {
    rec(`${name} is interpolated rather than typed (${value})`,
        !literalText.includes(value),
        literalText.includes(value)
            ? `"${value}" appears as literal text — ${code.split('\n').find((line) => line.includes(value) && !line.includes('${'))?.trim().slice(0, 70) || 'in the source'}`
            : 'built from the config');
}

rec('the content module imports the modules it derives from',
    /from '\.\/reward-config\.js'/.test(contentSource)
    && /from '\.\/points-config\.js'/.test(contentSource)
    && /from '\.\/knights\.js'/.test(contentSource));

// A second copy of a figure is not only a typo risk, it is a second thing to update. The rendered
// values are compared to the config here so a hand-edited export is caught even if it is spelled
// with a different formatter.
rec('the rendered numbers are the config\u2019s own',
    START.steps[3].text.includes(`${fmt(Points.VAULT_ENTRY_TOTAL)} points`)
    && DRAW.body.includes(`${fmt(Points.DRAW_SIZE)} Knight capsules`)
    && DRAW.body.includes(Points.DRAW_CAPSULE.name)
    && START.steps[0].text.includes(`${Knights.KNIGHT_TIERS.length} rarities`),
    `${fmt(Points.VAULT_ENTRY_TOTAL)} points an entry, ${fmt(Points.DRAW_SIZE)} Knight capsules (${Points.DRAW_CAPSULE.name}), ${Knights.KNIGHT_TIERS.length} tiers`);

/*
 * The prize has one name, and the program already owns it.
 *
 * `drawCapsuleLabel()` in `lib/points-config.js` returns *"10 free Knight capsules"* — that is the
 * word the Points Program itself puts in front of a player, and the docs page had drifted from it to
 * *"a capsule a night"*: a pun that puts a time of day where the product's noun belongs, on the page
 * a stranger reads before they have played anything. Two claims, because they fail differently: the
 * page naming a Knight at all, and the page not leaning on `night` where the reader expects `Knight`.
 *
 * `\bnight\w*` and not `\bnight\b`: the drift included the adjective `nightly`, and a guard that
 * missed the word in its adverb form would have passed on the half of the problem it was written for.
 * It does not match `midnight`, which is the one use of the letters that is a real time of day and
 * belongs on the page — a word boundary is what tells those apart.
 */
const drawWords = [DRAW.nav, DRAW.title, DRAW.body, ...TICKER].join(' ');
rec('the draw names its prize the way the program does — a Knight capsule',
    /knight capsule/i.test(Points.drawCapsuleLabel()) && /knight capsule/i.test(DRAW.body)
    && /knight/i.test(DRAW.title),
    `${Points.drawCapsuleLabel()} · the page: "${DRAW.title}"`);
rec('and nothing in the draw leans on \u201cnight\u201d where a reader reads \u201cKnight\u201d',
    !/\bnight\w*/i.test(drawWords),
    (drawWords.match(/\bnight\w*/gi) || []).join(', ') || 'the draw copy says Knight, or a time');

// The claim above compares *values*, and a value comparison cannot see a number that was typed by
// hand and happens to be right. Measured: replacing the interpolation with a literal `10 Knight
// capsules` passed every check in this file, because 10 is what the config says. So the count is
// asserted to be an interpolation the way the section-2 figures are — against the source with every
// `${…}` stripped out, where a hand-typed figure is visible and a built one leaves nothing behind.
rec('  \u2026 and the draw\u2019s count is interpolated rather than typed into the sentence',
    !literalText.includes(`${fmt(Points.DRAW_SIZE)} Knight capsules`),
    literalText.includes(`${fmt(Points.DRAW_SIZE)} Knight capsules`)
        ? `"${fmt(Points.DRAW_SIZE)} Knight capsules" appears as literal text`
        : `built from DRAW_SIZE (${Points.DRAW_SIZE})`);

// ======================================================= 3. no code in the reader's way
section('Plain language');

const calls = rendered.match(/\b\w+\s*\(\s*\)/g) || [];
rec('no function call survives in the copy', calls.length === 0,
    calls.join(', ') || 'the reader is never shown a signature');
const snippets = rendered.match(/`[^`]+`/g) || [];
rec('no backticked snippet survives in the copy', snippets.length === 0,
    snippets.join(' ') || 'nothing is quoted as code');
// URLs out first. `discord.gg/zZFqA9Fqe` and `…robinhood.com/address` are links a reader is meant to
// follow, not module names — and a guard that flagged them failed on its first run, which is the
// cheap way to learn that "a path in the prose" is a different question from "any slash at all".
const prose = rendered.replace(/https?:\/\/\S+/g, ' ');
const paths = prose.match(/\b\w+\/[\w-]+|\b\w+\.js\b/g) || [];
rec('no file path or module name survives in the copy', paths.length === 0,
    paths.join(', ') || 'only the explorer link names a place to look');

/*
 * And the last way a page goes technical is vocabulary rather than syntax.
 *
 * A sentence can be free of calls, snippets and paths and still be written from inside the build —
 * "withheld pending tokenomics" is a refusal a reader cannot read. The word that prompted this was
 * "tokenomics" sitting in an FAQ answer *next to* a correctly withheld figure: the number was
 * protected and the jargon was not, which is how a refusal starts sounding like a dodge.
 *
 * Read off the rendered copy only, and deliberately not the source: the content module's own
 * comments say "config", "handler" and "import" all day, and a guard that scanned them would be
 * failing on prose about the page rather than on the page.
 */
const jargon = [...new Set((rendered.match(/\b(?:tokenomic\w*|api|json|yaml|yml|cli|npm|backend|back-?end|frontend|front-?end|endpoint|webhook|graphql|regex)\b/gi) || [])
    .map((word) => word.toLowerCase()))];
rec('no word in the copy is one only a builder knows', jargon.length === 0,
    jargon.join(', ') || `${rendered.split('\n').length} strings of copy, none of them build vocabulary`);

// ============================================================================= 2. the addresses
section('The addresses resolve to the one deployed set');

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

rec('a row per contract, and every row names a key the deck actually carries',
    CONTRACTS_SECTION.rows.length === Object.keys(Deck.CONTRACTS).length
    && CONTRACTS_SECTION.rows.every((row) => typeof Deck.CONTRACTS[row.key] === 'string'),
    CONTRACTS_SECTION.rows.map((row) => row.key).join(' '));

// Every contract once. Without this, a row pointed at the wrong key *passes* — the row's own check
// compares the site's address for whatever key it names against the deck's address for that same
// key, and both sides agree. Measured: renaming the vault's row to `game` left nine rows, ten
// correct addresses and no failure. It was the mutation sweep that found it, not a reader.
const rowKeys = CONTRACTS_SECTION.rows.map((row) => row.key);
rec('every contract appears exactly once, and none is missing',
    new Set(rowKeys).size === rowKeys.length
    && [...rowKeys].sort().join(' ') === Object.keys(Deck.CONTRACTS).sort().join(' '),
    rowKeys.join(' '));

const unknown = CONTRACTS_SECTION.rows.filter((row) => !SITE_KEYS[row.key]);
rec('and none of them is a key the site\u2019s own address file would not know', unknown.length === 0,
    unknown.map((row) => row.key).join(' ') || `${SITE_KEYS[CONTRACTS_SECTION.rows[0].key]} ↔ ${Deck.CONTRACTS[CONTRACTS_SECTION.rows[0].key]}`);

for (const row of CONTRACTS_SECTION.rows) {
    const expected = new RegExp(`${SITE_KEYS[row.key]}:\\s*'(0x[0-9a-fA-F]{40})'`).exec(siteAddresses);
    rec(`  ${row.name} is the address public/contract-addresses.js carries`,
        expected !== null && Deck.CONTRACTS[row.key] === expected[1],
        expected === null ? `no ${SITE_KEYS[row.key]} in the file` : Deck.CONTRACTS[row.key]);
}

rec('and the explorer link is absolute, so it works from the page',
    /^https:\/\//.test(CONTRACTS_SECTION.explorer));

// The list is **withheld**, at the owner's instruction: the addresses are not to be shown to anybody
// yet. The section keeps its heading and its place in the nav, and the nine rows are blurred, inert
// and hidden from a screen reader rather than deleted — a blur alone is a picture of secrecy, and the
// explorer links behind it would still open a tab. The rows stay in the client, so publishing is
// deleting a wrapper and a paragraph rather than rebuilding the list.
const contractBlock = (clientSource.match(/<section className="docs-section" id=\{CONTRACTS_SECTION\.id\}>[\s\S]*?<\/section>/) || [''])[0];
rec('the contracts list is withheld while the deployment is not published',
    /className="docs-soon-body" aria-hidden="true"/.test(contractBlock)
    && contractBlock.indexOf('docs-soon-body') < contractBlock.indexOf('docs-rows')
    && /docs-soon-chip/.test(contractBlock) && /docs-soon-note/.test(contractBlock),
    contractBlock ? 'blurred body, hidden from a screen reader, with a sentence in its place' : 'no contracts section found');
// Every touch of the address table, not just the one that looks like `CONTRACTS[row.key]`: the first
// draft of this line counted `CONTRACTS[` and the mutation sweep walked straight past
// `{CONTRACTS.token}` printed above the blur. The claim is positional now — with the import lines off
// the top, the table may not be named *before* the blurred body opens, and must be named inside it.
const noImports = clientSource.replace(/^import[^\n]*$/gm, '');
const blurAt = noImports.indexOf('className="docs-soon-body"');
rec('  \u2026 and no address is printed anywhere outside that blurred body',
    blurAt > -1
    && !/\bCONTRACTS\b/.test(noImports.slice(0, blurAt))
    && /\bCONTRACTS\b/.test(noImports.slice(blurAt)),
    blurAt > -1 ? `${(noImports.slice(0, blurAt).match(/\bCONTRACTS\b/g) || []).length} mention(s) of the table before the blur` : 'no blurred body found');
rec('  \u2026 and the sheet blurs it and makes its controls inert',
    /\.docs-soon-body\s*\{[^}]*filter:\s*blur\(/.test(sheet)
    && /\.docs-soon-body\s*\{[^}]*pointer-events:\s*none/.test(sheet)
    && /\.docs-soon-body\s*\{[^}]*user-select:\s*none/.test(sheet),
    'blur + pointer-events: none + user-select: none');
// `user-select` is the half that a screenshot cannot show: the text is in the DOM, so a reader who
// drags across the blur would otherwise get the addresses into their clipboard and never notice.
rec('  \u2026 and the heading stays, so the section a reader came for has not vanished',
    /<SectionHead title=\{CONTRACTS_SECTION\.title\} sub=\{CONTRACTS_SECTION\.sub\} \/>/.test(contractBlock)
    && /'contracts'/.test(contentSource));

// The footer, minus its `Source` item: the owner asked that the repository not be shown on the pages
// the public can open. The pitch deck still names it — that page is behind the password and its whole
// job is to hand a reader something to read — so the claim here is about this list, not about the
// project's links generally.
rec('the footer names no repository, on the owner\u2019s instruction',
    !FOOTER.links.some((link) => /github/i.test(link.href) || /source|github|repo/i.test(link.label))
    && !/github/i.test(rendered),
    FOOTER.links.map((link) => link.label).join(' \u00b7 '));

// ================================================================================== 3. the art
section('The art slots');

const slotPaths = Object.entries(ART);
rec('every slot is a file of its own under /assets/docs/ — a stand-in may borrow, a slot may not',
    slotPaths.every(([, entry]) => entry.slot.startsWith('/assets/docs/')));
rec('each one carries a note saying what it is for, so the brief and the code agree',
    slotPaths.every(([, entry]) => typeof entry.note === 'string' && entry.note.length > 8));

const deadStands = slotPaths.filter(([, entry]) => entry.use && !exists(`public${entry.use}`));
rec('no slot is standing in with a file that does not exist', deadStands.length === 0,
    deadStands.map(([key, entry]) => `${key} → ${entry.use}`).join(', ') || `${slotPaths.length} slots`);

const pending = [];
const landed = [];
const stranded = [];
for (const [key, entry] of slotPaths) {
    const hasArt = exists(`public${entry.slot}`);
    if (!entry.use) {
        // A CSS-only slot: the file is painted by the stylesheet, so "is it used" is a question
        // about the sheet rather than about this module.
        rec(`  ${key} — the sheet paints it, so the slot is wired`, sheet.includes(entry.slot), entry.slot);
        if (hasArt) landed.push(key);
        else pending.push(key);
        continue;
    }
    if (!hasArt) {
        pending.push(key);
        continue;
    }
    landed.push(key);
    if (entry.use !== entry.slot) stranded.push(`${key}: ${entry.use.split('/').pop()} renders, ${entry.slot.split('/').pop()} sits unused`);
}

rec('a piece of art that has landed is the piece being rendered', stranded.length === 0,
    stranded.join('; ') || (landed.length ? `${landed.length} landed and in use` : 'none landed yet'));

// Printed rather than silent: a pending list nobody can read is indistinguishable from a slot that
// was quietly dropped.
console.log('');
console.log(`  Slots: ${landed.length} landed, ${pending.length} waiting on art`);
if (pending.length) console.log(`    waiting: ${pending.join(', ')}`);

// ================================================================================ 4. the page
section('The page itself');

rec('the route exists and renders its client', exists('app/docs/page.js') && /<DocsClient \/>/.test(pageSource));
rec('the sheet is linked with a version, so a change reaches a returning reader',
    /<link rel="stylesheet" href="\/css\/docs\.css\?v=\d+" \/>/.test(clientSource));
rec('and the root sheet, at the root path — `/css/theme.css` 404s silently',
    /<link rel="stylesheet" href="\/theme\.css\?v=\d+" \/>/.test(clientSource));

// The wallet control, on this route like every other one: My Portfolio is only reachable through
// the menu hanging off that pill, and `tools/check-wallet-menu.js` reads the route list out of
// `app/` rather than trusting a list here.
rec('the header carries a wallet control for the menu to attach to',
    /className="wallet-pill"/.test(clientSource));
rec('the page loads the module that turns it into a menu',
    /<Script src="\/wallet-menu\.js\?v=\d+"/.test(clientSource));
rec('and attaches it by hand, because this route renders after hydration',
    /WalletMenu\.attach\(pill, \{ onDisconnect/.test(clientSource));
rec('  … with a disconnect that clears the saved address rather than only the pill',
    /forgetWallet\(\)/.test(clientSource));

// Every class this page invents must be defined by its own sheet. `tools/check-styles.js` makes
// this claim project-wide by parsing markup; this makes it for the tokens whose prefix says they
// belong here, so a typo in `docs-faq-text` is caught by a run of this file too.
const usedTokens = new Set();
for (const match of clientSource.matchAll(/className=\{?["'`]([^"'`]*)["'`]/g)) {
    // The interpolation comes out before the split, for the same reason `tools/check-styles.js`
    // counts braces: `docs-stat-value${stat.tba ? ' docs-stat-value-tba' : ''}` otherwise reads as a
    // class called `docs-stat-value${stat.tba`, which is a finding about this reader rather than
    // about the page. What the hole *contains* is guarded where it belongs — the “to be announced”
    // check names `docs-stat-value-tba` on both sides.
    for (const token of stripInterpolations(match[1]).split(/\s+/)) {
        if (token.startsWith('docs-')) usedTokens.add(token);
    }
}
const undefinedTokens = [...usedTokens].filter((token) => !new RegExp(`\\.${token}\\b`).test(sheet));
rec('every `docs-` class the page wears is a rule in docs.css', undefinedTokens.length === 0,
    undefinedTokens.join(', ') || `${usedTokens.size} tokens`);

// ============================================================ 5. the structure holds together
section('The nav, the anchors and the grammar');

const ids = SECTIONS.map((section_) => section_.id);
rec('section ids are unique', new Set(ids).size === ids.length, ids.join(' '));
rec('the nav is the sections, in the same order',
    NAV.length === SECTIONS.length && NAV.every((entry, index) => entry.id === ids[index] && entry.label === SECTIONS[index].nav));
rec('every anchor a reader can click has a target in the markup',
    ids.every((id) => new RegExp(`id=\\{${'[A-Z_]+'}\\.id\\}|id="${id}"`).test(clientSource)) && ids.every((id) => clientSource.includes(`#${id}`) || NAV.some((entry) => entry.id === id)),
    ids.join(' '));
rec('every section object is rendered by the page, and none is data with no reader',
    ['LORE', 'START', 'NUMBERS', 'POINTS', 'DRAW', 'CONTRACTS_SECTION', 'FAQ'].every((name) => clientSource.includes(name)));

// The nav is sticky and the sections know it: without `scroll-margin-top` an anchor jump lands with
// the heading behind the bar, which reads as a link that did nothing.
// `[1-9]\d+`, not `\d+`: the first draft accepted `scroll-margin-top: 0px`, which is the rule
// present and the behaviour absent — the laxest possible way to pass.
rec('the nav sticks, and the sections leave room for it when jumped to',
    /\.docs-nav \{[\s\S]*?position: sticky/.test(sheet) && /scroll-margin-top: [1-9]\d+px/.test(sheet));
rec('the strip stops under prefers-reduced-motion', /prefers-reduced-motion[\s\S]*?\.docs-ticker-track \{\s*\n\s*animation: none/.test(sheet));

// A fragment link lands where the browser measured the page, and this page is measured before its
// headings have swapped from the fallback face to Cinzel — so `/docs#draw` arrived on the contracts
// table. Landing has to be re-applied once the fonts settle, and *not* re-applied to a reader who
// has already started scrolling. Two claims, because either half alone is a bug: without the
// re-land the deep link is wrong, and without the guard the page yanks itself away from somebody.
rec('a deep link is re-applied once the fonts have settled',
    /document\.fonts\?\.ready\?\.then/.test(clientSource) && /scrollIntoView\(\)/.test(clientSource));
rec('  … and not under a reader who has taken over',
    ['wheel', 'touchstart', 'keydown', 'mousedown'].every((event) => clientSource.includes(`'${event}'`))
    && /taken = true/.test(clientSource),
    'the four ways a scroll starts are watched');

const everyString = rendered.split('\n');
const unbalanced = everyString.filter((text) => {
    const bold = (text.match(/\*\*/g) || []).length;
    const code = (text.match(/`/g) || []).length;
    return bold % 2 !== 0 || code % 2 !== 0;
});
rec('every inline marker pairs, so nothing prints a stray asterisk', unbalanced.length === 0,
    unbalanced.map((text) => text.slice(0, 48)).join(' | ') || `${everyString.length} strings walked`);

// One call site per field of copy, named rather than counted, and required whether or not the copy
// carries a marker today: the failure this is for is a *particular* sentence rendered raw, and
// `rich(` appearing somewhere on the page says nothing about whether the FAQ's answers go through
// it. Requiring all six is also what keeps the parser in place for a marker added tomorrow.
const RICH_SITES = [
    ['LORE.paragraphs', 'rich(paragraph)'],
    ['START.steps', 'rich(step.text)'],
    ['POINTS.cards', 'rich(card.text)'],
    ['DRAW.body', 'rich(DRAW.body)'],
    ['DRAW.note', 'rich(DRAW.note)'],
    ['FAQ.items', 'rich(item.a)'],
];
const marked = {
    'LORE.paragraphs': stringsOf(LORE).some((text) => /\*\*|`/.test(text)),
    'START.steps': stringsOf(START).some((text) => /\*\*|`/.test(text)),
    'POINTS.cards': stringsOf(POINTS).some((text) => /\*\*|`/.test(text)),
    'DRAW.body': /\*\*|`/.test(DRAW.body),
    'DRAW.note': /\*\*|`/.test(DRAW.note),
    'FAQ.items': stringsOf(FAQ).some((text) => /\*\*|`/.test(text)),
};
const unparsed = RICH_SITES.filter(([, call]) => !clientSource.includes(call));
const withMarkers = Object.entries(marked).filter(([, has]) => has).map(([field]) => field);
rec('every field of copy is rendered through the parser that understands its markers',
    unparsed.length === 0 && /function rich\(/.test(clientSource),
    unparsed.map(([field]) => field).join(', ') || `${RICH_SITES.length} fields through rich(); carrying a marker today: ${withMarkers.join(', ') || 'none'}`);

// ============================================================= 6. the questions are the honest half
section('What the page admits');

const missing = FAQ.items.find((item) => /missing|not finished|unfinished/i.test(item.q));
rec('the FAQ still says what is not finished, rather than only what works',
    !!missing && /audit/i.test(missing.a),
    missing ? missing.q : 'no such question');
rec('and it does not claim an audit that has not happened',
    !/\bis audited\b/i.test(stringsOf(FAQ).join(' ')) || /no external audit/i.test(missing?.a || ''),
    'the answer says "no external audit"');
rec('the spend path for points is described as held back rather than advertised',
    FAQ.items.some((item) => /spent on/i.test(item.q) && /held back/i.test(item.a)));
rec('it uses a native disclosure, so the answers work with scripting off',
    /<details/.test(clientSource) && !/docs-faq[\s\S]{0,200}onClick/.test(clientSource));

// =================================================================== 7. it is reachable, and quiet
section('Where the page lives');

rec('the apex serves it, rather than sending a stranger to the password',
    Routing.classify('/docs') === 'apex-public'
    && Routing.decideRoute({ isApp: false, isApex: true, kind: Routing.classify('/docs'), pathname: '/docs', search: '', passwordConfigured: true, gateAllowed: false }).action === 'next',
    `${Routing.classify('/docs')}`);
rec('it is not on a list that would open it on the game host as well',
    !Routing.GLOBAL_OPEN.includes('/docs') && !Routing.APP_OPEN.includes('/docs'),
    `GLOBAL_OPEN has ${Routing.GLOBAL_OPEN.length} paths, APP_OPEN ${Routing.APP_OPEN.length}`);
rec('and the sitemap does not promise a URL the apex would redirect',
    Sitemap.default().some((entry) => entry.url.endsWith('/docs')) && Routing.classify('/docs') === 'apex-public',
    Sitemap.default().map((entry) => entry.url.replace(/^https?:\/\/[^/]+/, '')).join(' '));

rec('the page does not link the wheel while it is held back',
    !/\/redeem/.test(contentSource) && !/\/redeem/.test(clientSource),
    Points.REDEEM_LIVE ? 'the wheel is published, so this may relax' : 'REDEEM_LIVE is off');

rec('the page reads nothing from the chain, so it cannot fail in front of a reader',
    !/fetch\(|ethers|balanceOf/.test(clientSource));

console.log('');
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
    console.log('');
    for (const f of failed) console.log(`  FAILED: ${f.label}`);
    process.exitCode = 1;
}
