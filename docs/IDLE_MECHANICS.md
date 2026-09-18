# Dungeon Knights - Idle Farming Mechanics

## Overview
The game has been redesigned as a true idle farming project where dungeons take hours to clear, creating a relaxed, long-form gameplay experience.

---

## Dungeon Clearing Time

### Target Clear Times (Solo Knight)
- **Common Knight (alone)**: ~5 hours to fully clear a dungeon
- **Uncommon Knight**: ~2.5 hours (2x faster)
- **Rare Knight**: ~1.5 hours (3.3x faster)
- **Epic Knight**: ~1 hour (5x faster)
- **Legendary Knight**: ~50 minutes (6x faster)
- **Mythic Knight**: ~25 minutes (12x faster)

### How It Works
1. **More Monsters**: Each dungeon now has 50-70 loot nodes (mostly monsters)
2. **Higher HP**: Monster health increased from 100 → 500 HP
3. **Slower Stamina Drain**: Knights consume stamina much slower
   - Moving: 0.3 stamina/second (was 0.5)
   - Attacking: 0.8 stamina/second (was 1.0)

---

## Knight Stamina System

### Exhaustion & Recovery
When a knight runs out of stamina:
1. Knight enters **"Exhausted"** state (💤 sleeping)
2. They stop moving and attacking
3. Stamina recovers at 2x speed while exhausted

### Manual Wake-Up
- Knights CAN be manually woken when stamina reaches **≥50%**
- A "👋 Wake" button appears in the Squad Panel for exhausted knights
- Useful for getting knights back into action faster

### Auto Wake-Up
- Knights WILL automatically wake when stamina reaches **100%**
- They resume idle behavior and look for targets
- No player interaction needed

### Visual Indicators
- Squad Panel shows each knight's stamina percentage
- Exhausted knights show "💤 Sleeping" status
- Wake button only appears when manual wake is available (≥50% stamina)

---

## Auto-Progression System

### Dungeon Completion
When all loot is collected:
1. **Completion Modal** appears with stats (gold earned, time taken)
2. **60-second countdown** timer starts
3. Knights **remain deployed** and ready
4. After 1 minute, game automatically moves to the next dungeon
5. **Knights continue working immediately** in the new dungeon (no need to click Deploy!)

### Manual Skip
Players can click **"Next Dungeon"** button to:
- **Instantly** move to the next dungeon
- Skip the 60-second wait
- **Knights automatically continue working** in the new dungeon

### Rest Option
Players can click **"Rest All Heroes"** button to:
- **Stop the auto-farming**
- Send all knights to the tavern for recovery
- Requires manual Deploy to start again

### Dungeon Rotation
- Dungeons cycle: Crypts → Mines → Temple → Magma → Void → Crypts...
- Each dungeon generates fresh loot and monsters
- Gold rewards scale: ~10 gold per full dungeon clear
- **Knights seamlessly transition between dungeons** without interruption

---

## Idle Farming Strategy

### Recommended Approach
1. **Deploy knights once** at the start
2. **Let them work continuously** across multiple dungeons
3. **Knights auto-continue** when dungeon completes (no re-deploy needed)
4. **AFK-friendly**: Come back hours later to collect rewards
5. **Manual intervention only for**:
   - Waking exhausted knights at 50%+ stamina
   - Sending all knights to rest (optional)
   - Recruiting new knights

### Seamless Progression
- Knights transition automatically between dungeons
- No need to click Deploy after each completion
- Music keeps playing across dungeon changes
- True "set it and forget it" idle gameplay

### Team Synergy
- Multiple knights = faster monster kills
- Combined power reduces clear time exponentially
- Example: 3 common knights = ~1.7 hour clear time per dungeon

### Long-Term Play
- Game designed for hours-long sessions
- Perfect for background farming while working/studying
- Can run indefinitely across multiple dungeon cycles
- Check in every 30-60 minutes for optimal efficiency (wake knights, etc.)

---

## Technical Changes

### Files Modified
1. **dungeon.js**
   - Increased monster HP: 100 → 500
   - Increased chest HP: 50 → 250
   - Increased loot nodes: 20-35 → 50-70
   - More monsters than chests (70% vs 30%)

2. **characters.js**
   - Reduced stamina consumption for movement/combat
   - Auto-wake at 100% stamina
   - Added `canManualWake()` and `manualWake()` methods
   - Faster stamina recovery when exhausted (2x speed)

3. **game.js**
   - Auto-progression timer: 60 seconds after dungeon clear
   - Countdown display in completion modal
   - Next dungeon button triggers instant progression

4. **ui.js**
   - Wake button for exhausted knights (≥50% stamina)
   - Stamina percentage display in Squad Panel
   - Visual feedback for knight states

5. **styles.css**
   - Wake button styling
   - Better knight mini-card layout

---

## Balance Notes

### Why 5 Hours for Common?
- Idle games should feel rewarding over time
- Encourages multiple knights deployment
- Creates anticipation for rare knight drops
- Realistic for AFK farming

### Stamina Balance
- Knights have 300-400 max stamina (higher for rare)
- Recovery rate: 5-10 per second (scales with rarity)
- Can work for ~30-45 minutes before exhaustion
- Recovers to 50% in ~15-25 minutes
- Fully recovers in ~30-50 minutes

### Gold Rewards
- ~10 gold per dungeon clear
- Slightly randomized per loot node
- Encourages continuous farming
- Builds up slowly for summoning new knights

---

## Future Improvements (Suggestions)

1. **Prestige System**: Reset progress for permanent bonuses
2. **Knight Equipment**: Gear to reduce stamina drain
3. **Auto-Deploy**: Knights automatically redeploy after rest
4. **Offline Progress**: Calculate earnings while game is closed
5. **Dungeon Difficulty Tiers**: Harder dungeons = better gold/hour
6. **Achievement System**: Milestones for total gold, dungeons cleared, etc.

---

**Last Updated**: September 4, 2026
**Version**: Idle Mechanics v1.0
