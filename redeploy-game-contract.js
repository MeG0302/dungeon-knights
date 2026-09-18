const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

// Configuration
const RPC_URL = 'https://rpc.testnet.chain.robinhood.com';
const CHAIN_ID = 46630;
const KNIGHT_NFT_ADDRESS = '0xE27106e63920BAfa0FaC0e05F1080EB6b1D9F934';
const DNG_TOKEN_ADDRESS = '0xc2e6c9a4a83608c14f604f7d6a15e6b9f84f44cc';

async function main() {
    console.log('\n🚀 Redeploying DungeonKnightsGame Contract (No Age Limit)...\n');

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

        // Check balance
        const balance = await provider.getBalance(wallet.address);
        console.log('💰 Balance:', ethers.formatEther(balance), 'ETH');

        if (balance === 0n) {
            console.error('❌ Insufficient balance for deployment');
            process.exit(1);
        }

        // Read contract source
        const contractPath = path.join(__dirname, 'contracts', 'DungeonKnightsGame-final.sol');
        const contractSource = fs.readFileSync(contractPath, 'utf8');

        console.log('\n📝 Contract: DungeonKnightsGame-final.sol (Age check removed)');
        console.log('📍 Knight NFT:', KNIGHT_NFT_ADDRESS);
        console.log('📍 DNG Token:', DNG_TOKEN_ADDRESS);

        // Note: This requires solc compiler
        // For now, use the already compiled bytecode or compile manually
        console.log('\n⚠️  Manual compilation required:');
        console.log('1. Go to https://remix.ethereum.org');
        console.log('2. Paste contracts/DungeonKnightsGame-final.sol');
        console.log('3. Compile with Solidity 0.8.20+');
        console.log('4. Deploy with constructor args:');
        console.log(`   - knightNFT: ${KNIGHT_NFT_ADDRESS}`);
        console.log(`   - dngToken: ${DNG_TOKEN_ADDRESS}`);
        console.log('\n5. After deployment, update the address in:');
        console.log('   - dungeon-session.js (line 9)');
        console.log('   - Any other files referencing the game contract');
        
        console.log('\n✅ Contract ready for deployment!');
        console.log('📋 Changes: Removed 1-hour age limit on completions');

    } catch (error) {
        console.error('\n❌ Failed:', error.message);
        process.exit(1);
    }
}

main();
