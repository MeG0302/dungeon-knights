/**
 * The site's side of Discord: what we post, and the two rules about what we are not allowed to post.
 *
 * Webhooks, not a bot gateway. A webhook is a URL that may post into one channel, it needs no
 * process to stay alive, and it cannot read anything — which is exactly the shape wanted here, since
 * everything this module sends is a fact we already hold. The bot token is for building the server
 * and granting roles; it has no business in a page request.
 *
 * RULE 1: A NOTIFICATION IS A COPY, NEVER A STEP
 * ----------------------------------------------
 * `notifyDiscord` never throws and its result is never allowed to change what the caller does. The
 * signup has already been written and the points have already been paid by the time this runs; a
 * webhook that was deleted in Discord, or a DNS blip, must not turn a successful action into an error
 * a player reads as "try again". It returns `{ ok, skipped, reason, status }` and the caller logs it.
 *
 * RULE 2: THE CHANNEL IS PUBLIC, SO IT GETS WHAT THE SITE ITSELF PUBLISHES
 * -----------------------------------------------------------------------
 * The waitlist form collects an email and, optionally, a wallet and an X handle. The page shows a
 * count and nothing else, and this module holds the same line: an email address never leaves the
 * store, a wallet address is never posted, and a handle is only included when
 * `DISCORD_ACTIVITY_SHOW_HANDLES=true` says the owner wants the shout-out. A person who typed their
 * email into a queue did not agree to have it read out in a public room, and "we announced their
 * wallet" is the kind of thing that is only obvious as a mistake afterwards.
 *
 * On top of that, every string that came from a person is escaped before it goes near the payload:
 * `@everyone` in a handle, a `<@123>` mention someone typed into a form, a `**` that would restyle
 * the embed. The mention parse is switched off wholesale as well, because the zero-width space below
 * is a display fix and `allowed_mentions` is the actual guarantee.
 */

const COLORS = {
    gold: 0xE0B34C,
    green: 0x3FA97A,
    blue: 0x3F8FD0,
    slate: 0x8E9BAE,
};

/** The two posting slots. Each is one channel, chosen when the server was built. */
export const SLOTS = {
    announce: { env: 'DISCORD_WEBHOOK_ANNOUNCE', label: 'announcements' },
    activity: { env: 'DISCORD_WEBHOOK_ACTIVITY', label: 'activity' },
};

/**
 * Every event this deployment knows how to post.
 *
 * `mint.knight` is here before it has a caller, and that is deliberate: a mint is a contract write
 * from the player's own wallet, so nothing on our server sees it happen. Rather than pretend, the
 * event is described and left unused until there is a chain reader behind it — the honest state of
 * that feature is "not built", and it is written down here so it is not quietly assumed.
 */
export const EVENTS = {
    'waitlist.signup': { slot: 'activity', color: COLORS.green, title: 'New name on the Genesis waitlist' },
    'vault.complete': { slot: 'activity', color: COLORS.gold, title: 'Vault run completed' },
    'mint.knight': { slot: 'activity', color: COLORS.blue, title: 'A Knight was summoned' },
    'announcement': { slot: 'announce', color: COLORS.gold, title: 'Announcement' },
    // The one event nothing calls: it exists so the owner can prove a pasted webhook URL works
    // before trusting it, without waiting for a stranger to join the waitlist first.
    'test': { slot: 'activity', color: COLORS.slate, title: 'Webhook test' },
};

/** A webhook URL for a slot, or '' when the owner has not pasted one in yet. */
export function webhookFor(slot) {
    const spec = SLOTS[slot];
    if (!spec) return '';
    const url = String(process.env[spec.env] || '').trim();
    // Only Discord's own hosts. A URL from anywhere else is either a mistake or somebody trying to
    // have us post our events to their server, and there is no reason for either to be honoured.
    return /^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(url) ? url : '';
}

/** Is a slot wired up? Reported in the setup tool's output so a missing paste is visible. */
export function slotStatus() {
    return Object.fromEntries(Object.entries(SLOTS).map(([slot, spec]) => [slot, Boolean(webhookFor(slot))]));
}

/* ------------------------------------------------------------------------------ escaping */

/**
 * Make a person's own text safe to put in a public message.
 *
 * Not sanitisation for security: the payload is JSON and nothing here is executed. It is about not
 * lying — a handle containing `＠everyone` should not ring the whole server, a stray `**` should not
 * turn a name into bold noise, and a `<@123>` pasted into a form should not mention a stranger.
 */
export function escapeDiscord(value, { limit = 200 } = {}) {
    let text = String(value ?? '');
    // Mentions first, in every shape Discord accepts.
    text = text.replace(/<(@[!&]?|#)\d{1,25}>/g, '[mention]');
    text = text.replace(/@(everyone|here)\b/gi, (match, name) => `@ ${name}`);
    // Markdown that would restyle a message rather than name somebody.
    text = text.replace(/([*_~`|>\\])/g, '\\$1');
    if (text.length > limit) text = `${text.slice(0, limit - 1)}…`;
    return text;
}

/** A wallet address, shortened the way the site shortens it. Never posted, but used in staff copy. */
export function shortAddress(address) {
    const text = String(address || '');
    return /^0x[0-9a-fA-F]{40}$/.test(text) ? `${text.slice(0, 6)}…${text.slice(-4)}` : '';
}

/** Handles are only named when the owner asked for it. Off by default, and that is the point. */
export function showHandles() {
    return String(process.env.DISCORD_ACTIVITY_SHOW_HANDLES || '').trim().toLowerCase() === 'true';
}

/* -------------------------------------------------------------------------- the payloads */

/**
 * The payload for one event, or null when the event carries nothing worth a message.
 *
 * Pure, so the harness can assert the privacy rule directly: build a waitlist payload from an entry
 * with an email and a wallet and check that neither string appears anywhere in the JSON.
 */
export function payloadFor(event, data = {}) {
    const spec = EVENTS[event];
    if (!spec) return null;

    if (event === 'waitlist.signup') {
        const fields = [];
        if (Number.isFinite(Number(data.position)) && Number(data.position) > 0) fields.push({ name: 'Position', value: `#${Number(data.position)}`, inline: true });
        if (Number.isFinite(Number(data.count)) && Number(data.count) > 0) fields.push({ name: 'In line', value: String(Number(data.count)), inline: true });
        if (data.handle && showHandles()) fields.push({ name: 'Found them on X', value: `@${escapeDiscord(data.handle)}`, inline: true });
        if (data.source && data.source !== 'landing') fields.push({ name: 'Came from', value: escapeDiscord(data.source, { limit: 40 }), inline: true });

        return {
            embeds: [{
                title: 'Another name on the list',
                color: spec.color,
                description: 'Somebody joined the Genesis waitlist. No email, no wallet, just the count.',
                fields,
                footer: { text: 'Dungeon Knights' },
            }],
        };
    }

    if (event === 'vault.complete') {
        const points = Number(data.points) || 0;
        return {
            embeds: [{
                title: 'Vault run completed',
                color: spec.color,
                description: points > 0
                    ? `A player cleared all three floors today and took **${points} points**.`
                    : 'A player cleared all three floors today.',
                footer: { text: 'Dungeon Knights' },
            }],
        };
    }

    if (event === 'announcement') {
        const lines = (Array.isArray(data.lines) ? data.lines : [data.text]).filter(Boolean);
        if (!lines.length) return null;
        return {
            embeds: [{
                title: escapeDiscord(data.title || spec.title, { limit: 80 }),
                color: spec.color,
                description: lines.map((line) => escapeDiscord(line, { limit: 1000 })).join('\n'),
                url: /^https:\/\//.test(String(data.url || '')) ? String(data.url) : undefined,
                footer: { text: 'Dungeon Knights' },
            }],
        };
    }

    if (event === 'test') {
        return {
            embeds: [{
                title: 'Webhook test',
                color: spec.color,
                description: 'If you can read this in the channel, the webhook is wired up correctly.',
                footer: { text: 'Dungeon Knights' },
            }],
        };
    }

    if (event === 'mint.knight') {
        return {
            embeds: [{
                title: 'A Knight was summoned',
                color: spec.color,
                description: data.knightId ? `Knight #${Number(data.knightId)} just arrived.` : 'A new Knight just arrived.',
                footer: { text: 'Dungeon Knights' },
            }],
        };
    }

    return null;
}

/* --------------------------------------------------------------------------- the send */

/** A minute of per-slot history, so one runaway loop cannot turn into a webhook ban. */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;
const history = { announce: [], activity: [] };
const noted = new Set();

function underLimit(slot, nowMs) {
    const list = (history[slot] || []).filter((at) => nowMs - at < WINDOW_MS);
    history[slot] = list;
    if (list.length >= MAX_PER_WINDOW) return false;
    list.push(nowMs);
    return true;
}

/** For the harness, and for a long-lived process that has just been reconfigured. */
export function resetNotifyState() {
    history.announce = [];
    history.activity = [];
    noted.clear();
}

/**
 * Post one event. Never throws, and the answer is what happened rather than whether it was allowed to
 * happen: a caller that ignored it would be right to, and the log is where it matters.
 */
export async function notifyDiscord(event, data = {}, { fetchImpl = fetch, nowMs = Date.now() } = {}) {
    const spec = EVENTS[event];
    if (!spec) return { ok: false, skipped: true, reason: `unknown event "${event}"` };

    const url = webhookFor(spec.slot);
    if (!url) {
        // Said once per process per slot. A line every time would be noise in a log somebody reads.
        if (!noted.has(spec.slot)) {
            noted.add(spec.slot);
            console.info(`[discord] ${SLOTS[spec.slot].env} is not set, so "${spec.slot}" posts are off. The site works either way.`);
        }
        return { ok: false, skipped: true, reason: 'no webhook configured for this slot' };
    }

    // The rule at the top of this file is that a notification never throws, and building the payload
    // is part of notifying. `data` is whatever a caller had to hand, so it is treated as hostile: a
    // getter that throws, a field that is not the shape this file assumes. A throw here would travel
    // back into a route that has already written the signup or paid the points, and the player would
    // be told "try again" for something that succeeded.
    let payload = null;
    try {
        payload = payloadFor(event, data);
    } catch (error) {
        console.warn(`[discord] "${event}" could not be built: ${String(error?.message || error)}`);
        return { ok: false, skipped: true, reason: 'the event data could not be turned into a message' };
    }
    if (!payload) return { ok: false, skipped: true, reason: 'nothing to post' };

    if (!underLimit(spec.slot, nowMs)) {
        console.warn(`[discord] "${event}" dropped: the ${spec.slot} slot is at its per-minute ceiling`);
        return { ok: false, skipped: true, reason: 'per-minute ceiling reached' };
    }

    const body = {
        username: 'Dungeon Knights',
        ...payload,
        // The guarantee, rather than the display fix above: nothing in this payload can ping a role,
        // a user or the whole server, whatever a player typed into a form.
        allowed_mentions: { parse: [] },
    };

    try {
        const response = await fetchImpl(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            cache: 'no-store',
            signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined,
        });
        if (response.status === 429) return { ok: false, status: 429, reason: 'Discord rate limited the webhook' };
        if (!response.ok) return { ok: false, status: response.status, reason: `Discord answered ${response.status}` };
        return { ok: true, status: response.status };
    } catch (error) {
        return { ok: false, reason: String(error?.message || error) };
    }
}

/**
 * The two callers that exist today, so their arguments are read in one place rather than at the seam.
 *
 * `options` is threaded straight through to `notifyDiscord`, which is what lets the harness post into
 * a stub instead of the owner's real channel while still exercising the payload this file builds.
 */
export function notifyWaitlistSignup(entry = {}, options = {}) {
    return notifyDiscord('waitlist.signup', {
        position: entry.position,
        count: entry.count,
        handle: entry.handle,
        source: entry.source,
    }, options);
}

export function notifyVaultRun({ points = 0 } = {}, options = {}) {
    return notifyDiscord('vault.complete', { points }, options);
}
