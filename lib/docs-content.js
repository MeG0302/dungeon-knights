/**
 * `/docs`, as data.
 *
 * The page is one long read — the shape `cashcat.cc` uses: a coloured band with the wordmark and a
 * mono nav, a ticker under it, then sections that each open with a loud uppercase heading. The
 * *bones* are that site's; the skin is this project's, so `/docs` reads as the same product as
 * `/points` and the pitch deck rather than as a token page bolted on the side.
 *
 * Four rules, all of them this repository's rather than preferences:
 *
 *   - **A reader is never handed a token figure.** No supply, no vault balance, no weekly release,
 *     no summon price, no reward per clear — not one number of four digits, and not one price in
 *     $DNG. Those are not published yet, and a documentation page is the worst place to publish
 *     them by accident: it is the page a stranger reads first, and a figure here would be a quote.
 *     What is settled says so; what is not says **to be announced**, in the reader's own terms.
 *     `tools/check-docs.js` asserts the absence — the patterns, not a list of words, because the
 *     figure that leaks is the one whose spelling nobody predicted.
 *   - **Nothing is typed in that the repository already knows.** What the page *does* state — the
 *     points a vault run pays, the streak ladder, the referral shares, how many capsules a night —
 *     is read out of the same modules the game runs on rather than typed into a sentence.
 *   - **No code in the reader's way.** No function names, no file paths, no backticked snippets.
 *     This is a page for somebody who wants to play the game, not for somebody auditing it; the
 *     contracts section links the explorer for the reader who does want to check.
 *   - **What is missing is written down.** The FAQ's last answer is the list of things that are not
 *     finished — no audit, no Genesis mint, no spend path for points, no tokenomics. A docs page
 *     that only describes what works is marketing with a table of contents.
 *
 * `ART` is the other half of the file and it is deliberately shaped like a work order. Every image
 * the page renders is a *slot*: the file it wants, the file it is standing in with today, and the
 * box it has to fit. A slot whose art has arrived but is not being rendered yet is a failure
 * `tools/check-docs.js` reports by name, so "we'll swap it in later" cannot quietly become never.
 */

import { DECK, CHAIN, CONTRACTS, LINKS, fmt } from './pitch-deck.js';
import { GAME_RESET_HOUR_UTC } from './reward-config.js';
import {
    DRAW_CAPSULE,
    DRAW_SIZE,
    ONE_TIME_TASKS,
    REFERRAL_1ST_PCT,
    REFERRAL_2ND_PCT,
    SHARE_OG_IMAGE,
    STREAK_BASE,
    STREAK_MAX_MULTIPLIER,
    VAULT_ENTRY_TOTAL,
    VAULT_LEVELS,
} from './points-config.js';
import { KNIGHT_TIERS } from './knights.js';

/** `12:00 UTC`, spelled once, so the copy and the contracts cannot disagree about the reset. */
const resetClock = `${String(GAME_RESET_HOUR_UTC).padStart(2, '0')}:00 UTC`;

// -------------------------------------------------------------------------------- the art slots
/**
 * One entry per image the page draws.
 *
 *   `slot`  the file this page wants — the name the brief and this table agree on.
 *   `use`   what is rendered until it lands. `null` means the slot is a CSS layer over a drawn
 *           fallback: the layer paints on top of a gradient or a border, so an art file that has
 *           not arrived yet is *invisible* rather than a broken image.
 *
 * The boxes are fixed by the stylesheet (`aspect-ratio` plus `object-fit: cover`), so art at any
 * size drops into its slot without moving anything around it — which is the whole reason a slot can
 * be swapped without a layout change.
 */
export const ART = {
    // The mark above the headline. The one place a single isolated subject is needed, the way the
    // reference page has its cat.
    hero: { slot: '/assets/docs/hero-knight.png', use: '/assets/ui/sword-crest.png', note: 'hero mark, 152px wide, transparent' },
    // The nav's own mark, left of the wordmark. Has to read at 30px.
    crest: { slot: '/assets/docs/wordmark-crest.png', use: '/assets/ui/sword-crest.png', note: 'nav mark, 30px, transparent' },
    // Behind the whole document, at a low opacity over near-black. It is a *fixed layer* rather
    // than a background on the sections: `cover` on a 7,000px-tall element zooms the painting 6×,
    // and `background-attachment: fixed` — the usual workaround — is not supported on iOS. A fixed
    // sized-to-the-viewport layer is the same picture on every browser.
    hall: { slot: '/assets/docs/hero-band.webp', use: '/assets/hall/knight-hall.webp', note: 'the document’s backdrop, 2560×1440' },
    // The framed panel in the lore section.
    lore: { slot: '/assets/docs/lore-scene.webp', use: '/assets/hall/knight-hall.webp', note: 'lore panel, 4:3 — Knight’s Hall today' },
    // The square tile in the how-to box.
    start: { slot: '/assets/docs/start-tile.webp', use: '/assets/hall/summon-hall.webp', note: 'how-to tile, 1:1' },
    // The full-bleed band behind the nightly draw. The stand-in is a *painting*, deliberately: the
    // first candidate here was `genesis/capsules.webp`, which turned out to be a screenshot of the
    // Summoning Chamber page — legible UI text bleeding through a band that carries a headline, and
    // exactly the failure a dark scrim alone does not fix.
    draw: { slot: '/assets/docs/draw-band.webp', use: '/assets/hall/hall-of-fame.webp', note: 'highlight band, 2400×900' },
    // CSS-only layers, each over a drawn fallback — see the header comment.
    stone: { slot: '/assets/docs/texture-stone.webp', use: null, note: 'seamless basalt tile, 1024²' },
    parchment: { slot: '/assets/docs/texture-parchment.webp', use: null, note: 'seamless leather tile, 1024²' },
    divider: { slot: '/assets/docs/ornament-divider.png', use: null, note: 'section rule, 2000×160, transparent' },
    faq: { slot: '/assets/docs/ornament-faq.png', use: null, note: 'FAQ marker, 256², rotates 45° when open' },
    // The three glyphs the ticker separates its phrases with, drawn as CSS layers until they land.
    // A `null` use on a CSS-only slot is deliberate: the fallback is painted by the stylesheet, so
    // an art file that has not arrived is invisible rather than a broken image.
    glyphs: { slot: '/assets/docs/ticker-glyphs.png', use: null, note: 'three ticker glyphs on one sheet, 768×256' },
    // The unfurl card, worn by `app/docs/page.js`'s metadata rather than by the page body.
    og: { slot: '/assets/docs/docs-og.jpg', use: SHARE_OG_IMAGE, note: '1200×630 unfurl card' },
};

/** The path a slot renders from today: the art if it is listed as rendered, else its stand-in. */
export const artOf = (key) => (ART[key].use ? ART[key].use : ART[key].slot);

// ------------------------------------------------------------------------------- the headline
/**
 * Two lines, the second one heavy — the reference page's one typographic move, and the only place
 * this page shouts. The heavy line is the deck's own title rather than a second copy of it: the
 * pitch deck and `/docs` making the same claim in the same words is the point, and a copy edit in
 * one place cannot leave the other contradicting it.
 */
export const HERO = {
    kicker: 'Documentation',
    lead: 'A game first.',
    claim: DECK.title,
    sub: 'Five dungeons, up to fifteen knights to a squad, and rewards that are worked out and checked before they are paid — so what you earn is what the rules say you earned.',
    network: `Live on ${CHAIN.name}`,
};

/** The scrolling strip under the band. Repeated by the component until it fills the row twice. */
export const TICKER = [
    'Five dungeons',
    'Two collections',
    'A Knight a day',
    'Rare, Epic, Legendary',
    'Fifteen knights a squad',
    'No wallet needed to start',
];

// -------------------------------------------------------------------------------- the sections
export const LORE = {
    id: 'lore',
    nav: 'What this is',
    title: 'What this is',
    paragraphs: [
        'Five themed dungeons — Crypts, Mines, Temple, Magma and Void Rift — with knights that find their own way through, monsters that fight back, and chests that open when they are broken. Behind all of it sits the part you never see: rewards that are worked out from the rules, checked, and only then paid.',
        'Nothing here asks you to take a number on faith. What each dungeon pays is written down, the rules the game runs on are published, and every number on this page comes out of those rules rather than being typed in by hand.',
        'This is the documentation: how to play, what the game pays, and what is still missing. The last part is not small, and it is written down rather than left for you to find.',
    ],
    source: { label: 'Join the Discord', sub: 'announcements and task drops live there', href: LINKS.discord },
    caption: 'Knight’s Hall — a squad is picked here',
};

export const START = {
    id: 'start',
    nav: 'How to play',
    title: 'How to play',
    sub: 'The whole loop, from summoning a knight to being paid for a run — and two of its screens are there to keep a run honest rather than to start one.',
    steps: [
        {
            title: 'Summon a knight',
            text: `A knight is summoned with **$DNG**, at a price that will be announced before launch. Every summon rolls once on a published table of **${KNIGHT_TIERS.length} rarities** — and there are no re-rolls.`,
        },
        {
            title: 'Deploy a squad',
            text: 'Send up to **15 knights** into one of five dungeons. The game records the moment the run starts, so a run cannot be backdated — and a squad sits out once its runs for the day are spent.',
        },
        {
            title: 'Clear, then collect',
            text: `Clear the dungeon and the game works out what the run earned. The reward is checked against the rules before anything is paid, and a run that does not check out pays nothing. Every knight's runs refresh at **${resetClock}**, for everybody at the same time.`,
        },
        {
            title: 'Or start with nothing',
            text: `The Points Vault needs no wallet and no $DNG: three floors, about twenty seconds, **${fmt(VAULT_ENTRY_TOTAL)} points** a day.`,
        },
    ],
    note: 'The game itself sits behind a password while it runs on testnet. The pages a stranger can open today are the landing page, the Points Program, the Genesis collection and the portfolio.',
};

export const NUMBERS = {
    id: 'numbers',
    nav: 'The numbers',
    title: 'The numbers',
    sub: 'None of this is settled yet — not the supply, not the prices, not what a run pays. Rather than leave the obvious questions unanswered, here is where each of them will be answered.',
    stats: [
        {
            value: 'To be announced',
            tba: true,
            label: 'How much $DNG exists',
            sub: 'The total supply, and how it is split, will be published before the token goes live.',
        },
        {
            value: 'To be announced',
            tba: true,
            label: 'What a dungeon pays',
            sub: 'The reward table — every rarity, every dungeon — and where the rewards come from.',
        },
        {
            value: 'To be announced',
            tba: true,
            label: 'What summoning costs',
            sub: 'The price of a knight, and the price of opening a capsule.',
        },
        {
            value: 'To be announced',
            tba: true,
            label: 'Whether there is a sale',
            sub: 'If there is one, it will be announced here and in the Discord first — nowhere else.',
        },
    ],
    note: 'Nothing on this page quotes a supply, a price or a reward, because none of them is settled yet. When they are, they will be published here — not in a screenshot, and not in somebody’s reply.',
};

export const POINTS = {
    id: 'points',
    nav: 'Points Program',
    title: 'The Points Program',
    sub: 'Clear the vault, keep the streak, bring somebody. The board decides who gets a capsule.',
    cards: [
        {
            title: 'Three floors a day',
            text: `${VAULT_LEVELS.map((level) => `${level.name} **${fmt(level.points)}**`).join(', ')} — ${fmt(VAULT_ENTRY_TOTAL)} points for one entry, free, about twenty seconds.`,
        },
        {
            title: 'A streak that compounds',
            text: `**${fmt(STREAK_BASE)} points** on top of the run, times the day you are on: 1× on the first consecutive day, **${STREAK_MAX_MULTIPLIER}×** on the ${STREAK_MAX_MULTIPLIER}th and every day after it. A missed day starts again at 1×.`,
        },
        {
            title: 'Bring somebody',
            text: `Referrals pay **${(REFERRAL_1ST_PCT * 100).toFixed(0)}%** of what the first line earns and **${(REFERRAL_2ND_PCT * 100).toFixed(0)}%** of the second, for as long as they keep earning.`,
        },
        {
            title: `${ONE_TIME_TASKS.length} one-time tasks`,
            text: 'Follow, join, post. Each pays once, and each is checked against the X handle before it pays — one account earns for one wallet.',
        },
    ],
    cta: { label: 'Open the Points Program', href: '/points' },
};

export const DRAW = {
    id: 'draw',
    nav: 'The daily draw',
    title: 'A Knight a day',
    // The programme's own word for the prize is a **Knight capsule** — `drawCapsuleLabel()` in
    // `lib/points-config.js` says *"10 free Knight capsules"* verbatim — so the page says Knight
    // first and the tier second. The earlier draft read "a capsule a night": a pun that puts a time
    // of day where the product's noun belongs, on the page a stranger reads before they play.
    body: `${fmt(DRAW_SIZE)} Knight capsules — a ${DRAW_CAPSULE.name} each — every day, to the top ${fmt(DRAW_SIZE)} of that day's board, and opening one mints a Knight. Read from points earned **today only**, so it is a fresh board at every midnight UTC. Ties go to whoever got there first. Capsules are never sold: the ways in are the board and the weekly raffle, and a win has to be claimed on the day it is drawn.`,
    // Two clocks, and only one of them is `GAME_RESET_HOUR_UTC`: the board turns over at midnight
    // UTC because the program keys its days on the calendar, while a knight's run caps roll over on
    // the hour the *contracts* name. Both are stated, and the contract's is interpolated — a typed
    // `12:00` here would be a documentation page quoting a reset the game does not use, which is the
    // exact failure `tools/check-docs.js` has a guard for and caught on this line's first draft.
    note: `Two clocks, and the difference matters: the board settles at 00:00 UTC, while a knight’s daily runs refresh at ${resetClock}.`,
    cta: { label: 'See today’s board', href: '/points' },
};

export const CONTRACTS_SECTION = {
    id: 'contracts',
    nav: 'Contracts',
    title: 'Where to check',
    // Held back at the owner's request: the addresses are not to be shown to anybody yet. The section
    // keeps its place and says so, rather than disappearing — a reader who came for it is told where
    // it will be instead of finding a heading with nothing under it — and the sub-line and the
    // sentence below say the same thing the blur does. The rows themselves are untouched in the
    // client, so publishing is deleting two class names and this paragraph, not rebuilding a list.
    sub: `The contracts the game runs on, on ${CHAIN.name}. None of this is needed to play — it is here for the reader who would rather check for themselves, and the addresses are not published yet.`,
    soon: 'The addresses will read here, each with a link to the explorer, when the deployment is published.',
    chip: 'Not published yet',
    /**
     * Name, address and the one sentence that says what it is for. Deliberately derived from the
     * deck's own table rather than restated: `tools/check-pitch.js` already asserts every character
     * of those addresses against `public/contract-addresses.js`, so a second copy here would be a
     * second thing to forget to update.
     *
     * The roles say what a thing *is*, never what it holds: no balance, no cap, no price.
     */
    rows: [
        { key: 'token', name: '$DNG', role: 'The token every reward is paid in' },
        { key: 'vault', name: 'Reward Vault', role: 'Holds the rewards, and pays them out' },
        { key: 'game', name: 'Dungeon Knights', role: 'The game: it pays for a run that was played' },
        { key: 'knights', name: 'Knights', role: 'The knights you summon' },
        { key: 'genesis', name: 'Genesis Knights', role: 'A fixed collection — not minted yet' },
        { key: 'capsules', name: 'Capsules', role: 'What the daily draw awards' },
        { key: 'raffle', name: 'Raffle', role: 'The weekly prize pool for staked Genesis knights' },
        { key: 'genesisStaking', name: 'Genesis Staking', role: 'Stake for rewards and raffle entries' },
        { key: 'knightsStaking', name: 'Knights Staking', role: 'Stake for rewards — no raffle entries' },
    ],
    explorer: LINKS.explorer,
    note: 'The explorer is the source, not this page.',
};

export const FAQ = {
    id: 'faq',
    nav: 'FAQ',
    title: 'Questions',
    items: [
        {
            q: 'How much does it cost?',
            a: 'To be announced. Summoning a knight will cost $DNG, and opening a capsule will too — both prices, and the full reward table, will be published before launch. Nothing you can buy today is priced here.',
        },
        {
            q: 'Is this audited?',
            a: 'No. There has been no independent audit, and it is the largest thing on the list of what is missing. The contracts are deployed on a testnet, and the reward rules are checked by our own tests rather than by a paragraph — which is not the same thing as an audit, and is not offered as one.',
        },
        {
            q: 'Are rewards printed out of nothing?',
            a: 'No. Rewards are paid out of a vault that was filled once, at the start, and the game can only spend what is in it — so a reward is a payout rather than a new promise. How big that vault is, and what each dungeon pays, will be announced before launch.'
        },
        {
            q: 'Can somebody fake a run to get paid?',
            a: 'Not any more. A run is timed and priced by the game’s server, and the reward is checked against the rules before it is paid, so a browser that invents a run has nothing that will authorise a payment. The first version of the contracts could be tricked exactly that way, which is why they were replaced — a reward that can be invented is worse than no reward at all.',
        },
        {
            q: 'Is the Genesis mint open?',
            a: 'Not yet. The collection is a fixed set of knights and nothing has been minted. The mint will be announced in the Discord and on X first — if it is not there, it is not open.',
        },
        {
            q: 'What can points be spent on?',
            a: 'Nothing yet. Points decide the board and the daily draw. A way to spend them is built and held back until it can actually pay out — a wheel that awards nothing would be worse than no wheel.',
        },
        {
            q: 'What is missing?',
            a: 'An independent audit; the Genesis mint, which has not opened; a way to spend points, which is built and held back; and the numbers themselves — how much $DNG exists, what a knight costs, what a capsule costs and what each dungeon pays, all of which will be published before launch. Everything else this page describes is live on the testnet.',
        },
    ],
};

/** The sections in the order they are read, which is also the nav's order. */
export const SECTIONS = [LORE, START, NUMBERS, POINTS, DRAW, CONTRACTS_SECTION, FAQ];

export const NAV = SECTIONS.map((section) => ({ id: section.id, label: section.nav }));

export const FOOTER = {
    wordmark: DECK.wordmark,
    legal: `Dungeon Knights is a game in development on ${CHAIN.name}. Nothing here is financial advice, $DNG is not on sale, and the pages the public can open are the landing page, the Points Program, the Genesis collection and the portfolio.`,
    links: [
        { label: 'Play', href: '/' },
        { label: 'Points', href: '/points' },
        { label: 'Genesis', href: '/genesis' },
        { label: 'Portfolio', href: '/portfolio' },
        { label: 'X', href: LINKS.x, external: true },
        { label: 'Discord', href: LINKS.discord, external: true },
        // No `Source` item, deliberately, and it is not an oversight to be "fixed" later: the owner
        // asked that the repository not be shown on the published pages. `LINKS.code` still exists in
        // `lib/pitch-deck.js` and the pitch deck's own contact slide still points at it — that page is
        // behind the password, and its whole job is to hand a reader something to read. Anything
        // *public* must not name it; `tools/check-docs.js` asserts that of this list.
    ],
};
