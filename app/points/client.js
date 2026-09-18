'use client';

import { useEffect, useState } from 'react';
import {
    getPoints, addPoints, getTodayDungeonRuns, recordDungeonRun,
    getShareMultiplier, recordShare, getReferralCode, getReferralStats,
    registerReferral, calculateReferralPoints, getGlobalLeaderboard,
    POINTS_PER_DUNGEON, DAILY_TIERS,
    getWalletAddress, recordPointsForWallet
} from '../../lib/points';
import PointsDungeon from './dungeon';

const ASSETS = '/assets/points/';

function getUrlParam(name) {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get(name);
}

function navigateTo(path) {
    window.location.href = path;
}

export default function PointsPage() {
    const [points, setPoints] = useState(0);
    const [runs, setRuns] = useState(0);
    const [multiplier, setMultiplier] = useState(1);
    const [sharedToday, setSharedToday] = useState(false);
    const [referralCode, setReferralCode] = useState('');
    const [referralStats, setReferralStats] = useState({ totalRefs: 0, refs: [] });
    const [refEarnings, setRefEarnings] = useState({ total: 0, details: [] });
    const [leaderboard, setLeaderboard] = useState([]);
    const [tab, setTab] = useState('leaderboard');
    const [copied, setCopied] = useState(false);
    const [inDungeon, setInDungeon] = useState(false);

    useEffect(() => {
        const ref = getUrlParam('ref');
        if (ref && ref.length >= 4) {
            registerReferral(getWalletAddress() || 'local', ref.toUpperCase());
        }
        loadState();
    }, []);

    const loadState = () => {
        setPoints(getPoints());
        setRuns(getTodayDungeonRuns());
        setMultiplier(getShareMultiplier());
        setSharedToday(getShareMultiplier() >= 2);
        setReferralCode(getReferralCode());
        setReferralStats(getReferralStats());
        setRefEarnings(calculateReferralPoints());
        setLeaderboard(getGlobalLeaderboard());
    };

    const handleEnterDungeon = () => {
        if (runs >= 5) return;
        setInDungeon(true);
    };

    const handleDungeonComplete = () => {
        setInDungeon(false);
        recordDungeonRun();
        const currentRuns = getTodayDungeonRuns();
        let earned = 0;
        for (const tier of DAILY_TIERS) {
            if (currentRuns >= tier.runs) earned = tier.total;
            else break;
        }
        const mult = getShareMultiplier();
        const finalPoints = Math.floor(earned * mult);
        if (finalPoints > 0) {
            addPoints(finalPoints, 'points_vault_dungeon');
            recordPointsForWallet(getWalletAddress() || 'local', finalPoints);
        }
        loadState();
    };

    const handleShareX = () => {
        const text = encodeURIComponent(`I just earned ${getPoints()} points in Dungeon Knights!`);
        window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank');
        recordShare();
        setSharedToday(true);
        setMultiplier(2);
        loadState();
    };

    const handleCopyReferral = () => {
        const link = `${window.location.origin}/points?ref=${referralCode}`;
        navigator.clipboard?.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (inDungeon) {
        return <PointsDungeon onExit={handleDungeonComplete} />;
    }

    return (
        <>
            <link rel="stylesheet" href="/theme.css" />
            <link rel="stylesheet" href="/css/points.css" />
            <link rel="stylesheet" href="/css/wallet-widget.css" />
            <div className="page" style={{ background: 'var(--bg-dark)' }}>

                {/* Header */}
                <header className="header">
                    <button className="btn btn-ghost btn-sm" onClick={() => navigateTo('/')}>
                        <img src="assets/ui/exit cross.png" className="btn-icon-img" alt="" /> Kingdom Gate
                    </button>
                    <div className="header-title">POINTS PROGRAM</div>
                    <div className="header-actions">
                        <div className="wallet-pill" id="headerDngBalance">
                            <img src={`${ASSETS}Gold_coin_badge_with_PTS_2K_20260919011438-autocrop-hair.png`} alt="" className="points-icon" width={18} height={18} />
                            <span id="headerDngText">{points.toLocaleString()} PTS</span>
                        </div>
                    </div>
                </header>

                {/* Two-panel layout */}
                <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

                    {/* LEFT: Points Actions */}
                    <aside className="side-panel points-left-panel" style={{ width: 400 }}>
                        <div className="side-panel-header">
                            <img src={`${ASSETS}Wooden_treasure_chest_illustration_2K_20260919015044-autocrop-hair.png`} alt="" className="panel-header-icon points-icon" width={20} height={20} />
                            Points Vault
                        </div>
                        <div className="side-panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

                            <button className="btn btn-primary btn-md w-full" onClick={handleEnterDungeon} disabled={runs >= 5} style={{ justifyContent: 'flex-start', gap: 10 }}>
                                <img src="assets/ui/sword.png" className="btn-icon-img" alt="" />
                                <div style={{ textAlign: 'left' }}>
                                    <div>Enter Vault</div>
                                    <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)', letterSpacing: 0.5 }}>
                                        Earn {100 + 300 + 500} PTS per run
                                    </div>
                                </div>
                            </button>

                            <div style={{ borderTop: '1px solid var(--border-base)', margin: '4px 0' }} />

                            {/* Daily Progress */}
                            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-gold)', letterSpacing: 1, textTransform: 'uppercase', padding: '4px 4px 8px' }}>
                                Daily Progress ({runs}/5)
                            </div>
                            {[1, 2, 3, 4, 5].map((i) => (
                                <div key={i} className="stat-row" style={{ opacity: i <= runs ? 0.6 : 1 }}>
                                    <span className="stat-label">Vault Run {i}</span>
                                    <span className="stat-value" style={{ fontSize: 12 }}>
                                        {i <= runs ? <img src={`${ASSETS}Green_checkmark_icon_for_tasks_2K_20260919011426-autocrop-hair.png`} alt="" className="points-icon" width={16} height={16} /> : `+${POINTS_PER_DUNGEON} PTS`}
                                    </span>
                                </div>
                            ))}

                            <div style={{ borderTop: '1px solid var(--border-base)', margin: '4px 0' }} />

                            {/* X Share */}
                            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-gold)', letterSpacing: 1, textTransform: 'uppercase', padding: '4px 4px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <img src={`${ASSETS}White_logo_on_black_background_2K_20260919011421-autocrop-hair.png`} alt="" className="points-icon" width={16} height={16} style={{ filter: 'brightness(0) invert(1)' }} />
                                Daily Share
                            </div>
                            <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8, padding: '0 4px' }}>
                                Share on X for 2x multiplier
                            </p>
                            <button className={`btn ${sharedToday ? 'btn-primary' : 'btn-secondary'} btn-sm w-full`} onClick={handleShareX} disabled={sharedToday}>
                                {sharedToday ? 'Shared Today (x2)' : 'Share on X'}
                            </button>

                            <div style={{ borderTop: '1px solid var(--border-base)', margin: '4px 0' }} />

                            {/* Referral */}
                            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-gold)', letterSpacing: 1, textTransform: 'uppercase', padding: '4px 4px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <img src={`${ASSETS}Silver_chain_link_icon_referrals_2K_20260919011442-autocrop-hair.png`} alt="" className="panel-header-icon points-icon" width={20} height={20} />
                                Refer & Earn
                            </div>
                            <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8, padding: '0 4px' }}>
                                15% from 1st degree, 5% from 2nd degree
                            </p>
                            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                                <code className="referral-code" style={{ flex: 1 }}>{referralCode || 'Connect Wallet'}</code>
                                <button className="btn btn-secondary btn-sm" onClick={handleCopyReferral} style={{ padding: '4px 12px' }}>
                                    {copied ? 'Copied' : 'Copy'}
                                </button>
                            </div>
                            <p style={{ fontSize: 11, color: 'var(--text-muted)', padding: '0 4px' }}>
                                {referralStats.totalRefs} referrals
                            </p>
                            {refEarnings.total > 0 && (
                                <div className="ref-earnings" style={{ marginTop: 8 }}>
                                    <span className="ref-earnings-label">Earned:</span>
                                    <span className="ref-earnings-value">+{refEarnings.total} PTS</span>
                                </div>
                            )}
                        </div>
                    </aside>

                    {/* RIGHT: Leaderboard / Referrals */}
                    <main className="side-panel" style={{ flex: 1, borderRight: 'none' }}>
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
                                <span className="stat-label">Total Points</span>
                                <span className="stat-value" style={{ color: 'var(--accent-gold)' }}>{points.toLocaleString()} PTS</span>
                            </div>

                            {tab === 'leaderboard' && (
                                <div className="leaderboard-table" style={{ marginTop: 12 }}>
                                    <div className="lb-header">
                                        <span className="lb-rank">#</span>
                                        <span className="lb-name">Player</span>
                                        <span className="lb-points">Points</span>
                                        <span className="lb-refs">Refs</span>
                                    </div>
                                    {leaderboard.length === 0 ? (
                                        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                                            <div className="lb-empty">
                                                <img src={`${ASSETS}Golden_trophy_pixel_art_icon_2K_20260919011419-autocrop-hair.png`} alt="" className="points-icon empty-state-icon" width={40} height={40} />
                                                <p style={{ fontStyle: 'italic' }}>No players yet. Be the first!</p>
                                            </div>
                                        </div>
                                    ) : (
                                        leaderboard.map((entry, i) => (
                                            <div key={i} className={`lb-row ${i < 3 ? 'top-' + (i + 1) : ''}`}>
                                                <span className="lb-rank">{i + 1}</span>
                                                <span className="lb-name">{entry.shortAddr}</span>
                                                <span className="lb-points">{entry.points.toLocaleString()}</span>
                                                <span className="lb-refs">{entry.refs}</span>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}

                            {tab === 'referrals' && (
                                <div className="referrals-list" style={{ marginTop: 12 }}>
                                    {refEarnings.details.length === 0 ? (
                                        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                                            <div className="ref-empty">
                                                <img src={`${ASSETS}Silver_chain_link_icon_referrals_2K_20260919011442-autocrop-hair.png`} alt="" className="points-icon empty-state-icon" width={40} height={40} />
                                                <p style={{ fontStyle: 'italic' }}>No referrals yet. Share your code!</p>
                                            </div>
                                        </div>
                                    ) : (
                                        refEarnings.details.map((ref, i) => (
                                            <div key={i} className="ref-row">
                                                <span className="ref-addr">{ref.address.slice(0, 8)}...{ref.address.slice(-4)}</span>
                                                <span className="ref-pts">{ref.theirPoints} PTS</span>
                                                <span className="ref-earned">+{ref.earned} PTS</span>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>
                    </main>
                </div>

                {/* Footer */}
                <footer style={{ height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-dark)', borderTop: '1px solid var(--border-base)', flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 0.5 }}>
                        Earn points by completing vault runs, sharing on X, and referring friends
                    </span>
                </footer>
            </div>
        </>
    );
}
