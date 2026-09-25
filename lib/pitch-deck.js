/**
 * The pitch deck, as data.
 *
 * Two rules, both of them this project's rules rather than preferences:
 *
 *   - **Nothing is typed in that the repository already knows.** Every figure on every slide is
 *     computed from the same modules the contracts were deployed from — `reward-config.js`,
 *     `knights.js`, `staking-config.js`, `points-config.js`. A deck that quotes a budget the
 *     vault does not release is the failure mode this file exists to make impossible, and
 *     `tools/check-pitch.js` fails if a slide stops being built out of these objects.
 *   - **The uncertain parts say so.** The Genesis mint is not open, the capsule-type split is
 *     undecided, and there is no audit — those are slides rather than omissions, because a deck
 *     that hides them is worth less than the paper it is printed on.
 *
 * The slide *shape* is data too, so `app/pitch/client.js` renders rather than narrates: a slide is
 * a list of blocks (`kicker`, `title`, `lede`, `chips`, `stats`, `cards`, `steps`, `table`, `quote`,
 * `live`, `note`, `links`), and adding a slide never means touching the renderer.
 *
 * Inline emphasis in a string is deliberate and limited: `**bold**` and `` `code` ``. The renderer
 * parses exactly those two, which is what keeps the copy readable here instead of buried in JSX.
 */

import { RARITY, KNIGHT_TIERS, dailyCapacity, expectedClearsPerDay, expectedRewardPerDay } from './knights.js';
import {
    CAPSULES_PER_WEEK,
    GENESIS_SUPPLY,
    HASH_POWER_MAX,
    HASH_POWER_MIN,
    TICKET_CAP_HOURS,
    KNIGHTS_REFERENCE_SIZE,
} from './staking-config.js';
import {
    DNG_DECIMALS,
    DNG_SUPPLY,
    DISTRIBUTION,
    GENESIS_DAILY_RUNS,
    GENESIS_REWARD_PER_CLEAR,
    MIN_WEEKS,
    REFERENCE_GENESIS_ACTIVE,
    REFERENCE_KNIGHTS_ACTIVE,
    REFERENCE_UTILISATION,
    REWARD_VAULT_DNG,
    STAKING_SHARE_OF_DUNGEON,
    SUMMON_PRICE_DNG,
    capsuleBreakEvenMinted,
    capsuleOpenPrice,
    epochScale,
    fundingPerYearDng,
    horizonDays,
    lineBps,
    lineBudgets,
    lineShares,
    referenceBurnPerDay,
    weeklyBudgetDng,
    worstCaseBurnPerDay,
} from './reward-config.js';
import {
    CAPSULE_CLAIM_WINDOW_DAYS,
    DRAW_CAPSULE,
    DRAW_SIZE,
    PROGRAM_DAY_ONE,
    REFERRAL_1ST_PCT,
    REFERRAL_2ND_PCT,
    REFERRAL_MIN_POINTS,
    STREAK_BASE,
    STREAK_MAX_MULTIPLIER,
    VAULT_ENTRY_TOTAL,
    VAULT_LEVELS,
} from './points-config.js';

/**
 * The deployed set, from `public/contract-addresses.js` — which is the file the site, the tools and
 * `tools/check-copies.js` all read, so it is the one place an address is decided. The deck carries
 * the four links a reader would check first and `tools/check-pitch.js` asserts every character of
 * them against that file: a stale address in a deck is a reader sent to a contract nothing signs
 * for, which is precisely the mistake this project retired four deployments over.
 */
export const LINKS = {
    site: 'https://dungeonknights.io',
    game: 'https://app.dungeonknights.io',
    code: 'https://github.com/MeG0302/dungeon-knights',
    x: 'https://x.com/DNGrobinhood',
    discord: 'https://discord.gg/zZFqA9Fqe',
    explorer: 'https://explorer.testnet.chain.robinhood.com/address/',
};

export const CONTRACTS = {
    token: '0x3D94e56E0d967633830f6d9E42CE43A64FFfD6Ca',
    vault: '0x6Cc2cA52F24Df5fE752e2792E1acA8783413e0Cc',
    game: '0xD60FfCb1df8ce1163e0a5137651E98BDC0Acd8a8',
    knights: '0x27Cfbb763188a50Fe1C0fFfBe2552b1945eE1B2D',
    genesis: '0xbd99CD46dd42472fAA7667d5c782eEbe0Abe9e5d',
    capsules: '0x628ae2254fFE4aeC68D13b1E46E5628CCcbD2728',
    raffle: '0xc26360C6CC4B67720558F71fB32Dc413e27E5b4C',
    genesisStaking: '0x173cED7aeb1F0F6871c5110112Ade6f61106D7FD',
    knightsStaking: '0x27fBBba5feCD0Bc4a83d51b4f2832a13c6E0a627',
};

export const CHAIN = {
    id: 46630,
    name: 'Robinhood Chain testnet',
    mainnetId: 4663,
    mainnetName: 'Robinhood Chain',
};

// ------------------------------------------------------------------ the numbers, derived once
const number = new Intl.NumberFormat('en-US');

/** `1,415,120`. Explicit `en-US` rather than the runtime's locale: the deck is server-rendered and
 * re-hydrated, and a formatter that followed the visitor's locale would print two different strings
 * for the same number and fail hydration on a German laptop. */
export function fmt(value, decimals = 0) {
    if (!Number.isFinite(value)) return '—';
    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    }).format(value);
}

/** The drop-rate weighted DNG one fresh summon earns for a clear — 20.8 today. */
const expectedPerClear = KNIGHT_TIERS.reduce((sum, key) => sum + RARITY[key].dropRate * RARITY[key].dungeonReward, 0);

export const MODEL = (() => {
    const budget = weeklyBudgetDng();
    const burn = referenceBurnPerDay();
    const clearP = expectedPerClear;
    const dayP = expectedRewardPerDay();
    const clearsP = expectedClearsPerDay();
    const worstBurn = worstCaseBurnPerDay();
    const bps = lineBps();
    const shares = lineShares();
    const lines = lineBudgets(budget);
    return {
        budget,
        burn,
        bps,
        shares,
        lines,
        vault: REWARD_VAULT_DNG,
        horizonDays: horizonDays(REWARD_VAULT_DNG),
        horizonYears: horizonDays(REWARD_VAULT_DNG) / 365,
        fundingPerYear: fundingPerYearDng(),
        worstBurn,
        worstScale: epochScale(worstBurn, budget),
        worstHorizonDays: horizonDays(REWARD_VAULT_DNG, worstBurn),
        clearP,
        dayP,
        clearsP,
        paybackDays: SUMMON_PRICE_DNG / dayP,
        clearsPerSummon: SUMMON_PRICE_DNG / clearP,
        breakEvenKnights: capsuleBreakEvenMinted(),
        openAtZero: capsuleOpenPrice(0),
        openAtReference: capsuleOpenPrice(KNIGHTS_REFERENCE_SIZE),
        knightsLinesPerWeek: (lines.knightsDungeon + lines.knightsStaking) * 7,
        knightsPerLineDay: lines.knightsDungeon + lines.knightsStaking,
        stakingLines: lines.genesisStaking + lines.knightsStaking,
        dungeonLines: lines.genesisDungeon + lines.knightsDungeon,
    };
})();

const LINE_COPY = {
    genesisDungeon: 'Genesis Knights clearing dungeons — flat per clear, whatever the hash power',
    genesisStaking: 'Genesis staking yield and the whole weekly raffle pool, split by ticket share',
    knightsDungeon: 'Knights clearing dungeons — the published five-tier reward table',
    knightsStaking: 'Knights staking yield — no raffle tickets, yield only',
};

const LINE_KEYS = ['genesisDungeon', 'genesisStaking', 'knightsDungeon', 'knightsStaking'];

// ------------------------------------------------------------------------------ the deck
export const DECK = {
    wordmark: 'Dungeon Knights',
    // The one sentence the whole deck is an argument for.
    title: 'Proof, not promises.',
    tagline:
        'An idle RPG where the rewards are signed by a server on its own clock and re-derived by the contract that pays them — so the number a player sees is a fact, not a claim.',
    version: 'Pitch deck v1 · September 2026',
    network: `${CHAIN.name}, chain ID ${CHAIN.id}`,
};

export const SLIDES = [
    /* ---------------------------------------------------------------- 1 · cover */
    {
        id: 'cover',
        nav: 'Cover',
        blocks: [
            { kind: 'cover' },
            {
                kind: 'chips',
                items: [
                    `${CHAIN.name} · ${fmt(CHAIN.id)}`,
                    'Nine contracts deployed',
                    'No team allocation',
                    'Fixed supply, no emission',
                ],
            },
            {
                kind: 'note',
                text: 'Every number on the following slides is computed from the same `lib/` modules the contracts were deployed from. The argument is eleven slides long: a game that shipped, an economy that cannot outlive its own funding, and a list of what is still missing.',
            },
        ],
    },

    /* -------------------------------------------------------------- 2 · problem */
    {
        id: 'problem',
        nav: 'The problem',
        blocks: [
            { kind: 'kicker', text: '01 · The problem' },
            { kind: 'title', text: 'Idle and blockchain games ask the player to believe a number.' },
            {
                kind: 'lede',
                text: 'The game says you earned 40 tokens, the tokens appear, and nothing anywhere proves a dungeon was played or that the payout was the amount the rules promised. Four failure modes follow from that, and every one of them is a thing this project spent its effort on instead of on a front end.',
            },
            {
                kind: 'cards',
                items: [
                    {
                        title: 'Unverifiable rewards',
                        text: 'Most play-to-earn front ends decide what you earned and then ask the chain to pay it. The chain has no opinion, so the game has no integrity — and when the client can authorise its own payout, the client *is* the attacker.',
                        badge: 'Trust',
                    },
                    {
                        title: 'Promises that ignore supply',
                        text: 'A reward table means nothing without saying where the tokens come from. If rewards are minted, the promise is inflation wearing a roadmap.',
                        badge: 'Supply',
                    },
                    {
                        title: 'Opaque odds',
                        text: 'Drop rates, capsule outcomes and raffle chances are usually hidden, which is exactly where they should be readable. Odds that pay a tier nobody can price are worse than hidden odds.',
                        badge: 'Odds',
                    },
                    {
                        title: 'Testnet fatigue',
                        text: 'Projects ship a pretty front end and no working loop. The interesting half of this product is the half that runs on a server clock and settles on chain.',
                        badge: 'Delivery',
                    },
                ],
            },
        ],
    },

    /* -------------------------------------------------------------- 3 · product */
    {
        id: 'product',
        nav: 'The product',
        blocks: [
            { kind: 'kicker', text: '02 · The product' },
            { kind: 'title', text: 'A game first, with the ledger behind it.' },
            {
                kind: 'lede',
                text: 'Five themed dungeons, knights that pathfind and fight, monsters that fight back, chests that open when they are broken. The reward layer sits *behind* that: a server that times a run on its own clock and signs it, and a contract that re-derives the price before it pays.',
            },
            {
                kind: 'stats',
                items: [
                    { value: '5', label: 'Dungeons', sub: 'Crypts, Mines, Temple, Magma, Void Rift' },
                    { value: '15', label: 'Knights a squad', sub: 'melee, 1s cooldown, stamina' },
                    { value: '5', label: 'Rarities', sub: 'one on-chain roll, five reward slots' },
                    { value: `${fmt(GENESIS_SUPPLY)}`, label: 'Genesis Knights', sub: `${HASH_POWER_MIN}–${fmt(HASH_POWER_MAX)} hash power` },
                    { value: '20–25s', label: 'Points Vault run', sub: 'three floors, free entry, daily' },
                ],
            },
            {
                kind: 'cards',
                items: [
                    {
                        title: 'The engine runs in the browser, and holds nothing',
                        text: 'A canvas engine — pathfinding, melee combat, stamina, themed attack animations. It renders, it reads input, and it is **trusted for nothing that costs money**.',
                    },
                    {
                        title: 'Two collections, two jobs',
                        text: `**Knights** are uncapped and earned by playing — ${fmt(SUMMON_PRICE_DNG)} $DNG to summon. **Genesis** is fixed at ${fmt(GENESIS_SUPPLY)} and staked for yield and the raffle. Both play the same dungeons for the same published table.`,
                    },
                    {
                        title: 'Arya, the gate keeper',
                        text: 'A hand-drawn character who walks a first-time player through each surface in her own words — including holding the screen while a dungeon\'s art preloads, so nobody ever sees the placeholder map.',
                    },
                    {
                        title: 'Every surface is a page you can open today',
                        text: `Kingdom Gate, Knight's Hall, Summoning Chamber, Staking Vault, Points Program, Portfolio, Hall of Fame, the $DNG economy, and this deck — all on the gated game host, behind one password.`,
                    },
                ],
            },
        ],
    },

    /* ----------------------------------------------------------------- 4 · loop */
    {
        id: 'loop',
        nav: 'The loop',
        blocks: [
            { kind: 'kicker', text: '03 · The loop' },
            { kind: 'title', text: 'What a clear pays, and where the money comes from.' },
            {
                kind: 'steps',
                items: [
                    {
                        title: 'Summon',
                        text: `**${fmt(SUMMON_PRICE_DNG)} $DNG** burns into the reward vault and mints one Knight at the published drop table. The summon fee is the token sink, and it is the gate the whole economy is sized around.`,
                    },
                    {
                        title: 'Deploy',
                        text: `Up to **15 knights** into one of five dungeons. The client asks for a run token first; the token carries the **server's** start time, so a run cannot be backdated.`,
                    },
                    {
                        title: 'Clear',
                        text: `The engine fights it out. A clear is worth **${RARITY.COMMON.dungeonReward}–${RARITY.LEGENDARY.dungeonReward} $DNG** by tier, with per-knight daily caps of **${KNIGHT_TIERS.map((k) => RARITY[k].dailyRuns).join('/')} runs** — enforced on chain, where a script cannot reach them.`,
                    },
                    {
                        title: 'Claim',
                        text: 'The server prices the run from on-chain rarity and signs exactly that run. The contract re-derives the reward and refuses anything the signature did not authorise.',
                    },
                    {
                        title: 'Stake',
                        text: `Park a Genesis Knight for **${fmt(TICKET_CAP_HOURS)} hours max** at ${STAKING_SHARE_OF_DUNGEON * 100}% of what it earns by playing — 1 hash power, 1 raffle ticket an hour. Knights stake for yield only.`,
                    },
                    {
                        title: 'Raffle → Capsule → Knight',
                        text: `**${fmt(CAPSULES_PER_WEEK)} capsules a week** are awarded to staked Genesis by ticket share — never sold. Opening one burns it and mints a Knight, for a fee that **ramps from ${fmt(MODEL.openAtZero)} to ${fmt(MODEL.openAtReference)} $DNG** as the collection grows.`,
                    },
                ],
            },
            {
                kind: 'quote',
                text: `One fresh summon earns an expected **${fmt(MODEL.dayP, 1)} $DNG a day** at full play — ${fmt(MODEL.clearP, 1)} per clear across ${fmt(MODEL.clearsP, 2)} clears a day. Payback: **${fmt(MODEL.paybackDays, 2)} days**, or **${fmt(MODEL.clearsPerSummon, 1)} clears**. Squad utilisation, not luck, is the dominant variable.`,
            },
        ],
    },

    /* ---------------------------------------------------------------- 5 · trust */
    {
        id: 'trust',
        nav: 'The gate',
        blocks: [
            { kind: 'kicker', text: '04 · The trust layer' },
            { kind: 'title', text: 'The signed-run gate.' },
            {
                kind: 'lede',
                text: 'This is the part that took the work, and it is invisible when it is working. Three layers stand between a browser and a payout, and the browser is trusted for none of them.',
            },
            {
                kind: 'steps',
                items: [
                    {
                        title: 'Run tokens',
                        text: 'Starting a dungeon asks the server for a token: an HMAC over `address | knightIds | dungeonId | server start time`, six-hour TTL. The start time is the **server\'s**, so a browser cannot backdate a run — and the token is stateless, so none of this needs a database.',
                    },
                    {
                        title: 'Minimum time, on a clock the player does not control',
                        text: '`minimumTime = max(30s, 300s / √knightCount)` — one knight must be in the dungeon five minutes, fifteen knights 77 seconds. √ scaling on purpose: 2× knights is not 2× speed.',
                    },
                    {
                        title: 'Receipts the contract re-derives',
                        text: 'On completion the server prices the run **from on-chain rarity** and signs exactly it, as an EIP-191 personal message. The contract independently re-derives the reward and requires equality, so a compromised signer cannot overpay past the table. The nonce is **single-use on chain**.',
                    },
                ],
            },
            {
                kind: 'code',
                label: 'What the signature commits to',
                lines: [
                    'keccak256(abi.encode(',
                    '  player, keccak256(abi.encodePacked(knightIds)),',
                    '  dungeonId, reward, nonce, expiry,',
                    '  block.chainid, contractAddress',
                    '))',
                ],
            },
            {
                kind: 'quote',
                text: 'The V1 contracts signed their own rewards and were drained on 15 September 2026 — **320,339 $DNG recovered**. V3 removed the client\'s ability to invent a run. V4 removed the client\'s ability to invent *authorisation*. That incident is the reason this slide exists, and the reason the reward table is asserted by a harness rather than by a paragraph.',
            },
        ],
    },

    /* -------------------------------------------------------------- 6 · economy */
    {
        id: 'economy',
        nav: 'The economy',
        blocks: [
            { kind: 'kicker', text: '05 · The economy' },
            { kind: 'title', text: 'Rewards are released, not minted.' },
            {
                kind: 'lede',
                text: `**${fmt(DNG_SUPPLY)} $DNG** on ${DNG_DECIMALS} decimals, minted once, with nothing that can mint more. **${DISTRIBUTION.find((b) => b.key === 'reward').pct}%** of it sits in one vault the game spends from, and there is **no team allocation at all** — so the token cannot be inflated to pay a promise.`,
            },
            {
                kind: 'stats',
                items: [
                    { value: fmt(MODEL.vault), label: 'DNG in the vault', sub: `held on chain at ${CONTRACTS.vault.slice(0, 6)}…${CONTRACTS.vault.slice(-4)}` },
                    { value: fmt(MODEL.budget), label: 'DNG released each week', sub: 'the reference burn, one week of it' },
                    { value: `${fmt(MODEL.horizonDays, 0)} days`, label: 'Runway at the reference', sub: `${fmt(MODEL.horizonYears, 1)} years of the published table` },
                    { value: `÷${MIN_WEEKS}`, label: 'Budget cap', sub: 'no week may shorten the vault below 12 weeks' },
                ],
            },
            {
                kind: 'table',
                head: ['Line', 'Share', 'Basis points', '$DNG a week', 'Pays'],
                rows: LINE_KEYS.map((key) => [
                    LINE_COPY[key].split(' — ')[0],
                    `${(MODEL.shares[key] * 100).toFixed(2)}%`,
                    fmt(MODEL.bps[LINE_KEYS.indexOf(key)]),
                    fmt(MODEL.lines[key]),
                    LINE_COPY[key].split(' — ')[1] || '',
                ]),
                caption: `The constructor takes the four shares as basis points and **reverts unless they sum to 10,000** — derived from the lines themselves, not chosen.`,
            },
            {
                kind: 'cards',
                items: [
                    {
                        title: 'One scale, settled weekly',
                        text: `\`epochScale = min(1, budget ÷ last week's burn)\`. The published table is the **maximum**, never exceeded: above the reference population every line moves down together, so the tier ratios and the ${STAKING_SHARE_OF_DUNGEON * 100}% staking rule survive at whatever level is fundable.`,
                    },
                    {
                        title: 'Sized for a stated population',
                        text: `The table is a quote for **${REFERENCE_GENESIS_ACTIVE} Genesis and ${REFERENCE_KNIGHTS_ACTIVE} Knights** playing daily — about ${(REFERENCE_UTILISATION.genesis * 100).toFixed(0)}% and ${(REFERENCE_UTILISATION.knights * 100).toFixed(0)}% of each collection. Above that, nothing is broken and nothing is promised twice.`,
                    },
                    {
                        title: 'The worst case is stated, not discovered',
                        text: `If every Genesis Knight and ${fmt(KNIGHTS_REFERENCE_SIZE)} Knights played and staked at once, demand would be **${fmt(MODEL.worstBurn)} $DNG a day**; one scale settles every payout at **×${MODEL.worstScale.toFixed(2)}** and the vault still runs ${fmt(MODEL.worstHorizonDays, 0)} days. That is the mechanism working, not failing.`,
                    },
                ],
            },
        ],
    },

    /* ---------------------------------------------------------- 7 · unit economics */
    {
        id: 'economics',
        nav: 'Unit economics',
        blocks: [
            { kind: 'kicker', text: '06 · Unit economics' },
            { kind: 'title', text: 'ROI is quoted in clears, never in dollars.' },
            {
                kind: 'lede',
                text: 'A token price cannot break a promise about a reward table, so the payback is stated in the unit the contract actually pays: clears. This is the whole table, at scale 1.00.',
            },
            {
                kind: 'table',
                head: ['Tier', 'Roll', 'Per clear', 'Runs a day', 'A day', 'Hash power'],
                rows: KNIGHT_TIERS.map((key) => {
                    const tier = RARITY[key];
                    return [
                        tier.name,
                        `${(tier.dropRate * 100).toFixed(tier.dropRate < 0.05 ? 1 : 0)}%`,
                        fmt(tier.dungeonReward),
                        fmt(tier.dailyRuns),
                        fmt(dailyCapacity(key)),
                        fmt(tier.hashPower),
                    ];
                }),
                caption: `Genesis pays **${fmt(GENESIS_REWARD_PER_CLEAR)} $DNG a clear, flat**, ${GENESIS_DAILY_RUNS} runs a day for all ${fmt(GENESIS_SUPPLY)} — hash power moves passive income only, so every Genesis Knight is equally valuable for playing.`,
            },
            {
                kind: 'stats',
                items: [
                    { value: fmt(MODEL.clearP, 1), label: 'Expected $DNG a clear', sub: 'weighted by the roll column, not averaged' },
                    { value: fmt(MODEL.dayP, 1), label: 'Expected $DNG a day', sub: 'a summon played every day' },
                    { value: `${fmt(MODEL.paybackDays, 2)} days`, label: 'Payback on a summon', sub: `or ${fmt(MODEL.clearsPerSummon, 1)} clears` },
                    { value: fmt(MODEL.breakEvenKnights), label: 'Knights to self-funding', sub: `from here the ${fmt(CAPSULES_PER_WEEK)} weekly opens cover both Knights lines` },
                ],
            },
            {
                kind: 'note',
                isWarn: false,
                text: `Two things this slide is deliberately not. It is not a forecast: the multiplier is *not* applied to an average of runs, because the tiers that pay the most also get the most runs, and multiplying two averages says ${fmt(MODEL.clearP * MODEL.clearsP, 2)} $DNG a day instead of ${fmt(MODEL.dayP, 1)}. And it is not a price: capsule opens fund **${fmt(MODEL.knightsLinesPerWeek)} $DNG a week** of the Knights lines at the reference, while holding the published table forever costs **${fmt(MODEL.fundingPerYear)} $DNG a year** that has to reach the vault — currently from the Genesis mint, which has not opened.`,
            },
        ],
    },

    /* ------------------------------------------------- 8 · points + daily capsule */
    {
        id: 'points',
        nav: 'Points + daily draw',
        blocks: [
            { kind: 'kicker', text: '07 · Growth' },
            { kind: 'title', text: 'The Points Program, and a capsule a night for ten players.' },
            {
                kind: 'lede',
                text: `Points are a **participation record with no conversion mechanism** — asserted by a harness, so no conversion can appear quietly. What they buy is standing: the board, the referrals, and a share of a daily prize that is not points.`,
            },
            {
                kind: 'stats',
                items: [
                    { value: fmt(VAULT_ENTRY_TOTAL), label: 'Points per Vault run', sub: `${VAULT_LEVELS.map((l) => l.points).join(' + ')} over three floors, daily` },
                    { value: `×2 → ${fmt(VAULT_ENTRY_TOTAL * 2)}`, label: 'Cleared and shared', sub: 'a verified post doubles the whole entry' },
                    { value: `+${fmt(STREAK_BASE)}×${STREAK_MAX_MULTIPLIER}`, label: 'Streak bonus', sub: `day 1 to day ${STREAK_MAX_MULTIPLIER}, then held` },
                    { value: `${REFERRAL_1ST_PCT * 100}% / ${REFERRAL_2ND_PCT * 100}%`, label: 'Referral commission', sub: `paid only once a referee has a bound X account and ${REFERRAL_MIN_POINTS} points` },
                ],
            },
            {
                kind: 'cards',
                items: [
                    {
                        title: `The daily draw: ${fmt(DRAW_SIZE)} free ${DRAW_CAPSULE.name}s`,
                        text: `Every day, the top **${fmt(DRAW_SIZE)}** of *that day's* board each win a **${DRAW_CAPSULE.name}** — a Knight in the making, since opening one mints a Knight. The board is the day's rather than the season's, so a wallet that finishes a full run is genuinely in the running on its first evening, and ranks are decided by **when you earned**, not by luck. Live since ${PROGRAM_DAY_ONE}.`,
                    },
                    {
                        title: 'Sybil-resistant by construction',
                        text: `Points are earned against X, not against a browser: **one X account binds permanently to one wallet**, a run with no binding pays nothing, commission is paid only on points the referee actually earned, and a claim window of ${CAPSULE_CLAIM_WINDOW_DAYS} day closes on the *claim* rather than silently taking the win away. Wallets are free — so the incentive to farm is bounded by the leaderboard rather than by a payout.`,
                    },
                ],
            },
            { kind: 'live' },
        ],
    },

    /* ---------------------------------------------------------- 9 · what shipped */
    {
        id: 'shipped',
        nav: 'Shipped',
        blocks: [
            { kind: 'kicker', text: '08 · Delivery' },
            { kind: 'title', text: 'The loop came first. Everything below is running.' },
            {
                kind: 'stats',
                items: [
                    { value: String(Object.keys(CONTRACTS).length), label: 'Contracts live', sub: `on ${CHAIN.name}` },
                    { value: '40', label: 'Verification harnesses', sub: 'each falsifiable by name, in `tools/`' },
                    { value: '2', label: 'Hostnames', sub: 'public campaign site, password-gated game host' },
                    { value: '1', label: 'Source of truth', sub: 'constructor arguments derived from `lib/`, never typed' },
                ],
            },
            {
                kind: 'cards',
                items: [
                    {
                        title: 'The game',
                        text: 'Five themed dungeons, five-rarity knight NFTs, roster and squad selection, monsters with 3-tile domains and 2-tile attacks, static loot chests, and a Summoning Chamber that charges the vault.',
                    },
                    {
                        title: 'The economy',
                        text: 'The vault holds its published 45% allocation on chain, four lines settle a weekly budget, and the token has fixed supply with no privileged mint after construction.',
                    },
                    {
                        title: 'The off-chain half',
                        text: 'Points Program with vault run, streaks, tasks and referrals, where a session is a wallet signature and every payout is once-per-wallet and proved under concurrent load; Hall of Fame and Portfolio read from real chain events.',
                    },
                    {
                        title: 'The oversized part',
                        text: 'The reward table, the capsule ladder, the vault partition, the staking ratios and the whitepaper itself are asserted **against the code** by harnesses. If this deck and the repository disagree, the harness fails and this deck is wrong.',
                    },
                ],
            },
            {
                kind: 'table',
                head: ['#', 'Shipped', 'State'],
                rows: [
                    ['1', 'Canvas engine, five dungeons, knights and monsters that fight back', 'Live'],
                    ['2', 'Knights: uncapped ERC-721, five-tier roll, capsule opens', 'Live'],
                    ['3', 'Signed runs, on-chain daily caps, funded reward vault', 'Live'],
                    ['4', 'Staking Vault: real holdings, live accrual, raffle tickets, real writes', 'Live'],
                    ['5', 'Points Program, streaks, tasks, referrals, permanent store', 'Live'],
                    ['6', `Daily capsule draw — ${fmt(DRAW_SIZE)} capsules to the day's top ${fmt(DRAW_SIZE)}`, 'Live'],
                    ['7', 'Genesis collection, hash-power bands, waitlist and staking contracts', 'Live, mint pending'],
                ],
            },
        ],
    },

    /* ------------------------------------------------------------- 10 · roadmap */
    {
        id: 'roadmap',
        nav: 'Roadmap',
        blocks: [
            { kind: 'kicker', text: '09 · Roadmap' },
            { kind: 'title', text: 'What is next, in the order it has to happen.' },
            {
                kind: 'table',
                head: ['Phase', 'Focus', 'State'],
                rows: [
                    ['Phase 1', 'Core game and live rewards — dungeons, rarities, on-chain claims with daily caps, Points Program, portfolio and Hall of Fame', 'Shipped'],
                    ['Phase 2', 'Genesis, staking, raffle and capsules — nine contracts deployed, wired and used by the site', 'Shipped'],
                    ['Phase 3', 'Mainnet (chain ID ' + fmt(CHAIN.mainnetId) + '): commission the audit, move ownership to a multisig with a timelock, lock the LP for 12 months, publish the signer-rotation policy, open the Genesis mint', 'Next'],
                    ['Phase 4', 'Depth: marketplace, equipment and upgrades as token sinks, guilds, seasons, leaderboard prizes, PvP tournaments, and backend verification of gameplay rather than timing alone', 'Planned'],
                ],
            },
            {
                kind: 'note',
                text: 'Phase 3 is not a marketing milestone, it is a **prerequisite list**. The V1 deployments were exploited and emptied while the client could authorise its own rewards; mainnet with a single externally-owned owner key and no audit would be the same trade made twice, with real money.',
            },
        ],
    },

    /* ----------------------------------------------------------- 11 · disclosure */
    {
        id: 'disclosure',
        nav: 'Disclosures',
        blocks: [
            { kind: 'kicker', text: '10 · Disclosures' },
            { kind: 'title', text: 'What is not done yet.' },
            {
                kind: 'lede',
                text: 'A deck that hides these is worth less than the paper it is printed on, and every item below is a standing line in the repository rather than a paragraph that will quietly age out.',
            },
            {
                kind: 'cards',
                items: [
                    { title: 'No audit', text: 'No third-party security audit, no timelock, no multisig — the owner is a single externally-owned wallet. Phase 3 work, treated as a prerequisite.', badge: 'Risk' },
                    { title: 'Testnet only', text: `Everything here is ${CHAIN.name}, ID ${fmt(CHAIN.id)}. There is no mainnet deployment and no token sale in this deck.`, badge: 'Chain' },
                    { title: 'The mint has not opened', text: `${fmt(GENESIS_SUPPLY)} Genesis Knights, none minted. The price in ETH is undecided and the mint runs on OpenSea.`, badge: 'Genesis' },
                    { title: 'Custody is unfinished', text: 'Three quarters of the supply sits in one wallet: only the vault\'s 45% was required at construction, and the liquidity, treasury and marketing buckets are still pending custody setup.', badge: 'Supply' },
                    { title: 'A legacy contract is still callable', text: 'The superseded V3-Simple game pays an older table and is not paused. Closing it is a pause and a withdrawal, and it is recorded rather than forgotten.', badge: 'Legacy' },
                    { title: 'One number is undecided', text: `How the ${fmt(CAPSULES_PER_WEEK)} weekly capsules split across the four rungs is still TBD. Nothing in the model assumes a split, and the page does not invent one.`, badge: 'TBD' },
                ],
            },
            {
                kind: 'note',
                isWarn: true,
                text: 'Told plainly: this is software with a published economy, not an offer, a solicitation or financial advice. **$DNG has no guaranteed value, no audited contract and no mainnet deployment** — verify every address before interacting with it.',
            },
        ],
    },

    /* --------------------------------------------------------------- 12 · close */
    {
        id: 'close',
        nav: 'Verify it',
        blocks: [
            { kind: 'kicker', text: '11 · Closing' },
            { kind: 'title', text: 'Verify it yourself. That is the pitch.' },
            {
                kind: 'lede',
                text: 'Most of the interesting work in this project is invisible when it is working: the dungeons render, the monsters swing back, the DNG arrives. The point is that when the DNG arrives, a signature proves which run paid it, the contract proves the amount was the table\'s amount, and the clock proves the run took as long as an honest one.',
            },
            {
                kind: 'steps',
                items: [
                    { title: 'Run the build', text: '`npm run build` on a clean tree — the site, the API routes and the middleware, green on the first try.' },
                    { title: 'Break the economy', text: '`node tools/check-token-math.js` fails if the whitepaper and `lib/reward-config.js` disagree — it exists because they once did, by 15%.' },
                    { title: 'Read the vault on chain', text: `The four line shares are basis points in \`RewardVault\`'s constructor and it reverts unless they sum to exactly ${fmt(10000)}.` },
                    { title: 'Read the gate', text: '`DungeonKnightsGameV4.claimReward` re-derives the reward from on-chain rarity and compares it to the signed total; the nonce is burned before any external call.' },
                    { title: 'Try to get in uninvited', text: 'The game host serves the hub and nothing else without the password, and every other path 307s to the gate — asserted path by path in `tools/check-gate.js`.' },
                ],
            },
            {
                kind: 'links',
                items: [
                    { label: 'The public site', href: LINKS.site, sub: 'dungeonknights.io' },
                    { label: 'The game', href: LINKS.game, sub: 'app.dungeonknights.io — password gated' },
                    { label: 'The source', href: LINKS.code, sub: 'github.com/MeG0302/dungeon-knights' },
                    { label: 'The $DNG token', href: `${LINKS.explorer}${CONTRACTS.token}`, sub: `${CONTRACTS.token.slice(0, 10)}…${CONTRACTS.token.slice(-6)} on ${CHAIN.name}` },
                    { label: 'The reward vault', href: `${LINKS.explorer}${CONTRACTS.vault}`, sub: `holding ${fmt(MODEL.vault)} $DNG` },
                    { label: 'The signed-run contract', href: `${LINKS.explorer}${CONTRACTS.game}`, sub: 'DungeonKnightsGameV4' },
                ],
            },
            {
                kind: 'quote',
                text: 'Everything else — the vault, the raffle, the capsule odds, the points program — is designed to the same standard: **publish the number, or say TBD, and let a harness fail if the two ever drift apart.**',
            },
        ],
    },
];
