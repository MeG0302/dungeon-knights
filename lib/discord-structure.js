/**
 * The Discord server, written down once.
 *
 * WHY THIS IS A FILE AND NOT A CLICK-THROUGH
 * ------------------------------------------
 * A server built by hand drifts: somebody renames a channel, a permission gets flipped in a hurry,
 * and six weeks later nobody can say which of the two states was intended. So the intended state
 * lives here, `tools/discord-setup.js` compares it with what the API actually reports, and the
 * difference between the two is printed as a plan. Nothing is created until `--apply`, and applying
 * twice in a row writes nothing the second time — that property is the point of the split, and
 * `tools/check-discord.js` fails if it ever stops holding.
 *
 * WHAT THIS MODULE IS NOT ALLOWED TO DO
 * -------------------------------------
 * It never talks to Discord. Everything in here is data and arithmetic, which is what makes it
 * testable offline and what keeps the one dangerous part (a live token) confined to
 * `lib/discord-api.js`. `computePlan` takes what the API reported and returns a list of intentions.
 *
 * THE PERMISSION MODEL, AND WHY "ACCESS" EXISTS
 * ---------------------------------------------
 * Channel overwrites are where hand-built servers go wrong, because the same decision (who may post
 * here) is expressed as raw bitfields in a place a human has to read carefully. So a channel names
 * an **access class** and the class decides the bits: `public`, `read-only`, `holders`, `genesis`,
 * `staff`, `staff-mod`, `voice`. One table, one meaning per name, and the harness asserts the
 * things a person would actually check ("@everyone cannot post in announcements", "@everyone cannot
 * see staff-chat").
 *
 * Two facts about Discord's resolution order justify the shape of that table:
 *
 *   - a channel's own overwrite for a role **replaces** the category's overwrite for that role
 *     rather than adding to it, so a public channel inside a locked category has to restate its own
 *     `@everyone` view grant. That is why every class lists `@everyone` explicitly.
 *   - a role's channel overwrite is applied **after** `@everyone`'s, so granting `Sentinel` sight of
 *     a locked channel is one overwrite and does not need the class to un-deny anything.
 *
 * The `@everyone` **role** itself is never created, edited or reordered by the setup tool: it is
 * the server's base permission set and Discord will not let anybody delete it. The tool only ever
 * writes *channel* overwrites that name it.
 */

import { VAULT_ENTRY_TOTAL, X_ENGAGEMENT_REWARD } from './points-config.js';

/* ------------------------------------------------------------------ permission bits
 *
 * Only the ones this file actually uses, named rather than numbered, because a mistyped bit is a
 * permission that silently does not exist. Values are BigInt for two reasons: some of them (timeout,
 * threads) sit above 2^31 and would be mangled by a 32-bit shift, and the API wants the final number
 * as a **string**, which BigInt prints without going through float notation.
 */

export const PERMISSION = {
    CREATE_INSTANT_INVITE: 1n << 0n,
    KICK_MEMBERS: 1n << 1n,
    BAN_MEMBERS: 1n << 2n,
    MANAGE_CHANNELS: 1n << 4n,
    MANAGE_GUILD: 1n << 5n,
    ADD_REACTIONS: 1n << 6n,
    VIEW_AUDIT_LOG: 1n << 7n,
    STREAM: 1n << 9n,
    VIEW_CHANNEL: 1n << 10n,
    SEND_MESSAGES: 1n << 11n,
    MANAGE_MESSAGES: 1n << 13n,
    EMBED_LINKS: 1n << 14n,
    ATTACH_FILES: 1n << 15n,
    READ_MESSAGE_HISTORY: 1n << 16n,
    MENTION_EVERYONE: 1n << 17n,
    USE_EXTERNAL_EMOJIS: 1n << 18n,
    CONNECT: 1n << 20n,
    SPEAK: 1n << 21n,
    MUTE_MEMBERS: 1n << 22n,
    MOVE_MEMBERS: 1n << 24n,
    MANAGE_ROLES: 1n << 28n,
    MANAGE_WEBHOOKS: 1n << 29n,
    MANAGE_THREADS: 1n << 34n,
    MODERATE_MEMBERS: 1n << 40n,
    // Pinning a message used to ride on `MANAGE_MESSAGES`. Discord split it out, and a bot holding
    // `MANAGE_MESSAGES` but not this bit is answered with a bare `Missing Permissions` on every pin —
    // in any channel, with or without overwrites, which is how it was found. Without it the four
    // pinned pages are four posted pages.
    PIN_MESSAGES: 1n << 51n,
};

/** Channel types, by name. Text and voice are all this server uses. */
export const CHANNEL_TYPE = { text: 0, voice: 2, category: 4 };

/** A list of permission names as one integer. Unknown names throw: a typo must not become a no-op. */
export function permissionsOf(names) {
    let total = 0n;
    for (const name of names || []) {
        const bit = PERMISSION[name];
        if (bit === undefined) throw new Error(`unknown permission "${name}"`);
        total |= bit;
    }
    return total;
}

/** The decimal string the API wants. */
export function permissionInteger(names) {
    return permissionsOf(names).toString();
}

/* --------------------------------------------------------------------------- roles
 *
 * Order matters and is top to bottom: the first role is the highest. Two groups live here:
 *
 *   - **staff** (`keeper`, `sentinel`, `herald`) are created for people to be given by hand. The
 *     sync never grants or removes them, because "who is staff" is not a fact a chain read can know.
 *   - **synced** (`genesis`, `knight`, `warden`, `champion`, `squire`) are decided by holdings and
 *     points, and `/claim` reconciles them. They carry no permissions at all: they gate rooms and
 *     they show rank, which is all a cosmetic role should do.
 *
 * `hoist` splits them in the member list, and only the staff rows and the two holder rows are
 * hoisted. A sidebar with eight headings is a sidebar nobody reads.
 *
 * Every role also names an `icon` — the picture Discord draws inside the role's own colour — and
 * that is the one cosmetic thing here a stock server cannot wear, because it is a Level 2 boost
 * perk. Measured against the live server: the call is answered with `403 This server needs more
 * boosts to perform this action`, and Discord's own documentation says the same. So the picture is
 * written when the server qualifies and reported as a blocker when it does not, rather than retried
 * forever against a limit that is about boosting rather than about permissions.
 *
 * The bot's own managed role wears no icon on purpose: Discord answers `403` on a `PATCH` naming a
 * bot's own highest role, which is the same fact that makes its channel overwrite un-writable (see
 * `botPostSpec`). It already has Arya's face as its avatar, which is where a person sees it.
 */

/** The boost level Discord requires before it will accept a role icon. Custom role icons are a Level 2 perk. */
export const ROLE_ICON_BOOST_TIER = 2;

export const ROLES = [
    {
        key: 'keeper',
        name: 'Keeper of the Realm',
        icon: 'public/assets/discord/roles/keeper.png',
        color: '#E0B34C',
        hoist: true,
        mentionable: true,
        role: 'staff',
        about: 'Owners and admins. Everything below this role can be managed by them.',
        permissions: [
            'MANAGE_CHANNELS', 'MANAGE_ROLES', 'MANAGE_WEBHOOKS', 'MANAGE_MESSAGES', 'MANAGE_GUILD',
            'MANAGE_THREADS', 'KICK_MEMBERS', 'BAN_MEMBERS', 'MODERATE_MEMBERS', 'MUTE_MEMBERS',
            'MOVE_MEMBERS', 'VIEW_AUDIT_LOG', 'MENTION_EVERYONE',
        ],
    },
    {
        key: 'sentinel',
        name: 'Sentinel',
        icon: 'public/assets/discord/roles/sentinel.png',
        color: '#C0392B',
        hoist: true,
        mentionable: true,
        role: 'staff',
        about: 'Moderators. Chip spam before it reaches the channels and keep the log readable.',
        permissions: [
            'KICK_MEMBERS', 'BAN_MEMBERS', 'MODERATE_MEMBERS', 'MANAGE_MESSAGES', 'MUTE_MEMBERS',
            'MOVE_MEMBERS', 'VIEW_AUDIT_LOG', 'MENTION_EVERYONE',
        ],
    },
    {
        key: 'herald',
        name: 'Herald',
        icon: 'public/assets/discord/roles/herald.png',
        color: '#8E7CC3',
        hoist: true,
        mentionable: true,
        role: 'staff',
        about: 'Announcers. Writes in the announcement channels and cleans up after a typo.',
        permissions: ['MANAGE_MESSAGES', 'MENTION_EVERYONE', 'MANAGE_THREADS'],
    },
    {
        key: 'genesis',
        name: 'Genesis',
        icon: 'public/assets/discord/roles/genesis.png',
        color: '#F1C40F',
        hoist: true,
        mentionable: false,
        role: 'synced',
        about: 'Holds at least one Genesis Knight. Granted by /claim, never by hand.',
        permissions: [],
        grant: { source: 'genesis', at: 1 },
    },
    {
        key: 'knight',
        name: 'Knight',
        icon: 'public/assets/discord/roles/knight.png',
        color: '#8E9BAE',
        hoist: true,
        mentionable: false,
        role: 'synced',
        about: 'Holds at least one Knight from the summoning collection. Granted by /claim.',
        permissions: [],
        grant: { source: 'knights', at: 1 },
    },
    {
        key: 'warden',
        name: 'Warden of the Vault',
        icon: 'public/assets/discord/roles/warden.png',
        color: '#3F8FD0',
        hoist: false,
        mentionable: false,
        role: 'synced',
        about: '10,000 points in the program. Granted by /claim.',
        permissions: [],
        grant: { source: 'points', at: 10_000 },
    },
    {
        key: 'champion',
        name: 'Champion',
        icon: 'public/assets/discord/roles/champion.png',
        color: '#3FA97A',
        hoist: false,
        mentionable: false,
        role: 'synced',
        about: '2,500 points in the program. Granted by /claim.',
        permissions: [],
        grant: { source: 'points', at: 2_500 },
    },
    {
        key: 'squire',
        name: 'Squire',
        icon: 'public/assets/discord/roles/squire.png',
        color: '#9AA5B1',
        hoist: false,
        mentionable: false,
        role: 'synced',
        about: '500 points in the program, which one full vault run passes. Granted by /claim.',
        permissions: [],
        grant: { source: 'points', at: 500 },
    },
    {
        key: 'verified',
        name: 'Verified',
        icon: 'public/assets/discord/roles/verified.png',
        color: '#4E8C6A',
        hoist: false,
        mentionable: false,
        // `gate`: granted by the button in #verify and by nothing else. It is deliberately not a
        // `synced` role, because the sync replaces roles from what a wallet holds and would strip it
        // from a member whose wallet read failed. The harness asserts it is outside that list.
        role: 'gate',
        about: 'Passed the gate. Granted by the button in #verify, never by hand and never by /claim.',
        permissions: [],
    },
    {
        key: 'chronicler',
        name: 'Chronicler',
        icon: 'public/assets/discord/roles/chronicler.png',
        color: '#5B6B7C',
        hoist: false,
        mentionable: false,
        // `bot`: worn by Arya and by nobody else. Every room that hides itself from @everyone grants
        // it, which is how the bot can see and keep a room it hid from everyone else.
        //
        // This role exists because of one hard limit: a bot may not write a channel overwrite naming
        // its **own** managed role — Discord answers 50013, and only a channel *create* can carry one.
        // That is what used to force four rooms to be deleted and rebuilt, and what made a fresh build
        // and an existing server behave differently. A role below the bot is writable like any other,
        // and the bot may give itself one (verified: `PUT /guilds/{id}/members/{bot}/roles/{role}`
        // answers 204), so the grant now travels in the file like every other grant.
        role: 'bot',
        about: 'Arya\'s own key to the rooms she keeps. Nobody is meant to hold it but the bot.',
        permissions: [],
    },
];

/** The role the button in `#verify` hands out. One name, used by the page and by the handler. */
export const GATE_ROLE_KEY = 'verified';

/**
 * The gate button's custom id.
 *
 * Declared here because the page that carries the button and the handler that answers it are two
 * different modules, and a custom id typed twice is a button that does nothing when one of them moves.
 */
export const GATE_CUSTOM_ID = 'dk_gate_verify';

/** The roles `/claim` is allowed to add and remove. Nothing else is ever touched by the sync. */
export const SYNCED_ROLE_KEYS = ROLES.filter((role) => role.role === 'synced').map((role) => role.key);

/** The roles the setup tool creates but never assigns. */
export const STAFF_ROLE_KEYS = ROLES.filter((role) => role.role === 'staff').map((role) => role.key);

/* ------------------------------------------------------------------------ access classes
 *
 * `read-only`      — anyone may read, gate or no gate. Only a Herald or a Keeper may post.
 * `verified`       — **hidden until the gate is passed.** Everyone who pressed Verify may read and post.
 * `verified-read`  — behind the same gate, and read-only once through. Announcements, pinned pages.
 * `verified-voice` — the same gate on a voice room.
 * `holders`        — hidden from @everyone; Knight and Genesis holders may post, staff may read.
 * `genesis`        — Genesis holders only, plus the two roles that have to be able to see everything.
 * `staff`          — staff only.
 * `staff-mod`      — the two roles that handle reports. The Herald is deliberately absent.
 *
 * The line between `read-only` and the three `verified` classes is the whole gate: every room that is
 * not one of the five open ones denies `VIEW_CHANNEL` to `@everyone` and grants it to `Verified`. A
 * newcomer therefore sees the welcome, the rules, the door, the announcements and the roadmap, and
 * nothing else until they press it. `check-discord.js` walks every room in the file and fails if one
 * outside START HERE can be read without the gate.
 *
 * Every class that hides a room from `@everyone` also grants `chronicler`, which is how the bot sees a
 * room it just hid. That grant is the reason a room no longer has to be deleted and rebuilt to pick up
 * the bot's access: it names a role *below* the bot, and a bot may write an overwrite for any role
 * below itself.
 */

const POST = ['SEND_MESSAGES', 'ADD_REACTIONS', 'EMBED_LINKS', 'ATTACH_FILES', 'READ_MESSAGE_HISTORY', 'USE_EXTERNAL_EMOJIS'];
const READ = ['VIEW_CHANNEL', 'READ_MESSAGE_HISTORY'];

// What the bot itself needs in a room it has to write in. `POST` deliberately leaves `VIEW_CHANNEL`
// out — every member-facing grant in this file states sight separately, because "may post" and "may
// see" are two different decisions. The bot's grant is one line and has to carry both: written
// without it, the bot hid nineteen rooms and then could not see any of them. The harness caught it.
const KEEP = ['VIEW_CHANNEL', ...POST];

// `MENTION_EVERYONE` is deliberately absent, from every grant and every deny in this file.
//
// It is the one bit Discord will not let this bot write into a channel overwrite in either direction,
// and it says so with a bare `Missing Permissions` (50013): the same call succeeds the moment the bit
// is removed, verified against the live server on both an allow and a deny. Staff still ping — the
// permission lives on the Keeper and Sentinel **roles**, and announcements go out through the webhook,
// which is not subject to channel overwrites at all. What is lost is a Herald pinging @everyone from a
// pinned page, and a page is not an announcement.
const ANNOUNCE = ['SEND_MESSAGES', 'EMBED_LINKS', 'ATTACH_FILES'];

// The same grant in a room that is **also** hidden from `@everyone`. There, `VIEW_CHANNEL` comes from
// nobody: the open rooms hand it out through `@everyone`, and a hidden room cannot. Written without
// it, a Herald could post an announcement into a room they could not read.
const ANNOUNCE_READ = ['VIEW_CHANNEL', ...ANNOUNCE];

export const ACCESS = {
    'read-only': {
        about: 'Anyone may read, gate or no gate. Only a Herald or a Keeper may post.',
        everyone: { allow: ['VIEW_CHANNEL', 'READ_MESSAGE_HISTORY', 'ADD_REACTIONS'], deny: ['SEND_MESSAGES'] },
        roles: {
            herald: { allow: ANNOUNCE, deny: [] },
            keeper: { allow: ANNOUNCE, deny: [] },
            // The four open rooms are where the pinned pages live, so the bot needs to post here
            // whether or not it is verified.
            chronicler: { allow: KEEP, deny: [] },
        },
    },
    verified: {
        about: 'Hidden until the gate is passed. Everyone who pressed Verify may read and post.',
        everyone: { allow: [], deny: ['VIEW_CHANNEL'] },
        roles: {
            verified: { allow: ['VIEW_CHANNEL', ...POST], deny: [] },
            chronicler: { allow: KEEP, deny: [] },
            // Staff are not asked to press a button to see the server they run. They keep every room
            // the gate opens, which is the same courtesy the holder rooms already pay them.
            keeper: { allow: ['VIEW_CHANNEL', ...POST], deny: [] },
            sentinel: { allow: ['VIEW_CHANNEL', ...POST], deny: [] },
            herald: { allow: ['VIEW_CHANNEL', ...POST], deny: [] },
        },
    },
    'verified-read': {
        about: 'Behind the gate, and read-only once you are through. Announcements and pinned pages.',
        everyone: { allow: [], deny: ['VIEW_CHANNEL'] },
        roles: {
            verified: { allow: ['VIEW_CHANNEL', 'READ_MESSAGE_HISTORY', 'ADD_REACTIONS'], deny: [] },
            chronicler: { allow: KEEP, deny: [] },
            herald: { allow: ANNOUNCE_READ, deny: [] },
            keeper: { allow: ANNOUNCE_READ, deny: [] },
        },
    },
    'verified-voice': {
        about: 'The two voice rooms, behind the same gate.',
        everyone: { allow: [], deny: ['VIEW_CHANNEL'] },
        roles: {
            verified: { allow: ['VIEW_CHANNEL', 'CONNECT', 'SPEAK', 'STREAM'], deny: [] },
            chronicler: { allow: ['VIEW_CHANNEL'], deny: [] },
        },
    },
    holders: {
        // Hidden, not merely locked. A room the public can read but not post in still tells the
        // public what holders are saying, which is the opposite of what the room is for.
        about: 'Hidden from the public. Knight and Genesis holders may post.',
        everyone: { allow: [], deny: ['VIEW_CHANNEL'] },
        roles: {
            keeper: { allow: ['VIEW_CHANNEL', 'SEND_MESSAGES', ...POST], deny: [] },
            sentinel: { allow: ['VIEW_CHANNEL', 'SEND_MESSAGES', ...POST], deny: [] },
            knight: { allow: ['VIEW_CHANNEL', 'SEND_MESSAGES', ...POST], deny: [] },
            genesis: { allow: ['VIEW_CHANNEL', 'SEND_MESSAGES', ...POST], deny: [] },
            chronicler: { allow: KEEP, deny: [] },
        },
    },
    genesis: {
        about: 'Genesis holders only. No other holder role can see this room.',
        everyone: { allow: [], deny: ['VIEW_CHANNEL'] },
        roles: {
            keeper: { allow: ['VIEW_CHANNEL', 'SEND_MESSAGES', ...POST], deny: [] },
            sentinel: { allow: ['VIEW_CHANNEL', 'SEND_MESSAGES', ...POST], deny: [] },
            genesis: { allow: ['VIEW_CHANNEL', 'SEND_MESSAGES', ...POST], deny: [] },
            chronicler: { allow: KEEP, deny: [] },
        },
    },
    staff: {
        about: 'Staff only.',
        everyone: { allow: [], deny: ['VIEW_CHANNEL'] },
        roles: {
            keeper: { allow: ['VIEW_CHANNEL', 'SEND_MESSAGES', ...POST], deny: [] },
            sentinel: { allow: ['VIEW_CHANNEL', 'SEND_MESSAGES', ...POST], deny: [] },
            herald: { allow: ['VIEW_CHANNEL', 'SEND_MESSAGES', ...POST], deny: [] },
            chronicler: { allow: KEEP, deny: [] },
        },
    },
    'staff-mod': {
        about: 'The two roles that handle reports. The Herald is not one of them.',
        everyone: { allow: [], deny: ['VIEW_CHANNEL'] },
        roles: {
            keeper: { allow: ['VIEW_CHANNEL', 'SEND_MESSAGES', ...POST], deny: [] },
            sentinel: { allow: ['VIEW_CHANNEL', 'SEND_MESSAGES', ...POST], deny: [] },
            chronicler: { allow: KEEP, deny: [] },
        },
    },
};

/* ------------------------------------------------------------------- channels and categories
 *
 * Categories and channels are dressed the way game servers actually get dressed, because that is the
 * convention a visitor arrives expecting to see: a category is a bare `⁂⁂⁂《 NAME 》⁂⁂⁂` divider (no
 * emoji, so the divider is the only thing in it), and a channel is `<emoji>┃<name>` — the box-drawing
 * `┃` (U+2503), not a pipe, so it has no meaning to any client that tries to linkify it. The emoji
 * carries the meaning at a glance; the word after the bar is what a mention still reads as.
 *
 * Two rooms are Discord's own defaults rather than ours — `💬┃general` and `🎬┃clips-and-highlights` —
 * and they are described here rather than created here. A server that already has a general room keeps
 * its history, its pins and its links when the builder adopts it instead of making a second one.
 *
 * `webhook: true` marks the two channels the site posts into by itself. The setup tool creates those
 * webhooks and prints the URLs once; see `lib/discord-notify.js` for what is sent.
 */

export const SERVER = {
    /** The name the server is asked to have. Never renamed automatically unless --rename is given. */
    name: 'Dungeon Knights',
    categories: [
        {
            key: 'start',
            name: '⁂⁂⁂《 START HERE 》⁂⁂⁂',
            access: 'read-only',
            channels: [
                {
                    key: 'welcome',
                    name: '📜┃welcome',
                    type: 'text',
                    topic: 'What this project is, and the three things worth doing first.',
                    access: 'read-only',
                    content: 'welcome',
                },
                {
                    key: 'rules',
                    name: '⚖┃server-rules',
                    type: 'text',
                    topic: 'Six rules. They fit on one screen.',
                    access: 'read-only',
                    content: 'rules',
                },
                {
                    // The gate itself: the only door into the rest of the server, and the one room whose
                    // whole job is a single button.
                    key: 'verify',
                    name: '🚪┃verify',
                    type: 'text',
                    topic: 'One press and the realm opens. No wallet, no email, no code.',
                    access: 'read-only',
                    content: 'verify',
                },
                {
                    key: 'announcements',
                    name: '📢┃announcements',
                    type: 'text',
                    topic: 'Mint dates, releases and anything that changes how the game works.',
                    access: 'read-only',
                    webhook: 'announce',
                },
                {
                    key: 'roadmap',
                    name: '🗺┃roadmap',
                    type: 'text',
                    topic: 'What is live, what is being built, and what is not promised yet.',
                    access: 'read-only',
                    content: 'roadmap',
                },
            ],
        },
        {
            key: 'realm',
            name: '⁂⁂⁂《 THE REALM 》⁂⁂⁂',
            access: 'verified',
            channels: [
                { key: 'general', name: '💬┃general', type: 'text', topic: 'Anything goes, within the rules.', access: 'verified' },
                {
                    key: 'clips',
                    name: '🎬┃clips-and-highlights',
                    type: 'text',
                    topic: 'Dungeon runs worth showing. Screenshots and clips, no commentary required.',
                    access: 'verified',
                },
                { key: 'off-topic', name: '🎭┃off-topic', type: 'text', topic: 'Not about the game. Still about being decent.', access: 'verified' },
                {
                    key: 'support',
                    name: '🛠┃support',
                    type: 'text',
                    topic: 'Stuck on binding X, a claim that did not land, a wallet that will not show its knights? Ask here.',
                    access: 'verified',
                },
                {
                    key: 'activity',
                    name: '🎉┃activity',
                    type: 'text',
                    topic: 'Waitlist signups and finished vault runs, posted automatically. Read-only.',
                    access: 'verified-read',
                    webhook: 'activity',
                },
            ],
        },
        {
            key: 'vault',
            name: '⁂⁂⁂《 THE VAULT 》⁂⁂⁂',
            access: 'verified',
            channels: [
                {
                    key: 'points-program',
                    name: '🏦┃points-program',
                    type: 'text',
                    topic: 'How the Points Program pays, and what a run is worth.',
                    access: 'verified-read',
                    content: 'points',
                },
                {
                    key: 'points-help',
                    name: '❓┃points-help',
                    type: 'text',
                    topic: 'X binding, invite codes, claims waiting on review. The site is the source of truth; this room is where you ask.',
                    access: 'verified',
                },
            ],
        },
        {
            key: 'holders',
            name: '⁂⁂⁂《 HOLDERS 》⁂⁂⁂',
            access: 'holders',
            channels: [
                {
                    key: 'holders-lounge',
                    name: '🛡┃holders-lounge',
                    type: 'text',
                    topic: 'For anyone holding a Knight or a Genesis. Link your wallet with /claim to get in.',
                    access: 'holders',
                },
                {
                    key: 'genesis-council',
                    name: '👑┃genesis-council',
                    type: 'text',
                    topic: 'Genesis holders. The 1,024 decide together here.',
                    access: 'genesis',
                },
            ],
        },
        {
            key: 'staff',
            name: '⁂⁂⁂《 STAFF 》⁂⁂⁂',
            access: 'staff',
            channels: [
                { key: 'staff-chat', name: '🗝┃staff-chat', type: 'text', topic: 'Running the server. Drafts, decisions, who is doing what.', access: 'staff' },
                { key: 'mod-log', name: '📋┃mod-log', type: 'text', topic: 'What was moderated and why. Nothing else.', access: 'staff-mod' },
            ],
        },
        {
            key: 'voice',
            name: '⁂⁂⁂《 VOICE 》⁂⁂⁂',
            access: 'verified-voice',
            channels: [
                { key: 'voice-general', name: '🔊┃Lobby', type: 'voice', topic: '', access: 'verified-voice' },
                { key: 'voice-squad', name: '⚔┃Dungeon Squad', type: 'voice', topic: '', access: 'verified-voice' },
            ],
        },
    ],
};

/** Every channel in the structure, categories included, flattened — the order is the create order. */
export function allChannels(server = SERVER) {
    const list = [];
    for (const category of server.categories) {
        list.push({ key: category.key, name: category.name, type: 'category', access: category.access, topic: '', content: null, webhook: null, category: null });
        for (const channel of category.channels) list.push({ ...channel, category: category.key });
    }
    return list;
}

/* ------------------------------------------------------------------------------- the emoji
 *
 * The dressing a visitor actually recognises, and the one cosmetic Discord gives away for nothing:
 * custom emoji are free at every boost level, fifty of them on a stock server, and they show up in
 * channels, topics and messages. (Role icons are the opposite, which is why they are a blocker above.)
 *
 * DERIVED FROM ART THIS REPO ALREADY SHIPS, NOT COPIED INTO IT TWICE
 * ------------------------------------------------------------------
 * The sources are 1–2 MB a file — fine on a page, too heavy to hand Discord. Each picture here was
 * made from one of them with a single command, `ffmpeg` being on this machine:
 *
 *   ffmpeg -y -i <source> -vf "scale=120:120:force_original_aspect_ratio=decrease,\
 *     pad=128:128:(ow-iw)/2:(oh-ih)/2:color=black@0" -pix_fmt rgba <name>.png
 *
 * That fits the art inside a transparent 128×128 square and centres it, so nothing is cropped and
 * nothing is stretched. 128×128 is what Discord renders; the byte ceiling is 256 KB and the largest
 * file here is 36 KB. `tools/check-discord.js` re-reads every one of them and fails if a file is
 * missing, is not that size, or crosses that ceiling — the numbers are checked, not documented.
 *
 * THE NAMES ARE THE CONTRACT
 * --------------------------
 * Discord's rule is `[a-zA-Z0-9_]`, 2 to 32 characters, unique per server, and a name that already
 * exists is **kept rather than replaced** — the same bargain the pinned pages make, for the same
 * reason: a person may have swapped the picture, and a builder that silently overwrote their edit is
 * worse than no builder. To change one, delete it in Discord and run the tool again.
 *
 * The prefixes carry the meaning: `knight_*` is a collection tier, `dng_*` is the economy (points,
 * vault, loot, tasks, invites, trophies), `arya_*` is the gate keeper's own face, and the bare map
 * names are the five dungeons.
 */

export const EMOJI = [
    // the six published faces of the two collections, straight off the PFPs the site already serves
    { name: 'knight_common', file: 'public/assets/discord/emoji/knight_common.png' },          // public/assets/pfp/common.webp
    { name: 'knight_uncommon', file: 'public/assets/discord/emoji/knight_uncommon.png' },      // public/assets/pfp/uncommon.webp
    { name: 'knight_rare', file: 'public/assets/discord/emoji/knight_rare.png' },              // public/assets/pfp/rare.webp
    { name: 'knight_epic', file: 'public/assets/discord/emoji/knight_epic.png' },              // public/assets/pfp/epic.webp
    { name: 'knight_legendary', file: 'public/assets/discord/emoji/knight_legendary.png' },    // public/assets/pfp/legendary.webp
    { name: 'knight_genesis', file: 'public/assets/discord/emoji/knight_genesis.png' },        // public/assets/pfp/genesis.webp
    // the economy, from the icons the Points Program page draws
    { name: 'dng_pts', file: 'public/assets/discord/emoji/dng_pts.png' },                      // points/Gold_coin_badge_with_PTS…
    { name: 'dng_vault', file: 'public/assets/discord/emoji/dng_vault.png' },                  // points/chest.png
    { name: 'dng_loot', file: 'public/assets/discord/emoji/dng_loot.png' },                    // points/treasure-chest.png
    { name: 'dng_task', file: 'public/assets/discord/emoji/dng_task.png' },                    // points/Green_checkmark_icon_for_tasks…
    { name: 'dng_invite', file: 'public/assets/discord/emoji/dng_invite.png' },                // points/Silver_chain_link_icon_referrals…
    { name: 'dng_trophy', file: 'public/assets/discord/emoji/dng_trophy.png' },                // points/Golden_trophy_pixel_art_icon…
    { name: 'dng_swords', file: 'public/assets/discord/emoji/dng_swords.png' },                // points/Crossed_sword_and_shield_icon…
    // Arya, the gate keeper, in four of her eight expressions
    { name: 'arya_hi', file: 'public/assets/discord/emoji/arya_hi.png' },                      // arya/arya-ready.png
    { name: 'arya_nice', file: 'public/assets/discord/emoji/arya_nice.png' },                  // arya/arya-clear.png
    { name: 'arya_think', file: 'public/assets/discord/emoji/arya_think.png' },                // arya/arya-think.png
    { name: 'arya_oops', file: 'public/assets/discord/emoji/arya_oops.png' },                  // arya/arya-alarm.png
    // one monster per dungeon, so a map can be named by the thing that lives in it
    { name: 'crypt', file: 'public/assets/discord/emoji/crypt.png' },                          // monsters/forgotten crypts/Skeleton_warrior…
    { name: 'goblin_mines', file: 'public/assets/discord/emoji/goblin_mines.png' },            // monsters/goblin mines/Pixel_art_goblin_diver…
    { name: 'magma', file: 'public/assets/discord/emoji/magma.png' },                          // monsters/magma chambers/Pixel_art_lava_slime…
    { name: 'temple', file: 'public/assets/discord/emoji/temple.png' },                        // monsters/overgrown temple/Pixel_art_carnivorous_plant…
    { name: 'void_rift', file: 'public/assets/discord/emoji/void_rift.png' },                  // monsters/void rift/Pixel_art_cosmic_jellyfish…
    // the house marks
    { name: 'dk_castle', file: 'public/assets/discord/emoji/dk_castle.png' },                  // ui/castle.png
    { name: 'dk_shield', file: 'public/assets/discord/emoji/dk_shield.png' },                  // ui/shield.png
];

/** The two webhook slots the site posts through, by the name the API will show. */
export const WEBHOOKS = {
    announce: { channelKey: 'announcements', name: 'Dungeon Knights announcements' },
    activity: { channelKey: 'activity', name: 'Dungeon Knights activity' },
};

/* ------------------------------------------------------------------------- the pinned pages
 *
 * Written once by the setup tool and pinned. A re-run leaves them alone unless `--refresh-content`
 * is passed, and that is deliberate: a person will edit these in Discord after they go up ("mint is
 * Thursday, not Friday") and a tool that silently overwrote that would be worse than no tool. The
 * file is the seed; Discord is the truth afterwards.
 *
 * Every number a player could act on is interpolated from `lib/points-config.js` rather than typed,
 * so the room cannot advertise a vault that pays something else. No em dashes, and no sentences
 * about how honest this is: it is a room description, not a manifesto.
 */

export function contentFor(key) {
    if (key === 'welcome') {
        return {
            title: 'Welcome to Dungeon Knights',
            lines: [
                'You are here before the mint. That is the good seat.',
                '',
                '**Three things worth doing first**',
                `1. Join the Points Program at dungeonknights.io/points and bind your X account. Points are paid to the bound account, so do this one first.`,
                `2. Clear the three floors in the Points Vault. A clean run is ${VAULT_ENTRY_TOTAL} points, and sharing the run doubles the whole day to ${VAULT_ENTRY_TOTAL * 2}.`,
                '3. Put your email on the Genesis waitlist if you want a shot at one of the 1,024 when they go live.',
                '',
                'Then come say hello in {general}. The team reads every message.',
            ],
        };
    }
    if (key === 'rules') {
        return {
            title: 'Rules',
            lines: [
                '1. Be decent. No harassment, no hate, no doxxing, no exceptions.',
                '2. Keep it in the right room. Game talk in the realm, points questions in the vault.',
                '3. No spam and no unsolicited DMs. Invite codes get posted on the site, not in somebody\'s inbox.',
                '4. No scams. Nobody from this team will ever DM you first about a mint, a wallet or a seed phrase, and we will never ask for one.',
                '5. Write in English in the shared rooms so the moderators can read what is going on.',
                '6. The moderators have the last word. If something is wrong, report it or post in {support}.',
            ],
        };
    }
    if (key === 'verify') {
        return {
            title: 'The Kingdom Gate',
            // The button is the whole page. `renderContent` turns this into the one component row, and
            // `GATE_CUSTOM_ID` is what the interaction handler matches on.
            button: { label: 'Verify', style: 1 },
            lines: [
                'Arya keeps the gate. One press and the rest of the server opens: the realm, the vault and the voice rooms.',
                '',
                'Nothing is asked for. No wallet, no email, no code.',
                '',
                'Holding a Knight or a Genesis? Press it anyway, then run `/claim` with the code from dungeonknights.io/points and the holder rooms open too.',
            ],
        };
    }
    if (key === 'points') {
        return {
            title: 'The Points Program',
            lines: [
                'Everything here is free to earn, and every point is recorded on our side.',
                '',
                '**Every day**',
                `Clear the three floors of the Points Vault. A clean run is ${VAULT_ENTRY_TOTAL} points. Share the finished run on X and the whole run doubles to ${VAULT_ENTRY_TOTAL * 2}.`,
                '',
                '**Once, while the campaign runs**',
                `Follow @DNGrobinhood and quote the campaign posts on the Points page. Each one pays ${X_ENGAGEMENT_REWARD} points, checked against your bound X account.`,
                '',
                '**Invites**',
                'Every wallet gets a five character invite code. Anyone who joins with it pays you a share of what they earn, and that share keeps paying.',
                '',
                'Bind your X account before you earn, because a run cleared without one is refused. If the binding is giving you trouble, ask in {support}.',
            ],
        };
    }
    if (key === 'roadmap') {
        return {
            title: 'Where the project stands',
            lines: [
                '**Live now**',
                'The Points Program: a daily vault run, invite codes, and X tasks with a short review.',
                'The dungeon room: five maps, loot chests, monsters that fight back. Still in closed testing, so expect rough edges.',
                'The Staking Vault: reads real holdings from the contracts and shows what a stake would earn.',
                '',
                '**On the way**',
                '1,024 Genesis Knights, fixed supply, minting on Robinhood Chain. The waitlist is open now.',
                'The public mint for summoning Knights, once the dungeon is out of testing.',
                '',
                'Dates get posted in {announcements} when they are certain, not before.',
            ],
        };
    }
    return null;
}

/**
 * The pinned pages, rendered.
 *
 * `{general}` and friends become real channel mentions when the ids are known, and plain `#name`
 * when they are not. A message with an unresolvable mention is worse than a plain name: Discord
 * renders the raw `<#0>` and it reads like a bug.
 */
export function renderContent(key, { channels = {} } = {}) {
    const content = contentFor(key);
    if (!content) return null;
    const string = content.lines.join('\n').replace(/\{([a-z-]+)\}/g, (match, name) => {
        const id = channels[name];
        return id ? `<#${id}>` : `#${name}`;
    });
    return {
        title: content.title,
        body: string,
        embed: {
            title: content.title,
            description: string,
            footer: { text: `Dungeon Knights server setup v${PLAN_VERSION} · ${key}` },
        },
        // A page with a button, or nothing at all. Discord rejects a null `components`, so this is
        // omitted rather than emptied, and the executor spreads it the same way.
        components: content.button
            ? [{
                type: 1,
                components: [{
                    type: 2,
                    style: content.button.style || 1,
                    label: content.button.label,
                    custom_id: GATE_CUSTOM_ID,
                }],
            }]
            : null,
    };
}

/* ------------------------------------------------------------------ what the bot may ask for
 *
 * The invite URL is generated from this list rather than copied out of a tutorial, so the grant and
 * the work cannot drift apart: a plan step that needs a permission the bot was not invited with is a
 * step that fails in production, and the harness asserts the two lists agree.
 */

export const BOT_PERMISSIONS = [
    // ----------------------------------------------- what building the server itself takes
    'VIEW_CHANNEL',
    'SEND_MESSAGES',
    'EMBED_LINKS',
    'ATTACH_FILES',
    'READ_MESSAGE_HISTORY',
    'MANAGE_CHANNELS',
    'MANAGE_ROLES',
    'MANAGE_WEBHOOKS',
    'MANAGE_MESSAGES',
    'MENTION_EVERYONE',
    // ...the rooms it has to write a pinned page in, and the voice rooms it opens
    'ADD_REACTIONS',
    'USE_EXTERNAL_EMOJIS',
    'CONNECT',
    'SPEAK',
    'STREAM',
    // ...only ever used by the optional community step (welcome screen and the rules channel pointer)
    'MANAGE_GUILD',
    // ----------------------------------------------- and the ones it needs in order to *grant* them
    //
    // A bot may not create or edit a role holding a permission it does not itself hold. Discord
    // answers `Missing Permissions`, and because two more rooms hang off those roles, three refused
    // role writes cost five more steps. That is not a safer server, it is an unbuildable one: the
    // Keeper of the Realm and the Sentinel are the roles that are *supposed* to carry moderation.
    //
    // This list is the union of every permission in `ROLES` and every permission any `ACCESS` class
    // grants, and `tools/check-discord.js` recomputes that union and fails if this array misses one,
    // so the invite and the work cannot drift apart again.
    'MANAGE_THREADS',
    'KICK_MEMBERS',
    'BAN_MEMBERS',
    'MODERATE_MEMBERS',
    'MUTE_MEMBERS',
    'MOVE_MEMBERS',
    'VIEW_AUDIT_LOG',
    // ----------------------------------------------- and the one that made pinning possible at all
    'PIN_MESSAGES',
];

/**
 * The invite URL, and it grants exactly two things: the bot user, and the ability to register slash
 * commands. `applications.commands` is not optional here, because `/claim` is how a wallet becomes a
 * role and a bot that cannot register commands is a bot that can only watch.
 */
export function inviteUrl(clientId, permissions = BOT_PERMISSIONS) {
    if (!/^\d{5,25}$/.test(String(clientId || ''))) return null;
    return 'https://discord.com/oauth2/authorize'
        + `?client_id=${clientId}`
        + '&scope=bot%20applications.commands'
        + `&permissions=${permissionInteger(permissions)}`;
}

/* ---------------------------------------------------------------- the slash commands
 *
 * Registered as **guild** commands rather than global ones: global commands can take an hour to
 * appear, and this bot lives in one server. `/claim` takes the code the site shows; `/whoami` is the
 * one people will run when a role has not appeared yet.
 */

export const COMMANDS = [
    {
        name: 'claim',
        description: 'Link your wallet to this Discord account and pick up your roles',
        options: [
            {
                type: 3,
                name: 'code',
                description: 'The six character code from dungeonknights.io/points',
                required: true,
                min_length: 6,
                max_length: 6,
            },
        ],
    },
    {
        name: 'whoami',
        description: 'Show the wallet linked to this Discord account, and what it holds',
        options: [],
    },
];

/* --------------------------------------------------------------------------------- the plan
 *
 * `computePlan` is the whole reason this file exists twice over: once as the description above, once
 * as arithmetic over what the API reported. It is pure, so a test can hand it a hand-built guild and
 * assert the exact list of intentions, including the empty list.
 *
 * Matching is by **name**, not by id, because ids do not survive a server being rebuilt from a
 * template and names do. A channel is matched by name and type rather than by name alone, so a text
 * room called `general` and a voice room called `general` cannot be confused for each other.
 *
 * What it deliberately does not do: delete. If a channel exists that this file does not describe, it
 * is reported as extra and left alone. A setup tool that deletes what it did not create is a tool
 * that eats somebody's work the first time they get creative.
 */

export const PLAN_VERSION = 1;

function sameOverwrite(existing, spec, roleId) {
    const found = (existing || []).find((o) => String(o.id) === String(roleId) && Number(o.type) === 0);
    if (!found && !spec) return true;
    if (!found || !spec) return false;
    return BigInt(found.allow || '0') === permissionsOf(spec.allow)
        && BigInt(found.deny || '0') === permissionsOf(spec.deny);
}

/**
 * The overwrites a channel needs, as role **keys** — the executor turns keys into ids, because a plan
 * computed before the roles exist cannot know them.
 */
export function overwriteSpecs(accessKey, structure = SERVER) {
    const access = ACCESS[accessKey];
    if (!access) throw new Error(`unknown access class "${accessKey}"`);
    const specs = [];
    if (access.everyone) specs.push({ roleKey: 'everyone', allow: access.everyone.allow || [], deny: access.everyone.deny || [] });
    for (const [roleKey, spec] of Object.entries(access.roles || {})) {
        specs.push({ roleKey, allow: spec.allow || [], deny: spec.deny || [] });
    }
    return specs;
}

/**
 * The bot's own role, as an overwrite.
 *
 * A pinned page is written by the bot into a room the same file just made read-only, and read-only
 * denies `SEND_MESSAGES` to `@everyone`. Discord resolves overwrites role by role, so a bot holding a
 * role with no allow in that channel keeps the deny and cannot post the page it was told to write.
 * This first shipped as a live failure: four rooms were built, their pages were refused, and the
 * second plan could never be empty.
 *
 * The role is not in `ROLES` because nobody is ever assigned it — it is the managed role Discord made
 * when the bot was invited — and the builder resolves it the same way it resolves the others. The
 * grant is deliberately narrow: view, post, and the formatting a pinned page needs. It is not a way
 * around the room's rules, and it does not touch `MANAGE_*`.
 */
/** True when an access class hides the room from `@everyone` rather than only locking it. */
export function hiddenFromEveryone(accessKey, structure = SERVER) {
    const access = (structure.ACCESS || ACCESS)[accessKey];
    return Boolean(access?.everyone?.deny?.includes('VIEW_CHANNEL'));
}

/**
 * The overwrites a channel needs.
 *
 * There used to be a second, additive spec here for the bot's **own** managed role, because a room
 * hidden from `@everyone` has to grant the bot sight of itself or the builder cannot even rename what
 * it made. Discord accepts that overwrite only in a channel *create* and refuses a later `PUT` with
 * `50013`, which is why four rooms had to be deleted and rebuilt to pick it up, and why a fresh build
 * and an existing server behaved differently.
 *
 * That is gone. The bot wears `Chronicler`, a role below its own, and every hidden class grants it —
 * a role below the bot is writable like any other, so the grant travels in the file and lands on a
 * room that already exists. The old spec could only ever be written once, which is not a property a
 * declarative file can live with.
 */
export function channelOverwrites(channel, structure = SERVER) {
    return overwriteSpecs(channel.access, structure);
}

/** Every permission bit an access class can hand out, as one integer. Used by the invite check. */
export function accessPermissionNames(accessKey) {
    const access = ACCESS[accessKey];
    if (!access) throw new Error(`unknown access class "${accessKey}"`);
    const names = new Set();
    const collect = (spec) => {
        for (const name of spec?.allow || []) names.add(name);
    };
    collect(access.everyone);
    for (const spec of Object.values(access.roles || {})) collect(spec);
    return [...names];
}

export function computePlan({ guild, server = SERVER, options = {} } = {}) {
    if (!guild || typeof guild !== 'object') throw new Error('computePlan needs what the API reported');
    const steps = [];
    const blockers = [];
    const kept = [];
    const extra = [];

    const roles = Array.isArray(guild.roles) ? guild.roles : [];
    const channels = Array.isArray(guild.channels) ? guild.channels : [];
    const emojis = Array.isArray(guild.emojis) ? guild.emojis : [];
    // The server's boost level, which is the only thing that decides whether a role icon can be
    // written at all — custom role icons are a Level 2 perk, and below that Discord refuses the call
    // with a bare "needs more boosts" rather than anything about permissions. Read here rather than in
    // the executor so a plan computed against an unboosted server already knows not to promise one.
    const boostTier = Number(guild.premiumTier ?? 0);
    const iconsHeldBack = [];
    const byName = (list, name, type = null) => list.find((item) => String(item.name || '').toLowerCase() === name.toLowerCase()
        && (type === null || type === undefined || Number(item.type) === type));

    // --------------------------------------------------------------- roles
    const roleIds = {};
    const everyone = byName(roles, '@everyone');
    if (everyone) roleIds.everyone = String(everyone.id);
    else blockers.push({
        key: 'everyone-role',
        why: 'the guild has no @everyone role, so channel overwrites cannot name it',
        fix: 'this means the guild id is wrong, or the role list was not read',
    });

    // The bot's own managed role, which is named by exactly one overwrite (the rooms the bot has to
    // administer, and the rooms whose pinned page it writes itself). Resolved here rather than in the
    // executor so a plan and the read-back of that plan agree on what the channel should contain.
    //
    // Note the indirection: `guild.bot.id` is the bot **user**, and Discord gives the managed role its
    // own snowflake — on the live server the two are different numbers, and writing an overwrite for
    // the user id is a write for a role that does not exist. The role is found by the tag Discord puts
    // on it, which is the only field that actually points back at the application.
    const botRole = guild.bot?.id
        ? roles.find((role) => String(role.tags?.bot_id || '') === String(guild.bot.id))
        : null;
    if (botRole) roleIds.bot = String(botRole.id);
    else if (guild.bot?.id) blockers.push({
        key: 'bot-role',
        why: 'the bot is in the server but its managed role could not be picked out of the role list',
        fix: 're-invite the bot, or check that the guild id is the one the bot was invited to',
    });

    for (const role of ROLES) {
        const existing = byName(roles, role.name);
        const body = {
            name: role.name,
            color: Number.parseInt(role.color.replace('#', ''), 16),
            hoist: role.hoist === true,
            mentionable: role.mentionable === true,
            permissions: permissionInteger(role.permissions),
        };
        // `{ file }` rather than a data URI: this module never reads a file and never talks to
        // Discord, and the executor is where both happen. A role that cannot wear one yet is counted
        // and reported once below, not made into a step that can never land.
        const wantsIcon = Boolean(role.icon) && boostTier >= ROLE_ICON_BOOST_TIER;
        if (role.icon && !wantsIcon) iconsHeldBack.push(role.name);
        if (wantsIcon) body.icon = { file: role.icon };
        if (!existing) {
            steps.push({ kind: 'create-role', key: role.key, body });
            continue;
        }
        roleIds[role.key] = String(existing.id);
        if (existing.managed === true) {
            // A role Discord owns (a bot's own role, a booster role). Editing it is either refused or
            // greasy, and matching it was luck: say so instead of writing to it.
            kept.push({ key: role.key, why: `a managed role already uses the name "${role.name}", left untouched` });
            blockers.push({
                key: `role-managed-${role.key}`,
                why: `"${role.name}" is managed by an integration, so the sync cannot grant it`,
                fix: `rename the managed role, or rename the one this file asks for`,
            });
            continue;
        }
        const changes = {};
        if (Number(existing.color ?? 0) !== body.color) changes.color = body.color;
        if (Boolean(existing.hoist) !== body.hoist) changes.hoist = body.hoist;
        if (Boolean(existing.mentionable) !== body.mentionable) changes.mentionable = body.mentionable;
        if (BigInt(existing.permissions || '0') !== BigInt(body.permissions)) changes.permissions = body.permissions;
        // Presence, not content: Discord hashes an upload server-side and gives back a hash, so there
        // is nothing on this side to compare against. A role that already wears an icon keeps it, and
        // that is the same bargain the emoji and the pinned pages make.
        if (wantsIcon && !existing.icon) changes.icon = body.icon;
        if (Object.keys(changes).length) steps.push({ kind: 'update-role', key: role.key, id: String(existing.id), body: changes });
        else kept.push({ key: role.key, why: 'already matches' });
    }

    // One blocker for all of them rather than eight: this is a fact about the server's boost level,
    // not about any one role, and eight identical lines would read like eight separate problems.
    if (iconsHeldBack.length) {
        blockers.push({
            key: 'role-icons-need-boosts',
            why: `Discord will not accept a role icon on a server that has not boosted: it answers 403 "This server needs more boosts to perform this action", so the ${iconsHeldBack.length} icon(s) this file names are held back (boost tier ${boostTier}, and custom role icons are a level ${ROLE_ICON_BOOST_TIER} perk)`,
            fix: 'nothing to change here. The pictures are already made, in public/assets/discord/roles/, and land on the next build once the server reaches that level. The roles keep their colours meanwhile',
        });
    }

    // ------------------------------------------------------------- the bot's own key
    //
    // Granted like anybody else's role, rather than as a channel overwrite naming the bot's own managed
    // role — which Discord accepts once, in a channel create, and refuses afterwards with `50013`.
    // `guild.bot.roles` comes off the member record, so this is a diff rather than a hope; on a fresh
    // build the role does not exist yet, so the step carries the role *key* and the executor resolves
    // the id its own create just produced.
    const botRoleIds = (guild.bot?.roles || []).map(String);
    const chroniclerId = roleIds.chronicler || null;
    if (guild.bot?.id && !(chroniclerId && botRoleIds.includes(chroniclerId))) {
        steps.push({
            kind: 'assign-bot-role',
            key: 'bot:chronicler',
            userId: String(guild.bot.id),
            roleKey: 'chronicler',
            reason: 'the bot wears its own role, which is what lets it see a room it hid from everyone else',
        });
    }

    // ------------------------------------------------------------------- positions
    //
    // Everything this file creates has to sit **below the bot's own role**, because that is the only
    // band a bot may reorder or grant from. The band starts just under the bot and runs down, so the
    // file's order is preserved. A server where that band does not exist gets a blocker with the one
    // manual fix Discord actually permits (drag the bot's role up), rather than a half-built server.
    const botPosition = Number(guild.bot?.position);
    const startPositions = options.startPositions !== false;
    if (startPositions) {
        const ordered = [...ROLES].filter((role) => {
            const existing = byName(roles, role.name);
            return !existing || existing.managed !== true;
        });
        if (!Number.isFinite(botPosition)) {
            blockers.push({
                key: 'bot-position',
                why: 'the bot\'s own role could not be found in the guild role list',
                fix: 're-invite the bot, or check the guild id',
            });
        } else {
            // The band is made to fit rather than the file trimmed to the band. Discord lets a bot
            // reorder roles below its own highest, and moving **its own** role up is accepted too
            // (verified on this server: a PATCH naming the bot's role moved it from 1 to 9), so a
            // server with no spare slot does not need a human with a mouse. It is refused when
            // something else sits above the bot, and that refusal is reported by the executor rather
            // than papered over.
            const top = Math.max(botPosition, ordered.length + 1);
            const needsBotMove = top > botPosition;
            if (needsBotMove && !roleIds.bot) {
                blockers.push({
                    key: 'bot-role-too-low',
                    why: `${ordered.length} roles need positions 1 to ${top - 1}, the bot's role sits at ${botPosition}, and its own role was not in the role list to move up`,
                    fix: 'Server Settings > Roles, drag the bot\'s role above every role it has to manage, then run --apply again',
                });
            } else {
                const desired = ordered.map((role, index) => ({
                    key: role.key,
                    position: top - 1 - index,
                }));
                // A role that does not exist yet counts as misplaced, because Discord gives every new
                // role the same position and the ordering therefore has to happen *after* the creates
                // in this same run. Leaving it out is how a freshly built server ends up with ten roles
                // stacked in one band and a second plan that suddenly wants to reorder them.
                const misplaced = desired.filter((entry) => {
                    const existing = byName(roles, ROLES.find((r) => r.key === entry.key).name);
                    return !existing || Number(existing.position) !== entry.position;
                });
                if (misplaced.length || needsBotMove) {
                    const positions = desired.map((entry) => ({ key: entry.key, position: entry.position }));
                    if (needsBotMove) positions.push({ key: 'bot', position: top });
                    steps.push({
                        kind: 'order-roles',
                        positions,
                        reason: `roles are placed just below the bot's role (${top}), in the order this file lists them`
                            + (needsBotMove ? `; the bot's own role moves up to ${top} to make room, which Discord allows while nothing sits above it` : ''),
                    });
                }
            }
        }
    }

    // ------------------------------------------------------------------- categories and channels
    const channelIds = {};
    for (const channel of allChannels(server)) {
        const type = CHANNEL_TYPE[channel.type];
        const existing = byName(channels, channel.name, type);
        if (!existing) {
            steps.push({
                kind: channel.type === 'category' ? 'create-category' : 'create-channel',
                key: channel.key,
                body: {
                    name: channel.name,
                    type,
                    parentKey: channel.category || null,
                    topic: channel.type === 'text' ? channel.topic : undefined,
                    overwrites: channelOverwrites(channel, server),
                },
            });
            continue;
        }
        channelIds[channel.key] = String(existing.id);
        const changes = {};
        if (channel.category && String(existing.parent_id || '') !== String(channelIds[channel.category] || '')) {
            // The parent may be created in this same run; the executor resolves parents in order, so
            // a category missing an id here means it is being created and the child follows it.
            if (channelIds[channel.category]) changes.parent_id = channelIds[channel.category];
            else changes.parent_id = { from: channel.category };
        }
        if (channel.type === 'text' && String(existing.topic || '') !== channel.topic) changes.topic = channel.topic;
        if (Object.keys(changes).length) steps.push({ kind: 'update-channel', key: channel.key, id: String(existing.id), body: changes });

        // Overwrites drift one role at a time, and Discord has an endpoint per overwrite, so only the
        // ones that are actually wrong are written. A blanket rewrite of the channel's overwrite list
        // would take a hand-made member overwrite with it.
        for (const spec of channelOverwrites(channel, server)) {
            const roleId = spec.roleKey === 'everyone' ? roleIds.everyone : (roleIds[spec.roleKey] || null);
            if (!roleId) continue; // the role is being created in this run; its overwrite lands with the create step
            if (sameOverwrite(existing.permission_overwrites, spec, roleId)) continue;
            steps.push({
                kind: 'set-overwrite',
                key: `${channel.key}:${spec.roleKey}`,
                channelId: String(existing.id),
                roleId,
                allow: permissionInteger(spec.allow),
                deny: permissionInteger(spec.deny),
            });
        }
    }

    // ------------------------------------------------------------------------------- the emoji
    //
    // Created once and then left alone, which is the difference between a server that a person can
    // make their own and a tool that overwrites them every run. A name that exists is kept even if the
    // picture behind it changed — to change one, delete it in Discord and run again.
    const missingEmoji = EMOJI.filter((emoji) => !emojis.some((entry) => String(entry.name) === emoji.name));
    for (const emoji of missingEmoji) {
        steps.push({ kind: 'create-emoji', key: `emoji:${emoji.name}`, name: emoji.name, file: emoji.file });
    }
    if (!missingEmoji.length) {
        kept.push({ key: 'emoji', why: `all ${EMOJI.length} are already on the server, left as they are (delete one in Discord to replace its picture)` });
    }

    // ------------------------------------------------------------------------------- webhooks
    for (const [slot, wanted] of Object.entries(WEBHOOKS)) {
        const channelId = channelIds[wanted.channelKey];
        const hooks = (guild.webhooks || []).filter((hook) => String(hook.channel_id) === String(channelId));
        const existing = hooks.find((hook) => String(hook.name) === wanted.name);
        if (existing) {
            kept.push({ key: `webhook:${slot}`, why: `already exists in #${wanted.channelKey}` });
            continue;
        }
        if (!channelId) {
            steps.push({ kind: 'create-webhook', key: `webhook:${slot}`, slot, channelKey: wanted.channelKey, name: wanted.name, deferred: true });
            continue;
        }
        steps.push({ kind: 'create-webhook', key: `webhook:${slot}`, slot, channelId, channelKey: wanted.channelKey, name: wanted.name });
    }

    // -------------------------------------------------------------------------- pinned pages
    for (const channel of allChannels(server)) {
        if (!channel.content) continue;
        const channelId = channelIds[channel.key];
        const marker = `v${PLAN_VERSION} · ${channel.content}`;
        const pins = (guild.pins || []).filter((pin) => String(pin.channel_id) === String(channelId));
        const existing = pins.find((pin) => String(pin.footer || '').includes(marker));
        if (existing && !options.refreshContent) {
            kept.push({ key: `content:${channel.content}`, why: 'already pinned, left as written (use --refresh-content to overwrite)' });
            continue;
        }
        if (existing) steps.push({ kind: 'update-content', key: `content:${channel.content}`, channelId, messageId: String(existing.id), contentKey: channel.content });
        else steps.push({ kind: 'post-content', key: `content:${channel.content}`, channelKey: channel.key, channelId, contentKey: channel.content });
    }

    // ------------------------------------------------------------------------- the commands
    const wantedCommands = COMMANDS.map((command) => command.name).sort();
    const currentCommands = (guild.commands || []).map((command) => String(command.name)).sort();
    if (wantedCommands.join(',') !== currentCommands.join(',')) {
        steps.push({ kind: 'sync-commands', desired: COMMANDS, present: currentCommands, reason: 'the guild command list is different from the one this file declares' });
    }

    // ------------------------------------------------------------------------------- extras
    for (const channel of channels) {
        const type = Number(channel.type);
        if (type !== CHANNEL_TYPE.text && type !== CHANNEL_TYPE.voice && type !== CHANNEL_TYPE.category) continue;
        if (byName(allChannels(server).map((c) => ({ name: c.name, type: CHANNEL_TYPE[c.type] })), channel.name, type)) continue;
        extra.push({ name: channel.name, type });
    }
    // Emoji somebody else added are reported for the same reason a channel is: this file describes a
    // server, not every picture in it, and the tool never deletes what it did not create.
    for (const emoji of emojis) {
        if (EMOJI.some((entry) => entry.name === String(emoji.name))) continue;
        extra.push({ name: String(emoji.name), type: 'emoji' });
    }

    return {
        steps,
        blockers,
        kept,
        extra,
        /**
         * The role ids the plan already resolved, by key.
         *
         * Carried out of the plan because a channel is created with its overwrites **inline**, and
         * an overwrite needs an id: a role that already existed and needed no changes has no step of
         * its own, so without this the executor would build its channels with no `@everyone`
         * overwrite at all and the next plan would want to write all of them again.
         */
        roleIds: { ...roleIds },
        /**
         * The ids of channels and categories that already existed, for the same reason as `roleIds`.
         *
         * A child is created with `parent_id` because Discord will not accept a category by name, and
         * the executor only learns the id of a parent it *created* in the same run. Without this, a room
         * deleted and rebuilt under a category that already exists fails with "its category … was not
         * created", which is what happened when four rooms were rebuilt to pick up the bot's own
         * overwrite. Passing them through is what makes a rebuild work on an otherwise finished server.
         */
        channelIds: { ...channelIds },
        /** True when applying this plan would make no API write at all. */
        quiet: steps.length === 0,
        counts: {
            create: steps.filter((s) => s.kind.startsWith('create')).length,
            update: steps.filter((s) => s.kind.startsWith('update') || s.kind.startsWith('set-')).length,
            total: steps.length,
        },
    };
}

/** A one-line-per-step summary, for a person reading a terminal. Never includes a token. */
export function describePlan(plan) {
    const lines = [];
    for (const step of plan.steps) {
        const body = step.body || {};
        // An ordering step has no name of its own, and printing `undefined` next to a write is how a
        // reader stops trusting the output. It says how many roles it is placing instead.
        const label = body.name || step.name || step.key
            || (Array.isArray(step.positions) ? `${step.positions.length} roles` : step.kind);
        lines.push(`write  ${step.kind.padEnd(15)} ${label}${step.kind === 'set-overwrite' ? ` (${step.allow}/${step.deny})` : ''}`);
    }
    for (const keep of plan.kept) lines.push(`keep   ${keep.key.padEnd(15)} ${keep.why}`);
    for (const hole of plan.blockers) lines.push(`BLOCK  ${hole.key.padEnd(15)} ${hole.why}`);
    if (plan.extra.length) {
        const emojiCount = plan.extra.filter((item) => item.type === 'emoji').length;
        const channelCount = plan.extra.length - emojiCount;
        const parts = [];
        if (channelCount) parts.push(`${channelCount} channel(s)`);
        if (emojiCount) parts.push(`${emojiCount} emoji`);
        lines.push(`note   ${parts.join(' and ')} exist that this file does not describe, and they are left alone`);
    }
    return lines;
}
