// Update the game contract to use the correct NFT contract
const { ethers } = require('ethers');
require('dotenv').config({ path: '.env.local' });

const RPC_URL = 'https://rpc.testnet.chain.robinhood.com';
const GAME_CONTRACT = '0x45B905f66789bED9A1e9FF47f5429aF41A370E17';
const CORRECT_NFT = '0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512';

const GAME_ABI = [
    "function knightNFT() view returns (address)",
    "function owner() view returns (address)",
    // Most contracts don't have setKnightNFT, check if yours does
    "function setKnightNFT(address) external"
];

async function fixNFTAddress() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const privateKey = process.env.PRIVATE_KEY;
    
    if (!privateKey) {
        console.error('❌ Add PRIVATE_KEY to .env.local');
        process.exit(1);
    }
    
    const wallet = new ethers.Wallet(privateKey, provider);
    const gameContract = new ethers.Contract(GAME_CONTRACT, GAME_ABI, wallet);
    
    console.log('📊 Current state:');
    const currentNFT = await gameContract.knightNFT();
    console.log('  Current NFT address:', currentNFT);
    console.log('  Correct NFT address:', CORRECT_NFT);
    
    if (currentNFT.toLowerCase() === CORRECT_NFT.toLowerCase()) {
        console.log('✅ NFT address is already correct!');
        return;
    }
    
    // Check if you're the owner
    try {
        const owner = await gameContract.owner();
        console.log('\n  Contract owner:', owner);
        console.log('  Your address:', wallet.address);
        
        if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
            console.log('❌ You are not the contract owner!');
            console.log('💡 You need to use the deployer wallet');
            return;
        }
    } catch (error) {
        console.log('⚠️  Could not check owner');
    }
    
    console.log('\n🔧 Updating NFT address...');
    try {
        const tx = await gameContract.setKnightNFT(CORRECT_NFT);
        console.log('📝 Transaction sent:', tx.hash);
        await tx.wait();
        console.log('✅ NFT address updated!');
        
        const newNFT = await gameContract.knightNFT();
        console.log('✅ Verified:', newNFT);
    } catch (error) {
        console.log('❌ Update failed:', error.message);
        console.log('\n💡 The contract might not have a setKnightNFT function');
        console.log('💡 You may need to redeploy the game contract with the correct NFT address');
    }
}

fixNFTAddress().catch(console.error);
