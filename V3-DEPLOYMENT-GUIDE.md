# DungeonKnightsGameV3 - Deployment Guide

## 🎯 What V3 Fixes

### 1. **Batch Claims** (Main Feature)
- ✅ Play 5 dungeons → Claim all in **1 transaction**
- ✅ No more waiting 30 seconds between claims
- ✅ 5× cheaper gas costs when claiming multiple runs

### 2. **Gameplay Verification** (Security)
- ✅ Backend signs each completion (validates actual gameplay)
- ✅ Verifies minimum play time (30 seconds)
- ✅ Can validate loot collected, enemies killed, etc.
- ✅ Prevents bots from claiming without playing

### 3. **No More Cooldown Issues**
- ✅ Cooldown removed from claim logic
- ✅ All validation happens via backend signature
- ✅ Claim anytime after completing dungeons

---

## 📊 Transaction Comparison

| Scenario | V2 (Current) | V3 (New) | Savings |
|----------|--------------|----------|---------|
| **Complete 1 dungeon** | 1 TX (claim) | 1 TX (claim) | Same |
| **Complete 5 dungeons** | 5 TX (claim each) | 1 TX (claim all) | **80% less** |
| **Complete 10 dungeons** | 10 TX (claim each) | 1 TX (claim all) | **90% less** |

---

## 🔧 How It Works

### Player Flow:
```
1. Play Dungeon 1 → No transaction
2. Play Dungeon 2 → No transaction
3. Play Dungeon 3 → No transaction
4. Play Dungeon 4 → No transaction
5. Play Dungeon 5 → No transaction

6. Click "Claim All" → Request signatures from backend
7. Backend validates all 5 games and signs
8. Submit 1 transaction with all 5 completions + signatures
9. Get rewards for all 5 dungeons at once! 🎉
```

### Backend Validation (per completion):
```javascript
// Backend checks before signing:
✓ Game duration >= 30 seconds
✓ Loot collected >= 5 items
✓ Enemies killed >= 3
✓ Knights actually deployed
✓ Timestamp is recent (within 1 hour)
```

---

## 🔐 Security Features

### 1. **Signature Verification**
- Backend signs: `keccak256(player, knightIds, dungeonId, timestamp, duration, gameDataHash)`
- Contract verifies signature from `trustedSigner` address
- Each signature can only be used once (replay protection)

### 2. **Time Validation**
- Minimum game duration: 30 seconds
- Completion timestamp must be within 1 hour (prevents old replays)
- Future timestamps rejected

### 3. **Ownership Checks**
- Must own all knights at claim time
- Daily run limits enforced per knight
- Rarity-based rewards calculated on-chain

---

## 📝 Contract Changes from V2

### Removed:
- ❌ `RUN_COOLDOWN` (30 second wait between claims)
- ❌ `lastRunTime` tracking per knight
- ❌ Single `completeDungeons()` function

### Added:
- ✅ `trustedSigner` address (backend wallet)
- ✅ `batchClaimRewards()` - claim multiple runs at once
- ✅ `CompletionData` struct with gameplay metadata
- ✅ `usedSignatures` mapping (replay protection)
- ✅ Signature verification with ECDSA
- ✅ `setTrustedSigner()` admin function

### Modified:
- ✅ `MAX_BATCH` increased to 50 (was 15)
- ✅ Events include completion timestamp
- ✅ Better error messages

---

## 🚀 Deployment Steps

### 1. **Generate Signer Wallet**
```javascript
// Generate new wallet for backend signing
const signerWallet = ethers.Wallet.createRandom();
console.log('Signer Address:', signerWallet.address);
console.log('Signer Private Key:', signerWallet.privateKey);
// Save private key to backend environment variable!
```

### 2. **Deploy Contract**
```javascript
// Using Remix or Hardhat
constructor parameters:
- _knightNFT: 0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512
- _dngToken:  0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910
- _trustedSigner: [signer wallet address from step 1]
```

### 3. **Fund Contract**
```javascript
// Approve DNG tokens
await dngToken.approve(gameContractV3.address, ethers.utils.parseEther('1000000'));

// Fund contract
await gameContractV3.fundContract(ethers.utils.parseEther('1000000'));
```

### 4. **Update Frontend**
```javascript
// Update contract-addresses.js
GAME_CONTRACT: '0x...' // V3 address

// Update dungeon-session.js
// - Add signature request logic
// - Use batchClaimRewards() instead of completeDungeons()
```

### 5. **Setup Backend Signer**
```javascript
// Vercel serverless function: /api/sign-completion.js
// - Validate gameplay metrics
// - Sign with signer private key
// - Return signature to frontend
```

---

## 🔗 Backend API Endpoint

### `/api/sign-completion` (POST)

**Request:**
```json
{
  "playerAddress": "0x038d75a...",
  "completions": [
    {
      "knightIds": [10, 11, 12, 13, 22],
      "dungeonId": 2,
      "completedAt": 1736789123,
      "duration": 85,
      "gameData": {
        "lootCollected": 12,
        "enemiesKilled": 8,
        "chestsOpened": 3
      }
    }
  ]
}
```

**Response:**
```json
{
  "signatures": [
    "0x1a2b3c4d5e6f..."
  ],
  "gameDataHashes": [
    "0x7f8e9d6c5b4a..."
  ]
}
```

**Validation Logic:**
```javascript
for (const completion of completions) {
  // Validate
  if (completion.duration < 30) {
    throw new Error('Game too fast');
  }
  if (completion.gameData.lootCollected < 5) {
    throw new Error('Not enough loot');
  }
  if (completion.gameData.enemiesKilled < 3) {
    throw new Error('Not enough enemies killed');
  }
  
  // Hash game data
  const gameDataHash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['uint256', 'uint256', 'uint256'],
      [
        completion.gameData.lootCollected,
        completion.gameData.enemiesKilled,
        completion.gameData.chestsOpened
      ]
    )
  );
  
  // Sign
  const messageHash = ethers.utils.solidityKeccak256(
    ['address', 'uint256[]', 'uint256', 'uint256', 'uint256', 'bytes32'],
    [
      playerAddress,
      completion.knightIds,
      completion.dungeonId,
      completion.completedAt,
      completion.duration,
      gameDataHash
    ]
  );
  
  const signature = await signerWallet.signMessage(
    ethers.utils.arrayify(messageHash)
  );
  
  signatures.push(signature);
  gameDataHashes.push(gameDataHash);
}
```

---

## 🧪 Testing Checklist

### Contract Tests:
- [ ] Deploy contract with correct parameters
- [ ] Fund contract with DNG tokens
- [ ] Verify trustedSigner is set correctly
- [ ] Test single completion claim
- [ ] Test batch claim (2 completions)
- [ ] Test batch claim (5 completions)
- [ ] Test invalid signature rejection
- [ ] Test signature replay protection
- [ ] Test daily run limits
- [ ] Test ownership verification
- [ ] Test old timestamp rejection
- [ ] Test future timestamp rejection
- [ ] Test game duration validation

### Backend Tests:
- [ ] Generate and sign valid completion
- [ ] Reject too-fast games
- [ ] Reject insufficient loot
- [ ] Reject insufficient kills
- [ ] Handle multiple completions
- [ ] Return correct signatures

### Frontend Tests:
- [ ] Store completions locally
- [ ] Request signatures from backend
- [ ] Submit batch claim transaction
- [ ] Handle signature request failure
- [ ] Handle transaction failure
- [ ] Update UI after successful claim
- [ ] Show loading states

---

## 🔄 Migration from V2 to V3

### For Players:
1. Any pending runs in V2 must be claimed first
2. V2 contract will remain active for claims
3. New completions go to V3
4. Knights can use either contract (separate daily limits)

### For Deployment:
1. Deploy V3 contract
2. Fund V3 with new DNG allocation
3. Update frontend to use V3 address
4. Keep V2 active for pending claims
5. Monitor both contracts for 7 days
6. Eventually pause V2 after all claims processed

---

## 💰 Gas Cost Estimates

| Operation | V2 Gas | V3 Gas | V3 Batch (5 runs) |
|-----------|--------|--------|-------------------|
| **Single claim** | ~150k | ~180k | N/A |
| **5 claims** | ~750k | N/A | ~350k |
| **10 claims** | ~1.5M | N/A | ~600k |

**Savings with batching: 50-60% less gas**

---

## ⚠️ Important Notes

1. **Backend is critical** - If backend goes down, players can't claim
   - Solution: Add emergency mode that bypasses signatures temporarily
   
2. **Signer private key security** - Store in secure environment variables
   - Never commit to Git
   - Use separate wallet just for signing
   - Can rotate signer with `setTrustedSigner()`

3. **Signature expiry** - Completions older than 1 hour are rejected
   - Players must claim within 1 hour of completing
   - Or we can increase this window

4. **Daily limits still apply** - Each knight has X runs per day
   - Unchanged from V2
   - Validated at claim time

---

## 🎯 Next Steps

1. ✅ Review contract code
2. ⬜ Generate signer wallet
3. ⬜ Deploy V3 contract on testnet
4. ⬜ Implement backend signing API
5. ⬜ Update frontend to use V3
6. ⬜ Test full flow end-to-end
7. ⬜ Deploy to mainnet
8. ⬜ Fund V3 contract with DNG

---

## 📞 Support

- Contract: `DungeonKnightsGameV3.sol`
- Audit: Recommended before mainnet deployment
- Backend: Vercel serverless function required
- Monitoring: Watch for signature validation failures
