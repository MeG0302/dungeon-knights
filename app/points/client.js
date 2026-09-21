'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
// The Points page is a React route, not a legacy page, so it has to pull Arya in
// itself — the shared gate-keeper popup used across the rest of the game.
import Script from 'next/script';
import { VAULT_LEVELS, VAULT_ENTRY_TOTAL } from '../../lib/points-config';
import {
    claimRef, clearSession, connectWallet, fetchLeaderboard, fetchMe, fetchXStatus, forgetWallet,
    hasInjectedWallet, isAddress, onAccountsChanged, pendingRef, readRefFromUrl,
    readSession, refLink, requestBindX, requestClear, requestOneTimeClaim, requestShare, requestTask,
    requestTaskCheck, savedAddress, shortAddress, signIn, stashRef,
} from '../../lib/points-client';
import PointsDungeon from './dungeon';

const ASSETS = '/assets/points/';
const BOARD_LIMIT = 25;

// Arya's walkthrough of this page. The key is both an identity and the once-ever latch:
// `/arya.js` remembers `dk_arya_tour_<id>`, so this runs for a newcomer and stays quiet for
// anyone who has already been through it — including anyone who skipped it. The footer's
// "Ask Arya" passes `force` and replays it mid-visit without a reload.
const TOUR_ID = 'points-v1';

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
                ? 'Your X account is bound, so everything you earn has a name on it. Posts are checked against that handle — write them from it or they will not count. Note what the page says underneath: a binding is for good, because a binding that can be handed back is one that can be handed to a second wallet.'
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
            kind: 'ready',
            mood: 'Double it',
            target: '[data-arya="share"]',
            text: () => (now().shared
                ? 'Today&rsquo;s share is already claimed — your entry was paid out at double. It resets with the vault tomorrow.'
                : `Clear all three floors and this unlocks. The picture and the text are ready for you here: save the picture, post the run, and paste the link to your post. The text tags <strong>@${(now().share && now().share.tag) || 'DNGrobinhood'}</strong> and carries your invite link. I ask X one thing about that post before paying — that it tags us — and then the whole entry doubles: <strong>${VAULT_ENTRY_TOTAL} becomes ${VAULT_ENTRY_TOTAL * 2} PTS</strong>. Once a day, same as the vault.`),
        },
        {
            // The tab, not its contents: the contents only exist while that tab is open, and a
            // spotlight aimed at markup that is not on the page is a spotlight aimed at nothing.
            kind: 'think',
            mood: 'Once and done',
            target: '[data-arya="onetime-tab"]',
            text: () => `The second tab is different: those tasks pay <strong>once</strong>, ever — no daily reset. There is ${(now().openOneTime || 0) === 1 ? 'one waiting for you now' : `${(now().openOneTime || 0)} waiting for you now`}, and the tab carries the count. ${now().followProof?.mode === 'webhook'
                ? 'Read the small print on each card: a follow is checked against X&rsquo;s own record before it pays.'
                : 'Read the small print on each card: where a step cannot be checked — and a follow cannot — the card says it is taken on your word rather than pretending otherwise.'}`,
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
                ? 'And here it is all counted: every wallet on the program, ranked by points. Your row is the one tagged <strong>you</strong>, so you never have to hunt for it. The second tab lists who you brought in and what each of them has paid you.'
                : 'And here it is all counted: every wallet on the program, ranked by points. Connect yours and your row appears in it, tagged <strong>you</strong>. The second tab lists who you brought in.'),
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
function ShareKit({ share, onSave, saveDisabled }) {
    if (!share) return null;
    return (
        <div className="x-share-kit">
            {/* A link rather than an image, so a phone can long-press it to save. */}
            <a className="x-share-photo" href={share.cardImage} target="_blank" rel="noreferrer">
                <img src={share.cardImage} alt="The picture that goes out with your share" loading="lazy" />
            </a>
            <ol className="x-share-steps">
                <li>The picture travels with the post by itself: your invite link unfurls into a card showing it.</li>
                <li>Save it as well if you want it attached as a file — that step is yours, because X&rsquo;s composer link can only carry text. On a phone the post button hands the picture to X in one go.</li>
                <li>Post the run, then paste the link to your post. X is asked one thing about it: that it tags <strong>@{share.tag}</strong>.</li>
            </ol>
            <button
                type="button"
                className="btn btn-secondary btn-sm w-full"
                onClick={onSave}
                disabled={saveDisabled}
            >
                Save picture
            </button>
            <div className="x-share-text">{share.text}</div>
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
                    <span>Verified with X — {task.credited || reward} PTS paid</span>
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
                        {task.rejectedNote ? ` \u2014 ${task.rejectedNote}` : ''}
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
    // Which half of the left panel is showing: the daily run, or the tasks that pay once. The
    // wallet card and the X binding sit above both, because they are what either half needs.
    const [panel, setPanel] = useState('daily');
    const [copied, setCopied] = useState(false);
    const [inDungeon, setInDungeon] = useState(false);
    const referralInput = useRef(null);
    // Wallet extensions inject `window.ethereum` before page scripts, but not always —
    // a locked-then-unlocked wallet, or a browser that injects late, would otherwise
    // leave the connect button dead until a reload. Detected in an effect (never during
    // render) so the server and the first client paint also agree.
    const [walletReady, setWalletReady] = useState(false);
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
    // What the one-time tab's badge counts: tasks this wallet has not been paid for yet. Nothing
    // to count before there is a wallet to claim with, so an anonymous visitor sees no badge.
    // A claim inside its review window is not still *waiting for the player* — it is waiting on us,
    // so the badge must not send them back for something they have already done.
    const openOneTime = connected
        ? (state?.oneTime || []).filter((task) => !task.claimed && !task.pending && !task.rejected).length
        : 0;
    const live = () => liveRef.current;

    const flash = useCallback((message) => {
        setNotice(message);
        clearTimeout(noticeTimer.current);
        noticeTimer.current = setTimeout(() => setNotice(null), 3400);
    }, []);

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
                if (fresh.referrer) flash('Referral credited — points now count for your inviter.');
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
            clearTimeout(noticeTimer.current);
        };
    }, [attachPendingRef, loadBoard]);

    useEffect(() => {
        const check = () => setWalletReady(hasInjectedWallet());
        check();
        window.addEventListener('focus', check);
        window.addEventListener('ethereum#initialized', check);
        return () => {
            window.removeEventListener('focus', check);
            window.removeEventListener('ethereum#initialized', check);
        };
    }, []);

    // Arya's live view of the page, refreshed on every render, so the lines she reads
    // describe what the visitor is actually looking at.
    useEffect(() => {
        liveRef.current = {
            phase,
            connected,
            walletReady,
            address: state?.address || address,
            points,
            entryComplete,
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
        flash('Wallet changed — sign in to keep earning.');
    }), [state?.address, flash]);

    // ------------------------------------------------------------------- actions
    const handleConnect = async () => {
        if (busy) return;
        setBusy('connect');
        setError(null);
        try {
            const wallet = await connectWallet();
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
            flash('Signed in — points now count on the shared leaderboard.');
        } catch (e) {
            // A rejected signature is not an error state, it is a decision.
            if (e?.code === 4001 || /rejected/i.test(e?.message || '')) {
                flash('Signature declined — connect again when ready.');
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
            setError('Connect a wallet first — the X account is bound to it.');
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
                const started = window.privyBridge?.linkX?.();
                setXErrors((e) => ({
                    ...e,
                    bind: started
                        ? 'Finish linking X in the Privy window, then press Link X again — or type your handle below.'
                        : 'Privy is not available here, so type your X handle below and bind it.',
                }));
                return;
            }
            const accessToken = window.privyBridge?.getAccessToken
                ? await window.privyBridge.getAccessToken()
                : null;
            const result = await requestBindX(identity, accessToken);
            if (result.state) setState(result.state);
            setHandleDraft('');
            flash(result.verified
                ? `@${result.x.username} bound and proved with Privy — earning is open.`
                : `@${result.x.username} bound — earning is open. Posts are checked against that handle.`);
        } catch (e) {
            setXErrors((prev) => ({ ...prev, bind: e.message }));
        } finally {
            setXBusy(null);
        }
    }, [connected, flash]);

    // -------------------------------------------------------------- the daily share
    // The picture cannot ride in X's composer link — attaching a file on someone's behalf needs the
    // paid API — so it reaches the post two ways, and neither of them is a lie: the invite link
    // unfurls into a card built from the same image, and the button saves the file for a player who
    // would rather attach it by hand. The tag and the text come down from the server
    // (`state.share`), so what this page shows and what X is asked about are the same words.
    const shareKit = state?.share || null;

    /**
     * Save the picture on its own. A real anchor click, so it consumes no gesture the composer
     * might need — which is why this is safe to offer next to the post button.
     *
     * This is the route for a player who would rather attach the file by hand: the one thing X's
     * composer link cannot do for them, and the card says so instead of implying otherwise.
     */
    const saveShareImage = useCallback(() => {
        if (!shareKit?.cardImage) return false;
        const link = document.createElement('a');
        link.href = shareKit.cardImage;
        link.download = 'dungeon-knights-points-vault.jpg';
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        link.remove();
        return true;
    }, [shareKit?.cardImage]);

    /**
     * Put the run in a post: the picture first, then the composer.
     *
     * The one-tap path is the platform's own share sheet, which can carry a file and the text
     * together — where it exists. Everywhere else the file is saved and the composer opens
     * prefilled inside the same click, so the popup blocker sees a window the player opened.
     */
    const composeShare = useCallback(async () => {
        const text = shareKit?.text || '';
        const intent = shareKit?.intentUrl
            || `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
        if (shareKit?.cardImage && typeof navigator !== 'undefined' && navigator.share) {
            try {
                const blob = await (await fetch(shareKit.cardImage)).blob();
                const file = new File([blob], 'dungeon-knights-points-vault.jpg', {
                    type: blob.type || 'image/jpeg',
                });
                if (navigator.canShare?.({ files: [file] })) {
                    await navigator.share({ files: [file], text });
                    return 'shared';
                }
            } catch {
                // A cancelled sheet, an old browser, a refused permission — all the same answer:
                // fall through to the path that works without any of them.
            }
        }
        saveShareImage();
        window.open(intent, '_blank', 'noopener');
        return 'saved';
    }, [saveShareImage, shareKit?.cardImage, shareKit?.intentUrl, shareKit?.text]);

    /** Sharing the finished entry doubles it — once a day, and paid by the server. */
    const handleShareX = useCallback(async () => {
        if (!bound) {
            setError('Bind your X account first — the card on the left does it in one tap.');
            return;
        }
        const how = await composeShare();
        // Opening the composer is only half of it. The doubling is paid when the link to the post
        // comes back here and X confirms the bound handle wrote it, so this hands the player to the
        // card that takes the link rather than claiming a bonus on a tap — including out of the
        // vault, which covers the page.
        setSharePrompt(true);
        setInDungeon(false);
        flash(how === 'shared'
            ? 'Picture and text are in your post — finish it on X, then paste the link below to claim the double.'
            : 'Picture saved. Attach it in the composer, post, then paste the link below to claim the double.');
    }, [bound, composeShare, flash]);

    /** Save just the picture, for a player who wants it in hand first. */
    const handleSaveShareImage = useCallback(() => {
        if (!saveShareImage()) {
            setError('The share picture is not available on this deployment.');
            return;
        }
        flash('Picture saved — post it on X and attach the file, or let the link card carry it for you.');
    }, [flash, saveShareImage]);

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
            if (result.credited > 0) flash(`Verified by X — +${result.credited} PTS.`);
            else if (result.pending) flash('Posted. X has not indexed that post yet — give it a moment, then check again.');
            else if (result.alreadyCredited) flash('That one is already paid.');
            loadBoard();
        } catch (e) {
            setXErrors((prev) => ({
                ...prev,
                [task]: e.code === 'x-required'
                    ? 'Bind your X account first — the card on the left does it in one tap.'
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
            if (result.credited > 0) flash(`Verified by X — +${result.credited} PTS.`);
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
            if (result.credited > 0) flash(`Claimed — +${result.credited} PTS.`);
            else if (view?.pending) flash('Claim received — points are credited after review.');
            else if (view?.claimed || result.alreadyCredited) flash('That one is already paid.');
        } catch (e) {
            setXErrors((prev) => ({
                ...prev,
                [taskId]: e.code === 'x-required'
                    ? 'Bind your X account first — this task is paid against it.'
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
            if (result.credited > 0) flash(`+${result.credited} PTS banked`);
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
        const link = refLink(state?.address || address);
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
            flash('Invite link copied — you earn 15% of what they earn.');
        } else {
            flash('Link selected — press Ctrl+C (⌘C on Mac) to copy it.');
        }
    };

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
            <link rel="stylesheet" href="/theme.css?v=6" />
            <link rel="stylesheet" href="/css/points.css?v=9" />
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
        if (busy === 'connect') return 'Waiting for your wallet…';
        if (!walletReady) return 'No Web3 wallet detected';
        if (address && !connected) return `Sign in as ${shortAddress(address)}`;
        return connected ? 'Wallet connected' : 'Connect Wallet';
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
                <div className="points-main-row" style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

                    {/* LEFT: Points Actions */}
                    <aside className="side-panel points-left-panel" style={{ width: 400 }}>
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
                            </div>

                            {/* A deployment with no persistent store still works, but the
                                points reset when the server restarts. Say it plainly. */}
                            {connected && state?.storage && !state.storage.persistent && (
                                <div className="points-banner points-banner-warn" role="status">
                                    <span>
                                        Points on this deployment are stored in memory
                                        (<code>{state.storage.driver}</code>) and reset when the server
                                        restarts. Set <code>KV_REST_API_URL</code> +{' '}
                                        <code>KV_REST_API_TOKEN</code> to make them permanent.
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
                                            {walletReady
                                                ? 'Sign once to bind this wallet to the leaderboard. Free, no gas.'
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
                                            {' '}A binding cannot be handed back — one X account earns for one wallet.
                                        </div>
                                        <div className="x-bind-actions">
                                            {/* Only offered when there is actually a Privy-linked X account to
                                                prove — otherwise it is a button that can only apologise. */}
                                            {!state.x.verified && privyX && xProof !== false && (
                                                <button className="btn btn-secondary btn-sm" onClick={() => handleBindX()} disabled={!!xBusy}>
                                                    {xBusy === 'bind' ? 'Waiting for X…' : `Prove @${privyX.username}`}
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
                                            Points are earned against a named X account, so it has to be bound before
                                            anything pays — a run cleared without one is refused.
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
                                            Linking through Privy proves the account. Typing the handle binds it for
                                            earning either way — nothing pays until a post from that handle checks
                                            out. Bind the account you actually post from: it stays bound.
                                        </div>
                                    </>
                                )}
                                {xErrors.bind && <div className="x-task-line is-error">{xErrors.bind}</div>}
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
                                title={!bound ? 'Bind your X account first — nothing pays without it' : undefined}
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
                                            {' '}<strong>your own</strong> repost. X is asked about that link before it
                                            pays, and it pays once per wallet per campaign.
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
                                hint={`Finish the vault, then post the run: the picture and the text — with @${shareKit?.tag || 'DNGrobinhood'} and your invite link on it — are both ready below. Paste the link to your post and the whole entry doubles (${VAULT_ENTRY_TOTAL} → ${VAULT_ENTRY_TOTAL * 2} PTS). Once a day.`}
                                kit={<ShareKit share={shareKit} onSave={handleSaveShareImage} saveDisabled={!connected} />}
                                cta={state?.sharedToday ? 'Shared today — resets with the vault' : 'Post the run on X'}
                                onCta={handleShareX}
                                ctaDisabled={!connected || !bound || !entryComplete || !!state?.sharedToday}
                                ctaTitle={!connected
                                    ? 'Connect a wallet first'
                                    : (!bound ? 'Bind your X account first' : 'Clear all three floors first')}
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
                                15% of what your referrals earn, 5% of what theirs do — paid the moment they do.
                            </p>
                            <div className="referral-row" data-arya="refer">
                                {/* An input, not a <code>: the full link has to be selectable
                                    by hand when the clipboard API is unavailable. */}
                                <input
                                    ref={referralInput}
                                    className="referral-code"
                                    readOnly
                                    value={connected ? refLink(state.address) : 'Connect Wallet'}
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
                                        ? 'No referrals yet — your link is above.'
                                        : `${state.referrals.length} referral${state.referrals.length === 1 ? '' : 's'}`}
                                </div>
                            )}
                            {state?.referralEarned > 0 && (
                                <div className="ref-earnings">
                                    <span className="ref-earnings-label">Earned from referrals</span>
                                    <span className="ref-earnings-value">+{state.referralEarned.toLocaleString()} PTS</span>
                                </div>
                            )}
                            {state?.referrer && (
                                <div className="referral-meta">
                                    Invited by {shortAddress(state.referrer)}
                                </div>
                            )}
                                </>
                            )}

                            {/* ---------------------------------------------------- one-time tasks
                                Steps a player takes once, paid once. The tab exists because the
                                bargain differs from everything above it, and the cards are written
                                to match: where a reward cannot be checked, the card says so instead
                                of implying a check that never runs. */}
                            {panel === 'onetime' && (
                                <>
                                    <div className="panel-section-title">
                                        <img src={`${ASSETS}Golden_trophy_pixel_art_icon_2K_20260919011419-autocrop-hair.png`} alt="" className="points-icon" width={16} height={16} />
                                        One-time Tasks
                                    </div>
                                    <p className="panel-hint">
                                        Steps you take once. Each one pays a single time, per X account —
                                        {(state?.followProof?.mode === 'webhook')
                                            ? ' and a follow is checked against X\u2019s own record before it pays.'
                                            : ' and a follow claim is reviewed before it is credited, usually within 30\u201345 minutes.'}
                                    </p>

                                    {!connected ? (
                                        <div className="lb-state">
                                            <img src={`${ASSETS}White_logo_on_black_background_2K_20260919011421-autocrop-hair.png`} alt="" className="points-icon empty-state-icon" width={40} height={40} style={{ filter: 'brightness(0) invert(1)' }} />
                                            <p style={{ fontStyle: 'italic' }}>Connect your wallet to see and claim these.</p>
                                        </div>
                                    ) : (state?.oneTime || []).length === 0 ? (
                                        <div className="lb-state">
                                            <p style={{ fontStyle: 'italic' }}>No one-time tasks are open right now — check back soon.</p>
                                        </div>
                                    ) : (
                                        state.oneTime.map((task) => (
                                            task.proof === 'verify' ? (
                                                /* A quote-repost: the same card the campaign and the share use, because
                                                   it is the same bargain — paste the link to your post and X is asked about it.
                                                   `id` is the task's `kind`, which is the string the server is asked to
                                                   settle; nothing here rebuilds it from the id. */
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
                                                    ? 'Bind your X account first — this task is paid against it'
                                                    : undefined}
                                            />
                                            )
                                        ))
                                    )}

                                    <div className="one-task-footer">
                                        New tasks are added here as the campaign runs. The tab carries a count
                                        whenever one is waiting for you.
                                    </div>
                                </>
                            )}
                        </div>
                    </aside>

                    {/* RIGHT: Leaderboard / Referrals */}
                    <main className="side-panel" data-arya="board" style={{ flex: 1, borderRight: 'none' }}>
                        <div className="side-panel-header" style={{ justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <img src={`${ASSETS}Golden_trophy_pixel_art_icon_2K_20260919011419-autocrop-hair.png`} alt="" className="panel-header-icon points-icon" width={20} height={20} />
                                Rankings
                            </div>
                            <div style={{ display: 'flex', gap: 4 }}>
                                <button className={`btn btn-sm ${tab === 'leaderboard' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('leaderboard')} style={{ fontSize: 11, padding: '4px 12px', letterSpacing: 0.5 }}>
                                    Leaderboard
                                </button>
                                <button className={`btn btn-sm ${tab === 'referrals' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('referrals')} style={{ fontSize: 11, padding: '4px 12px', letterSpacing: 0.5 }}>
                                    My Referrals
                                </button>
                            </div>
                        </div>
                        <div className="side-panel-body">
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
                                                    <span className="lb-name">
                                                        {entry.short}
                                                        {entry.isYou && <span className="lb-you-tag">you</span>}
                                                    </span>
                                                    <span className="lb-points">{entry.points.toLocaleString()}</span>
                                                    <span className="lb-refs">{entry.refs}</span>
                                                </div>
                                            ))}
                                            {connected && state.rank && state.rank > board.rows.length && (
                                                <div className="lb-row is-you">
                                                    <span className="lb-rank">{state.rank}</span>
                                                    <span className="lb-name">
                                                        {shortAddress(state.address)}
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
                                                    <span className="ref-addr">{ref.short}</span>
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
