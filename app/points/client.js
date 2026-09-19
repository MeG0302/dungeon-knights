'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
// The Points page is a React route, not a legacy page, so it has to pull Arya in
// itself — the shared gate-keeper popup used across the rest of the game.
import Script from 'next/script';
import { VAULT_LEVELS, VAULT_ENTRY_TOTAL } from '../../lib/points-config';
import {
    claimRef, clearSession, connectWallet, fetchLeaderboard, fetchMe, forgetWallet,
    hasInjectedWallet, isAddress, onAccountsChanged, pendingRef, readRefFromUrl,
    readSession, refLink, requestClear, requestShare, savedAddress, shortAddress, signIn,
    stashRef,
} from '../../lib/points-client';
import PointsDungeon from './dungeon';

const ASSETS = '/assets/points/';
const BOARD_LIMIT = 25;

// Arya's walkthrough of this page. It is remembered under this key, so it runs the
// first time a visitor arrives and then never again — the "Ask Arya" button in the
// footer replays it for anyone who wants the tour a second time.
const TOUR_ID = 'points-v1';

/**
 * The steps she reads out. Every line is a function so that the wallet and vault steps
 * describe the page as it is *right now* (connected, already cleared today) instead of
 * however it looked when the walkthrough was built.
 */
function pointsTourSteps(live) {
    const now = () => live() || {};
    return [
        {
            kind: 'think',
            mood: 'First time here',
            text: 'A new face at the gate. I am Arya, and this is the Points Vault — seven steps from me and the whole page will make sense. Hit <strong>Next</strong> when you are ready, <strong>Skip</strong> if you would rather work it out yourself.',
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
                : `Clear all three floors and this unlocks. Post the run on X and the whole entry doubles: <strong>${VAULT_ENTRY_TOTAL} becomes ${VAULT_ENTRY_TOTAL * 2} PTS</strong>. Once a day, same as the vault.`),
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
            text: 'So: connect, clear three floors, double it on X, and bring friends. The gate is yours — go and earn.',
        },
    ];
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
    const [copied, setCopied] = useState(false);
    const [inDungeon, setInDungeon] = useState(false);
    const referralInput = useRef(null);
    // Wallet extensions inject `window.ethereum` before page scripts, but not always —
    // a locked-then-unlocked wallet, or a browser that injects late, would otherwise
    // leave the connect button dead until a reload. Detected in an effect (never during
    // render) so the server and the first client paint also agree.
    const [walletReady, setWalletReady] = useState(false);
    const noticeTimer = useRef(null);
    // What Arya's walkthrough reads while it talks. A ref and not the state itself,
    // because her steps are written the moment they show, not when the tour is built.
    const liveRef = useRef({});

    const points = state?.points ?? 0;
    const cleared = state?.clearedToday ?? [];
    const connected = phase === 'ready';
    const entryComplete = !!state?.entryComplete;
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
            rank: state?.rank || 0,
            players: state?.players || 0,
        };
    });

    // She walks a first-time visitor through the page exactly once. `/arya.js` arrives
    // afterInteractive, so this waits for her instead of assuming she is already there —
    // and gives up quietly if she never turns up, because the page works without her.
    useEffect(() => {
        if (phase === 'boot' || inDungeon) return;
        let tries = 0;
        const timer = setInterval(() => {
            tries += 1;
            const arya = window.Arya;
            if (arya) {
                clearInterval(timer);
                if (!arya.hasSeenTour(TOUR_ID) && !arya.isTouring()) {
                    arya.tour(TOUR_ID, { steps: pointsTourSteps(live) });
                }
            } else if (tries > 40) {
                clearInterval(timer);
            }
        }, 250);
        return () => clearInterval(timer);
    }, [phase, inDungeon]);

    /** The footer's "Ask Arya" — the walkthrough again, on request. */
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

    const handleEnterDungeon = () => {
        if (!connected || entryComplete) return;
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

    /** Sharing the finished entry doubles it — once a day, and paid by the server. */
    const handleShareX = useCallback(async () => {
        const earned = state?.entryTotalToday || 0;
        const text = encodeURIComponent(
            earned > 0
                ? `I just cleared the Points Vault in Dungeon Knights and earned ${earned} PTS!`
                : "I'm earning points in the Dungeon Knights Points Vault!"
        );
        window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank');
        try {
            const result = await requestShare();
            if (result.state) setState(result.state);
            if (result.credited > 0) flash(`Share bonus paid: +${result.credited} PTS`);
            else if (result.alreadyShared) flash("Today's share bonus is already claimed.");
            loadBoard();
        } catch (e) {
            setError(e.message);
        }
    }, [flash, loadBoard, state?.entryTotalToday]);

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
            <link rel="stylesheet" href="/theme.css" />
            <link rel="stylesheet" href="/css/points.css?v=5" />
            <link rel="stylesheet" href="/css/wallet-widget.css" />
            <link rel="stylesheet" href="/css/arya.css?v=3" />
            <Script src="/arya.js?v=3" strategy="afterInteractive" />
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
                        <div className="wallet-pill">
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

                            <button
                                className="btn btn-primary btn-md w-full"
                                onClick={handleEnterDungeon}
                                disabled={!connected || entryComplete}
                                data-arya="vault"
                                style={{ justifyContent: 'flex-start', gap: 10 }}
                            >
                                <img src="assets/ui/sword.png" className="btn-icon-img" alt="" />
                                <div style={{ textAlign: 'left' }}>
                                    <div>{entryComplete ? 'Vault Cleared Today' : 'Enter Vault'}</div>
                                    <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-secondary)', letterSpacing: 0.5 }}>
                                        {connected
                                            ? (entryComplete ? 'Come back tomorrow for a fresh run' : `Earn ${VAULT_ENTRY_TOTAL} PTS per run`)
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

                            {/* X Share */}
                            <div className="panel-section-title">
                                <img src={`${ASSETS}White_logo_on_black_background_2K_20260919011421-autocrop-hair.png`} alt="" className="points-icon" width={16} height={16} style={{ filter: 'brightness(0) invert(1)' }} />
                                Daily Share
                            </div>
                            <p className="panel-hint">
                                Finish the vault, then share on X to double the whole run ({VAULT_ENTRY_TOTAL} → {VAULT_ENTRY_TOTAL * 2} PTS)
                            </p>
                            <button
                                className={`btn ${state?.sharedToday ? 'btn-primary' : 'btn-secondary'} btn-sm w-full`}
                                onClick={handleShareX}
                                disabled={!connected || !entryComplete || !!state?.sharedToday}
                                data-arya="share"
                                title={!connected ? 'Connect a wallet first' : 'Clear all three floors first'}
                            >
                                {state?.sharedToday ? 'Shared Today (x2)' : 'Share on X'}
                            </button>

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
