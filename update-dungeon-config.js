const { ethers } = require('ethers');
require('dotenv').config({ path: '.env.local' });

// Configuration
const RPC_URL = 'https://rpc.testnet.chain.robinhood.com';
const CHAIN_ID = 46630;
const GAME_CONTRACT_ADDRESS = '0x45B905f66789bED9A1e9FF47f5429aF41A370E17';

const GAME_ABI = [
    'function setDungeon(uint256 dungeonId, uint256 minTime, uint256 maxReward, bool active) external',
    'function dungeons(uint256) view returns (uint256 minCompletionTime, uint256 maxRewardPerRun, bool active)'
];

async function main() {
    console.log('\n🔧 Updating Dungeon Configuration...\n');

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey || privateKey === 'your_private_key_here') {
        console.error('❌ PRIVATE_KEY not set in .env.local');
        process.exit(1);
    }

    try {
        // Connect
        const provider = new ethers.JsonRpcProvider(RPC_URL, {
            chainId: CHAIN_ID,
            name: 'Robinhood Chain Testnet'
        });

        const wallet = new ethers.Wallet(privateKey, provider);
        console.log('✅ Connected:', wallet.address);

        const gameContract = new ethers.Contract(
            GAME_CONTRACT_ADDRESS,
            GAME_ABI,
            wallet
        );

        // Check current config
        console.log('\n📋 Current Dungeon #1 Config:');
        const current = await gameContract.dungeons(1);
        console.log('   Min Time:', current.minCompletionTime.toString(), 'seconds');
        console.log('   Max Reward:', ethers.formatEther(current.maxRewardPerRun), 'DNG');
        console.log('   Active:', current.active);

        // Update to support 15 Legendary knights (2,250 DNG max)
        console.log('\n🔨 Updating configuration...');
        console.log('   New Min Time: 30 seconds');
        console.log('   New Max Reward: 2,250 DNG (was 100)');

        const tx = await gameContract.setDungeon(
            1,                                      // dungeonId
            30,                                     // 30 seconds minimum
            ethers.parseEther('2250'),             // 2,250 DNG max (15 Legendary × 150)
            true                                    // active
        );

        console.log('⏳ Transaction sent:', tx.hash);
        await tx.wait();
        console.log('✅ Configuration updated!');

        // Verify
        const updated = await gameContract.dungeons(1);
        console.log('\n✨ New Dungeon #1 Config:');
        console.log('   Min Time:', updated.minCompletionTime.toString(), 'seconds');
        console.log('   Max Reward:', ethers.formatEther(updated.maxRewardPerRun), 'DNG');
        console.log('   Active:', updated.active);

        console.log('\n🎮 You can now complete dungeons in 30+ seconds!\n');

    } catch (error) {
        console.error('\n❌ Failed:', error.message);
        process.exit(1);
    }
}

main();
