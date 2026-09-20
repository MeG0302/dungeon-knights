'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// Arya is the shared gate keeper across the game; a React route has to pull her in
// itself, the same way the Points page does.
import Script from 'next/script';
import {
    connectWallet, forgetWallet, hasInjectedWallet, onAccountsChanged, savedAddress, shortAddress,
} from '../../lib/points-client';
import { CAPSULES_PER_WEEK } from '../../lib/staking-config';
import { applyAction, loadVault, refresh, SOURCE_PREVIEW } from '../../lib/staking-source';

const TABS = [
    { key: 'staked', label: 'Staked' },
    { key: 'raffle', label: 'Raffle' },
    { key: 'capsules', label: 'Capsules' },
];

// Arya's walkthrough of this page. It runs once per visit — a returning player presses
// Skip in one click — and the footer replays it on request.
const TOUR_ID = 'staking-v1';

const TICK_MS = 1000;
const SEEN_KEY = 'dk_staking_seen';

// ---------------------------------------------------------------- the walkthrough
/**
 * What Arya reads out. Every line is a function so she describes the vault as it is right
 * now — how many knights are staked, whether the pool is set — rather than how it looked
 * when this was written.
 */
function tourSteps(live, actions) {
    const now = () => live() || {};
    return [
        {
            kind: 'think',
            mood: 'Welcome',
            text: 'This is the Vault, where your Genesis Knights earn while you are away. Six steps — <strong>Next</strong> to follow me, <strong>Skip</strong> if you would rather explore.',
        },
        {
            kind: () => (now().connected ? 'ready' : 'alarm'),
            mood: 'The vault',
            target: '[data-arya="vault"]',
            text: () => {
                const v = now();
                if (!v.connected) {
                    return 'The vault needs a wallet before it will open. Connect one and I will show you what is inside.';
                }
                if (v.source === SOURCE_PREVIEW) {
                    return 'Your wallet is connected. These knights are <strong>preview data</strong> — the staking contracts are not deployed yet, so nothing here is on-chain and nothing you press spends anything. The page will switch to real holdings on its own once they exist.';
                }
                return 'Your wallet is connected and these are your real Genesis Knights, read from the chain.';
            },
        },
        {
            kind: 'brace',
            mood: 'My Genesis',
            target: '[data-arya="genesis"]',
            text: () => {
                const v = now();
                return `Every Genesis Knight has a <strong>hash power</strong> between 1 and 100, and it decides how fast it earns. ${v.stakedCount
                    ? `You have <strong>${v.stakedCount}</strong> staked with <strong>${v.hashPower}</strong> combined power.`
                    : 'Stake one and its tickets start counting immediately.'} A knight stops earning tickets after a week, so the cap is seven days.`;
            },
        },
        {
            kind: 'ready',
            mood: 'The numbers',
            target: '[data-arya="tiles"]',
            text: () => {
                const v = now();
                if (v.poolDng === null) {
                    return 'The weekly pool is not decided yet — the tokenomics are still being worked out — so the DNG figures read <strong>TBD</strong>. Your <em>share</em> of that pool is real and it grows every second while you watch.';
                }
                return `A pool of <strong>${v.poolDng.toLocaleString()} DNG</strong> is split each week in proportion to tickets, and <strong>${CAPSULES_PER_WEEK}</strong> capsules go to the draw. Both are claimable without unstaking.`;
            },
        },
        {
            kind: 'think',
            mood: 'The draw',
            target: '[data-arya="tabs"]',
            text: () => {
                const v = now();
                return `Three views: what you have <strong>Staked</strong>, the <strong>Raffle</strong> and your <strong>Capsules</strong>. One entry a week per knight, drawn Monday at 00:00 UTC. Your entries show their expected capsule share, so you can see the odds rather than guess at them.${v.phase === 'pending' ? ' The draw is running right now.' : ''}`;
            },
        },
        {
            kind: 'ready',
            mood: 'Fair warning',
            target: '[data-arya="footer"]',
            text: 'Two things worth saying plainly. Unstaking forfeits the tickets that knight earned — tickets only count while it is staked. And early on, with few knights in the pool, one player can take most of a draw. That is the formula working, not a fault. Ask me again any time from down here.',
        },
    ];
}

// ------------------------------------------------------------------- formatting
function fmtInt(value) {
    return Math.round(value || 0).toLocaleString();
}

function fmtHours(hours) {
    if (!Number.isFinite(hours) || hours < 0) return '—';
    if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
    if (hours < 48) return `${Math.floor(hours)}h ${Math.round((hours % 1) * 60)}m`;
    return `${Math.floor(hours / 24)}d ${Math.floor(hours % 24)}h`;
}

function fmtCountdown(ms, phase) {
    if (phase === 'pending') return 'Drawing…';
    const total = Math.max(0, Math.floor(ms / 1000));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
    return `${mins}m ${secs}s`;
}

function fmtPct(fraction, digits = 2) {
    return `${(100 * (fraction || 0)).toFixed(digits)}%`;
}

/** Pool share reads as a fraction of a percent for a while, so it needs its own scale. */
function fmtShare(fraction) {
    const pct = 100 * (fraction || 0);
    if (pct === 0) return '0%';
    if (pct < 0.01) return `${pct.toFixed(4)}%`;
    return `${pct.toFixed(2)}%`;
}

/**
 * An accrual figure needs more precision than a plain percentage.
 *
 * A weekly pool divided over 604,800 seconds moves a share by roughly 0.00007% each
 * second, which is invisible at two decimals — the number would sit still for half a
 * minute and look broken. Five decimals step about seven times a second, which is the
 * point: the staker can see it earning.
 */
function fmtSharePrecise(fraction, digits = 5) {
    return `${(100 * (fraction || 0)).toFixed(digits)}%`;
}

function fmtDng(value) {
    if (value === null || value === undefined) return 'TBD';
    return `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DNG`;
}

export default function StakingClient() {
    const [phase, setPhase] = useState('boot');
    const [vault, setVault] = useState(null);
    const [address, setAddress] = useState(null);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [tab, setTab] = useState('staked');
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    const [approved, setApproved] = useState(() => new Set());
    const [since, setSince] = useState(null);
    const [dismissedSince, setDismissedSince] = useState(false);

    const tourOpened = useRef(false);
    const tabRefs = useRef({});

    const live = useMemo(() => (vault ? refresh(vault, nowMs) : null), [vault, nowMs]);

    // -------------------------------------------------------------- boot the wallet
    const load = useCallback(async (who) => {
        setPhase('loading');
        try {
            const config = await fetch('/api/staking/config').then((r) => (r.ok ? r.json() : null)).catch(() => null);
            const next = await loadVault(who, { config, nowMs: Date.now() });
            setVault(next);
            setPhase('ready');
        } catch (err) {
            setError(err?.message || 'Could not open the vault.');
            setPhase('ready');
        }
    }, []);

    useEffect(() => {
        const stored = savedAddress();
        if (stored) {
            setAddress(stored);
            load(stored);
        } else {
            setVault(null);
            setPhase('ready');
        }

        return onAccountsChanged((next) => {
            if (!next) {
                setAddress(null);
                setVault(null);
                return;
            }
            setAddress(next);
            load(next);
        });
    }, [load]);

    // The tab lives in the URL so a refresh, a back button or a shared link all land on
    // the view someone was actually looking at.
    useEffect(() => {
        const fromUrl = new URLSearchParams(window.location.search).get('tab');
        if (fromUrl && TABS.some((t) => t.key === fromUrl)) setTab(fromUrl);
    }, []);

    const selectTab = useCallback((key, { focus = false } = {}) => {
        setTab(key);
        const url = new URL(window.location.href);
        url.searchParams.set('tab', key);
        window.history.replaceState(null, '', url);
        if (focus) tabRefs.current[key]?.focus();
    }, []);

    // Arrow keys move relative to the tab that has *focus*, not the one that is selected.
    // The two usually agree, but when they do not — a script, an assistive tool or a
    // restored URL can focus a tab without selecting it — measuring from the selection
    // sends the caret somewhere the player was not looking.
    const onTabKeyDown = (event) => {
        const focusedKey = event.target?.closest?.('.sv-tab')?.dataset?.key || tab;
        const index = TABS.findIndex((t) => t.key === focusedKey);
        if (index === -1) return;
        const last = TABS.length - 1;
        let next = null;
        if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
        else if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = last;
        if (next === null) return;
        event.preventDefault();
        selectTab(TABS[next].key, { focus: true });
    };

    // ------------------------------------------------------------------- the tick
    // One interval drives every live figure. It pauses while the tab is hidden, because
    // an accrual that keeps running off screen is a number nobody is reading.
    useEffect(() => {
        const id = setInterval(() => {
            if (typeof document !== 'undefined' && document.hidden) return;
            setNowMs(Date.now());
        }, TICK_MS);
        return () => clearInterval(id);
    }, []);

    // ------------------------------------------------- what changed while you were away
    // A staker coming back needs the one line that matters: what did the staking earn
    // since last time. Read before the new timestamp is written.
    useEffect(() => {
        if (!live?.connected || !live.wallet) {
            setSince(null);
            return;
        }
        const key = `${SEEN_KEY}:${live.wallet.toLowerCase()}`;
        let stored = null;
        try {
            stored = JSON.parse(window.localStorage.getItem(key) || 'null');
        } catch {
            stored = null;
        }
        if (stored?.at && Array.isArray(stored.tickets)) {
            const before = stored.tickets.reduce((sum, entry) => {
                const now = live.staked.find((k) => k.tokenId === entry.tokenId);
                return sum + (now ? now.tickets - entry.tickets : 0);
            }, 0);
            if (before > 0 && Date.now() - stored.at > 3_600_000) {
                setSince({ tickets: before, away: Date.now() - stored.at });
            }
        }
    }, [live?.wallet, live?.connected]);

    useEffect(() => {
        if (!live?.connected || !live.wallet || phase !== 'ready') return;
        const key = `${SEEN_KEY}:${live.wallet.toLowerCase()}`;
        try {
            window.localStorage.setItem(key, JSON.stringify({
                at: Date.now(),
                tickets: (live.staked || []).map((k) => ({ tokenId: k.tokenId, tickets: k.tickets })),
            }));
        } catch {
            // A full or disabled localStorage must not break the page.
        }
    }, [phase, live?.wallet, live?.connected]);

    // --------------------------------------------------------------- Arya's walkthrough
    const liveRef = useRef(live);
    liveRef.current = live;

    useEffect(() => {
        if (phase !== 'ready' || tourOpened.current) return undefined;
        let cancelled = false;
        const timer = setTimeout(() => {
            if (cancelled || tourOpened.current) return;
            const arya = window.Arya;
            if (!arya || arya.isTouring?.()) return;
            tourOpened.current = true;
            if (!arya.tour(TOUR_ID, { steps: tourSteps(() => liveRef.current, {}), force: true })) {
                tourOpened.current = false;
            }
        }, 900);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [phase]);

    const askArya = () => {
        if (!window.Arya) return;
        window.Arya.tour(TOUR_ID, { steps: tourSteps(() => liveRef.current, {}), force: true });
    };

    // ------------------------------------------------------------------- the actions
    const run = useCallback((action, payload) => {
        setError(null);
        setBusy(action);
        const result = applyAction(liveRef.current, action, payload, Date.now());
        setBusy(null);
        if (result.error) {
            setError(result.error);
            if (window.Arya?.say) window.Arya.say('alarm', { message: result.error });
            return null;
        }
        if (result.snapshot) setVault(result.snapshot);
        if (result.notice) {
            setNotice(result.notice);
            setTimeout(() => setNotice((current) => (current === result.notice ? null : current)), 6000);
        }
        if (result.redirect) {
            // A capsule opens in the Summoning Chamber, where the knight is revealed.
            setTimeout(() => { window.location.href = result.redirect; }, 1200);
        }
        if (window.Arya?.say) window.Arya.say('ready', { message: result.notice });
        return result;
    }, []);

    const handleConnect = async () => {
        setError(null);
        setBusy('connect');
        try {
            const who = await connectWallet();
            setAddress(who);
            await load(who);
        } catch (err) {
            setError(err?.message || 'The wallet refused to connect.');
        } finally {
            setBusy(null);
        }
    };

    const handleDisconnect = () => {
        forgetWallet();
        setAddress(null);
        setVault(null);
        setApproved(new Set());
        if (window.Arya?.hide) window.Arya.hide();
    };

    // ------------------------------------------------------------------------ render
    const pageStyles = (
        <>
            <link rel="stylesheet" href="/theme.css" />
            <link rel="stylesheet" href="/css/staking.css?v=1" />
            <link rel="stylesheet" href="/css/wallet-widget.css" />
            <link rel="stylesheet" href="/css/arya.css?v=3" />
            <Script src="/arya.js?v=3" strategy="afterInteractive" />
            <Script src="/wallet-source.js?v=1" strategy="afterInteractive" />
        </>
    );

    if (phase === 'boot' || phase === 'loading') {
        return (
            <>
                {pageStyles}
                <div className="page staking-page" style={{ background: 'var(--bg-dark)' }}>
                    <header className="header">
                        <button className="btn btn-ghost btn-sm" onClick={() => { window.location.href = '/'; }}>
                            <img src="assets/ui/exit cross.png" className="btn-icon-img" alt="" /> Kingdom Gate
                        </button>
                        <div className="header-title">STAKING VAULT</div>
                        <div className="header-actions" />
                    </header>
                    <div className="sv-main-row" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div className="sv-empty">
                            <div className="sv-empty-title">Opening the vault</div>
                            <div className="sv-empty-text">Reading your Genesis Knights{phase === 'boot' ? '' : ' and this week&rsquo;s draw'}…</div>
                        </div>
                    </div>
                </div>
            </>
        );
    }

    const connected = !!live?.connected;
    const isPreview = live?.source === SOURCE_PREVIEW;
    const staked = live?.staked || [];
    const owned = live?.owned || [];
    const totals = live?.totals || {};
    const pool = live?.pool || {};
    const week = live?.week || {};
    const poolDng = live?.pool?.dng ?? null;

    const countdownMs = (week.drawAt || 0) - nowMs;
    const myAccruedShare = staked.reduce((sum, knight) => sum + (knight.accruedShare || 0), 0);
    const claimable = poolDng === null ? null : myAccruedShare * poolDng;

    // One sentence for a screen reader, instead of a tick every second.
    const liveSummary = connected
        ? `Staked knights ${totals.stakedCount || 0}. Tickets ${fmtInt(totals.myTickets)}. Pool share ${fmtShare(totals.myShare)}. ${poolDng === null ? 'Weekly pool not decided yet.' : `Claimable ${fmtDng(claimable)}.`}`
        : 'No wallet connected.';

    const connectLabel = (() => {
        if (busy === 'connect') return 'Waiting for your wallet…';
        if (!hasInjectedWallet()) return 'No Web3 wallet detected';
        return address && !connected ? `Sign in as ${shortAddress(address)}` : 'Connect Wallet';
    })();

    const previewBadge = isPreview && (
        <span className="sv-preview-badge" title="These holdings are placeholder data — the staking contracts are not deployed yet.">
            ● Preview data
        </span>
    );

    return (
        <>
            {pageStyles}
            <div className="page staking-page" style={{ background: 'var(--bg-dark)' }}>

                <header className="header">
                    <button className="btn btn-ghost btn-sm" onClick={() => { window.location.href = '/'; }}>
                        <img src="assets/ui/exit cross.png" className="btn-icon-img" alt="" /> Kingdom Gate
                    </button>
                    <div className="header-title">STAKING VAULT</div>
                    <div className="header-actions" data-arya="wallet">
                        {connected && (
                            <button className="btn btn-ghost btn-sm wallet-chip" onClick={handleDisconnect} title="Click to disconnect">
                                <span className="wallet-chip-dot" aria-hidden="true" />
                                {shortAddress(live.wallet)}
                            </button>
                        )}
                        <div className="wallet-pill">
                            <span className="sv-num">
                                {poolDng === null ? 'POOL · TBD' : `POOL · ${poolDng.toLocaleString()} DNG`}
                            </span>
                        </div>
                    </div>
                </header>

                <div className="sv-main-row" style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

                    {/* LEFT — the player's Genesis Knights */}
                    <aside className="side-panel" style={{ width: 400 }} data-arya="genesis">
                        <div className="side-panel-header">
                            <img src="assets/ui/shield.png" className="panel-header-icon" alt="" />
                            My Genesis
                            {previewBadge}
                        </div>
                        <div className="side-panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

                            {isPreview && (
                                <p className="sv-preview-note">
                                    The staking contracts are not deployed yet, so this vault is showing a
                                    preview built from your address: the maths, the countdown and every
                                    interaction are real, the holdings are not.
                                </p>
                            )}

                            {!connected ? (
                                <div className="sv-empty">
                                    <div className="sv-empty-title">The vault is closed</div>
                                    <div className="sv-empty-text">
                                        Connect a wallet to see your Genesis Knights, stake them, and enter the weekly draw.
                                    </div>
                                    <button
                                        className="btn btn-primary btn-md"
                                        onClick={handleConnect}
                                        disabled={!hasInjectedWallet() || busy === 'connect'}
                                    >
                                        {connectLabel}
                                    </button>
                                    {!hasInjectedWallet() && (
                                        <div className="sv-empty-text">
                                            No wallet in this browser. Install MetaMask (or any Web3 wallet) and reload.
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <>
                                    {since && !dismissedSince && (
                                        <div className="sv-banner is-good" role="status">
                                            <span>
                                                Since your last visit, {fmtHours(since.away / 3_600_000)} ago, your
                                                knights earned <strong className="sv-num">+{fmtInt(since.tickets)}</strong> tickets.
                                            </span>
                                            <button className="sv-banner-x" onClick={() => setDismissedSince(true)} aria-label="Dismiss">✕</button>
                                        </div>
                                    )}

                                    <div className="sv-summary">
                                        <div className="sv-summary-head">
                                            <div className="sv-summary-wallet">
                                                <span className="wallet-chip-dot" aria-hidden="true" />
                                                {shortAddress(live.wallet)}
                                            </div>
                                            {isPreview && <span className="sv-chip">Preview</span>}
                                        </div>
                                        <div className="sv-summary-grid">
                                            <div className="sv-summary-cell">
                                                <span className="sv-summary-label">Staked</span>
                                                <span className="sv-summary-value is-gold sv-num" aria-hidden="true">
                                                    {totals.stakedCount || 0} <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>/ {totals.ownedCount || 0}</span>
                                                </span>
                                            </div>
                                            <div className="sv-summary-cell">
                                                <span className="sv-summary-label">Total tickets</span>
                                                <span className="sv-summary-value is-gold sv-num" aria-hidden="true">{fmtInt(totals.myTickets)}</span>
                                            </div>
                                            <div className="sv-summary-cell">
                                                <span className="sv-summary-label">Pool share</span>
                                                <span className="sv-summary-value sv-num" aria-hidden="true">{fmtShare(totals.myShare)}</span>
                                            </div>
                                            <div className="sv-summary-cell">
                                                <span className="sv-summary-label">Claimable</span>
                                                <span className={`sv-summary-value sv-num ${poolDng === null ? '' : 'is-gold'}`} aria-hidden="true">
                                                    {poolDng === null ? 'TBD' : fmtDng(claimable)}
                                                </span>
                                            </div>
                                        </div>
                                        {/* The live line. It has to move every second or the vault looks
                                            idle, and while the pool is undecided the only honest thing
                                            that can move is the share of it. */}
                                        <p className="sv-accruing sv-num" aria-hidden="true">
                                            {poolDng === null
                                                ? <>Accruing now · {fmtSharePrecise(myAccruedShare)} of the pool</>
                                                : <>Accruing now · {fmtDng(claimable)}</>}
                                        </p>
                                    </div>

                                    <p className="sv-sr-only" aria-live="polite">{liveSummary}</p>

                                    {/* Unstaked first: the action a player most often wants is the
                                        one that is not possible from a list of staked knights. */}
                                    <div className="sv-bulk">
                                        <span className="sv-bulk-note">
                                            {owned.length
                                                ? `${owned.length} knight${owned.length === 1 ? '' : 's'} ready to stake`
                                                : 'Every Genesis Knight is staked'}
                                        </span>
                                        {owned.length > 1 && (
                                            <button className="btn btn-secondary btn-sm" onClick={() => run('stakeAll')} disabled={!live.canWrite || !!busy}>
                                                Stake all
                                            </button>
                                        )}
                                    </div>

                                    {!owned.length && !staked.length && (
                                        <div className="sv-empty">
                                            <div className="sv-empty-title">No Genesis Knights</div>
                                            <div className="sv-empty-text">
                                                This wallet holds none of the 1,024 Genesis Knights. Those are the only
                                                knights the vault accepts.
                                            </div>
                                        </div>
                                    )}

                                    {!!owned.length && (
                                        <div className="sv-card-list">
                                            {owned.map((knight) => (
                                                <GenesisCard
                                                    key={knight.tokenId}
                                                    knight={knight}
                                                    busy={busy}
                                                    canWrite={live.canWrite}
                                                    onStake={() => run('stake', { tokenId: knight.tokenId })}
                                                />
                                            ))}
                                        </div>
                                    )}

                                    {!!staked.length && (
                                        <div className="sv-card-list">
                                            {staked.map((knight) => (
                                                <GenesisCard
                                                    key={knight.tokenId}
                                                    knight={knight}
                                                    staked
                                                    busy={busy}
                                                    canWrite={live.canWrite}
                                                    nowMs={nowMs}
                                                    onClaim={() => run('claim', { tokenId: knight.tokenId })}
                                                    onUnstake={() => run('unstake', { tokenId: knight.tokenId })}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </aside>

                    {/* RIGHT — the numbers and the draw */}
                    <main className="side-panel" style={{ flex: 1, borderRight: 'none' }}>
                        <div className="side-panel-header">
                            <img src="assets/ui/castle.png" className="panel-header-icon" alt="" />
                            Staking Vault
                        </div>
                        <div className="side-panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                            <div className="sv-tiles" data-arya="tiles">
                                <div className="sv-tile">
                                    <span className="sv-tile-label">Weekly pool</span>
                                    <span className="sv-tile-value sv-num" aria-hidden="true">
                                        {poolDng === null ? 'TBD' : poolDng.toLocaleString()}
                                    </span>
                                    <span className="sv-tile-sub">
                                        {poolDng === null
                                            ? 'Split by ticket share once the tokenomics are set.'
                                            : 'DNG split each week in proportion to tickets.'}
                                    </span>
                                </div>
                                <div className="sv-tile">
                                    <span className="sv-tile-label">Capsules left</span>
                                    <span className="sv-tile-value sv-num" aria-hidden="true">
                                        {pool.left ?? CAPSULES_PER_WEEK} <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>/ {pool.capsulesPerWeek ?? CAPSULES_PER_WEEK}</span>
                                    </span>
                                    <span className="sv-tile-sub">
                                        Your share of the draw: {fmtShare(totals.myShare)} → {fmtInt(totals.expectedCapsules)} expected
                                    </span>
                                </div>
                                <div className={`sv-tile ${week.phase === 'pending' ? 'is-drawing' : ''}`}>
                                    <span className="sv-tile-label">Next draw</span>
                                    <span className="sv-tile-value sv-num" aria-hidden="true">
                                        {fmtCountdown(countdownMs, week.phase)}
                                    </span>
                                    <span className="sv-tile-sub">
                                        {week.phase === 'pending'
                                            ? 'This week’s winners are being drawn.'
                                            : `Week ${week.number} · Monday 00:00 UTC${week.phase === 'final' ? ' · final hour' : ''}`}
                                    </span>
                                </div>
                            </div>

                            <div className="sv-tabs" role="tablist" aria-label="Staking views" data-arya="tabs" onKeyDown={onTabKeyDown}>
                                {TABS.map((entry) => {
                                    const count = entry.key === 'staked' ? staked.length
                                        : entry.key === 'raffle' ? (live?.entries?.length || 0)
                                            : (live?.capsules || []).reduce((sum, c) => sum + c.count, 0);
                                    return (
                                        <button
                                            key={entry.key}
                                            ref={(el) => { tabRefs.current[entry.key] = el; }}
                                            className="sv-tab"
                                            role="tab"
                                            data-key={entry.key}
                                            id={`sv-tab-${entry.key}`}
                                            aria-selected={tab === entry.key}
                                            aria-controls={`sv-panel-${entry.key}`}
                                            tabIndex={tab === entry.key ? 0 : -1}
                                            onClick={() => selectTab(entry.key)}
                                        >
                                            {entry.label}
                                            {count > 0 && <span className="sv-tab-count">{count}</span>}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Every panel is rendered and the inactive two are hidden. Rendering
                                only the active one would leave the other tabs' `aria-controls`
                                pointing at nothing. */}
                            <section className="sv-panel" id="sv-panel-staked" role="tabpanel" aria-labelledby="sv-tab-staked" hidden={tab !== 'staked'}>
                                    {!staked.length ? (
                                        <div className="sv-empty">
                                            <div className="sv-empty-title">Nothing staked yet</div>
                                            <div className="sv-empty-text">
                                                Stake a Genesis Knight and two things start at once: tickets for the weekly
                                                draw, and a share of the weekly DNG pool that grows every second.
                                                Staking is a transaction — you approve the vault once, then stake.
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="sv-rows">
                                                <div className="sv-row sv-row-head">
                                                    <span>Knight</span>
                                                    <span className="sv-col-hide-narrow">Power</span>
                                                    <span className="sv-col-hide-narrow">Tickets</span>
                                                    <span>Accrued share</span>
                                                    <span />
                                                </div>
                                                {staked.map((knight) => (
                                                    <div className="sv-row" key={knight.tokenId}>
                                                        <span className="sv-row-name">
                                                            <span className="sv-art" data-rarity="legendary" aria-hidden="true">
                                                                <span className="sv-art-glyph">✦</span>
                                                            </span>
                                                            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                                                {knight.name}
                                                                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                                                    staked {fmtHours((nowMs - knight.stakedAt) / 3_600_000)}
                                                                </span>
                                                            </span>
                                                        </span>
                                                        <span className="sv-row-num sv-col-hide-narrow">{knight.hashPower} HP</span>
                                                        <span className="sv-row-num sv-col-hide-narrow">{fmtInt(knight.tickets)}</span>
                                                        <span className="sv-row-num is-gold sv-num" aria-hidden="true">
                                                            {fmtShare(knight.accruedShare)}
                                                            {poolDng !== null && ` · ${fmtDng(knight.accruedDng)}`}
                                                        </span>
                                                        <span className="sv-row-actions">
                                                            <button
                                                                className="btn btn-secondary btn-sm"
                                                                onClick={() => run('claim', { tokenId: knight.tokenId })}
                                                                disabled={!live.canWrite || !!busy}
                                                                title={poolDng === null ? 'The weekly pool is not set yet' : 'Claim accrued DNG'}
                                                            >
                                                                Claim
                                                            </button>
                                                            <button
                                                                className="btn btn-danger btn-sm"
                                                                onClick={() => run('unstake', { tokenId: knight.tokenId })}
                                                                disabled={!live.canWrite || !!busy}
                                                                title="Return the knight to your wallet. Its tickets are forfeited."
                                                            >
                                                                Unstake
                                                            </button>
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                            <p className="sv-summary-label">
                                                Tickets cap at {live?.limits?.capHours || 168} hours of staking. Unstaking forfeits
                                                the tickets that knight earned.
                                            </p>
                                        </>
                                    )}
                            </section>

                            <section className="sv-panel" id="sv-panel-raffle" role="tabpanel" aria-labelledby="sv-tab-raffle" hidden={tab !== 'raffle'}>
                                    <div className="sv-bulk">
                                        <span className="sv-bulk-note">
                                            {live?.entries?.length
                                                ? `${live.entries.length} of ${staked.length} knights entered · ${fmtInt(totals.myTickets)} tickets`
                                                : 'No knights entered in this week’s draw'}
                                        </span>
                                        <button className="btn btn-primary btn-sm" onClick={() => run('enterAll')} disabled={!live.canWrite || !!busy || !staked.length}>
                                            Enter all
                                        </button>
                                        <button className="btn btn-secondary btn-sm" onClick={() => run('withdrawAll')} disabled={!live.canWrite || !!busy || !live?.entries?.length}>
                                            Withdraw all
                                        </button>
                                    </div>

                                    {!staked.length ? (
                                        <div className="sv-empty">
                                            <div className="sv-empty-title">The draw needs a staked knight</div>
                                            <div className="sv-empty-text">
                                                Tickets are earned by staking, and only staked knights can hold an entry.
                                                Stake one first and it can enter the next draw.
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="sv-rows">
                                            <div className="sv-row sv-row-head">
                                                <span>Knight</span>
                                                <span className="sv-col-hide-narrow">Power</span>
                                                <span className="sv-col-hide-narrow">Tickets</span>
                                                <span>Expected</span>
                                                <span />
                                            </div>
                                            {staked.map((knight) => {
                                                const expected = (totals.totalTickets ? knight.tickets / totals.totalTickets : 0) * CAPSULES_PER_WEEK;
                                                return (
                                                    <div className="sv-row" key={knight.tokenId}>
                                                        <span className="sv-row-name">
                                                            {knight.name}
                                                            {knight.entered && <span className="sv-chip is-in">In draw</span>}
                                                        </span>
                                                        <span className="sv-row-num sv-col-hide-narrow">{knight.hashPower} HP</span>
                                                        <span className="sv-row-num sv-col-hide-narrow">{fmtInt(knight.tickets)}</span>
                                                        <span className="sv-row-num is-gold" title="Expected capsules if the draw were held now">
                                                            {expected.toFixed(1)}
                                                        </span>
                                                        <span className="sv-row-actions">
                                                            {knight.entered ? (
                                                                <button className="btn btn-secondary btn-sm" onClick={() => run('withdrawRaffle', { tokenId: knight.tokenId })} disabled={!live.canWrite || !!busy}>
                                                                    Withdraw
                                                                </button>
                                                            ) : (
                                                                <button className="btn btn-primary btn-sm" onClick={() => run('enterRaffle', { tokenId: knight.tokenId })} disabled={!live.canWrite || !!busy}>
                                                                    Enter
                                                                </button>
                                                            )}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    <div className="panel-section-title" style={{ fontSize: 11, letterSpacing: 1, color: 'var(--text-muted)' }}>
                                        THIS WEEK&rsquo;S BOARD · {fmtInt(pool.totalTickets)} TICKETS
                                    </div>
                                    <div className="sv-rows">
                                        <div className="sv-board-row sv-row-head">
                                            <span>#</span>
                                            <span>Player</span>
                                            <span>Tickets</span>
                                            <span>Share</span>
                                        </div>
                                        {connected && (
                                            <div className="sv-board-row is-me">
                                                <span className="sv-board-rank">—</span>
                                                <span style={{ fontWeight: 600 }}>
                                                    {shortAddress(live.wallet)} <span className="sv-chip is-in">You</span>
                                                </span>
                                                <span className="sv-row-num is-gold">{fmtInt(totals.myTickets)}</span>
                                                <span className="sv-row-num is-gold">{fmtShare(totals.myShare)}</span>
                                            </div>
                                        )}
                                        {(live?.board || []).map((row, index) => (
                                            <div className="sv-board-row" key={row.address}>
                                                <span className="sv-board-rank">{index + 1}</span>
                                                <span>{row.short}</span>
                                                <span className="sv-row-num">{fmtInt(row.tickets)}</span>
                                                <span className="sv-row-num">
                                                    {fmtShare(pool.totalTickets ? row.tickets / pool.totalTickets : 0)}
                                                </span>
                                            </div>
                                        ))}
                                        {!(live?.board || []).length && (
                                            <div className="sv-board-row">
                                                <span className="sv-board-rank">—</span>
                                                <span style={{ color: 'var(--text-muted)' }}>No other entries yet</span>
                                                <span /><span />
                                            </div>
                                        )}
                                    </div>

                                    <div className="panel-section-title" style={{ fontSize: 11, letterSpacing: 1, color: 'var(--text-muted)' }}>
                                        PAST DRAWS
                                    </div>
                                    <div className="sv-rows">
                                        {(live?.history || []).map((row) => (
                                            <div className="sv-board-row" key={row.week}>
                                                <span className="sv-board-rank">W{row.week}</span>
                                                <span>{row.short}</span>
                                                <span className="sv-row-num is-gold">{row.capsules} capsules</span>
                                                <span className="sv-row-num">{fmtInt(row.tickets)} tickets</span>
                                            </div>
                                        ))}
                                    </div>
                                    <p className="sv-summary-label">
                                        The draw takes 200 winning ticket numbers from the whole pool and awards one
                                        capsule each. With few knights staked, one entry can take most of a week.
                                    </p>
                            </section>

                            <section className="sv-panel" id="sv-panel-capsules" role="tabpanel" aria-labelledby="sv-tab-capsules" hidden={tab !== 'capsules'}>
                                    <p className="sv-summary-label">
                                        Capsules are won in the draw and opened in the Summoning Chamber, where the
                                        knight inside is revealed. The odds below are exactly what the contract rolls.
                                    </p>
                                    <div className="sv-capsule-grid">
                                        {(live?.capsules || []).map((capsule) => (
                                            <div className={`sv-capsule ${capsule.count ? '' : 'is-empty'}`} key={capsule.key}>
                                                <div className="sv-capsule-head">
                                                    <span className="sv-art" data-rarity={capsule.rarity} aria-hidden="true">
                                                        <span className="sv-art-glyph">◆</span>
                                                    </span>
                                                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                                                        <span className="sv-card-name" style={{ fontSize: 12 }}>{capsule.name}</span>
                                                        <span className="sv-card-meta">{capsule.count ? `${capsule.count} owned` : 'none yet'}</span>
                                                    </span>
                                                    <span className="sv-capsule-count sv-num" aria-hidden="true">{capsule.count}</span>
                                                </div>
                                                <div className="sv-odds">
                                                    {capsule.odds.map((row) => (
                                                        <div className="sv-odds-row" key={row.rarity}>
                                                            <span>{row.rarity}</span>
                                                            <span>{row.pct}%</span>
                                                        </div>
                                                    ))}
                                                </div>
                                                <button
                                                    className="btn btn-primary btn-sm w-full"
                                                    disabled={!capsule.count || !live.canWrite || !!busy}
                                                    onClick={() => run('openCapsule', { key: capsule.key })}
                                                >
                                                    Open capsule
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                            </section>

                            {!live?.canWrite && connected && (
                                <div className="sv-banner">
                                    <span>{live.writeBlockedReason}</span>
                                </div>
                            )}
                        </div>
                    </main>
                </div>

                <footer className="sv-footer" data-arya="footer">
                    <span className="sv-footer-note">
                        {connected
                            ? `Week ${week.number} · ${staked.length} staked · draw Monday 00:00 UTC`
                            : 'Connect a wallet to stake Genesis Knights and enter the weekly draw'}
                    </span>
                    <button className="btn btn-ghost btn-sm sv-arya-btn" onClick={askArya}>
                        <span className="sv-arya-mark" aria-hidden="true">?</span> Ask Arya
                    </button>
                </footer>
            </div>

            {error && (
                <div className="sv-banner is-error sv-banner-float" role="alert">
                    <span>{error}</span>
                    <button className="sv-banner-x" onClick={() => setError(null)} aria-label="Dismiss">✕</button>
                </div>
            )}
            {notice && <div className="sv-banner sv-banner-float" role="status"><span>{notice}</span></div>}
        </>
    );
}

/**
 * One Genesis Knight.
 *
 * `staked` decides whether it is showing what the knight is earning or what it could
 * earn, and the staked face is the one with live numbers on it.
 */
function GenesisCard({ knight, staked = false, busy, canWrite, nowMs, onStake, onClaim, onUnstake }) {
    const hours = staked ? (nowMs - knight.stakedAt) / 3_600_000 : 0;
    const powerPct = Math.min(100, Math.max(0, knight.hashPower || 0));

    return (
        <div className={`sv-card ${staked ? 'is-staked' : ''}`}>
            <div className="sv-card-head">
                <span className="sv-art" data-rarity="legendary" aria-hidden="true">
                    <span className="sv-art-glyph">✦</span>
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="sv-card-name">{knight.name}</span>
                    <span className="sv-card-meta">
                        <span className="sv-power" style={{ flex: 1 }}>
                            <span className="sv-power-track" aria-hidden="true">
                                <span className="sv-power-fill" style={{ width: `${powerPct}%` }} />
                            </span>
                            <span className="sv-num">{knight.hashPower} HP</span>
                        </span>
                        {staked && knight.entered && <span className="sv-chip is-in">In draw</span>}
                    </span>
                </span>
            </div>

            {staked && (
                <div className="sv-card-stats">
                    <span className="sv-stat">
                        <span className="sv-stat-label">Staked for</span>
                        <span className="sv-stat-value sv-num" aria-hidden="true">{fmtHours(hours)}</span>
                    </span>
                    <span className="sv-stat">
                        <span className="sv-stat-label">Tickets</span>
                        <span className="sv-stat-value is-gold sv-num" aria-hidden="true">{fmtInt(knight.tickets)}</span>
                    </span>
                    <span className="sv-stat">
                        <span className="sv-stat-label">Accruing</span>
                        <span className="sv-stat-value is-gold sv-num" aria-hidden="true">
                            {knight.accruedDng === null
                                ? fmtSharePrecise(knight.accruedShare)
                                : fmtDng(knight.accruedDng)}
                        </span>
                    </span>
                </div>
            )}

            <div className="sv-card-actions">
                {staked ? (
                    <>
                        <button className="btn btn-secondary btn-sm" onClick={onClaim} disabled={!canWrite || !!busy}>Claim</button>
                        <button className="btn btn-danger btn-sm" onClick={onUnstake} disabled={!canWrite || !!busy}>Unstake</button>
                    </>
                ) : (
                    <button className="btn btn-primary btn-sm" onClick={onStake} disabled={!canWrite || !!busy}>
                        {busy === 'stake' ? 'Staking…' : 'Stake'}
                    </button>
                )}
            </div>
        </div>
    );
}
