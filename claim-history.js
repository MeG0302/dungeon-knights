// Claim History Page Logic
console.log('Loading claim-history.js...');

class ClaimHistoryPage {
    constructor() {
        this.pendingRuns = [];
        this.claimedHistory = [];
        this.isInitialized = false;
        
        this.init();
    }
    
    async init() {
        console.log('Initializing Claim History page...');
        
        // Wait for wallet and session to be ready
        await this.waitForDependencies();
        
        // Setup UI
        this.setupEventListeners();
        this.updateDisplay();
        
        // Auto-refresh every 5 seconds
        setInterval(() => this.updateDisplay(), 5000);
        
        this.isInitialized = true;
        console.log('✅ Claim History page initialized');
    }
    
    async waitForDependencies() {
        console.log('Waiting for dependencies...');
        
        // Wait for wallet manager
        while (!window.walletManager) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Wait for dungeon session
        while (!window.dungeonSession) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        console.log('✅ Dependencies loaded');
    }
    
    setupEventListeners() {
        // Claim All button
        const claimAllBtn = document.getElementById('claimAllButton');
        if (claimAllBtn) {
            claimAllBtn.addEventListener('click', () => this.handleClaimAll());
        }
    }
    
    updateDisplay() {
        if (!window.dungeonSession) return;
        
        // Get data from session
        this.pendingRuns = window.dungeonSession.pendingRuns || [];
        
        console.log('📊 Updating display with', this.pendingRuns.length, 'pending runs');
        
        // Update summary
        this.updateSummary();
        
        // Update pending runs list
        this.updatePendingRunsList();
        
        // Update claimed history (TODO: add to session manager)
        // this.updateClaimedHistory();
    }
    
    async updateSummary() {
        // Calculate total unclaimed
        const totalUnclaimed = await window.dungeonSession.getUnclaimedRewards();
        const totalKnights = new Set(
            this.pendingRuns.flatMap(run => run.knightIds)
        ).size;
        
        console.log('💰 Total unclaimed:', totalUnclaimed);
        console.log('⚔️ Unique knights:', totalKnights);
        
        // Update UI
        const amountEl = document.getElementById('totalUnclaimedAmount');
        const runsCountEl = document.getElementById('pendingRunsCount');
        const knightsCountEl = document.getElementById('totalKnightsCount');
        const claimBtn = document.getElementById('claimAllButton');
        
        if (amountEl) {
            amountEl.textContent = totalUnclaimed.toFixed(2);
        }
        
        if (runsCountEl) {
            runsCountEl.textContent = this.pendingRuns.length;
        }
        
        if (knightsCountEl) {
            knightsCountEl.textContent = totalKnights;
        }
        
        if (claimBtn) {
            claimBtn.disabled = this.pendingRuns.length === 0;
        }
    }
    
    async updatePendingRunsList() {
        const listEl = document.getElementById('pendingRunsList');
        const emptyStateEl = document.getElementById('emptyState');
        
        if (!listEl) return;
        
        // Show/hide empty state
        if (this.pendingRuns.length === 0) {
            listEl.style.display = 'none';
            if (emptyStateEl) emptyStateEl.style.display = 'block';
            return;
        }
        
        listEl.style.display = 'grid';
        if (emptyStateEl) emptyStateEl.style.display = 'none';
        
        // Calculate rewards for each run
        const runRewards = await Promise.all(
            this.pendingRuns.map(run => 
                window.dungeonSession.calculateRunReward(run.knightIds)
            )
        );
        
        // Render runs
        listEl.innerHTML = this.pendingRuns.map((run, index) => {
            const reward = runRewards[index];
            const timeAgo = this.getTimeAgo(run.clearedAt);
            const dungeonIcon = this.getDungeonIcon(run.dungeonId);
            
            return `
                <div class="run-card">
                    <div class="run-header">
                        <div class="run-dungeon">
                            ${dungeonIcon} ${run.dungeonName}
                        </div>
                        <div class="run-reward">+${reward.toFixed(2)} $DNG</div>
                    </div>
                    <div class="run-details">
                        <div class="run-detail-item">
                            <span class="run-detail-label">⚔️ Knights:</span>
                            <span>${run.knightIds.length}</span>
                        </div>
                        <div class="run-detail-item">
                            <span class="run-detail-label">⏱️ Completed:</span>
                            <span>${timeAgo}</span>
                        </div>
                        ${run.timeSpent ? `
                            <div class="run-detail-item">
                                <span class="run-detail-label">🎮 Duration:</span>
                                <span>${this.formatDuration(run.timeSpent)}</span>
                            </div>
                        ` : ''}
                    </div>
                    <div class="run-knights-list">
                        ${run.knightIds.slice(0, 10).map(id => `
                            <span class="knight-badge">Knight #${id}</span>
                        `).join('')}
                        ${run.knightIds.length > 10 ? `
                            <span class="knight-badge">+${run.knightIds.length - 10} more</span>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }
    
    // Remove estimateRunReward method - now using calculateRunReward from session
    
    getDungeonIcon(dungeonId) {
        const icons = {
            1: '💀', // Crypts
            2: '⛏️', // Mines
            3: '🔥', // Magma
            4: '🌴', // Temple
            5: '🌀'  // Void
        };
        return icons[dungeonId] || '🏰';
    }
    
    getTimeAgo(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;
        
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) return `${days}d ago`;
        if (hours > 0) return `${hours}h ago`;
        if (minutes > 0) return `${minutes}m ago`;
        return `${seconds}s ago`;
    }
    
    formatDuration(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    async handleClaimAll() {
        console.log('🎁 Claim All clicked');
        
        const claimBtn = document.getElementById('claimAllButton');
        if (claimBtn) {
            claimBtn.disabled = true;
            claimBtn.textContent = '⏳ Claiming...';
        }
        
        try {
            const success = await window.dungeonSession.claimAllRewards();
            
            if (success) {
                console.log('✅ Claim successful!');
                // Update display
                setTimeout(() => this.updateDisplay(), 1000);
            }
        } catch (error) {
            console.error('❌ Claim failed:', error);
            alert(`Claim failed: ${error.message}`);
        } finally {
            if (claimBtn) {
                claimBtn.disabled = false;
                claimBtn.textContent = '🎁 Claim All Rewards';
            }
        }
    }
    
    updateClaimedHistory() {
        // TODO: Implement claimed history tracking
        // For now, leave it empty
        const historyEl = document.getElementById('claimedHistoryList');
        if (!historyEl) return;
        
        historyEl.innerHTML = `
            <div class="empty-state">
                <div class="empty-text">No claimed history yet</div>
                <div class="empty-subtext">Your claimed rewards will appear here</div>
            </div>
        `;
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.claimHistoryPage = new ClaimHistoryPage();
    });
} else {
    window.claimHistoryPage = new ClaimHistoryPage();
}

console.log('claim-history.js loaded');
