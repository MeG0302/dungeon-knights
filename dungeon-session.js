// Dungeon Session Manager V2 - On-chain Rewards, No Signatures
console.log('🔧 Loading dungeon-session.js V2...');

// One-time migration for schema change
const SCHEMA_VERSION = 'v2';
if (localStorage.getItem('dungeonSchemaVersion') !== SCHEMA_VERSION) {
    console.log('🔄 Migrating to V2 schema - clearing old signatures and rewards');
    localStorage.removeItem('dungeonCompletions');
    localStorage.removeItem('knight_daily_runs'); // now authoritative on-chain
    localStorage.setItem('dungeonSchemaVersion', SCHEMA_VERSION);
}

// Dungeon ID constants for analytics
const DUNGEON_IDS = { 
    crypts: 1, 
    mines: 2, 
    temple: 3, 
    magma: 4, 
    void: 5 
};

class DungeonSessionManager {
    constructor() {
        this.currentSession = null;
        this.pendingRuns = []; // { knightIds, dungeonId, dungeonName, clearedAt }
        this.gameContractAddress = window.DUNGEON_CONFIG.getGameContract();
        this.gameContractABI = [
            'function completeDungeons(uint256[] calldata knightIds, uint256 dungeonId) external',
            'function runsRemaining(uint256 knightId) view returns (uint8)',
            'function getKnightStats(uint256 knightId) view returns (uint256 totalClaimed, uint8 remaining, uint64 lastRunTime)',
            'function treasuryBalance() view returns (uint256)',
            'event DungeonCompleted(address indexed player, uint256 indexed knightId, uint256 indexed dungeonId, uint8 rarity, uint256 reward, uint256 timestamp)',
            'event RewardsClaimed(address indexed player, uint256 amount, uint256 knightCount)'
        ];
        
        this.loadFromLocalStorage();
        console.log('✅ DungeonSessionManager V2 initialized');
    }

    /**
     * Start a new dungeon session
     * @param {number[]} knightIds - Array of knight token IDs
     * @param {string} dungeonType - Dungeon type (crypts, mines, etc.)
     * @param {string} dungeonName - Display name
     */
    startDungeon(knightIds, dungeonType, dungeonName) {
        if (this.currentSession) {
            console.warn('⚠️ Session already active');
            return false;
        }

        if (!knightIds || knightIds.length === 0) {
            console.error('❌ No knights provided');
            return false;
        }

        this.currentSession = {
            knightIds,
            dungeonType,
            dungeonName,
            dungeonId: DUNGEON_IDS[dungeonType] || 1,
            startTime: Date.now()
        };

        console.log(`🎮 Session started: ${dungeonName} with ${knightIds.length} knights`);
        return true;
    }

    /**
     * Complete the current dungeon and add to pending runs
     * @param {Object[]} knights - Full knight objects with tokenId and rarity
     * @returns {Object|null} Completion info or null
     */
    async completeDungeon(knights) {
        if (!this.currentSession) {
            console.error('❌ No active session');
            return null;
        }

        if (!knights || knights.length === 0) {
            console.error('❌ No knights provided');
            return null;
        }

        const knightIds = knights.map(k => k.tokenId);
        const elapsed = Date.now() - this.currentSession.startTime;

        // Create pending run
        const pendingRun = {
            knightIds,
            dungeonId: this.currentSession.dungeonId,
            dungeonName: this.currentSession.dungeonName,
            clearedAt: Date.now(),
            timeSpent: Math.floor(elapsed / 1000) // seconds
        };

        this.pendingRuns.push(pendingRun);
        this.saveToLocalStorage();

        // Estimate reward for display (not authoritative)
        const estimatedReward = this.estimateReward(knights);

        console.log(`✅ Dungeon completed! ${knightIds.length} runs pending claim`);
        console.log(`💰 Estimated reward: ${estimatedReward.toFixed(2)} DNG`);

        // Clear session
        this.currentSession = null;

        return {
            dungeonName: pendingRun.dungeonName,
            knightIds,
            reward: estimatedReward,
            timeSpent: pendingRun.timeSpent,
            isPending: true
        };
    }

    /**
     * Estimate reward for display only (contract is authoritative)
     */
    estimateReward(knights) {
        let total = 0;
        knights.forEach(knight => {
            const rarity = knight.rarity?.tier || knight.rarity;
            const rarityData = window.RARITY?.[rarity];
            if (rarityData) {
                total += rarityData.dungeonReward;
            }
        });
        return total;
    }

    /**
     * Abandon current session without claiming
     */
    abandonSession() {
        if (this.currentSession) {
            console.log('🚪 Abandoning stale session');
            this.currentSession = null;
        }
    }

    /**
     * Get unclaimed rewards summary
     */
    getUnclaimedRewards() {
        const runs = this.pendingRuns.length;
        
        // Can't accurately calculate total without knight data
        // Just return count for now
        return {
            completions: runs,
            total: 0, // Will be calculated by contract on claim
            runs: this.pendingRuns
        };
    }

    /**
     * Claim all pending rewards
     */
    async claimAllRewards() {
        if (this.pendingRuns.length === 0) {
            alert('No unclaimed rewards!');
            return false;
        }

        if (!window.walletManager || !window.walletManager.isConnected) {
            alert('Please connect your wallet first!');
            return false;
        }

        try {
            console.log(`🎁 Claiming ${this.pendingRuns.length} pending runs...`);

            // Play claim start sound
            if (window.audioManager) {
                window.audioManager.play('reward_claim_start');
            }

            // Show transaction modal
            if (window.transactionModal) {
                window.transactionModal.showLoading();
            }

            const provider = new ethers.providers.Web3Provider(window.ethereum);
            const signer = provider.getSigner();
            const gameContract = new ethers.Contract(
                this.gameContractAddress,
                this.gameContractABI,
                signer
            );

            let totalReward = 0;

            // Submit each pending run
            for (const run of this.pendingRuns) {
                console.log(`📝 Submitting run: ${run.dungeonName} (${run.knightIds.length} knights)`);

                const tx = await gameContract.completeDungeons(
                    run.knightIds,
                    run.dungeonId
                );

                console.log('📝 Transaction sent:', tx.hash);

                // Update modal to waiting state
                if (window.transactionModal) {
                    window.transactionModal.showWaiting(tx.hash);
                }

                // Play blockchain confirmation sound
                if (window.audioManager) {
                    window.audioManager.play('blockchain_confirm');
                }

                const receipt = await tx.wait();
                console.log('✅ Confirmed!');

                // Parse RewardsClaimed event to get actual amount
                const rewardsClaimedEvent = receipt.events?.find(e => e.event === 'RewardsClaimed');
                if (rewardsClaimedEvent) {
                    const amount = ethers.utils.formatEther(rewardsClaimedEvent.args.amount);
                    totalReward += parseFloat(amount);
                    console.log(`💰 Claimed ${amount} DNG`);
                }
            }

            // Clear pending runs
            this.pendingRuns = [];
            this.saveToLocalStorage();

            // Show success modal
            if (window.transactionModal) {
                window.transactionModal.showSuccess(totalReward, this.pendingRuns[0]?.txHash);
            } else {
                alert(`Successfully claimed ${totalReward.toFixed(2)} $DNG!`);
            }

            // Play success sound and coin cascade
            if (window.audioManager) {
                window.audioManager.play('reward_claim_success');
                // Play coin cascade effect with delays
                for (let i = 0; i < 5; i++) {
                    window.audioManager.playWithDelay('coin_cascade', i * 100);
                }
            }

            return true;

        } catch (error) {
            console.error('❌ Claim failed:', error);

            // Better error messaging
            let errorMsg = 'Claim failed';
            if (error.message.includes('No runs left today')) {
                errorMsg = 'No runs left today! Your knights need to rest until the next daily reset at 12:00 PM UTC.';
            } else if (error.message.includes('Run cooldown')) {
                errorMsg = 'Run cooldown active! Wait 30 seconds between runs with the same knight.';
            } else if (error.message.includes('Not your knight')) {
                errorMsg = 'You do not own one or more of these knights!';
            } else if (error.message.includes('Treasury empty')) {
                errorMsg = 'Contract treasury is empty! Please contact the team to fund the contract.';
            } else if (error.message.includes('Paused')) {
                errorMsg = 'Contract is paused for maintenance. Please try again later.';
            } else if (error.message.includes('user rejected')) {
                errorMsg = 'Transaction cancelled by user.';
            } else {
                errorMsg = error.reason || error.message || 'Transaction failed. Please try again.';
            }

            // Show error modal
            if (window.transactionModal) {
                window.transactionModal.showError(errorMsg);
            } else {
                alert(errorMsg);
            }

            return false;
        }
    }

    /**
     * Get remaining runs for a knight (queries contract)
     */
    async getRemainingRuns(knightId) {
        if (!window.walletManager || !window.walletManager.isConnected) {
            return 0;
        }

        try {
            const provider = new ethers.providers.Web3Provider(window.ethereum);
            const gameContract = new ethers.Contract(
                this.gameContractAddress,
                this.gameContractABI,
                provider
            );

            const remaining = await gameContract.runsRemaining(knightId);
            return remaining;
        } catch (error) {
            console.error('Failed to get remaining runs:', error);
            return 0;
        }
    }

    /**
     * Get knight stats from blockchain
     */
    async getKnightStatsFromChain(knightId) {
        if (!window.walletManager || !window.walletManager.isConnected) {
            return null;
        }

        try {
            const provider = new ethers.providers.Web3Provider(window.ethereum);
            const gameContract = new ethers.Contract(
                this.gameContractAddress,
                this.gameContractABI,
                provider
            );

            const [totalClaimed, remaining, lastRunTime] = await gameContract.getKnightStats(knightId);
            
            return {
                totalClaimed: parseFloat(ethers.utils.formatEther(totalClaimed)),
                remaining: remaining.toNumber(),
                lastRunTime: lastRunTime.toNumber()
            };
        } catch (error) {
            console.error('Failed to get knight stats:', error);
            return null;
        }
    }

    /**
     * Get completion history for display
     */
    getHistory() {
        return this.pendingRuns.map(run => ({
            dungeonName: run.dungeonName,
            knightCount: run.knightIds.length,
            clearedAt: run.clearedAt,
            pending: true
        }));
    }

    // LocalStorage management
    saveToLocalStorage() {
        try {
            localStorage.setItem('dungeonPendingRuns', JSON.stringify(this.pendingRuns));
        } catch (error) {
            console.error('Failed to save to localStorage:', error);
        }
    }

    loadFromLocalStorage() {
        try {
            const stored = localStorage.getItem('dungeonPendingRuns');
            if (stored) {
                this.pendingRuns = JSON.parse(stored);
                console.log(`📦 Loaded ${this.pendingRuns.length} pending runs from storage`);
            }
        } catch (error) {
            console.error('Failed to load from localStorage:', error);
            this.pendingRuns = [];
        }
    }
}

// Initialize global instance
window.dungeonSession = new DungeonSessionManager();

console.log('✅ dungeon-session.js V2 loaded');
