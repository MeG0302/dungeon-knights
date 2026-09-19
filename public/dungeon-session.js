// Dungeon Session Manager V4 - Server-Signed Runs
//
// V3 paid whatever the browser recorded. This version asks the server to price and sign
// each finished run, and claims those signatures on the V4 contract, which re-checks
// them on chain. Two things fall back to the old path instead of breaking:
//
//   - No V4 configured (the contract is not deployed yet) -> runs are recorded exactly
//     as before and claimed on V3.
//   - A run that was earned before this upgrade, so it has no token and can never be
//     signed -> flushed to V3 while it is still unpaused, by `flushLegacyRuns()`.
console.log('🔧 Loading dungeon-session.js V4...');

// One-time migration for the V2 schema (kept: it also clears the old signature store).
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

// The site-wide wallet session (the same one the Points Program uses), so one signature
// covers both and the player is never asked twice.
const SESSION_KEY = 'dk_points_session';
const PENDING_KEY = 'dungeonPendingRuns';
const LEGACY_FLUSH_FLAG = 'dk_legacy_runs_flushed';

class DungeonSessionManager {
    constructor() {
        this.currentSession = null;
        this.pendingRuns = []; // [{ knightIds, dungeonId, receipt|null, runToken|null, ... }]
        this.gameContractAddress = window.DUNGEON_CONFIG.getGameContract();
        this.gameContractV4Address = null;
        this.config = null;
        this.configPromise = null;

        // V3 - batch claims (kept for runs earned before the signed path existed).
        this.gameContractABI = [
            'function batchClaimRewards((uint256[],uint256)[] runs) external',
            'function runsRemaining(uint256 knightId) view returns (uint8)',
            'function getKnightStats(uint256 knightId) view returns (uint256, uint8)',
            'function treasuryBalance() view returns (uint256)',
            'event DungeonCompleted(address indexed player, uint256 indexed knightId, uint256 indexed dungeonId, uint8 rarity, uint256 reward, uint256 timestamp)',
            'event RewardsClaimed(address indexed player, uint256 amount, uint256 runsCount, uint256 knightCount)'
        ];

        // V4 - signed runs only. There is no unsigned entry point on V4 by design.
        this.gameContractV4ABI = [
            'function claimSignedRuns((uint256[],uint256,uint256,uint256,uint256,bytes)[] runs) external',
            'function runsRemaining(uint256 knightId) view returns (uint8)',
            'function getKnightStats(uint256 knightId) view returns (uint256, uint8)',
            'function treasuryBalance() view returns (uint256)',
            'event DungeonCompleted(address indexed player, uint256 indexed knightId, uint256 indexed dungeonId, uint8 rarity, uint256 reward, uint256 timestamp)',
            'event RewardsClaimed(address indexed player, uint256 amount, uint256 runsCount, uint256 knightCount)'
        ];

        this.loadFromLocalStorage();
        console.log('✅ DungeonSessionManager V4 initialized (server-signed runs)');

        // Best-effort, in the background: learn whether V4 is live and settle anything
        // earned before it existed. Never blocks play if the API is unreachable.
        this.loadConfig().then(() => this.flushLegacyRuns()).catch(() => {});
    }

    // ---------------------------------------------------------------- server API

    /** Public game config, cached for the page's lifetime. */
    async loadConfig() {
        if (this.config) return this.config;
        if (!this.configPromise) {
            this.configPromise = fetch('/api/game/config', { cache: 'no-store' })
                .then((res) => (res.ok ? res.json() : null))
                .then((data) => {
                    this.config = data || {};
                    this.gameContractV4Address = data && data.v4 ? data.v4 : null;
                    if (this.gameContractV4Address) {
                        console.log('🔐 Signed-run claims enabled via V4', this.gameContractV4Address);
                    }
                    return this.config;
                })
                .catch(() => {
                    this.config = {};
                    return this.config;
                });
        }
        return this.configPromise;
    }

    /** The wallet session token, or null. */
    readSession() {
        try {
            const raw = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
            return raw && raw.token && raw.address ? raw : null;
        } catch {
            return null;
        }
    }

    /**
     * Make sure we hold a session for the connected wallet. Costs no gas and is
     * remembered for 30 days, so this is not a per-visit prompt.
     */
    async ensureSession() {
        const address = window.walletManager && window.walletManager.userAddress;
        if (!address) return null;

        const existing = this.readSession();
        if (existing && existing.address.toLowerCase() === address.toLowerCase()) {
            const expires = Number(existing.expiresAt) * 1000;
            if (!expires || expires > Date.now() + 60_000) return existing.token;
        }

        if (!window.ethereum || !window.ethereum.request) return null;

        try {
            const challenge = await fetch(`/api/points/session?address=${encodeURIComponent(address)}`)
                .then((res) => (res.ok ? res.json() : null));
            if (!challenge || !challenge.message) return null;

            const signature = await window.ethereum.request({
                method: 'personal_sign',
                params: [challenge.message, address]
            });
            const started = await fetch('/api/points/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: challenge.message, signature })
            }).then((res) => (res.ok ? res.json() : null));

            if (!started || !started.token) return null;

            localStorage.setItem(SESSION_KEY, JSON.stringify({
                address,
                token: started.token,
                expiresAt: started.expiresAt
            }));
            console.log('🔐 Wallet session established for game runs');
            return started.token;
        } catch (error) {
            console.warn('⚠️ Could not sign in for game runs:', error && error.message);
            return null;
        }
    }

    /** Authenticated JSON call that never throws, so callers can branch on status. */
    async api(path, { method = 'GET', body, token } = {}) {
        try {
            const res = await fetch(path, {
                method,
                cache: 'no-store',
                headers: {
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                    ...(token ? { Authorization: `Bearer ${token}` } : {})
                },
                ...(body ? { body: JSON.stringify(body) } : {})
            });
            let data = null;
            try {
                data = await res.json();
            } catch {
                data = {};
            }
            return { ok: res.ok, status: res.status, data };
        } catch (error) {
            return { ok: false, status: 0, data: { error: error && error.message } };
        }
    }

    // ------------------------------------------------------------------ gameplay

    /**
     * Start a new dungeon session.
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

        const dungeonId = DUNGEON_IDS[dungeonType] || 1;

        this.currentSession = {
            knightIds,
            dungeonType,
            dungeonName,
            dungeonId,
            startTime: Date.now()
        };

        // Ask the server to start its clock. Kept as a promise so completion can wait
        // for it without delaying the game itself.
        this.currentSession.tokenPromise = this.requestRunToken(knightIds, dungeonId);

        console.log(`🎮 Session started: ${dungeonName} with ${knightIds.length} knights`);
        return true;
    }

    async requestRunToken(knightIds, dungeonId) {
        await this.loadConfig();
        if (!this.gameContractV4Address) return null;

        const token = await this.ensureSession();
        if (!token) return null;

        const res = await this.api('/api/game/start', {
            method: 'POST',
            token,
            body: { knightIds, dungeonId }
        });
        if (!res.ok) {
            console.warn('⚠️ Run token unavailable:', res.data && res.data.error);
            return null;
        }
        return res.data;
    }

    /**
     * Complete the current dungeon.
     * @param {Object[]} knights - Full knight objects with tokenId and rarity
     * @param {{kills?:number,totalNodes?:number,chests?:number}} [metrics] - what the
     *        engine observed, used only as a plausibility check server-side
     */
    async completeDungeon(knights, metrics) {
        if (!this.currentSession) {
            console.error('❌ No active session');
            return null;
        }

        if (!knights || knights.length === 0) {
            console.error('❌ No knights provided');
            return null;
        }

        const session = this.currentSession;
        const knightIds = knights.map(k => k.tokenId);
        const elapsed = Date.now() - session.startTime;

        const pendingRun = {
            knightIds,
            dungeonId: session.dungeonId,
            dungeonName: session.dungeonName,
            clearedAt: Date.now(),
            timeSpent: Math.floor(elapsed / 1000),
            receipt: null,
            runToken: null,
            reward: 0
        };

        // Wait for the run token, then ask the server to price and sign this run. Both
        // are best-effort: whoever is mid-dungeon should never see the game break
        // because the backend is slow.
        let issued = null;
        try {
            issued = await session.tokenPromise;
        } catch {
            issued = null;
        }

        if (issued && issued.runToken) {
            pendingRun.runToken = issued.runToken;
            const signed = await this.requestReceipt(issued, metrics, knightIds.length);
            if (signed && signed.receipt) {
                pendingRun.receipt = signed.receipt;
                // The receipt's reward is wei, like everything the contract touches.
                pendingRun.reward = parseFloat(ethers.utils.formatEther(signed.receipt.reward));
            } else if (signed && signed.error) {
                console.warn('⚠️ Run not signed:', signed.error);
            }
        }

        // Display figure: the signed reward when we have it, the local estimate when we
        // do not (the contract is authoritative either way).
        if (!pendingRun.reward) {
            pendingRun.reward = this.estimateReward(knights);
        }

        this.pendingRuns.push(pendingRun);
        this.saveToLocalStorage();

        console.log(`✅ Dungeon completed! ${knightIds.length} runs pending claim`);
        console.log(`💰 Reward: ${pendingRun.reward.toFixed(2)} DNG${pendingRun.receipt ? ' (signed)' : ' (unsigned)'}`);

        this.currentSession = null;

        return {
            dungeonName: pendingRun.dungeonName,
            knightIds,
            reward: pendingRun.reward,
            timeSpent: pendingRun.timeSpent,
            isPending: true,
            signed: !!pendingRun.receipt
        };
    }

    /**
     * Ask the server for a signature. A 409 means the run finished sooner than the
     * dungeon allows — real, just too fast to sign *yet* — so we wait it out rather
     * than losing the run.
     */
    async requestReceipt(issued, metrics, knightCount) {
        const token = await this.ensureSession();
        if (!token) return { error: 'no wallet session' };

        let wait = 0;
        for (let attempt = 0; attempt < 4; attempt++) {
            if (wait > 0) {
                console.log(`⏳ Waiting ${wait}s for the run to be old enough to sign`);
                await new Promise(r => setTimeout(r, wait * 1000));
            }

            const res = await this.api('/api/game/complete', {
                method: 'POST',
                token,
                body: {
                    runToken: issued.runToken,
                    kills: metrics && metrics.kills,
                    totalNodes: metrics && metrics.totalNodes,
                    chests: metrics && metrics.chests
                }
            });

            if (res.ok && res.data && res.data.receipt) return res.data;

            const retryAfter = res.data && res.data.retryAfter;
            if (res.status === 409 && retryAfter > 0) {
                wait = Math.min(150, retryAfter + 2);
                continue;
            }

            return { error: (res.data && res.data.error) || `claim request failed (${res.status})` };
        }

        return { error: 'the run could not be signed in time' };
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

    // ------------------------------------------------------------------- claiming

    /** Runs that carry a V4 signature. */
    signedRuns() {
        return this.pendingRuns.filter(run => run.receipt);
    }

    /** Runs with no signature and no token — earned before this upgrade. */
    legacyRuns() {
        return this.pendingRuns.filter(run => !run.receipt && !run.runToken);
    }

    /**
     * Get unclaimed rewards summary
     */
    async getUnclaimedRewards() {
        let estimatedTotal = 0;

        for (const run of this.pendingRuns) {
            if (run.receipt) {
                estimatedTotal += parseFloat(ethers.utils.formatEther(run.receipt.reward));
                continue;
            }
            estimatedTotal += await this.calculateRunReward(run.knightIds);
        }

        console.log(`💰 Estimated unclaimed: ${estimatedTotal} DNG from ${this.pendingRuns.length} runs`);
        return estimatedTotal;
    }

    async calculateRunReward(knightIds) {
        // If we can't fetch knight data, use fallback estimate
        if (!window.walletManager || !window.walletManager.isConnected) {
            return knightIds.length * 15; // Fallback: 15 DNG average per knight
        }

        try {
            const provider = new ethers.providers.Web3Provider(window.ethereum);

            // Get Knight NFT address from config or CONTRACT_ADDRESSES
            let knightNFTAddress;
            if (window.DUNGEON_CONFIG && typeof window.DUNGEON_CONFIG.getKnightNFT === 'function') {
                knightNFTAddress = window.DUNGEON_CONFIG.getKnightNFT();
            } else if (window.CONTRACT_ADDRESSES) {
                knightNFTAddress = window.CONTRACT_ADDRESSES.KNIGHT_NFT;
            } else {
                // Hardcoded fallback
                knightNFTAddress = '0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512';
            }

            // Knight NFT ABI - just need getKnightInfo
            const knightNFTABI = [
                'function getKnightInfo(uint256 tokenId) view returns (address owner, uint8 rarity, string rarityName)'
            ];

            const knightNFT = new ethers.Contract(knightNFTAddress, knightNFTABI, provider);

            // Rarity rewards from contract (matches V3/V4 contracts)
            const rarityRewards = [10, 17, 30, 75, 150]; // Common, Uncommon, Rare, Epic, Legendary

            let totalReward = 0;

            for (const knightId of knightIds) {
                try {
                    const [, rarity] = await knightNFT.getKnightInfo(knightId);
                    totalReward += rarityRewards[rarity];
                } catch (error) {
                    console.warn(`⚠️ Failed to get rarity for knight ${knightId}, using average (15 DNG)`);
                    totalReward += 15; // Fallback
                }
            }

            return totalReward;
        } catch (error) {
            console.warn('⚠️ Failed to fetch knight rarities, using estimate:', error.message);
            return knightIds.length * 15; // Fallback: 15 DNG average per knight
        }
    }

    /**
     * Claim all pending rewards.
     *
     * Signed runs go to V4 in one transaction. Anything earned before the upgrade goes
     * to V3 in a second one — and only while V3 is still accepting claims, which is why
     * `flushLegacyRuns()` runs automatically on load.
     */
    async claimAllRewards() {
        console.log('🎁 claimAllRewards() called');
        console.log('📦 Pending runs:', this.pendingRuns.length);

        if (this.pendingRuns.length === 0) {
            console.warn('⚠️ No pending runs to claim');
            alert('No unclaimed rewards!');
            return false;
        }

        if (!window.walletManager || !window.walletManager.isConnected) {
            console.error('❌ Wallet not connected');
            alert('Please connect your wallet first!');
            return false;
        }

        // One more try at signing anything that only failed on a hiccup.
        await this.retryUnsignedRuns();

        const signed = this.signedRuns();
        const legacy = this.legacyRuns();

        let claimedTotal = 0;
        let claimedRuns = 0;
        let claimedKnights = 0;

        if (legacy.length) {
            const result = await this.claimOnV3(legacy);
            if (result.error) return this.reportClaimFailure(result.error);
            claimedTotal += result.totalReward;
            claimedRuns += result.runs;
            claimedKnights += result.knights;
        }

        if (signed.length) {
            const result = await this.claimOnV4(signed);
            if (result.error) return this.reportClaimFailure(result.error);
            claimedTotal += result.totalReward;
            claimedRuns += result.runs;
            claimedKnights += result.knights;
        }

        if (!claimedRuns) {
            return this.reportClaimFailure(
                this.gameContractV4Address
                    ? 'None of your runs could be claimed. Reload and try again.'
                    : 'These runs were earned before the upgrade and the old contract is no longer accepting claims.'
            );
        }

        console.log(`✅ ${claimedRuns} runs claimed in ${signed.length ? 'the signed path' : 'the legacy path'}`);

        if (window.transactionModal) {
            window.transactionModal.showSuccess(claimedTotal, null);
        } else {
            alert(`Successfully claimed ${claimedTotal.toFixed(2)} $DNG!`);
        }

        if (window.audioManager) {
            window.audioManager.play('reward_claim_success');
            for (let i = 0; i < 5; i++) {
                window.audioManager.playWithDelay('coin_cascade', i * 100);
            }
        }

        if (window.rewardClaimUI) window.rewardClaimUI.updateDisplay();
        return true;
    }

    /** Signed runs -> V4. */
    async claimOnV4(runs) {
        try {
            const provider = new ethers.providers.Web3Provider(window.ethereum);
            const signer = provider.getSigner();
            const gameContract = new ethers.Contract(
                this.gameContractV4Address,
                this.gameContractV4ABI,
                signer
            );

            // Ethers v5 wants structs as arrays:
            // [knightIds, dungeonId, reward, nonce, expiry, signature]
            const payload = runs.map(run => [
                run.receipt.knightIds,
                run.receipt.dungeonId,
                run.receipt.reward,
                run.receipt.nonce,
                run.receipt.expiry,
                run.receipt.signature
            ]);

            if (window.transactionModal) window.transactionModal.showLoading();
            if (window.audioManager) window.audioManager.play('reward_claim_start');

            console.log('📝 Submitting signed claim for', payload.length, 'runs');
            const tx = await gameContract.claimSignedRuns(payload);
            if (window.transactionModal) window.transactionModal.showWaiting(tx.hash);
            if (window.audioManager) window.audioManager.play('blockchain_confirm');

            const receipt = await tx.wait();
            const event = receipt.events?.find(e => e.event === 'RewardsClaimed');

            const totalReward = event ? parseFloat(ethers.utils.formatEther(event.args.amount)) : 0;
            const knights = event ? Number(event.args.knightCount) : 0;

            // Only clear what the chain says it paid for.
            const claimed = new Set(runs.map(r => r.receipt.nonce));
            this.pendingRuns = this.pendingRuns.filter(
                r => !r.receipt || !claimed.has(r.receipt.nonce)
            );
            this.saveToLocalStorage();

            return { totalReward, runs: runs.length, knights, tx: tx.hash };
        } catch (error) {
            console.error('❌ V4 claim failed:', error);
            return { error: this.describeClaimError(error, 'V4') };
        }
    }

    /** Runs earned before the upgrade -> V3, while it still accepts claims. */
    async claimOnV3(runs) {
        try {
            const provider = new ethers.providers.Web3Provider(window.ethereum);
            const signer = provider.getSigner();
            const gameContract = new ethers.Contract(
                this.gameContractAddress,
                this.gameContractABI,
                signer
            );

            // Ethers v5 requires tuples as arrays: [knightIds, dungeonId]
            const payload = runs.map(run => [run.knightIds, run.dungeonId]);

            if (window.transactionModal) window.transactionModal.showLoading();
            if (window.audioManager) window.audioManager.play('reward_claim_start');

            console.log('📝 Submitting legacy V3 claim for', payload.length, 'pre-upgrade runs');
            const tx = await gameContract.batchClaimRewards(payload);
            if (window.transactionModal) window.transactionModal.showWaiting(tx.hash);

            const receipt = await tx.wait();
            const event = receipt.events?.find(e => e.event === 'RewardsClaimed');

            const totalReward = event ? parseFloat(ethers.utils.formatEther(event.args.amount)) : 0;
            const knights = event ? Number(event.args.knightCount) : 0;

            const claimedAt = new Set(runs.map(r => r.clearedAt));
            this.pendingRuns = this.pendingRuns.filter(r => !claimedAt.has(r.clearedAt));
            this.saveToLocalStorage();

            return { totalReward, runs: runs.length, knights, tx: tx.hash };
        } catch (error) {
            console.error('❌ V3 claim failed:', error);
            return { error: this.describeClaimError(error, 'V3') };
        }
    }

    /**
     * Settle pre-upgrade runs automatically, once, so they are not stranded when V3 is
     * paused. Runs only when a wallet is already connected, and never twice in one
     * browser session — a rejected prompt is a decision, not a retry signal.
     */
    async flushLegacyRuns() {
        await this.loadConfig();
        if (!this.gameContractV4Address) return false;
        if (!window.walletManager || !window.walletManager.isConnected) return false;
        if (this.legacyRuns().length === 0) return false;

        try {
            if (sessionStorage.getItem(LEGACY_FLUSH_FLAG) === '1') return false;
            sessionStorage.setItem(LEGACY_FLUSH_FLAG, '1');
        } catch { /* private mode: run it once per load */ }

        const legacy = this.legacyRuns();
        console.log(`🧹 Settling ${legacy.length} runs earned before the upgrade on V3`);

        const result = await this.claimOnV3(legacy);
        if (result.error) {
            console.warn('⚠️ Could not settle pre-upgrade runs:', result.error);
            return false;
        }

        console.log(`✅ Settled ${result.runs} pre-upgrade runs for ${result.totalReward} DNG`);
        if (window.rewardClaimUI) window.rewardClaimUI.updateDisplay();
        return true;
    }

    /**
     * Runs whose receipt request failed (offline, backend restart) still hold a token
     * that is valid for hours, so they can be signed on a later visit instead of being
     * lost.
     */
    async retryUnsignedRuns() {
        const retryable = this.pendingRuns.filter(run => !run.receipt && run.runToken);
        if (!retryable.length) return;

        for (const run of retryable) {
            if (run.retryCount >= 3) continue;
            run.retryCount = (run.retryCount || 0) + 1;

            const signed = await this.requestReceipt(
                { runToken: run.runToken },
                null,
                run.knightIds.length
            );
            if (signed && signed.receipt) {
                run.receipt = signed.receipt;
                run.reward = parseFloat(ethers.utils.formatEther(signed.receipt.reward));
                console.log(`🔐 Recovered a signed receipt for the ${run.dungeonName} run`);
            }
        }
        this.saveToLocalStorage();
    }

    describeClaimError(error, contract) {
        const message = (error && (error.reason || error.message)) || 'Transaction failed.';

        if (message.includes('No runs left today')) {
            return 'One or more knights have no runs left today! Daily reset at 12:00 PM UTC.';
        }
        if (message.includes('Not your knight')) {
            return 'You do not own one or more of these knights!';
        }
        if (message.includes('Treasury empty')) {
            return 'Contract treasury is empty! Please contact the team to fund the contract.';
        }
        if (message.includes('Paused') || message.includes('paused')) {
            return 'Contract is paused for maintenance. Please try again later.';
        }
        if (message.includes('Bad signature') || message.includes('Receipt expired')
            || message.includes('Receipt already used')) {
            return `The ${contract} contract rejected a run receipt. Reload the page and try again.`;
        }
        if (message.includes('user rejected') || message.includes('User denied')) {
            return 'Transaction cancelled by user.';
        }
        return message;
    }

    reportClaimFailure(message) {
        console.error('❌ Claim failed:', message);
        if (window.transactionModal) {
            window.transactionModal.showError(message);
        } else {
            alert(message);
        }
        return false;
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
            const address = this.gameContractV4Address || this.gameContractAddress;
            const abi = this.gameContractV4Address ? this.gameContractV4ABI : this.gameContractABI;
            const gameContract = new ethers.Contract(address, abi, provider);

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
            const address = this.gameContractV4Address || this.gameContractAddress;
            const abi = this.gameContractV4Address ? this.gameContractV4ABI : this.gameContractABI;
            const gameContract = new ethers.Contract(address, abi, provider);

            const [totalClaimed, remaining] = await gameContract.getKnightStats(knightId);

            return {
                totalClaimed: parseFloat(ethers.utils.formatEther(totalClaimed)),
                remaining: Number(remaining)
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
            reward: run.reward || 0,
            clearedAt: run.clearedAt,
            signed: !!run.receipt,
            pending: true
        }));
    }

    // LocalStorage management
    saveToLocalStorage() {
        try {
            localStorage.setItem(PENDING_KEY, JSON.stringify(this.pendingRuns));
        } catch (error) {
            console.error('Failed to save to localStorage:', error);
        }
    }

    loadFromLocalStorage() {
        try {
            const stored = localStorage.getItem(PENDING_KEY);
            if (stored) {
                this.pendingRuns = JSON.parse(stored);
                // Runs written by V3 have no receipt and no token: they can only ever be
                // claimed on V3, which is exactly how legacyRuns() identifies them.
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

console.log('✅ dungeon-session.js V4 loaded');
