// Simulate the exact claim that's failing
const { ethers } = require('ethers');
require('dotenv').config({ path: '.env.local' });

const RPC_URL = 'https://rpc.testnet.chain.robinhood.com';
const GAME_CONTRACT = '0x45B905f66789bED9A1e9FF47f5429aF41A370E17';
const KNIGHT_NFT = '0xe27106e63920bAfa0Fac0e05f1080Eb6b1D9f934';

const GAME_ABI = [
    "function completeDungeon(uint256 knightId, uint256 dungeonId, uint256 timeSpent, uint256 reward, uint256 timestamp, bytes signature) external",
    "function lastClaimTime(uint256) view returns (uint256)",
    "function dungeons(uint256) view returns (uint256 minCompletionTime, uint256 maxRewardPerRun, bool active)"
];

const NFT_ABI = [
    "function ownerOf(uint256) view returns (address)"
];

async function testClaim() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const privateKey = process.env.PRIVATE_KEY;
    
    if (!privateKey) {
        console.error('❌ Add PRIVATE_KEY to .env.local');
        process.exit(1);
    }
    
    const wallet = new ethers.Wallet(privateKey, provider);
    const gameContract = new ethers.Contract(GAME_CONTRACT, GAME_ABI, provider);
    const nftContract = new ethers.Contract(KNIGHT_NFT, NFT_ABI, provider);
    
    // Test parameters from your failed transaction
    const knightId = 10;
    const dungeonId = 1;
    const timeSpent = 180; // 3 minutes
    const reward = ethers.parseEther('460');
    const timestamp = Math.floor(Date.now() / 1000); // Current time
    
    console.log('📊 Testing claim with:');
    console.log('  Knight ID:', knightId);
    console.log('  Dungeon ID:', dungeonId);
    console.log('  Time Spent:', timeSpent, 'seconds');
    console.log('  Reward:', ethers.formatEther(reward), 'DNG');
    console.log('  Timestamp:', timestamp);
    console.log('  Your Address:', wallet.address);
    
    // Check ownership
    console.log('\n🔍 Checking knight ownership...');
    try {
        const owner = await nftContract.ownerOf(knightId);
        console.log('  Owner:', owner);
        console.log('  Your wallet:', wallet.address);
        
        if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
            console.log('❌ You do not own Knight #' + knightId);
            return;
        }
        console.log('✅ You own this knight');
    } catch (error) {
        console.log('❌ Knight does not exist or error:', error.message);
        return;
    }
    
    // Check last claim time
    console.log('\n🔍 Checking last claim time...');
    const lastClaim = await gameContract.lastClaimTime(knightId);
    const now = Math.floor(Date.now() / 1000);
    const timeSince = now - Number(lastClaim);
    console.log('  Last claim:', lastClaim.toString(), `(${timeSince}s ago)`);
    
    if (timeSince < 60) {
        console.log(`❌ Too soon! Need to wait ${60 - timeSince} more seconds`);
        return;
    }
    console.log('✅ Enough time has passed');
    
    // Check dungeon config
    console.log('\n🔍 Checking dungeon config...');
    const dungeon = await gameContract.dungeons(dungeonId);
    console.log('  Min time:', dungeon.minCompletionTime.toString(), 'seconds');
    console.log('  Max reward:', ethers.formatEther(dungeon.maxRewardPerRun), 'DNG');
    console.log('  Active:', dungeon.active);
    
    if (timeSpent < Number(dungeon.minCompletionTime)) {
        console.log('❌ Completion too fast!');
        return;
    }
    if (reward > dungeon.maxRewardPerRun) {
        console.log('❌ Reward too high!');
        return;
    }
    if (!dungeon.active) {
        console.log('❌ Dungeon not active!');
        return;
    }
    console.log('✅ All checks passed');
    
    // Create signature
    console.log('\n✍️  Creating signature...');
    const messageHash = ethers.solidityPackedKeccak256(
        ['uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'address'],
        [knightId, dungeonId, timeSpent, reward, timestamp, wallet.address]
    );
    
    const signature = await wallet.signMessage(ethers.getBytes(messageHash));
    console.log('  Signature:', signature);
    
    // Try to estimate gas
    console.log('\n⏳ Estimating gas...');
    try {
        const gameWithSigner = gameContract.connect(wallet);
        const gasEstimate = await gameWithSigner.completeDungeon.estimateGas(
            knightId,
            dungeonId,
            timeSpent,
            reward,
            timestamp,
            signature
        );
        console.log('  Estimated gas:', gasEstimate.toString());
        console.log('✅ Transaction should work!');
        
        console.log('\n💡 Ready to submit? (Not submitting automatically)');
        
    } catch (error) {
        console.log('❌ Gas estimation failed!');
        console.log('  Error:', error.message);
        
        if (error.message.includes('Invalid signature')) {
            console.log('\n🔍 Signature verification failed!');
        } else if (error.message.includes('Not your knight')) {
            console.log('\n🔍 Ownership check failed!');
        } else if (error.message.includes('Claim too soon')) {
            console.log('\n🔍 Rate limit hit!');
        } else {
            console.log('\n🔍 Unknown error - check contract state');
        }
    }
}

testClaim().catch(console.error);
