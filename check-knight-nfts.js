// Check which NFT contract has your knights
const { ethers } = require('ethers');
require('dotenv').config({ path: '.env.local' });

const RPC_URL = 'https://rpc.testnet.chain.robinhood.com';
const YOUR_ADDRESS = '0x038d75aDb74d8e5Db82E6c6797f90dCdF82ef4C9';

// Two possible NFT contracts
const OLD_NFT = '0xe27106e63920bAfa0Fac0e05f1080Eb6b1D9f934'; // From game contract
const NEW_NFT = '0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512'; // From deployed-contracts.json

const NFT_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function tokenOfOwnerByIndex(address, uint256) view returns (uint256)",
    "function ownerOf(uint256) view returns (address)"
];

async function checkNFTs() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    
    console.log('🔍 Checking OLD NFT contract:', OLD_NFT);
    try {
        const oldContract = new ethers.Contract(OLD_NFT, NFT_ABI, provider);
        const balance = await oldContract.balanceOf(YOUR_ADDRESS);
        console.log('  Balance:', balance.toString(), 'knights');
        
        if (balance > 0) {
            console.log('  Your knights:');
            for (let i = 0; i < Math.min(balance, 10n); i++) {
                const tokenId = await oldContract.tokenOfOwnerByIndex(YOUR_ADDRESS, i);
                console.log(`    - Knight #${tokenId}`);
            }
        }
    } catch (error) {
        console.log('  ❌ Error:', error.message);
    }
    
    console.log('\n🔍 Checking NEW NFT contract:', NEW_NFT);
    try {
        const newContract = new ethers.Contract(NEW_NFT, NFT_ABI, provider);
        const balance = await newContract.balanceOf(YOUR_ADDRESS);
        console.log('  Balance:', balance.toString(), 'knights');
        
        if (balance > 0) {
            console.log('  Your knights:');
            for (let i = 0; i < Math.min(balance, 10n); i++) {
                const tokenId = await newContract.tokenOfOwnerByIndex(YOUR_ADDRESS, i);
                console.log(`    - Knight #${tokenId}`);
            }
        }
    } catch (error) {
        console.log('  ❌ Error:', error.message);
    }
    
    // Check specific knight #10
    console.log('\n🔍 Checking Knight #10 ownership:');
    for (const [name, address] of [['OLD', OLD_NFT], ['NEW', NEW_NFT]]) {
        try {
            const contract = new ethers.Contract(address, NFT_ABI, provider);
            const owner = await contract.ownerOf(10);
            console.log(`  ${name} contract: Knight #10 owned by ${owner}`);
        } catch (error) {
            console.log(`  ${name} contract: Knight #10 does not exist`);
        }
    }
}

checkNFTs().catch(console.error);
