// Update maxReward on the deployed contract
const ethers = require('ethers');

const GAME_CONTRACT = '0x45B905f66789bED9A1e9FF47f5429aF41A370E17';
const RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';

const ABI = [
    "function updateDungeon(uint256 dungeonId, uint256 minTime, uint256 maxReward, bool active) external",
    "function dungeons(uint256) view returns (uint256 minCompletionTime, uint256 maxRewardPerRun, bool active)"
];

async function updateMaxReward() {
    const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
    const privateKey = process.env.PRIVATE_KEY || '0x' + process.argv[2];
    
    if (!privateKey || privateKey === '0x') {
        console.error('❌ Usage: node update-max-reward.js YOUR_PRIVATE_KEY');
        console.error('❌ Or: PRIVATE_KEY=0x... node update-max-reward.js');
        process.exit(1);
    }
    
    const wallet = new ethers.Wallet(privateKey, provider);
    const contract = new ethers.Contract(GAME_CONTRACT, ABI, wallet);
    
    console.log('📊 Current dungeon config:');
    const currentConfig = await contract.dungeons(1);
    console.log(`  Min time: ${currentConfig.minCompletionTime} seconds`);
    console.log(`  Max reward: ${ethers.utils.formatEther(currentConfig.maxRewardPerRun)} DNG`);
    console.log(`  Active: ${currentConfig.active}`);
    
    console.log('\n🔄 Updating max reward to 500 DNG...');
    
    const tx = await contract.updateDungeon(
        1, // dungeonId
        300, // 5 minutes minimum
        ethers.utils.parseEther('500'), // 500 DNG max
        true // active
    );
    
    console.log('📝 Transaction sent:', tx.hash);
    await tx.wait();
    console.log('✅ Max reward updated to 500 DNG!');
    
    // Verify
    const newConfig = await contract.dungeons(1);
    console.log('\n📊 New config:');
    console.log(`  Max reward: ${ethers.utils.formatEther(newConfig.maxRewardPerRun)} DNG`);
}

updateMaxReward().catch(console.error);
