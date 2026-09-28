/**
 * The terms of a Dungeon Knights collaboration, as data.
 *
 * `/collab` is the page a partner reads before agreeing to anything and the page their community
 * lands on to register, so the two things it has to get right are the offer and the numbers behind
 * it. The offer is written here; the numbers are **imported**, from the same modules the reward
 * contracts were deployed from — supply, hash power, capsule odds, the raffle and the open price all
 * come out of `staking-config.js`, `reward-config.js` and `knights.js`. A marketing page is exactly
 * where a figure gets copied once and then quietly stops being true, so nothing in this file is a
 * number somebody typed.
 *
 * One thing this file deliberately does **not** hold: a winner list, a count of registrations, or
 * anything else that would have to be kept in step with the store. The project list is the slugs the
 * store validates against — that is the only fact the two share.
 */

import {
    CAPSULES_PER_WEEK,
    CAPSULE_TYPES,
    GENESIS_SUPPLY,
    HASH_POWER_MAX,
    HASH_POWER_MIN,
    KNIGHTS_REFERENCE_SIZE,
    TICKET_CAP_HOURS,
} from './staking-config.js';
import {
    GENESIS_DAILY_CAPACITY,
    GENESIS_DAILY_RUNS,
    GENESIS_REWARD_PER_CLEAR,
    capsuleOpenPrice,
} from './reward-config.js';
import { DISCORD_INVITE } from './points-config.js';
import { RARITY, TIER_DISPLAY_ORDER } from './knights.js';

/** The way every other page on the site formats a whole number. */
export function fmtInt(value) {
    return Number(value).toLocaleString('en-US');
}

/* ------------------------------------------------------------------ the figures */

/**
 * What the Common capsule draws from.
 *
 * The *Common* one on purpose: it is the rung a giveaway hands out, and its odds are the ones a
 * partner's community will actually meet. Read from `CAPSULE_TYPES` rather than restated, so raising
 * the floor of a giveaway capsule is a change to the table rather than to the copy.
 */
export const CAPSULE_ODDS = (CAPSULE_TYPES[0]?.odds || []).map((row) => ({
    tier: row.rarity,
    pct: row.pct,
}));

/** `60% Common · 25% Uncommon · …`, the ladder in one line. */
export const CAPSULE_ODDS_LINE = CAPSULE_ODDS.map((row) => `${row.pct}% ${row.tier}`).join(' · ');

/** The top rung of the Common capsule — the tier a giveaway is really a shot at. */
export const CAPSULE_TOP_TIER = CAPSULE_ODDS[CAPSULE_ODDS.length - 1] || null;

/**
 * What a capsule costs to open, at the two ends of the published ramp.
 *
 * Worth printing rather than hiding, because it is the one cost a *winner* carries: the capsule is
 * free, opening it is not, and a community that finds that out after winning has been misled. The
 * price schedule itself lives in `reward-config.js#capsuleOpenPrice`.
 */
export const CAPSULE_OPEN_PRICE = Object.freeze({
    floor: Math.round(capsuleOpenPrice(0)),
    top: Math.round(capsuleOpenPrice(KNIGHTS_REFERENCE_SIZE)),
});

/** The summonable ladder, loudest first — the same table the Summoning Chamber sells against. */
export const KNIGHT_LADDER = TIER_DISPLAY_ORDER.map((key) => ({
    tier: RARITY[key].name,
    hashPower: RARITY[key].hashPower,
    perRun: RARITY[key].dungeonReward,
    runsPerDay: RARITY[key].dailyRuns,
    perDay: RARITY[key].dungeonReward * RARITY[key].dailyRuns,
}));

/** The ticket clock in days — 168 hours, published as a promise the vault keeps. */
export const TICKET_CLOCK_DAYS = TICKET_CAP_HOURS / 24;

/* --------------------------------------------------------------------- the copy */

export const HERO = Object.freeze({
    kicker: 'PARTNER WITH DUNGEON KNIGHTS',
    title: 'Bring your community into the dungeon',
    lead:
        'Dungeon Knights is a play-to-earn NFT idle RPG on Robinhood Chain — five themed dungeons, '
        + 'knight NFTs and $DNG. We run giveaways with projects we like, and we run them the same way '
        + 'every time. These are the terms.',
    sub: 'Read the offer, then open the project tab at the bottom and register a wallet for the giveaway you want to enter.',
});

/**
 * **What we offer your community** — the two things a collaboration can be built from.
 *
 * One entry per prize rather than one paragraph of prose, because a partner is choosing between
 * them: capsules suit a community that wants to *play*, whitelist spots suit one that wants a
 * position in the collection.
 */
export const OFFERS = Object.freeze([
    {
        key: 'capsules',
        title: 'Free Knight capsules',
        tag: 'For players',
        summary:
            'Capsules from the summonable Knight collection, handed to your community. Each one opens '
            + 'into a single Knight, and its tier is what that Knight is worth.',
        points: [
            `A Common capsule draws ${CAPSULE_ODDS_LINE}.`,
            `The top of that ladder is a ${CAPSULE_TOP_TIER ? CAPSULE_TOP_TIER.tier : 'Legendary'} Knight — the tier that carries the most hash power and the largest daily reward.`,
            'Every Knight fights the same dungeons the collection plays, and can be staked for passive income on top.',
            `The capsule is free. Opening it is not: the open price rises from ${fmtInt(CAPSULE_OPEN_PRICE.floor)} to ${fmtInt(CAPSULE_OPEN_PRICE.top)} $DNG as the collection fills, and it is the winner who pays it.`,
        ],
        fine: 'How many capsules, and in what mix, is agreed per collaboration. We write that number down before anything is announced.',
    },
    {
        key: 'genesis',
        title: 'Genesis NFT whitelist',
        tag: 'For collectors',
        summary:
            `Guaranteed mint spots for your community on the Genesis collection — ${fmtInt(GENESIS_SUPPLY)} knights, fixed supply, and no more can ever be created.`,
        points: [
            `Every Genesis Knight rolls ${fmtInt(HASH_POWER_MIN)}–${fmtInt(HASH_POWER_MAX)} hash power, and that number decides how much of the vault it carries.`,
            `Genesis is the only collection that draws: ${fmtInt(CAPSULES_PER_WEEK)} capsules a week go to staked Genesis knights, split by tickets.`,
            `Each ticket builds for ${TICKET_CLOCK_DAYS} days and then stops, so playing beats parking.`,
            'Staked Genesis knights also draw from the weekly $DNG pool, alongside the Knights line.',
        ],
        fine: 'The number of spots is agreed per collaboration. A whitelist place is a guaranteed mint, not a free one — the mint still happens on the open market.',
    },
]);

/**
 * **What these NFTs are used for** — the honest answer to "what do I do with it".
 *
 * Two sides, because the two collections genuinely do different jobs: a Knight is the unit you play
 * with, a Genesis Knight is the position you hold. Nothing here is a future promise dressed as a
 * utility — every line is a number out of `knights.js` or `reward-config.js`.
 */
export const NFT_USE = Object.freeze([
    {
        key: 'knights',
        title: 'Knights — what a capsule opens into',
        lede: 'A Knight is the unit you play with. Its tier fixes what it is worth, and the game settles every run on chain, per knight, each day.',
        points: [
            {
                label: 'Earn in the dungeons',
                text: 'Deploy up to 15 knights in a squad, clear the five themed dungeons, and each knight pays its own daily reward: '
                    + `${KNIGHT_LADDER.map((row) => `${fmtInt(row.perRun)} $DNG × ${row.runsPerDay} runs (${row.tier})`).join(', ')}.`,
            },
            {
                label: 'Stake for passive income',
                text: `Stake a knight and it earns without being played, at 90% of what clearing pays it. Hash power is the weight: ${KNIGHT_LADDER.map((row) => `${fmtInt(row.hashPower)} (${row.tier})`).join(', ')}.`,
            },
            {
                label: 'Carry hash power',
                text: 'Hash power is the stat the vault reads. It is derived from a tier\'s daily capacity rather than typed in, so the whole collection is measured by one rule.',
            },
        ],
    },
    {
        key: 'genesis',
        title: 'Genesis Knights — the position you hold',
        lede: 'Genesis is the fixed side of the collection, and its utility is about share rather than about playing: it runs the same dungeons at a flat, equal reward, and it is the collection the vault raffles against.',
        points: [
            {
                label: 'Play for a flat reward',
                text: `Every Genesis Knight earns the same ${fmtInt(GENESIS_REWARD_PER_CLEAR)} $DNG per clear across ${GENESIS_DAILY_RUNS} runs a day — ${fmtInt(GENESIS_DAILY_CAPACITY)} a day at the cap. Hash power moves passive income only, so no Genesis Knight is left behind by a bad roll.`,
            },
            {
                label: 'Win the weekly capsules',
                text: `A staked Genesis Knight is entered into the weekly draw automatically: ${fmtInt(CAPSULES_PER_WEEK)} capsules a week, awarded by ticket weight, and one ticket is enough to win. Each capsule opens into one Knight from the summonable collection.`,
            },
            {
                label: 'Draw from the weekly $DNG pool',
                text: `Stake it and it takes a share of the week's $DNG pool in proportion to its tickets. Weight builds for ${TICKET_CLOCK_DAYS} days and then stops; unstaking ends the share.`,
            },
        ],
    },
]);

/**
 * **What we ask of you** — the partner's side, which is one post and the details behind it.
 *
 * Stated as plainly as the offer, because a collaboration that only writes down what one side gives
 * is the one that goes wrong later.
 */
export const PARTNER_TERMS = Object.freeze({
    title: 'What we ask of you',
    sub: 'One post, and the details we need to run it.',
    items: [
        {
            title: 'A collab post on your X',
            text: 'You announce the giveaway to your community from your own account: what we are giving away, and the registration tab on this page. We write it with you so the copy and the numbers line up, and you post it as your own.',
        },
        {
            title: 'We share that post',
            text: 'We quote it from @DNGrobinhood and add it to our own announcements, so the collab runs in both directions rather than living on one timeline.',
        },
        {
            title: 'The giveaway details up front',
            text: 'Your handle, the prize you want (capsules, whitelist spots, or both), how many, and the dates you want it to run. That is what sets the project tab up.',
        },
        {
            title: 'Entries come from the tab below',
            text: 'Your community connects a wallet and registers on this page. That list is the entry list — one wallet, one entry per project — and it is what we hand the winner back.',
        },
    ],
});

/** How a collaboration actually runs, start to finish. */
export const COLLAB_STEPS = Object.freeze([
    {
        title: 'We agree the giveaway',
        text: 'Capsules, Genesis whitelist spots, or both — and how many of them your community gets.',
    },
    {
        title: 'We add your project here',
        text: 'Your X handle and profile picture go into the project tab below, with its own registration.',
    },
    {
        title: 'Your community registers',
        text: 'They connect a wallet and sign in once, which is what makes an entry theirs rather than a typed address.',
    },
    {
        title: 'You post, we share',
        text: 'The collab post goes out on your X, we share it, and the giveaway runs for the agreed window.',
    },
    {
        title: 'We hand the prizes over',
        text: 'Winners are drawn from the registered wallets and announced from @DNGrobinhood.',
    },
]);

/**
 * The **pinned** projects in the collab giveaway, in the order they appear.
 *
 * Each project carries its own registration, because that is how the tab works: a partner's giveaway
 * is a set of wallets rather than a slice of one big list. `slug` is the store's key, so it must not
 * be changed once entries exist.
 *
 * This list is no longer the whole tab. A project that came in through `/collab#submit` and was
 * approved on the owner's tool is read **from the store** by the page — see `composeProjects` below —
 * so nothing here has to be pasted by hand for one to appear. What is left in this file is the small
 * set of projects that did not come from a request: a collaboration agreed in a DM, or one whose
 * store row is not on this deployment. They are pinned rather than fetched, which is also why the
 * page still has a giveaway on it when the store cannot be reached.
 *
 * `avatar` is a file in `public/`, not a hotlink: a profile picture fetched from X at render time
 * would be a third-party request on the page of somebody we are asking for a wallet signature, and
 * it would break the moment the account changed it. Dropping the new file in is the update. A
 * store-approved project has no file — its picture is served from `/api/collab/photo` instead.
 */
export const COLLAB_PROJECTS = Object.freeze([
    {
        slug: 'fabled-chronicle',
        name: 'Fabled Chronicle',
        handle: 'FabledChronicle',
        url: 'https://x.com/FabledChronicle',
        avatar: '/assets/collab/fabled-chronicle.png',
        prize: 'Free Knight capsules + Genesis NFT whitelist',
        blurb: 'The first project in the Dungeon Knights collab giveaway.',
        status: 'open',
        approved: false,
    },
]);

/**
 * Where a store-approved project's picture is served from.
 *
 * Its own route because the picture is not a file: the store holds it as a `data:` URL next to the
 * plan, and inlining a few hundred kilobytes of base64 into the markup of the page that asks a
 * partner for a wallet signature would be the heaviest thing on the site by an order of magnitude.
 * A URL keeps the tab's markup the same whether a picture came from `public/` or from the store.
 */
export const PROJECT_PHOTO_ROUTE = '/api/collab/photo';

/**
 * A store-approved project's picture URL.
 *
 * `v` is when the picture was uploaded, which is what makes a **replaced** picture a different URL:
 * the route can then be cached hard, because a new upload is not the same address.
 */
export function projectPhotoUrl(request) {
    const stamp = Date.parse(request?.photoAt || '') || 0;
    return `${PROJECT_PHOTO_ROUTE}?project=${encodeURIComponent(request.slug)}&v=${stamp}`;
}

/**
 * The project a request becomes, in the same shape a pinned entry has.
 *
 * Every word on it is the project's own: the name, the handle and the prize line are what was typed
 * into the form and approved, rather than a second-hand summary. The blurb is the one line built
 * here, out of the dates the project asked for.
 *
 * `avatar` is `null` until the picture is uploaded — approving a request is not the same moment as
 * the project sending its picture, and the tab shows its initial until then rather than a broken
 * image or a stand-in with somebody else's face on it.
 */
export function projectFromRequest(request) {
    if (!request?.slug) return null;
    return {
        slug: request.slug,
        name: request.name,
        handle: request.handle,
        url: `https://x.com/${request.handle}`,
        avatar: request.photo ? projectPhotoUrl(request) : null,
        prize: request.prize,
        blurb: request.dates
            ? `Open until ${request.dates}.`
            : 'In the Dungeon Knights collab giveaway.',
        status: 'open',
        approved: true,
    };
}

/**
 * The giveaway list the tab renders: the pinned projects, plus every approved request.
 *
 * An approved request **wins** over a pinned entry for the same X account, matched on the handle as
 * well as on the slug — the same handle is the same account, and the request is the project's own
 * words and its own picture. That is also what keeps the tab honest while a project is being moved
 * from this file into the store: the two spellings are one tab, and what is shown is the live row.
 */
export function composeProjects(requests = []) {
    const projects = COLLAB_PROJECTS.map((entry) => ({ ...entry }));
    for (const request of requests || []) {
        const entry = projectFromRequest(request);
        if (!entry) continue;
        const handle = String(entry.handle || '').toLowerCase();
        const at = projects.findIndex((row) => row.slug === entry.slug
            || (handle && String(row.handle || '').toLowerCase() === handle));
        if (at === -1) projects.push(entry);
        else projects[at] = entry;
    }
    return projects;
}

/** What the giveaway tab says when the store has nothing on it at all. */
export const PROJECTS_EMPTY = 'No collab giveaway is open at this moment. Send a request below and yours can be the next one.';

/**
 * The slugs of the **pinned** projects. The store accepts these plus any approved request's slug —
 * `lib/collab-store.js#isProjectSlug` is the thing that answers that question, because it is the one
 * that can also see the store.
 */
export const COLLAB_SLUGS = Object.freeze(COLLAB_PROJECTS.map((project) => project.slug));

/** A pinned project by slug, or null. Case-sensitive: the slug is a store key, not a label. */
export function projectBySlug(slug) {
    return COLLAB_PROJECTS.find((project) => project.slug === slug) || null;
}

/** Where a project is written to, and where somebody asks to be one. */
export const CONTACT = Object.freeze({
    handle: 'DNGrobinhood',
    x: 'https://x.com/DNGrobinhood',
    discord: DISCORD_INVITE,
});

/**
 * **Our own profile picture**, and the left half of every announcement card.
 *
 * The account's real avatar (@DNGrobinhood), fetched from X once and kept in `public/` rather than
 * linked: the card is an artifact somebody downloads and posts, and a picture that is fetched from a
 * third party at the moment the canvas is drawn is a picture that can be missing, slow, or refused by
 * CORS — and a **tainted canvas cannot be turned into a PNG at all**, so a hotlink here would not be a
 * cosmetic problem, it would be a download button that does nothing.
 */
export const OUR_PFP = '/assets/collab/dungeon-knights.jpg';

/**
 * The submission section — a project asking to collaborate.
 *
 * The states are the words a project reads at each step, kept here rather than in the component for
 * the same reason as everything else on this page: the copy is the deliverable, and a state whose
 * sentence lives in four lines of JSX is a state somebody forgets to update.
 */
export const SUBMISSION = Object.freeze({
    eyebrow: 'Ask us',
    title: 'Request a collab',
    sub: 'A request comes from a signed wallet, so it is tied to the project that sent it rather than to an anonymous form.',
    intro: 'Tell us the project, the handle you post from, and the giveaway you want to run. We read every one and answer from @'
        + CONTACT.handle + '.',
    needsWallet: 'Connect a wallet and sign in to send a request. That signature is the only thing we ask for before we read it — it is what makes the request yours.',
    pendingTitle: 'Your request is with us',
    pendingBody: 'Nothing is agreed until you hear back from us. You can change the details and send it again, or withdraw it, while it is still waiting.',
    approvedTitle: 'Approved — upload your profile picture',
    approvedBody: 'Upload the profile picture from the account you post with. It goes on the announcement card beside ours, and the finished picture is yours to download and post.',
    rejectedTitle: 'Not this round',
    rejectedBody: 'We passed on that one. Nothing is locked — change the details below and send it again whenever you like.',
    withdraw: 'Withdraw this request',
    edit: 'Edit and resend',
    cardNote: 'Both sizes are the same pieces: your picture, ours, the banner, and the prize line from your request. Download the one you need and post it — we share it from @'
        + CONTACT.handle + '.',
    note: 'What a request keeps: the project name, the handle, the prize you asked for, your dates, your note, and your picture once it is approved — all tied to the wallet that signed. No email, no IP, and no public list of who has asked.',
});

/**
 * The most a `data:` URL may be before the page stops trying to send it.
 *
 * The server's own cap is `PFP_MAX_BYTES` in `lib/collab-store.js` — 256 KB of decoded picture — and a
 * base64 data URL runs about 1.37× its bytes. This is that, with a little room, so the browser refuses
 * the upload at the same place the server would rather than sending something it knows will bounce.
 */
export const PHOTO_DATA_URL_MAX = 350_000;

/** How a request is filed, and the two limits the form and the server both enforce. */
export const SUBMISSION_FIELDS = Object.freeze([
    { key: 'name', label: 'Project name', placeholder: 'Fabled Chronicle', max: 48, required: true },
    { key: 'handle', label: 'X handle you post from', placeholder: '@FabledChronicle', max: 31, required: true },
    { key: 'prize', label: 'Giveaway you want to run', placeholder: '3 Knight capsules + 2 Genesis whitelist spots', max: 90, required: true },
    { key: 'dates', label: 'When you would like it to run', placeholder: 'Early October, one week', max: 40, required: false },
    { key: 'note', label: 'Anything else', placeholder: 'Optional', max: 400, required: false },
]);

/**
 * **The owner's page** — `/collab/review`, where a request becomes a decision.
 *
 * The copy lives here for the same reason every other string on this page does: what a page *says* at
 * each state is a deliverable, and a state whose sentence lives in six lines of JSX is a state
 * somebody forgets to update. This half is written for the owner rather than for the partner, so it is
 * blunt about what a button will do and what the project will see.
 *
 * It sits after `SUBMISSION_FIELDS` on purpose: the note's length limit is read out of that table
 * rather than typed a second time, and a table read before it is filled in is a module that throws.
 */
export const REVIEW = Object.freeze({
    eyebrow: 'Owner only',
    title: 'Collab requests',
    sub: 'Every project that has asked to collaborate, oldest first, with the two decisions there are. This list is not public: it is readable only by a signed wallet on the owner list.',
    needsWalletTitle: 'Sign in with the owner wallet',
    needsWallet: 'Connect the wallet on this deployment\'s owner list (COLLAB_OWNERS) and sign in. The signature is the credential — the list is answered to nobody else.',
    notOwnerTitle: 'Not the owner wallet',
    notOwner: 'This wallet is not on the owner list, so the store has no request list for it. Connect the wallet that is — and if the list should include this one, it is COLLAB_OWNERS on the deployment.',
    ownerList: (count) => (count === null ? 'unknown'
        : `${count} wallet${count === 1 ? '' : 's'} on COLLAB_OWNERS`),
    errorTitle: 'The list could not be read',
    errorBody: 'The store did not answer. Nothing has changed: no decision was sent, and nothing is waiting on this page.',
    reconnect: 'Use a different wallet',
    refresh: 'Refresh',
    empty: 'No project has asked yet. A request arrives from the form at the bottom of /collab, and it lands here the moment it is sent.',
    noneOfThatState: 'Nothing in that state. Pick another tab — the one you are on has none of these in it.',
    approve: 'Approve',
    reject: 'Reject',
    deciding: 'Saving…',
    notePlaceholder: 'Note for the project (optional) — they read it on /collab',
    noteLimit: (SUBMISSION_FIELDS.find((entry) => entry.key === 'note') || {}).max || 400,
    approvedRow: 'Approved. The project can upload its picture at /collab#submit, and it is on the giveaway tab now.',
    rejectedRow: 'Turned down. They are told the reason above, and they can change the details and send it again.',
    approvedHint: (name) => `${name ? `${name} is` : 'That project is'} on the giveaway tab now — /collab reads the approved projects out of the store, so there is nothing to paste and nothing to deploy. It can upload its picture at /collab#submit, and the announcement card comes from that picture.`,
    rejectedHint: 'Turned down, with the note above. They read it on /collab, and they can change the details and send it again — nothing is locked.',
    footnote: 'What this page can do: move a request between pending, approved and rejected. What it cannot do: edit a request, delete one, or make anybody an owner. Removing a row is the CLI — tools/collab-requests.js --remove.',
});
