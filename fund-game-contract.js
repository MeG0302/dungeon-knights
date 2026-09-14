const { ethers } = require('ethers');
require('dotenv').config({ path: '.env.local' });
const addresses = require('./contract-addresses');

// Configuration
const RPC_URL = addresses.RPC_URL;
const CHAIN_ID = addresses.CHAIN_ID;
const GAME_CONTRACT_ADDRESS = addresses.GAME_CONTRACT;
const DNG_TOKEN_ADDRESS = addresses.DNG_TOKEN;

const DNG_ABI = [
    'function approve(address spender, uint256 amount) returns (bool)',
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)'
];

const GAME_ABI = [
    'function fundContract(uint256 amount) external'
];

async function main() {
    console.log('\n💰 Funding Game Contract with DNG Tokens...\n');

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

        const dngToken = new ethers.Contract(DNG_TOKEN_ADDRESS, DNG_ABI, wallet);
        const gameContract = new ethers.Contract(GAME_CONTRACT_ADDRESS, GAME_ABI, wallet);

        // Check DNG balance
        const balance = await dngToken.balanceOf(wallet.address);
        console.log('💎 Your DNG balance:', ethers.formatEther(balance), 'DNG');

        if (balance === 0n) {
            console.error('❌ No DNG tokens to fund!');
            process.exit(1);
        }

        // Fund with 50,000 DNG (or all if less)
        const fundAmount = balance > ethers.parseEther('50000') 
            ? ethers.parseEther('50000') 
            : balance;

        console.log(`\n💸 Funding ${ethers.formatEther(fundAmount)} DNG to game contract...`);

        // Step 1: Approve
        console.log('⏳ Step 1: Approving DNG...');
        const approveTx = await dngToken.approve(GAME_CONTRACT_ADDRESS, fundAmount);
        await approveTx.wait();
        console.log('✅ Approved!');

        // Step 2: Fund contract
        console.log('⏳ Step 2: Funding contract...');
        const fundTx = await gameContract.fundContract(fundAmount);
        await fundTx.wait();
        console.log('✅ Funded!');

        console.log(`\n🎉 Successfully funded contract with ${ethers.formatEther(fundAmount)} DNG!`);
        console.log('📍 Contract:', GAME_CONTRACT_ADDRESS);

    } catch (error) {
        console.error('\n❌ Failed:', error.message);
        process.exit(1);
    }
}

main();
