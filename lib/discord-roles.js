/**
 * Deciding which roles a linked wallet has earned, from facts we can actually read.
 *
 * THREE SOURCES, THREE KINDS OF CERTAINTY
 * ---------------------------------------
 *   - **the summoning collection** has an address on every deployment, and `readOwnedKnights` already
 *     knows how to read it (balance first, then ids, with a log scan only when the collection cannot
 *     enumerate). A failure there is a chain problem, reported as such.
 *   - **the Genesis collection** may have no address at all. `ADDRESSES.genesisNFT` is empty until
 *     the deployment is pointed at it, and a role that cannot be read cannot be granted — so the
 *     result says `unknown: ['genesis']` rather than "holds none". That distinction is the whole
 *     safety property of this file: a read that failed must never look like a player who sold.
 *   - **points** come from the program's own store, which is ours and always readable unless Redis is
 *     down.
 *
 * WHAT A FAILED READ DOES
 * -----------------------
 * Nothing is removed. When a source is unreadable, the sync keeps whatever the member already has
 * from that source and only adds what other sources prove. The alternative (treating an outage as
 * "holds zero") strips roles from paying players during a bad five minutes, and a role that
 * disappears and comes back is worse than one that arrives a little late.
 *
 * WHAT IT WILL NEVER TOUCH
 * ------------------------
 * Staff roles. `keeper`, `sentinel` and `herald` are given by hand, and the sync only ever adds or
 * removes the five synced roles. The member's other roles are carried through the write unchanged,
 * which matters because the API call used here replaces the whole role list: a reconciler that did
 * not preserve the rest would quietly remove somebody's staff role the first time they ran /claim.
 */

import { ADDRESSES } from './game-runs.js';
import { readOwnedKnights } from './staking-chain.js';
import { getWallet } from './points-store.js';
import { ROLES, SYNCED_ROLE_KEYS } from './discord-structure.js';
import { discordRequest, guildId } from './discord-api.js';

/** The thresholds, read from the one file that declares them. Sorted high to low. */
export const POINT_TIERS = ROLES
    .filter((role) => role.grant?.source === 'points')
    .map((role) => ({ key: role.key, name: role.name, at: role.grant.at }))
    .sort((a, b) => b.at - a.at);

/** A role key by its Discord name, for turning API role objects back into what this file talks about. */
export function roleKeyByName(name) {
    return ROLES.find((role) => role.name.toLowerCase() === String(name || '').toLowerCase())?.key || null;
}

/**
 * The roles a set of facts earns. Pure, so the thresholds can be tested at their boundaries.
 *
 * `points` is the highest tier reached, not a stack: a Warden does not also need the Squire role, and
 * handing somebody three badges for the same number makes the sidebar meaningless.
 */
export function rolesForFacts({ knights = null, genesis = null, points = null } = {}) {
    const earned = [];
    const unknown = [];

    if (knights?.ok) {
        if (Number(knights.count) >= 1) earned.push('knight');
    } else {
        unknown.push('knights');
    }

    if (genesis?.ok) {
        if (Number(genesis.count) >= 1) earned.push('genesis');
    } else {
        unknown.push('genesis');
    }

    if (points?.ok) {
        const value = Number(points.value) || 0;
        const tier = POINT_TIERS.find((entry) => value >= entry.at);
        if (tier) earned.push(tier.key);
    } else {
        unknown.push('points');
    }

    return { roles: earned, unknown };
}

/**
 * What to add and what to take away, against the roles a member already has.
 *
 * Additions may only be roles this file earns. Removals may only be synced roles whose source was
 * readable — a source that could not be read keeps its role, which is the line stated at the top of
 * this module and the one the harness falsifies by handing it an unreadable source.
 */
export function reconcileRoles({ currentRoleIds = [], roleIdsByKey = {}, earned = [], unknown = [] } = {}) {
    const held = new Set(currentRoleIds.map(String));
    const owned = new Map();
    for (const key of SYNCED_ROLE_KEYS) {
        const id = roleIdsByKey[key];
        if (id) owned.set(key, String(id));
    }

    const add = [];
    for (const key of earned) {
        const id = owned.get(key);
        if (id && !held.has(id)) add.push(id);
    }

    // A source that was unreadable keeps its role: `unknown` names sources, and the role keys that
    // hang off a source are worked out here rather than being passed in twice.
    const blindSources = new Set(unknown);
    const removable = SYNCED_ROLE_KEYS.filter((key) => {
        const grant = ROLES.find((role) => role.key === key)?.grant || {};
        return !blindSources.has(grant.source);
    });

    const remove = [];
    for (const key of removable) {
        const id = owned.get(key);
        // Higher tiers subsume lower ones, so the tier check is "is it earned" rather than "is it the
        // top one": the caller has already reduced the points to a single role.
        if (id && held.has(id) && !earned.includes(key)) remove.push(id);
    }

    return { add, remove };
}

/** Read the three facts for one wallet. Never throws: a source that fails comes back as not-ok. */
export async function factsFor(address, { fetchImpl = fetch } = {}) {
    const wallet = String(address || '').toLowerCase();
    const [knights, genesis, doc] = await Promise.all([
        readOwnedKnights(wallet).catch((error) => ({ ok: false, reason: String(error?.message || error) })),
        ADDRESSES.genesisNFT
            ? readOwnedKnights(wallet, { nftAddress: ADDRESSES.genesisNFT }).catch((error) => ({ ok: false, reason: String(error?.message || error) }))
            : Promise.resolve({ ok: false, reason: 'this deployment has no Genesis collection address (GENESIS_NFT is unset)' }),
        getWallet(wallet).catch(() => null),
    ]);

    return {
        knights: { ok: knights?.ok === true, count: knights?.ids?.length ?? knights?.count ?? 0, reason: knights?.reason || null },
        genesis: { ok: genesis?.ok === true, count: genesis?.ids?.length ?? genesis?.count ?? 0, reason: genesis?.reason || null },
        points: { ok: doc !== null, value: doc?.points || 0 },
        // Carried through for the tool's output, which should be able to say *why* a role was not
        // granted rather than leaving the reader to guess at an outage.
        reasons: { knights: knights?.reason || null, genesis: genesis?.reason || null },
        _fetchImpl: fetchImpl,
    };
}

/**
 * Bring a member's roles in line with their wallet.
 *
 * Returns what it did, in role keys, so the caller can answer `/claim` with a sentence instead of a
 * shrug. `roles` on the guild is read fresh every time: a role created after the bot was invited has
 * an id nobody cached, and granting by name is not a thing the API offers.
 */
export async function syncMemberRoles(discordId, address, { fetchImpl = fetch, guild = guildId() } = {}) {
    if (!/^\d{5,25}$/.test(String(discordId || ''))) return { ok: false, error: 'no discord member' };
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(address || ''))) return { ok: false, error: 'no wallet' };

    const [rolesRead, memberRead, facts] = await Promise.all([
        discordRequest(`/guilds/${guild}/roles`, { fetchImpl }),
        discordRequest(`/guilds/${guild}/members/${discordId}`, { fetchImpl }),
        factsFor(address, { fetchImpl }),
    ]);

    if (!rolesRead.ok) return { ok: false, error: `could not read the server roles: ${rolesRead.message}` };
    if (!memberRead.ok) return { ok: false, error: `could not read that member: ${memberRead.message}` };

    const roleIdsByKey = {};
    for (const role of rolesRead.data || []) {
        const key = roleKeyByName(role.name);
        if (key) roleIdsByKey[key] = String(role.id);
    }

    const earned = rolesForFacts(facts);
    const current = (memberRead.data?.roles || []).map(String);
    const { add, remove } = reconcileRoles({ currentRoleIds: current, roleIdsByKey, earned: earned.roles, unknown: earned.unknown });

    const names = (keys) => keys.map((key) => ROLES.find((role) => role.key === key)?.name || key);
    const summary = {
        ok: true,
        granted: names(earned.roles),
        removed: names(SYNCED_ROLE_KEYS.filter((key) => {
            const id = roleIdsByKey[key];
            return id && current.includes(id) && !earned.roles.includes(key);
        })),
        unknown: earned.unknown,
        facts: { knights: facts.knights, genesis: facts.genesis, points: facts.points },
    };

    if (!add.length && !remove.length) return summary;

    // The write replaces the whole list, so it is the member's current roles minus what we are taking
    // away plus what we are giving, and nothing else about their membership is touched.
    const next = [...new Set([...current.filter((id) => !remove.includes(id)), ...add])];
    const written = await discordRequest(`/guilds/${guild}/members/${discordId}`, {
        method: 'PATCH',
        body: { roles: next },
        fetchImpl,
    });
    if (!written.ok) {
        // A 403 here is almost always the one thing a human has to fix, so it is named rather than
        // left as "request failed": the bot's own role has to sit above every role it hands out.
        const hint = written.status === 403
            ? ' (the bot\'s role has to sit above the roles it grants: Server Settings > Roles)'
            : '';
        return { ...summary, ok: false, error: `${written.message}${hint}` };
    }

    return summary;
}
