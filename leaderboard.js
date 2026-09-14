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
        
        // Load data if not already loaded
        if (this.leaderboardData.length === 0) {
            this.loadLeaderboard();
        }
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
        // Fetch DungeonCompleted events from the blockchain and aggregate by player
        console.log('📊 Fetching leaderboard data from blockchain...');
        
        try {
            // Get provider and contract
            const provider = new ethers.providers.JsonRpcProvider(
                window.DUNGEON_CONFIG.getNetworkConfig().rpc
            );
            
            const gameContractAddress = window.DUNGEON_CONFIG.getGameContract();
            const gameContractABI = [
                'event DungeonCompleted(address indexed player, uint256 indexed knightId, uint256 dungeonId, uint256 timeSpent, uint256 reward, uint256 timestamp)'
            ];
            
            const gameContract = new ethers.Contract(
                gameContractAddress,
                gameContractABI,
                provider
            );
            
            // Get current block
            const currentBlock = await provider.getBlockNumber();
            console.log(`Current block: ${currentBlock}`);
            
            // Fetch events from the last 100,000 blocks with paging
            const fromBlock = Math.max(0, currentBlock - 100000);
            const BLOCK_RANGE = 10000; // Process 10k blocks at a time to avoid RPC limits
            
            console.log(`Fetching DungeonCompleted events from block ${fromBlock} to ${currentBlock}...`);
            
            // Query all DungeonCompleted events with pagination
            const filter = gameContract.filters.DungeonCompleted();
            let allEvents = [];
            
            for (let start = fromBlock; start <= currentBlock; start += BLOCK_RANGE) {
                const end = Math.min(start + BLOCK_RANGE - 1, currentBlock);
                console.log(`  Querying blocks ${start} to ${end}...`);
                
                try {
                    const events = await gameContract.queryFilter(filter, start, end);
                    allEvents = allEvents.concat(events);
                    console.log(`  Found ${events.length} events in this range`);
                } catch (err) {
                    console.warn(`  Failed to query blocks ${start}-${end}:`, err.message);
                    // Continue with next range even if one fails
                }
            }
            
            console.log(`Found ${allEvents.length} DungeonCompleted events total`);
            
            if (allEvents.length === 0) {
                return [];
            }
            
            // Aggregate rewards by player address
            const playerData = {};
            
            allEvents.forEach(event => {
                const player = event.args.player.toLowerCase();
                const reward = parseFloat(ethers.utils.formatEther(event.args.reward));
                
                if (!playerData[player]) {
                    playerData[player] = {
                        address: player,
                        totalRewards: 0,
                        claimCount: 0
                    };
                }
                
                playerData[player].totalRewards += reward;
                playerData[player].claimCount += 1;
            });
            
            // Convert to array
            const leaderboardArray = Object.values(playerData);
            
            console.log(`📊 Leaderboard: ${leaderboardArray.length} unique players`);
            
            return leaderboardArray;
            
        } catch (error) {
            console.error('❌ Failed to fetch leaderboard data:', error);
            
            // Return empty array on error
            return [];
        }
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
        
        // Update stats
        const totalClaimed = sorted.reduce((sum, e) => sum + e.totalRewards, 0);
        const totalPlayers = sorted.length;
        this.stats.innerHTML = `
            <strong>${totalPlayers}</strong> players • 
            <strong>${totalClaimed.toFixed(2)}</strong> DNG claimed total
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
