// Reward Claim UI Component
console.log('Loading reward-claim-ui.js...');

class RewardClaimUI {
    constructor() {
        this.isVisible = false;
        this.createUI();
        this.setupEventListeners();
        this.updateDisplay();
        
        // Auto-update every 5 seconds
        setInterval(() => this.updateDisplay(), 5000);
        
        console.log('RewardClaimUI initialized');
    }
    
    createUI() {
        // Widget removed - UI moved to right sidebar
        console.log('Reward widget UI disabled - using sidebar instead');
    }
    
    injectStyles() {
        // Styles removed - widget disabled
    }
    
    setupEventListeners() {
        // Toggle widget
        document.getElementById('toggleRewardWidget')?.addEventListener('click', () => {
            const content = document.getElementById('rewardWidgetContent');
            if (content) {
                content.classList.toggle('hidden');
                this.isVisible = !content.classList.contains('hidden');
            }
        });
        
        // Claim button
        document.getElementById('claimRewardsBtn')?.addEventListener('click', async () => {
            await this.handleClaim();
        });
        
        // History button
        document.getElementById('viewHistoryBtn')?.addEventListener('click', () => {
            this.showHistory();
        });
        
        // Leaderboard button
        document.getElementById('leaderboardBtn')?.addEventListener('click', () => {
            if (window.leaderboardManager) {
                window.leaderboardManager.show();
            } else {
                alert('Leaderboard is loading...');
            }
        });
    }
    
    async updateDisplay() {
        if (!window.dungeonSession) return;
        
        const unclaimed = await window.dungeonSession.getUnclaimedRewards();
        const completions = window.dungeonSession.getHistory().filter(d => !d.claimed);
        
        const amountEl = document.getElementById('unclaimedAmount');
        const countEl = document.getElementById('completionCount');
        const claimBtn = document.getElementById('claimRewardsBtn');
        
        if (amountEl) amountEl.textContent = unclaimed.toFixed(2);
        if (countEl) countEl.textContent = completions.length;
        
        if (claimBtn) {
            claimBtn.disabled = completions.length === 0;
        }
    }
    
    async handleClaim() {
        const claimBtn = document.getElementById('claimRewardsBtn');
        if (claimBtn) claimBtn.disabled = true;
        
        try {
            const success = await window.dungeonSession.claimAllRewards();
            
            if (success) {
                this.updateDisplay();
            }
        } catch (error) {
            console.error('Claim error:', error);
        } finally {
            if (claimBtn) claimBtn.disabled = false;
        }
    }
    
    /**
     * The player's record, read from the chain's own events.
     *
     * This used to navigate to `claim-history.html`, a file outside `public/` that the site
     * therefore never served — so the button landed on a 404. Everything below comes from
     * `/api/game/history`, which sweeps `RewardsClaimed` and `DungeonCompleted` for this
     * wallet: no localStorage, nothing that a cleared browser or another device changes.
     */
    showHistory() {
        const address = (window.walletManager && window.walletManager.userAddress)
            || localStorage.getItem('walletAddress');
        const modal = this.historyModal || (this.historyModal = this.buildHistoryModal());
        modal.classList.add('active');

        const body = modal.querySelector('.history-body');
        const stats = modal.querySelector('.leaderboard-stats');

        if (!address) {
            body.innerHTML = '<div class="leaderboard-empty"><div class="leaderboard-empty-text">No wallet connected</div>'
                + '<div class="leaderboard-empty-subtext">Connect a wallet to see your claims.</div></div>';
            stats.textContent = 'Not connected';
            return;
        }
        this.loadHistory(address, body, stats);
    }

    buildHistoryModal() {
        const div = document.createElement('div');
        div.className = 'leaderboard-modal';
        div.id = 'claimHistoryModal';
        div.innerHTML = `
            <div class="leaderboard-content">
                <button class="leaderboard-close-btn" data-close="1">✕</button>
                <div class="leaderboard-header">
                    <div class="leaderboard-title">📜 Your Record</div>
                    <div class="leaderboard-subtitle">Claims and runs, read from the chain</div>
                </div>
                <div class="history-body"></div>
                <div class="leaderboard-footer">
                    <div class="leaderboard-stats">Loading...</div>
                    <button class="leaderboard-refresh-btn" data-refresh="1">🔄 Refresh</button>
                </div>
            </div>`;
        document.body.appendChild(div);

        const close = () => div.classList.remove('active');
        div.querySelector('[data-close="1"]').addEventListener('click', close);
        div.addEventListener('click', (event) => { if (event.target === div) close(); });
        div.querySelector('[data-refresh="1"]').addEventListener('click', () => this.showHistory());
        return div;
    }

    async loadHistory(address, body, stats) {
        body.innerHTML = '<div class="leaderboard-loading"><div class="leaderboard-spinner"></div><p>Reading your history from the chain...</p></div>';
        stats.textContent = 'Reading the chain...';
        try {
            const res = await fetch(`/api/game/history?address=${address}`, { cache: 'no-store' });
            const payload = await res.json().catch(() => null);
            if (!res.ok) throw new Error((payload && payload.error) || `History unavailable (${res.status})`);
            body.innerHTML = this.renderHistory(payload);
            stats.innerHTML = `<strong>${payload.totals.claimed.toFixed(2)}</strong> DNG claimed • `
                + `<strong>${payload.totals.claims}</strong> claims • <strong>${payload.totals.runs}</strong> runs`;
        } catch (error) {
            body.innerHTML = '<div class="leaderboard-empty"><div class="leaderboard-empty-icon">⚠️</div>'
                + `<div class="leaderboard-empty-text">Could not read your history</div>`
                + `<div class="leaderboard-empty-subtext">${this.escape(error.message || 'Unknown error')}</div></div>`;
            stats.textContent = 'Error reading data';
        }
    }

    escape(value) {
        return String(value).replace(/[&<>"']/g, (character) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        })[character]);
    }

    when(seconds) {
        if (!seconds) return '—';
        return new Date(seconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    renderHistory(payload) {
        if (!payload.totals.claims && !payload.totals.runs) {
            return '<div class="leaderboard-empty"><div class="leaderboard-empty-icon">🏆</div>'
                + '<div class="leaderboard-empty-text">Nothing on the chain yet</div>'
                + '<div class="leaderboard-empty-subtext">Finish a run and claim it, and it will appear here.</div></div>';
        }
        const claims = payload.claims.map((claim) => `
            <tr>
                <td class="reward-cell">${claim.amount.toFixed(2)} DNG</td>
                <td>${claim.runsCount} run${claim.runsCount === 1 ? '' : 's'}</td>
                <td>${claim.knightCount} knight${claim.knightCount === 1 ? '' : 's'}</td>
                <td>${this.when(claim.at)}</td>
            </tr>`).join('');
        const runs = payload.runs.slice(0, 12).map((run) => `
            <tr>
                <td>${this.escape(run.dungeon)}</td>
                <td>#${run.knightId}</td>
                <td>${this.escape(run.rarity)}</td>
                <td class="reward-cell">${run.reward.toFixed(2)} DNG</td>
                <td>${this.when(run.at)}</td>
            </tr>`).join('');

        return `
            <div class="leaderboard-title" style="font-size:15px;margin:8px 0">Claims</div>
            <table class="leaderboard-table">
                <thead><tr><th>Amount</th><th>Runs</th><th>Knights</th><th>When</th></tr></thead>
                <tbody>${claims || '<tr><td colspan="4">No claims yet</td></tr>'}</tbody>
            </table>
            <div class="leaderboard-title" style="font-size:15px;margin:22px 0 8px">Recent runs</div>
            <table class="leaderboard-table">
                <thead><tr><th>Dungeon</th><th>Knight</th><th>Rarity</th><th>Reward</th><th>When</th></tr></thead>
                <tbody>${runs || '<tr><td colspan="5">No runs yet</td></tr>'}</tbody>
            </table>`;
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.rewardClaimUI = new RewardClaimUI();
    });
} else {
    window.rewardClaimUI = new RewardClaimUI();
}

console.log('reward-claim-ui.js loaded');
