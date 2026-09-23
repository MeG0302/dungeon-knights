/**
 * Performing a plan, one write at a time.
 *
 * The plan says *what* is wrong; this says how to fix it, and it exists as a module of its own rather
 * than as a script so the whole thing can be run against a **fake Discord** in the harness. That test
 * is where the property that matters is proven: apply a plan to an empty server, read the result back,
 * plan again — and the second plan is empty. Idempotency is not a feeling; it is that assertion.
 *
 * ORDER IS NOT AN OPTION
 * ----------------------
 * Roles before the channels that reference them, because an overwrite names a role id and there is no
 * id until the role exists. Categories before their children, for the same reason. Webhooks after the
 * channel they live in. Content last, because a pinned page mentions `#general` and a mention needs
 * `#general` to have an id. The executor walks the plan in the order `computePlan` emitted it, which
 * is that order.
 *
 * FAILURES ARE COLLECTED, NOT THROWN
 * ----------------------------------
 * One refused write (a permission the bot does not have, a role name that is five characters too
 * long) should not abandon the other thirty. Each step's outcome is recorded with enough context to
 * find it — step key, HTTP status, the API's own message — and the caller prints them and exits
 * non-zero. What it never does is retry blindly: a 403 is a fact about the grant, and repeating it
 * twenty times does not change the grant.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { discordRequest, applicationId, guildId, botToken, redact } from './discord-api.js';
import { CHANNEL_TYPE, renderContent, permissionsOf } from './discord-structure.js';

/** The repository root, so an asset path in the structure file resolves wherever the tool is run from. */
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * A file in this repo, as the data URI Discord wants for an upload.
 *
 * Emoji and role icons go up as `data:image/png;base64,…` rather than as a multipart body, and the
 * declared type has to match the bytes. A missing file returns null and the caller reports it: a wrong
 * path is an edit mistake, and it should not take the other thirty writes down with it.
 */
/** Discord takes PNG, JPEG and GIF here, and refuses a declared type that does not match the bytes. */
const UPLOAD_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif' };

function uploadDataUri(relative) {
    try {
        const extension = String(relative).slice(String(relative).lastIndexOf('.')).toLowerCase();
        const mime = UPLOAD_MIME[extension] || 'image/png';
        return `data:${mime};base64,${readFileSync(resolve(ROOT, relative)).toString('base64')}`;
    } catch {
        return null;
    }
}

/**
 * A role body with `{ file }` turned into a real upload.
 *
 * The plan carries a path because the planner never reads a file; this is the one place a picture is
 * actually opened. When the icon cannot be read the field is dropped rather than sent empty, so the
 * role's colour and permissions still land — a missing picture is not a reason to lose the role.
 */
function withIcon(body, { dryRun }) {
    if (!body || !body.icon || typeof body.icon !== 'object') return { body, missing: null };
    const image = dryRun ? null : uploadDataUri(body.icon.file);
    if (!image) {
        const { icon, ...rest } = body;
        return { body: dryRun ? body : rest, missing: body.icon.file };
    }
    return { body: { ...body, icon: image }, missing: null };
}

/**
 * Run a plan.
 *
 * `fetchImpl` is threaded through every call so the harness can answer with a fake server; in
 * production it is untouched and the real API is used. `dryRun` performs no writes at all and still
 * returns the list of steps it would have written, which is what `--plan` prints.
 */
export async function applyPlan(plan, {
    fetchImpl = fetch,
    guild = guildId(),
    application = applicationId(),
    dryRun = false,
    log = () => {},
} = {}) {
    const done = [];
    const errors = [];
    const webhookUrls = {};
    // Seeded from the plan, which resolved every id it could see at plan time; the creates below add
    // the ones that did not exist yet. See the note on `plan.roleIds` for why this is not simply
    // rebuilt here.
    const roleIds = { ...(plan.roleIds || {}) };
    // Same bargain as the roles: a parent that already exists and needs no changes has no step of its
    // own, so a create that points at it needs the id carried on the plan. Without this a rebuild under
    // an existing category is refused with "its category … was not created".
    const channelIds = { ...(plan.channelIds || {}) };
    let categoryPosition = 0;
    let channelPosition = 0;

    const write = async (label, path, options = {}) => {
        if (dryRun) {
            done.push({ label, path, dry: true });
            return { ok: true, dry: true, data: null };
        }
        const result = await discordRequest(path, { ...options, fetchImpl });
        if (!result.ok) errors.push({ label, status: result.status || 0, message: redact(result.message) });
        else done.push({ label, path });
        return result;
    };

    // Ids of things that already exist, so a plan that only updates can resolve parents and roles.
    for (const step of plan.steps) {
        if (step.kind === 'update-role' && step.id) roleIds[step.key] = step.id;
        if (step.kind === 'update-channel' && step.id) channelIds[step.key] = step.id;
    }

    for (const step of plan.steps) {
        if (step.kind === 'create-role') {
            const { body, missing } = withIcon(step.body, { dryRun });
            if (missing) errors.push({ label: `role:${step.key}`, status: 0, message: `its role icon ${missing} could not be read, so the role was created without one` });
            const result = await write(`role:${step.key}`, `/guilds/${guild}/roles`, { method: 'POST', body });
            if (result.ok && result.data?.id) roleIds[step.key] = String(result.data.id);
            continue;
        }

        if (step.kind === 'update-role') {
            const { body, missing } = withIcon(step.body, { dryRun });
            if (missing) errors.push({ label: `role:${step.key}`, status: 0, message: `its role icon ${missing} could not be read, so only the rest was written` });
            // A PATCH with no fields is a 400, which is what an update whose only change was an
            // unreadable icon would otherwise become.
            if (Object.keys(body).length) await write(`role:${step.key}`, `/guilds/${guild}/roles/${step.id}`, { method: 'PATCH', body });
            continue;
        }

        if (step.kind === 'create-emoji') {
            const image = dryRun ? '' : uploadDataUri(step.file);
            if (!dryRun && !image) {
                errors.push({ label: `emoji:${step.name}`, status: 0, message: `${step.file} could not be read, so there is nothing to upload` });
                continue;
            }
            await write(`emoji:${step.name}`, `/guilds/${guild}/emojis`, {
                method: 'POST',
                body: { name: step.name, image },
            });
            continue;
        }

        if (step.kind === 'assign-bot-role') {
            // `PUT` on the collection adds one role and leaves the rest of the member alone, which is
            // the right shape here: the bot's other roles are Discord's business, not ours.
            const roleId = step.roleId || roleIds[step.roleKey];
            if (!roleId) {
                errors.push({ label: step.key, status: 0, message: `the ${step.roleKey} role does not exist, so the bot cannot be given it` });
                continue;
            }
            await write(step.key, `/guilds/${guild}/members/${step.userId}/roles/${roleId}`, { method: 'PUT' });
            continue;
        }

        if (step.kind === 'order-roles') {
            // One bulk call, because the endpoint takes the whole order: sending them one at a time
            // would pass through states where two roles share a position, and Discord resolves those
            // by guesswork that is not documented anywhere.
            const payload = step.positions
                .map((entry) => ({ id: roleIds[entry.key], position: entry.position }))
                .filter((entry) => entry.id);
            if (payload.length) await write('roles:order', `/guilds/${guild}/roles`, { method: 'PATCH', body: payload });
            continue;
        }

        if (step.kind === 'create-category' || step.kind === 'create-channel') {
            const isCategory = step.body.type === CHANNEL_TYPE.category;
            const body = {
                name: step.body.name,
                type: step.body.type,
                position: isCategory ? categoryPosition++ : channelPosition++,
                permission_overwrites: resolveOverwrites(step.body.overwrites, roleIds),
            };
            if (!isCategory && step.body.parentKey) {
                const parent = channelIds[step.body.parentKey];
                // A parent that still has no id means its own create failed, and Discord will refuse
                // this child too. It is recorded rather than guessed at.
                if (!parent) {
                    errors.push({ label: `channel:${step.key}`, status: 0, message: `its category "${step.body.parentKey}" was not created` });
                    continue;
                }
                body.parent_id = parent;
            }
            if (step.body.topic) body.topic = step.body.topic;
            const result = await write(`channel:${step.key}`, `/guilds/${guild}/channels`, { method: 'POST', body });
            if (result.ok && result.data?.id) channelIds[step.key] = String(result.data.id);
            continue;
        }

        if (step.kind === 'update-channel') {
            const body = { ...step.body };
            if (body.parent_id && typeof body.parent_id === 'object') {
                const parent = channelIds[body.parent_id.from];
                if (parent) body.parent_id = parent;
                else delete body.parent_id;
            }
            await write(`channel:${step.key}`, `/channels/${step.id}`, { method: 'PATCH', body });
            continue;
        }

        if (step.kind === 'set-overwrite') {
            await write(`overwrite:${step.key}`, `/channels/${step.channelId}/permissions/${step.roleId}`, {
                method: 'PUT',
                body: { allow: step.allow, deny: step.deny, type: 0 },
            });
            continue;
        }

        if (step.kind === 'create-webhook') {
            const channelId = step.channelId || channelIds[step.channelKey];
            if (!channelId) {
                errors.push({ label: `webhook:${step.slot}`, status: 0, message: `#${step.channelKey} does not exist yet` });
                continue;
            }
            const result = await write(`webhook:${step.slot}`, `/channels/${channelId}/webhooks`, { method: 'POST', body: { name: step.name } });
            if (result.ok && result.data?.id && result.data?.token) {
                // The only moment the URL exists. Discord never shows a webhook token again, so this
                // is what the tool prints and what the owner pastes into Vercel.
                webhookUrls[step.slot] = {
                    channel: step.channelKey,
                    url: `https://discord.com/api/webhooks/${result.data.id}/${result.data.token}`,
                };
            }
            continue;
        }

        if (step.kind === 'post-content' || step.kind === 'update-content') {
            const rendered = renderContent(step.contentKey, { channels: channelIds });
            // On a fresh build the channel is created earlier in this same run, so its id is only
            // known now — at plan time it was a name.
            const channelId = step.channelId || channelIds[step.channelKey];
            if (!rendered) {
                errors.push({ label: `content:${step.contentKey}`, status: 0, message: 'no content is written for that key' });
                continue;
            }
            if (!channelId) {
                errors.push({ label: `content:${step.contentKey}`, status: 0, message: `#${step.channelKey} does not exist yet` });
                continue;
            }
            // A page with a button carries one component row; a page without one must not carry an
            // empty array, because Discord rejects `components: []` on a message edit and a null on a
            // create. So it is spread in only when there is something to spread.
            const withComponents = (body) => (rendered.components ? { ...body, components: rendered.components } : body);
            if (step.kind === 'update-content') {
                await write(`content:${step.contentKey}`, `/channels/${channelId}/messages/${step.messageId}`, {
                    method: 'PATCH',
                    body: withComponents({ embeds: [rendered.embed] }),
                });
                continue;
            }
            const posted = await write(`content:${step.contentKey}`, `/channels/${channelId}/messages`, {
                method: 'POST',
                body: withComponents({ embeds: [rendered.embed] }),
            });
            if (posted.ok && posted.data?.id) {
                await write(`pin:${step.contentKey}`, `/channels/${channelId}/pins/${posted.data.id}`, { method: 'PUT' });
            }
            continue;
        }

        if (step.kind === 'sync-commands') {
            if (!application) {
                errors.push({ label: 'commands', status: 0, message: 'DISCORD_APPLICATION_ID is not set, so commands cannot be registered' });
                continue;
            }
            // `PUT` on the collection replaces the whole set, which is what a declarative file wants:
            // a command removed from `COMMANDS` should disappear from Discord too.
            await write('commands', `/applications/${application}/guilds/${guild}/commands`, { method: 'PUT', body: step.desired });
            continue;
        }

        errors.push({ label: step.kind, status: 0, message: 'this tool does not know how to perform that step' });
    }

    log(`${done.length} write(s), ${errors.length} refused`);
    return { ok: errors.length === 0, done, errors, webhookUrls, roleIds, channelIds, dryRun: dryRun === true };
}

/**
 * Turn a plan's role-key overwrites into the ids the API wants.
 *
 * A role key with no id yet is dropped rather than written as a guess: at this point in the run the
 * role is either being created later (its overwrite travels with the channel create, which is where
 * `computePlan` puts it) or the create failed, and an overwrite naming nobody is a 400 from Discord.
 */
export function resolveOverwrites(specs, roleIds) {
    const out = [];
    for (const spec of specs || []) {
        const id = spec.roleKey === 'everyone' ? roleIds.everyone : roleIds[spec.roleKey];
        if (!id) continue;
        out.push({
            id: String(id),
            type: 0,
            allow: permissionsOf(spec.allow || []).toString(),
            deny: permissionsOf(spec.deny || []).toString(),
        });
    }
    return out;
}

/**
 * Point the application at our interaction endpoint.
 *
 * Discord validates the URL by calling it immediately, which makes this the one write in the whole
 * setup that can only succeed once the site is live and answering. That is why it is its own command
 * (`--wire-app`) rather than part of `--apply`: a server build should not fail because a deploy is
 * still rolling out.
 */
export async function wireInteractionsEndpoint(url, { fetchImpl = fetch } = {}) {
    if (!/^https:\/\/[a-z0-9.-]+\/api\/discord\/interactions$/.test(String(url || ''))) {
        return { ok: false, message: 'that is not a Discord interaction endpoint URL (https://…/api/discord/interactions)' };
    }
    const result = await discordRequest('/applications/@me', { method: 'PATCH', body: { interactions_endpoint_url: url }, fetchImpl });
    if (!result.ok) {
        // Discord's own words when the endpoint does not answer its validation ping, and they are
        // worth passing through rather than summarising.
        return { ok: false, status: result.status, message: redact(result.message) };
    }
    return { ok: true, endpoint: result.data?.interactions_endpoint_url || url };
}

/** True when there is a token at all. The CLI uses this to decide between planning and advising. */
export function canReachDiscord() {
    return Boolean(botToken());
}
