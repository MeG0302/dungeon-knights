// Check if game contract has enough DNG to pay rewards
const { ethers } = require('ethers');
const addresses = require('./contract-addresses');

const RPC_URL = addresses.RPC_URL;
const GAME_CONTRACT = addresses.GAME_CONTRACT;
const DNG_TOKEN = addresses.DNG_TOKEN;

const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)"
];

async function checkBalance() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const tokenContract = new ethers.Contract(DNG_TOKEN, ERC20_ABI, provider);
    
    const balance = await tokenContract.balanceOf(GAME_CONTRACT);
    const decimals = await tokenContract.decimals();
    const symbol = await tokenContract.symbol();
    
    console.log('💰 Game Contract Balance:');
    console.log(`  ${ethers.formatUnits(balance, decimals)} ${symbol}`);
    console.log(`\n  Raw: ${balance.toString()} wei`);
    
    const balanceNum = parseFloat(ethers.formatUnits(balance, decimals));
    
    if (balanceNum < 460) {
        console.log(`\n❌ NOT ENOUGH! You're trying to claim 460 DNG but contract only has ${balanceNum.toFixed(2)} DNG`);
        console.log(`\n💡 You need to fund the contract with at least ${(460 - balanceNum).toFixed(2)} more DNG`);
    } else {
        console.log(`\n✅ Contract has enough DNG to pay 460 DNG reward`);
    }
}

checkBalance().catch(console.error);
