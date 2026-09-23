/**
 * Slash commands, answered from an HTTP endpoint rather than a gateway.
 *
 * WHY NO GATEWAY
 * --------------
 * A websocket bot process is a second thing to keep alive, a second thing to deploy, and a second
 * place the token lives. Discord's **interactions endpoint** is the other way round and fits this
 * project exactly the way the X webhook does: Discord POSTs to a URL of ours, signs the body, and
 * waits for an answer. One route, no long-running process, and the same "verify the raw bytes before
 * reading anything inside them" rule the X receiver already follows.
 *
 * THE SIGNATURE
 * -------------
 * Ed25519, over `timestamp + rawBody`, checked with the application's public key. Two properties are
 * worth stating because both are the kind of thing that is quietly wrong for months:
 *
 *   - the signed message is the **concatenation** of the timestamp header and the exact request body.
 *     Re-serialising a parsed payload changes the bytes and every signature then fails, which is why
 *     the route reads `request.text()` and this function takes a string.
 *   - the key arrives from Discord as 32 raw bytes in hex, and Node wants a **DER SPKI** key object.
 *     Prefixing the fixed 12-byte Ed25519 SPKI header is the whole of that conversion.
 *
 * THE DEADLINE, AND WHAT HAPPENS WHEN IT IS MISSED
 * ------------------------------------------------
 * Discord gives an interaction three seconds before it shows the player "this application did not
 * respond" and retries. Linking a wallet is fast (two store reads and a code), but granting roles
 * reads a chain and writes to Discord, and a slow RPC can push past three seconds.
 *
 * So the link is what the command *guarantees*, and the roles are what it *attempts*. The link is
 * written first and durably; the role grant runs under a deadline and, if it is not finished in time,
 * the answer says so and the reconciliation happens later — `/whoami` retries it, and
 * `node tools/discord-setup.js --sync` walks every link and grants them all. That is a real design
 * rather than a hope: the pair (durable fact, idempotent derived state) is the same shape the rest of
 * this project uses, and it means no part of a player's outcome depends on a background promise
 * surviving a serverless freeze.
 */

import { createPublicKey, verify as cryptoVerify } from 'crypto';
import { publicKeyHex, guildId } from './discord-api.js';
import { redeemLinkCode, linkForUser, recordSyncedRoles } from './discord-link.js';
import { syncMemberRoles, factsFor } from './discord-roles.js';
import { GATE_CUSTOM_ID, gateAnswer, grantGate } from './discord-gate.js';
import { COMMANDS } from './discord-structure.js';
import { getWallet } from './points-store.js';

/** Discord's own header names. */
export const SIGNATURE_HEADER = 'x-signature-ed25519';
export const TIMESTAMP_HEADER = 'x-signature-timestamp';

/** Ed25519 SPKI: the 12 fixed bytes Node needs in front of the raw public key. */
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** How stale a signed request may be. Discord retries within seconds; fifteen minutes is slack. */
const MAX_SKEW_SECONDS = 15 * 60;

/** The interaction types this endpoint answers. Anything else is acknowledged and ignored. */
const TYPE = { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3, MODAL_SUBMIT: 5 };

/** Response types. `CHANNEL_MESSAGE_WITH_SOURCE` is a normal reply; `PONG` answers a ping. */
const RESPONSE = { PONG: 1, MESSAGE: 4 };

/** Ephemeral, so a wallet address is not broadcast by a bot. Nothing here is a secret; it is just not news. */
const EPHEMERAL = 64;

export const HANDLED_TYPES = Object.values(TYPE);

/** Is this request from Discord, and is it fresh? Returns a verdict with a reason for the log. */
export function verifySignature({ rawBody, signature, timestamp, publicKey = publicKeyHex(), nowMs = Date.now() } = {}) {
    if (!publicKey) return { ok: false, code: 'no-key', reason: 'DISCORD_PUBLIC_KEY is not set, so nothing can be verified' };
    if (typeof signature !== 'string' || !/^[0-9a-fA-F]{128}$/.test(signature.trim())) {
        return { ok: false, code: 'bad-signature', reason: 'the signature header is missing or the wrong shape' };
    }
    const stamp = Number(timestamp);
    if (!Number.isFinite(stamp)) return { ok: false, code: 'bad-timestamp', reason: 'the timestamp header is missing or not a number' };
    if (Math.abs(Math.floor(nowMs / 1000) - stamp) > MAX_SKEW_SECONDS) {
        return { ok: false, code: 'stale', reason: `the request is ${Math.abs(Math.floor(nowMs / 1000) - stamp)}s from now` };
    }

    try {
        const key = createPublicKey({
            key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKey.trim(), 'hex')]),
            format: 'der',
            type: 'spki',
        });
        const signed = Buffer.concat([Buffer.from(String(timestamp), 'utf8'), Buffer.from(String(rawBody ?? ''), 'utf8')]);
        const good = cryptoVerify(null, signed, key, Buffer.from(signature.trim(), 'hex'));
        return good ? { ok: true } : { ok: false, code: 'mismatch', reason: 'the signature does not match the body it arrived with' };
    } catch (error) {
        // A malformed key throws rather than returning false, and an exception here would be a 500 on
        // every interaction for as long as the deployment is misconfigured.
        return { ok: false, code: 'bad-key', reason: `the public key could not be read: ${error?.message || error}` };
    }
}

/** A reply, in the shape Discord expects. Never includes `allowed_mentions` on purpose: no pings. */
export function reply(text, { ephemeral = true, embeds = null } = {}) {
    const body = { content: String(text || '').slice(0, 1900) };
    if (embeds) body.embeds = embeds;
    return {
        type: RESPONSE.MESSAGE,
        data: { ...body, flags: ephemeral ? EPHEMERAL : 0, allowed_mentions: { parse: [] } },
    };
}

/** The value of one option from an interaction payload, by name. */
export function optionValue(payload, name) {
    const options = payload?.data?.options;
    if (!Array.isArray(options)) return null;
    const found = options.find((option) => option?.name === name);
    return found ? String(found.value ?? '') : null;
}

/** Run something with a deadline, and say when the deadline won. The loser keeps going, harmlessly. */
export async function withDeadline(promise, ms) {
    const marker = Symbol('deadline');
    let timer = null;
    const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve(marker), Math.max(50, Number(ms) || 0));
        // Node keeps a process alive for a pending timer; this must not be the reason a function does.
        if (timer && typeof timer.unref === 'function') timer.unref();
    });
    try {
        const result = await Promise.race([promise, timeout]);
        return result === marker ? { timedOut: true } : { ok: true, result };
    } catch (error) {
        return { ok: false, error: String(error?.message || error) };
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * Answer one interaction.
 *
 * Pure-ish: everything it needs is passed in, the clock is passed in, and the deadline is passed in,
 * so the harness can drive the whole command surface with a stubbed store and a stubbed chain. The
 * route above it does three things only — read the body as text, verify the signature, hand it here.
 */
export async function handleInteraction(payload, {
    fetchImpl = fetch,
    guild = guildId(),
    nowMs = Date.now(),
    deadlineMs = 1800,
    // Two seams, and they are here rather than because of taste: the role sync reaches a chain and
    // the facts read reaches it twice, and a harness that made those calls would be testing whether
    // an RPC is up. Injecting them is what lets the *behaviour* be tested — including the branch
    // where the read is too slow to answer with, which is otherwise unreachable on purpose.
    syncRoles = syncMemberRoles,
    facts = factsFor,
} = {}) {
    const type = Number(payload?.type);

    if (type === TYPE.PING) return { status: 200, body: { type: RESPONSE.PONG } };

    const member = {
        id: payload?.member?.user?.id || payload?.user?.id || null,
        username: payload?.member?.user?.username || payload?.user?.username || null,
    };

    // ------------------------------------------------------------------- the button in #verify
    //
    // One press, one role, no code to type. It gets the same deadline as /claim because it makes the
    // same two reads (roles, member) before one write, and a slow Discord is the only way it misses.
    if (type === TYPE.MESSAGE_COMPONENT) {
        const customId = String(payload?.data?.custom_id || '');
        if (customId !== GATE_CUSTOM_ID) {
            // A button from a page this file no longer sends. Answered rather than ignored, because an
            // unanswered interaction is an error the presser sees, and named so it can be diagnosed.
            return { status: 200, body: reply('That button belongs to an older page. The one in #verify still works.') };
        }
        const attempt = await withDeadline(grantGate(member.id, { fetchImpl, guild }), deadlineMs);
        if (attempt.timedOut) {
            return { status: 200, body: reply('Discord is taking longer than this button may wait. Press it again in a moment.') };
        }
        const verdict = attempt.ok ? attempt.result : { ok: false, error: attempt.error };
        // An arrival is worth the room seeing. A refusal, or somebody pressing it twice, is not.
        const publicAnswer = Boolean(verdict?.ok && !verdict.already);
        return { status: 200, body: reply(gateAnswer(verdict), { ephemeral: !publicAnswer }) };
    }

    if (type !== TYPE.APPLICATION_COMMAND) {
        // A modal this endpoint never sends. Answered rather than ignored, for the same reason.
        return { status: 200, body: reply('That kind of interaction is not wired up on this endpoint.') };
    }

    const name = String(payload?.data?.name || '');

    if (name === 'claim') {
        const code = optionValue(payload, 'code') || '';
        const redeemed = await redeemLinkCode(code, member, { nowMs });
        if (!redeemed.ok) return { status: 200, body: reply(redeemed.error) };

        const attempt = await withDeadline(syncRoles(member.id, redeemed.address, { fetchImpl, guild }), deadlineMs);

        if (attempt.ok && attempt.result.ok) {
            const summary = attempt.result;
            const granted = summary.granted.length ? summary.granted.join(', ') : null;
            const removed = summary.removed.length ? summary.removed.join(', ') : null;
            const blind = summary.unknown.length
                ? `\n\nNot read this time: ${summary.unknown.join(', ')}. Those roles were left as they were.`
                : '';
            const lines = [
                `${redeemed.relinked ? 'Still linked' : 'Linked'} to ${short(redeemed.address)}.`,
                granted ? `Roles now: ${granted}.` : 'No holder roles yet. That changes the day a Knight or a Genesis lands in the wallet.',
                removed ? `Taken back: ${removed}, because the wallet no longer holds it.` : null,
                blind.trim(),
            ].filter(Boolean);
            await recordSyncedRoles(member.id, summary.granted).catch(() => null);
            return { status: 200, body: reply(lines.join('\n\n')) };
        }

        // The link is durable and the roles are derived, so a slow chain or a permission problem is
        // reported as what it is rather than as a failed claim.
        const why = attempt.timedOut
            ? 'the chain read is taking longer than this command may wait'
            : (attempt.result?.error || attempt.error || 'the roles could not be written just now');
        return {
            status: 200,
            body: reply(`${redeemed.relinked ? 'Still linked' : 'Linked'} to ${short(redeemed.address)}.\n\nYour wallet is recorded. Roles could not be granted in this breath: ${why}. Run /whoami in a minute and they will be worked out again.`),
        };
    }

    if (name === 'whoami') {
        const link = await linkForUser(member.id);
        if (!link) {
            return { status: 200, body: reply('No wallet is linked to this Discord account yet. Sign in at dungeonknights.io/points, press "Link Discord", and run /claim with the code it shows.') };
        }
        const [doc, reads] = await Promise.all([
            getWallet(link.address).catch(() => null),
            facts(link.address, { fetchImpl }).catch(() => null),
        ]);
        const points = doc?.points || 0;
        const attempt = await withDeadline(syncRoles(member.id, link.address, { fetchImpl, guild }), deadlineMs);
        const granted = attempt.ok && attempt.result.ok ? attempt.result.granted : null;
        await recordSyncedRoles(member.id, granted || link.roles || []).catch(() => null);
        return {
            status: 200,
            body: reply([
                `Wallet: ${short(link.address)}`,
                `Points: ${points}`,
                `Roles: ${(granted || link.roles || []).join(', ') || 'none yet'}`,
                reads?.genesis && !reads.genesis.ok ? 'The Genesis collection is not configured on this deployment, so the Genesis role cannot be read yet.' : null,
            ].filter(Boolean).join('\n')),
        };
    }

    // A command Discord has but this file does not, which happens when one is removed from
    // `COMMANDS` and the API has not been re-synced. Named, because a silent shrug is unhelpful.
    return {
        status: 200,
        body: reply(`I do not know "${name || 'that'}" yet. The commands this bot answers are: ${COMMANDS.map((command) => `/${command.name}`).join(', ')}.`),
    };
}

/** A wallet as it is shown to its owner: six characters, then four. */
export function short(address) {
    const text = String(address || '');
    return /^0x[0-9a-fA-F]{40}$/.test(text) ? `${text.slice(0, 6)}…${text.slice(-4)}` : 'that wallet';
}
