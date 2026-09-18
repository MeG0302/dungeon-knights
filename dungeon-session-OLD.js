// Dungeon Session Manager - Hybrid On/Off-chain System with Daily Run Limits
console.log('🔧 Loading dungeon-session.js...');

class DungeonSessionManager {
    constructor() {
        this.currentSession = null;
        this.completedDungeons = [];
        this.gameContractAddress = window.DUNGEON_CONFIG.getGameContract();
        this.gameContractABI = [
            'function completeDungeon(uint256 knightId, uint256 dungeonId, uint256 timeSpent, uint256 reward, uint256 timestamp, bytes signature) external',
            'function batchCompleteDungeons(uint256 knightId, uint256[] calldata dungeonIds, uint256[] calldata timeSpents, uint256[] calldata rewards, uint256[] calldata timestamps, bytes[] calldata signatures) external',
            'function getKnightStats(uint256 knightId) view returns (uint256 totalClaimed, uint256 lastClaimTime)',
            'event DungeonCompleted(address indexed player, uint256 indexed knightId, uint256 dungeonId, uint256 timeSpent, uint256 reward, uint256 timestamp)'
        ];
        
        // Daily run limits per rarity
        this.dailyRunLimits = {
            'COMMON': 5,
            'UNCOMMON': 5,
            'RARE': 4,
            'EPIC': 3,
            'LEGENDARY': 4
        };
        
        // Load or initialize knight run tracking
        this.initializeRunTracking();
        
        console.log('✅ DungeonSessionManager initialized with daily run limits');
    }
    
    /**
     * Initialize daily run tracking from localStorage
     */
    initializeRunTracking() {
        const stored = localStorage.getItem('knight_daily_runs');
        if (stored) {
            this.knightRuns = JSON.parse(stored);
            // Check if we need to reset (past 12 PM UTC)
            this.checkDailyReset();
        } else {
            this.knightRuns = {
                lastResetTime: this.getNext12PMUTC(Date.now() - 86400000), // Yesterday's reset
                knights: {} // tokenId -> { rarity, runsUsed, maxRuns }
            };
            this.saveRunTracking();
        }
    }
    
    /**
     * Get the next 12 PM UTC timestamp
     */
    getNext12PMUTC(fromTime) {
        const date = new Date(fromTime);
        date.setUTCHours(12, 0, 0, 0);
        
        // If we're past 12 PM UTC today, get tomorrow's 12 PM
        if (date.getTime() <= fromTime) {
            date.setUTCDate(date.getUTCDate() + 1);
        }
        
        return date.getTime();
    }
    
    /**
     * Get the most recent 12 PM UTC (today or yesterday)
     */
    getLastReset12PMUTC(now) {
        const date = new Date(now);
        date.setUTCHours(12, 0, 0, 0);
        
        // If current time is before today's 12 PM, use yesterday's 12 PM
        if (date.getTime() > now) {
            date.setUTCDate(date.getUTCDate() - 1);
        }
        
        return date.getTime();
    }
    
    /**
     * Check if we need to reset daily runs (past 12 PM UTC)
     */
    checkDailyReset() {
        const now = Date.now();
        const lastReset = this.getLastReset12PMUTC(now);
        
        // If last reset time is before the most recent 12 PM UTC, reset all runs
        if (this.knightRuns.lastResetTime < lastReset) {
            console.log('🔄 Daily reset triggered! Resetting all knight runs...');
            
            // Reset all knights
            Object.keys(this.knightRuns.knights).forEach(tokenId => {
                this.knightRuns.knights[tokenId].runsUsed = 0;
            });
            
            this.knightRuns.lastResetTime = lastReset;
            this.saveRunTracking();
            
            console.log(`✅ All knights restored! Next reset: ${new Date(this.getNext12PMUTC(now)).toUTCString()}`);
        }
    }
    
    /**
     * Save run tracking to localStorage
     */
    saveRunTracking() {
        localStorage.setItem('knight_daily_runs', JSON.stringify(this.knightRuns));
    }
    
    /**
     * Get remaining runs for a knight
     */
    getRemainingRuns(tokenId, rarity) {
        this.checkDailyReset(); // Always check for reset first
        
        const maxRuns = this.dailyRunLimits[rarity] || 5;
        
        if (!this.knightRuns.knights[tokenId]) {
            // First time seeing this knight
            this.knightRuns.knights[tokenId] = {
                rarity: rarity,
                runsUsed: 0,
                maxRuns: maxRuns
            };
            this.saveRunTracking();
        }
        
        const knight = this.knightRuns.knights[tokenId];
        return knight.maxRuns - knight.runsUsed;
    }
    
    /**
     * Check if knight can be deployed (has runs remaining)
     */
    canDeploy(tokenId, rarity) {
        return this.getRemainingRuns(tokenId, rarity) > 0;
    }
    
    /**
     * Use a run for a knight (called after dungeon completion)
     */
    useRun(tokenId, rarity) {
        this.checkDailyReset();
        
        if (!this.knightRuns.knights[tokenId]) {
            this.getRemainingRuns(tokenId, rarity); // Initialize
        }
        
        const knight = this.knightRuns.knights[tokenId];
        if (knight.runsUsed < knight.maxRuns) {
            knight.runsUsed += 1;
            this.saveRunTracking();
            
            const remaining = knight.maxRuns - knight.runsUsed;
            console.log(`⚡ Knight #${tokenId} used 1 run (${remaining}/${knight.maxRuns} remaining)`);
            
            return true;
        }
        
        console.warn(`⚠️ Knight #${tokenId} has no runs left!`);
        return false;
    }
    
    /**
     * Start a new dungeon run
     */
    startDungeon(knightId, dungeonId, dungeonName, knightCount = 1) {
        if (this.currentSession) {
            console.warn('⚠️ Session already active');
            return false;
        }
        
        this.currentSession = {
            knightId: knightId,
            dungeonId: dungeonId,
            dungeonName: dungeonName,
            startTime: Date.now(),
            knightCount: knightCount, // Track number of knights deployed
            damageDealt: 0,
            enemiesKilled: 0,
            lootCollected: 0,
            active: true
        };
        
        console.log(`🎮 Started dungeon: ${dungeonName} with ${knightCount} knight(s) (lead: #${knightId})`);
        return true;
    }
    
    /**
     * Update session stats during gameplay
     */
    updateSession(stats) {
        if (!this.currentSession) return;
        
        this.currentSession.damageDealt += stats.damage || 0;
        this.currentSession.enemiesKilled += stats.kills || 0;
        this.currentSession.lootCollected += stats.loot || 0;
    }
    
    /**
     * Calculate expected minimum time based on knight count
     * More knights = faster completion expected
     */
    getExpectedMinimumTime(knightCount) {
        // Base time for 1 knight: 5 minutes (300 seconds)
        // Formula: baseTime / sqrt(knightCount) with a minimum of 30 seconds
        const baseTime = 300; // 5 minutes
        const calculatedTime = baseTime / Math.sqrt(knightCount);
        const minimumTime = Math.max(30, calculatedTime); // Never less than 30 seconds
        
        console.log(`⏱️ Expected min time for ${knightCount} knight(s): ${Math.floor(minimumTime)}s`);
        return Math.floor(minimumTime);
    }
    
    /**
     * Calculate reward based on team composition - simple sum of all knights
     * Formula: Sum of all deployed knights' base rewards × performance bonus
     * Daily run limits control the economy instead of efficiency penalties
     */
    calculateReward(knightRarities) {
        if (!this.currentSession) return 0;
        
        // Base rewards per rarity (in DNG) - MUST match contract values
        const rarityRewards = {
            'COMMON': 10,       // Matches contract
            'UNCOMMON': 17,     // Matches contract
            'RARE': 30,         // Matches contract
            'EPIC': 75,         // Matches contract
            'LEGENDARY': 150    // Matches contract
        };
        
        // Handle both single knight (string) and team (array)
        const rarities = Array.isArray(knightRarities) ? knightRarities : [knightRarities];
        
        // Calculate sum of base rewards for all knights - NO PERFORMANCE BONUS
        const finalReward = rarities.reduce((sum, rarity) => {
            return sum + (rarityRewards[rarity] || 10);
        }, 0);
        
        // Max possible: 15 Legendary knights × 150 DNG = 2,250 DNG
        const MAX_REWARD_PER_RUN = 2250;
        if (finalReward > MAX_REWARD_PER_RUN) {
            console.warn(`⚠️ Reward ${finalReward.toFixed(2)} exceeds max ${MAX_REWARD_PER_RUN} DNG, capping...`);
            return MAX_REWARD_PER_RUN;
        }
        
        console.log(`💰 Calculated reward: ${finalReward.toFixed(2)} $DNG`);
        console.log(`   Team: ${rarities.length} knights`);
        
        return finalReward;
    }
    
    /**
     * Complete dungeon and prepare for claiming
     * @param {Array} deployedKnights - Array of knight objects {tokenId, rarity}
     */
    async completeDungeon(deployedKnights) {
        if (!this.currentSession || !this.currentSession.active) {
            console.error('❌ No active session');
            return null;
        }
        
        // Extract rarities for reward calculation
        const knightRarities = deployedKnights.map(k => k.rarity.tier);
        
        const completionTime = Date.now() - this.currentSession.startTime;
        const timeSpentSeconds = Math.floor(completionTime / 1000);
        const reward = this.calculateReward(knightRarities);
        
        // Get expected minimum time for validation
        const knightCount = deployedKnights.length;
        const expectedMinTime = this.getExpectedMinimumTime(knightCount);
        
        // Validate completion time
        if (timeSpentSeconds < expectedMinTime) {
            console.warn(`⚠️ Completion too fast! ${timeSpentSeconds}s < ${expectedMinTime}s expected for ${knightCount} knights`);
            console.warn(`⚠️ This completion may be rejected by the smart contract.`);
        } else {
            console.log(`✅ Time validation passed: ${timeSpentSeconds}s >= ${expectedMinTime}s`);
        }
        
        const completionData = {
            knightId: this.currentSession.knightId,
            dungeonId: this.currentSession.dungeonId,
            dungeonName: this.currentSession.dungeonName,
            knightCount: knightCount,
            timeSpent: timeSpentSeconds,
            reward: reward,
            damageDealt: this.currentSession.damageDealt,
            enemiesKilled: this.currentSession.enemiesKilled,
            lootCollected: this.currentSession.lootCollected,
            timestamp: Math.floor(Date.now() / 1000), // Unix timestamp
            claimed: false
        };
        
        // Sign the completion data
        try {
            const signature = await this.signCompletion(completionData);
            completionData.signature = signature;
            
            // Use runs for each deployed knight
            console.log(`⚡ Using runs for ${deployedKnights.length} deployed knights...`);
            deployedKnights.forEach(knight => {
                this.useRun(knight.tokenId, knight.rarity.tier);
            });
            
            // Store locally
            this.completedDungeons.push(completionData);
            this.saveToLocalStorage();
            
            // Clear session
            this.currentSession = null;
            
            console.log(`✅ Dungeon completed in ${completionData.timeSpent}s`);
            console.log(`💎 Earned ${completionData.reward} $DNG (unclaimed)`);
            
            return completionData;
            
        } catch (error) {
            console.error('❌ Failed to sign completion:', error);
            return null;
        }
    }
    
    /**
     * Sign completion data with wallet
     */
    async signCompletion(completionData) {
        if (!window.walletManager || !window.walletManager.isConnected) {
            throw new Error('Wallet not connected');
        }
        
        // Map dungeon name to ID (for smart contract)
        const dungeonNameToId = {
            'temple': 1,
            'overgrown temple': 1,
            'default': 1
        };
        
        const dungeonIdNum = typeof completionData.dungeonId === 'number' 
            ? completionData.dungeonId 
            : (dungeonNameToId[completionData.dungeonId.toLowerCase()] || 1);
        
        console.log(`🔢 Dungeon ID: ${completionData.dungeonId} → ${dungeonIdNum}`);
        
        // Create message hash
        const messageHash = ethers.utils.solidityKeccak256(
            ['uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'address'],
            [
                completionData.knightId,
                dungeonIdNum,
                completionData.timeSpent,
                ethers.utils.parseEther(completionData.reward.toString()),
                completionData.timestamp,
                window.walletManager.userAddress
            ]
        );
        
        // Ask user to sign
        const provider = new ethers.providers.Web3Provider(window.walletManager.provider);
        const signer = provider.getSigner();
        
        const signature = await signer.signMessage(ethers.utils.arrayify(messageHash));
        
        console.log('✍️ Completion signed');
        return signature;
    }
    
    /**
     * Claim all unclaimed rewards on-chain
     */
    async claimAllRewards() {
        const unclaimed = this.completedDungeons.filter(d => !d.claimed);
        
        if (unclaimed.length === 0) {
            alert('No unclaimed rewards!');
            return;
        }
        
        const totalReward = unclaimed.reduce((sum, d) => sum + d.reward, 0);
        
        // Show transaction modal
        if (window.transactionModal) {
            window.transactionModal.showLoading(`Claiming ${totalReward.toFixed(2)} $DNG from ${unclaimed.length} dungeon(s)...`);
        }
        
        // Play claim start sound
        if (window.audioManager) {
            window.audioManager.play('reward_claim_start');
        }
        
        console.log(`📤 Claiming ${unclaimed.length} dungeon completion(s)...`);
        
        try {
            const provider = new ethers.providers.Web3Provider(window.walletManager.provider);
            const signer = provider.getSigner();
            const gameContract = new ethers.Contract(
                this.gameContractAddress,
                this.gameContractABI,
                signer
            );
            
            // Group completions by knight
            const byKnight = {};
            unclaimed.forEach(completion => {
                if (!byKnight[completion.knightId]) {
                    byKnight[completion.knightId] = [];
                }
                byKnight[completion.knightId].push(completion);
            });
            
            // Batch claim for each knight
            for (const [knightId, completions] of Object.entries(byKnight)) {
                console.log(`⏳ Batch claiming ${completions.length} dungeons for Knight #${knightId}...`);
                
                // Prepare arrays for batch call
                const dungeonIds = [];
                const timeSpents = [];
                const rewards = [];
                const timestamps = [];
                const signatures = [];
                
                const dungeonNameToId = {
                    'temple': 1,
                    'overgrown temple': 1,
                    'crypts': 1,
                    'void': 1,
                    'default': 1
                };
                
                completions.forEach(completion => {
                    const dungeonIdNum = typeof completion.dungeonId === 'number' 
                        ? completion.dungeonId 
                        : (dungeonNameToId[completion.dungeonId.toLowerCase()] || 1);
                    
                    dungeonIds.push(dungeonIdNum);
                    timeSpents.push(completion.timeSpent);
                    rewards.push(ethers.utils.parseEther(completion.reward.toString()));
                    timestamps.push(completion.timestamp);
                    signatures.push(completion.signature);
                });
                
                // Call batch function
                const tx = await gameContract.batchCompleteDungeons(
                    parseInt(knightId),
                    dungeonIds,
                    timeSpents,
                    rewards,
                    timestamps,
                    signatures
                );
                
                console.log('📝 Batch transaction sent:', tx.hash);
                
                // Update modal to waiting state
                if (window.transactionModal) {
                    window.transactionModal.showWaiting(tx.hash);
                }
                
                // Play blockchain confirmation sound
                if (window.audioManager) {
                    window.audioManager.play('blockchain_confirm');
                }
                
                await tx.wait();
                console.log('✅ Confirmed! All dungeons claimed.');
                
                // Mark all as claimed
                completions.forEach(completion => {
                    completion.claimed = true;
                    completion.txHash = tx.hash;
                });
            }
            
            this.saveToLocalStorage();
            
            const totalReward = unclaimed.reduce((sum, d) => sum + d.reward, 0);
            
            // Show success modal
            if (window.transactionModal) {
                window.transactionModal.showSuccess(totalReward, unclaimed[0].txHash);
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
            if (error.message.includes('Reward too high')) {
                errorMsg = 'Reward exceeds contract maximum. The smart contract needs to be updated with higher maxReward limit.';
            } else if (error.message.includes('Completion too fast')) {
                errorMsg = 'Dungeon completed too quickly. Please wait longer before completing dungeons.';
            } else if (error.message.includes('Claim too soon')) {
                errorMsg = 'You claimed recently! The contract has a 1-minute cooldown between claims.\n\nPlease wait 60 seconds and try again.';
            } else if (error.message.includes('Completion too old')) {
                errorMsg = 'These completions are too old to claim (>24 hours). Clear old data and complete a fresh dungeon.';
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
     * Clear old/expired completions that can't be claimed
     */
    clearOldCompletions() {
        const now = Math.floor(Date.now() / 1000);
        const ONE_DAY = 24 * 60 * 60;
        
        const before = this.completedDungeons.length;
        this.completedDungeons = this.completedDungeons.filter(d => {
            const age = now - d.timestamp;
            return d.claimed || age < ONE_DAY; // Keep claimed or recent (<24h)
        });
        const after = this.completedDungeons.length;
        
        this.saveToLocalStorage();
        console.log(`🗑️ Cleared ${before - after} old completion(s)`);
        alert(`Cleared ${before - after} old completion(s). Complete a fresh dungeon to earn new rewards!`);
    }
    
    /**
     * Get unclaimed rewards total
     */
    getUnclaimedRewards() {
        return this.completedDungeons
            .filter(d => !d.claimed)
            .reduce((sum, d) => sum + d.reward, 0);
    }
    
    /**
     * Get completion history
     */
    getHistory() {
        return [...this.completedDungeons].reverse(); // Most recent first
    }
    
    /**
     * Get knight stats from blockchain (totalClaimed, lastClaimTime)
     */
    async getKnightStatsFromChain(knightId) {
        if (!window.walletManager || !window.walletManager.isConnected) {
            console.warn('⚠️ Wallet not connected');
            return null;
        }
        
        try {
            const provider = new ethers.providers.Web3Provider(window.walletManager.provider);
            const gameContract = new ethers.Contract(
                this.gameContractAddress,
                this.gameContractABI,
                provider
            );
            
            // Call getKnightStats - returns (totalClaimed, lastClaimTime)
            const stats = await gameContract.getKnightStats(knightId);
            
            return {
                totalClaimed: stats[0], // BigNumber in Wei
                lastClaimTime: stats[1] // Unix timestamp
            };
        } catch (error) {
            console.error(`❌ Failed to get stats for knight ${knightId}:`, error);
            return null;
        }
    }
    
    /**
     * Load completion history from blockchain events
     */
    async loadHistoryFromBlockchain(knightId) {
        if (!window.walletManager || !window.walletManager.isConnected) {
            console.warn('⚠️ Wallet not connected');
            return [];
        }
        
        try {
            console.log('📦 Loading history from blockchain...');
            
            const provider = new ethers.providers.Web3Provider(window.walletManager.provider);
            const gameContract = new ethers.Contract(
                this.gameContractAddress,
                this.gameContractABI,
                provider
            );
            
            // Query events
            const filter = gameContract.filters.DungeonCompleted(
                window.walletManager.userAddress,
                knightId
            );
            
            const events = await gameContract.queryFilter(filter);
            
            const history = events.map(event => ({
                knightId: event.args.knightId.toNumber(),
                dungeonId: event.args.dungeonId.toNumber(),
                timeSpent: event.args.timeSpent.toNumber(),
                reward: ethers.utils.formatEther(event.args.reward),
                timestamp: event.args.timestamp.toNumber(),
                txHash: event.transactionHash,
                claimed: true,
                date: new Date(event.args.timestamp * 1000).toLocaleString()
            }));
            
            console.log(`✅ Loaded ${history.length} completions from blockchain`);
            return history;
            
        } catch (error) {
            console.error('❌ Failed to load history:', error);
            return [];
        }
    }
    
    /**
     * Save to localStorage (temporary cache)
     */
    saveToLocalStorage() {
        try {
            localStorage.setItem('dungeonCompletions', JSON.stringify(this.completedDungeons));
        } catch (error) {
            console.error('Failed to save to localStorage:', error);
        }
    }
    
    /**
     * Load from localStorage
     */
    loadFromLocalStorage() {
        try {
            const saved = localStorage.getItem('dungeonCompletions');
            if (saved) {
                this.completedDungeons = JSON.parse(saved);
                console.log(`📂 Loaded ${this.completedDungeons.length} completions from localStorage`);
            }
        } catch (error) {
            console.error('Failed to load from localStorage:', error);
        }
    }
    
    /**
     * Clear local cache (after claiming or for testing)
     */
    clearLocalCache() {
        this.completedDungeons = this.completedDungeons.filter(d => !d.claimed);
        this.saveToLocalStorage();
        console.log('🗑️ Cleared claimed completions from cache');
    }
}

// Create global instance
console.log('🔧 Creating global DungeonSessionManager...');
window.dungeonSession = new DungeonSessionManager();
window.dungeonSession.loadFromLocalStorage();
console.log('✅ dungeon-session.js loaded');
