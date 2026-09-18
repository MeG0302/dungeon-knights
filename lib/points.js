// Points System - Earn, Referral, and Leaderboard Logic

const POINTS_KEY = 'dk_points';
const DUNGEON_RUNS_KEY = 'dk_daily_dungeons';
const SHARE_KEY = 'dk_daily_share';
const REFERRALS_KEY = 'dk_referrals';
const REFERRER_KEY = 'dk_referrer';

export const POINTS_PER_DUNGEON = 100;
export const DAILY_TIERS = [
    { runs: 1, bonus: 0, total: 100 },
    { runs: 3, bonus: 200, total: 300 },
    { runs: 5, bonus: 200, total: 500 },
];
const X_SHARE_MULTIPLIER = 2;
const REFERRAL_1ST_PCT = 0.15;
const REFERRAL_2ND_PCT = 0.05;

export function getPoints() {
    try { return parseInt(localStorage.getItem(POINTS_KEY) || '0', 10); }
    catch { return 0; }
}

export function addPoints(amount, reason = '') {
    const current = getPoints();
    const newTotal = current + amount;
    localStorage.setItem(POINTS_KEY, String(newTotal));
    console.log(`[Points] +${amount} (${reason}) → Total: ${newTotal}`);
    return newTotal;
}

export function getTodayDungeonRuns() {
    try {
        const data = JSON.parse(localStorage.getItem(DUNGEON_RUNS_KEY) || '{}');
        const today = new Date().toISOString().slice(0, 10);
        if (data.date !== today) return 0;
        return data.count || 0;
    } catch { return 0; }
}

export function recordDungeonRun() {
    const today = new Date().toISOString().slice(0, 10);
    const data = { date: today, count: (getTodayDungeonRuns() || 0) + 1 };
    localStorage.setItem(DUNGEON_RUNS_KEY, JSON.stringify(data));
    return data.count;
}

export function getDailyPointsEarned() {
    const runs = getTodayDungeonRuns();
    let total = 0;
    for (const tier of DAILY_TIERS) {
        if (runs >= tier.runs) total = tier.total;
        else break;
    }
    return total;
}

export function getShareMultiplier() {
    try {
        const data = JSON.parse(localStorage.getItem(SHARE_KEY) || '{}');
        const today = new Date().toISOString().slice(0, 10);
        if (data.date === today && data.shared) return X_SHARE_MULTIPLIER;
        return 1;
    } catch { return 1; }
}

export function recordShare() {
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem(SHARE_KEY, JSON.stringify({ date: today, shared: true }));
}

export function getReferralCode() {
    const addr = getWalletAddress();
    if (!addr) return '';
    return addr.slice(0, 8).toUpperCase();
}

export function getWalletAddress() {
    try { return localStorage.getItem('dk_wallet_address') || ''; }
    catch { return ''; }
}

export function setReferrer(code) {
    if (!code || localStorage.getItem(REFERRER_KEY)) return;
    localStorage.setItem(REFERRER_KEY, code);
}

export function getReferrer() {
    try { return localStorage.getItem(REFERRER_KEY) || ''; }
    catch { return ''; }
}

export function getReferralStats() {
    try {
        const raw = localStorage.getItem(REFERRALS_KEY) || '{}';
        const all = JSON.parse(raw);
        const myCode = getReferralCode();
        const myRefs = all[myCode] || [];
        return { totalRefs: myRefs.length, refs: myRefs };
    } catch { return { totalRefs: 0, refs: [] }; }
}

export function registerReferral(referredAddress, referrerCode) {
    try {
        const raw = localStorage.getItem(REFERRALS_KEY) || '{}';
        const all = JSON.parse(raw);
        if (!all[referrerCode]) all[referrerCode] = [];
        if (!all[referrerCode].includes(referredAddress)) {
            all[referrerCode].push(referredAddress);
            localStorage.setItem(REFERRALS_KEY, JSON.stringify(all));
        }
    } catch {}
}

export function calculateReferralPoints() {
    const myCode = getReferralCode();
    const raw = localStorage.getItem(REFERRALS_KEY) || '{}';
    const all = JSON.parse(raw);
    const myRefs = all[myCode] || [];

    let total = 0;
    const details = [];

    for (const refAddr of myRefs) {
        const refPoints = getPointsForWallet(refAddr);
        const pct = 0.15;
        const earned = Math.floor(refPoints * pct);
        total += earned;
        details.push({ address: refAddr, theirPoints: refPoints, earned });
    }

    return { total, details };
}

function getPointsForWallet(address) {
    try {
        const raw = localStorage.getItem('dk_all_wallet_points') || '{}';
        return parseInt(raw[address] || '0', 10);
    } catch { return 0; }
}

export function recordPointsForWallet(address, points) {
    try {
        const raw = localStorage.getItem('dk_all_wallet_points') || '{}';
        const data = JSON.parse(raw);
        data[address] = (parseInt(data[address] || '0', 10)) + points;
        localStorage.setItem('dk_all_wallet_points', JSON.stringify(data));
    } catch {}
}

export function getGlobalLeaderboard() {
    try {
        const raw = localStorage.getItem('dk_all_wallet_points') || '{}';
        const all = JSON.parse(raw);
        const referralsRaw = localStorage.getItem(REFERRALS_KEY) || '{}';
        const allRefs = JSON.parse(referralsRaw);

        return Object.entries(all)
            .map(([addr, pts]) => {
                const refs = allRefs[addr] || [];
                return {
                    address: addr,
                    points: parseInt(pts, 10) || 0,
                    refs: refs.length,
                    shortAddr: addr.slice(0, 6) + '...' + addr.slice(-4),
                };
            })
            .sort((a, b) => b.points - a.points)
            .slice(0, 50);
    } catch { return []; }
}

export function getNextDungeonMilestone() {
    const runs = getTodayDungeonRuns();
    if (runs >= 5) return { next: null, remaining: 0 };
    const next = DAILY_TIERS.find(t => runs < t.runs);
    return { next, remaining: next ? next.runs - runs : 0 };
}

export function getMilestoneReward(runs) {
    let reward = 0;
    for (const tier of DAILY_TIERS) {
        if (runs >= tier.runs) reward = tier.total;
        else break;
    }
    return reward;
}
