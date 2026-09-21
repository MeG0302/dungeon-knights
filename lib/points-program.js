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
    SITE_LINK_HOST, X_CAMPAIGN_KEYWORD, X_CAMPAIGN_POST, X_ENGAGEMENT_REWARD,
    X_VERIFY_MAX_ATTEMPTS, X_VERIFY_MIN_GAP_SECONDS,
    X_SHARE_TAG, SHARE_CARD_IMAGE, SHARE_OG_IMAGE,
    campaignPostId, campaignTaskId, shareTaskId,
    sharePostText, shareIntentUrl, referralUrl,
    ONE_TIME_TASKS, oneTimeTask, oneTimeTaskByKind,
} from './points-config.js';
import {
    STORAGE_DRIVER, blankWallet, claimGuard, getWallet, normaliseAddress, rankOf, topWallets,
    updateWallet, walletCount, claimXBinding, releaseXBinding, followFact,
    pendingAdd, pendingRemove, pendingList,
} from './points-store.js';
import { parseStatusUrl, statusIdFromUrl, verifyPost } from './x-verify.js';
import { followProofMode } from './x-webhook.js';

export { VAULT_LEVELS, VAULT_ENTRY_TOTAL };

/**
 * The one refusal every award path shares.
 *
 * Earning here is gated on a bound X account, and the gate is enforced **here**, on the server,
 * rather than by hiding a button: the browser is where a claim comes from, never where a rule
 * lives. The code is part of the API so the page can render the bind card on exactly this answer
 * instead of matching on prose.
 */
export const X_REQUIRED = 'x-required';

function xRequired() {
    return {
        error: 'Bind your X account first — points are earned against a named account.',
        code: X_REQUIRED,
    };
}

const X_ID = /^\d{1,25}$/;
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;

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

/**
 * One X task, as the page renders it.
 *
 * `state` is the whole contract: `none` (nothing submitted), `pending` (submitted, X has not
 * confirmed it yet — this is a real state, not an error), `verified` (paid), `failed` (X answered
 * and the post is wrong: the wrong author, without the tag, or without the link) and `expired` (it
 * was never visible to X within the attempt ceiling, or the day it belonged to ended first). "We could not
 * tell" and "you are wrong" are different sentences and the player gets the right one.
 *
 * `daily` marks the share, whose record belongs to a *day*: yesterday's pending submission is not
 * today's attempt. It reads as `none` with the day's timer reset, which is what the player sees
 * on the button, while the old record stays on disk for the log to explain.
 */
function taskView(doc, taskId, reward, day = todayKey(), { daily = false } = {}) {
    if (!taskId) return null;
    const stored = doc?.tasks?.[taskId] || null;
    const record = daily && stored && stored.day !== day ? null : stored;
    const stale = record?.state === 'pending' && Number(record.attempts || 0) >= X_VERIFY_MAX_ATTEMPTS;
    const state = stale ? 'expired' : (record?.state || 'none');
    return {
        id: taskId,
        state,
        reward,
        url: record?.url || null,
        credited: record?.credited || 0,
        attempts: Number(record?.attempts || 0),
        reason: record?.reason || null,
        submittedAt: record?.submittedAt || null,
        verifiedAt: record?.verifiedAt || null,
        lastCheckedAt: record?.lastCheckedAt || null,
        canCheck: state === 'pending',
        day,
    };
}

/**
 * One one-time task, as the page renders it.
 *
 * Its state is only ever `none` or `claimed`: there is nothing to be "pending" about, because
 * nothing about it is asked of X at claim time. That is the honest shape for this tab.
 *
 * The record id is namespaced (`one:follow`) so it can never collide with the X tasks' ids, which
 * live in the same map — `share` and `x:<status id>`.
 *
 * **`proof` and `claimedProof` are two different questions**, and the card needs both. `proof` is
 * what *this deployment* does about the step now — a deployment wired to X's follow webhook checks
 * it, and one that is not takes the player's word. `claimedProof` is what was actually true the day
 * the claim was paid, which does not move when the wiring changes: a claim made under the word is
 * still a claim taken on trust, and the card keeps saying so rather than being retroactively
 * upgraded to "verified".
 *
 * The sentence comes from the server for the same reason the share's text does — a page that read
 * the mode out of its own bundle could advertise a check that no deployment is running.
 */
function oneTimeView(doc, task) {
    const fill = (text) => String(text || '').replace(/\{handle\}/g, X_SHARE_TAG);
    // Two kinds of one-time task, rendered by two different cards: one is taken on the player's
    // word and pays after a review window, the other is checked against a post X is asked about.
    if (task.proof === 'verify') return oneTimePostView(doc, task, fill);
    const record = doc?.tasks?.[`one:${task.id}`] || null;
    const claimed = record?.state === 'verified';
    const pending = isAwaitingReview(record);
    const rejected = record?.state === 'rejected';
    const mode = task.proof === 'claim' ? followProofMode() : task.proof;
    const claimedProof = claimed ? (record.proof || 'claim') : null;
    return {
        id: task.id,
        title: task.title,
        reward: task.reward,
        proof: mode,
        claimedProof,
        blurb: fill(mode === 'webhook' ? task.blurbChecked : task.blurb),
        cta: fill(task.cta),
        url: fill(task.url),
        claimed,
        credited: claimed ? (record.credited || task.reward) : 0,
        claimedOn: claimed && record.verifiedAt ? String(record.verifiedAt).slice(0, 10) : null,
        // A claim inside its window. The page renders the deadline from `settleAt` rather than
        // counting down from a number in its own bundle, so a refresh shows the same minute the
        // server would report — and `reviewWindow` is what the copy promises, kept in step with the
        // window the claim is actually given.
        pending,
        settleAt: pending ? record.settleAfter || null : null,
        reviewMinutes: pending ? record.reviewMinutes ?? null : null,
        reviewWindow: task.review
            ? { minMinutes: task.review.minMinutes, maxMinutes: task.review.maxMinutes }
            : null,
        rejected,
        rejectedOn: rejected && record.reviewedAt ? String(record.reviewedAt).slice(0, 10) : null,
        rejectedNote: rejected ? record.reviewNote || null : null,
        // One line, written here, so what the card says about the claim cannot drift from what the
        // record says happened — the foot of the card is read by every player who has already been
        // paid, and it is the only place that says whether anything was checked.
        claimedNote: !claimed
            ? null
            : (claimedProof === 'webhook'
                ? 'checked against X\u2019s own follow record'
                : (record.review === true
                    ? (record.reviewedBy === 'tool' ? 'approved in review' : 'credited after review')
                    : 'claimed on your word, no check ran')),
        // What the footer says while the claim waits. Written on the server for the same reason the
        // blurbs are: the page must not be the place that decides what a claim's status means.
        pendingNote: pending ? 'Claim received \u00b7 credited after review' : null,
    };
}

/**
 * One quote-repost task, as the page renders it.
 *
 * The record is the campaign's own (`taskView`), because the bargain is the campaign's: a link is
 * pasted, X is asked about it, and `pending` means "not indexed yet" rather than "not paid". What
 * makes it a *one-time* task is the id it is filed under (`one:<id>`, beside the follow's) and that
 * its reward is paid once per wallet, ever.
 *
 * `kind` travels to the page because that is the string `submitTask` will be asked about. A card that
 * rebuilt it from the id is a card that could file a link against the wrong task.
 */
function oneTimePostView(doc, task, fill) {
    const recordId = `one:${task.id}`;
    const record = doc?.tasks?.[recordId] || null;
    const view = taskView(doc, recordId, task.reward);
    const claimed = view.state === 'verified';
    return {
        ...view,
        id: task.id,
        kind: task.kind,
        title: task.title,
        reward: task.reward,
        proof: 'verify',
        hint: fill(task.hint),
        cta: fill(task.cta),
        // Our post — what the card's button opens, and what the player is asked to quote. The link
        // *they* pasted is `url`, in the view above, once they have submitted one.
        postUrl: task.url,
        claimed,
        credited: claimed ? (record?.credited || task.reward) : 0,
        // `pending` here means "waiting on X", which is why it keeps the task out of the tab's badge:
        // the player has nothing to do until X indexes the post, and the card says so with its own
        // Check-again button when they are looking at it.
        pending: view.state === 'pending',
        rejected: false,
    };
}

/**
 * What a task is, what it pays and what its post has to look like.
 *
 * Both tasks are proved by the same module and share its first, non-negotiable expectation — the
 * post was written by the **bound handle**. After that each asks for one thing: the campaign's
 * repost carries our site link, a share tags our account. One verifier, two rewards, and no second
 * place for the rules to drift to; what differs is the amount, the requirement, and how often it
 * pays.
 */
function taskConfig(kind, doc, day = todayKey()) {
    const handle = doc?.x?.username;

    if (kind === 'campaign') {
        const taskId = campaignTaskId();
        if (!taskId) return { error: 'No campaign is running at the moment.', code: 'no-campaign' };
        return {
            taskId,
            kind,
            amount: X_ENGAGEMENT_REWARD,
            expect: {
                handle,
                host: SITE_LINK_HOST,
                keyword: X_CAMPAIGN_KEYWORD,
                statusId: campaignPostId(),
            },
        };
    }

    // The one-time quote-reposts. Same engine, a different bargain: the record lives under
    // `one:<id>` (beside the follow's) and the reward is paid once per wallet, ever — which the
    // existing `settle` already gives, because it refuses a task whose record is already verified.
    const oneTimePost = oneTimeTaskByKind(kind);
    if (oneTimePost) {
        if (oneTimePost.proof !== 'verify') {
            return { error: 'That task is paid on a claim, not against a post.', code: 'not-post-verified' };
        }
        return {
            taskId: `one:${oneTimePost.id}`,
            kind,
            once: true,
            amount: oneTimePost.reward,
            // The two things X will actually answer about the pasted post: that the bound account
            // wrote it, and that it tags us. Which post it quotes is not among them — see the note in
            // `lib/points-config.js`, and the sentence on the card that says so.
            expect: { handle, mention: X_SHARE_TAG },
        };
    }

    if (kind === 'share') {
        const earned = entryTotalToday(doc, day);
        if (earned <= 0) {
            return { error: 'Clear a floor before sharing — there is nothing to double yet.', code: 'nothing-to-double' };
        }
        return {
            taskId: shareTaskId(),
            kind,
            daily: true,
            day,
            // The amount is fixed **at submission time** from the floors cleared so far. A share
            // that is submitted before the last floor and verified after it doubles the total the
            // player actually had when they hit the button — otherwise clearing another floor
            // would raise the bonus on a post already published, which is not what the post says.
            amount: earned,
            // The tag, and only the tag. The invite link is in the post because recruiting is half
            // of what this program is for — but a link X shortened into a `t.co` is not something
            // to fail an honest player over, so it is not what the payout turns on.
            expect: { handle, mention: X_SHARE_TAG },
        };
    }

    return { error: 'Unknown task.', code: 'unknown-task' };
}

/** The shape the page renders. Never exposes anything secret. */
export async function stateFor(address) {
    const key = normaliseAddress(address);
    if (!key) return null;
    // A review that has been waited out is paid before anything is rendered, so the totals the page
    // shows are the totals that are true — and the player's own next visit is the scheduler, since
    // there is no cron here to run one.
    await settleDueClaims(key);
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

    // The share's kit, built here rather than typed into the page. One function writes the text
    // the player posts and the text X is asked about, so the two cannot drift apart — and the tag
    // the verifier looks for is the same constant the post was composed with.
    const sharePoints = (entryTotalToday(doc, day) || VAULT_ENTRY_TOTAL) * 2;
    const shareText = sharePostText({ points: sharePoints, refUrl: referralUrl(key) });

    const campaign = campaignPostId()
        ? {
            id: campaignPostId(),
            url: X_CAMPAIGN_POST,
            reward: X_ENGAGEMENT_REWARD,
            keyword: X_CAMPAIGN_KEYWORD || null,
            host: SITE_LINK_HOST,
        }
        : null;

    return {
        address: key,
        points: doc.points,
        rank,
        players,
        clearedToday: cleared,
        entryComplete: cleared.length >= VAULT_LEVELS.length,
        entryTotalToday: entryTotalToday(doc, day),
        entryTotal: VAULT_ENTRY_TOTAL,
        // The old flag is still read, so a wallet that shared before this rule existed keeps its
        // tick on that day; from here on the task record is what says so — and only for the day it
        // was verified on, since the record now outlives the day it belongs to.
        sharedToday: doc.sharedOn?.[day] === true
            || (doc.tasks?.[shareTaskId()]?.state === 'verified'
                && doc.tasks?.[shareTaskId()]?.day === day),
        entries: doc.entries || 0,
        referrals,
        referrer: doc.referrer || null,
        referralEarned: doc.referralEarned || 0,
        firstSeenAt: doc.firstSeenAt,

        // ------------------------------------------------------------- earning on X
        // `x` is what the page gates its whole earning panel on, and `canEarn` is the rule in
        // one boolean so the page never re-derives it from prose. `campaign` is null until a post
        // is configured, which is how the task hides itself instead of rendering a dead panel.
        x: doc.x
            ? {
                id: doc.x.id,
                username: doc.x.username,
                verified: doc.x.verified === true,
                boundAt: doc.x.boundAt || null,
            }
            : null,
        canEarn: Boolean(doc.x?.username),
        campaign,
        // What the share needs to put a post together: the account to tag, the picture that rides
        // along as the link's card, the text itself, and the composer link with it prefilled.
        share: {
            tag: X_SHARE_TAG,
            cardImage: SHARE_CARD_IMAGE,
            ogImage: SHARE_OG_IMAGE,
            text: shareText,
            intentUrl: shareIntentUrl(shareText),
        },
        linkHost: SITE_LINK_HOST,
        tasks: {
            campaign: taskView(doc, campaignTaskId(), X_ENGAGEMENT_REWARD, day),
            share: taskView(doc, shareTaskId(), entryTotalToday(doc, day), day, { daily: true }),
        },
        // Everything the one-time tab renders, built here so the page never reads the task list
        // from its own bundle — same reason the share's copy is built here.
        oneTime: ONE_TIME_TASKS.map((task) => oneTimeView(doc, task)),
        // How a follow is proved on this deployment, so the page's own explanation can say which
        // kind of check — if any — stands behind the tab. Read here rather than in the browser
        // because `followProofMode()` looks at a secret the browser must never see.
        followProof: { mode: followProofMode() },

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

    // The earning gate, and it is here rather than in the page: every path below pays points, so
    // this is the one place the rule has to hold. A hand-rolled request gets the same answer as
    // the button does.
    if (!existing.x?.username) return xRequired();

    const cleared = clearedToday(existing, day);
    if (cleared.includes(index)) {
        return { credited: 0, alreadyCleared: true, state: await stateFor(key) };
    }
    const expected = cleared.length;              // floors must be cleared in sequence
    if (index !== expected) {
        return { error: `floor ${expected + 1} has to be cleared first` };
    }

    // One winner per wallet, per day, per floor. Without this the read above and the
    // write below are two separate steps, and two simultaneous clears both pass the
    // check and both get paid — five times out of six, in the measurement that found it.
    if (!(await claimGuard(`clear:${key}:${day}:${index}`))) {
        return { credited: 0, alreadyCleared: true, state: await stateFor(key) };
    }

    const amount = VAULT_LEVELS[index].points;

    // Record the floor *before* paying it. If the payout then fails, the day's points
    // cannot be claimed again by another path — a missed payment is recoverable from the
    // logs, a double payment is money out of the treasury.
    await updateWallet(key, (w) => {
        const list = Array.isArray(w.levelsCleared?.[day]) ? w.levelsCleared[day] : [];
        if (!list.includes(index)) list.push(index);
        // Keep only today: the daily reset is the whole point of the field.
        w.levelsCleared = { [day]: list };
        if (list.length === VAULT_LEVELS.length) w.entries = (w.entries || 0) + 1;
        return w;
    });

    let credited = 0;
    try {
        credited = await credit(key, amount, `vault_level_${index + 1}`);
    } catch (error) {
        // Loud, with the numbers needed to put it right by hand.
        console.error(`[points] floor ${index + 1} recorded but not credited for ${key} on ${day}: ${amount} PTS — ${error.message || error}`);
    }

    return { credited, state: await stateFor(key) };
}

/**
 * Has this wallet earned anything under the X binding it currently holds?
 *
 * Points are only ever paid to a bound wallet — `x-required` is the gate on every award path — so
 * an increase since the binding was written belongs to that binding. The snapshot is taken at bind
 * time (`pointsAtBind`) because the store keeps no per-handle points ledger and one is not worth
 * adding for a single rule.
 *
 * A binding made before that field existed has no snapshot, so it reads as 0: any wallet holding
 * points at all counts as having earned. That is the safe direction — it refuses a takeover rather
 * than allowing a second payout for one X account.
 */
function earnedUnderBinding(doc) {
    if (!doc?.x) return false;
    const snapshot = Number(doc.x.pointsAtBind);
    const atBind = Number.isFinite(snapshot) ? snapshot : 0;
    return Number(doc.points || 0) > atBind;
}

/** The refusal for an account another wallet holds, in the sentence the page renders. */
function taken(username, owner, earned = false) {
    return {
        error: earned
            ? `@${username} has already earned points for another wallet (${short(owner)}). One X account earns for one wallet.`
            : `@${username} is already bound to another wallet (${short(owner)}). One X account earns for one wallet.`,
        code: 'x-taken',
        owner: short(owner),
    };
}

/**
 * Claim the handle's own index entry — the key that makes "one X account, one wallet" true however
 * a binding was made.
 *
 * The numeric account id is the better key when there is one (an X handle can be renamed, an id
 * cannot), but it is not the only way in: a wallet with no Privy link to prove binds by handle. That
 * left a gap — one account claimed by id on one wallet and by name on another, both of them bound
 * to the same handle and both earning — so **every** binding claims its handle as well, and the
 * handle is what turns the next wallet away regardless of how it arrives.
 *
 * A claim that has already earned is never handed on. A provisional one that has not goes to the
 * wallet that can prove the account, which is the only direction this can honestly go.
 */
async function claimHandle(handleKey, key, { verified = false } = {}) {
    const claim = await claimXBinding(handleKey, key);
    if (claim.ok) return { ok: true };

    const owner = await getWallet(claim.owner);
    const provisional = owner?.x && owner.x.verified !== true;
    if (provisional && verified && !earnedUnderBinding(owner)) {
        await releaseXBinding(handleKey, claim.owner, { force: true });
        await updateWallet(claim.owner, (w) => {
            // Only if that is still the binding they hold: a wallet that has since moved to another
            // account must not lose the one it holds now.
            if (w.x?.id === handleKey) w.x = null;
            return w;
        });
        if ((await claimXBinding(handleKey, key)).ok) return { ok: true, tookOver: claim.owner };
    }
    return { ok: false, owner: claim.owner, earned: earnedUnderBinding(owner) };
}

/* ===================================================================== the X binding
 *
 * One X account, one wallet. The index that answers "who holds this account?" lives in the store,
 * because that answer has to come from one read; the *rule* about two wallets wanting the same
 * account lives here, where the rules live.
 *
 * `verified` means the binding was proved rather than named: Privy said the signed-in user holds
 * this X account. A provisional binding is allowed, because a player whose Privy app has Twitter
 * switched off can still type their handle — but a proved binding takes a provisional one over,
 * and two proved bindings cannot both be right, so the first one stands.
 *
 * A provisional binding has **no account id** — the player only typed a handle — so the index is
 * keyed `handle:<name>` instead. That is what still makes "one name, one wallet" true without
 * Privy: the numeric id is used when there is one, and the name is used when there is not. When a
 * proved binding later lands for that handle, it takes the name's provisional claim away, so the
 * same handle cannot sit on two boards.
 */
export async function bindX(address, identity = {}, { verified = false } = {}) {
    const key = normaliseAddress(address);
    if (!key) return { error: 'invalid address' };

    const xid = String(identity.id || '').trim();
    const username = String(identity.username || '').trim().replace(/^@/, '').toLowerCase();
    // A proved binding must carry the real account id — a proof that cannot say *which* account it
    // is about is not a proof. A provisional one may key on the handle.
    const id = X_ID.test(xid) ? xid : (X_HANDLE.test(username) ? `handle:${username}` : null);
    if (!id || !X_HANDLE.test(username) || (verified && id !== xid)) {
        return { error: 'That X account has no usable id or handle.', code: 'bad-identity' };
    }

    const doc = (await getWallet(key)) || blankWallet(key);
    const held = doc.x?.id ? doc.x : null;

    if (held && held.id === id) {
        // Already theirs. A later *proved* link is still worth recording, since the proved binding
        // is the one a dispute would be settled with.
        if (verified && held.verified !== true) {
            await updateWallet(key, (w) => {
                w.x = { ...w.x, verified: true, username };
                return w;
            });
        }
        // A binding is meant to carry both keys. One made before that rule existed carries only
        // its id, and this is where it picks the other one up — best effort, because the wallet
        // already holds the account and a failure here must not take it away.
        const late = await claimHandle(`handle:${username}`, key, { verified });
        if (!late.ok) {
            console.warn(`[points] @${username} is claimed by ${late.owner}, but ${key} holds the account id`);
        }
        return {
            ok: true,
            alreadyBound: true,
            x: { id, username, verified: verified || held.verified === true },
            state: await stateFor(key),
        };
    }

    // The handle's claim is taken before the id's: it is the key a second wallet with the same
    // handle can actually reach, so it is the one whose refusal has to leave nothing behind.
    const handleKey = `handle:${username}`;
    const handleClaim = await claimHandle(handleKey, key, { verified });
    if (!handleClaim.ok) return taken(username, handleClaim.owner, handleClaim.earned);

    // Taking the account. The index is the arbiter and is written before the wallet record, so two
    // wallets racing for one account cannot both conclude they won.
    const claim = await claimXBinding(id, key);
    if (!claim.ok) {
        const owner = await getWallet(claim.owner);
        // A proved binding may take over another wallet's **provisional** one — that is how a typed
        // handle that was never theirs ends up with the account that can prove it. It may not take
        // over a claim that has already **earned**: a claim that paid points was plainly the
        // player's own account, so moving it would pay the same account twice, on two wallets.
        const earned = earnedUnderBinding(owner);
        const canTakeOver = verified && owner?.x?.verified !== true && !earned;
        if (!canTakeOver) {
            // Nothing half-written: the handle claim this pass just made is handed back.
            await releaseXBinding(handleKey, key);
            return taken(username, claim.owner, earned);
        }
        await releaseXBinding(id, claim.owner, { force: true });
        await updateWallet(claim.owner, (w) => {
            if (w.x?.id === id) w.x = null;
            return w;
        });
        await claimXBinding(id, key);
    }

    // Pending submissions belong to the account that was bound when they were made, so they are
    // dropped rather than re-checked against the new handle and failed one at a time. Points
    // already earned stay: they were earned.
    const dropped = Object.entries(doc.tasks || {})
        .filter(([, task]) => task?.state === 'pending')
        .map(([taskId]) => taskId);
    await updateWallet(key, (w) => {
        w.x = {
            id,
            username,
            verified: verified === true,
            boundAt: new Date().toISOString(),
            // A snapshot, so the rule above can tell a claim that has earned from one that has
            // only sat there. See `earnedUnderBinding`.
            pointsAtBind: Number(w.points || 0),
        };
        for (const taskId of dropped) if (w.tasks && w.tasks[taskId]) delete w.tasks[taskId];
        return w;
    });
    // The handle the wallet is moving away from **keeps this wallet's claim on it**. Releasing it
    // here is precisely what used to let one X account earn for a second wallet — bind, earn,
    // switch, hand the handle to the next wallet — so the claim is kept and cannot be handed on.
    // This wallet can still come back to that account; no other wallet can ever take it.

    return {
        ok: true,
        x: { id, username, verified: verified === true },
        dropped,
        state: await stateFor(key),
    };
}

/**
 * Unbinding is closed, and this refusal is the rule rather than the absence of a button.
 *
 * The button this used to power was the whole farming loop: bind the X account to one wallet,
 * earn, unbind, bind the same account to the next wallet, earn again. Nothing else stopped it —
 * the vault's floors, the share and the daily caps are all counted **per wallet**. With the account
 * index holding a handle to one wallet for good, a binding cannot be handed back. The refusal
 * lives here so a hand-rolled POST gets the same answer the button would.
 *
 * Changing which X account a wallet earns under is still possible, and still means `bindX` with a
 * different handle: the handle being left behind stays claimed by this wallet either way.
 */
export async function unbindX(address) {
    const key = normaliseAddress(address);
    if (!key) return { error: 'invalid address' };
    const doc = await getWallet(key);
    if (!doc?.x?.username) {
        return { error: 'This wallet has no X account bound to it.', code: 'not-bound' };
    }
    return {
        error: `@${doc.x.username} stays bound to this wallet. One X account earns for one wallet, so a binding cannot be handed back — you can bind a different X account instead.`,
        code: 'x-locked',
        state: await stateFor(key),
    };
}

/* =================================================================== the task engine
 *
 * One verifier, two rewards. The campaign and the share differ only in what they pay and how
 * often; the proof is the same module and the same first expectation — the **bound handle** wrote
 * the post — followed by that task's own requirement: the campaign's link, or the share's tag.
 * Nothing here trusts the client for anything except the URL of a post the player says is theirs.
 */

/**
 * Check one submitted post and settle the task: pay it, hold it pending, or mark it failed.
 *
 * The middle outcome is the honest one and the reason this state machine exists at all. X needs a
 * moment to index a fresh post, so "not visible yet" is remembered as **pending** and can be asked
 * again — nothing is paid until a check says the post is really theirs. `failed` is a real answer
 * from X (someone else's post, no tag, no link, not a post at all) and never pays, no matter how
 * often it is retried. `expired` is "no good answer inside the attempt ceiling", which also never pays.
 */
async function settle(key, config, url, record = null) {
    const attempts = Number(record?.attempts || 0) + 1;
    const now = new Date().toISOString();
    const verdict = await verifyPost(url, { expect: config.expect });

    // A share doubles **that day's** run. If the check that would have paid it lands after
    // midnight UTC, the run it was about is over and the bonus is not owed — better to say that
    // than to quietly double yesterday's total against today's board.
    const dayOver = config.kind === 'share' && config.day !== todayKey();

    if (!verdict.ok || dayOver) {
        const state = dayOver || verdict.retryable !== true
            ? (dayOver ? 'expired' : 'failed')
            : (attempts >= X_VERIFY_MAX_ATTEMPTS ? 'expired' : 'pending');
        const reason = dayOver
            ? 'That share was about a vault run that ended before X confirmed the post.'
            : verdict.reason || 'That post did not pass the check.';

        await updateWallet(key, (w) => {
            w.tasks = { ...(w.tasks || {}) };
            w.tasks[config.taskId] = {
                state,
                url,
                reason,
                code: dayOver ? 'day-over' : verdict.code,
                attempts,
                day: config.day,
                submittedAt: record?.submittedAt || now,
                lastCheckedAt: now,
                verifiedAt: null,
                credited: 0,
            };
            return w;
        });
        return { credited: 0, pending: state === 'pending', verdict, state: await stateFor(key) };
    }

    // Verified. Pay once per task, guarded exactly like the floors are, so a second tap on the
    // button cannot pay it twice.
    if (!(await claimGuard(`task-credit:${key}:${config.taskId}`))) {
        return { credited: 0, alreadyCredited: true, state: await stateFor(key) };
    }

    // Record before paying: a missed payment is recoverable from the log line below, a second
    // payment is points out of a fixed pool.
    await updateWallet(key, (w) => {
        w.tasks = { ...(w.tasks || {}) };
        w.tasks[config.taskId] = {
            state: 'verified',
            url,
            reason: null,
            code: verdict.code || 'ok',
            attempts,
            day: config.day,
            submittedAt: record?.submittedAt || now,
            lastCheckedAt: now,
            verifiedAt: now,
            credited: 0,
            post: { id: verdict.post?.id, author: verdict.post?.author },
        };
        if (config.kind === 'share') w.sharedOn = { [config.day]: true };
        return w;
    });

    let credited = 0;
    try {
        credited = await credit(key, config.amount, config.kind === 'share'
            ? 'vault_share_bonus'
            : `x_task_${config.taskId}`);
    } catch (error) {
        console.error(`[points] ${config.taskId} verified but not credited for ${key}: ${config.amount} PTS — ${error.message || error}`);
    }

    await updateWallet(key, (w) => {
        if (w.tasks?.[config.taskId]) w.tasks[config.taskId].credited = credited;
        return w;
    });

    return { credited, post: verdict.post, state: await stateFor(key) };
}

/**
 * Submit the link to a post for a task, and settle it.
 *
 * This is the only way the campaign pays and the only way a share doubles. A different post is a
 * fresh submission with its own attempts — which is also why the throttle is scoped to the URL:
 * fixing a typo is instant, hammering one link is not.
 */
export async function submitTask(address, kind, url) {
    const key = normaliseAddress(address);
    if (!key) return { error: 'invalid address' };
    const doc = (await getWallet(key)) || blankWallet(key);
    if (!doc.x?.username) return xRequired();

    const config = taskConfig(kind, doc);
    if (config.error) return config;

    const record = doc.tasks?.[config.taskId] || null;
    if (record?.state === 'verified' && (record.credited || 0) > 0) {
        return { credited: 0, alreadyCredited: true, state: await stateFor(key) };
    }

    const parsed = parseStatusUrl(url);
    if (!parsed.ok) return { error: parsed.reason, code: parsed.code };

    // One post pays one one-time task. X cannot see which post a quote-repost quotes, so the four
    // quote tasks ask the same two things of whatever link is pasted — without this rule a single
    // post would collect all four rewards. The rule is on the **post**, not the player: four
    // quote-posts still pay four times, which is the whole shape of the tab.
    if (config.once) {
        const paidAlready = Object.entries(doc.tasks || {}).find(([recordId, entry]) =>
            recordId !== config.taskId
            && (entry?.credited || 0) > 0
            && statusIdFromUrl(entry?.url) === parsed.id);
        if (paidAlready) {
            return {
                error: 'That post has already paid for another one-time task — each of these needs its own post.',
                code: 'post-already-used',
                state: await stateFor(key),
            };
        }
    }

    if (!(await claimGuard(`submit:${key}:${config.taskId}:${parsed.id}`, X_VERIFY_MIN_GAP_SECONDS))) {
        return {
            error: 'That link was just checked — give X a moment, or submit a different post.',
            code: 'throttled',
            retryInSeconds: X_VERIFY_MIN_GAP_SECONDS,
            state: await stateFor(key),
        };
    }

    // A new URL starts its own attempt count; the same URL continues the old one.
    return settle(key, config, url, record && record.url === url ? record : null);
}

/**
 * Ask X again about a submission that is still pending.
 *
 * The player drives this rather than a timer, which is the honest shape here: only they know when
 * they finished typing, and a background poller would hammer X on behalf of every wallet forever.
 * The gap between checks is enforced server-side, so the button cannot be turned into a load test.
 */
export async function checkTask(address, kind) {
    const key = normaliseAddress(address);
    if (!key) return { error: 'invalid address' };
    const doc = (await getWallet(key)) || blankWallet(key);
    if (!doc.x?.username) return xRequired();

    const config = taskConfig(kind, doc);
    if (config.error) return config;

    const record = doc.tasks?.[config.taskId] || null;
    if (!record) return { error: 'Nothing has been submitted for that yet.', code: 'not-submitted' };
    if (record.state === 'verified') return { credited: 0, alreadyCredited: true, state: await stateFor(key) };
    if (record.state === 'failed') {
        return { error: record.reason || 'That post did not pass the check.', code: 'failed', state: await stateFor(key) };
    }

    // A daily task's record belongs to a day. When that day is gone there is no submission left to
    // check — asking X about a post whose run is over could only produce a wrong answer, so the
    // record is closed for the log and the player is told which day it was about.
    if (config.daily && record.day && record.day !== config.day) {
        await updateWallet(key, (w) => {
            const current = w.tasks?.[config.taskId];
            if (!current) return w;
            w.tasks[config.taskId] = {
                ...current,
                state: 'expired',
                code: 'day-over',
                reason: 'That share was about a vault run that ended before X confirmed the post.',
                lastCheckedAt: new Date().toISOString(),
            };
            return w;
        });
        return {
            error: 'That share was for a run that has since ended — the daily run resets at 00:00 UTC.',
            code: 'day-over',
            credited: 0,
            state: await stateFor(key),
        };
    }

    const attempts = Number(record.attempts || 0);
    if (attempts >= X_VERIFY_MAX_ATTEMPTS) {
        return {
            error: 'The checks for that post have run out. Post again and submit the new link.',
            code: 'attempts-exhausted',
            state: await stateFor(key),
        };
    }

    const last = Date.parse(record.lastCheckedAt || record.submittedAt || '') || 0;
    const left = X_VERIFY_MIN_GAP_SECONDS * 1000 - (Date.now() - last);
    if (left > 0) {
        const retryInSeconds = Math.ceil(left / 1000);
        return {
            error: `X was asked about that post a moment ago — try again in ${retryInSeconds}s.`,
            code: 'throttled',
            retryInSeconds,
            state: await stateFor(key),
        };
    }

    return settle(key, config, record.url, record);
}

/**
 * Share on X: doubles today's cleared total, once a day, and only once the post is verified.
 *
 * The old signature took no URL and paid on the tap, which is exactly the hole this closes — the
 * bonus is now the same verified task the campaign uses, with the doubled amount as its reward.
 */
export async function shareEntry(address, url) {
    return submitTask(address, 'share', url);
}

/* ============================================================== the one-time tasks
 *
 * Paid once, ever, and gated exactly like everything else. Note what this path does **not** do:
 * it does not ask X anything at claim time — but that is not the same as checking nothing, and the
 * difference is the whole of `lib/x-webhook.js`.
 *
 * A follow cannot be proved the way a post is. oEmbed, the only free way to ask X anything, has no
 * view of the follow graph, and v2 has no "does A follow B" endpoint left; asking would mean paging
 * a player's following list and paying per row. So the fact is **pushed** to us instead: X delivers a
 * `follow.follow` event to `/api/x/events`, we hold it, and this function reads it back. When that is
 * configured (`FOLLOW_PROOF_MODE=webhook`) the reward is paid against X's own record; when it is not,
 * the claim is taken on the player's word and the card says exactly that. Either way the same
 * sentence is never used for both, because a deployment that says "verified" while nothing verifies
 * is worse than one that admits it cannot check.
 *
 * What is not on their word in either mode is the account — the X binding is required, and a binding
 * cannot be moved to a second wallet, which is what keeps one account from claiming twice.
 *
 * A claim already paid is never re-judged: the record keeps what was true on the day, so a wallet
 * that claimed under the word does not later start claiming it was verified.
 */
/* ------------------------------------------------------------------ the review window
 *
 * A claim in this mode is not paid when it is made, and it is not refused either: it is **recorded**,
 * and credited once the window it was given has closed. Two things make that worth having rather
 * than a spinner:
 *
 *   - the wait is a real closure. `settleAfter` is drawn **once per claim** and stored on it, so a
 *     refresh cannot move the deadline, and a claim can still be turned down while it waits
 *     (`tools/points-pending.js`) — which is exactly what makes the word "review" on the card true
 *     rather than decorative. A deadline recomputed from the clock on every read would drift under
 *     a player who refreshes, and would settle the same claim at a different minute every time.
 *   - it costs the player nothing to arrive early. The claim is theirs the moment it is made (the
 *     once-only guard is taken right there), so a second tap inside the window answers with the
 *     deadline instead of an error — and the answer is the same one the card was already showing.
 */

/** How long this claim waits, drawn once. Zero means "pay on the spot". */
function drawReviewMinutes(task) {
    const min = Math.max(0, Math.round(Number(task?.review?.minMinutes) || 0));
    const max = Math.max(min, Math.round(Number(task?.review?.maxMinutes) || min));
    if (max === 0) return 0;
    return min + Math.floor(Math.random() * (max - min + 1));
}

/** A claim waiting on its window — as opposed to one already paid, or turned down. */
function isAwaitingReview(record) {
    return record?.state === 'pending' && record?.review === true;
}

/** When the window closes, as a number. A missing or unreadable date is "due now", not "never". */
function reviewDueAt(record) {
    const at = Date.parse(record?.settleAfter || '');
    return Number.isFinite(at) ? at : 0;
}

function isReviewDue(record, now = Date.now()) {
    return isAwaitingReview(record) && reviewDueAt(record) <= now;
}

/**
 * Pay every review this wallet has waited out. Returns the ids it paid for, so a caller that asked
 * "is this claim still waiting?" can say "it just paid" instead of "already paid".
 *
 * Called from the two places a wallet is looked at — `stateFor` and `claimOneTime` — because the
 * player's own next visit is the clock here: there is no scheduler in this project, and a window
 * that only closed when a cron ran would leave points owing until somebody remembered.
 *
 * Nothing is paid twice. The guard is per claim, and the record is what actually decides, so two
 * tabs landing together (or a settle racing a re-claim) credit once: the second caller re-reads
 * inside the guard and finds the claim gone.
 */
export async function settleDueClaims(address) {
    const key = normaliseAddress(address);
    if (!key) return 0;

    const doc = await getWallet(key);
    const due = Object.entries(doc?.tasks || {}).filter(([, record]) => isReviewDue(record));
    if (!due.length) return [];

    const paid = [];
    for (const [recordId] of due) {
        const taskId = String(recordId).replace(/^one:/, '');
        const task = oneTimeTask(taskId);
        if (!task) continue;
        if (!(await claimGuard(`review:${key}:${taskId}`))) continue;

        const fresh = await getWallet(key);
        if (!isReviewDue(fresh?.tasks?.[recordId])) continue;

        const now = new Date().toISOString();
        await updateWallet(key, (w) => {
            w.tasks = { ...(w.tasks || {}) };
            w.tasks[recordId] = {
                ...w.tasks[recordId],
                state: 'verified',
                verifiedAt: now,
                reviewedAt: now,
                reviewedBy: 'window',
            };
            return w;
        });

        let credited = 0;
        try {
            credited = await credit(key, task.reward, `one_time_${taskId}`);
        } catch (error) {
            // Recorded as paid with nothing credited: recoverable from this line, and the claim is
            // not re-runnable, which is the safe direction for a fixed pool.
            console.error(`[points] review window closed for ${key} on ${taskId} but the credit failed: ${task.reward} PTS — ${error.message || error}`);
        }

        await updateWallet(key, (w) => {
            if (w.tasks?.[recordId]) w.tasks[recordId].credited = credited;
            return w;
        });
        await pendingRemove(key, taskId);
        if (credited > 0) paid.push(taskId);
    }
    return paid;
}

export async function claimOneTime(address, taskId) {
    const key = normaliseAddress(address);
    if (!key) return { error: 'invalid address' };

    const task = oneTimeTask(taskId);
    if (!task) return { error: 'Unknown task.', code: 'unknown-task' };

    // A task that is **checked** is not claimable. It is paid by `submitTask`, and only once X has
    // answered about the post the player pasted — so this path has to refuse it, or the other
    // endpoint would pay a verified task on the tap with its own verifier bypassed entirely.
    if (task.proof === 'verify') {
        return {
            error: 'That task is paid against a post — paste the link to the post you made.',
            code: 'submit-required',
        };
    }

    // A window that has already closed is paid before the claim is judged, so a player who taps
    // again after the wait is told what happened rather than asked to wait for something done — and
    // told *what* happened: a claim settled by this call reports its credit, where one that was paid
    // on an earlier visit reports only that it is done.
    const settledNow = await settleDueClaims(key);

    const doc = (await getWallet(key)) || blankWallet(key);
    if (!doc.x?.username) return xRequired();

    const recordId = `one:${task.id}`;
    const existing = doc.tasks?.[recordId] || null;
    if (existing?.state === 'verified') {
        const paidNow = settledNow.includes(task.id);
        return {
            credited: paidNow ? (existing.credited || task.reward) : 0,
            alreadyCredited: !paidNow,
            state: await stateFor(key),
        };
    }
    // Turned down in review, and final. A refusal a player could re-claim would be advice, not a
    // refusal — so this is checked here, where every other way back in is checked.
    if (existing?.state === 'rejected') {
        return {
            error: existing.reviewNote
                ? `This claim was reviewed and not approved — ${existing.reviewNote}`
                : 'This claim was reviewed and not approved.',
            code: 'rejected',
            state: await stateFor(key),
        };
    }

    // How this deployment proves this step, and what it has actually been told. Asked **before the
    // guard is taken**, which matters: the guard is what makes a claim once-only, so refusing after
    // taking it would leave a player who had not been seen following us yet locked out of the claim
    // for the whole TTL — punished for our own timing.
    const proofMode = task.proof === 'claim' ? followProofMode() : task.proof;
    let fact = null;
    if (proofMode === 'webhook') {
        fact = await followFact({ id: doc.x.id, username: doc.x.username });
        if (!fact?.following) {
            return {
                error: `X has not told us that @${doc.x.username} follows @${X_SHARE_TAG} yet. Follow us, then try again — the event can take a little while to arrive.`,
                code: 'follow-required',
                state: await stateFor(key),
            };
        }
    }

    // Still inside its window: the claim is already the player's, so the answer is the deadline it
    // was given — the same one the card is counting down — rather than a payout or an error.
    if (isAwaitingReview(existing)) {
        return {
            pending: true,
            settleAt: existing.settleAfter || null,
            reviewMinutes: existing.reviewMinutes ?? null,
            credited: 0,
            task: task.id,
            state: await stateFor(key),
        };
    }

    // With a verifier the claim is settled here and now; without one it goes into the review window
    // the task declares. The draw happens **once**, here, and is stored on the claim.
    const reviewMinutes = task.review && proofMode === 'claim' ? drawReviewMinutes(task) : null;

    // The same claim the floors and the X tasks take, for the same reason: the read above and the
    // write below are two steps, so two taps arriving together would otherwise both pay. The loser
    // of that race re-reads before answering, because what it lost was the **guard**, not the claim:
    // the tap it lost to may still be sitting in its window, which is an answer about the future
    // rather than "already paid" about the past.
    if (!(await claimGuard(`one-time:${key}:${task.id}`))) {
        const current = (await getWallet(key))?.tasks?.[recordId] || null;
        if (isAwaitingReview(current)) {
            return {
                pending: true,
                settleAt: current.settleAfter || null,
                reviewMinutes: current.reviewMinutes ?? null,
                credited: 0,
                task: task.id,
                state: await stateFor(key),
            };
        }
        return { credited: 0, alreadyCredited: true, state: await stateFor(key) };
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const settleAfter = reviewMinutes === null
        ? null
        : new Date(now.getTime() + reviewMinutes * 60_000).toISOString();

    // Record before paying, like every other award: a missed payment is recoverable from the log
    // line below, a second payment is points out of a fixed pool. A claim in its window is recorded
    // as `pending` — that record is what makes the wait real, since it is the thing a review can
    // turn down and the thing the deadline is read from.
    await updateWallet(key, (w) => {
        w.tasks = { ...(w.tasks || {}) };
        w.tasks[recordId] = {
            state: reviewMinutes === null ? 'verified' : 'pending',
            kind: `one:${task.id}`,
            // Which account claimed it. Kept for the review path rather than for a rule, since the
            // account index already makes "one account, one wallet" true.
            account: w.x?.id || `handle:${w.x?.username}`,
            url: null,
            attempts: 1,
            submittedAt: nowIso,
            lastCheckedAt: nowIso,
            verifiedAt: reviewMinutes === null ? nowIso : null,
            credited: 0,
            // What was true when it was paid, not what is true now — see `oneTimeView`.
            proof: proofMode,
            // The moment X said the follow happened, for the log and for a dispute. Null under the
            // word, which is the honest record of a claim nothing checked.
            followedAt: fact?.at || null,
            // The review window: what it was drawn at, when it closes, and who closed it.
            review: reviewMinutes !== null,
            reviewMinutes,
            settleAfter,
            reviewedAt: null,
            reviewedBy: null,
            reviewNote: null,
        };
        return w;
    });

    if (reviewMinutes !== null) {
        // The queue the review tool reads. Written after the claim is recorded, so a failure here
        // costs a row in a listing rather than the claim itself.
        await pendingAdd(key, task.id);
        return { pending: true, settleAt: settleAfter, reviewMinutes, credited: 0, task: task.id, state: await stateFor(key) };
    }

    let credited = 0;
    try {
        credited = await credit(key, task.reward, `one_time_${task.id}`);
    } catch (error) {
        console.error(`[points] one-time task ${task.id} claimed but not credited for ${key}: ${task.reward} PTS — ${error.message || error}`);
    }

    await updateWallet(key, (w) => {
        if (w.tasks?.[recordId]) w.tasks[recordId].credited = credited;
        return w;
    });

    return { credited, task: task.id, state: await stateFor(key) };
}

/* ------------------------------------------------------- the queue the review tool reads
 *
 * These three exist so the word "review" on the card is a thing that happens rather than a thing the
 * page says: the queue can be listed, a claim can be paid early, and a claim can be turned down
 * while it waits. Nothing else in the program calls them.
 */

/** Every claim still waiting, oldest deadline first, with enough of each to judge it. */
export async function reviewQueue() {
    const entries = await pendingList();
    const rows = [];

    for (const { taskId, address } of entries) {
        const task = oneTimeTask(taskId);
        const doc = await getWallet(address);
        const record = doc?.tasks?.[`one:${taskId}`];
        // A queue entry with no record is a leftover from a claim that was settled or removed —
        // reported as nothing rather than rendered as a claim that does not exist.
        if (!task || !record) continue;
        rows.push({
            address,
            taskId,
            title: task.title,
            reward: task.reward,
            handle: doc?.x?.username || null,
            verifiedBinding: doc?.x?.verified === true,
            account: record.account || null,
            claimedAt: record.submittedAt || null,
            settleAfter: record.settleAfter || null,
            minutesLeft: Math.max(0, Math.ceil((reviewDueAt(record) - Date.now()) / 60_000)),
            credited: record.credited || 0,
            state: record.state,
        });
    }

    return rows.sort((a, b) => Date.parse(a.settleAfter || 0) - Date.parse(b.settleAfter || 0));
}

/**
 * Pay a waiting claim now, without waiting the window out — the "approved" half of a review.
 *
 * Takes the same guard the automatic settle takes, so approving a claim at the moment its window
 * closes cannot pay it twice.
 */
export async function approvePendingClaim(address, taskId) {
    const key = normaliseAddress(address);
    const task = oneTimeTask(taskId);
    if (!key || !task) return { error: 'unknown claim' };

    const recordId = `one:${task.id}`;
    const doc = await getWallet(key);
    const record = doc?.tasks?.[recordId];
    if (!record) return { error: 'no such claim' };
    if (record.state === 'verified') return { credited: 0, alreadyCredited: true };
    if (record.state === 'rejected') return { error: 'that claim was already turned down' };
    if (!(await claimGuard(`review:${key}:${task.id}`))) return { error: 'another settle is in flight for this claim' };

    const now = new Date().toISOString();
    await updateWallet(key, (w) => {
        w.tasks = { ...(w.tasks || {}) };
        w.tasks[recordId] = {
            ...w.tasks[recordId],
            state: 'verified',
            verifiedAt: now,
            reviewedAt: now,
            reviewedBy: 'tool',
        };
        return w;
    });

    let credited = 0;
    try {
        credited = await credit(key, task.reward, `one_time_${task.id}`);
    } catch (error) {
        console.error(`[points] ${task.id} approved for ${key} but the credit failed: ${task.reward} PTS — ${error.message || error}`);
    }

    await updateWallet(key, (w) => {
        if (w.tasks?.[recordId]) w.tasks[recordId].credited = credited;
        return w;
    });
    await pendingRemove(key, task.id);
    return { credited };
}

/**
 * Turn a waiting claim down. It can never be claimed again — see `claimOneTime`, which refuses a
 * rejected record before anything else — so this is only for a claim that should not be paid.
 */
export async function rejectPendingClaim(address, taskId, reason = '') {
    const key = normaliseAddress(address);
    const task = oneTimeTask(taskId);
    if (!key || !task) return { error: 'unknown claim' };

    const recordId = `one:${task.id}`;
    const doc = await getWallet(key);
    const record = doc?.tasks?.[recordId];
    if (!record) return { error: 'no such claim' };
    if (record.state === 'verified') return { error: 'that claim is already paid — a paid claim is not re-judged' };

    const now = new Date().toISOString();
    await updateWallet(key, (w) => {
        w.tasks = { ...(w.tasks || {}) };
        w.tasks[recordId] = {
            ...w.tasks[recordId],
            state: 'rejected',
            credited: 0,
            reviewedAt: now,
            reviewedBy: 'tool',
            reviewNote: String(reason || '').trim() || null,
        };
        return w;
    });
    await pendingRemove(key, task.id);
    return { rejected: true };
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
