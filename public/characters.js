// Character System - Stats, Rarity, and Knight Management
// Rarity system based on CONFIG. The payback figures in the comments below are derived in
// lib/token-math.js and asserted against these comments by tools/check-token-math.js, so
// they cannot drift the way the baseline note here did when the reward table changed.

const RARITY = {
    COMMON: { 
        name: 'Common', 
        multiplier: 1.0, 
        color: '#9E9E9E', 
        dropRate: 0.50, // 50%
        dungeonReward: 12,
        dailyRuns: 5, // 42 clears to ROI · 8.3 days at 5 runs/day
        hashPower: 15 // capacity / 4 — what makes staking pay 90% of playing
    },
    UNCOMMON: { 
        name: 'Uncommon', 
        multiplier: 1.7, 
        color: '#4CAF50', 
        dropRate: 0.30, // 30%
        dungeonReward: 20,
        dailyRuns: 5, // 25 clears to ROI · 5.0 days at 5 runs/day
        hashPower: 25
    },
    RARE: { 
        name: 'Rare', 
        multiplier: 3.0, 
        color: '#2196F3', 
        dropRate: 0.15, // 15%
        dungeonReward: 36,
        dailyRuns: 4, // 14 clears to ROI · 3.5 days at 4 runs/day
        hashPower: 36
    },
    EPIC: { 
        name: 'Epic', 
        multiplier: 7.5, 
        color: '#9C27B0', 
        dropRate: 0.04, // 4%
        dungeonReward: 60,
        dailyRuns: 3, // 9 clears to ROI · 2.8 days at 3 runs/day
        hashPower: 45
    },
    LEGENDARY: { 
        name: 'Legendary', 
        multiplier: 15.0, 
        color: '#FFD700', 
        dropRate: 0.01, // 1%
        dungeonReward: 100,
        dailyRuns: 4, // 5 clears to ROI · 1.3 days at 4 runs/day
        hashPower: 100
    }
};

class Knight {
    constructor(id) {
        this.id = id;
        this.tokenId = id; // Alias for blockchain compatibility
        this.rarity = this.rollRarity();
        this.stats = this.generateStats();
        this.position = { x: 0, y: 0 };
        this.gridPosition = { x: 0, y: 0 };
        this.stamina = this.stats.maxStamina;
        this.state = 'idle'; // idle, moving, attacking, exhausted, resting
        this.target = null;
        this.path = [];
        this.attackCooldown = 0;
        this.isDeployed = false;
        this.totalEarned = 0;

        // Animation state (drives the procedural animation in dungeon.js)
        this.walkPhase = Math.random() * Math.PI * 2; // per-knight gait offset
        this.animPhase = Math.random() * Math.PI * 2; // idle breathing offset
        this.facing = 1;     // 1 = facing right, -1 = facing left
        this.hitFlash = 0;   // seconds of hit-flash overlay remaining
        
        // Animation properties
        this.attackAnimation = {
            active: false,
            progress: 0, // 0 to 1
            duration: 0.3 // seconds
        };
        
        // Trail system for glowing path effect
        this.trail = [];
        this.maxTrailLength = 15;
        this.trailUpdateCooldown = 0;
    }
    
    /**
     * Runs this knight can still start today, or **null** when nobody has answered yet.
     *
     * This used to return `RARITY[tier].dailyRuns` — the *cap* — which is why every card
     * read "5/5 runs today" after five clears, why the deploy-time check for an exhausted
     * knight could never fire (`remaining === 0` was unreachable), and why a sixth clear
     * was played and then refused on chain with "No runs left today" with nothing on
     * screen having warned anybody.
     *
     * The arithmetic is `RunBudget`'s, and the two inputs are the chain's `runsRemaining`
     * and the unclaimed runs this browser is holding. Null is a real answer — it means the
     * chain has not replied — and the screens print it as "—" rather than as a full bar.
     */
    getRemainingRuns() {
        const session = window.dungeonSession;
        if (!session || typeof session.cachedRunsRemaining !== 'function' || !window.RunBudget) return null;
        const remaining = session.cachedRunsRemaining(this.tokenId);
        if (remaining === null) return null;
        return window.RunBudget.playableFor(remaining, session.bankedRunsFor(this.tokenId));
    }

    /** The daily cap for this knight's tier — the denominator on every "5/5" on the site. */
    getDailyCap() {
        if (window.RunBudget) return window.RunBudget.capFor(this.rarity && this.rarity.tier, window.RARITY);
        return (RARITY[this.rarity.tier] && RARITY[this.rarity.tier].dailyRuns) || 5;
    }
    
    /**
     * Check if knight can be deployed (has runs remaining).
     *
     * An unread knight is deployable: the chain is the gate, and a wallet whose RPC is
     * down must not be locked out of its own game. A knight the chain has said is spent
     * is not — a run pays for every knight in it, so one tired knight would mean nobody
     * in the squad gets paid.
     */
    canDeploy() {
        const left = this.getRemainingRuns();
        return left === null ? true : left > 0;
    }

    rollRarity() {
        const roll = Math.random();
        let cumulative = 0;
        
        for (const [key, rarity] of Object.entries(RARITY)) {
            cumulative += rarity.dropRate;
            if (roll <= cumulative) {
                return { ...rarity, tier: key };
            }
        }
        
        return { ...RARITY.COMMON, tier: 'COMMON' };
    }

    generateStats() {
        const mult = this.rarity.multiplier;
        const variance = () => 0.8 + Math.random() * 0.4; // 80-120% variance
        
        // Speed scale matching earning power (1:1.7:3:7.5:15 ratio)
        // Legendary(15x) = fastest, Common(1x) = slowest
        // Speed directly affects clear time
        let baseSpeed;
        switch(this.rarity.tier) {
            case 'LEGENDARY':
                baseSpeed = 15; // 15x - fastest
                break;
            case 'EPIC':
                baseSpeed = 7.5; // 7.5x
                break;
            case 'RARE':
                baseSpeed = 3; // 3x
                break;
            case 'UNCOMMON':
                baseSpeed = 1.7; // 1.7x
                break;
            case 'COMMON':
                baseSpeed = 1; // 1x - slowest (baseline)
                break;
            default:
                baseSpeed = 1;
        }
        
        return {
            power: Math.floor((10 + Math.random() * 15) * mult * variance()),
            range: 1, // MELEE ONLY - must be adjacent to attack
            speed: baseSpeed, // Speed based on 1:2:5:7:10:15 ratio
            maxStamina: Math.floor((300 + Math.random() * 100) * mult), // MUCH MORE stamina
            recoveryRate: Math.floor((5 + Math.random() * 5) * mult) // Faster recovery
        };
    }

    update(deltaTime) {
        if (!this.isDeployed) return;

        // Update attack cooldown
        if (this.attackCooldown > 0) {
            this.attackCooldown -= deltaTime;
        }

        // Update attack animation
        if (this.attackAnimation.active) {
            this.attackAnimation.progress += deltaTime / this.attackAnimation.duration;
            if (this.attackAnimation.progress >= 1) {
                this.attackAnimation.active = false;
                this.attackAnimation.progress = 0;
            }
        }

        // Advance the walk cycle — faster knights take quicker strides
        if (this.state === 'moving') {
            this.walkPhase += deltaTime * (7 + this.stats.speed * 1.5);
        } else {
            this.walkPhase += deltaTime * 2;
        }

        // Decay the hit flash
        if (this.hitFlash > 0) {
            this.hitFlash = Math.max(0, this.hitFlash - deltaTime);
        }
        
        // Update trail
        this.trailUpdateCooldown -= deltaTime;
        if (this.trailUpdateCooldown <= 0 && this.state === 'moving') {
            this.trail.unshift({
                x: this.gridPosition.x,
                y: this.gridPosition.y,
                life: 1.0
            });
            if (this.trail.length > this.maxTrailLength) {
                this.trail.pop();
            }
            this.trailUpdateCooldown = 0.1; // Add trail point every 0.1s
        }
        
        // Fade out trail
        this.trail.forEach(point => {
            point.life -= deltaTime * 0.8;
        });
        this.trail = this.trail.filter(point => point.life > 0);

        // Stamina management - Idle farming mechanics
        if (this.state === 'exhausted') {
            this.recoverStamina(deltaTime * 2); // Fast recovery when exhausted
            
            // Auto-wake at 100% stamina
            if (this.stamina >= this.stats.maxStamina) {
                this.state = 'idle';
                this.target = null;
                console.log(`⚡ Knight #${this.id} fully recovered and woke up automatically (100% stamina)`);
            }
            return;
        }

        if (this.state === 'resting') {
            this.recoverStamina(deltaTime * 3); // Very fast recovery in tavern
            if (this.stamina >= this.stats.maxStamina * 0.8) {
                this.state = 'idle';
            }
            return;
        }

        // Consume stamina when active - Balanced for ~5 hour common knight solo clear
        if (this.state === 'moving') {
            this.consumeStamina(deltaTime * 0.3); // Very slow stamina drain for movement
        } else if (this.state === 'attacking') {
            this.consumeStamina(deltaTime * 0.8); // Moderate stamina drain for attacking
        }
    }
    
    // Can manually wake if stamina >= 50%
    canManualWake() {
        return this.state === 'exhausted' && this.stamina >= this.stats.maxStamina * 0.5;
    }
    
    manualWake() {
        if (this.canManualWake()) {
            this.state = 'idle';
            this.target = null;
            console.log(`👋 Knight #${this.id} manually woken up (${Math.floor(this.getStaminaPercent())}% stamina)`);
            return true;
        }
        return false;
    }

    consumeStamina(amount) {
        this.stamina = Math.max(0, this.stamina - amount);
        if (this.stamina <= 0) {
            this.state = 'exhausted';
            this.target = null;
            this.path = [];
        }
    }

    recoverStamina(amount) {
        this.stamina = Math.min(this.stats.maxStamina, this.stamina + amount * this.stats.recoveryRate);
    }

    sendToTavern() {
        this.isDeployed = false;
        this.state = 'resting';
        this.target = null;
        this.path = [];
    }

    deploy(startX, startY) {
        this.isDeployed = true;
        this.gridPosition = { x: startX, y: startY };
        this.state = 'idle';
        this.stamina = Math.max(this.stamina, this.stats.maxStamina * 0.5);
    }

    getStaminaPercent() {
        return (this.stamina / this.stats.maxStamina) * 100;
    }

    /**
     * How far this knight is between its current tile and the next (0..1).
     * moveKnight() accumulates moveTimer and snaps one tile when it reaches
     * 1 / speed, so the same ratio is the smooth render offset between tiles.
     */
    getMoveProgress() {
        if (this.state !== 'moving' || !this.path || this.path.length < 2) return 0;
        const interval = 1 / Math.max(0.0001, this.stats.speed);
        return Math.max(0, Math.min(1, (this.moveTimer || 0) / interval));
    }

    /**
     * Direction the knight is heading: +1 right, -1 left. Falls back to the
     * last facing so an idle knight does not snap back to a default pose.
     */
    getFacingDirection() {
        if (this.state === 'moving' && this.path && this.path.length > 1) {
            const dx = this.path[1].x - this.gridPosition.x;
            if (dx !== 0) return dx > 0 ? 1 : -1;
        }
        if (this.target && !this.target.isDestroyed) {
            const dx = this.target.gridX - this.gridPosition.x;
            if (dx !== 0) return dx > 0 ? 1 : -1;
        }
        return this.facing === -1 ? -1 : 1;
    }

    canAttack() {
        return this.attackCooldown <= 0 && this.stamina > 0 && this.state !== 'exhausted';
    }

    attack(target) {
        if (!this.canAttack()) return 0;
        
        this.attackCooldown = 1.0; // 1 second attack cooldown
        this.consumeStamina(5);
        
        // Start attack animation
        this.attackAnimation.active = true;
        this.attackAnimation.progress = 0;

        // Turn to face whatever is being struck
        if (target && typeof target.gridX === 'number') {
            const dx = target.gridX - this.gridPosition.x;
            if (dx !== 0) this.facing = dx > 0 ? 1 : -1;
        }

        return this.stats.power;
    }

    toJSON() {
        return {
            id: this.id,
            rarity: this.rarity,
            stats: this.stats,
            stamina: this.stamina,
            state: this.state,
            totalEarned: this.totalEarned
        };
    }
}

// Knight Manager
class KnightManager {
    constructor() {
        this.knights = [];
        this.nextId = 1;
    }

    recruitKnight() {
        const knight = new Knight(this.nextId++);
        this.knights.push(knight);
        return knight;
    }

    getKnight(id) {
        return this.knights.find(k => k.id === id);
    }

    getDeployedKnights() {
        return this.knights.filter(k => k.isDeployed);
    }

    getRestingKnights() {
        return this.knights.filter(k => k.state === 'resting');
    }

    getAvailableKnights() {
        return this.knights.filter(k => !k.isDeployed && k.state !== 'resting');
    }

    update(deltaTime) {
        this.knights.forEach(knight => knight.update(deltaTime));
    }
}

// Export RARITY to global scope for use in other modules
if (typeof window !== 'undefined') {
    window.RARITY = RARITY;
}
