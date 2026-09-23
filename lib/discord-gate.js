/**
 * The gate: one button, one role, and a door that needs nothing from anybody.
 *
 * WHAT THE GATE IS, AND WHY IT IS NOT A WALLET CHECK
 * --------------------------------------------------
 * Every room outside START HERE is hidden from `@everyone`, and `Verified` is what opens them. The
 * button that hands it out asks for nothing: no wallet, no X account, no email, no code. That is
 * deliberate. The gate is not there to prove anything about a person; it is there so the server has a
 * front door at all — a visitor sees five rooms and one button, and pressing it is the difference
 * between reading about the project and being in it. Holder rooms are a *second* gate, and that one
 * does check a wallet, through `/claim`.
 *
 * WHY THE BUTTON AND NOT A COMMAND
 * --------------------------------
 * `/claim` is typed with a code, because linking a wallet to an account is a real claim that deserves
 * friction. Admitting somebody to a chat server does not, and a one-press button is the whole of what
 * Discord's own onboarding would do plus one API call we control. It also means the gate carries no
 * secret: the custom id is public, the answer is what Discord signs, and pressing it twice is a no-op
 * rather than an error.
 *
 * EVERY FAILURE IS ONE SENTENCE AND ALL OF THEM ARE RECOVERABLE
 * -------------------------------------------------------------
 * The role is read fresh on every press rather than cached, because a role created after the bot was
 * invited has an id nobody stored and Discord has no \"grant by name\". The three calls are the role
 * list, the member record and the write, and each can fail for a reason a person can act on — a role
 * that does not exist yet, a bot whose role sits below the one it is handing out — so each is turned
 * into that sentence instead of being collapsed into \"something went wrong\".
 */

import { discordRequest, guildId } from './discord-api.js';
import { GATE_CUSTOM_ID, GATE_ROLE_KEY, ROLES } from './discord-structure.js';

export { GATE_CUSTOM_ID };

/** The role the button grants, straight out of the structure file. One declaration, no second copy. */
export function gateRole() {
    return ROLES.find((role) => role.key === GATE_ROLE_KEY) || null;
}

/**
 * Hand one member the gate role.
 *
 * Returns a verdict rather than throwing: the caller is answering an interaction that has three
 * seconds to live, and an exception in the middle of that is a silent timeout.
 */
export async function grantGate(discordId, { fetchImpl = fetch, guild = guildId() } = {}) {
    const role = gateRole();
    if (!role) return { ok: false, error: 'the gate role is not declared in the structure file' };
    if (!/^\d{5,25}$/.test(String(discordId || ''))) return { ok: false, error: 'that member could not be read' };

    const [rolesRead, memberRead] = await Promise.all([
        discordRequest(`/guilds/${guild}/roles`, { fetchImpl }),
        discordRequest(`/guilds/${guild}/members/${discordId}`, { fetchImpl }),
    ]);
    if (!rolesRead.ok) return { ok: false, error: `the server roles could not be read (${rolesRead.message})` };
    if (!memberRead.ok) return { ok: false, error: `that member could not be read (${memberRead.message})` };

    const target = (rolesRead.data || []).find((entry) => String(entry.name).toLowerCase() === role.name.toLowerCase());
    if (!target) return { ok: false, error: `${role.name} does not exist on the server yet` };

    const held = (memberRead.data?.roles || []).map(String);
    if (held.includes(String(target.id))) return { ok: true, already: true, role: role.name };

    const written = await discordRequest(`/guilds/${guild}/members/${discordId}/roles/${target.id}`, {
        method: 'PUT',
        fetchImpl,
    });
    if (!written.ok) {
        // A 403 here is almost always the one thing a human has to fix, so it is named rather than
        // left as \"request failed\": the bot's own role has to sit above the role it hands out.
        const hint = written.status === 403
            ? ` (the bot's role has to sit above ${role.name}: Server Settings > Roles)`
            : '';
        return { ok: false, error: `${written.message}${hint}` };
    }
    return { ok: true, already: false, role: role.name };
}

/**
 * What the presser is told.
 *
 * One place, so the button and its words cannot drift apart, and so the three answers are visibly
 * different from each other: a first press, a repeat press, and a failure should not read the same.
 */
export function gateAnswer(result) {
    if (result?.ok && result.already) return 'You were already through the gate. Arya nods.';
    if (result?.ok) return 'Verified. The realm, the vault and the voice rooms are open. Say hello in #general.';
    return `The gate did not open: ${result?.error || 'something went wrong on our side'}. Press it again in a moment, and if it stays shut, say so in #support.`;
}
