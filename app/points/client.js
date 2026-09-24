'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
// The Points page is a React route, not a legacy page, so it has to pull Arya in
// itself — the shared gate-keeper popup used across the rest of the game.
import Script from 'next/script';
import { VAULT_LEVELS, VAULT_ENTRY_TOTAL, STREAK_BASE, STREAK_MAX_MULTIPLIER, DISCORD_INVITE } from '../../lib/points-config';
import {
    attachRef, claimRef, clearSession, connectWallet, fetchLeaderboard, fetchMe, fetchXStatus, forgetWallet,
    isAddress, onAccountsChanged, pendingRef, readRefFromUrl,
    readSession, refLink, requestBindX, requestClear, requestOneTimeClaim, requestShare, requestTask,
    requestTaskCheck, savedAddress, shortAddress, signIn, stashRef, walletCapabilities,
} from '../../lib/points-client';
import PointsDungeon from './dungeon';

const ASSETS = '/assets/points/';
// The board shows the leaders, not the whole field: ten is a board a player can read at a glance, and
// while the program is young a longer list is mostly people with nothing on it. Anyone outside it
// still sees their own row — the page appends it below with their real rank — so shrinking the list
// hides other players' totals, never the player's own place in the running.
const BOARD_LIMIT = 10;

// Arya's walkthrough of this page. The key is both an identity and the once-ever latch:
// `/arya.js` remembers `dk_arya_tour_<id>`, so this runs for a newcomer and stays quiet for
// anyone who has already been through it — including anyone who skipped it. The footer's
// "Ask Arya" passes `force` and replays it mid-visit without a reload.
const TOUR_ID = 'points-v1';

// Where the browser remembers that the announcements tab has been opened once, so its `New` badge
// is a pointer rather than a decoration. Local on purpose — see the state that reads it.
const ANNOUNCE_SEEN_KEY = 'dk_points_announce_seen';

/**
 * The steps she reads out. Every line is a function so that the wallet and vault steps
 * describe the page as it is *right now* (connected, already cleared today) instead of
 * however it looked when the walkthrough was built.
 */
function pointsTourSteps(live) {
    const now = () => live() || {};
    const steps = [
        {
            kind: 'think',
            // She greets every visit, not only the first, so this welcome has to read
            // correctly to someone who has completed the vault ten times. What it says is filled
            // in at the end of this function rather than typed here, so a step added later cannot
            // leave her telling a newcomer the wrong number.
            mood: 'Welcome',
        },
        {
            // The wallet step is the one that genuinely differs per visitor, so it also
            // picks its own expression: alarmed with no wallet at all, thoughtful while
            // waiting to be signed, sworn-in once it is bound.
            kind: () => {
                const v = now();
                if (v.connected) return 'ready';
                return v.walletReady ? 'think' : 'alarm';
            },
            mood: 'The wallet',
            target: '[data-arya="wallet"]',
            text: () => {
                const v = now();
                if (v.connected) {
                    return `That is you: <strong>${shortAddress(v.address)}</strong>${v.rank ? `, rank <strong>#${v.rank}</strong> of ${(v.players || 0).toLocaleString()} players` : ''}. Every point you earn is tied to this wallet rather than to this browser, so it follows you anywhere you sign in.`;
                }
                if (!v.walletReady) {
                    return 'But there is no wallet in this browser, so the vault stays shut. Install MetaMask (or any Web3 wallet), reload, and the gate opens for you.';
                }
                if (v.walletKind === 'privy' && !v.connected) {
                    return 'There is no wallet extension in this browser, so press <strong>Continue with Privy</strong>: it makes you a wallet from an email address — no extension, nothing to install — and then one free signature binds it to the vault.';
                }
                return 'One signature binds this wallet to the vault. It is free, it costs no gas, and it is the only thing I will ever ask you to sign — after that your points follow the wallet.';
            },
        },
        {
            // The gate on the whole program. It comes before the vault on purpose: the vault is
            // the fun part, and a newcomer who clears three floors before binding an X account
            // watches the payout get refused.
            kind: () => (now().bound ? 'ready' : 'brace'),
            mood: 'Your name on it',
            target: '[data-arya="bind"]',
            text: () => (now().bound
                ? 'Your X account is bound, so everything you earn has a name on it. Write your posts from that handle or they will not count. A binding is permanent — one X account earns for one wallet.'
                : 'Points are earned against an X account, so this has to be bound before anything pays — <strong>Link X</strong>, or type your handle and bind it. Nothing here costs anything, and it stays bound: bind the account you actually post from.'),
        },
        {
            kind: 'brace',
            mood: 'Three floors',
            target: '[data-arya="vault"]',
            text: () => (now().entryComplete
                ? 'You have already cleared today&rsquo;s run, so this button sleeps until tomorrow. The whole thing pays again on a fresh day, so come back to it.'
                : `Three floors — ${VAULT_LEVELS.map((l) => l.name).join(', ')} — paying <strong>${VAULT_LEVELS.map((l) => l.points).join(', then ')}</strong>. Five epic knights ride with you, a run takes about twenty seconds, and the monsters do hit back. One entry a day.`),
        },
        {
            // The streak sits between the run and the share in her telling because that is the
            // order they pay in: three floors, then the daily bonus the third one earns, then the
            // doubling of the rest.
            kind: 'think',
            mood: 'Come back tomorrow',
            target: '[data-arya="streak"]',
            text: () => {
                const s = now().streak || {};
                const max = s.max || 15;
                return `And this is what brings you back: clearing all three floors on consecutive days raises a
                    bonus of <strong>${s.base || 150} points</strong> times the day you are on — <strong>1×</strong>
                    on day one, up to <strong>${max}×</strong> from day ${max} onwards. You are on day
                    <strong>${s.days || 1}</strong>. Miss a day and it starts again at 1×.`;
            },
        },
        {
            kind: 'ready',
            mood: 'Double it',
            target: '[data-arya="share"]',
            text: () => (now().shared
                ? 'Today&rsquo;s share is already claimed — your entry was paid out at double. It resets with the vault tomorrow.'
                : `Clear all three floors and this unlocks. One press opens X with the post already written — and the picture comes with it, riding in on your invite link, so there is nothing to attach. Then paste the link to your post back here. The text tags <strong>@${(now().share && now().share.tag) || 'DNGrobinhood'}</strong> and carries your invite link. I ask X one thing about that post before paying — that it tags us — and then the whole entry doubles: <strong>${VAULT_ENTRY_TOTAL} becomes ${VAULT_ENTRY_TOTAL * 2} PTS</strong>. Once a day, same as the vault.`),
        },
        {
            // The tab, not its contents: the contents only exist while that tab is open, and a
            // spotlight aimed at markup that is not on the page is a spotlight aimed at nothing.
            kind: 'think',
            mood: 'Once and done',
            target: '[data-arya="onetime-tab"]',
            text: () => `The second tab is different: those tasks pay <strong>once</strong>, ever — no daily reset. There is ${(now().openOneTime || 0) === 1 ? 'one waiting for you now' : `${(now().openOneTime || 0)} waiting for you now`}, and the tab carries the count. ${now().followProof?.mode === 'webhook'
                ? 'Read the small print on each card: a follow is checked against X&rsquo;s own record before it pays.'
                : 'Read each card before you claim — the daily ones pay the moment you act, and the bigger ones land once they have been reviewed.'}`,
        },
        {
            kind: 'think',
            mood: 'Raise your banner',
            target: '[data-arya="refer"]',
            text: 'Copy this link and whoever joins through it earns you <strong>15%</strong> of everything they make, plus <strong>5%</strong> of what their own recruits make. Paid the moment they earn it — there is nothing to claim.',
        },
        {
            kind: 'brace',
            mood: 'The standings',
            target: '[data-arya="board"]',
            text: () => (now().connected
                ? 'The top ten wallets on the program, ranked by points. Your row is the one tagged <strong>you</strong> — and if you are not in the ten yet, the board still lists you underneath, so you never have to hunt for your place. The second tab lists who you brought in and what each of them has paid you.'
                : 'The top ten wallets on the program, ranked by points. Connect yours and your row appears in it, tagged <strong>you</strong>. The second tab lists who you brought in.'),
        },
        {
            // The tab, for the same reason the one-time step targets its tab: the panel's contents
            // are only in the DOM while that tab is open, and a spotlight aimed at markup that is not
            // on the page is aimed at nothing. She talks about the board just above this, which is
            // what the giveaway is decided on.
            kind: 'think',
            mood: 'Something to win',
            target: '[data-arya="announce-tab"]',
            text: 'One more, and it is the good one: when the season closes, the wallets still on this board each get a <strong>free Knight capsule</strong>. Nothing to enter and nothing to claim — being on the board is the whole of it. The <strong>Announcements</strong> tab carries it, and the date lands there first.',
        },
        {
            kind: 'clear',
            mood: 'That is everything',
            text: 'So: connect, clear three floors, double it on X, claim the one-time tasks, and bring friends. The gate is yours — go and earn.',
        },
    ];

    // Counted, not typed. The farewell is not a step, hence the minus one.
    steps[0].text = `I am Arya, keeper of the gate. <strong>${steps.length - 1} steps</strong> and this page will make sense — <strong>Next</strong> to follow me, <strong>Skip</strong> if you would rather work it out yourself.`;
    return steps;
}

/**
 * One verified X task.
 *
 * The campaign reward and the daily share are the same card because they are the same rule: post
 * it, paste the link, and it is paid once X confirms the post was written by the bound handle. The
 * card renders whichever of the five states the server reports — `none`, `pending`, `verified`,
 * `failed`, `expired` — because "we could not tell yet" and "that is not your post" are different
 * sentences and the player is owed the right one.
 */
/**
 * The share kit: what to post, and what goes in it.
 *
 * X's composer link cannot attach a file — posting an image on a player's behalf needs the paid API
 * — so the picture reaches the post two ways and this says both rather than pretending otherwise.
 * The invite link unfurls into a card built from the same image, which puts the picture in the post
 * for every player on every platform with nothing to attach; and the button saves the file for
 * anyone who would rather attach it by hand.
 *
 * The tag and the text are the server's (`state.share`), not this component's: what the page shows
 * and what X is asked about have to be the same words.
 */
function ShareKit({ share }) {
    if (!share) return null;
    return (
        <div className="x-share-kit">
            {/* The picture as the post will show it — the card X unfurls from the invite link in the
                text below. Shown once, as what it is: nothing here needs to be saved or attached. */}
            <div className="x-share-photo">
                <img src={share.ogImage} alt="The picture your invite link carries into the post" loading="lazy" />
            </div>
            <p className="x-share-carry">
                The button opens X with the words below already written, picture and all — the picture
                comes in on your invite link. Post it, then paste the link to your post underneath.
            </p>
            {/* Today's day marker is part of the text, and the check looks for it. One line under
                it, because a player who tidies the text by hand should know before they post rather
                than after a refusal that reads like a fault of theirs. */}
            <div className="x-share-text">{share.text}</div>
            {share.dayMarker && (
                <p className="x-share-keep">
                    Post it as it is — it carries {share.dayMarker}, which is how today&rsquo;s post is
                    told from yesterday&rsquo;s. Days turn over at 00:00 UTC, so the marker X is asked about
                    changes then, not at your own midnight.
                </p>
            )}
        </div>
    );
}

function XTaskCard({
    id, title, icon, reward, hint, kit, cta, onCta, ctaDisabled, ctaTitle,
    task, busy, error, draft, onDraft, onSubmit, onCheck, wait,
}) {
    const state = task?.state || 'none';
    const paid = state === 'verified';
    const pending = state === 'pending';

    return (
        <div className="x-task" data-arya={id === 'share' ? 'share' : undefined}>
            <div className="panel-section-title">
                {icon ? <img src={icon} alt="" className="points-icon" width={16} height={16} /> : null}
                {title}
                <span className={`x-task-reward ${paid ? 'is-paid' : ''}`}>
                    {paid ? `+${task.credited || reward} ✓` : `+${reward} PTS`}
                </span>
            </div>
            <p className="panel-hint">{hint}</p>

            {kit}

            {cta && (
                <button
                    className="btn btn-secondary btn-sm w-full"
                    onClick={onCta}
                    disabled={ctaDisabled}
                    title={ctaDisabled && ctaTitle ? ctaTitle : undefined}
                >
                    {cta}
                </button>
            )}

            {paid ? (
                <div className="x-task-line is-paid">
                    <span>Verified with X · {task.credited || reward} PTS paid</span>
                    {task.url && (
                        <a className="x-task-link" href={task.url} target="_blank" rel="noreferrer">
                            view post
                        </a>
                    )}
                </div>
            ) : (
                <div className="x-task-submit">
                    <input
                        id={`x-task-${id}-input`}
                        className="x-task-input"
                        value={draft}
                        onChange={(e) => onDraft(e.target.value)}
                        placeholder="Paste the link to your post"
                        aria-label={`Link to your ${title} post`}
                        disabled={busy === id}
                    />
                    <button
                        className="btn btn-primary btn-sm"
                        onClick={() => onSubmit(draft)}
                        disabled={busy === id || !String(draft || '').trim()}
                    >
                        {busy === id ? 'Asking X…' : 'Verify'}
                    </button>
                </div>
            )}

            {pending && (
                <div className="points-banner points-banner-warn x-task-note" role="status">
                    <span>{task.reason || 'X has not indexed that post yet.'}</span>
                    <button
                        className="btn btn-ghost btn-sm"
                        onClick={onCheck}
                        disabled={busy === id || wait > 0}
                    >
                        {wait > 0 ? `Check again in ${wait}s` : 'Check again'}
                    </button>
                </div>
            )}
            {state === 'failed' && (
                <div className="points-banner points-banner-error x-task-note" role="alert">
                    <span>{task.reason || error || 'That post did not pass the check.'}</span>
                </div>
            )}
            {state === 'expired' && (
                <div className="points-banner points-banner-warn x-task-note" role="status">
                    <span>{task.reason || 'That submission expired. Post again and paste the new link.'}</span>
                </div>
            )}
            {error && state !== 'failed' && <div className="x-task-line is-error">{error}</div>}
        </div>
    );
}

/**
 * One task from the one-time tab.
 *
 * A different shape from `XTaskCard` on purpose, because it is a different bargain: there is no link
 * to paste and no pending state to render. The card states the reward, opens the account in a new
 * tab, and pays on a claim.
 *
 * What it says about the checking is not decided here. `task.blurb` and `task.claimedNote` both come
 * from the server, because whether a follow is checked depends on how the deployment is wired
 * (`lib/x-webhook.js`), and a page that answered that question from its own bundle could advertise a
 * check nothing is running. It also means a claim paid before that wiring existed keeps saying it was
 * taken on trust, instead of being retroactively upgraded to "verified" by a redeploy.
 *
 * The step the task asks for is a button rather than a link in prose, so the one thing it wants is
 * the one thing under the player's thumb.
 */
function OneTimeTaskCard({ task, busy, error, onClaim, canClaim, blockedWhy }) {
    if (!task) return null;
    const claimed = !!task.claimed;
    const pending = !!task.pending;
    const rejected = !!task.rejected;

    // The deadline is the server's, rendered in the player's own clock: counting down from a number
    // in this bundle would tick towards a different minute than the record actually closes on.
    const settleAt = task.settleAt ? new Date(task.settleAt) : null;
    const settleLabel = settleAt && !Number.isNaN(settleAt.getTime())
        ? settleAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : null;

    return (
        <div className={`one-task ${claimed ? 'is-claimed' : ''} ${pending ? 'is-pending' : ''} ${rejected ? 'is-rejected' : ''}`} data-arya="onetime">
            <div className="panel-section-title">
                <img src={`${ASSETS}White_logo_on_black_background_2K_20260919011421-autocrop-hair.png`} alt="" className="points-icon" width={16} height={16} style={{ filter: 'brightness(0) invert(1)' }} />
                {task.title}
                <span className={`x-task-reward ${claimed ? 'is-paid' : ''} ${pending ? 'is-pending' : ''}`}>
                    {claimed ? `+${task.credited || task.reward} \u2713` : `+${task.reward} PTS`}
                </span>
            </div>
            <p className="panel-hint">{task.blurb}</p>
            <div className="one-task-actions">
                <a
                    className="btn btn-secondary btn-sm"
                    href={task.url}
                    target="_blank"
                    rel="noreferrer"
                >
                    {task.cta}
                </a>
                <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={onClaim}
                    disabled={busy || claimed || rejected || !canClaim}
                    title={!canClaim && blockedWhy ? blockedWhy : undefined}
                >
                    {claimed
                        ? 'Claimed'
                        : rejected
                            ? 'Not approved'
                            : busy
                                ? 'Checking\u2026'
                                : pending
                                    ? 'Check status'
                                    : `Claim ${task.reward} PTS`}
                </button>
            </div>
            {pending && (
                <div className="x-task-line is-pending">
                    <span>
                        {task.pendingNote || 'Claim received \u00b7 credited after review'}
                        {settleLabel ? ` \u00b7 by ${settleLabel}` : ''}
                    </span>
                </div>
            )}
            {claimed && (
                <div className="x-task-line is-paid">
                    <span>
                        Paid {task.claimedOn}
                        {task.claimedNote ? ` \u00b7 ${task.claimedNote}` : ''}
                    </span>
                </div>
            )}
            {rejected && (
                <div className="x-task-line is-error">
                    <span>
                        Reviewed {task.rejectedOn} \u00b7 not approved
                        {task.rejectedNote ? `: ${task.rejectedNote}` : ''}
                    </span>
                </div>
            )}
            {error && <div className="x-task-line is-error">{error}</div>}
        </div>
    );
}

export default function PointsPage() {
    // boot → anon (no session) → ready (signed in). `error` is only used when the page
    // itself cannot work, never for a rejected signature the player can retry.
    const [phase, setPhase] = useState('boot');
    const [address, setAddress] = useState(null);
    const [state, setState] = useState(null);
    const [board, setBoard] = useState({ rows: [], loading: true, error: null });
    const [busy, setBusy] = useState(null);
    const [notice, setNotice] = useState(null);
    const [error, setError] = useState(null);
    const [tab, setTab] = useState('leaderboard');
    // Which half of the left panel is showing: the daily run, the tasks that pay once, or what is
    // being given away. The wallet card and the X binding sit above all three, because they are what
    // the first two need and the third reads the leaderboard it sits beside.
    const [panel, setPanel] = useState('daily');
    // The announcements tab wears a `New` badge until it has been opened once, and the browser is
    // what remembers — the same once-only trick `/arya.js` uses for the walkthrough, kept local
    // because "have I read this" is not something a server should be asked about on every visit.
    const [announceRead, setAnnounceRead] = useState(true);
    const [copied, setCopied] = useState(false);
    // Its own flag, because "copy my code" and "copy my link" are two different promises to a player
    // — the button that was pressed is the one that has to say it worked.
    const [codeCopied, setCodeCopied] = useState(false);
    const [inDungeon, setInDungeon] = useState(false);
    const referralInput = useRef(null);
    // The add-a-code box: what has been typed, whether a claim is in flight, and the server's own
    // reason when it refuses — which is shown, because a refusal here is an answer, not a glitch.
    const [refDraft, setRefDraft] = useState('');
    const [refBusy, setRefBusy] = useState(false);
    const [refError, setRefError] = useState(null);
    // Wallet extensions inject `window.ethereum` before page scripts, but not always —
    // a locked-then-unlocked wallet, or a browser that injects late, would otherwise
    // leave the connect button dead until a reload. Detected in an effect (never during
    // render) so the server and the first client paint also agree.
    //
    // What is detected is *how* this browser can connect, not just whether an extension is
    // here: with Privy published there is always a way in, because it will build an embedded
    // wallet from an email address. `walletKind` is that answer, and it can change under the
    // page — the bridge is a React component that mounts a moment after the page does, and
    // it announces itself with `privyBridgeReady`.
    const [walletKind, setWalletKind] = useState(null);
    // ------------------------------------------------------------------ earning on X
    // Which X thing is mid-flight ('bind' | 'campaign' | 'share'), whether this
    // deployment can *prove* a link, the handle a player typed, each task's own error line and
    // pasted link, and the server's throttle countdown.
    const [xBusy, setXBusy] = useState(null);
    const [xProof, setXProof] = useState(null);
    // The X account Privy has linked in *this* browser, if any. Kept as state rather than read at
    // render, because the bridge announces a link landing with an event and the button that offers
    // to prove it must not appear before there is anything to prove.
    const [privyX, setPrivyX] = useState(null);
    const [handleDraft, setHandleDraft] = useState('');
    const [xErrors, setXErrors] = useState({});
    const [xDrafts, setXDrafts] = useState({ campaign: '', share: '' });
    const [xWait, setXWait] = useState({ campaign: 0, share: 0 });
    const [sharePrompt, setSharePrompt] = useState(false);
    // The `New` badge on the announcements tab. Read in an effect, never during render, so the
    // server's paint and the first client paint agree — a storage-off browser just keeps the badge.
    useEffect(() => {
        try {
            setAnnounceRead(window.localStorage.getItem(ANNOUNCE_SEEN_KEY) === '1');
        } catch {
            setAnnounceRead(false);
        }
    }, []);
    const noticeTimer = useRef(null);
    // What Arya's walkthrough reads while it talks. A ref and not the state itself,
    // because her steps are written the moment they show, not when the tour is built.
    const liveRef = useRef({});
    // The header's wallet pill and the page's own disconnect handler, for the wallet menu.
    // The handler lives in a ref because the menu attaches once and must not re-attach every
    // render, while `handleDisconnect` is rebuilt on each one.
    const walletPill = useRef(null);
    const handleDisconnectRef = useRef(() => {});
    // Her walkthrough opens once per visit. It runs on every arrival, but connecting a
    // wallet or leaving the vault re-runs this effect and must not drag her back out.
    const tourOpened = useRef(false);

    const points = state?.points ?? 0;
    const cleared = state?.clearedToday ?? [];
    const connected = phase === 'ready';
    const entryComplete = !!state?.entryComplete;
    const bound = !!state?.x?.username;
    // The streak is a **rule**, not a status: a visitor with no wallet should be able to read what
    // the ladder pays, the same way the three floors above it are readable before connecting. So
    // the server's answer is used when there is one and the published ladder when there is not —
    // and both come from the same two constants the payout is computed from.
    const streak = state?.streak || {
        days: 1,
        multiplier: 1,
        base: STREAK_BASE,
        max: STREAK_MAX_MULTIPLIER,
        award: STREAK_BASE,
        paid: false,
        capped: false,
    };
    // What the one-time tab's badge counts: tasks this wallet has not been paid for yet. Nothing
    // to count before there is a wallet to claim with, so an anonymous visitor sees no badge.
    // A claim inside its review window is not still *waiting for the player* — it is waiting on us,
    // so the badge must not send them back for something they have already done.
    const openOneTime = connected
        ? (state?.oneTime || []).filter((task) => !task.claimed && !task.pending && !task.rejected).length
        : 0;
    // The one-time tab's own arithmetic, in one place. The tab's badge, the progress panel on the
    // left and the heading over the task list all read these, so three parts of one screen cannot
    // disagree about how many tasks are left or what they are worth.
    const oneTimeAll = state?.oneTime || [];
    const oneTimeDone = oneTimeAll.filter((task) => task.claimed);
    const oneTimeOpen = oneTimeAll.filter((task) => !task.claimed);
    const oneTimeAvailable = oneTimeOpen.reduce((sum, task) => sum + (task.reward || 0), 0);
    const oneTimeEarned = oneTimeDone.reduce((sum, task) => sum + (task.credited || task.reward || 0), 0);
    const live = () => liveRef.current;

    /** Open the announcements tab and let its badge go, for good. */
    const openAnnouncements = () => {
        setPanel('announce');
        setAnnounceRead(true);
        try {
            window.localStorage.setItem(ANNOUNCE_SEEN_KEY, '1');
        } catch {
            // Storage off: the badge comes back on the next visit, which is the harmless way round.
        }
    };

    const flash = useCallback((message) => {
        setNotice(message);
        clearTimeout(noticeTimer.current);
        noticeTimer.current = setTimeout(() => setNotice(null), 3400);
    }, []);

    /**
     * A sign-in callback the server dropped, which in practice means a link that was interrupted
     * in flight — the source of this notice. Conditional on purpose: a callback URL pasted by
     * somebody else leaves the server with the same evidence as an interrupted link (none), so the
     * page says what to do about it and does not claim to know which one it was.
     *
     * Read once and deleted, so it appears on the load it happened on rather than on every page
     * the player opens afterwards. The listener covers the case where the notice arrives after this
     * has mounted; the read covers the case where it arrived before.
     */
    useEffect(() => {
        const announce = () => {
            const notice = window.DKPrivyNotice;
            if (!notice?.dropped) return;
            delete window.DKPrivyNotice;
            flash('If you were linking X, that did not finish. Press LINK X ACCOUNT to try again.');
        };
        // After a tick, deliberately: announced during the boot effect's own run, the flash used to
        // be wiped out by that effect's cleanup re-running (it cleared the hide timer) and the line
        // stayed on screen until the next interaction. Let the page settle first.
        const timer = setTimeout(announce, 0);
        window.addEventListener('privyCallbackDropped', announce);
        return () => {
            clearTimeout(timer);
            window.removeEventListener('privyCallbackDropped', announce);
        };
    }, [flash]);

    /**
     * The notice's own timer, cleared on unmount and only on unmount.
     *
     * It used to be cleared from the boot effect's cleanup, which runs on every re-run of that
     * effect as well — so a notice flashed while the page was still settling lost its hide timer and
     * never went away. Where an effect's cleanup cannot tell "unmount" from "ran again", the timer
     * belongs to an effect that can.
     */
    useEffect(() => () => clearTimeout(noticeTimer.current), []);

    const loadBoard = useCallback(async () => {
        try {
            const { rows } = await fetchLeaderboard(BOARD_LIMIT);
            setBoard({ rows, loading: false, error: null });
        } catch (e) {
            setBoard({ rows: [], loading: false, error: e.message });
        }
    }, []);

    /** Claim a `?ref=` code stashed before sign-in. A bad code must never block the page. */
    const attachPendingRef = useCallback(async () => {
        const code = pendingRef();
        if (!code) return null;
        try {
            const fresh = await claimRef(code);
            if (fresh) {
                setState(fresh);
                setAddress(fresh.address);
                if (fresh.referrer) flash('Referral credited. Your points count for your inviter from here.');
                return fresh;
            }
        } catch {
            // Ignored on purpose: the referral is a bonus, not a requirement.
        }
        return null;
    }, [flash]);

    // ---------------------------------------------------------------------- boot
    useEffect(() => {
        let alive = true;
        (async () => {
            const fromUrl = readRefFromUrl();
            if (fromUrl) stashRef(fromUrl);

            loadBoard();

            const session = readSession();
            if (session) {
                try {
                    const fresh = await fetchMe();
                    if (!alive) return;
                    setAddress(fresh.address);
                    setState(fresh);
                    setPhase('ready');
                    if (!fresh.referrer) await attachPendingRef();
                    return;
                } catch (e) {
                    if (e.status === 401) {
                        // Expired or signed with a secret that has since changed — the
                        // player only needs to sign once more.
                        clearSession();
                    } else if (alive) {
                        setError(e.message);
                    }
                }
            }
            if (!alive) return;
            setAddress(savedAddress());
            setPhase('anon');
        })();
        return () => {
            alive = false;
        };
    }, [attachPendingRef, loadBoard]);

    useEffect(() => {
        let alive = true;
        const check = async () => {
            const caps = await walletCapabilities();
            if (!alive) return;
            setWalletKind(caps.injected ? 'injected' : caps.privy ? 'privy' : null);
        };
        check();
        window.addEventListener('focus', check);
        window.addEventListener('ethereum#initialized', check);
        window.addEventListener('privyBridgeReady', check);
        window.addEventListener('privyAuthChanged', check);
        return () => {
            alive = false;
            window.removeEventListener('focus', check);
            window.removeEventListener('ethereum#initialized', check);
            window.removeEventListener('privyBridgeReady', check);
            window.removeEventListener('privyAuthChanged', check);
        };
    }, []);

    // "Can be connected" — an extension, or the Privy login. This is what gates the button.
    const walletReady = !!walletKind;

    // Arya's live view of the page, refreshed on every render, so the lines she reads
    // describe what the visitor is actually looking at.
    useEffect(() => {
        liveRef.current = {
            phase,
            connected,
            walletReady,
            walletKind,
            address: state?.address || address,
            points,
            entryComplete,
            // What her streak line reads: which day the run is on and what it pays.
            streak,
            shared: !!state?.sharedToday,
            bound: !!state?.x?.username,
            rank: state?.rank || 0,
            players: state?.players || 0,
            // Her "once and done" line counts what is still unclaimed, so it has to read the same
            // number the tab's badge does rather than the state it was built from.
            openOneTime,
        };
    });

    // The header's wallet menu, on the control this route renders.
    //
    // `onDisconnect` is the page's own handler: the Points page holds its wallet in state, so a
    // disconnect performed by the menu alone would clear localStorage and leave the header still
    // showing an address. React hands the menu the one function that puts the page back to how it
    // looks with nobody connected.
    // The pill lives on the page *outside* the vault dungeon, so entering a floor unmounts it and
    // coming back mounts a new element. An effect that ran once at mount would leave that new
    // control with no menu on it, which is My Portfolio unreachable from the Points page the
    // moment a player has finished a floor — so this re-runs when the dungeon closes.
    useEffect(() => {
        const pill = walletPill.current;
        if (!pill) return undefined;
        let cancelled = false;
        const attach = () => {
            if (cancelled || !window.WalletMenu) return false;
            window.WalletMenu.attach(pill, { onDisconnect: handleDisconnectRef.current });
            return true;
        };
        if (!attach()) {
            // `afterInteractive`, so on a cold load the script can land after this effect. A few
            // polls beat assuming a load order the framework chooses.
            let tries = 0;
            const timer = setInterval(() => {
                if (attach() || tries++ > 40) clearInterval(timer);
            }, 100);
            return () => { cancelled = true; clearInterval(timer); };
        }
        return () => { cancelled = true; };
    }, [inDungeon]);

    // She walks a first-time player through the page, and only a first-time player.
    // No `force` here on purpose: `/arya.js` remembers that she has been through this on
    // this browser (finishing, skipping, or leaving mid-walkthrough all count), so a second
    // visit goes straight to the page. She is never gone, only quiet — the footer's
    // "Ask Arya" passes `force` and brings her straight back, which is why the tour does not
    // need to be re-run at people who have already read it.
    //
    // `/arya.js` arrives afterInteractive, so this waits for her instead of assuming she is
    // already there, and gives up quietly if she never turns up, because the page works
    // without her. A `false` from `tour()` means she declined this once — already seen, or
    // no steps to walk yet — and nothing retries it: one click on the footer button is the
    // recovery, and repeatedly interrupting is the thing this is here to avoid.
    useEffect(() => {
        if (phase === 'boot' || inDungeon || tourOpened.current) return;
        let tries = 0;
        const timer = setInterval(() => {
            tries += 1;
            const arya = window.Arya;
            if (arya) {
                clearInterval(timer);
                if (tourOpened.current || arya.isTouring()) return;
                tourOpened.current = true;
                arya.tour(TOUR_ID, { steps: pointsTourSteps(live) });
            } else if (tries > 40) {
                clearInterval(timer);
            }
        }, 250);
        return () => clearInterval(timer);
    }, [phase, inDungeon]);

    /** The footer's "Ask Arya" — the walkthrough again, on request, past the seen flag. */
    const handleGuide = () => {
        if (!window.Arya) return;
        window.Arya.tour(TOUR_ID, { steps: pointsTourSteps(live), force: true });
    };

    // The wallet can be switched from the extension while this page is open.
    useEffect(() => onAccountsChanged((next) => {
        if (!next) {
            forgetWallet();
            setState(null);
            setPhase('anon');
            flash('Wallet disconnected.');
            return;
        }
        if (state?.address && isAddress(next) && next.toLowerCase() === state.address.toLowerCase()) return;
        clearSession();
        setState(null);
        setAddress(next);
        setPhase('anon');
        // An account arriving where there was none is a sign-in, not a switch — it is what a
        // Privy login looks like from here, since the embedded wallet it built is installed as
        // this page's provider. Only the case with something to change *from* is a change.
        if (state?.address) flash('Wallet changed. Sign in to keep earning.');
    }), [state?.address, flash]);

    // A Privy sign-in finishes on the player's clock, not the click's: an email address, a code
    // out of the inbox, a wallet approval — seconds or minutes after the button went down, and
    // routinely longer than `connectWallet` will wait. So the event is what completes it here.
    // Without this, someone who signed in with an email address would land back on a page that
    // still thinks nobody is here, with the session already made on Privy's side.
    useEffect(() => {
        const onSignedIn = async (event) => {
            const detail = event?.detail || {};
            if (!detail.authenticated || !isAddress(detail.address)) return;
            // The click's own path is mid-flight and will finish this itself.
            if (busy === 'connect') return;
            if (connected && state?.address?.toLowerCase() === detail.address.toLowerCase()) return;
            try {
                const started = await signIn(detail.address);
                setAddress(started.state.address);
                setState(started.state);
                setPhase('ready');
                loadBoard();
                if (!started.state.referrer) await attachPendingRef();
                if (window.Arya) {
                    window.Arya.say('ready', {
                        message: started.state.points > 0
                            ? `Welcome back, champion. <strong>${started.state.points.toLocaleString()} PTS</strong> to your name.`
                            : 'Your wallet is bound to the vault. Clear three floors and the points are yours.',
                    });
                }
                flash('Signed in with Privy. Your points count on the leaderboard now.');
            } catch (e) {
                // A rejected signature is a decision, not a glitch.
                if (e?.code === 4001 || /rejected/i.test(e?.message || '')) {
                    flash('Signature declined. Connect again when ready.');
                } else setError(e?.message || 'Could not finish signing in.');
            }
        };
        window.addEventListener('privyAuthChanged', onSignedIn);
        return () => window.removeEventListener('privyAuthChanged', onSignedIn);
    }, [busy, connected, state?.address, attachPendingRef, flash, loadBoard]);

    // ------------------------------------------------------------------- actions
    const handleConnect = async () => {
        if (busy) return;
        setBusy('connect');
        setError(null);
        try {
            const wallet = await connectWallet();
            if (!wallet) {
                // Nothing came back: the Privy login is still open, or it was closed. Both are
                // visible to the player — they are looking at the modal — so there is nothing
                // to announce and nothing went wrong. A sign-in that lands after this returns
                // arrives through `privyAuthChanged` and finishes there.
                return;
            }
            const started = await signIn(wallet);
            setAddress(started.state.address);
            setState(started.state);
            setPhase('ready');
            loadBoard();
            if (!started.state.referrer) await attachPendingRef();
            if (window.Arya) {
                window.Arya.say('ready', {
                    message: started.state.points > 0
                        ? `Welcome back, champion. <strong>${started.state.points.toLocaleString()} PTS</strong> to your name${started.state.rank ? `, rank <strong>#${started.state.rank}</strong>` : ''}.`
                        : 'Your wallet is bound to the vault. Clear three floors and the points are yours.',
                });
            }
            flash('Signed in. Your points count on the leaderboard now.');
        } catch (e) {
            // A rejected signature is not an error state, it is a decision.
            if (e?.code === 4001 || /rejected/i.test(e?.message || '')) {
                flash('Signature declined. Connect again when ready.');
                if (window.Arya) {
                    window.Arya.say('alarm', { message: 'Signature declined — nothing was signed and nothing was lost. Ask me again whenever you are ready.' });
                }
            } else setError(e.message || 'Could not connect the wallet.');
        } finally {
            setBusy(null);
        }
    };

    const handleDisconnect = () => {
        forgetWallet();
        setState(null);
        setAddress(null);
        setPhase('anon');
        flash('Disconnected. Your points stay on the server.');
    };
    handleDisconnectRef.current = handleDisconnect;

    // ------------------------------------------------------- earning on X, in the page
    /**
     * The X account Privy has linked, if this browser has one.
     *
     * Read from the bridge rather than kept in this page's state: Privy owns the link, and the
     * player may have made it in a previous session or in another tab.
     */
    const linkedX = () => {
        try {
            return window.privyBridge?.getXAccount?.() || null;
        } catch {
            return null;
        }
    };

    // Watch for the link landing. Privy completes it in its own window, so the page is told rather
    // than asked: `privyAuthChanged` fires again when the user record changes.
    useEffect(() => {
        const read = () => setPrivyX(linkedX());
        read();
        window.addEventListener('privyAuthChanged', read);
        window.addEventListener('privyBridgeReady', read);
        return () => {
            window.removeEventListener('privyAuthChanged', read);
            window.removeEventListener('privyBridgeReady', read);
        };
    }, []);

    // Can this deployment *prove* a binding? Asked once, and only when it would change what the
    // page offers — a provisional binding is the one case where the answer matters.
    useEffect(() => {
        if (!connected || !state?.x || state.x.verified) {
            setXProof(null);
            return undefined;
        }
        let cancelled = false;
        fetchXStatus()
            .then((status) => { if (!cancelled) setXProof(!!status?.verificationAvailable); })
            .catch(() => { if (!cancelled) setXProof(null); });
        return () => { cancelled = true; };
    }, [connected, state?.x?.username, state?.x?.verified]);

    // The throttle is a number of seconds the server hands back, so the page counts it down instead
    // of leaving a button that looks broken while it is really just early.
    useEffect(() => {
        // Keyed by task rather than named: the campaign, the share and each of the quote-reposts
        // carry their own server-issued throttle, so this ticks whatever is counting down instead of
        // needing to know their names.
        if (!Object.values(xWait).some((seconds) => seconds > 0)) return undefined;
        const timer = setTimeout(() => setXWait((w) => Object.fromEntries(
            Object.entries(w).map(([task, seconds]) => [task, Math.max(0, seconds - 1)])
        )), 1000);
        return () => clearTimeout(timer);
    }, [xWait]);

    // The vault hands the player back with X open in another tab, so the paste field is where they
    // return to — put the cursor in it.
    useEffect(() => {
        if (!sharePrompt || inDungeon) return;
        document.getElementById('x-task-share-input')?.focus();
    }, [sharePrompt, inDungeon]);

    /**
     * Bind the X account that earns.
     *
     * Two paths, and the page says which one it took. With a Privy-linked X account it sends the
     * access token as well, and the server proves the link against Privy; without one it sends the
     * handle the player typed, and the binding is provisional. Either way the binding is what makes
     * earning possible at all — the server refuses every award without it, so this is not decoration.
     */
    const handleBindX = useCallback(async (typed) => {
        if (!connected) {
            setError('Connect a wallet first. The X account is bound to it.');
            return;
        }
        setXBusy('bind');
        setError(null);
        setXErrors((e) => ({ ...e, bind: null }));
        try {
            const account = linkedX();
            const identity = account || (typed ? { username: String(typed).trim() } : null);
            if (!identity) {
                // Nothing linked yet: ask Privy for the link. The page learns it landed from
                // `privyAuthChanged`, which is why this does not stand here waiting for it.
                //
                // Awaited, and the answer is *used*. `linkX()` used to return a bare `true` around a
                // call whose promise rejected, so a player with no Privy sign-in was told to finish a
                // link that had never started, while the console filled with an error they could not
                // act on. It resolves to `{ ok, via, reason }` now: an absent bridge, a refused flow
                // and a started one are three different sentences.
                const alreadyBound = Boolean(state?.x?.username);
                const attempt = window.privyBridge?.linkX
                    ? await window.privyBridge.linkX()
                    : {
                        ok: false,
                        // The bound card has no typed field to point at, so the same absence is two
                        // different sentences depending on which card the player is looking at.
                        reason: alreadyBound
                            ? 'Privy is not available here, so this binding stays unproved. Posts are still checked against the handle.'
                            : 'Privy is not available here, so type your X handle below and bind it.',
                    };
                setXErrors((e) => ({
                    ...e,
                    bind: attempt.ok
                        ? (attempt.via === 'wallet'
                            ? 'Sign in with the wallet you already play with. That is deliberate: signing in with X here is what makes Privy build a second wallet, and the one you have is your identity. Finish the sign-in, then press Link X again to attach the account.'
                            : (attempt.via === 'login'
                                ? 'Finish signing in with X in the Privy window — that links the account in the same step.'
                                : (alreadyBound
                                    ? 'Finish linking X in the Privy window, then press that button again.'
                                    : 'Finish linking X in the Privy window, then press Link X again, or type your handle below.')))
                        : (attempt.reason || 'Could not start the X link. Type your handle below instead.'),
                }));
                return;
            }
            const accessToken = window.privyBridge?.getAccessToken
                ? await window.privyBridge.getAccessToken()
                : null;
            const result = await requestBindX(identity, accessToken);
            if (result.state) setState(result.state);
            setHandleDraft('');
            // Three outcomes, said differently on purpose. `privy-no-x` is a signed-in player whose
            // Privy user has no X linked: the binding is real and earns, and linking X is what turns
            // "checked on every post" into "proved once" — worth a sentence, not a refusal.
            flash(result.verified
                ? `@${result.x.username} bound and proved with Privy. Earning is open.`
                : result.proof === 'privy-no-x'
                    ? `@${result.x.username} bound. Earning is open — link X whenever you like and this becomes provable.`
                    : `@${result.x.username} bound. Earning is open, and posts are checked against that handle.`);
        } catch (e) {
            setXErrors((prev) => ({ ...prev, bind: e.message }));
        } finally {
            setXBusy(null);
        }
    }, [connected, flash, state?.x?.username]);

    // -------------------------------------------------------------- the daily share
    // The post is one redirect. The words come down from the server (`state.share`) — the day marker,
    // the doubled total and the player's own invite link — and the picture travels *inside* that
    // link, because `/points` declares a card image for X to unfurl. Nothing has to be attached on
    // the way, so there is no picture here to save, copy or paste.
    const shareKit = state?.share || null;


    /**
     * Put the run in a post.
     *
     * Opened **synchronously**, in the same task as the click, because a window opened after an
     * `await` is one a popup blocker is entitled to refuse. There is nothing to await any more: the
     * composer link is built on the server, and the picture needs no fetch to reach the post — it
     * arrives with the invite link X unfurls.
     */
    const composeShare = useCallback(() => {
        const text = shareKit?.text || '';
        const intent = shareKit?.intentUrl
            || `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
        const win = window.open(intent, '_blank', 'noopener');
        return { post: win ? 'opened' : 'blocked' };
    }, [shareKit?.intentUrl, shareKit?.text]);

    /** Sharing the finished entry doubles it — once a day, and paid by the server. */
    const handleShareX = useCallback(async () => {
        if (!bound) {
            setError('Bind your X account first. The card on the left does it in one tap.');
            return;
        }
        setError(null);
        const { post } = composeShare();
        // A window the browser refused is not a post, and saying nothing about it is how a button
        // comes to look dead.
        if (post === 'blocked') {
            setError('Your browser blocked the tab X would have opened. Allow pop-ups for this site and press the button again.');
            return;
        }
        // Opening the composer is only half of it. The doubling is paid when the link to the post
        // comes back here and X confirms the bound handle wrote it, so this hands the player to the
        // card that takes the link rather than claiming a bonus on a tap — including out of the
        // vault, which covers the page.
        setSharePrompt(true);
        setInDungeon(false);
        flash('The post is open in a new tab, words and picture already in it. Finish it on X, then paste the link below to claim the double.');
    }, [bound, composeShare, flash]);

    /**
     * File the link to a post and let the server decide.
     *
     * Nothing is awarded in this function: the campaign reward and the doubling of a run are both
     * paid by the server, and only after it has asked X about the post and been told the bound
     * handle wrote it. The three answers the page has to render are paid, not-indexed-yet, and
     * not-yours.
     */
    const submitXTask = useCallback(async (task, url) => {
        setXBusy(task);
        setError(null);
        setXErrors((e) => ({ ...e, [task]: null }));
        try {
            const result = task === 'share'
                ? await requestShare(String(url).trim())
                : await requestTask(task, String(url).trim());
            if (result.state) setState(result.state);
            if (result.credited > 0) flash(`Verified by X. +${result.credited} PTS.`);
            else if (result.pending) flash('Posted. X has not indexed that post yet. Give it a moment, then check again.');
            else if (result.alreadyCredited) flash('That one is already paid.');
            loadBoard();
        } catch (e) {
            setXErrors((prev) => ({
                ...prev,
                [task]: e.code === 'x-required'
                    ? 'Bind your X account first. The card on the left does it in one tap.'
                    : e.message,
            }));
            if (e.retryInSeconds) setXWait((w) => ({ ...w, [task]: e.retryInSeconds }));
        } finally {
            setXBusy(null);
        }
    }, [flash, loadBoard]);

    /** Ask X again about a submission it had not indexed. Rate-limited by the server. */
    const checkXTask = useCallback(async (task) => {
        setXBusy(task);
        try {
            const result = await requestTaskCheck(task);
            if (result.state) setState(result.state);
            if (result.credited > 0) flash(`Verified by X. +${result.credited} PTS.`);
            loadBoard();
        } catch (e) {
            setXErrors((prev) => ({ ...prev, [task]: e.message }));
            if (e.retryInSeconds) setXWait((w) => ({ ...w, [task]: e.retryInSeconds }));
        } finally {
            setXBusy(null);
        }
    }, [flash, loadBoard]);

    /**
     * Claim a one-time task — and, while one is in its review window, check on it.
     *
     * The same call does both, because the server decides which is which: a claim inside its window
     * answers with the window, and one whose window has closed is settled on the way in and answers
     * with the credit. That keeps "is it done yet?" from needing a second endpoint that could
     * disagree with this one.
     */
    const handleOneTimeClaim = useCallback(async (taskId) => {
        setXBusy(taskId);
        setError(null);
        setXErrors((e) => ({ ...e, [taskId]: null }));
        try {
            const result = await requestOneTimeClaim(taskId);
            if (result.state) setState(result.state);
            loadBoard();
            // The flash is read off the state that came back rather than off the response's own
            // summary: a second tap racing the first can win nothing and still be told "already
            // paid" a moment before the first one's claim is even written. The state is the
            // authority on what is true, and it always has the claim in it by the time it answers.
            const view = (result.state?.oneTime || []).find((task) => task.id === taskId);
            if (result.credited > 0) flash(`Claimed. +${result.credited} PTS.`);
            else if (view?.pending) flash('Claim received. Points are credited after review.');
            else if (view?.claimed || result.alreadyCredited) flash('That one is already paid.');
        } catch (e) {
            setXErrors((prev) => ({
                ...prev,
                [taskId]: e.code === 'x-required'
                    ? 'Bind your X account first. This task pays against it.'
                    : e.message,
            }));
        } finally {
            setXBusy(null);
        }
    }, [flash, loadBoard]);

    const handleEnterDungeon = () => {
        if (!connected || entryComplete || !bound) return;
        // The vault covers the page, so her walkthrough and its spotlight must not still
        // be standing when it mounts.
        if (window.Arya) window.Arya.endTour();
        setInDungeon(true);
    };

    /**
     * A floor finished. The payout is decided by the server — this only reports which
     * floor it was, so replaying an already-paid floor pays nothing and floors cannot
     * be claimed out of order.
     */
    const handleLevelComplete = useCallback(async (index) => {
        try {
            const result = await requestClear(index);
            if (result.state) setState(result.state);
            // The third floor pays two things — the run and the day's streak bonus — and saying
            // only the first would leave a player wondering where the rest came from.
            if (result.streakAward > 0) {
                flash(`Vault cleared — +${result.credited} PTS, plus a streak bonus of +${result.streakAward} PTS for day ${result.state?.streak?.days}.`);
            } else if (result.credited > 0) flash(`+${result.credited} PTS banked`);
            else if (result.alreadyCleared) flash('That floor was already paid today.');
            loadBoard();
        } catch (e) {
            setError(e.message);
        }
    }, [flash, loadBoard]);

    const handleDungeonExit = () => {
        setInDungeon(false);
        loadBoard();
        // The gate keeper may still be up from the final floor; leaving the vault should
        // not carry her over onto the Points page.
        if (window.Arya) window.Arya.hide();
    };

    /**
     * Copy the invite link. Clipboard permission is not guaranteed (it needs a secure
     * context and often a user gesture the browser trusts), so this falls back to
     * selecting the field and copying the selection the old way — and if even that is
     * blocked, leaves the link selected and says which keys to press. Nothing here may
     * end in a dead end, because the link is the whole referral feature.
     */
    const handleCopyReferral = async () => {
        // The code when there is one, the address only as a fallback — both resolve on arrival, but
        // the code is the form a person can read out loud.
        const link = refLink(state?.refCode || state?.address || address);
        if (!link) return;
        let done = false;
        try {
            await navigator.clipboard.writeText(link);
            done = true;
        } catch {
            const input = referralInput.current;
            if (input) {
                input.focus();
                input.select();
            }
            try {
                done = document.execCommand('copy');
            } catch {
                done = false;
            }
        }
        setCopied(done);
        if (done) {
            setTimeout(() => setCopied(false), 2000);
            flash('Invite link copied. You earn 15% of what they earn.');
        } else {
            flash('Link selected. Press Ctrl+C (⌘C on Mac) to copy it.');
        }
    };

    /**
     * Copy the five characters on their own, for the places a link will not go: a group chat, a
     * voice call, a friend's phone. The code is the same invitation the link carries, so this is a
     * second door to one room rather than a second code.
     */
    const handleCopyCode = async () => {
        const code = state?.refCode;
        if (!code) return;
        let done = false;
        try {
            await navigator.clipboard.writeText(code);
            done = true;
        } catch {
            done = false;
        }
        setCodeCopied(done);
        if (done) {
            setTimeout(() => setCodeCopied(false), 2000);
            flash('Invite code copied. A friend can paste it on the Points page.');
        } else {
            flash('Copying is blocked here — the code is short enough to read out.');
        }
    };

    /**
     * Attach a referrer a player typed in — the path for a wallet that played first and met an
     * inviter later.
     *
     * The refusal is reported, unlike the `?ref=` path, which swallows a bad code on purpose: this
     * one was a deliberate act, so "unknown code" and "that is your own" are answers the player
     * needs. The server's `code` is what the message switches on, never the prose.
     */
    const submitRefCode = async () => {
        const input = refDraft.trim();
        if (!input || refBusy) return;
        setRefBusy(true);
        setRefError(null);
        try {
            const fresh = await attachRef(input);
            if (fresh) {
                setState(fresh);
                setAddress(fresh.address);
                setRefDraft('');
                flash(fresh.referrer
                    ? `Invite code added. ${shortAddress(fresh.referrer)} now earns 15% of your points.`
                    : 'Invite code added.');
            }
        } catch (e) {
            setRefError(e.code === 'already-referred'
                // Permanent, and the box is hidden once a wallet has a referrer, so this is the
                // sentence for two tabs racing rather than for a wrong code.
                ? 'This wallet already has a referrer, and that does not change. Your own code above still works.'
                : (e.message || 'The code could not be added.'));
        } finally {
            setRefBusy(false);
        }
    };

    /**
     * One task, as its card.
     *
     * Two shapes, because there are two bargains. A post to quote is a **checked** task and gets the
     * same card the campaign and the daily share use — `id` is the task's own `kind`, which is the
     * string the server is asked to settle, and nothing here rebuilds it from the task's id. A step
     * off our own pages is a **claimed** task and gets `OneTimeTaskCard`, whose reward is paid by the
     * claim endpoint under that same id.
     */
    const renderOneTimeTask = (task) => (task.proof === 'verify' ? (
        <XTaskCard
            key={task.id}
            id={task.kind}
            title={task.title}
            reward={task.reward}
            hint={task.hint}
            cta={task.cta}
            onCta={() => window.open(task.postUrl, '_blank', 'noopener')}
            task={task}
            busy={xBusy}
            error={xErrors[task.kind]}
            draft={xDrafts[task.kind] || ''}
            onDraft={(value) => setXDrafts((d) => ({ ...d, [task.kind]: value }))}
            onSubmit={(url) => submitXTask(task.kind, url)}
            onCheck={() => checkXTask(task.kind)}
            wait={xWait[task.kind] || 0}
        />
    ) : (
        <OneTimeTaskCard
            key={task.id}
            task={task}
            busy={xBusy === task.id}
            error={xErrors[task.id]}
            onClaim={() => handleOneTimeClaim(task.id)}
            canClaim={connected && bound}
            blockedWhy={!bound
                ? 'Bind your X account first. This task pays against it'
                : undefined}
        />
    ));

    // The stylesheets are rendered in BOTH branches. Returning the vault on its own
    // used to unmount these <link>s, which stripped theme.css and points.css off the
    // page — that is why the vault rendered as raw unstyled HTML.
    // Payouts happen while the vault is covering the page, so its failures and bonuses
    // have to be shown *inside* the vault too — an error the player cannot see reads as
    // the game quietly stealing their points.
    const overlays = (
        <>
            {error && (
                <div className="points-banner points-banner-error points-banner-float" role="alert">
                    <span>{error}</span>
                    <button className="points-banner-x" onClick={() => setError(null)} aria-label="Dismiss">✕</button>
                </div>
            )}
            {notice && <div className="points-notice" role="status">{notice}</div>}
        </>
    );

    const pageStyles = (
        <>
            {/* Versioned like every other sheet: an unversioned `/theme.css` is a CSS change
                that never reaches a returning player. */}
            <link rel="stylesheet" href="/theme.css?v=7" />
            <link rel="stylesheet" href="/css/points.css?v=11" />
            <link rel="stylesheet" href="/css/arya.css?v=3" />
            <Script src="/arya.js?v=4" strategy="afterInteractive" />
            {/* The header's wallet pill gets the same menu every other page's control has. It is
                attached by hand below rather than by selector, because this route renders after
                hydration and a script that scanned the DOM at load would find nothing. */}
            <Script src="/wallet-menu.js?v=1" strategy="afterInteractive" />
            {/* The one page that is a React route rather than a legacy page, so it has to
                pull the wallet source in itself. It is what makes `window.ethereum`
                exist on a phone, where nothing injects one — and what drops it in the
                moment the rest of the game already has. */}
            <Script src="/wallet-source.js?v=3" strategy="afterInteractive" />
        </>
    );

    if (inDungeon) {
        return (
            <>
                {pageStyles}
                {/* No key here on purpose: `cleared` changes every time a floor is cleared,
                    and keying on it would remount the vault mid-run and send the player
                    back to floor 1. The dungeon reads these props once, on mount, and it
                    only ever mounts when the state below is already loaded. */}
                <PointsDungeon
                    onLevelComplete={handleLevelComplete}
                    onExit={handleDungeonExit}
                    onShare={handleShareX}
                    alreadyShared={!!state?.sharedToday}
                    clearedLevels={cleared}
                />
                {overlays}
            </>
        );
    }

    const connectLabel = (() => {
        if (busy === 'connect') return walletKind === 'privy' ? 'Waiting for Privy…' : 'Waiting for your wallet…';
        if (!walletReady) return 'No Web3 wallet detected';
        if (address && !connected) return `Sign in as ${shortAddress(address)}`;
        if (connected) return 'Wallet connected';
        return walletKind === 'privy' ? 'Continue with Privy' : 'Connect Wallet';
    })();

    return (
        <>
            {pageStyles}
            <div className="page points-page" style={{ background: 'var(--bg-dark)' }}>

                {/* Header */}
                <header className="header">
                    <button className="btn btn-ghost btn-sm" onClick={() => { window.location.href = '/'; }}>
                        <img src="assets/ui/exit cross.png" className="btn-icon-img" alt="" /> Kingdom Gate
                    </button>
                    <div className="header-title">POINTS PROGRAM</div>
                    <div className="header-actions">
                        {connected && (
                            <button className="btn btn-ghost btn-sm wallet-chip" onClick={handleDisconnect} title="Click to disconnect">
                                <span className="wallet-chip-dot" aria-hidden="true" />
                                {shortAddress(state.address)}
                            </button>
                        )}
                        <div className="wallet-pill" ref={walletPill}>
                            <img src={`${ASSETS}Gold_coin_badge_with_PTS_2K_20260919011438-autocrop-hair.png`} alt="" className="points-icon" width={18} height={18} />
                            <span>{(connected ? points : 0).toLocaleString()} PTS</span>
                        </div>
                    </div>
                </header>

                {/* Two-panel layout. `min-height: 0` (in points.css) is what keeps the
                    panels inside the viewport — a flex child defaults to min-height:auto,
                    so a long leaderboard would otherwise stretch this row, push the footer
                    off screen, and stop the panel scrolling internally. */}
                <div className="points-main-row">

                    {/* LEFT: Points Actions. The width is a custom property rather than a number so
                        that the phone layout can stack the two panes — see the media block at the
                        bottom of points.css, which is where the board stops being a 1px column. */}
                    <aside className="side-panel points-left-panel" style={{ width: 'var(--points-left-w, 400px)' }}>
                        <div className="side-panel-header">
                            <img src={`${ASSETS}Wooden_treasure_chest_illustration_2K_20260919015044-autocrop-hair.png`} alt="" className="panel-header-icon points-icon" width={20} height={20} />
                            Points Vault
                        </div>
                        <div className="side-panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

                            {/* Two tabs, because there are two kinds of earning on this page and
                                they are different bargains: the daily run resets at midnight, a
                                one-time task pays once and never again. The strip sits at the top so
                                the two are the first thing read, and the badge counts what is still
                                unclaimed for this wallet. */}
                            <div className="points-tabs" role="tablist" aria-label="Ways to earn">
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={panel === 'daily'}
                                    className={`points-tab ${panel === 'daily' ? 'is-active' : ''}`}
                                    onClick={() => setPanel('daily')}
                                >
                                    Daily Run
                                </button>
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={panel === 'onetime'}
                                    className={`points-tab ${panel === 'onetime' ? 'is-active' : ''}`}
                                    onClick={() => setPanel('onetime')}
                                    data-arya="onetime-tab"
                                >
                                    One-time Tasks
                                    {openOneTime > 0 && <span className="points-tab-badge">{openOneTime}</span>}
                                </button>
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={panel === 'announce'}
                                    className={`points-tab ${panel === 'announce' ? 'is-active' : ''}`}
                                    onClick={() => openAnnouncements()}
                                    data-arya="announce-tab"
                                >
                                    Announcements
                                    {!announceRead && <span className="points-tab-badge is-new">New</span>}
                                </button>
                            </div>

                            {/* A deployment with no persistent store still works, but the
                                points reset when the server restarts. Say it plainly. */}
                            {connected && state?.storage && !state.storage.persistent && (
                                <div className="points-banner points-banner-warn" role="status">
                                    <span>
                                        This deployment keeps points in memory
                                        (<code>{state.storage.driver}</code>), so they reset when the server
                                        restarts. Set <code>KV_REST_API_URL</code> and{' '}
                                        <code>KV_REST_API_TOKEN</code> to store them permanently.
                                    </span>
                                </div>
                            )}

                            {/* Wallet — everything below earns into this */}
                            <div className={`wallet-card ${connected ? 'is-connected' : ''}`} data-arya="wallet">
                                {phase === 'boot' ? (
                                    <div className="wallet-card-line">Checking your wallet…</div>
                                ) : connected ? (
                                    <>
                                        <div className="wallet-card-line">
                                            <span className="wallet-chip-dot" aria-hidden="true" />
                                            <strong>{shortAddress(state.address)}</strong>
                                        </div>
                                        <div className="wallet-card-meta">
                                            {state.rank ? `Rank #${state.rank}` : 'Unranked'}
                                            {state.players ? ` of ${state.players.toLocaleString()} players` : ''}
                                            {state.entries ? ` · ${state.entries} vault run${state.entries === 1 ? '' : 's'}` : ''}
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            className="btn btn-primary btn-md w-full"
                                            onClick={handleConnect}
                                            disabled={busy === 'connect' || !walletReady}
                                        >
                                            <img src="assets/ui/shield.png" className="btn-icon-img" alt="" />
                                            {connectLabel}
                                        </button>
                                        <div className="wallet-card-meta">
                                            {walletKind === 'privy'
                                                ? 'No extension? Privy makes you a wallet from an email address — or use any wallet it lists. Free, no gas.'
                                                : walletReady
                                                    ? 'Sign once to bind this wallet. Free, no gas.'
                                                    : 'Install MetaMask (or any Web3 wallet) to earn points.'}
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* ------------------------------------------------------- the X account
                                The gate on earning. Points are awarded against a named X
                                account and the server refuses every award without one, so this
                                is the first thing a player has to do rather than a suggestion
                                at the bottom of the panel. */}
                            <div className={`x-bind-card ${bound ? 'is-bound' : ''}`} data-arya="bind">
                                {bound ? (
                                    <>
                                        <div className="wallet-card-line">
                                            <img src={`${ASSETS}White_logo_on_black_background_2K_20260919011421-autocrop-hair.png`} alt="" className="points-icon" width={16} height={16} style={{ filter: 'brightness(0) invert(1)' }} />
                                            <strong>@{state.x.username}</strong>
                                            {state.x.verified && <span className="x-proof-tag">proved</span>}
                                        </div>
                                        <div className="wallet-card-meta">
                                            {state.x.verified
                                                ? 'Proved with Privy. Everything you earn pays into the wallet above.'
                                                : 'Bound. Every post is checked against this handle before it pays.'}
                                            {' '}One X account earns for one wallet, so a binding is permanent.
                                        </div>
                                        <div className="wallet-card-meta">
                                            The board names you by this handle rather than by your address.
                                        </div>
                                        <div className="x-bind-actions">
                                            {/* Offered whenever the binding is unproved, which is not the same as
                                                "only when an X account is already linked": a typed binding leaves
                                                the player exactly here, with nothing on the page to press. Pressing
                                                it with no link asks Privy for one. */}
                                            {!state.x.verified && xProof !== false && (
                                                <button className="btn btn-secondary btn-sm" onClick={() => handleBindX()} disabled={!!xBusy}>
                                                    {xBusy === 'bind' ? 'Waiting for X…' : (privyX ? `Prove @${privyX.username}` : 'Link X to prove it')}
                                                </button>
                                            )}
                                            {/* No Unbind, and none is coming: a binding a wallet can hand back
                                                is a binding it can hand to a second wallet, which is the whole
                                                of the farming loop the account index exists to stop. Binding a
                                                *different* X account is still possible — the button above. */}
                                            <span className="x-bind-locked">Locked to this wallet</span>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="wallet-card-line">
                                            <img src={`${ASSETS}White_logo_on_black_background_2K_20260919011421-autocrop-hair.png`} alt="" className="points-icon" width={16} height={16} style={{ filter: 'brightness(0) invert(1)' }} />
                                            <strong>Earn with X</strong>
                                        </div>
                                        <div className="wallet-card-meta">
                                            Points are paid against an X account, so bind one before you start. A run
                                            cleared without it is refused.
                                        </div>
                                        <button
                                            className="btn btn-primary btn-sm w-full"
                                            onClick={() => handleBindX()}
                                            disabled={!connected || xBusy === 'bind'}
                                        >
                                            {xBusy === 'bind'
                                                ? 'Checking X…'
                                                : (privyX ? `Bind @${privyX.username}` : 'Link X account')}
                                        </button>
                                        <div className="x-bind-manual">
                                            <input
                                                className="x-task-input"
                                                placeholder="@yourhandle"
                                                value={handleDraft}
                                                onChange={(e) => setHandleDraft(e.target.value)}
                                                aria-label="Your X handle"
                                            />
                                            <button
                                                className="btn btn-secondary btn-sm"
                                                onClick={() => handleBindX(handleDraft)}
                                                disabled={!connected || !handleDraft.trim() || xBusy === 'bind'}
                                            >
                                                Bind
                                            </button>
                                        </div>
                                        <div className="wallet-card-meta">
                                            Linking through Privy proves the account. A typed handle binds just as
                                            well — every post is checked against it before it pays — and linking X
                                            later is what makes the binding provable. One account per wallet, and it
                                            stays bound.
                                        </div>
                                        <div className="wallet-card-meta">
                                            Already playing with a wallet? Linking X signs you in with <em>that</em>
                                            {' '}wallet and attaches the account to it. It never builds a second one,
                                            and it never moves your points.
                                        </div>
                                    </>
                                )}
                                {xErrors.bind && <div className="x-task-line is-error">{xErrors.bind}</div>}
                            </div>

                            {/* ------------------------------------------------------ the Discord
                                A door, not a gate. The card above is what earning requires; this is
                                where the campaign is run — announcements, task drops and support —
                                and it needs no wallet, no handle and no signature, which is why it
                                is a plain invite rather than something that binds an account. It
                                promises nothing about roles: no page here can yet prove which
                                Discord account is which, and a card that implied otherwise would be
                                the kind of claim the copy pass removed everywhere else. */}
                            <div className="discord-card">
                                <div className="wallet-card-line">
                                    <svg className="discord-mark" viewBox="0 0 127.14 96.36" width={16} height={16} aria-hidden="true" focusable="false">
                                        <path fill="currentColor" d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z" />
                                    </svg>
                                    <strong>Join the Discord</strong>
                                </div>
                                <div className="wallet-card-meta">
                                    Announcements, task drops and support live in the server — it is where the
                                    campaign is run from. No wallet needed to read it.
                                </div>
                                <a className="btn btn-secondary btn-sm w-full" href={DISCORD_INVITE} target="_blank" rel="noopener noreferrer">
                                    Open the invite
                                </a>
                            </div>

                            {/* The wallet and the X binding sit above both tabs, because each half of
                                the panel earns into that wallet and is paid against that account —
                                hiding them behind a tab would hide the reason the other tab is
                                locked. Everything below is what resets at midnight; a fragment
                                rather than a wrapper element, because the panel already lays its
                                children out in a column and an extra box would break the gaps. */}
                            {panel === 'daily' && (
                                <>

                            <button
                                className="btn btn-primary btn-md w-full"
                                onClick={handleEnterDungeon}
                                disabled={!connected || entryComplete || !bound}
                                data-arya="vault"
                                style={{ justifyContent: 'flex-start', gap: 10 }}
                                title={!bound ? 'Bind your X account first. Nothing pays without it' : undefined}
                            >
                                <img src="assets/ui/sword.png" className="btn-icon-img" alt="" />
                                <div style={{ textAlign: 'left' }}>
                                    <div>{entryComplete ? 'Vault Cleared Today' : 'Enter Vault'}</div>
                                    <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-secondary)', letterSpacing: 0.5 }}>
                                        {connected
                                            ? (entryComplete
                                                ? 'Come back tomorrow for a fresh run'
                                                : (bound ? `Earn ${VAULT_ENTRY_TOTAL} PTS per run` : 'Bind X to start earning'))
                                            : 'Connect a wallet to enter'}
                                    </div>
                                </div>
                            </button>

                            <div style={{ borderTop: '1px solid var(--border-base)', margin: '4px 0' }} />

                            {/* Daily Progress */}
                            <div className="panel-section-title">
                                Daily Progress ({cleared.length}/{VAULT_LEVELS.length})
                            </div>
                            {VAULT_LEVELS.map((level, i) => (
                                <div key={level.name} className={`stat-row ${cleared.includes(i) ? 'is-done' : ''}`}>
                                    <span className="stat-label">{level.name}</span>
                                    <span className="stat-value" style={{ fontSize: 12 }}>
                                        {cleared.includes(i)
                                            ? <img src={`${ASSETS}Green_checkmark_icon_for_tasks_2K_20260919011426-autocrop-hair.png`} alt="Cleared" className="points-icon" width={16} height={16} />
                                            : `+${level.points} PTS`}
                                    </span>
                                </div>
                            ))}

                            <div style={{ borderTop: '1px solid var(--border-base)', margin: '4px 0' }} />

                            {/* Streak Bonus — the reason to come back tomorrow. It is a separate
                                award from the run and from the share: it pays when the third floor
                                falls, once a day, and the multiplier is the number of consecutive
                                days that has happened. The whole ladder is drawn rather than
                                described, because "day 4 of 15" is a picture, not a sentence. */}
                            <div
                                className="panel-section-title"
                                data-arya="streak"
                                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}
                            >
                                <span>Streak Bonus</span>
                                <span style={{ color: 'var(--accent-gold)', fontSize: 11 }}>
                                    Day {streak.days}
                                    {' · '}
                                    {streak.multiplier}×{streak.capped ? ' (maxed)' : ''}
                                </span>
                            </div>
                            <div className="stat-row" style={{ alignItems: 'flex-start', gap: 10 }}>
                                <span className="stat-label" style={{ lineHeight: 1.35 }}>
                                    Clear all three floors every day. Each day in a row raises the
                                    multiplier on a {streak.base}-point bonus — 1× today to{' '}
                                    {streak.max}× from day {streak.max} — and a missed day starts it
                                    again at 1×.
                                </span>
                                <span className="stat-value" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                                    {streak.paid
                                        ? <>+{streak.award} <img src={`${ASSETS}Green_checkmark_icon_for_tasks_2K_20260919011426-autocrop-hair.png`} alt="Paid" className="points-icon" width={16} height={16} /></>
                                        : `+${streak.award} PTS`}
                                </span>
                            </div>
                            {/* The ladder, drawn rather than described: fifteen bars, the day the
                                wallet is on marked in gold and the days already banked behind it. */}
                            <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 18 }}>
                                {Array.from({ length: streak.max }, (_, i) => {
                                    const step = i + 1;
                                    const here = step === streak.multiplier;
                                    const done = !here && step < streak.multiplier;
                                    return (
                                        <span
                                            key={step}
                                            title={`Day ${step} · ${step}× · ${streak.base * step} PTS`}
                                            style={{
                                                flex: 1,
                                                height: 5 + step,
                                                borderRadius: 2,
                                                background: here
                                                    ? 'var(--accent-gold)'
                                                    : (done ? 'rgba(212, 168, 67, 0.45)' : 'var(--border-base)'),
                                            }}
                                        />
                                    );
                                })}
                            </div>
                            <div className="wallet-card-meta">
                                {streak.paid
                                    ? `Paid today. Tomorrow is day ${streak.days + 1} — ${streak.base * Math.min(streak.days + 1, streak.max)} PTS if the vault falls again.`
                                    : (!connected
                                        ? `Connect a wallet, clear the three floors, and this pays on top of the ${VAULT_ENTRY_TOTAL} PTS run.`
                                        : (entryComplete
                                            ? 'Today is counted. The bonus lands with the third floor.'
                                            : `Pays on top of the ${VAULT_ENTRY_TOTAL} PTS run, the moment the third floor falls.`))}
                            </div>

                            <div style={{ borderTop: '1px solid var(--border-base)', margin: '4px 0' }} />

                            {/* Campaign — rendered only when the server reports one, which is
                                how a deployment with no `X_CAMPAIGN_POST` hides the whole task
                                instead of offering a reward with nothing to quote. */}
                            {state?.tasks?.campaign && (
                                <>
                                    <XTaskCard
                                        id="campaign"
                                        title="Community Task"
                                        icon={`${ASSETS}Golden_trophy_pixel_art_icon_2K_20260919011419-autocrop-hair.png`}
                                        reward={state.campaign?.reward || state.tasks.campaign.reward}
                                        hint={<>
                                            Like, repost and comment on our campaign post, then paste the link to
                                            {' '}<strong>your own</strong> repost. X checks that link before it pays.
                                            Once per wallet, per campaign.
                                        </>}
                                        cta="Open the campaign post"
                                        onCta={() => window.open(state.campaign.url, '_blank', 'noopener')}
                                        ctaDisabled={!connected || !bound}
                                        ctaTitle={!bound ? 'Bind your X account first' : undefined}
                                        task={state.tasks.campaign}
                                        busy={xBusy}
                                        error={xErrors.campaign}
                                        draft={xDrafts.campaign}
                                        onDraft={(value) => setXDrafts((d) => ({ ...d, campaign: value }))}
                                        onSubmit={(url) => submitXTask('campaign', url)}
                                        onCheck={() => checkXTask('campaign')}
                                        wait={xWait.campaign}
                                    />
                                    <div style={{ borderTop: '1px solid var(--border-base)', margin: '4px 0' }} />
                                </>
                            )}

                            {/* X Share — the same verified card, with the doubled run as its reward */}
                            <XTaskCard
                                id="share"
                                title="Daily Share"
                                icon={`${ASSETS}White_logo_on_black_background_2K_20260919011421-autocrop-hair.png`}
                                reward={state?.entryTotalToday || VAULT_ENTRY_TOTAL}
                                hint={`Finish the vault, then post the run. The picture and text — tagged @${shareKit?.tag || 'DNGrobinhood'}, with your invite link — are below. Paste your post's link and the run doubles (${VAULT_ENTRY_TOTAL} → ${VAULT_ENTRY_TOTAL * 2} PTS). Once a day.`}
                                kit={<ShareKit share={shareKit} />}
                                cta={state?.sharedToday ? 'Shared today · resets with the vault' : 'Post the run on X'}
                                onCta={handleShareX}
                                ctaDisabled={!connected || !bound || !entryComplete || !!state?.sharedToday}
                                ctaTitle={!connected
                                    ? 'Connect a wallet first'
                                    : (!bound
                                        ? 'Bind your X account first'
                                        : (!entryComplete
                                            ? 'Clear all three floors first'
                                            : 'Opens X with the post written, picture in the link'))}

                                task={state?.tasks?.share}
                                busy={xBusy}
                                error={xErrors.share}
                                draft={xDrafts.share}
                                onDraft={(value) => setXDrafts((d) => ({ ...d, share: value }))}
                                onSubmit={(url) => submitXTask('share', url)}
                                onCheck={() => checkXTask('share')}
                                wait={xWait.share}
                            />

                            <div style={{ borderTop: '1px solid var(--border-base)', margin: '4px 0' }} />

                            {/* Referral */}
                            <div className="panel-section-title">
                                <img src={`${ASSETS}Silver_chain_link_icon_referrals_2K_20260919011442-autocrop-hair.png`} alt="" className="panel-header-icon points-icon" width={20} height={20} />
                                Refer &amp; Earn
                            </div>
                            <p className="panel-hint">
                                15% of what your referrals earn, and 5% of what theirs earn — paid as they
                                earn it. An invite starts paying once that player has bound their X account
                                and earned {state?.referralMinPoints ?? 10} points of their own, so an empty
                                wallet is worth nothing to either of you. Your code is the invitation, and
                                the link below works too.
                            </p>
                            {connected && state?.refCode && (
                                <div className="ref-code">
                                    <span className="ref-code-label">Your invite code</span>
                                    <span className="ref-code-value">{state.refCode}</span>
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm ref-code-copy"
                                        onClick={handleCopyCode}
                                        title="Copy the five-character code on its own"
                                    >
                                        {codeCopied ? 'Copied' : 'Copy code'}
                                    </button>
                                </div>
                            )}
                            <div className="referral-row" data-arya="refer">
                                {/* An input, not a <code>: the full link has to be selectable
                                    by hand when the clipboard API is unavailable. */}
                                <input
                                    ref={referralInput}
                                    className="referral-code"
                                    readOnly
                                    value={connected ? refLink(state?.refCode || state.address) : 'Connect Wallet'}
                                    onFocus={(e) => e.target.select()}
                                    aria-label="Your invite link"
                                />
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={handleCopyReferral}
                                    disabled={!connected}
                                    style={{ padding: '4px 12px' }}
                                >
                                    {copied ? 'Copied' : 'Copy link'}
                                </button>
                            </div>
                            {connected && (
                                <div className="referral-meta">
                                    {state.referrals.length === 0
                                        ? 'No referrals yet. Your link is above.'
                                        : `${state.referrals.length} invited · ${state.referralsCounting || 0} counting`}
                                </div>
                            )}
                            {state?.referralEarned > 0 && (
                                <div className="ref-earnings">
                                    <span className="ref-earnings-label">Earned from referrals</span>
                                    <span className="ref-earnings-value">+{state.referralEarned.toLocaleString()} PTS</span>
                                </div>
                            )}
                            {/* ------------------------------------------ a code added later
                                Shown only while this wallet has no referrer, because that is the
                                one thing the box cannot change: a wallet keeps the referrer it
                                already has, so offering the field afterwards would be a lie.
                                The hint states the rule the server actually enforces — the share
                                counts from the moment the code is added, never backwards. */}
                            {connected && state && !state.referrer && (
                                <div className="ref-attach" data-arya="ref-attach">
                                    <div className="ref-attach-title">Have a friend’s code?</div>
                                    <p className="panel-hint">
                                        Started playing before you met an inviter? Add their code here.
                                        Their 15% starts from that moment, and points you already earned are
                                        not backdated.
                                    </p>
                                    <div className="referral-row">
                                        <input
                                            className="referral-code ref-attach-input"
                                            value={refDraft}
                                            onChange={(e) => setRefDraft(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === 'Enter') submitRefCode(); }}
                                            placeholder="K7M2Q"
                                            maxLength={64}
                                            spellCheck={false}
                                            autoComplete="off"
                                            autoCapitalize="characters"
                                            disabled={refBusy}
                                            aria-label="Friend’s invite code"
                                        />
                                        <button
                                            type="button"
                                            className="btn btn-primary btn-sm"
                                            onClick={submitRefCode}
                                            disabled={refBusy || !refDraft.trim()}
                                            style={{ padding: '4px 12px' }}
                                        >
                                            {refBusy ? 'Checking…' : 'Add code'}
                                        </button>
                                    </div>
                                    {refError && <div className="ref-attach-error" role="alert">{refError}</div>}
                                </div>
                            )}
                            {state?.referrer && (
                                <div className="referral-meta">
                                    Invited by {shortAddress(state.referrer)}
                                    {state.referredAt ? ' · code added later, so their share counts from then.' : ''}
                                </div>
                            )}
                                </>
                            )}

                            {/* ---------------------------------------------------- one-time tasks
                                Steps a player takes once, paid once. **The cards live in the wide
                                panel beside this one** — a post to quote needs room for a link box
                                and a paragraph, and a column this narrow made the tab read as
                                stacked furniture. What stays here is the summary: how far along the
                                wallet is, and what is still worth going after.

                                Where the *mode* decides what a claim can honestly say (the
                                follow), that sentence comes from the server — see `blurb`. */}
                            {panel === 'onetime' && (
                                <>
                                    <div className="panel-section-title">
                                        <img src={`${ASSETS}Golden_trophy_pixel_art_icon_2K_20260919011419-autocrop-hair.png`} alt="" className="points-icon" width={16} height={16} />
                                        One-time Tasks
                                    </div>
                                    <p className="panel-hint">
                                        Steps you take once. Each one pays a single time per X account.
                                        {(state?.followProof?.mode === 'webhook')
                                            ? ' A follow is checked against X\u2019s own record before it pays.'
                                            : ' A follow claim is reviewed before it is credited, usually within 30\u201345 minutes.'}
                                    </p>

                                    {connected && oneTimeAll.length > 0 && (
                                        <>
                                            <div className="one-progress">
                                                <div className="one-progress-head">
                                                    <span>Claimed</span>
                                                    <span className="one-progress-count">
                                                        {oneTimeDone.length} of {oneTimeAll.length}
                                                    </span>
                                                </div>
                                                {/* The bar is the same fact as the count, drawn: one segment per
                                                    task, filled for the ones this wallet has been paid for. */}
                                                <div className="one-progress-track" role="presentation">
                                                    {oneTimeAll.map((task) => (
                                                        <span
                                                            key={task.id}
                                                            className={`one-progress-seg ${task.claimed ? 'is-done' : ''}`}
                                                            title={`${task.title} — ${task.claimed ? 'claimed' : `${task.reward} PTS`}`}
                                                        />
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="stat-row">
                                                <span className="stat-label">Still on the table</span>
                                                <span className="stat-value" style={{ fontSize: 12, color: 'var(--accent-gold)' }}>
                                                    {oneTimeAvailable.toLocaleString()} PTS
                                                </span>
                                            </div>
                                            <div className="stat-row">
                                                <span className="stat-label">Earned from tasks</span>
                                                <span className="stat-value" style={{ fontSize: 12 }}>
                                                    {oneTimeEarned.toLocaleString()} PTS
                                                </span>
                                            </div>
                                        </>
                                    )}

                                    {!connected ? (
                                        <div className="lb-state">
                                            <img src={`${ASSETS}White_logo_on_black_background_2K_20260919011421-autocrop-hair.png`} alt="" className="points-icon empty-state-icon" width={40} height={40} style={{ filter: 'brightness(0) invert(1)' }} />
                                            <p style={{ fontStyle: 'italic' }}>Connect your wallet to see and claim these.</p>
                                        </div>
                                    ) : oneTimeAll.length === 0 ? (
                                        <div className="lb-state">
                                            <p style={{ fontStyle: 'italic' }}>No one-time tasks are open right now. Check back soon.</p>
                                        </div>
                                    ) : (
                                        <div className="one-task-footer">
                                            <span className="one-hint-wide">The tasks are listed in the panel beside this one.</span>
                                            <span className="one-hint-narrow">The tasks are listed below this panel.</span>
                                        </div>
                                    )}
                                </>
                            )}

                            {/* ------------------------------------------------------ announcements
                                What is being given away, and what it takes to be in the running.
                                The prize is a capsule, so the art is the capsule the Staking Vault
                                already ships — one picture for one object, at a size cut for this
                                panel (320px, 105 KB against the 250 KB original).

                                The numbers are deliberately absent: which wallets, and how many,
                                are announced when they are settled, so the page promises the rule
                                and not a count it would have to walk back. */}
                            {panel === 'announce' && (
                                <>
                                    <div className="panel-section-title">
                                        <img src={`${ASSETS}capsule-panel.png`} alt="" className="points-icon" width={16} height={16} />
                                        Announcements
                                    </div>
                                    <p className="panel-hint">
                                        What is coming, and what it takes to be part of it.
                                    </p>

                                    <div className="announce-card">
                                        <div className="announce-art">
                                            <img
                                                src={`${ASSETS}capsule-panel.png`}
                                                alt="A Knight capsule"
                                                width={320}
                                                height={320}
                                                loading="lazy"
                                                decoding="async"
                                            />
                                        </div>
                                        <div className="announce-kicker">Season giveaway</div>
                                        <h3 className="announce-title">Free Knight capsules for the leaderboard</h3>
                                        <p className="announce-line">
                                            Hold your place on the leaderboard until the season closes, and a free
                                            Knight capsule is yours. Nothing to enter, nothing to claim — being on
                                            the board is the whole of it.
                                        </p>
                                    </div>

                                    <div className="announce-steps">
                                        <div className="announce-step">
                                            <span className="announce-n">1</span>
                                            <span>Climb the leaderboard. Every point you earn carries you up it.</span>
                                        </div>
                                        <div className="announce-step">
                                            <span className="announce-n">2</span>
                                            <span>Stay there. The board is read once, when the season closes.</span>
                                        </div>
                                        <div className="announce-step">
                                            <span className="announce-n">3</span>
                                            <span>Capsules go to the wallets that are still on it.</span>
                                        </div>
                                    </div>

                                    <div className="stat-row">
                                        <span className="stat-label">Your standing</span>
                                        <span className="stat-value">
                                            {connected
                                                ? `${state?.rank ? `#${state.rank}` : 'Unranked'}`
                                                    + `${state?.players ? ` of ${state.players.toLocaleString()}` : ''}`
                                                    + ` · ${points.toLocaleString()} PTS`
                                                : 'Connect your wallet'}
                                        </span>
                                    </div>
                                    <div className="stat-row">
                                        <span className="stat-label">Season day</span>
                                        <span className="stat-value">
                                            {state?.seasonDay ? `Day ${state.seasonDay}` : '—'}
                                        </span>
                                    </div>

                                    {/* -------------------------------------------------- the $DNG airdrop
                                        The second thing the board is for. It says what a player can act on
                                        (standing is what counts) and nothing they could hold us to later:
                                        no supply, no allocation, no date — those are announced on this
                                        tab when they are settled, which is what the note says. */}
                                    <div className="announce-card">
                                        <div className="announce-art">
                                            {/* The cut keeps the coin's own aspect (320×316), so the hint is
                                                316 — a square hint is a 1% squash at the size the sheet
                                                draws it, and a wrong aspect outlives whoever wrote it. */}
                                            <img
                                                src={`${ASSETS}coin-panel.png`}
                                                alt=""
                                                width={320}
                                                height={316}
                                                loading="lazy"
                                                decoding="async"
                                            />
                                        </div>
                                        <div className="announce-kicker">$DNG airdrop</div>
                                        <h3 className="announce-title">The airdrop follows the leaderboard</h3>
                                        <p className="announce-line">
                                            When $DNG goes live, it reaches the wallets that are on the board at
                                            the close. Your standing is your allocation — nothing to enter,
                                            nothing to claim here, and no separate list to sign up for.
                                        </p>
                                        <p className="announce-note">
                                            The supply and the tokenomics are announced on this tab when they are
                                            settled.
                                        </p>
                                    </div>

                                    <div className="one-task-footer">
                                        New announcements arrive on this tab, and the badge clears once you have
                                        read them.
                                    </div>
                                </>
                            )}
                        </div>
                    </aside>

                    {/* RIGHT: the wide panel — the board and the referral list normally, and the
                        one-time task list while that tab is open. The tasks take this side rather
                        than the narrow one because their cards want width: a post to quote carries a
                        link box, an ask and two buttons, and in a 400px column they were the reason
                        the tab read as cramped. The board is not lost — it is one tab away, and its
                        state (the rows, the referral list) is untouched while it is hidden. */}
                    <main className="side-panel" data-arya="board" style={{ flex: 1, borderRight: 'none' }}>
                        <div className="side-panel-header" style={{ justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <img src={`${ASSETS}Golden_trophy_pixel_art_icon_2K_20260919011419-autocrop-hair.png`} alt="" className="panel-header-icon points-icon" width={20} height={20} />
                                {panel === 'onetime' ? 'One-time Tasks' : 'Rankings'}
                            </div>
                            {panel === 'onetime' ? (
                                <span className="one-available-pill">
                                    {oneTimeAvailable > 0 ? `${oneTimeAvailable.toLocaleString()} PTS available` : 'All claimed'}
                                </span>
                            ) : (
                                <div style={{ display: 'flex', gap: 4 }}>
                                    <button className={`btn btn-sm ${tab === 'leaderboard' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('leaderboard')} style={{ fontSize: 11, padding: '4px 12px', letterSpacing: 0.5 }}>
                                        Leaderboard
                                    </button>
                                    <button className={`btn btn-sm ${tab === 'referrals' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('referrals')} style={{ fontSize: 11, padding: '4px 12px', letterSpacing: 0.5 }}>
                                        My Referrals
                                    </button>
                                </div>
                            )}
                        </div>
                        <div className="side-panel-body">
                            {panel === 'onetime' ? (
                                <>
                                    {!connected ? (
                                        <div className="lb-state">
                                            <img src={`${ASSETS}White_logo_on_black_background_2K_20260919011421-autocrop-hair.png`} alt="" className="points-icon empty-state-icon" width={40} height={40} style={{ filter: 'brightness(0) invert(1)' }} />
                                            <p style={{ fontStyle: 'italic' }}>Connect your wallet to see and claim these.</p>
                                        </div>
                                    ) : oneTimeAll.length === 0 ? (
                                        <div className="lb-state">
                                            <p style={{ fontStyle: 'italic' }}>No one-time tasks are open right now. Check back soon.</p>
                                        </div>
                                    ) : (
                                        <>
                                            {/* Open first, claimed after — so the tasks still worth doing lead,
                                                and the ones already paid read as a receipt rather than as work
                                                left undone. The goalless state shares a grid either way. */}
                                            <div className="one-task-grid">
                                                {oneTimeOpen.map(renderOneTimeTask)}
                                            </div>

                                            {oneTimeDone.length > 0 && (
                                                <>
                                                    <div className="one-task-divider">
                                                        <span>Claimed</span>
                                                        <span className="one-task-divider-line" />
                                                    </div>
                                                    <div className="one-task-grid is-done">
                                                        {oneTimeDone.map(renderOneTimeTask)}
                                                    </div>
                                                </>
                                            )}
                                        </>
                                    )}

                                    <div className="one-task-footer">
                                        New tasks appear here as the campaign runs. The tab shows a count when
                                        one is waiting.
                                    </div>
                                </>
                            ) : (
                            <>
                            <div className="stat-row">
                                <span className="stat-label">Your Points</span>
                                <span className="stat-value" style={{ color: 'var(--accent-gold)' }}>
                                    {connected ? `${points.toLocaleString()} PTS` : '—'}
                                </span>
                            </div>
                            {connected && (
                                <div className="stat-row">
                                    <span className="stat-label">Your Rank</span>
                                    <span className="stat-value">
                                        {state.rank ? `#${state.rank} of ${state.players.toLocaleString()}` : 'Unranked'}
                                    </span>
                                </div>
                            )}

                            {tab === 'leaderboard' && (
                                <div className="leaderboard-table" style={{ marginTop: 12 }}>
                                    {board.loading ? (
                                        <div className="lb-state">Loading the rankings…</div>
                                    ) : board.error ? (
                                        <div className="lb-state">
                                            {board.error}
                                            <button className="btn btn-secondary btn-sm" onClick={loadBoard} style={{ marginTop: 10 }}>Retry</button>
                                        </div>
                                    ) : board.rows.length === 0 ? (
                                        <div className="lb-state">
                                            <img src={`${ASSETS}Golden_trophy_pixel_art_icon_2K_20260919011419-autocrop-hair.png`} alt="" className="points-icon empty-state-icon" width={40} height={40} />
                                            <p style={{ fontStyle: 'italic' }}>No players yet. Be the first!</p>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="lb-header">
                                                <span className="lb-rank">#</span>
                                                <span className="lb-name">Player</span>
                                                <span className="lb-points">Points</span>
                                                <span className="lb-refs">Refs</span>
                                            </div>
                                            {board.rows.map((entry) => (
                                                <div key={entry.address} className={`lb-row ${entry.isYou ? 'is-you' : ''} ${entry.rank <= 3 ? `top-${entry.rank}` : ''}`}>
                                                    <span className="lb-rank">{entry.rank}</span>
                                                    {/* Named by the account they earn from, and the address stays
                                                        in the tooltip so a name is still checkable against it. The
                                                        check is only for a binding Privy vouched for: a typed handle
                                                        is a name somebody chose, and this is the one mark that
                                                        separates it from somebody else's typed into a box. */}
                                                    <span className="lb-name" title={entry.address}>
                                                        {entry.handle ? (
                                                            <>
                                                                <span className="lb-handle">@{entry.handle}</span>
                                                                {entry.handleProved && (
                                                                    <span className="lb-proof" title="Proved with Privy">✓</span>
                                                                )}
                                                            </>
                                                        ) : entry.short}
                                                        {entry.isYou && <span className="lb-you-tag">you</span>}
                                                    </span>
                                                    <span className="lb-points">{entry.points.toLocaleString()}</span>
                                                    <span className="lb-refs">{entry.refs}</span>
                                                </div>
                                            ))}
                                            {connected && state.rank && state.rank > board.rows.length && (
                                                <div className="lb-row is-you">
                                                    <span className="lb-rank">{state.rank}</span>
                                                    <span className="lb-name" title={state.address}>
                                                        {state.x?.username ? (
                                                            <>
                                                                <span className="lb-handle">@{state.x.username}</span>
                                                                {state.x.verified && (
                                                                    <span className="lb-proof" title="Proved with Privy">✓</span>
                                                                )}
                                                            </>
                                                        ) : shortAddress(state.address)}
                                                        <span className="lb-you-tag">you</span>
                                                    </span>
                                                    <span className="lb-points">{points.toLocaleString()}</span>
                                                    <span className="lb-refs">{state.referrals.length}</span>
                                                </div>
                                            )}
                                            {!connected && (
                                                <div className="lb-state lb-state-small">
                                                    Connect a wallet to appear here.
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}

                            {tab === 'referrals' && (
                                <div className="referrals-list" style={{ marginTop: 12 }}>
                                    {!connected ? (
                                        <div className="lb-state">
                                            <img src={`${ASSETS}Silver_chain_link_icon_referrals_2K_20260919011442-autocrop-hair.png`} alt="" className="points-icon empty-state-icon" width={40} height={40} />
                                            <p style={{ fontStyle: 'italic' }}>Connect a wallet to see your referrals.</p>
                                        </div>
                                    ) : state.referrals.length === 0 ? (
                                        <div className="lb-state">
                                            <img src={`${ASSETS}Silver_chain_link_icon_referrals_2K_20260919011442-autocrop-hair.png`} alt="" className="points-icon empty-state-icon" width={40} height={40} />
                                            <p style={{ fontStyle: 'italic' }}>No referrals yet. Copy your link and share it.</p>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="ref-header">
                                                <span className="ref-addr">Player</span>
                                                <span className="ref-their">Their PTS</span>
                                                <span className="ref-earned">You earned</span>
                                            </div>
                                            {state.referrals.map((ref) => (
                                                <div key={ref.address} className="ref-row">
                                                    <span className="ref-addr">
                                                        {ref.short}
                                                        {/* Why a row can read "240 their points, +0 you earned".
                                                            The chip is the rule, said per player rather than
                                                            left to the paragraph above the table. */}
                                                        <span
                                                            className={`ref-badge${ref.counting ? '' : ' ref-badge-hold'}`}
                                                            title={ref.counting
                                                                ? 'Bound X and past the earning floor — this invite pays'
                                                                : `Pays once they bind X and earn ${state?.referralMinPoints ?? 10} points`}
                                                        >
                                                            {ref.counting ? 'Counting' : 'Not counting yet'}
                                                        </span>
                                                    </span>
                                                    <span className="ref-their">{ref.theirPoints.toLocaleString()}</span>
                                                    <span className="ref-earned">+{ref.points.toLocaleString()}</span>
                                                </div>
                                            ))}
                                            <div className="ref-row ref-total">
                                                <span className="ref-addr">Total</span>
                                                <span className="ref-their" />
                                                <span className="ref-earned">+{state.referralEarned.toLocaleString()}</span>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                            </>
                            )}
                        </div>
                    </main>
                </div>

                {/* Footer */}
                <footer className="points-footer">
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 0.5 }}>
                        Earn points by completing vault runs, sharing on X, and referring friends
                    </span>
                    {/* The walkthrough only auto-runs for a newcomer — this is how it is
                        asked for a second time. */}
                    <button
                        className="btn btn-ghost btn-sm arya-guide-btn"
                        onClick={handleGuide}
                        title="Arya will walk you through the vault"
                    >
                        <span className="arya-guide-mark" aria-hidden="true">?</span>
                        Ask Arya
                    </button>
                </footer>

                {overlays}
            </div>
        </>
    );
}
