/**
 * The only module in this project that holds the bot token.
 *
 * Every caller — the setup tool, the slash-command route, the role sync — goes through
 * `discordRequest`, and that is the point: one place to get the base URL right, one place to handle
 * rate limits, and one place that knows not to put a secret in an error message.
 *
 * THE THREE THINGS THAT ACTUALLY BREAK
 * ------------------------------------
 *   1. **Rate limits are normal, not exceptional.** Discord answers a burst with 429 and a
 *      `retry_after` in seconds, and a global limit looks the same with one extra header. A client
 *      that treats either as a failure will fail on every bulk run, which is exactly what a server
 *      build is. So 429 is retried after the delay the API itself named, and the delay is read from
 *      the JSON body first (the header can be rounded).
 *   2. **`before` a server is built there are no ids.** Roles must exist before a channel overwrite
 *      can name them, categories before their children. The executor in the setup tool walks the
 *      plan in order and resolves names to ids as it goes; this module just performs one write.
 *   3. **A 404 from a guild endpoint is not a missing guild.** It means the bot is not in that
 *      server, which is a different sentence and needs a different fix, so the two are distinguished
 *      rather than collapsed into "request failed".
 *
 * Errors are values here, never throws: the route that handles a slash command has to answer Discord
 * with something, and an exception in the middle of that is a silent timeout.
 */

const API = 'https://discord.com/api/v10';

/** How many times a rate-limited or 5xx answer is retried before it is reported. */
const MAX_ATTEMPTS = 4;

/** Bounded, because a circular rate limit is worse than a refusal: it never returns. */
const MAX_RETRY_AFTER_MS = 15_000;

const REQUEST_TIMEOUT_MS = 8000;

/* ------------------------------------------------------------------------------ configuration
 *
 * Read at call time rather than frozen at import: a Next.js route can be rebuilt between requests,
 * and the setup tool sets these in the shell it runs in. The token is never returned by anything that
 * a page could reach: only the modules listed above import this file.
 */

export function botToken() {
    return String(process.env.DISCORD_BOT_TOKEN || '').trim();
}

export function guildId() {
    return String(process.env.DISCORD_GUILD_ID || '').trim();
}

/** The application id. Public, not a secret: it is in the invite URL and in every interaction. */
export function applicationId() {
    return String(process.env.DISCORD_APPLICATION_ID || '').trim();
}

/** The application's Ed25519 public key, hex. Also public, and required to trust an interaction. */
export function publicKeyHex() {
    return String(process.env.DISCORD_PUBLIC_KEY || '').trim();
}

/** Is this deployment able to talk to Discord at all? Used by the tool to fail early and loudly. */
export function configured() {
    return { token: Boolean(botToken()), guild: /^\d{5,25}$/.test(guildId()), application: /^\d{5,25}$/.test(applicationId()) };
}

/** Anything that is obviously a token, taken out of a string that is about to be logged. */
export function redact(value) {
    const token = botToken();
    const text = String(value ?? '');
    if (!token) return text;
    return text.split(token).join('[token]');
}

/* --------------------------------------------------------------------------------- the request */

function sleep(ms, sleepImpl) {
    return sleepImpl ? sleepImpl(ms) : new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One API call, with the retry rules above.
 *
 * `sleepImpl` and `fetchImpl` exist so the harness can exercise the retry path without spending real
 * seconds or making a real request, which is the only way a rate-limit branch ever gets tested.
 */
export async function discordRequest(path, {
    method = 'GET',
    body = null,
    token = botToken(),
    fetchImpl = fetch,
    sleepImpl = null,
    maxAttempts = MAX_ATTEMPTS,
} = {}) {
    if (!token) return { ok: false, status: 0, error: 'no-token', message: 'DISCORD_BOT_TOKEN is not set' };
    const url = path.startsWith('http') ? path : `${API}${path}`;
    const headers = { authorization: `Bot ${token}` };
    if (body !== null && body !== undefined) headers['content-type'] = 'application/json';

    let last = { ok: false, status: 0, error: 'unknown', message: 'no attempt was made' };

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        let response;
        try {
            response = await fetchImpl(url, {
                method,
                headers,
                body: body === null || body === undefined ? undefined : JSON.stringify(body),
                cache: 'no-store',
                signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined,
            });
        } catch (error) {
            last = { ok: false, status: 0, error: 'network', message: redact(error?.message || error), attempts: attempt };
            if (attempt < maxAttempts) {
                await sleep(300 * attempt, sleepImpl);
                continue;
            }
            return last;
        }

        // A body is not guaranteed: 204 answers have none, and a proxy error might not be JSON.
        const text = await response.text().catch(() => '');
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch {
            data = null;
        }

        if (response.status === 429) {
            // The API names the wait. The body is authoritative when it is there; the header is the
            // fallback because some proxies answer with only that.
            const fromBody = Number(data?.retry_after);
            const fromHeader = Number(response.headers?.get?.('retry-after'));
            const seconds = Number.isFinite(fromBody) ? fromBody : (Number.isFinite(fromHeader) ? fromHeader : 1);
            const waitMs = Math.min(Math.max(seconds * 1000, 250), MAX_RETRY_AFTER_MS);
            last = { ok: false, status: 429, error: 'rate-limited', message: `rate limited, waited ${Math.round(waitMs)}ms`, attempts: attempt };
            if (attempt < maxAttempts) {
                await sleep(waitMs, sleepImpl);
                continue;
            }
            return last;
        }

        if (response.status >= 500) {
            last = { ok: false, status: response.status, error: 'server-error', message: `Discord answered ${response.status}`, attempts: attempt };
            if (attempt < maxAttempts) {
                await sleep(500 * attempt, sleepImpl);
                continue;
            }
            return last;
        }

        if (!response.ok) {
            // Not retried, and each of these has one sentence that tells the reader what to do.
            const guidance = {
                401: 'the bot token was refused. If it was rotated, the new one has to reach every place the old one is set',
                403: 'the bot is in the server but is missing a permission for this call',
                404: 'that object is not visible to this bot, which usually means the guild id is wrong or the bot was never invited',
            }[response.status] || `Discord answered ${response.status}`;
            return {
                ok: false,
                status: response.status,
                error: 'refused',
                message: `${guidance}${data?.message ? ` (${data.message})` : ''}`,
                data,
                attempts: attempt,
            };
        }

        return { ok: true, status: response.status, data, attempts: attempt };
    }

    return last;
}

/* ---------------------------------------------------------------- reads the plan is built from
 *
 * One function, because the plan needs four things at once (roles with their positions, channels with
 * their overwrites, webhooks, the guild command list) and fetching them separately is four places for
 * a partial state to hide. A read that fails is reported as a blocker by the caller, not as a
 * half-empty guild that would look like "everything needs creating".
 */

export async function fetchGuildState(id = guildId(), { fetchImpl = fetch, botUserId = null } = {}) {
    if (!/^\d{5,25}$/.test(String(id || ''))) {
        return { ok: false, blocked: 'DISCORD_GUILD_ID is not set (a snowflake id, not a name)' };
    }

    const [guild, channels, webhooks, commands, me] = await Promise.all([
        discordRequest(`/guilds/${id}`, { fetchImpl }),
        discordRequest(`/guilds/${id}/channels`, { fetchImpl }),
        discordRequest(`/guilds/${id}/webhooks`, { fetchImpl }),
        discordRequest(`/applications/${applicationId() || '@me'}/guilds/${id}/commands`, { fetchImpl }),
        discordRequest('/users/@me', { fetchImpl }),
    ]);

    if (!guild.ok) {
        // The one failure worth naming differently: a 404 here means the bot is not in the server.
        const blocked = guild.status === 404
            ? `the bot is not in server ${id}, or the id is wrong. Invite it with the URL the tool prints, then run again`
            : `could not read the guild: ${guild.message}`;
        return { ok: false, blocked, status: guild.status };
    }

    const roles = Array.isArray(guild.data?.roles) ? guild.data.roles : [];
    const botId = botUserId || me.data?.id || null;
    // The band a bot may write in is decided by the **highest** role it holds, not by its member
    // position: a bot with an admin role is not "above" anything it was not given.
    let botPosition = null;
    // The roles the bot's member record holds, which is how the plan knows whether it already wears its
    // own `Chronicler` role. Read here rather than guessed at: the bot wears its own key so it can see
    // the rooms it hides, and a plan that assumed it did would drop the grant on a rebuild.
    let botRoles = [];
    if (botId && commands.ok !== undefined) {
        const member = await discordRequest(`/guilds/${id}/members/${botId}`, { fetchImpl });
        if (member.ok) {
            botRoles = (member.data?.roles || []).map(String);
            const held = new Set(botRoles);
            const positions = roles.filter((role) => held.has(String(role.id))).map((role) => Number(role.position));
            botPosition = positions.length ? Math.max(...positions) : 0;
        }
    }

    const channelList = channels.ok ? channels.data : [];
    const pins = {};
    for (const channel of channelList) {
        if (Number(channel.type) !== 0) continue;
        const read = await discordRequest(`/channels/${channel.id}/pins`, { fetchImpl });
        if (!read.ok) continue;
        pins[channel.id] = (read.data || []).map((message) => ({
            id: message.id,
            channel_id: channel.id,
            author: message.author?.id || null,
            footer: message.embeds?.[0]?.footer?.text || '',
        }));
    }

    return {
        ok: true,
        guild: {
            id: String(guild.data.id),
            name: guild.data.name,
            // The two cosmetic facts the plan needs, off the same read so they cannot disagree with
            // the roles and channels beside them: the emoji already on the server (matched by name and
            // never replaced) and the boost level, which is the only thing that decides whether a role
            // icon can be written at all.
            emojis: Array.isArray(guild.data.emojis) ? guild.data.emojis : [],
            premiumTier: Number(guild.data.premium_tier ?? 0),
            roles,
            channels: channelList,
            webhooks: webhooks.ok ? webhooks.data : [],
            commands: commands.ok ? commands.data : [],
            pins: Object.values(pins).flat(),
            bot: { id: botId, position: botPosition, roles: botRoles },
        },
        // A partial read is worth reporting: a missing channel list would make the plan re-create
        // what exists, and that is a lot of duplicate rooms.
        incomplete: [!channels.ok && 'channels', !webhooks.ok && 'webhooks', !commands.ok && 'commands'].filter(Boolean),
    };
}

/** The application's own record: id, name, and the public key the interaction route verifies with. */
export async function fetchApplication({ fetchImpl = fetch } = {}) {
    const read = await discordRequest('/oauth2/applications/@me', { fetchImpl });
    if (!read.ok) return read;
    return {
        ok: true,
        application: {
            id: read.data?.id || null,
            name: read.data?.name || null,
            publicKey: read.data?.verify_key || null,
        },
    };
}
