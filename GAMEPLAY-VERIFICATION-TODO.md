# Gameplay Verification - Future Implementation

## Current Issue
**Problem:** DungeonKnightsGameV2 contract has no gameplay verification. Anyone can call `completeDungeons()` without actually playing, just need to respect:
- Daily run limits (3-5 runs per knight based on rarity)
- 30-second cooldown between runs
- Ownership of NFT

**Attack Vector:** Bot can claim max daily rewards (5 runs × 15 knights = 75 claims/day) without opening the game.

## Recommended Solution: Backend Signature Verification

### Why This Approach?
- ✅ Only 1 transaction (better UX + lower gas)
- ✅ Validates actual gameplay (time, loot, enemies killed)
- ✅ Uses existing Vercel infrastructure
- ✅ Free on Vercel free tier
- ✅ Prevents all bot attacks

### Implementation Plan

#### 1. Contract Changes (DungeonKnightsGameV3.sol)
```solidity
address public trustedSigner;  // Backend wallet that signs valid completions

function completeDungeons(
    uint256[] calldata knightIds,
    uint256 dungeonId,
    uint256 timestamp,
    bytes32 gameDataHash,  // Hash of gameplay metrics
    bytes calldata signature
) external nonReentrant {
    // Verify signature is recent (prevent replay)
    require(block.timestamp <= timestamp + 5 minutes, "Signature expired");
    
    // Reconstruct message and verify signer
    bytes32 messageHash = keccak256(abi.encodePacked(
        msg.sender,
        knightIds,
        dungeonId,
        timestamp,
        gameDataHash
    ));
    
    address signer = recoverSigner(messageHash, signature);
    require(signer == trustedSigner, "Invalid signature");
    
    // ... rest of reward logic (unchanged)
}

function recoverSigner(bytes32 hash, bytes memory sig) internal pure returns (address) {
    // ECDSA signature recovery
}
```

#### 2. Backend API (Vercel Serverless Function)

**File:** `/api/sign-completion.js`

```javascript
import { ethers } from 'ethers';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    const { playerAddress, knightIds, dungeonId, gameData } = req.body;
    
    // VALIDATION: Ensure actual gameplay occurred
    if (gameData.timeSpent < 30) {
        return res.status(400).json({ error: 'Game too fast (min 30s)' });
    }
    
    if (gameData.lootCollected < 5) {
        return res.status(400).json({ error: 'Insufficient loot collected' });
    }
    
    if (gameData.enemiesKilled < 3) {
        return res.status(400).json({ error: 'Insufficient enemies killed' });
    }
    
    // Create game data hash
    const gameDataHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
            ['uint256', 'uint256', 'uint256'],
            [gameData.timeSpent, gameData.lootCollected, gameData.enemiesKilled]
        )
    );
    
    // Sign completion
    const signerWallet = new ethers.Wallet(process.env.SIGNER_PRIVATE_KEY);
    const timestamp = Math.floor(Date.now() / 1000);
    
    const messageHash = ethers.utils.solidityKeccak256(
        ['address', 'uint256[]', 'uint256', 'uint256', 'bytes32'],
        [playerAddress, knightIds, dungeonId, timestamp, gameDataHash]
    );
    
    const signature = await signerWallet.signMessage(
        ethers.utils.arrayify(messageHash)
    );
    
    res.json({ timestamp, gameDataHash, signature });
}
```

#### 3. Frontend Changes

**Update `game.js`** - Track gameplay metrics:
```javascript
class Game {
    constructor() {
        this.startTime = null;
        this.lootCollected = 0;
        this.enemiesKilled = 0;
    }
    
    startDungeon() {
        this.startTime = Date.now();
        this.lootCollected = 0;
        this.enemiesKilled = 0;
    }
    
    onLootCollected() {
        this.lootCollected++;
    }
    
    onEnemyKilled() {
        this.enemiesKilled++;
    }
    
    getGameData() {
        return {
            timeSpent: Math.floor((Date.now() - this.startTime) / 1000),
            lootCollected: this.lootCollected,
            enemiesKilled: this.enemiesKilled
        };
    }
}
```

**Update `dungeon-session.js`** - Request signature before claiming:
```javascript
async claimAllRewards() {
    for (const run of this.pendingRuns) {
        // Request signature from backend
        const response = await fetch('/api/sign-completion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                playerAddress: window.walletManager.address,
                knightIds: run.knightIds,
                dungeonId: run.dungeonId,
                gameData: run.gameData  // Include gameplay metrics
            })
        });
        
        const { timestamp, gameDataHash, signature } = await response.json();
        
        // Submit to contract with signature
        const tx = await gameContract.completeDungeons(
            run.knightIds,
            run.dungeonId,
            timestamp,
            gameDataHash,
            signature
        );
        
        await tx.wait();
    }
}
```

#### 4. Vercel Configuration

**Update `vercel.json`:**
```json
{
  "version": 2,
  "builds": [
    { "src": "api/**/*.js", "use": "@vercel/node" },
    { "src": "**/*.html", "use": "@vercel/static" },
    { "src": "**/*.js", "use": "@vercel/static" },
    { "src": "**/*.css", "use": "@vercel/static" },
    { "src": "**/*.png", "use": "@vercel/static" }
  ]
}
```

**Environment Variables (Vercel Dashboard):**
```
SIGNER_PRIVATE_KEY=0x... (generate new wallet just for signing)
```

#### 5. Deploy New Signer Wallet
```bash
# Generate new wallet
node -e "console.log(require('ethers').Wallet.createRandom().privateKey)"

# Add public address to contract
await gameContractV3.setTrustedSigner("0x...")
```

### Alternative: Commit-Reveal Pattern (No Backend)

If backend is not an option:

**Pros:**
- Fully decentralized
- No operational costs
- No single point of failure

**Cons:**
- 2 transactions (2× gas cost)
- Only enforces minimum time (60s), not actual gameplay quality
- Bot can still: commit → wait 60s → reveal (without playing)

**Implementation:** See contract patterns in this file for details.

---

## Security Considerations

### Backend Approach
- ✅ Server validates actual gameplay
- ✅ 1 transaction only
- ❌ Centralized (trusted signer)
- ❌ If backend compromised, attacker can mint signatures

### Commit-Reveal Approach
- ✅ Fully decentralized
- ✅ Trustless
- ❌ 2 transactions (expensive)
- ❌ Only enforces time, not gameplay quality
- ❌ Bot can commit → wait → reveal

### Hybrid Approach (Optional Signature)
```solidity
// Time lock always enforced
// Signature optional for bonus rewards
if (signature.length > 0) {
    verifySignature(...);
    reward = reward * 110 / 100;  // +10% bonus
}
```

---

## Metrics to Validate

**Minimum Requirements:**
- Time spent: ≥ 30 seconds
- Loot collected: ≥ 5 items (chests + gold)
- Enemies killed: ≥ 3 monsters

**Detection Patterns:**
- Impossible speed (cleared 60 items in 10 seconds)
- Same exact time every run (bot pattern)
- Zero variance in gameplay metrics

---

## Status: NOT IMPLEMENTED

Current V2 contract (`0xd6D40B6C0D22f43866F6FBab3cf0DddDba05cFd5`) has:
- ✅ Daily run limits
- ✅ 30-second cooldown
- ✅ NFT ownership verification
- ❌ NO gameplay verification

**Risk Level:** Medium
- Treasury can be drained by bots
- Limited to daily caps (3-5 runs per knight)
- Cooldown slows abuse but doesn't prevent it

**Next Steps:** Implement backend signature verification when ready to deploy V3.
