/**
 * The Points Program's rules, server side.
 *
 * Every award happens here rather than in the browser: the client says "floor 2 is
 * cleared", the server decides whether that pays, how much, and whether anyone up the
 * referral chain earned a commission. That is what makes a shared leaderboard possible
 * at all — and it means a wallet can only be paid once a day per floor no matter how
 * many times the page is reloaded.
 */

import {
    VAULT_LEVELS, VAULT_ENTRY_TOTAL, REFERRAL_1ST_PCT, REFERRAL_2ND_PCT,
    commission, todayKey,
} from './points-config.js';
import {
    STORAGE_DRIVER, blankWallet, getWallet, normaliseAddress, rankOf, topWallets, updateWallet,
    walletCount,
} from './points-store.js';

export { VAULT_LEVELS, VAULT_ENTRY_TOTAL };

function short(address) {
    return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '';
}

/** Levels cleared today, as a sorted array of indices. */
function clearedToday(doc, day = todayKey()) {
    const levels = doc.levelsCleared?.[day];
    return Array.isArray(levels) ? [...levels].sort((a, b) => a - b) : [];
}

/** Points earned from today's floors so far — what the share bonus doubles. */
function entryTotalToday(doc, day = todayKey()) {
    return clearedToday(doc, day).reduce((sum, i) => sum + (VAULT_LEVELS[i]?.points || 0), 0);
}

/** The shape the page renders. Never exposes anything secret. */
export async function stateFor(address) {
    const key = normaliseAddress(address);
    if (!key) return null;
    const doc = (await getWallet(key)) || blankWallet(key);
    const day = todayKey();
    const cleared = clearedToday(doc, day);
    const [rank, players] = await Promise.all([rankOf(key), walletCount()]);

    const ledger = doc.referralLedger || {};
    const referrals = await Promise.all((doc.referrals || []).map(async (addr) => {
        const them = await getWallet(addr);
        return {
            address: addr,
            short: short(addr),
            points: ledger[addr] || 0,      // what you have been paid for them
            theirPoints: them?.points || 0, // what they have earned themselves
        };
    }));

    return {
        address: key,
        points: doc.points,
        rank,
        players,
        clearedToday: cleared,
        entryComplete: cleared.length >= VAULT_LEVELS.length,
        entryTotalToday: entryTotalToday(doc, day),
        entryTotal: VAULT_ENTRY_TOTAL,
        sharedToday: doc.sharedOn?.[day] === true,
        entries: doc.entries || 0,
        referrals,
        referrer: doc.referrer || null,
        referralEarned: doc.referralEarned || 0,
        firstSeenAt: doc.firstSeenAt,
        // Where the points actually live. Reported so the page can say plainly when a
        // deployment is storing them somewhere that will not survive a restart, instead
        // of letting a player watch their total disappear with no explanation.
        storage: { driver: STORAGE_DRIVER, persistent: STORAGE_DRIVER !== 'memory' },
    };
}

/**
 * Touch a wallet on connect and claim a referral code if one was carried in the link.
 * A code can only be claimed once per wallet, never by the wallet itself, and never in
 * place of an existing referrer.
 */
export async function registerVisit(address, refCode) {
    const key = normaliseAddress(address);
    if (!key) return null;
    const ref = normaliseAddress(refCode);

    const doc = await updateWallet(key, (w) => {
        if (!w.firstSeenAt) w.firstSeenAt = new Date().toISOString();
        return w;
    });

    if (!ref || ref === key) return doc;
    if (doc.referrer) return doc;                       // first referrer wins, permanently
    const referrer = await getWallet(ref);
    if (!referrer) return doc;                          // the code must be a wallet we know

    await updateWallet(key, (w) => {
        // Re-check inside the write: two tabs could have raced here.
        if (!w.referrer) w.referrer = ref;
        return w;
    });
    await updateWallet(ref, (w) => {
        if (!w.referrals.includes(key)) w.referrals.push(key);
        return w;
    });
    return getWallet(key);
}

/**
 * Credit wallet `address` and pay the referral chain for it.
 * Returns the amount actually credited (floored to whole points).
 */
async function credit(address, amount, reason) {
    const value = Math.floor(amount);
    if (!value) return 0;
    const doc = await updateWallet(address, (w) => {
        w.points += value;
        w.lastEarnedReason = reason;
        return w;
    });

    // Commissions: 15% to whoever referred this wallet, 5% to whoever referred them.
    const referrer = doc?.referrer ? await getWallet(doc.referrer) : null;
    if (!referrer) return value;

    const first = commission(value, REFERRAL_1ST_PCT);
    if (first) {
        await updateWallet(referrer.address, (w) => {
            w.points += first;
            w.referralEarned = (w.referralEarned || 0) + first;
            w.referralLedger = { ...(w.referralLedger || {}) };
            w.referralLedger[address] = (w.referralLedger[address] || 0) + first;
            return w;
        });
    }

    const secondAddress = referrer.referrer;
    const fifth = commission(value, REFERRAL_2ND_PCT);
    if (secondAddress && fifth) {
        const second = await getWallet(secondAddress);
        if (second) {
            await updateWallet(second.address, (w) => {
                w.points += fifth;
                w.referralEarned = (w.referralEarned || 0) + fifth;
                w.referralLedger = { ...(w.referralLedger || {}) };
                w.referralLedger[address] = (w.referralLedger[address] || 0) + fifth;
                return w;
            });
        }
    }
    return value;
}

/**
 * A floor was cleared. Pays once per day per floor, and only for floors in order —
 * floor 3 cannot be claimed before floor 1, so the payout can't be short-circuited by
 * re-entering the vault at the last stage.
 */
export async function clearLevel(address, level) {
    const key = normaliseAddress(address);
    const index = Number(level);
    if (!key || !Number.isInteger(index) || index < 0 || index >= VAULT_LEVELS.length) {
        return { error: 'invalid level' };
    }
    const day = todayKey();
    // A signed session is proof enough that the wallet exists; its first clear creates
    // the record. Requiring a prior record here would reject every brand-new player.
    const existing = (await getWallet(key)) || blankWallet(key);

    const cleared = clearedToday(existing, day);
    if (cleared.includes(index)) {
        return { credited: 0, alreadyCleared: true, state: await stateFor(key) };
    }
    const expected = cleared.length;              // floors must be cleared in sequence
    if (index !== expected) {
        return { error: `floor ${expected + 1} has to be cleared first` };
    }

    const amount = VAULT_LEVELS[index].points;
    const credited = await credit(key, amount, `vault_level_${index + 1}`);
    await updateWallet(key, (w) => {
        const list = Array.isArray(w.levelsCleared?.[day]) ? w.levelsCleared[day] : [];
        if (!list.includes(index)) list.push(index);
        // Keep only today: the daily reset is the whole point of the field.
        w.levelsCleared = { [day]: list };
        if (list.length === VAULT_LEVELS.length) w.entries = (w.entries || 0) + 1;
        return w;
    });

    return { credited, state: await stateFor(key) };
}

/** Share on X: pays today's cleared total a second time, once a day. */
export async function shareEntry(address) {
    const key = normaliseAddress(address);
    if (!key) return { error: 'invalid address' };
    const day = todayKey();
    const existing = (await getWallet(key)) || blankWallet(key);
    if (existing.sharedOn?.[day] === true) {
        return { credited: 0, alreadyShared: true, state: await stateFor(key) };
    }
    const earned = entryTotalToday(existing, day);
    if (earned <= 0) return { error: 'clear a floor before sharing' };

    const credited = await credit(key, earned, 'vault_share_bonus');
    await updateWallet(key, (w) => {
        w.sharedOn = { [day]: true };
        return w;
    });
    return { credited, state: await stateFor(key) };
}

/** The public board. `me` is only used so the page can mark the caller's row. */
export async function leaderboard(limit = 25, me = null) {
    const wallets = await topWallets(limit);
    const mine = normaliseAddress(me);
    return wallets.map((w, i) => ({
        rank: i + 1,
        address: w.address,
        short: short(w.address),
        points: w.points,
        refs: (w.referrals || []).length,
        isYou: !!mine && w.address === mine,
    }));
}
