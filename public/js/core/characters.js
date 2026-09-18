// Character System - Stats, Rarity, and Knight Management

const RARITY = {
    COMMON: { name: 'Common', multiplier: 1.0, color: '#808080', dropRate: 0.65 },
    UNCOMMON: { name: 'Uncommon', multiplier: 1.5, color: '#00ff00', dropRate: 0.20 },
    RARE: { name: 'Rare', multiplier: 2.2, color: '#0080ff', dropRate: 0.10 },
    EPIC: { name: 'Epic', multiplier: 3.5, color: '#a020f0', dropRate: 0.045 },
    LEGENDARY: { name: 'Legendary', multiplier: 5.0, color: '#ffa500', dropRate: 0.012 },
    MYTHIC: { name: 'Mythic', multiplier: 8.0, color: '#ff0000', dropRate: 0.003 }
};

class Knight {
    constructor(id) {
        this.id = id;
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
        
        // Speed scale for 1:2:5:7:10:15 ratio (Mythic alone = 15 min)
        // Mythic(1)=15min, Legendary(2)=30min, Epic(5)=75min, Rare(7)=105min, Uncommon(10)=150min, Common(15)=225min
        let baseSpeed;
        switch(this.rarity.tier) {
            case 'MYTHIC':
                baseSpeed = 15; // Ratio 1 - fastest (15 min alone)
                break;
            case 'LEGENDARY':
                baseSpeed = 7.5; // Ratio 2 - (30 min alone)
                break;
            case 'EPIC':
                baseSpeed = 3; // Ratio 5 - (75 min alone)
                break;
            case 'RARE':
                baseSpeed = 2.14; // Ratio 7 - (105 min alone)
                break;
            case 'UNCOMMON':
                baseSpeed = 1.5; // Ratio 10 - (150 min alone)
                break;
            case 'COMMON':
                baseSpeed = 1; // Ratio 15 - slowest (225 min alone)
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
