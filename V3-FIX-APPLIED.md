# ✅ V3 Batch Claim Fix Applied

## 🐛 Bug Fixed:
**Error:** `invalid value for array (argument="value", value=undefined, code=INVALID_ARGUMENT)`

## 🔧 Root Cause:
Frontend uses **ethers v5.7.2**, which requires Solidity tuples to be passed as **arrays**, not objects.

## ✅ Solution:
Changed tuple formatting from:
```javascript
// ❌ Wrong (objects)
const runs = this.pendingRuns.map(run => ({
    knightIds: run.knightIds,
    dungeonId: run.dungeonId
}));
```

To:
```javascript
// ✅ Correct (arrays for ethers v5)
const runs = this.pendingRuns.map(run => [
    run.knightIds,
    run.dungeonId
]);
```

## 📦 Deployed:
- **Fixed in:** `dungeon-session.js`
- **Deployed at:** 2026-09-12
- **Production URL:** https://dungeon-knights-meglast320-1694.vercel.app

## 🧪 Testing:
Try batch claim again:
1. Complete 3 dungeons
2. Click "Claim All Rewards"
3. Should now work! ✅

## 📝 Technical Details:

### Contract ABI (Solidity):
```solidity
struct RunData {
    uint256[] knightIds;
    uint256 dungeonId;
}

function batchClaimRewards(RunData[] calldata runs) external;
```

### Frontend Call (ethers v5):
```javascript
// Tuple format: [[knightIds, dungeonId], [knightIds, dungeonId], ...]
await gameContract.batchClaimRewards([
    [[1, 2, 3], 1], // Run 1: knights 1,2,3 in dungeon 1
    [[4, 5, 6], 2], // Run 2: knights 4,5,6 in dungeon 2
]);
```

### Why This Matters:
- **ethers v5:** Tuples = arrays `[value1, value2]`
- **ethers v6:** Tuples = objects `{field1, field2}` OR arrays
- Our frontend uses ethers v5.7.2 (loaded from CDN)
- Must use array format for compatibility

## ✅ Status:
**FIXED & DEPLOYED** 🚀

Ready to test batch claims now!
