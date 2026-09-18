// Check config of both contracts
const { ethers } = require('ethers');

const RPC_URL = 'https://rpc.testnet.chain.robinhood.com';
const OLD_CONTRACT = '0x45B905f66789bED9A1e9FF47f5429aF41A370E17'; // In dungeon-session.js
const NEW_CONTRACT = '0xb4cee9bA94660BDB19C3a933d71d94623c0B1ec5'; // In deployed-contracts.json

const ABI = [
    "function dungeons(uint256) view returns (uint256 minCompletionTime, uint256 maxRewardPerRun, bool active)",
    "function knightNFT() view returns (address)",
    "function dngToken() view returns (address)"
];

async function checkContracts() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    
    console.log('📊 Checking OLD contract:', OLD_CONTRACT);
    try {
        const oldContract = new ethers.Contract(OLD_CONTRACT, ABI, provider);
        const dungeon = await oldContract.dungeons(1);
        const nft = await oldContract.knightNFT();
        const token = await oldContract.dngToken();
        
        console.log('✅ OLD Contract works:');
        console.log('  Min time:', dungeon.minCompletionTime.toString(), 'seconds');
        console.log('  Max reward:', ethers.formatEther(dungeon.maxRewardPerRun), 'DNG');
        console.log('  Active:', dungeon.active);
        console.log('  Knight NFT:', nft);
        console.log('  DNG Token:', token);
    } catch (error) {
        console.log('❌ OLD contract error:', error.message);
    }
    
    console.log('\n📊 Checking NEW contract:', NEW_CONTRACT);
    try {
        const newContract = new ethers.Contract(NEW_CONTRACT, ABI, provider);
        const dungeon = await newContract.dungeons(1);
        const nft = await newContract.knightNFT();
        const token = await newContract.dngToken();
        
        console.log('✅ NEW Contract works:');
        console.log('  Min time:', dungeon.minCompletionTime.toString(), 'seconds');
        console.log('  Max reward:', ethers.utils.formatEther(dungeon.maxRewardPerRun), 'DNG');
        console.log('  Active:', dungeon.active);
        console.log('  Knight NFT:', nft);
        console.log('  DNG Token:', token);
    } catch (error) {
        console.log('❌ NEW contract error:', error.message);
    }
}

checkContracts().catch(console.error);
