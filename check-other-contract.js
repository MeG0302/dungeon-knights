// Check if the other game contract has the correct NFT
const { ethers } = require('ethers');

const RPC_URL = 'https://rpc.testnet.chain.robinhood.com';
const OTHER_GAME = '0xb4cee9bA94660BDB19C3a933d71d94623c0B1ec5';
const CORRECT_NFT = '0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512';
const CORRECT_DNG = '0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910';

const ABI = [
    "function knightNFT() view returns (address)",
    "function dngToken() view returns (address)",
    "function dungeons(uint256) view returns (uint256 minCompletionTime, uint256 maxRewardPerRun, bool active)"
];

const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];

async function checkOtherContract() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(OTHER_GAME, ABI, provider);
    
    console.log('📊 Checking contract:', OTHER_GAME);
    
    const nft = await contract.knightNFT();
    const dng = await contract.dngToken();
    const dungeon = await contract.dungeons(1);
    
    console.log('\n✅ Contract Configuration:');
    console.log('  Knight NFT:', nft);
    console.log('  DNG Token:', dng);
    console.log('  Min time:', dungeon.minCompletionTime.toString(), 'seconds');
    console.log('  Max reward:', ethers.formatEther(dungeon.maxRewardPerRun), 'DNG');
    console.log('  Active:', dungeon.active);
    
    // Check if it has the correct addresses
    const nftCorrect = nft.toLowerCase() === CORRECT_NFT.toLowerCase();
    const dngCorrect = dng.toLowerCase() === CORRECT_DNG.toLowerCase();
    
    console.log('\n🔍 Address Check:');
    console.log('  NFT matches:', nftCorrect ? '✅' : '❌');
    console.log('  DNG matches:', dngCorrect ? '✅' : '❌');
    
    if (nftCorrect && dngCorrect) {
        console.log('\n🎉 THIS CONTRACT HAS THE CORRECT ADDRESSES!');
        console.log('💡 Update dungeon-session.js to use:', OTHER_GAME);
        
        // Check if it's funded
        const tokenContract = new ethers.Contract(dng, ERC20_ABI, provider);
        const balance = await tokenContract.balanceOf(OTHER_GAME);
        console.log('\n💰 Contract balance:', ethers.formatEther(balance), 'DNG');
        
        if (balance > 0n) {
            console.log('✅ Contract is funded and ready to use!');
        } else {
            console.log('⚠️  Contract needs to be funded with DNG tokens');
        }
    } else {
        console.log('\n❌ This contract also has wrong addresses');
        console.log('💡 Need to redeploy a new game contract');
    }
}

checkOtherContract().catch(console.error);
