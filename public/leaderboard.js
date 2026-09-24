// Leaderboard Manager
console.log('Loading leaderboard.js...');

class LeaderboardManager {
    constructor() {
        this.modal = null;
        this.leaderboardData = [];
        this.isLoading = false;
        this.currentUserAddress = null;
        this.createModal();
        console.log('✅ LeaderboardManager initialized');
    }

    createModal() {
        // Create modal HTML
        const modalHTML = `
            <div id="leaderboardModal" class="leaderboard-modal">
                <div class="leaderboard-content">
                    <button class="leaderboard-close-btn" id="leaderboardCloseBtn">✕</button>
                    
                    <div class="leaderboard-header">
                        <div class="leaderboard-title">🏆 Leaderboard</div>
                        <div class="leaderboard-subtitle">Top Earners in the Dungeon Knights Realm</div>
                    </div>
                    
                    <div id="leaderboardBody">
                        <!-- Content will be dynamically loaded -->
                    </div>
                    
                    <div class="leaderboard-footer">
                        <div class="leaderboard-stats" id="leaderboardStats">
                            Loading...
                        </div>
                        <button class="leaderboard-refresh-btn" id="leaderboardRefreshBtn">
                            🔄 Refresh
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Inject into DOM
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // Get references
        this.modal = document.getElementById('leaderboardModal');
        this.body = document.getElementById('leaderboardBody');
        this.stats = document.getElementById('leaderboardStats');
        this.closeBtn = document.getElementById('leaderboardCloseBtn');
        this.refreshBtn = document.getElementById('leaderboardRefreshBtn');

        // Setup event listeners
        this.closeBtn.addEventListener('click', () => this.hide());
        this.refreshBtn.addEventListener('click', () => this.refresh());
        
        // Close on background click
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.hide();
            }
        });
    }

    show() {
        this.modal.classList.add('active');
        
        // Get current user address
        if (window.walletManager && window.walletManager.userAddress) {
            this.currentUserAddress = window.walletManager.userAddress.toLowerCase();
        }
        
        // Always ask on open. The route caches the chain sweep for half a minute, so a
        // player can press Refresh as often as they like without the RPC seeing it.
        this.loadLeaderboard();
    }

    hide() {
        this.modal.classList.remove('active');
    }

    async refresh() {
        await this.loadLeaderboard();
    }

    showLoading() {
        this.body.innerHTML = `
            <div class="leaderboard-loading">
                <div class="leaderboard-spinner"></div>
                <p>Loading top earners from the blockchain...</p>
            </div>
        `;
        this.stats.textContent = 'Loading...';
        this.refreshBtn.disabled = true;
    }

    showEmpty() {
        this.body.innerHTML = `
            <div class="leaderboard-empty">
                <div class="leaderboard-empty-icon">🏆</div>
                <div class="leaderboard-empty-text">No claims yet!</div>
                <div class="leaderboard-empty-subtext">Be the first to complete a dungeon and claim rewards.</div>
            </div>
        `;
        this.stats.textContent = 'No data available';
        this.refreshBtn.disabled = false;
    }

    showError(message) {
        this.body.innerHTML = `
            <div class="leaderboard-empty">
                <div class="leaderboard-empty-icon">⚠️</div>
                <div class="leaderboard-empty-text">Failed to load leaderboard</div>
                <div class="leaderboard-empty-subtext">${message}</div>
            </div>
        `;
        this.stats.textContent = 'Error loading data';
        this.refreshBtn.disabled = false;
    }

    async loadLeaderboard() {
        if (this.isLoading) return;
        
        this.isLoading = true;
        this.showLoading();
        
        try {
            console.log('📊 Fetching leaderboard data from blockchain...');
            
            // This will be implemented in Task #4
            // For now, show a placeholder
            const data = await this.fetchLeaderboardData();
            
            if (data.length === 0) {
                this.showEmpty();
            } else {
                this.leaderboardData = data;
                this.renderLeaderboard(data);
            }
            
        } catch (error) {
            console.error('❌ Failed to load leaderboard:', error);
            this.showError(error.message || 'Unknown error occurred');
        } finally {
            this.isLoading = false;
        }
    }

    async fetchLeaderboardData() {
        // The sweep lives on the server (`/api/game/leaderboard`): the chain is 121 million
        // blocks tall, which is not something to run in a player's browser, and it needs the
        // contract's exact event signature. This used to run here against
        // `DungeonCompleted(address,uint256,uint256,uint256,uint256,uint256)` — the contract
        // emits `(…,uint256,uint8,uint256,uint256)`, a different topic hash — so it matched
        // nothing and the board read "no claims yet" no matter what had been claimed.
        const res = await fetch('/api/game/leaderboard?limit=25', { cache: 'no-store' });
        const payload = await res.json().catch(() => null);
        if (!res.ok) {
            throw new Error(payload?.error || `Leaderboard unavailable (${res.status})`);
        }
        // Server-side totals, so the footer can say "all time" without needing every row.
        this.totals = {
            players: payload.players || 0,
            claims: payload.claims || 0,
            totalClaimed: payload.totalClaimed || 0,
        };
        console.log(`📊 Leaderboard: ${this.totals.players} players, ${this.totals.totalClaimed.toFixed(2)} DNG claimed`);
        return payload.rows || [];
    }

    renderLeaderboard(data) {
        // Sort by total rewards (descending)
        const sorted = [...data].sort((a, b) => b.totalRewards - a.totalRewards);
        
        // Generate table HTML
        let tableHTML = `
            <table class="leaderboard-table">
                <thead>
                    <tr>
                        <th>Rank</th>
                        <th>Address</th>
                        <th>Total DNG</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        sorted.forEach((entry, index) => {
            const rank = index + 1;
            const isCurrentUser = entry.address.toLowerCase() === this.currentUserAddress;
            
            // Generate rank badge
            let rankBadgeClass = '';
            let rankDisplay = rank;
            
            if (rank === 1) {
                rankBadgeClass = 'gold';
                rankDisplay = '🥇';
            } else if (rank === 2) {
                rankBadgeClass = 'silver';
                rankDisplay = '🥈';
            } else if (rank === 3) {
                rankBadgeClass = 'bronze';
                rankDisplay = '🥉';
            }
            
            // Generate row
            tableHTML += `
                <tr ${isCurrentUser ? 'class="current-user"' : ''}>
                    <td class="rank-cell">
                        <div class="rank-badge ${rankBadgeClass}">${rankDisplay}</div>
                    </td>
                    <td class="address-cell">
                        <div class="address-display">
                            <span class="address-text">${this.formatAddress(entry.address)}</span>
                            ${isCurrentUser ? '<span class="current-user-badge">You</span>' : ''}
                        </div>
                    </td>
                    <td class="reward-cell">
                        ${entry.totalRewards.toFixed(2)} DNG
                    </td>
                </tr>
            `;
        });
        
        tableHTML += `
                </tbody>
            </table>
        `;
        
        this.body.innerHTML = tableHTML;
        
        // The claimed total only. How many players are on this board is the size of the player base, and
        // the owner asked that no running total be printed.
        const totalClaimed = this.totals ? this.totals.totalClaimed : sorted.reduce((sum, e) => sum + e.totalRewards, 0);
        const allTime = this.totals ? ' all time' : '';
        this.stats.innerHTML = `
            <strong>${totalClaimed.toFixed(2)}</strong> DNG claimed${allTime}
        `;
        
        this.refreshBtn.disabled = false;
    }

    formatAddress(address) {
        if (!address) return 'Unknown';
        
        // Show first 6 and last 4 characters
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    // Get user's rank
    getUserRank(userAddress) {
        if (!userAddress || this.leaderboardData.length === 0) {
            return null;
        }
        
        const sorted = [...this.leaderboardData].sort((a, b) => b.totalRewards - a.totalRewards);
        const index = sorted.findIndex(e => e.address.toLowerCase() === userAddress.toLowerCase());
        
        return index >= 0 ? index + 1 : null;
    }

    // Get user's total rewards
    getUserTotal(userAddress) {
        if (!userAddress || this.leaderboardData.length === 0) {
            return 0;
        }
        
        const entry = this.leaderboardData.find(e => e.address.toLowerCase() === userAddress.toLowerCase());
        return entry ? entry.totalRewards : 0;
    }
}

// Global instance
window.leaderboardManager = new LeaderboardManager();

console.log('✅ leaderboard.js loaded');
