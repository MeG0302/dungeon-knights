const { ethers } = require('ethers');
require('dotenv').config({ path: '.env.local' });
const addresses = require('./contract-addresses');

// Configuration
const RPC_URL = addresses.RPC_URL;
const CHAIN_ID = addresses.CHAIN_ID;
const GAME_CONTRACT_ADDRESS = addresses.GAME_CONTRACT;

const GAME_ABI = [
    'function dungeons(uint256) view returns (uint256 minCompletionTime, uint256 maxRewardPerRun, bool active)'
];

async function main() {
    console.log('\n🔍 Checking Contract Configuration...\n');

    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL, {
            chainId: CHAIN_ID,
            name: 'Robinhood Chain Testnet'
        });

        const gameContract = new ethers.Contract(
            GAME_CONTRACT_ADDRESS,
            GAME_ABI,
            provider
        );

        // Check dungeon #1 config (default dungeon)
        console.log('📋 Dungeon #1 Current Config:');
        const config = await gameContract.dungeons(1);
        console.log('   Min Completion Time:', config.minCompletionTime.toString(), 'seconds');
        console.log('   Max Reward Per Run:', ethers.formatEther(config.maxRewardPerRun), '$DNG');
        console.log('   Active:', config.active);

        console.log('\n📊 Game Requirements:');
        console.log('   Min reward: 10 $DNG (1 Common knight)');
        console.log('   Max reward: 2,250 $DNG (15 Legendary knights)');
        
        const currentMax = parseFloat(ethers.formatEther(config.maxRewardPerRun));
        
        if (currentMax < 2250) {
            console.log('\n⚠️  CONTRACT MAX IS TOO LOW!');
            console.log(`   Current: ${currentMax} $DNG`);
            console.log(`   Required: 2,250 $DNG`);
            console.log('\n💡 Run update-dungeon-config.js to fix this!');
        } else {
            console.log('\n✅ Contract configuration is correct!');
        }

    } catch (error) {
        console.error('\n❌ Failed:', error.message);
        process.exit(1);
    }
}

main();
