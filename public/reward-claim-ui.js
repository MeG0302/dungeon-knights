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
    
    showHistory() {
        console.log('📜 Opening Claim History page...');
        window.location.href = 'claim-history.html';
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
