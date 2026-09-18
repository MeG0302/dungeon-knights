/**
 * Test V3 Contract - Verify deployment and basic functions
 * Run with: node test-v3-contract.js
 */

const { ethers } = require('ethers');
const CONTRACT_ADDRESSES = require('./contract-addresses.js');

const V3_ABI = [
    'function batchClaimRewards((uint256[],uint256)[] runs) external',
    'function claimRewards(uint256[] calldata knightIds, uint256 dungeonId) external',
    'function runsRemaining(uint256 knightId) view returns (uint8)',
    'function getKnightStats(uint256 knightId) view returns (uint256, uint8)',
    'function treasuryBalance() view returns (uint256)',
    'function rarityReward(uint256 rarity) view returns (uint256)',
    'function dailyCap(uint256 rarity) view returns (uint8)',
    'function currentDayIndex() view returns (uint32)',
    'function knightNFT() view returns (address)',
    'function dngToken() view returns (address)',
    'function owner() view returns (address)',
    'function paused() view returns (bool)'
];

async function testV3Contract() {
    console.log('🧪 Testing V3 Contract...\n');
    console.log('📍 Contract Address:', CONTRACT_ADDRESSES.GAME_CONTRACT);
    console.log('🌐 Network:', CONTRACT_ADDRESSES.RPC_URL);
    console.log('');

    const provider = new ethers.JsonRpcProvider(CONTRACT_ADDRESSES.RPC_URL);
    const contract = new ethers.Contract(
        CONTRACT_ADDRESSES.GAME_CONTRACT,
        V3_ABI,
        provider
    );

    try {
        // 1. Verify contract exists
        console.log('1️⃣ Checking contract deployment...');
        const code = await provider.getCode(CONTRACT_ADDRESSES.GAME_CONTRACT);
        if (code === '0x') {
            console.error('❌ Contract not found at this address!');
            return;
        }
        console.log('✅ Contract deployed\n');

        // 2. Check owner
        console.log('2️⃣ Checking owner...');
        const owner = await contract.owner();
        console.log('👤 Owner:', owner);
        console.log('');

        // 3. Check configuration
        console.log('3️⃣ Checking configuration...');
        const knightNFT = await contract.knightNFT();
        const dngToken = await contract.dngToken();
        const paused = await contract.paused();
        console.log('🎮 Knight NFT:', knightNFT);
        console.log('💰 DNG Token:', dngToken);
        console.log('⏸️  Paused:', paused);
        console.log('');

        // 4. Check rarity rewards
        console.log('4️⃣ Checking rarity rewards...');
        const rarityNames = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
        for (let i = 0; i < 5; i++) {
            const reward = await contract.rarityReward(i);
            const cap = await contract.dailyCap(i);
            console.log(`  ${rarityNames[i]}: ${ethers.formatEther(reward)} DNG/run, ${cap} runs/day`);
        }
        console.log('');

        // 5. Check treasury balance
        console.log('5️⃣ Checking treasury balance...');
        const balance = await contract.treasuryBalance();
        console.log('💎 Treasury:', ethers.formatEther(balance), 'DNG');
        if (balance === 0n) {
            console.log('⚠️  WARNING: Treasury is empty! Contract needs to be funded.');
        }
        console.log('');

        // 6. Check current day index
        console.log('6️⃣ Checking daily reset system...');
        const dayIndex = await contract.currentDayIndex();
        console.log('📅 Current day index:', dayIndex.toString());
        console.log('ℹ️  Day resets at 12:00 PM UTC');
        console.log('');

        // 7. Test knight stats (using a sample knight ID)
        console.log('7️⃣ Testing knight stats query...');
        try {
            const testKnightId = 1; // Test with knight #1
            const [totalClaimed, remaining] = await contract.getKnightStats(testKnightId);
            console.log(`  Knight #${testKnightId}:`);
            console.log(`    Total claimed: ${ethers.formatEther(totalClaimed)} DNG`);
            console.log(`    Runs remaining today: ${remaining}`);
        } catch (err) {
            console.log('  ℹ️  Unable to query knight stats (may not exist yet)');
        }
        console.log('');

        // Summary
        console.log('═══════════════════════════════════════════');
        console.log('✅ V3 Contract Test Complete!');
        console.log('═══════════════════════════════════════════');
        console.log('');
        console.log('📋 Next Steps:');
        if (balance === 0n) {
            console.log('  1. Fund the contract with DNG tokens');
            console.log('  2. Test batch claims in the game');
        } else {
            console.log('  1. Test batch claims in the game');
            console.log('  2. Verify rewards are distributed correctly');
        }
        console.log('  3. Deploy frontend to production');
        console.log('');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        if (error.message.includes('network')) {
            console.error('💡 Check your RPC URL and network connection');
        }
    }
}

// Run tests
testV3Contract()
    .then(() => process.exit(0))
    .catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
