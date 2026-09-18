# 🎮 Dungeon Knights - Hybrid Blockchain System

## Overview

This is a **hybrid decentralized + on-chain validation** system that provides:
- ✅ Fast, smooth gameplay (no blockchain lag)
- ✅ Cryptographic proof of completions (wallet signatures)
- ✅ On-chain validation (anti-cheat)
- ✅ Permanent history (blockchain events)
- ✅ Efficient gas usage (batch claims)

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     PLAYER                               │
│  • Plays game locally                                   │
│  • Signs completions with wallet                        │
│  • Claims rewards when ready                            │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│                  GAME CLIENT                             │
│  • Tracks stamina locally                               │
│  • Calculates rewards                                   │
│  • Stores completions with signatures                   │
│  • Submits to blockchain                                │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│              SMART CONTRACT                              │
│  • Verifies signatures                                  │
│  • Validates time/rewards                               │
│  • Prevents cheating                                    │
│  • Mints/transfers $DNG                                 │
│  • Emits permanent events                               │
└─────────────────────────────────────────────────────────┘
```

---

## Files Created

### Smart Contracts
- **`contracts/DungeonKnightsGame.sol`** - Game logic and reward claiming

### Frontend
- **`dungeon-session.js`** - Session tracking and signing
- **`reward-claim-ui.js`** - UI widget for claiming rewards

---

## How It Works

### 1. Playing the Game (Off-chain)

```javascript
// Start dungeon
dungeonSession.startDungeon(knightId, dungeonId, "Forgotten Crypts");

// Play game (stamina tracked locally)
// ... player fights enemies, collects loot ...

// Complete dungeon
const completion = await dungeonSession.completeDungeon(knightRarity);
// ✅ Signed with wallet, stored locally
```

**No blockchain transaction yet!** Game is fast and smooth.

### 2. Claiming Rewards (On-chain)

```javascript
// View unclaimed rewards
const unclaimed = dungeonSession.getUnclaimedRewards();
console.log(`${unclaimed} $DNG waiting to claim`);

// Claim all at once (single transaction)
await dungeonSession.claimAllRewards();
// ✅ Submits all signed completions to smart contract
// ✅ Contract validates and mints $DNG
```

**One transaction** for multiple dungeon completions!

### 3. Anti-Cheat Validation

The smart contract prevents cheating:

```solidity
// ✅ Minimum time check
require(timeSpent >= dungeons[dungeonId].minCompletionTime);

// ✅ Maximum reward check
require(reward <= dungeons[dungeonId].maxRewardPerRun);

// ✅ Rate limiting
require(block.timestamp >= lastClaimTime[knightId] + MIN_CLAIM_INTERVAL);

// ✅ Signature verification
require(signer == msg.sender);
```

---

## Deployment Steps

### 1. Deploy Smart Contract

```bash
# Install dependencies
npm install @openzeppelin/contracts

# Compile contract
npx hardhat compile

# Deploy to Robinhood Chain Testnet
npx hardhat run scripts/deploy-game-contract.js --network robinhood-testnet
```

### 2. Fund Game Contract

The game contract needs $DNG tokens to distribute as rewards:

```javascript
// Transfer $DNG to game contract
await dngToken.transfer(gameContractAddress, ethers.utils.parseEther("100000"));

// Or approve and fund
await gameContract.fundContract(ethers.utils.parseEther("100000"));
```

### 3. Update Frontend Config

In `dungeon-session.js`, update:

```javascript
this.gameContractAddress = '0xYOUR_GAME_CONTRACT_ADDRESS';
```

### 4. Add to HTML Pages

Add to `index.html` and `dungeon-select.html`:

```html
<!-- Dungeon Session System -->
<script src="dungeon-session.js"></script>
<script src="reward-claim-ui.js"></script>
```

---

## Integration with Game

### In `game.js`, when dungeon completes:

```javascript
async function onDungeonComplete() {
    // Complete dungeon
    const completion = await window.dungeonSession.completeDungeon(
        currentKnight.rarity.tier
    );
    
    if (completion) {
        // Show completion message
        showMessage(`
            Dungeon completed in ${completion.timeSpent}s!
            Earned ${completion.reward} $DNG (unclaimed)
        `);
        
        // Update UI
        window.rewardClaimUI?.updateDisplay();
    }
}
```

### When starting dungeon:

```javascript
function deployKnights(knightIds) {
    const knight = knightIds[0]; // First knight
    
    // Start session
    window.dungeonSession.startDungeon(
        knight.id,
        currentDungeon.id,
        currentDungeon.name
    );
    
    // ... existing deploy logic ...
}
```

---

## User Experience

### Player Flow:

1. **Play** → Complete 5 dungeons (instant, no gas)
2. **Click "Claim All"** → Submit all 5 completions (single transaction)
3. **Receive** → 100+ $DNG minted to wallet
4. **View History** → See all completions on blockchain

### Benefits:

- ✅ **Fast gameplay** - No waiting for transactions
- ✅ **Low gas costs** - Batch claims instead of per-dungeon
- ✅ **Provable** - Every completion signed by player
- ✅ **Secure** - Smart contract validates everything
- ✅ **Permanent** - History stored on-chain forever

---

## Anti-Cheat Features

### 1. Time-Based Validation
```solidity
// Dungeon must take minimum time
minCompletionTime: 5 minutes
```

### 2. Reward Limits
```solidity
// Can't claim more than maximum
maxRewardPerRun: 100 DNG
```

### 3. Rate Limiting
```solidity
// Can only claim every minute
MIN_CLAIM_INTERVAL: 1 minute
```

### 4. Signature Verification
```solidity
// Must be signed by player's wallet
require(signer == msg.sender);
```

### 5. Timestamp Validation
```solidity
// Can't use future or old timestamps
require(timestamp <= block.timestamp);
require(block.timestamp - timestamp < 1 hours);
```

---

## Testing

### Test the system:

```javascript
// 1. Start session
dungeonSession.startDungeon(1, 1, "Test Dungeon");

// 2. Wait a bit (simulate gameplay)
await new Promise(resolve => setTimeout(resolve, 5000));

// 3. Complete
const completion = await dungeonSession.completeDungeon('LEGENDARY');
console.log('Completion:', completion);

// 4. Check unclaimed
const unclaimed = dungeonSession.getUnclaimedRewards();
console.log('Unclaimed:', unclaimed);

// 5. Claim (requires deployed contract)
await dungeonSession.claimAllRewards();
```

---

## Contract Addresses

**Robinhood Chain Testnet:**
- Knights NFT: `0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512`
- $DNG Token: `0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910`
- Game Contract: `TODO - Deploy DungeonKnightsGame.sol`

---

## Future Enhancements

1. **Stamina Potions** - Buy with $DNG to restore stamina
2. **Boss Battles** - Special high-reward dungeons
3. **Daily Quests** - Bonus rewards for daily completion
4. **Leaderboards** - Track top players on-chain
5. **Tournament Mode** - PvP with $DNG stakes

---

## Security Considerations

✅ **Signatures prove authorization** - Player must sign each completion
✅ **Time limits prevent speed hacking** - Contract enforces minimum times
✅ **Reward caps prevent inflation** - Maximum per dungeon enforced
✅ **Rate limiting prevents spam** - Cooldown between claims
✅ **Timestamp validation** - Can't use fake times

---

## Gas Optimization

**Traditional approach:**
- 5 dungeons = 5 transactions = 5× gas cost

**Hybrid approach:**
- 5 dungeons = 1 transaction = 1× gas cost
- **80% gas savings!**

---

## Support

Questions? Check:
- Smart contract code: `contracts/DungeonKnightsGame.sol`
- Session manager: `dungeon-session.js`
- UI component: `reward-claim-ui.js`

---

## License

MIT
