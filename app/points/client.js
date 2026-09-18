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

    const progressPercent = Math.min((runs / 5) * 100, 100);
    const currentTier = DAILY_TIERS.find(t => runs >= t.runs);
    const nextTier = DAILY_TIERS.find(t => runs < t.runs);

    if (inDungeon) {
        return <PointsDungeon onExit={handleDungeonComplete} onComplete={handleDungeonComplete} />;
    }

    return (
        <>
            <link rel="stylesheet" href="/css/points.css" />
            <link rel="stylesheet" href="/css/wallet-widget.css" />
            <div className="points-page">
                <header className="points-header">
                    <div className="points-header-left">
                        <button className="back-btn" onClick={() => navigateTo('/')}>
                            Back
                        </button>
                        <h1>Points Program</h1>
                    </div>
                    <div className="points-balance">
                        <img src={`${ASSETS}Gold_coin_badge_with_PTS_2K_20260919011438-autocrop-hair.png`} alt="" className="points-icon" />
                        <span className="points-amount">{points.toLocaleString()}</span>
                        <span className="points-label">PTS</span>
                        {multiplier > 1 && <span className="multiplier-badge">x{multiplier}</span>}
                    </div>
                </header>

                <div className="points-layout">
                    <aside className="points-sidebar">
                        <div className="panel vault-dungeon-panel">
                            <div className="panel-header">
                                <img src={`${ASSETS}Treasure_chest_overflowing_with_ΓÇª_2K_20260919012043-autocrop-hair.png`} alt="" className="panel-icon" />
                                <span>Points Vault</span>
                            </div>
                            <p className="panel-desc">Enter the vault to earn daily points (100 + 300 + 500)</p>
                            <button className="vault-enter-btn" onClick={handleEnterDungeon} disabled={runs >= 5}>
                                {runs >= 5 ? 'Daily Complete' : 'Enter Vault'}
                            </button>
                        </div>

                        <div className="panel">
                            <div className="panel-header">
                                <img src={`${ASSETS}Crossed_sword_and_shield_icon_2K_20260919011419-autocrop-hair.png`} alt="" className="panel-icon" />
                                <span>Daily Progress</span>
                            </div>
                            <div className="dungeon-tracker">
                                {[1, 2, 3, 4, 5].map((i) => (
                                    <div key={i} className={`dungeon-step ${i <= runs ? 'completed' : ''}`}>
                                        <div className="step-circle">
                                            {i <= runs
                                                ? <img src={`${ASSETS}Green_checkmark_icon_for_tasks_2K_20260919011426-autocrop-hair.png`} alt="" className="check-icon" />
                                                : <span className="step-num">{i}</span>}
                                        </div>
                                        <div className="step-info">
                                            <span className="step-label">Vault Run {i}</span>
                                            <span className="step-pts">+{POINTS_PER_DUNGEON} PTS</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="progress-bar-container">
                                <div className="progress-bar-fill" style={{ width: `${progressPercent}%` }} />
                            </div>
                            <div className="milestone-info">
                                {currentTier && <span className="milestone-achieved">{currentTier.total} PTS earned</span>}
                                {nextTier && <span className="milestone-next">{nextTier.runs - runs} more for {nextTier.total} PTS</span>}
                                {!nextTier && <span className="milestone-max">MAX DAILY</span>}
                            </div>
                        </div>

                        <div className="panel">
                            <div className="panel-header">
                                <img src={`${ASSETS}White_logo_on_black_background_2K_20260919011421-autocrop-hair.png`} alt="" className="panel-icon x-icon" />
                                <span>Daily Share</span>
                            </div>
                            <p className="panel-desc">Share on X for 2x multiplier</p>
                            <button className={`share-btn ${sharedToday ? 'active' : ''}`} onClick={handleShareX} disabled={sharedToday}>
                                {sharedToday ? 'Shared (x2 Active)' : 'Share on X'}
                            </button>
                        </div>

                        <div className="panel">
                            <div className="panel-header">
                                <img src={`${ASSETS}Silver_chain_link_icon_referrals_2K_20260919011442-autocrop-hair.png`} alt="" className="panel-icon" />
                                <span>Refer & Earn</span>
                            </div>
                            <p className="panel-desc">15% from 1st degree, 5% from 2nd degree</p>
                            <div className="referral-code-box">
                                <code className="referral-code">{referralCode || 'Connect Wallet'}</code>
                                <button className="copy-btn" onClick={handleCopyReferral}>
                                    {copied ? 'Copied' : 'Copy'}
                                </button>
                            </div>
                            <p className="ref-stats">{referralStats.totalRefs} referrals</p>
                            {refEarnings.details.length > 0 && (
                                <div className="ref-earnings">
                                    <span className="ref-earnings-label">Referral Earnings:</span>
                                    <span className="ref-earnings-value">+{refEarnings.total} PTS</span>
                                </div>
                            )}
                        </div>
                    </aside>

                    <main className="points-main">
                        <div className="tabs">
                            <button className={`tab ${tab === 'leaderboard' ? 'active' : ''}`} onClick={() => setTab('leaderboard')}>
                                Leaderboard
                            </button>
                            <button className={`tab ${tab === 'referrals' ? 'active' : ''}`} onClick={() => setTab('referrals')}>
                                My Referrals
                            </button>
                        </div>

                        {tab === 'leaderboard' && (
                            <div className="leaderboard-table">
                                <div className="lb-header">
                                    <span className="lb-rank">#</span>
                                    <span className="lb-name">Player</span>
                                    <span className="lb-points">Points</span>
                                    <span className="lb-refs">Refs</span>
                                </div>
                                {leaderboard.length === 0 ? (
                                    <p className="lb-empty">No players yet. Be the first!</p>
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
                            <div className="referrals-list">
                                {refEarnings.details.length === 0 ? (
                                    <p className="lb-empty">No referrals yet. Share your code!</p>
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
                    </main>
                </div>
            </div>
        </>
    );
}
