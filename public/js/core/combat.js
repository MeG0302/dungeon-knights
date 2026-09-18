// Combat System - Attack handling and reward distribution

class CombatSystem {
    constructor(dungeon, knightManager) {
        this.dungeon = dungeon;
        this.knightManager = knightManager;
        this.totalGoldEarned = 0;
        this.combatLog = [];
        this.activeEffects = []; // Visual effects array
    }

    update(deltaTime) {
        const deployedKnights = this.knightManager.getDeployedKnights();
        
        deployedKnights.forEach(knight => {
            if (knight.state === 'attacking' && knight.target && !knight.target.isDestroyed) {
                this.executeAttack(knight, knight.target);
            }
        });

        // Update visual effects
        this.activeEffects = this.activeEffects.filter(effect => {
            effect.life -= deltaTime;
            return effect.life > 0;
        });
    }

    executeAttack(knight, target) {
        if (!knight.canAttack()) return;

        const damage = knight.attack(target);
        const destroyed = target.takeDamage(damage);

        // Play sword hit sound
        if (window.audioManager) {
            window.audioManager.play('sword_hit');
        }

        // Add hit effect
        this.addHitEffect(target.gridX, target.gridY, damage, target.type);

        if (destroyed) {
            console.log(`💥 Knight #${knight.id} destroyed ${target.type} at (${target.gridX}, ${target.gridY})`);
            
            // Play destruction sound
            if (window.audioManager) {
                const sound = target.type === 'chest' ? 'chest_break' : 'monster_death';
                window.audioManager.play(sound);
            }
            
            this.handleLootDrop(knight, target);
            
            // IMPORTANT: Clear knight's target so it finds new one
            knight.target = null;
            knight.state = 'idle';
            knight.path = [];
            
            // Add destruction effect
            this.addDestructionEffect(target.gridX, target.gridY, target.type);
        }
    }

    addHitEffect(gridX, gridY, damage, type) {
        this.activeEffects.push({
            type: 'hit',
            gridX,
            gridY,
            damage,
            targetType: type,
            life: 0.5, // seconds
            startLife: 0.5
        });
    }

    addDestructionEffect(gridX, gridY, type) {
        this.activeEffects.push({
            type: 'destroy',
            gridX,
            gridY,
            targetType: type,
            life: 1.0,
            startLife: 1.0
        });
    }

    handleLootDrop(knight, target) {
        const reward = target.reward;
        this.totalGoldEarned += reward;
        knight.totalEarned += reward;
        
        // Add gold to game balance immediately
        if (window.game) {
            window.game.goldBalance += reward;
        }

        // Play coin sound
        if (window.audioManager) {
            window.audioManager.play('coin_pickup');
        }

        // Add floating coin animation
        this.addCoinAnimation(target.gridX, target.gridY, reward);

        // Add to combat log
        const logEntry = {
            timestamp: Date.now(),
            knight: knight.id,
            type: target.type,
            reward: reward,
            message: `Knight #${knight.id} destroyed ${target.type} and earned ${reward.toFixed(2)} gold!`
        };
        
        this.combatLog.push(logEntry);
        if (this.combatLog.length > 50) {
            this.combatLog.shift();
        }

        console.log(`💰 +${reward.toFixed(2)} gold from ${target.type}`);
        return reward;
    }
    
    addCoinAnimation(gridX, gridY, amount) {
        this.activeEffects.push({
            type: 'coin',
            gridX,
            gridY,
            amount: amount,
            life: 1.5, // 1.5 seconds animation
            startLife: 1.5,
            offsetY: 0 // Will float upward
        });
    }

    getRecentLogs(count = 10) {
        return this.combatLog.slice(-count);
    }

    getTotalEarned() {
        return this.totalGoldEarned;
    }

    getGoldPerMinute() {
        const deployedKnights = this.knightManager.getDeployedKnights();
        const activeKnights = deployedKnights.filter(k => k.state !== 'exhausted');
        
        // Rough estimate: average knight power * loot multiplier * attacks per minute
        const avgPower = activeKnights.reduce((sum, k) => sum + k.stats.power, 0) / Math.max(activeKnights.length, 1);
        const estimatedGPM = Math.floor(avgPower * this.dungeon.config.lootMultiplier * 2);
        
        return estimatedGPM;
    }

    reset() {
        this.combatLog = [];
    }
}
