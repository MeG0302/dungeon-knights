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
 * Claiming **files the win** as well as stamping it: the wallet and the day it won are posted into
 * the team's form by the server (`lib/capsule-form.js`), so the delivery note is written by the
 * event that earned it rather than by a winner who has to remember to paste an address afterwards.
 * A form that cannot be reached does not fail the claim — the record says so, and the card offers
 * the link by hand.
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
 * recorded here, the claim files the address with the team, and the tool (`tools/points-capsules.js`)
 * is what the team fulfils from. The page says all of that in as many words rather than implying a
 * delivery that has not happened.
 */

import {
    CAPSULE_CLAIM_WINDOW_DAYS, CAPSULE_FORM_URL, DRAW_CAPSULE, DRAW_SIZE,
    capsuleFormNeedsSignIn, dayMarker, nextDayKey, nextDrawAt, programDay,
    relativeDayLabel, todayKey,
} from './points-config.js';
import { signatureDigest, verifyCapsuleChallenge } from './capsule-claims.js';
import { submitCapsuleEntry } from './capsule-form.js';
import { blankWallet, dailyPointsFor, dailyRankOf, getWallet, normaliseAddress, updateWallet } from './points-store.js';
import { dayBoardCut, latestDraw, newsFeed } from './points-draw.js';

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
        // The day it was won, in words. A ledger row that prints only a date makes the reader work
        // out whether the window is still open, and that is the whole question on a won capsule.
        when: relativeDayLabel(record.day, now),
        capsule: record.capsule || DRAW_CAPSULE,
        points: Number(record.points) || 0,
        rank: record.rank ?? null,
        wonAt: record.wonAt || null,
        claimedAt: record.claimedAt || null,
        formSubmittedAt: record.formSubmittedAt || null,
        sentAt: record.sentAt || null,
        sentNote: record.sentNote || null,
        // How the win reached the form, which is the difference between "there is nothing left for
        // you to do" and "this one needs your hand": `server` when the claim filed it, `player`
        // when somebody marked it in the form themselves.
        formVia: record.formSubmittedVia || (record.formSubmittedAt ? 'player' : null),
        formError: record.formError || null,
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
        // The whole board, not the ten: the rows below the cut are the wallets tied with the tenth,
        // and the panel shows them because a tie at the cut is a rule working, not a mystery.
        dayBoardCut(day, { me: key }),
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
        board: board.board,
        // The cut line, and who is standing on it: `{ points, level, contenders, truncated }`, or null
        // while fewer than ten wallets have earned (a short field is paid in full, so there is no line).
        cut: board.cut,
        // What the next drawing closes: an instant, so the page counts down to the server's midnight
        // rather than to whatever the player's clock believes.
        nextDrawAt: nextDrawAt(now),
        claimWindowDays: CAPSULE_CLAIM_WINDOW_DAYS,
        formUrl: CAPSULE_FORM_URL,
        // Whether that link is a published form or a Docs editor link only its owner can open. Read
        // from the link rather than asserted, so the card's sentence is true of whatever link is
        // configured today — see `capsuleFormNeedsSignIn`.
        formNeedsSignIn: capsuleFormNeedsSignIn(CAPSULE_FORM_URL),
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
 *
 * **A claim files the win too** — see `fileCapsuleWin` below. That happens after the record is
 * written, never inside it: the store mutation is the claim, and the delivery note is a network call
 * that may not land. The answer says which of the two happened, because the card's next sentence is
 * "nothing left to do" or "here is the form".
 *
 * `formUrl` and `fetchImpl` are seams for a caller that wants to decide where a claim is filed — the
 * harness points them at a form of its own, so nothing in the checks writes into the owner's sheet.
 */
export async function claimCapsule(address, { day, message, signature, formUrl = CAPSULE_FORM_URL, fetchImpl } = {}) {
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

    // The delivery note. Deliberately after the write and deliberately allowed to fail: the capsule is
    // claimed either way, and what the player is told next depends on whether we filed it for them.
    const filed = await fileCapsuleWin(key, wanted, { formUrl, fetchImpl });
    const after = (await getWallet(key)) || doc;

    return {
        ok: true,
        address: key,
        claimed: capsuleView(after?.capsules?.[wanted]),
        capsules: capsuleList(after),
        filed: filed.ok === true,
        filedError: filed.ok ? null : (filed.error || 'the form could not be filled'),
        message: filed.ok
            ? 'Claimed. Your wallet is with us, with the day you won — nothing to paste. When the mainnet goes live your knight capsule will be sent to you.'
            : 'Claimed. We could not file your wallet automatically — open the form and hand the address above over by hand.',
    };
}

/**
 * File one win into the team's form: wallet and day, posted by the server.
 *
 * Written as its own export because two callers need it — the claim, and `tools/points-capsules.js`
 * catching up the wins that were drawn before any of this existed (or before a form link changed).
 * The record is only stamped when the post actually succeeds: a form that was down for a minute must
 * leave the win looking unfiled, or the next run of the tool would skip it as already-done.
 */
export async function fileCapsuleWin(address, day, { formUrl = CAPSULE_FORM_URL, fetchImpl, force = false } = {}) {
    const key = normaliseAddress(address);
    const wanted = String(day || '').trim();
    if (!key) return { ok: false, error: 'Connect a wallet first.', code: 'no-wallet' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(wanted)) return { ok: false, error: 'Which day was that for?', code: 'bad-day' };

    const before = (await getWallet(key)) || blankWallet(key);
    const stored = before.capsules?.[wanted];
    if (!stored) return { ok: false, error: 'No capsule was won on that day.', code: 'no-capsule' };
    // Already filed, and filing again would be a second row in the sheet for one capsule — so a
    // repeat is answered, not repeated. `force` is for the day a form is replaced and every entry has
    // to be written again, which is the owner's decision and not this function's.
    if (stored.formSubmittedAt && !force) {
        return { ok: true, already: true, at: stored.formSubmittedAt, address: key, day: wanted, values: {} };
    }

    const result = await submitCapsuleEntry({ formUrl, address: key, day: wanted, fetchImpl });
    if (!result.ok) {
        const reason = String(result.error || 'the form refused the entry').slice(0, 160);
        await updateWallet(key, (w) => {
            const stored = w.capsules?.[wanted];
            // Never over a filing that already happened: a retry that fails must not erase a success.
            if (stored && !stored.formSubmittedAt) stored.formError = reason;
            return w;
        });
        return { ok: false, error: reason, code: 'form-failed' };
    }

    const at = new Date().toISOString();
    await updateWallet(key, (w) => {
        const stored = w.capsules?.[wanted];
        if (stored && !stored.formSubmittedAt) {
            stored.formSubmittedAt = at;
            stored.formSubmittedVia = 'server';
            stored.formError = null;
        }
        return w;
    });
    return { ok: true, at, address: key, day: wanted, values: result.values || {} };
}

/**
 * Record that the player says they handed the wallet over in the form themselves.
 *
 * The claim files the win on its own now, so this is the **fallback** — the path a player takes on the
 * card when the automatic post did not land, or when they would rather fill the form in by hand. It
 * stays self-declared and labelled that way: this says a person believes they submitted something,
 * while `formSubmittedVia: 'server'` says the server watched it land. Two different claims, and the
 * record keeps them apart.
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
        if (stored && !stored.formSubmittedAt) {
            stored.formSubmittedAt = at;
            stored.formSubmittedVia = 'player';
        }
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
