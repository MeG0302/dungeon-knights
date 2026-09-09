# ⚔️ Rarity-Based Reward System Implementation

## Current System
- Knights earn gold per kill during dungeon
- Total gold accumulated during run
- No rarity-based differentiation

## New System
- Knights earn $DNG tokens **per dungeon completion**
- Reward amount based on knight rarity
- Uncommon = 20 $DNG (25 dungeons to ROI)

---

## Reward Structure

| Rarity | Mint Cost | Dungeon Reward | Dungeons to ROI | ROI Speed |
|--------|-----------|----------------|-----------------|-----------|
| Common | 500 $DNG | 12 $DNG | 42 | Baseline ÷ 1.67 |
| Uncommon | 500 $DNG | 20 $DNG | **25** ✅ | Baseline |
| Rare | 500 $DNG | 36 $DNG | 14 | 1.8x faster |
| Epic | 500 $DNG | 60 $DNG | 8 | 3x faster |
| Legendary | 500 $DNG | 100 $DNG | 5 | 5x faster |

---

## Implementation Changes

### 1. Dungeon Completion Reward

**Old**: Gold earned per kill  
**New**: $DNG tokens per dungeon completion

```javascript
// When dungeon is completed
function completeDungeon() {
    const squad = getActiveSquad();
    
    squad.forEach(knight => {
        const reward = knight.rarity.dungeonReward;
        knight.totalEarned += reward;
        totalTokensEarned += reward;
    });
}
```

### 2. Display Updates

**Before**:
```
💰 Gold: 1,234.56
```

**After**:
```
💰 $DNG: 1,234
```

### 3. Squad Rewards

With multiple knights, rewards multiply:

```
1 Uncommon knight:
- Dungeon reward: 20 $DNG
- 25 dungeons to ROI

3 Uncommon knights:
- Dungeon reward: 60 $DNG (20 × 3)
- 25 dungeons to ROI (still same per knight)

Mixed squad (1 Common, 1 Uncommon, 1 Rare):
- Dungeon reward: 68 $DNG (12 + 20 + 36)
- Better average ROI
```

---

## Code Changes

### config.js ✅
Already added:
```javascript
RARITY: {
    common: { dungeonReward: 12 },
    uncommon: { dungeonReward: 20 },
    rare: { dungeonReward: 36 },
    epic: { dungeonReward: 60 },
    legendary: { dungeonReward: 100 }
}
```

### characters.js ✅
Already updated:
```javascript
const RARITY = {
    COMMON: { dungeonReward: 12 },
    UNCOMMON: { dungeonReward: 20 },
    // etc...
}
```

### game.js - Needs Update
Change reward calculation on dungeon completion:

```javascript
completeDungeon() {
    // Calculate rewards based on squad rarities
    const squad = this.knightManager.getDeployedKnights();
    let totalReward = 0;
    
    squad.forEach(knight => {
        const rarityKey = knight.rarity.tier;
        const rarityConfig = RARITY[rarityKey];
        const reward = rarityConfig.dungeonReward;
        
        knight.totalEarned += reward;
        totalReward += reward;
    });
    
    this.totalTokens += totalReward;
    
    this.logMessage(`🎉 Dungeon cleared! Earned ${totalReward} $DNG!`);
}
```

### ui.js - Display Updates
Show $DNG instead of Gold:

```javascript
// Update currency display
<div class="currency">💰 ${this.totalTokens} $DNG</div>

// Show rarity-based rewards in knight details
<p>Dungeon Reward: ${knight.rarity.dungeonReward} $DNG</p>
<p>Total Earned: ${knight.totalEarned} $DNG</p>
<p>ROI Progress: ${(knight.totalEarned / 500 * 100).toFixed(1)}%</p>
```

---

## Player Experience

### Minting
```
Player pays: 500 $DNG
Roll rarity: 30% chance
Result: Uncommon knight!
Reward: 20 $DNG per dungeon
```

### First Dungeon
```
Deploy: 1 Uncommon knight
Complete dungeon: +20 $DNG
Knight progress: 20/500 (4% ROI)
```

### After 25 Dungeons
```
Dungeons completed: 25
Total earned: 500 $DNG (20 × 25)
ROI: 100% ✅ Break even!
Future earnings: Pure profit
```

### With Lucky Rare Knight
```
Deploy: 1 Rare knight (got lucky!)
Complete dungeon: +36 $DNG
After 14 dungeons: 504 $DNG ✅ ROI reached!
Profit per dungeon after: 36 $DNG
```

---

## Visual Indicators

### Knight Cards
Show rarity with color-coded borders and rewards:

```
┌─────────────────────┐
│  ⚔️ UNCOMMON ⚔️    │ ← Green border
│  Knight #42         │
│  HP: 150  ATK: 15   │
│  💰 20 $DNG/dungeon │ ← Reward per clear
│  📊 340/500 $DNG    │ ← Progress to ROI
│  68% ROI            │
└─────────────────────┘
```

### Dungeon Completion Screen
```
🎉 DUNGEON CLEARED! 🎉

Knights Deployed: 3
  • Uncommon Knight #1: +20 $DNG
  • Rare Knight #5: +36 $DNG
  • Common Knight #9: +12 $DNG

Total Earned: 68 $DNG

Time: 3:42
Continue to next dungeon?
```

---

## Balance Considerations

### Expected Value of Random Mint

```
Mint cost: 500 $DNG (fixed)

Drop rates:
- 50% Common (12 $DNG/dungeon)
- 30% Uncommon (20 $DNG/dungeon)
- 15% Rare (36 $DNG/dungeon)
- 4% Epic (60 $DNG/dungeon)
- 1% Legendary (100 $DNG/dungeon)

Expected dungeons to ROI:
= 0.50 × 42 + 0.30 × 25 + 0.15 × 14 + 0.04 × 8 + 0.01 × 5
= 21 + 7.5 + 2.1 + 0.32 + 0.05
= 30.97 dungeons average

Expected reward per dungeon:
= 500 / 30.97 = 16.14 $DNG

Actual EV:
= 0.50 × 12 + 0.30 × 20 + 0.15 × 36 + 0.04 × 60 + 0.01 × 100
= 6 + 6 + 5.4 + 2.4 + 1
= 20.8 $DNG per dungeon

ROI at EV: 500 / 20.8 = 24 dungeons
```

**Result**: Slightly better than Uncommon baseline (24 vs 25 dungeons) = Good for players!

---

## Testing Checklist

- [ ] Common knight earns 12 $DNG per dungeon
- [ ] Uncommon knight earns 20 $DNG per dungeon
- [ ] Rare knight earns 36 $DNG per dungeon
- [ ] Epic knight earns 60 $DNG per dungeon
- [ ] Legendary knight earns 100 $DNG per dungeon
- [ ] Squad of 3 Uncommon = 60 $DNG total
- [ ] Mixed squad calculates correctly
- [ ] UI shows $DNG instead of Gold
- [ ] ROI progress displays correctly
- [ ] Completion screen shows per-knight rewards

---

## Ready to Implement?

This changes the core economy from:
- ❌ Kill-based gold earnings (gamified but not blockchain-connected)
- ✅ Completion-based $DNG earnings (directly tied to NFT rarity)

Makes the game:
- ✅ More blockchain-native
- ✅ Clearer ROI path
- ✅ Rarity matters significantly
- ✅ Squad composition strategic

**Next**: Update game.js, ui.js, and completion screens to use rarity-based $DNG rewards
