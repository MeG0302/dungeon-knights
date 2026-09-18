# 🛡️ Dynamic Anti-Cheat: Knight-Scaled Minimum Times

## Formula
```
minimumTime = max(30, baseTime / √(knightCount))
```

Where:
- **baseTime** = 300 seconds (5 minutes for 1 knight)
- **minimumTime** = Never less than 30 seconds

## Expected Completion Times

| Knights | Minimum Time | Calculation |
|---------|-------------|-------------|
| 1       | 300s (5:00) | 300 / √1 = 300s |
| 2       | 212s (3:32) | 300 / √2 = 212s |
| 3       | 173s (2:53) | 300 / √3 = 173s |
| 4       | 150s (2:30) | 300 / √4 = 150s |
| 5       | 134s (2:14) | 300 / √5 = 134s |
| 10      | 95s  (1:35) | 300 / √10 = 95s |
| 15      | 77s  (1:17) | 300 / √15 = 77s |
| 20      | 67s  (1:07) | 300 / √20 = 67s |
| 25      | 60s  (1:00) | 300 / √25 = 60s |
| 50      | 42s  (0:42) | 300 / √50 = 42s |
| 100+    | 30s  (0:30) | Minimum cap |

## How It Works

### Client-Side (JavaScript)
1. **Track knight count** when dungeon starts
2. **Calculate expected minimum** when completing
3. **Warn if too fast** but still allow submission
4. **Log validation** for debugging

### Smart Contract
- **Fixed 30-second minimum** (updated via `setDungeon`)
- Validates all submissions meet this baseline
- Prevents instant completion hacks

### Why This Design?

**Benefits:**
- ✅ **Realistic gameplay**: 15 knights clearing in 1:54 is legitimate
- ✅ **Anti-cheat**: 30s minimum prevents instant hacks
- ✅ **Scalable**: Works with any number of knights
- ✅ **User-friendly**: No false rejections for valid gameplay

**Formula Reasoning:**
- Square root scaling = diminishing returns (realistic)
- 2x knights ≠ 2x speed (coordination overhead)
- Large armies still need minimum time

## Console Output

When starting:
```
🎮 Started blockchain session for 15 knight(s) (lead: #123)
⏱️ Expected min time for 15 knight(s): 77s
```

When completing:
```
✅ Time validation passed: 114s >= 77s
💰 Calculated reward: 12.00 $DNG
✍️ Completion signed
```

If too fast:
```
⚠️ Completion too fast! 45s < 77s expected for 15 knights
⚠️ This completion may be rejected by the smart contract.
```

## Future Enhancements

Could implement:
1. **On-chain knight count validation** (requires passing knight count to contract)
2. **Dynamic reward scaling** (more knights = split rewards)
3. **Dungeon difficulty tiers** (harder dungeons = higher minimums)
4. **Achievement bonuses** (speed run achievements for fast clears)

## Current Configuration

- **Smart Contract Min**: 30 seconds (via `setDungeon`)
- **Client-Side Calculation**: Dynamic based on knight count
- **Warning Only**: Client warns but doesn't block submission
- **Contract Validation**: Only checks 30s minimum
