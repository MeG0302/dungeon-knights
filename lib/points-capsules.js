/**
 * Capsules a wallet has won, and how one is claimed.
 *
 * The draw (`lib/points-draw.js`) decides who won and writes the win onto the wallet. This file is
 * the other half: what the list looks like to the player, the signature that proves the wallet, and
 * the per-day claim that goes with it.
 *
 * ## The ladder, and why the last rung is not ours
 *
 *     won ──sign──▶ claimed ──(the team reads the form and sends)──▶ sent
 *      └── the claim window closes ──▶ missed
 *
 * `won`, `claimed` and `missed` are computed from the record and the clock on every read, so a window
 * closing is not an event somebody has to run a job for. `sent` is the only rung that is a fact about
 * the world rather than about us — it is written by the fulfilment tool when a capsule actually
 * leaves — which is why it is the only one stored as a status.
 *
 * ## Why a claim is a signature and not a button
 *
 * The team is going to send a valuable thing to an address, and the address has to be *the player's*.
 * A click proves nothing about that; a signature proves exactly it, and it can be checked before
 * anybody sends anything. The message names the wallet, the purpose and **the day** (see
 * `lib/capsule-claims.js`), which is what makes the owner's rule hold: a winner submits their wallet
 * for the capsule they won, on the day they won it, and yesterday's signature is worth nothing today.
 *
 * ## Until the capsule contract exists
 *
 * There is nowhere on chain to put a capsule yet — `contracts/Capsules.sol` mints only for the weekly
 * raffle, and that is the right place for it to mint only for the draw it owns. So the prize is
 * recorded here, the winner hands their address over through the form, and the tool
 * (`tools/points-capsules.js`) is what the team fulfils from. The page says all of that in as many
 * words rather than implying a delivery that has not happened.
 */

import {
    CAPSULE_CLAIM_WINDOW_DAYS, CAPSULE_FORM_URL, DRAW_CAPSULE, DRAW_SIZE,
    dayMarker, nextDayKey, nextDrawAt, programDay, todayKey,
} from './points-config.js';
import { signatureDigest, verifyCapsuleChallenge } from './capsule-claims.js';
import { blankWallet, dailyPointsFor, dailyRankOf, getWallet, normaliseAddress, updateWallet } from './points-store.js';
import { dayBoard, latestDraw, newsFeed } from './points-draw.js';

/**
 * The first day a win for `day` can no longer be claimed, exclusive.
 *
 * The window starts on the **day the draw settles**, not on the day it ranks — a day's capsules are
 * decided at the next UTC midnight, so a win on the 25th does not exist to claim until the 26th. With
 * the one-day window that is the owner's rule, that leaves exactly one day to claim it: the 26th.
 * Getting this off by one would either close the window the instant it opened or quietly let a win be
 * claimed two days later, and either way the site would be lying about which day it was.
 */
function claimDeadline(day, windowDays = CAPSULE_CLAIM_WINDOW_DAYS) {
    let deadline = day;
    for (let i = 0; i < 1 + Math.max(1, windowDays); i += 1) deadline = nextDayKey(deadline);
    return deadline;
}

/**
 * Is this win still claimable?
 *
 * The comparison is on day keys rather than on times, because the day is the unit the player was
 * promised: `today < deadline`.
 */
export function isClaimable(day, now = new Date(), windowDays = CAPSULE_CLAIM_WINDOW_DAYS) {
    if (!day) return false;
    return todayKey(now) < claimDeadline(day, windowDays);
}

/**
 * One capsule, as the page renders it.
 *
 * The status is derived, never trusted: a record that says `claimed` but carries no claim is not
 * claimed, and a window that has closed is `missed` whether or not anything got round to saying so.
 */
export function capsuleView(record, now = new Date(), windowDays = CAPSULE_CLAIM_WINDOW_DAYS) {
    if (!record?.day) return null;
    const sent = record.status === 'sent';
    const claimed = Boolean(record.claimedAt);
    const open = isClaimable(record.day, now, windowDays);
    return {
        day: record.day,
        dayNumber: record.dayNumber ?? programDay(record.day),
        label: dayMarker(record.day),
        capsule: record.capsule || DRAW_CAPSULE,
        points: Number(record.points) || 0,
        rank: record.rank ?? null,
        wonAt: record.wonAt || null,
        claimedAt: record.claimedAt || null,
        formSubmittedAt: record.formSubmittedAt || null,
        sentAt: record.sentAt || null,
        sentNote: record.sentNote || null,
        status: sent ? 'sent' : claimed ? 'claimed' : open ? 'won' : 'missed',
        claimable: !sent && !claimed && open,
    };
}

/** Every capsule a wallet holds, newest day first. */
export function capsuleList(doc, now = new Date(), windowDays = CAPSULE_CLAIM_WINDOW_DAYS) {
    const records = Object.values(doc?.capsules || {});
    return records
        .map((record) => capsuleView(record, now, windowDays))
        .filter(Boolean)
        .sort((a, b) => (a.day < b.day ? 1 : -1));
}

/** The one waiting on the player right now: claimable, and not yet claimed. */
export function openCapsule(doc, now = new Date()) {
    return capsuleList(doc, now).find((row) => row.claimable) || null;
}

/**
 * What the whole draw looks like to one wallet (or to nobody, when there is no wallet).
 *
 * `doc` is accepted so a caller that has just read the wallet — `stateFor`, which is every signed-in
 * page load — does not read it a second time for the capsules it already holds.
 */
export async function giveawayView(address, { now = new Date(), doc: loaded = null } = {}) {
    const key = normaliseAddress(address);
    const day = todayKey(now);
    const doc = key ? (loaded || (await getWallet(key)) || blankWallet(key)) : null;

    const [board, myPoints, myRank, latest, news] = await Promise.all([
        dayBoard(day, DRAW_SIZE, key),
        key ? dailyPointsFor(key, day) : 0,
        key ? dailyRankOf(key, day) : null,
        latestDraw(),
        // The announcements feed rides along: it is the same for everybody, it is written by the same
        // event that drew the capsules, and the tab that shows it is one click from this panel.
        newsFeed(8),
    ]);

    const capsules = doc ? capsuleList(doc, now) : [];
    return {
        // The competition being run right now.
        day,
        dayNumber: programDay(day),
        size: DRAW_SIZE,
        capsule: DRAW_CAPSULE,
        board,
        // What the next drawing closes: an instant, so the page counts down to the server's midnight
        // rather than to whatever the player's clock believes.
        nextDrawAt: nextDrawAt(now),
        claimWindowDays: CAPSULE_CLAIM_WINDOW_DAYS,
        formUrl: CAPSULE_FORM_URL,
        // The player's own day, and nothing about anybody else's totals.
        mine: key
            ? { points: myPoints, rank: myRank, onBoard: myRank !== null }
            : null,
        // Their capsules, the one to claim now, and whether a win has not been looked at yet.
        capsules,
        open: doc ? openCapsule(doc, now) : null,
        notice: doc?.capsuleNotice || null,
        registration: doc?.registration
            ? { at: doc.registration.at || null, address: doc.registration.address || key, via: doc.registration.via || 'signature' }
            : null,
        latest,
        news,
    };
}

/**
 * Prove the wallet once, so a capsule can be sent to it.
 *
 * Signing is the whole of the requirement: the address in the message is compared with the address
 * the signature recovers, and there is nothing else a player could do here that would be worth
 * anything. Repeated calls are harmless — the first registration is the one kept, and a later one
 * only records that the wallet was still in the player's hands.
 */
export async function registerWallet(address, { message, signature } = {}) {
    const key = normaliseAddress(address);
    if (!key) return { error: 'Connect a wallet first.', code: 'no-wallet' };

    const proof = verifyCapsuleChallenge(signature, message, { purpose: 'register', address: key });
    if (!proof) {
        return {
            error: 'That is not a registration for this wallet. Press the button again and sign the message your wallet shows.',
            code: 'bad-signature',
        };
    }

    const at = new Date().toISOString();
    const doc = await updateWallet(key, (w) => {
        if (!w.registration) {
            w.registration = {
                at,
                address: key,
                purpose: 'register',
                via: 'signature',
                digest: signatureDigest(signature),
            };
        } else {
            w.registration.refreshedAt = at;
        }
        return w;
    });

    return {
        ok: true,
        address: key,
        registration: doc?.registration || null,
        capsules: capsuleList(doc),
        message: 'Wallet registered. A capsule you win can be sent to it.',
    };
}

/**
 * Claim the capsule for one day.
 *
 * The caller says which day it is claiming and the signature has to be **for that day** — the
 * comparison is in `verifyCapsuleChallenge`, so a message signed for another day cannot be spent
 * here even by a caller that forgot to look. Everything after that is a check on the record: the day
 * has to have a win, the win has to be unpaid, and the window has to still be open. A claim inside
 * its window is recorded once; a second identical claim answers with the claim that already exists
 * rather than an error, because a player pressing a button twice has done nothing wrong.
 */
export async function claimCapsule(address, { day, message, signature } = {}) {
    const key = normaliseAddress(address);
    if (!key) return { error: 'Connect a wallet first.', code: 'no-wallet' };

    const wanted = String(day || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(wanted)) {
        return { error: 'Which day is this capsule for?', code: 'bad-day' };
    }

    const proof = verifyCapsuleChallenge(signature, message, { purpose: 'claim', day: wanted, address: key });
    if (!proof) {
        return {
            error: 'That signature is not a claim for that day. Open the claim again and sign the message your wallet shows.',
            code: 'bad-signature',
        };
    }

    const before = (await getWallet(key)) || blankWallet(key);
    const record = before.capsules?.[wanted];
    if (!record) return { error: 'No capsule was won on that day.', code: 'no-capsule' };
    if (record.status === 'sent') {
        return { ok: true, already: true, message: 'That capsule has already been sent.', state: await capsuleState(key) };
    }
    if (record.claimedAt) {
        return { ok: true, already: true, message: 'That capsule is already claimed.', state: await capsuleState(key) };
    }
    if (!isClaimable(wanted)) {
        return {
            error: `${dayMarker(wanted)} is closed. A capsule has to be claimed on the day it is drawn.`,
            code: 'window-closed',
            state: await capsuleState(key),
        };
    }

    const at = new Date().toISOString();
    const doc = await updateWallet(key, (w) => {
        w.capsules = w.capsules && typeof w.capsules === 'object' ? w.capsules : {};
        const stored = w.capsules[wanted];
        if (!stored) return w;
        // Re-checked inside the write: two taps race the read above, and only one may stamp the claim.
        if (!stored.claimedAt) {
            stored.claimedAt = at;
            stored.claimSigHash = signatureDigest(signature);
            stored.status = 'claimed';
        }
        // Claiming registers the wallet too, so a winner never has to find a second button.
        if (!w.registration) {
            w.registration = {
                at,
                address: key,
                purpose: 'claim',
                via: 'claim',
                digest: signatureDigest(signature),
            };
        }
        return w;
    });

    return {
        ok: true,
        address: key,
        claimed: capsuleView(doc?.capsules?.[wanted]),
        capsules: capsuleList(doc),
        message: 'Claimed. Submit your wallet in the capsule form and it will be sent to the address you register.',
    };
}

/**
 * Record that the player says they have submitted the form.
 *
 * Self-declared, and labelled as such everywhere it is shown: the form is a Google Form this project
 * cannot read, so the honest thing is a marker the team can check against the responses rather than a
 * status that pretends to be a receipt.
 */
export async function markFormSubmitted(address, day) {
    const key = normaliseAddress(address);
    const wanted = String(day || '').trim();
    if (!key) return { error: 'Connect a wallet first.', code: 'no-wallet' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(wanted)) return { error: 'Which day was that for?', code: 'bad-day' };

    const before = (await getWallet(key)) || blankWallet(key);
    if (!before.capsules?.[wanted]) return { error: 'No capsule was won on that day.', code: 'no-capsule' };

    const at = new Date().toISOString();
    const doc = await updateWallet(key, (w) => {
        const stored = w.capsules?.[wanted];
        if (stored && !stored.formSubmittedAt) stored.formSubmittedAt = at;
        return w;
    });
    return { ok: true, capsules: capsuleList(doc), message: 'Thanks — marked as submitted.' };
}

/** Everything this file knows about a wallet, in one object. */
export async function capsuleState(address) {
    const doc = (await getWallet(address)) || blankWallet(address);
    return {
        capsules: capsuleList(doc),
        open: openCapsule(doc),
        registration: doc.registration || null,
        notice: doc.capsuleNotice || null,
    };
}
