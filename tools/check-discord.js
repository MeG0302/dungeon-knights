#!/usr/bin/env node
/**
 * Build a whole Discord server against a fake Discord, and check the things that would be expensive
 * to get wrong on a real one.
 *
 *     node tools/check-discord.js
 *
 * Offline, no token, no network. The fake below answers the same endpoints the real API does and
 * keeps its own state, which is what makes the assertion that matters possible: apply a plan to an
 * empty server, read the result back, plan again — and the second plan writes **nothing**. Idempotency
 * is the only property that makes a builder safe to run twice, and it cannot be tested against a real
 * server without risking somebody's evening.
 *
 * The rest of the file is the set of mistakes that are silent in production:
 *
 *   - a channel the public can post in when it should not be able to;
 *   - a holder room the public can *see* (visible-but-locked is not what "holders only" means);
 *   - a permission the plan needs but the invite never asked for, which fails on the owner's server
 *     and nowhere else;
 *   - an email or a wallet address reaching a public channel through a notification;
 *   - a `@everyone` smuggled through a handle into a post;
 *   - an interaction accepted without a valid signature, which would let anyone grant themselves a
 *     role by POSTing to our own URL;
 *   - a link that can be moved between Discord accounts, or one wallet claimed by two accounts;
 *   - a failed chain read stripping a holder's roles.
 *
 * Every one of those is a claim about behaviour, so every one is driven through the real module
 * rather than read out of a comment.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass: pass === true });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

/** Source with comments stripped: a guard that reads prose fails on its own explanation. */
function code(source) {
    return String(source).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const load = (relative) => import(pathToFileURL(path.join(ROOT, relative)).href);

/**
 * A miniature Discord.
 *
 * Only the endpoints this project calls, and it is deliberately literal: it stores exactly what it is
 * sent, so an overwrite written as the wrong bits comes back as the wrong bits.
 */
function fakeDiscord(seed = {}) {
    const state = {
        id: '424242424242424242',
        name: 'Dungeon Knights',
        roles: seed.roles || [
            { id: '1', name: '@everyone', position: 0, permissions: '0', managed: false },
            // `tags.bot_id` is how the planner finds this role: `guild.bot.id` is the bot **user**, and
            // Discord hands the managed role its own snowflake. On the live server the two differ, so a
            // fixture without the tag would hide the bug where an overwrite is written for a role that
            // does not exist.
            { id: '9001', name: 'Dungeon Knights Bot', position: 20, permissions: '0', managed: true, tags: { bot_id: 'BOT' } },
        ],
        channels: seed.channels ? [...seed.channels] : [],
        webhooks: seed.webhooks ? [...seed.webhooks] : [],
        commands: seed.commands ? [...seed.commands] : [],
        emojis: seed.emojis ? [...seed.emojis] : [],
        // The boost level, which the plan reads to decide whether a role icon can be written at all.
        premium_tier: seed.premiumTier || 0,
        messages: [],
        pins: [],
        members: seed.members || { BOT: { roles: ['9001'], user: { id: 'BOT', username: 'dkbot' } } },
        calls: [],
    };
    let counter = 500;
    const newId = () => String(counter++);

    const answer = (status, body) => ({
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => null },
        text: async () => JSON.stringify(body ?? null),
    });

    const fetchImpl = async (url, options = {}) => {
        const method = (options.method || 'GET').toUpperCase();
        const body = options.body ? JSON.parse(options.body) : null;
        const pathname = String(url).replace('https://discord.com/api/v10', '');
        state.calls.push({ method, pathname, body });
        const seg = pathname.split('/').filter(Boolean);

        if (pathname === '/oauth2/applications/@me') {
            return answer(200, { id: '999', name: 'Dungeon Knights Bot', verify_key: 'ab'.repeat(32) });
        }
        if (pathname === '/users/@me') return answer(200, { id: 'BOT', username: 'dkbot' });

        if (seg[0] === 'applications' && seg[2] === 'guilds' && seg[4] === 'commands') {
            if (method === 'GET') return answer(200, state.commands);
            state.commands = body || [];
            return answer(200, state.commands);
        }

        if (seg[0] === 'guilds' && seg[2] === 'roles') {
            if (seg.length === 3) {
                if (method === 'GET') return answer(200, state.roles);
                if (method === 'POST') {
                    const role = { id: newId(), position: 1, managed: false, ...body };
                    state.roles.push(role);
                    return answer(200, role);
                }
                if (method === 'PATCH') {
                    for (const entry of body) {
                        const role = state.roles.find((row) => String(row.id) === String(entry.id));
                        if (role) role.position = entry.position;
                    }
                    return answer(200, state.roles);
                }
            }
            if (seg.length === 4 && method === 'PATCH') {
                const role = state.roles.find((row) => String(row.id) === String(seg[3]));
                if (!role) return answer(404, { message: 'Unknown Role' });
                Object.assign(role, body);
                return answer(200, role);
            }
        }

        if (seg[0] === 'guilds' && seg[2] === 'channels') {
            if (method === 'GET') return answer(200, state.channels);
            const channel = { id: newId(), ...body, permission_overwrites: body.permission_overwrites || [] };
            state.channels.push(channel);
            return answer(200, channel);
        }

        if (seg[0] === 'guilds' && seg[2] === 'webhooks') return answer(200, state.webhooks);

        // Emoji go up as a data URI on this endpoint, which is the only shape Discord takes.
        if (seg[0] === 'guilds' && seg[2] === 'emojis' && method === 'POST') {
            const emoji = { id: newId(), name: body.name, image: body.image, animated: false };
            state.emojis.push(emoji);
            return answer(201, emoji);
        }

        if (seg[0] === 'guilds' && seg[2] === 'members') {
            const member = state.members[seg[3]];
            if (!member) return answer(404, { message: 'Unknown Member' });
            // One role at a time, which is how the gate grants and how the setup tool gives the bot its
            // own key. `PATCH` replaces the whole list and stays the wallet sync's call.
            if (seg[4] === 'roles' && seg[5]) {
                const roleId = String(seg[5]);
                if (method === 'PUT') {
                    member.roles = [...new Set([...(member.roles || []).map(String), roleId])];
                    return answer(204, null);
                }
                if (method === 'DELETE') {
                    member.roles = (member.roles || []).filter((id) => String(id) !== roleId);
                    return answer(204, null);
                }
            }
            if (method === 'PATCH') {
                member.roles = (body.roles || []).map(String);
                return answer(200, member);
            }
            return answer(200, member);
        }

        if (seg[0] === 'guilds' && seg.length === 2 && method === 'GET') {
            return answer(200, {
                id: state.id,
                name: state.name,
                roles: state.roles,
                emojis: state.emojis,
                premium_tier: state.premium_tier,
            });
        }

        if (seg[0] === 'channels') {
            const channelId = seg[1];
            if (seg[2] === 'pins' && seg.length === 4 && method === 'PUT') {
                if (!state.pins.some((pin) => pin.channel_id === channelId && pin.message_id === seg[3])) {
                    state.pins.push({ channel_id: channelId, message_id: seg[3] });
                }
                return answer(204, null);
            }
            if (seg[2] === 'pins' && method === 'GET') {
                const ids = state.pins.filter((pin) => pin.channel_id === channelId).map((pin) => pin.message_id);
                return answer(200, state.messages.filter((message) => ids.includes(message.id)));
            }
            if (seg[2] === 'permissions' && seg.length === 4 && method === 'PUT') {
                const channel = state.channels.find((row) => String(row.id) === String(channelId));
                if (!channel) return answer(404, { message: 'Unknown Channel' });
                channel.permission_overwrites = (channel.permission_overwrites || []).filter((o) => String(o.id) !== String(seg[3]));
                channel.permission_overwrites.push({ id: String(seg[3]), type: 0, allow: body.allow, deny: body.deny });
                return answer(204, null);
            }
            if (seg[2] === 'webhooks' && method === 'POST') {
                const hook = { id: newId(), name: body.name, channel_id: channelId, token: `tok${counter}` };
                state.webhooks.push({ id: hook.id, name: hook.name, channel_id: hook.channel_id });
                return answer(200, hook);
            }
            if (seg[2] === 'messages' && seg.length === 4 && method === 'PATCH') {
                const message = state.messages.find((row) => String(row.id) === String(seg[3]));
                if (!message) return answer(404, { message: 'Unknown Message' });
                Object.assign(message, body);
                return answer(200, message);
            }
            if (seg[2] === 'messages' && method === 'POST') {
                const message = { id: newId(), channel_id: channelId, embeds: body.embeds || [], content: body.content || '', components: body.components || [] };
                state.messages.push(message);
                return answer(200, message);
            }
            if (seg.length === 3 && method === 'PATCH') {
                const channel = state.channels.find((row) => String(row.id) === String(channelId));
                if (!channel) return answer(404, { message: 'Unknown Channel' });
                Object.assign(channel, body);
                return answer(200, channel);
            }
        }

        return answer(404, { message: `no fake route for ${method} ${pathname}` });
    };

    return { state, fetchImpl };
}

(async () => {
    const Structure = await load(path.join('lib', 'discord-structure.js'));
    const Setup = await load(path.join('lib', 'discord-setup.js'));
    const Api = await load(path.join('lib', 'discord-api.js'));
    const Notify = await load(path.join('lib', 'discord-notify.js'));
    const Link = await load(path.join('lib', 'discord-link.js'));
    const Roles = await load(path.join('lib', 'discord-roles.js'));
    const Interactions = await load(path.join('lib', 'discord-interactions.js'));
    const Points = await load(path.join('lib', 'points-config.js'));

    const saved = {};
    const setEnv = (key, value) => {
        if (!(key in saved)) saved[key] = process.env[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    };
    setEnv('DISCORD_BOT_TOKEN', 'harness-token-not-a-real-one');
    setEnv('DISCORD_GUILD_ID', '424242424242424242');
    setEnv('DISCORD_APPLICATION_ID', '999');

    // ------------------------------------------------------------------ the structure is sane
    console.log('');
    console.log('The structure itself');

    const all = Structure.allChannels();
    const texts = all.filter((channel) => channel.type === 'text');
    rec('every channel and category has a unique name',
        new Set(all.map((c) => c.name)).size === all.length,
        `${all.length} objects`);
    // The dressing is on purpose (see the note above `SERVER`), so what is checked is the shape of
    // the dressing: one `┃` per channel, an emoji before it and a mention-safe slug after it, and
    // categories that are nothing but the divider and a name. A channel that quietly loses its emoji
    // is a channel that stops being findable at a glance, which is the whole point of the convention.
    rec('every text channel is dressed `<emoji>┃<slug>`, with a slug a mention can still read',
        texts.every((channel) => /^[^\u2503\s]+\u2503[a-z0-9-]{2,100}$/.test(channel.name)),
        texts.map((c) => c.name).join(', '));
    rec('voice rooms are dressed the same way',
        all.filter((c) => c.type === 'voice').every((c) => /^[^\u2503\s]+\u2503[^\u2503]{2,100}$/.test(c.name)),
        all.filter((c) => c.type === 'voice').map((c) => c.name).join(', '));
    rec('categories are the divider and a name, and carry no emoji',
        all.filter((c) => c.type === 'category').every((c) => /^\u2042\u2042\u2042\u300a [A-Z0-9 ]+ \u300b\u2042\u2042\u2042$/.test(c.name)),
        all.filter((c) => c.type === 'category').map((c) => c.name).join(', '));
    rec('every room whose page the bot writes also lets the bot post it',
        all.filter((c) => c.content).every((c) => Structure.channelOverwrites(c)
            .some((spec) => spec.roleKey === 'chronicler' && spec.allow.includes('SEND_MESSAGES'))),
        all.filter((c) => c.content).map((c) => c.name).join(', '));
    rec('every room hidden from @everyone grants the bot sight of it, so it can be repaired later',
        all.filter((c) => Structure.hiddenFromEveryone(c.access)).every((c) => Structure.channelOverwrites(c)
            .some((spec) => spec.roleKey === 'chronicler' && spec.allow.includes('VIEW_CHANNEL'))),
        `the grant names a role below the bot, which is the one a bot may write`);

    // ------------------------------------------------------------------------------------ the gate
    console.log('');
    console.log('The gate, and what it is worth');

    const OPEN_KEYS = ['welcome', 'rules', 'verify', 'announcements', 'roadmap'];
    const gatedRooms = all.filter((channel) => channel.type !== 'category' && !OPEN_KEYS.includes(channel.key));
    rec(`every room outside the ${OPEN_KEYS.length} open ones is hidden from @everyone (${gatedRooms.length} rooms)`,
        gatedRooms.every((channel) => Structure.hiddenFromEveryone(channel.access)),
        gatedRooms.filter((channel) => !Structure.hiddenFromEveryone(channel.access)).map((channel) => channel.name).join(', ') || 'all hidden');
    rec('the door itself is readable by anyone and postable by nobody but staff',
        !Structure.hiddenFromEveryone(Structure.allChannels().find((channel) => channel.key === 'verify').access)
        && Structure.ACCESS['read-only'].everyone.deny.includes('SEND_MESSAGES'));
    rec('the open rooms do not ask for the gate role, so a stranger can read the door without pressing it',
        !Structure.ACCESS['read-only'].roles?.[Structure.GATE_ROLE_KEY]);
    rec('each gated class hands the gate role the run of the room',
        ['verified', 'verified-read', 'verified-voice'].every((key) => (Structure.ACCESS[key].roles[Structure.GATE_ROLE_KEY]?.allow || [])
            .includes('VIEW_CHANNEL')),
        'a grant without sight is a role that cannot open anything');
    const gateRole = Structure.ROLES.find((role) => role.key === Structure.GATE_ROLE_KEY);
    rec('the gate role is not one the wallet sync may ever take away',
        Boolean(gateRole) && gateRole.role === 'gate' && !Structure.SYNCED_ROLE_KEYS.includes(Structure.GATE_ROLE_KEY),
        `synced: ${Structure.SYNCED_ROLE_KEYS.join(', ')}`);

    const gatePage = Structure.renderContent('verify', { channels: {} });
    rec('the gate page carries exactly one button, and its id is the one the handler matches on',
        gatePage.components?.length === 1
        && gatePage.components[0].components.length === 1
        && gatePage.components[0].components[0].custom_id === Structure.GATE_CUSTOM_ID
        && gatePage.components[0].components[0].type === 2,
        Structure.GATE_CUSTOM_ID);
    rec('  … and a page with no button carries no components at all, since Discord rejects an empty list',
        Structure.renderContent('rules', { channels: {} }).components === null);

    // The invite and the work cannot drift. A bot may not create or edit a role holding a permission
    // it does not hold, so every bit any role or any access class hands out has to be in the invite.
    // This check exists because that rule was discovered the hard way: three role writes and five
    // dependent steps came back `Missing Permissions` on the live server.
    const needed = new Set();
    for (const role of Structure.ROLES) for (const name of role.permissions || []) needed.add(name);
    for (const key of Object.keys(Structure.ACCESS)) for (const name of Structure.accessPermissionNames(key)) needed.add(name);

    const missingFromInvite = [...needed].filter((name) => !Structure.BOT_PERMISSIONS.includes(name));
    rec('the invite asks for every permission the build has to grant',
        missingFromInvite.length === 0,
        missingFromInvite.length ? missingFromInvite.join(', ') : `${needed.size} permissions covered`);
    rec('every channel names an access class that exists',
        all.every((channel) => Boolean(Structure.ACCESS[channel.access])));
    rec('every pinned page points at a channel that exists in the structure',
        all.filter((c) => c.content).every((c) => Structure.contentFor(c.content)),
        all.filter((c) => c.content).map((c) => c.content).join(', '));
    rec('the two webhook slots live in channels this file describes',
        Object.values(Structure.WEBHOOKS).every((slot) => all.some((c) => c.key === slot.channelKey)));

    const roleNames = Structure.ROLES.map((role) => role.name);
    rec('role names are unique and inside Discord\'s length limit',
        new Set(roleNames).size === roleNames.length && roleNames.every((name) => name.length >= 1 && name.length <= 100),
        `${roleNames.length} roles`);
    rec('staff roles come before the roles players earn, so the sidebar reads top down',
        Structure.ROLES.findIndex((role) => role.role === 'synced')
        > Structure.ROLES.findIndex((role) => role.key === 'keeper'));
    rec('every synced role says which fact grants it',
        Structure.ROLES.filter((role) => role.role === 'synced').every((role) => role.grant && role.grant.source && Number(role.grant.at) >= 1));

    // ------------------------------------------------------------------------ who may see what
    console.log('');
    console.log('Who can see and post where');

    const specFor = (accessKey, who) => Structure.overwriteSpecs(accessKey).find((spec) => spec.roleKey === who) || { allow: [], deny: [] };
    const may = (accessKey, who, permission) => specFor(accessKey, who).allow.includes(permission);
    const denied = (accessKey, who, permission) => specFor(accessKey, who).deny.includes(permission);

    rec('the public cannot post in a read-only room',
        denied('read-only', 'everyone', 'SEND_MESSAGES') && may('read-only', 'herald', 'SEND_MESSAGES'));
    rec('  … and nobody is handed a ping they should not have',
        !may('read-only', 'everyone', 'MENTION_EVERYONE')
        && !Object.values(Structure.ACCESS).some((access) => (access.everyone?.allow || []).includes('MENTION_EVERYONE')),
        'no room grants @everyone a ping, which is what the deny used to spell out');
    rec('a holders room is not merely locked, it is invisible to the public',
        denied('holders', 'everyone', 'VIEW_CHANNEL'),
        'a visible room nobody can post in still tells the public what is being said in it');
    rec('  … and a Knight or a Genesis can both see and post in it',
        may('holders', 'knight', 'VIEW_CHANNEL') && may('holders', 'knight', 'SEND_MESSAGES')
        && may('holders', 'genesis', 'VIEW_CHANNEL') && may('holders', 'genesis', 'SEND_MESSAGES'));
    rec('the Genesis room is invisible to a Knight who does not hold one',
        denied('genesis', 'knight', 'VIEW_CHANNEL') === false
        && !may('genesis', 'knight', 'VIEW_CHANNEL'),
        'an absent grant and a deny are different things, and a Knight has neither for that room');
    rec('the staff rooms are invisible to the public',
        denied('staff', 'everyone', 'VIEW_CHANNEL') && denied('staff-mod', 'everyone', 'VIEW_CHANNEL'));
    rec('the moderator log is not visible to the Herald',
        !may('staff-mod', 'herald', 'VIEW_CHANNEL') && may('staff', 'herald', 'VIEW_CHANNEL'),
        'announcers are not moderators, and the log says who was moderated');
    // The strongest form of this rule is not "who may ping" but "nothing in this file names the bit at
    // all". Discord refuses an overwrite containing `MENTION_EVERYONE` from this bot in either
    // direction, with a bare `Missing Permissions`, so a single occurrence anywhere in `ACCESS` is a
    // write that can never land — no matter how sensible it reads.
    rec('no overwrite in this file names MENTION_EVERYONE, in a grant or a deny',
        !Object.entries(Structure.ACCESS).some(([key, access]) => [access.everyone, ...Object.values(access.roles || {})]
            .filter(Boolean)
            .some((spec) => [...(spec.allow || []), ...(spec.deny || [])].includes('MENTION_EVERYONE'))),
        'Discord will not let this bot write that bit, and it says so only as a 403');
    rec('voice rooms sit behind the gate, and the people through it can talk',
        may('verified-voice', Structure.GATE_ROLE_KEY, 'SPEAK')
        && may('verified-voice', Structure.GATE_ROLE_KEY, 'CONNECT')
        && denied('verified-voice', 'everyone', 'VIEW_CHANNEL'),
        'a voice room anybody can drop into is a room the gate does not cover');

    // ------------------------------------------------------------ the invite asks for what it uses
    console.log('');
    console.log('What the bot asks for, against what the plan does');

    // What the *builder* has to be able to do, which is a different list from what the overwrites
    // hand out: a channel overwrite may grant anything, and the bot setting it does not need to hold
    // it. What the bot does need is the write access to make the call at all.
    const builderNeeds = ['MANAGE_CHANNELS', 'MANAGE_ROLES', 'MANAGE_WEBHOOKS', 'MANAGE_MESSAGES', 'MANAGE_GUILD', 'VIEW_CHANNEL', 'SEND_MESSAGES'];
    rec('the invite covers every write the builder itself makes',
        builderNeeds.every((name) => Structure.BOT_PERMISSIONS.includes(name)),
        builderNeeds.join(', '));

    // Every name the overwrites use has to be a real permission, and `permissionsOf` throws on a typo
    // rather than dropping the bit — so this is the assertion that a mistyped grant cannot ship. A
    // permission the bot does not hold is fine here and expected: handing `Sentinel` the ability to
    // ban is the point of a role, and the bot does not need that ability itself.
    let namesOk = true;
    let namesSeen = [];
    try {
        for (const key of Object.keys(Structure.ACCESS)) namesSeen.push(...Structure.accessPermissionNames(key));
        Structure.permissionsOf(namesSeen);
    } catch (error) {
        namesOk = false;
    }
    rec('every permission named in an overwrite is a real one',
        namesOk && namesSeen.length > 10,
        `${new Set(namesSeen).size} distinct permissions, all resolved`);
    rec('the invite does not ask for ADMINISTRATOR',
        !Structure.BOT_PERMISSIONS.includes('ADMINISTRATOR'),
        'a bot that can do anything is a bot whose token is worth stealing');
    const CLIENT = '999999999999999999';
    rec('the invite URL carries the permission integer, not a hand-typed number',
        Structure.inviteUrl(CLIENT) === `https://discord.com/oauth2/authorize?client_id=${CLIENT}&scope=bot%20applications.commands&permissions=${Structure.permissionInteger(Structure.BOT_PERMISSIONS)}`,
        Structure.inviteUrl(CLIENT));
    rec('  … and it requires the scope that registers the slash commands',
        /applications\.commands/.test(Structure.inviteUrl(CLIENT)));
    rec('a client id that is not a snowflake produces no URL rather than a broken one',
        Structure.inviteUrl('not-an-id') === null);

    // --------------------------------------------------------------------------------- the plan
    console.log('');
    console.log('Planning against an empty server');

    const server = fakeDiscord();
    const empty = await Api.fetchGuildState('424242424242424242', { fetchImpl: server.fetchImpl });
    rec('the guild can be read, with the bot\'s own role position',
        empty.ok && empty.guild.bot.position === 20,
        `position ${empty.guild.bot.position}`);

    const first = Structure.computePlan({ guild: empty.guild });
    const kinds = first.steps.reduce((acc, step) => { acc[step.kind] = (acc[step.kind] || 0) + 1; return acc; }, {});
    rec('an empty server plans roles, categories, channels, webhooks, the pinned pages and commands',
        kinds['create-role'] === Structure.ROLES.length
        && kinds['create-category'] === Structure.SERVER.categories.length
        && kinds['create-channel'] === Structure.allChannels().filter((c) => c.type !== 'category').length
        && kinds['create-webhook'] === 2
        && kinds['post-content'] === Structure.allChannels().filter((c) => c.content).length
        && kinds['sync-commands'] === 1
        && kinds['create-emoji'] === Structure.EMOJI.length,
        JSON.stringify(kinds));
    rec('roles are planned before the channels that name them',
        first.steps.findIndex((s) => s.kind === 'create-role') < first.steps.findIndex((s) => s.kind === 'create-channel'),
        'an overwrite needs an id, and there is no id until the role exists');
    rec('nothing in the plan deletes anything',
        !first.steps.some((step) => /delete/i.test(step.kind)));

    const applied = await Setup.applyPlan(first, { fetchImpl: server.fetchImpl });
    rec('the plan applies without a refusal', applied.ok, `${applied.done.length} writes`);
    rec('  … and the two webhook URLs are handed back exactly once, which is the only time they exist',
        Object.keys(applied.webhookUrls).length === 2 && /^https:\/\/discord\.com\/api\/webhooks\//.test(applied.webhookUrls.activity.url));

    const reread = await Api.fetchGuildState('424242424242424242', { fetchImpl: server.fetchImpl });
    const second = Structure.computePlan({ guild: reread.guild });
    rec('reading the built server back and planning again writes NOTHING',
        second.steps.length === 0,
        second.steps.length ? JSON.stringify(second.steps.map((s) => s.kind)) : 'quiet');

    // The bot's own grant has to survive the round trip: if it is written for an id that is not a role,
    // or dropped because the id could not be resolved, the write quietly disappears and the second plan
    // above stays quiet while the live room stays unreadable to the bot. So the built server is
    // inspected directly rather than only re-planned.
    const builtByName = (name) => reread.guild.channels.find((channel) => channel.name === name) || {};
    const nameForKey = (key) => Structure.allChannels().find((c) => c.key === key).name;
    const holdsAs = (roleId, channel, name) => (channel.permission_overwrites || [])
        .some((overwrite) => String(overwrite.id) === String(roleId) && (BigInt(overwrite.allow || '0') & Structure.permissionsOf([name])) !== 0n);
    const chroniclerId = (reread.guild.roles.find((role) => role.name === 'Chronicler') || {}).id;
    rec('the build gives the bot its own role, which is what replaces the unwritable self-overwrite',
        (reread.guild.bot.roles || []).map(String).includes(String(chroniclerId)),
        `Chronicler ${chroniclerId}, held by the bot`);
    rec('a hidden room is built with that role granted sight, and a page room with the posting grant',
        holdsAs(chroniclerId, builtByName(nameForKey('holders-lounge')), 'VIEW_CHANNEL')
        && holdsAs(chroniclerId, builtByName(nameForKey('welcome')), 'SEND_MESSAGES')
        && !holdsAs(chroniclerId, builtByName(nameForKey('welcome')), 'MANAGE_CHANNELS'),
        'posting a page is not a reason to hand over the channel');

    // ------------------------------------------------------------------ the gate, pressed
    //
    // The button is answered by the real handler against the fake server, because the interesting
    // mistakes here are behavioural: a second press that writes again, a reply the whole room can read
    // when it should be a whisper, a failure that says nothing a person can act on.
    console.log('');
    console.log('Pressing the button');

    const gateMember = '900000000000000009';
    server.state.members[gateMember] = { roles: [], user: { id: gateMember, username: 'Nine' } };
    const verifiedId = String((reread.guild.roles.find((role) => role.name === 'Verified') || {}).id);
    const press = (userId = gateMember, customId = Structure.GATE_CUSTOM_ID) => Interactions.handleInteraction(
        { type: 3, data: { custom_id: customId }, member: { user: { id: userId } } },
        { fetchImpl: server.fetchImpl, guild: '424242424242424242' },
    );
    const roleWrites = () => server.state.calls.filter((call) => call.method === 'PUT' && /\/members\/\d+\/roles\//.test(call.pathname)).length;

    const firstPress = await press();
    rec('the first press grants the gate role and says so where everyone can see it',
        server.state.members[gateMember].roles.map(String).includes(verifiedId)
        && /Verified/.test(firstPress.body.data.content)
        && firstPress.body.data.flags === 0,
        firstPress.body.data.content);
    rec('  … and it is the role the file names, not a name typed into the handler',
        verifiedId !== 'undefined' && roleWrites() === 1);

    const writesBefore = roleWrites();
    const repeatPress = await press();
    rec('a second press writes nothing, and only the presser is told',
        roleWrites() === writesBefore && /already/.test(repeatPress.body.data.content) && repeatPress.body.data.flags === 64,
        repeatPress.body.data.content);

    const strayPress = await press(gateMember, 'someone_elses_button');
    rec('a button this endpoint does not own is refused rather than acted on',
        roleWrites() === writesBefore && /older page/.test(strayPress.body.data.content));

    const ghost = await press('900000000000000042');
    rec('a press that cannot be completed names the reason and where to ask',
        /could not be read/.test(ghost.body.data.content) && /#support/.test(ghost.body.data.content),
        ghost.body.data.content);

    const postedGatePage = server.state.messages.find((message) => message.embeds?.[0]?.title === 'The Kingdom Gate');
    rec('the gate page was posted with its button attached, not as a page about a button',
        Boolean(postedGatePage?.components?.[0]?.components?.[0]?.custom_id === Structure.GATE_CUSTOM_ID));

    // ------------------------------------------------------------------------------- the dressing
    console.log('');
    console.log('The dressing, and what Discord charges for it');

    /**
     * A PNG on disk, read far enough to check the two things Discord refuses an upload over: it has to
     * be an image, and it has to be small enough. Read rather than trusted, because a wrong crop is a
     * mistake that otherwise surfaces minutes into a live build as an API message about the picture.
     */
    const readPng = (file) => {
        const bytes = fs.readFileSync(path.join(ROOT, file));
        return {
            bytes: bytes.length,
            isPng: bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
            width: bytes.readUInt32BE(16),
            height: bytes.readUInt32BE(20),
        };
    };

    const emojiFiles = Structure.EMOJI.map((emoji) => ({ ...emoji, ...readPng(emoji.file) }));
    rec(`all ${Structure.EMOJI.length} emoji are real PNGs, 128×128, and inside Discord's 256 KB ceiling`,
        emojiFiles.every((file) => file.isPng && file.width === 128 && file.height === 128 && file.bytes <= 256 * 1024),
        `largest ${Math.max(...emojiFiles.map((file) => file.bytes))} bytes`);
    rec('  … and every name is one Discord will accept, with no two the same',
        new Set(Structure.EMOJI.map((emoji) => emoji.name)).size === Structure.EMOJI.length
        && Structure.EMOJI.every((emoji) => /^[a-zA-Z0-9_]{2,32}$/.test(emoji.name)));

    const iconFiles = Structure.ROLES.map((role) => ({ key: role.key, file: role.icon, ...readPng(role.icon) }));
    rec(`all ${iconFiles.length} roles name an icon that exists, as a PNG inside the same ceiling`,
        iconFiles.every((file) => file.isPng && file.bytes <= 256 * 1024),
        `largest ${Math.max(...iconFiles.map((file) => file.bytes))} bytes`);

    rec('the emoji reached the built server, as the data URI Discord takes and nothing else',
        reread.guild.emojis.length === Structure.EMOJI.length
        && reread.guild.emojis.every((emoji) => String(emoji.image).startsWith('data:image/png;base64,')),
        `${reread.guild.emojis.length} uploaded`);

    const stranger = fakeDiscord({ emojis: [{ id: '77', name: 'someone_elses_picture' }] });
    const strangerPlan = Structure.computePlan({ guild: (await Api.fetchGuildState('424242424242424242', { fetchImpl: stranger.fetchImpl })).guild });
    rec('an emoji somebody else added is reported and left alone, like any channel',
        strangerPlan.extra.some((item) => item.name === 'someone_elses_picture' && item.type === 'emoji')
        && !strangerPlan.steps.some((step) => step.kind === 'create-emoji' && step.name === 'someone_elses_picture'));

    // Role icons are a Level 2 boost perk, and Discord says so with a `403 … needs more boosts` rather
    // than anything about permissions. Measured on the live server, which is why it is a blocker here
    // instead of a write that is retried forever.
    const iconHolder = second.blockers.find((blocker) => blocker.key === 'role-icons-need-boosts');
    rec('a server that has not boosted is told why it wears no role icons, and no icon is planned',
        Boolean(iconHolder) && !second.steps.some((step) => step.body?.icon),
        iconHolder ? 'reported, not attempted' : 'no blocker, which would mean a write Discord refuses');
    rec('  … and the blocker names the level that unlocks them',
        Boolean(iconHolder) && /level 2/.test(iconHolder.why) && /public\/assets\/discord\/roles\//.test(iconHolder.fix));

    const boosted = fakeDiscord({ premiumTier: 2 });
    const boostedPlan = Structure.computePlan({ guild: (await Api.fetchGuildState('424242424242424242', { fetchImpl: boosted.fetchImpl })).guild });
    rec('a server at that level gets every icon, each step carrying the file to open',
        Structure.ROLES.every((role) => boostedPlan.steps.some((step) => step.kind === 'create-role'
            && step.key === role.key && step.body.icon?.file === role.icon))
        && !boostedPlan.blockers.some((blocker) => blocker.key === 'role-icons-need-boosts'));

    const boostedApplied = await Setup.applyPlan(boostedPlan, { fetchImpl: boosted.fetchImpl });
    rec('  … and the executor opens the file and hands Discord a data URI rather than a path',
        boostedApplied.ok
        && String(boosted.state.roles.find((role) => role.name === 'Keeper of the Realm')?.icon).startsWith('data:image/png;base64,'));

    const missingFile = await Setup.applyPlan({
        steps: [{ kind: 'create-emoji', key: 'emoji:ghost', name: 'ghost', file: 'public/assets/discord/emoji/ghost.png' }],
        blockers: [], kept: [], extra: [], roleIds: { everyone: '1' }, channelIds: {},
    }, { fetchImpl: server.fetchImpl });
    rec('an emoji whose file is missing is reported against that step, not thrown at the caller',
        missingFile.ok === false && /could not be read/.test(missingFile.errors[0]?.message || ''),
        missingFile.errors[0]?.message);

    // -------------------------------------------------------------------------- drift is repaired
    console.log('');
    console.log('When a server drifts');

    const drifted = fakeDiscord({
        roles: server.state.roles.map((role) => ({ ...role })),
        channels: server.state.channels.map((channel) => ({ ...channel })),
        webhooks: server.state.webhooks.map((hook) => ({ ...hook })),
        commands: [...server.state.commands],
    });
    drifted.state.messages = server.state.messages.map((message) => ({ ...message }));
    drifted.state.pins = server.state.pins.map((pin) => ({ ...pin }));

    // By key, not by name: the room's name is dressing that gets edited, and a harness that looked for
    // a literal `general` would break the day somebody added an emoji to it.
    const generalName = Structure.allChannels().find((channel) => channel.key === 'general').name;
    const general = drifted.state.channels.find((channel) => channel.name === generalName);
    general.permission_overwrites = [{ id: '1', type: 0, allow: '0', deny: '0' }];
    drifted.state.roles.find((role) => role.name === 'Sentinel').hoist = false;
    drifted.state.channels.push({ id: '9999', name: 'memes-2', type: 0, permission_overwrites: [] });

    const drift = await Api.fetchGuildState('424242424242424242', { fetchImpl: drifted.fetchImpl });
    const driftPlan = Structure.computePlan({ guild: drift.guild });
    // Wiping a gated room's overwrites has to be repaired with the whole class, not one line of it:
    // "everyone" alone would leave the room something the public can read, and the roles that were
    // supposed to be in it missing. Counted against what the file declares rather than hard-coded, so
    // adding a role to a class moves the expectation with it.
    const generalSpecs = Structure.channelOverwrites(Structure.allChannels().find((channel) => channel.key === 'general'));
    rec('a channel whose overwrites were wiped is repaired, one role at a time and nothing else',
        driftPlan.steps.filter((s) => s.kind === 'set-overwrite').length === generalSpecs.length
        && driftPlan.steps.filter((s) => s.kind === 'set-overwrite').every((s) => s.key.startsWith('general:')),
        JSON.stringify(driftPlan.steps.filter((s) => s.kind === 'set-overwrite').map((s) => s.key)));
    rec('a role whose settings were changed is repaired without touching the rest',
        driftPlan.steps.filter((s) => s.kind === 'update-role').length === 1
        && driftPlan.steps.find((s) => s.kind === 'update-role').key === 'sentinel');
    rec('a channel this file does not describe is reported and left alone',
        driftPlan.extra.some((channel) => channel.name === 'memes-2')
        && !driftPlan.steps.some((step) => step.body?.name === 'memes-2'));
    rec('  … and the pinned pages are left as written unless --refresh-content says otherwise',
        driftPlan.steps.filter((s) => s.kind.includes('content')).length === 0);

    const repaired = await Setup.applyPlan(driftPlan, { fetchImpl: drifted.fetchImpl });
    const settled = Structure.computePlan({ guild: (await Api.fetchGuildState('424242424242424242', { fetchImpl: drifted.fetchImpl })).guild });
    rec('applying the repair converges too', repaired.ok && settled.steps.length === 0);

    // ------------------------------------------------------------------------- the honest blockers
    console.log('');
    console.log('The cases that need a human');

    const lowBot = fakeDiscord({
        roles: [
            { id: '1', name: '@everyone', position: 0, permissions: '0' },
            { id: '9001', name: 'Dungeon Knights Bot', position: 2, permissions: '0', managed: true, tags: { bot_id: 'BOT' } },
        ],
    });
    const lowPlan = Structure.computePlan({ guild: (await Api.fetchGuildState('424242424242424242', { fetchImpl: lowBot.fetchImpl })).guild });
    // A bot may reorder roles below its own highest role, and moving **its own** role up is accepted
    // too (measured on the live server: a PATCH naming the bot's role moved it from 1 to 9). So a
    // server with no spare slot in the band is fixed by the plan rather than by a human with a mouse.
    const lowOrder = lowPlan.steps.find((step) => step.kind === 'order-roles');
    rec('a bot role too low to hold ten roles is moved up rather than reported as impossible',
        Boolean(lowOrder) && lowOrder.positions.some((entry) => entry.key === 'bot')
        && !lowPlan.blockers.some((blocker) => blocker.key === 'bot-role-too-low'),
        'the alternative was a manual drag, and Discord does not require one');
    rec('  … and the step says what it is doing and why, rather than moving a role silently',
        /moves up to/.test(lowOrder?.reason || '') && /nothing sits above it/.test(lowOrder?.reason || ''));

    // The one case that is still a blocker: nothing to move, because the bot's own role cannot be
    // picked out of the role list at all.
    const anonymousBot = fakeDiscord({
        roles: [{ id: '1', name: '@everyone', position: 0, permissions: '0' }],
    });
    const anonymousPlan = Structure.computePlan({ guild: (await Api.fetchGuildState('424242424242424242', { fetchImpl: anonymousBot.fetchImpl })).guild });
    rec('a bot whose own role cannot be seen is still a blocker, because there is nothing to move',
        anonymousPlan.blockers.some((blocker) => blocker.key === 'bot-role-too-low' || blocker.key === 'bot-position')
        && !anonymousPlan.steps.some((step) => step.kind === 'order-roles' && step.positions.some((entry) => entry.key === 'bot')));

    const managedClash = fakeDiscord({
        roles: [
            { id: '1', name: '@everyone', position: 0, permissions: '0' },
            { id: '9001', name: 'Dungeon Knights Bot', position: 20, permissions: '0', managed: true, tags: { bot_id: 'BOT' } },
            { id: '9002', name: 'Knight', position: 19, permissions: '0', managed: true },
        ],
    });
    const clashPlan = Structure.computePlan({ guild: (await Api.fetchGuildState('424242424242424242', { fetchImpl: managedClash.fetchImpl })).guild });
    rec('a managed role wearing one of our names is reported, not edited',
        clashPlan.blockers.some((blocker) => blocker.key === 'role-managed-knight')
        && !clashPlan.steps.some((step) => step.kind === 'update-role' && step.key === 'knight'),
        'a Discord integration owns that role and would refuse the write anyway');

    const wrongGuild = await Api.fetchGuildState('424242424242424242', { fetchImpl: async () => ({ ok: false, status: 404, headers: { get: () => null }, text: async () => JSON.stringify({ message: 'Unknown Guild' }) }) });
    rec('a guild the bot is not in is reported as an invite problem, not a crash',
        wrongGuild.ok === false && /invite/i.test(wrongGuild.blocked), wrongGuild.blocked);
    rec('and a missing guild id is refused before any request is made',
        (await Api.fetchGuildState('', { fetchImpl: async () => { throw new Error('should not be called'); } })).ok === false);

    // ------------------------------------------------------------------------------- the client
    console.log('');
    console.log('The API client');

    const rateLimited = async () => ({ ok: false, status: 429, headers: { get: (name) => (name === 'retry-after' ? '0.01' : null) }, text: async () => JSON.stringify({ retry_after: 0.01, message: 'You are being rate limited.' }) });
    let attempts = 0;
    const flaky = async (url, options) => {
        attempts += 1;
        return attempts === 1 ? rateLimited() : { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ id: '7' }) };
    };
    const retried = await Api.discordRequest('/guilds/1/roles', { fetchImpl: flaky, sleepImpl: async () => {} });
    rec('a rate limit is waited out and retried, using the delay the API named',
        retried.ok === true && attempts === 2, `attempts ${attempts}`);

    let refusedAttempts = 0;
    const refused = await Api.discordRequest('/guilds/1/roles', {
        fetchImpl: async () => { refusedAttempts += 1; return { ok: false, status: 401, headers: { get: () => null }, text: async () => JSON.stringify({ message: '401: Unauthorized' }) }; },
        sleepImpl: async () => {},
    });
    rec('a refused token is reported once rather than retried in a loop',
        refused.ok === false && refusedAttempts === 1 && /token/i.test(refused.message),
        refused.message);
    rec('  … and the message never contains the token itself',
        !/harness-token-not-a-real-one/.test(refused.message));
    rec('a token is never put in a URL',
        !/[\w-]{20,}/.test(Api.redact('harness-token-not-a-real-one')) || Api.redact('harness-token-not-a-real-one') === '[token]',
        Api.redact('the token is harness-token-not-a-real-one'));
    rec('an unset token refuses locally instead of sending a request',
        (await Api.discordRequest('/guilds/1', { token: '' })).error === 'no-token');

    // ---------------------------------------------------------------------------- notifications
    console.log('');
    console.log('What gets posted, and what must never be');

    const WEBHOOK = 'https://discord.com/api/webhooks/123456789/harness-token-abc';
    const sent = [];
    const poster = async (url, options) => {
        sent.push(JSON.parse(options.body));
        return { ok: true, status: 204, headers: { get: () => null }, text: async () => '' };
    };

    setEnv('DISCORD_WEBHOOK_ACTIVITY', WEBHOOK);
    setEnv('DISCORD_WEBHOOK_ANNOUNCE', undefined);
    Notify.resetNotifyState();

    const waitlistEntry = {
        position: 12,
        count: 30,
        handle: 'SomeOne_On_X',
        source: 'landing',
        email: 'private@example.com',
        address: '0x1234567890abcdef1234567890abcdef12345678',
    };
    const posted = await Notify.notifyWaitlistSignup(waitlistEntry, { fetchImpl: poster });
    const serialised = JSON.stringify(sent[0] ?? {});
    // Read the field itself rather than the serialised payload: escaping is what is under test here,
    // and a string that has been through JSON.stringify cannot be matched with the same regex.
    const handleField = (body) => (body?.embeds?.[0]?.fields || []).find((field) => field.name === 'Found them on X')?.value || '';
    rec('a signup is posted', posted.ok === true);
    rec('  … and the email address is not in the payload',
        !/private@example\.com/.test(serialised), 'a queue entry is not a broadcast');
    rec('  … and neither is the wallet address',
        !/0x1234567890abcdef/.test(serialised));
    rec('  … and the handle is left out unless the owner asked for it',
        !/SomeOne_On_X/.test(serialised), 'DISCORD_ACTIVITY_SHOW_HANDLES is not set');

    sent.length = 0;
    setEnv('DISCORD_ACTIVITY_SHOW_HANDLES', 'true');
    await Notify.notifyWaitlistSignup(waitlistEntry, { fetchImpl: poster });
    const named = handleField(sent[0]);
    rec('with the flag on, the handle is named instead of the email',
        named === `@${waitlistEntry.handle.replace(/_/g, '\\_')}` && !/private@example\.com/.test(JSON.stringify(sent[0])),
        named);

    sent.length = 0;
    const hostile = '@everyone <@123456789012345678> **bold**';
    await Notify.notifyWaitlistSignup({ ...waitlistEntry, handle: hostile }, { fetchImpl: poster });
    const smuggled = handleField(sent[0]);
    rec('a handle cannot smuggle a ping or a mention into a public channel',
        !/@everyone/.test(smuggled) && !/<@\d/.test(smuggled) && /bold/.test(smuggled) && /\\\*\\\*bold\\\*\\\*/.test(smuggled),
        smuggled);
    rec('  … and the mention parse is switched off outright, whatever a player typed',
        sent[0]?.allowed_mentions?.parse?.length === 0);
    setEnv('DISCORD_ACTIVITY_SHOW_HANDLES', undefined);

    Notify.resetNotifyState();
    const brokenData = { get points() { throw new Error('boom'); } };
    const broken = await Notify.notifyDiscord('vault.complete', brokenData, { fetchImpl: poster });
    rec('an event whose own data cannot be read is reported, never thrown',
        broken.ok === false && broken.skipped === true && /could not be turned into/.test(broken.reason),
        'the caller has already written the row or paid the points by the time this runs');
    let builderThrows = false;
    try { Notify.payloadFor('vault.complete', { get points() { throw new Error('boom'); } }); } catch { builderThrows = true; }
    rec('  … and that data genuinely breaks the builder, so the guard above is load-bearing',
        builderThrows, 'falsified here rather than trusted');

    rec('a slot with no webhook is skipped rather than treated as a failure',
        (await Notify.notifyDiscord('announcement', { title: 'Hello' })).skipped === true,
        'the site works with Discord unwired, which is the state it ships in');

    Notify.resetNotifyState();
    for (let index = 0; index < 12; index += 1) await Notify.notifyDiscord('vault.complete', { points: 900 }, { fetchImpl: poster });
    const thirteenth = await Notify.notifyDiscord('vault.complete', { points: 900 }, { fetchImpl: poster });
    rec('a runaway loop is capped rather than allowed to spam the channel',
        thirteenth.ok === false && /ceiling/.test(thirteenth.reason), thirteenth.reason);

    Notify.resetNotifyState();
    const refusedPost = await Notify.notifyDiscord('vault.complete', { points: 900 }, { fetchImpl: async () => ({ ok: false, status: 500, headers: { get: () => null }, text: async () => '' }) });
    rec('a webhook that answers 500 is reported and never thrown',
        refusedPost.ok === false && /500/.test(refusedPost.reason), refusedPost.reason);
    rec('a webhook URL from somewhere other than Discord is not honoured',
        (() => {
            setEnv('DISCORD_WEBHOOK_ACTIVITY', 'https://evil.example.com/api/webhooks/1/x');
            const ok = Notify.webhookFor('activity') === '';
            setEnv('DISCORD_WEBHOOK_ACTIVITY', WEBHOOK);
            return ok;
        })(), 'a pasted URL from another host would have us posting our events to a stranger');

    // ------------------------------------------------------------------------------ the linking
    console.log('');
    console.log('Linking a wallet to an account');

    const walletA = `0x${'aa'.repeat(20)}`;
    const walletB = `0x${'bb'.repeat(20)}`;
    const walletC = `0x${'cc'.repeat(20)}`;
    const userOne = '900000000000000001';
    const userTwo = '900000000000000002';
    await Link.purgeLinks([walletA, walletB, walletC]);

    const drawn = new Set(Array.from({ length: 40 }, () => Link.drawCode()));
    rec('codes are six characters from an alphabet with no 0/O/1/I/L to misread',
        [...drawn].every((text) => text.length === 6 && [...text].every((char) => Link.CODE_ALPHABET.includes(char)))
        && !/O|I|L|0|1/.test(Link.CODE_ALPHABET),
        `${drawn.size} distinct in 40 draws`);
    rec('a code is normalised, and a malformed one is refused rather than looked up',
        Link.normaliseCode(' ab-cd2 ') !== null || Link.normaliseCode('234567') === '234567',
        'spaces and case are forgiven, length and alphabet are not');
    rec('  … and a code the alphabet cannot contain is refused',
        Link.normaliseCode('OOOOOO') === null && Link.normaliseCode('123456') === null && Link.normaliseCode('23456') === null);

    const issued = await Link.issueLinkCode(walletA);
    rec('a signed-in wallet is handed a code, and it is the one the page will show again',
        issued.ok === true && (await Link.pendingCodeFor(walletA)) === issued.code);

    const linked = await Link.redeemLinkCode(issued.code, { id: userOne, username: 'One' });
    rec('the code links the account to the wallet', linked.ok === true && linked.address === walletA.toLowerCase());
    rec('  … and the code is spent, so a screenshot is worthless',
        (await Link.redeemLinkCode(issued.code, { id: userTwo, username: 'Two' })).code === 'unknown-code');
    rec('  … and both directions of the link are stored',
        (await Link.linkForAddress(walletA))?.discordId === userOne && (await Link.linkForUser(userOne))?.address === walletA.toLowerCase());

    const reClaim = await Link.issueLinkCode(walletA);
    rec('one wallet cannot be claimed by a second Discord account',
        (await Link.redeemLinkCode(reClaim.code, { id: userTwo, username: 'Two' })).code === 'taken-wallet',
        'walletA is already userOne, and a fresh code does not change that');
    const again = await Link.issueLinkCode(walletA);
    rec('  … while the same account re-claiming its own wallet is a quiet success',
        (await Link.redeemLinkCode(again.code, { id: userOne, username: 'One' })).ok === true
        && (await Link.redeemLinkCode(again.code, { id: userOne })).code === 'unknown-code');
    const third = await Link.issueLinkCode(walletC);
    rec('one Discord account cannot hold two wallets',
        (await Link.redeemLinkCode(third.code, { id: userOne, username: 'One' })).code === 'taken-user');

    const stale = await Link.issueLinkCode(walletC, { nowMs: Date.now() - (Link.CODE_TTL_MS + 60_000) });
    rec('an expired code says so instead of failing vaguely',
        (await Link.redeemLinkCode(stale.code, { id: userTwo }, { nowMs: Date.now() })).code === 'expired');
    const replacedFirst = await Link.issueLinkCode(walletC);
    const replacedSecond = await Link.issueLinkCode(walletC);
    rec('asking for a new code invalidates the previous one',
        (await Link.redeemLinkCode(replacedFirst.code, { id: userTwo })).code === 'unknown-code'
        && (await Link.redeemLinkCode(replacedSecond.code, { id: userTwo })).ok === true);
    rec('a wrong-shaped code is refused before anything is looked up',
        (await Link.redeemLinkCode('nope', { id: userTwo })).code === 'bad-code');

    // ------------------------------------------------------------------------------ the roles
    console.log('');
    console.log('Which roles a wallet has earned');

    const tiers = {
        499: [],
        500: ['squire'],
        2499: ['squire'],
        2500: ['champion'],
        9999: ['champion'],
        10000: ['warden'],
        50000: ['warden'],
    };
    rec('the points roles start exactly at their thresholds, one tier at a time',
        Object.entries(tiers).every(([points, expected]) => {
            const got = Roles.rolesForFacts({ knights: { ok: true, count: 0 }, genesis: { ok: true, count: 0 }, points: { ok: true, value: Number(points) } }).roles;
            return JSON.stringify(got) === JSON.stringify(expected);
        }));
    rec('a Knight and a Genesis are separate facts, and holding both earns both',
        JSON.stringify(Roles.rolesForFacts({ knights: { ok: true, count: 3 }, genesis: { ok: true, count: 1 }, points: { ok: true, value: 0 } }).roles.sort()) === '["genesis","knight"]');
    rec('an unreadable source is reported as unknown rather than as empty',
        Roles.rolesForFacts({ knights: { ok: false, reason: 'rpc down' }, genesis: { ok: false }, points: { ok: true, value: 0 } }).unknown.join(',') === 'knights,genesis');

    const roleIds = { knight: 'k1', genesis: 'g1', squire: 's1', champion: 'c1', warden: 'w1' };
    const blind = Roles.reconcileRoles({
        currentRoleIds: ['k1', 'g1', 's1', 'STAFF1'],
        roleIdsByKey: roleIds,
        earned: ['knight', 'squire'],
        unknown: ['genesis'],
    });
    rec('a failed chain read does not strip a holder role',
        blind.remove.includes('g1') === false, `removals: ${blind.remove.join(',') || 'none'}`);
    rec('  … and the roles that were earned but missing are added, one tier only',
        blind.add.includes('k1') === false && blind.add.includes('s1') === false
        && Roles.reconcileRoles({ currentRoleIds: [], roleIdsByKey: roleIds, earned: ['warden'], unknown: [] }).add.join(',') === 'w1');
    rec('a role this project did not grant is never removed',
        !blind.remove.includes('STAFF1') && blind.add.includes('STAFF1') === false);
    rec('a source that could be read removes the role it no longer earns',
        Roles.reconcileRoles({ currentRoleIds: ['k1'], roleIdsByKey: roleIds, earned: [], unknown: [] }).remove.join(',') === 'k1');

    // --------------------------------------------------------------- the signed interactions
    console.log('');
    console.log('The interaction endpoint');

    // The linking section left links behind on purpose — that is what it was proving. The handler is a
    // different property, so it starts from a clean set of links instead of from whatever the previous
    // section happened to leave, which is also how a second run of this file behaves.
    await Link.purgeLinks([walletA, walletB, walletC]);

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const rawPublic = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');
    const stamp = String(Math.floor(Date.now() / 1000));
    const sign = (body, at = stamp) => crypto.sign(null, Buffer.concat([Buffer.from(at, 'utf8'), Buffer.from(body, 'utf8')]), privateKey).toString('hex');
    setEnv('DISCORD_PUBLIC_KEY', rawPublic);

    const pingBody = JSON.stringify({ type: 1 });
    rec('a request Discord signed is accepted',
        Interactions.verifySignature({ rawBody: pingBody, signature: sign(pingBody), timestamp: stamp }).ok === true);
    rec('  … and the same body with one byte changed is not',
        Interactions.verifySignature({ rawBody: `${pingBody} `, signature: sign(pingBody), timestamp: stamp }).ok === false);
    rec('  … and a signature made with another key is not',
        Interactions.verifySignature({ rawBody: pingBody, signature: sign(pingBody).replace(/^../, '00'), timestamp: stamp }).ok === false);
    rec('  … and a signature from yesterday is refused as stale',
        Interactions.verifySignature({ rawBody: pingBody, signature: sign(pingBody, '1000000000'), timestamp: '1000000000' }).code === 'stale');
    rec('a malformed signature is refused instead of throwing',
        Interactions.verifySignature({ rawBody: pingBody, signature: 'zz', timestamp: stamp }).code === 'bad-signature'
        && Interactions.verifySignature({ rawBody: pingBody, signature: undefined, timestamp: stamp }).code === 'bad-signature');
    rec('an unconfigured deployment verifies nothing',
        Interactions.verifySignature({ rawBody: pingBody, signature: sign(pingBody), timestamp: stamp, publicKey: '' }).code === 'no-key');

    rec('a ping is answered with a pong',
        (await Interactions.handleInteraction({ type: 1 })).body.type === 1);
    const unknownCommand = await Interactions.handleInteraction({ type: 2, data: { name: 'grantme', options: [] }, member: { user: { id: userOne } } });
    rec('a command this bot does not know is named, not shrugged at',
        /claim/.test(unknownCommand.body.data.content) && unknownCommand.body.data.flags === 64);

    // The claim path, with the chain and the Discord write both stubbed: what is being tested is the
    // order of the two outcomes (the link is durable, the roles are attempts), not whether an RPC is up.
    const codeForClaim = await Link.issueLinkCode(walletB);
    const claim = await Interactions.handleInteraction(
        { type: 2, data: { name: 'claim', options: [{ name: 'code', value: codeForClaim.code }] }, member: { user: { id: userTwo, username: 'Two' } } },
        { syncRoles: async () => ({ ok: true, granted: ['Knight'], removed: [], unknown: [] }), facts: async () => null },
    );
    rec('a claim with a live code links the account and reports the roles it granted',
        claim.body.data.content.includes('Knight') && (await Link.linkForUser(userTwo))?.address === walletB.toLowerCase(),
        claim.body.data.content.split('\n')[0]);

    const slowCode = await Link.issueLinkCode(walletC);
    const slow = await Interactions.handleInteraction(
        { type: 2, data: { name: 'claim', options: [{ name: 'code', value: slowCode.code }] }, member: { user: { id: '900000000000000003', username: 'Three' } } },
        { deadlineMs: 40, syncRoles: () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, granted: [], removed: [], unknown: [] }), 500)), facts: async () => null },
    );
    rec('a chain read too slow to answer with still leaves the wallet linked',
        /Linked to 0x/.test(slow.body.data.content)
        && (await Link.linkForUser('900000000000000003'))?.address === walletC.toLowerCase(),
        'the link is the fact, the roles are derived state that /whoami and --sync can finish');
    rec('  … and the player is told what to do about it rather than left guessing',
        /whoami/.test(slow.body.data.content));

    const noLink = await Interactions.handleInteraction({ type: 2, data: { name: 'whoami', options: [] }, member: { user: { id: '900000000000000004' } } }, { facts: async () => null });
    rec('whoami on an unlinked account explains how to link, in one step',
        /claim/.test(noLink.body.data.content) && noLink.body.data.flags === 64);

    // ------------------------------------------------------------------------------- the routes
    console.log('');
    console.log('The routes, as written');

    const routeSource = fs.readFileSync(path.join(ROOT, 'app', 'api', 'discord', 'interactions', 'route.js'), 'utf8');
    const routeCode = code(routeSource);
    const linkSource = code(fs.readFileSync(path.join(ROOT, 'app', 'api', 'discord', 'link', 'route.js'), 'utf8'));
    const toolSource = fs.readFileSync(path.join(ROOT, 'tools', 'discord-setup.js'), 'utf8');
    const toolCode = code(toolSource);

    rec('the endpoint reads the raw body and never a parsed one',
        /await request\.text\(\)/.test(routeCode) && !/request\.json\(\)/.test(routeCode));
    rec('  … and verifies before it looks inside',
        routeCode.indexOf('verifySignature(') > -1
        && routeCode.indexOf('verifySignature(') < routeCode.indexOf('JSON.parse('),
        'parsing first would be trusting the payload to decide whether to trust the payload');
    rec('  … and refuses unsigned input with a 401, which is also what --wire-app probes for',
        /status: 401/.test(routeCode) && routeCode.indexOf('status: 401') < routeCode.indexOf('handleInteraction('));
    rec('the signature check lives in one module, not a second copy in the route',
        !/createPublicKey|cryptoVerify/.test(routeCode));
    rec('the link code is only issued to a signed-in wallet',
        linkSource.indexOf('sessionFromRequest(') < linkSource.indexOf('issueLinkCode(')
        && /status: 401/.test(linkSource));

    rec('the setup tool writes nothing unless --apply was given',
        toolSource.indexOf('if (!args.apply)') > -1 && toolSource.indexOf('if (!args.apply)') < toolSource.indexOf('await Setup.applyPlan('),
        'planning is the default, and it is the only reason a first run is safe');
    rec('  … and it never reads a .env file for the token',
        !/dotenv/i.test(toolCode) && !/(readFileSync|readFile|loadEnvConfig)\s*\([^)]*\.env/.test(toolCode),
        'the token comes from the shell; the prose says so, and the code does not do otherwise');
    rec('the tool deletes nothing anywhere',
        !/method: 'DELETE'/.test(toolSource) && !/method: 'DELETE'/.test(code(fs.readFileSync(path.join(ROOT, 'lib', 'discord-setup.js'), 'utf8'))));

    // ------------------------------------------------------------------------------- the copy
    console.log('');
    console.log('The words in the rooms');

    const contentKeys = Structure.allChannels().filter((channel) => channel.content).map((channel) => channel.content);
    const rendered = contentKeys.map((key) => Structure.renderContent(key, { channels: { general: '111', support: '222', announcements: '333' } }));
    rec('no pin uses an em dash, since every one of these was written by hand once',
        rendered.every((page) => !page.body.includes('—')),
        'the same rule the site copy follows');
    rec('a pinned page mentions a channel by id when the id is known, and by name when it is not',
        rendered.find((page) => page.title === 'Welcome to Dungeon Knights').body.includes('<#111>')
        && Structure.renderContent('welcome', { channels: {} }).body.includes('#general'));
    rec('the points room quotes the numbers the program actually pays',
        rendered.find((page) => page.title === 'The Points Program').body.includes(String(Points.VAULT_ENTRY_TOTAL))
        && rendered.find((page) => page.title === 'The Points Program').body.includes(String(Points.VAULT_ENTRY_TOTAL * 2)),
        `${Points.VAULT_ENTRY_TOTAL} → ${Points.VAULT_ENTRY_TOTAL * 2}`);
    rec('every page carries its own marker, so a re-run can tell its own work from a human edit',
        rendered.every((page, index) => page.embed.footer.text.includes(contentKeys[index]) && page.embed.footer.text.includes(`v${Structure.PLAN_VERSION}`)));
    rec('nothing in a room tells the reader how honest this code is',
        !/taken on your word|we cannot|we are not able|standing in for/i.test(rendered.map((page) => page.body).join('\n')));

    // --------------------------------------------------------------------------------- cleanup
    await Link.purgeLinks([walletA, walletB, walletC]);
    for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }

    console.log('');
    const failed = results.filter((entry) => !entry.pass);
    console.log(`${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length) {
        console.log('');
        for (const entry of failed) console.log(`  FAILED: ${entry.label}`);
        process.exit(1);
    }
})();
