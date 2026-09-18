/**
 * URGENT: Recover 320,339 DNG from abandoned contracts
 * 
 * This script withdraws funds from 4 old game contracts:
 * - 3 V1 contracts with exploitable self-signed rewards (311,194 DNG)
 * - 1 V2 contract (9,145 DNG)
 * 
 * Run with: node recover-old-contracts.js
 */

const { ethers } = require('ethers');
const readline = require('readline');

// Load environment
require('dotenv').config({ path: '.env.local' });

// Configuration
const RPC = 'https://rpc.testnet.chain.robinhood.com';
const CHAIN_ID = 46630;
const DNG = '0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910';
const EXPECTED_OWNER = '0x038d75aDb74d8e5Db82E6c6797f90dCdF82ef4C9';

const TARGETS = [
    { addr: '0x45B905f66789bED9A1e9FF47f5429aF41A370E17', kind: 'V1', name: 'V1 (204k DNG)' },
    { addr: '0xb4cee9bA94660BDB19C3a933d71d94623c0B1ec5', kind: 'V1', name: 'V1 (99k DNG)' },
    { addr: '0xbA216A5f7733B0B989eD751496386B759698797F', kind: 'V1', name: 'V1 (7k DNG)' },
    { addr: '0xd6D40B6C0D22f43866F6FBab3cf0DddDba05cFd5', kind: 'V2', name: 'V2 (9k DNG)' },
];

// ABIs
const V1_ABI = [
    'function owner() view returns (address)',
    'function withdrawTokens(uint256 amount) external',
    'function setDungeon(uint256 dungeonId, uint256 minTime, uint256 maxReward, bool active) external',
    'function dungeons(uint256) view returns (uint256 minCompletionTime, uint256 maxRewardPerRun, bool active)',
];

const V2_ABI = [
    'function owner() view returns (address)',
    'function withdrawTokens(uint256 amount) external',
    'function setPaused(bool) external',
    'function paused() view returns (bool)',
];

const DNG_ABI = [
    'function balanceOf(address) view returns (uint256)',
];

// Helper to wait for user confirmation
function askConfirmation(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    return new Promise(resolve => {
        rl.question(question, answer => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

async function main() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║  URGENT: Recover 320,339 DNG from Abandoned Contracts     ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // 1. Load private key
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
        console.error('❌ ERROR: PRIVATE_KEY not found in .env.local');
        console.error('   Make sure .env.local exists and contains your private key.');
        process.exit(1);
    }

    // 2. Connect to RPC
    console.log('🔌 Connecting to Robinhood Testnet...');
    const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID);
    const wallet = new ethers.Wallet(privateKey, provider);
    
    console.log(`✅ Connected: ${wallet.address}\n`);

    // 3. Verify owner
    if (wallet.address.toLowerCase() !== EXPECTED_OWNER.toLowerCase()) {
        console.error('❌ SECURITY ERROR: Wallet address does not match expected owner!');
        console.error(`   Expected: ${EXPECTED_OWNER}`);
        console.error(`   Got:      ${wallet.address}`);
        console.error('\n   These contracts require onlyOwner. Aborting.');
        process.exit(1);
    }
    console.log('✅ Owner verification passed\n');

    // 4. Check all balances
    console.log('📊 Scanning contract balances...\n');
    const dngContract = new ethers.Contract(DNG, DNG_ABI, provider);
    
    const balances = [];
    let totalRecoverable = 0n;
    
    for (const target of TARGETS) {
        const gameContract = new ethers.Contract(
            target.addr,
            target.kind === 'V1' ? V1_ABI : V2_ABI,
            provider
        );
        
        try {
            const owner = await gameContract.owner();
            const balance = await dngContract.balanceOf(target.addr);
            const balanceFormatted = ethers.formatEther(balance);
            
            balances.push({
                ...target,
                owner,
                balance,
                balanceFormatted,
                contract: gameContract
            });
            
            totalRecoverable += balance;
            
            console.log(`${target.name.padEnd(20)} ${target.addr}`);
            console.log(`  Owner:   ${owner}`);
            console.log(`  Balance: ${balanceFormatted.padStart(12)} DNG`);
            
            if (target.kind === 'V1') {
                const dungeon = await gameContract.dungeons(1);
                console.log(`  Dungeon: ${dungeon.active ? '🔴 ACTIVE (EXPLOITABLE!)' : '⚪ inactive'}`);
            } else {
                const paused = await gameContract.paused();
                console.log(`  Status:  ${paused ? '⏸️  Paused' : '▶️  Active'}`);
            }
            console.log('');
        } catch (error) {
            console.error(`❌ Failed to query ${target.name}: ${error.message}\n`);
        }
    }
    
    // Check owner wallet balance
    const ownerBalance = await dngContract.balanceOf(wallet.address);
    const ownerBalanceFormatted = ethers.formatEther(ownerBalance);
    
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Total to recover: ${ethers.formatEther(totalRecoverable).padStart(12)} DNG`);
    console.log(`Owner wallet:     ${ownerBalanceFormatted.padStart(12)} DNG`);
    console.log(`After recovery:   ${ethers.formatEther(ownerBalance + totalRecoverable).padStart(12)} DNG`);
    console.log('═══════════════════════════════════════════════════════════\n');

    if (totalRecoverable === 0n) {
        console.log('✅ Nothing to recover. All contracts are empty.');
        return;
    }

    // 5. Show plan and wait for confirmation
    console.log('📋 RECOVERY PLAN:\n');
    console.log('For each contract with balance:');
    console.log('  1. withdrawTokens(balance) → transfers to owner wallet');
    console.log('  2. For V1: setDungeon(1, 0, 0, false) → deactivates exploitable dungeon');
    console.log('     For V2: setPaused(true) → pauses contract');
    console.log('');
    console.log('⚠️  WARNING: This will execute on-chain transactions with real funds!');
    console.log('');
    
    const answer = await askConfirmation('Type "RECOVER" (all caps) to proceed, or anything else to abort: ');
    
    if (answer !== 'RECOVER') {
        console.log('\n❌ Aborted by user. No transactions sent.');
        process.exit(0);
    }

    console.log('\n🚀 Starting recovery...\n');

    // 6. Execute recovery for each contract
    const results = [];
    
    for (const item of balances) {
        if (item.balance === 0n) {
            console.log(`⏭️  Skipping ${item.name} (already empty)\n`);
            continue;
        }
        
        console.log(`💰 Processing ${item.name}...`);
        
        try {
            // Withdraw tokens
            const contract = new ethers.Contract(
                item.addr,
                item.kind === 'V1' ? V1_ABI : V2_ABI,
                wallet
            );
            
            console.log(`   📤 Withdrawing ${item.balanceFormatted} DNG...`);
            const withdrawTx = await contract.withdrawTokens(item.balance);
            console.log(`   ⏳ TX sent: ${withdrawTx.hash}`);
            const withdrawReceipt = await withdrawTx.wait();
            console.log(`   ✅ Withdrawn! Block: ${withdrawReceipt.blockNumber}`);
            
            // Deactivate/pause
            if (item.kind === 'V1') {
                console.log('   🔒 Deactivating dungeon #1...');
                const deactivateTx = await contract.setDungeon(1, 0, 0, false);
                console.log(`   ⏳ TX sent: ${deactivateTx.hash}`);
                const deactivateReceipt = await deactivateTx.wait();
                console.log(`   ✅ Deactivated! Block: ${deactivateReceipt.blockNumber}`);
            } else {
                console.log('   ⏸️  Pausing contract...');
                const pauseTx = await contract.setPaused(true);
                console.log(`   ⏳ TX sent: ${pauseTx.hash}`);
                const pauseReceipt = await pauseTx.wait();
                console.log(`   ✅ Paused! Block: ${pauseReceipt.blockNumber}`);
            }
            
            results.push({
                contract: item.name,
                success: true,
                amount: item.balanceFormatted,
                withdrawTx: withdrawReceipt.hash
            });
            
            console.log('');
        } catch (error) {
            console.error(`   ❌ Failed: ${error.message}\n`);
            results.push({
                contract: item.name,
                success: false,
                error: error.message
            });
        }
    }

    // 7. Verify final state
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔍 Verifying final state...\n');
    
    let totalRecovered = 0n;
    
    for (const target of TARGETS) {
        const gameContract = new ethers.Contract(
            target.addr,
            target.kind === 'V1' ? V1_ABI : V2_ABI,
            provider
        );
        
        const balance = await dngContract.balanceOf(target.addr);
        const balanceFormatted = ethers.formatEther(balance);
        
        console.log(`${target.name.padEnd(20)} ${balanceFormatted.padStart(12)} DNG`);
        
        if (target.kind === 'V1') {
            const dungeon = await gameContract.dungeons(1);
            console.log(`  Dungeon: ${dungeon.active ? '🔴 STILL ACTIVE!' : '✅ Deactivated'}`);
        } else {
            const paused = await gameContract.paused();
            console.log(`  Status:  ${paused ? '✅ Paused' : '⚠️  Still active'}`);
        }
        console.log('');
        
        if (balance > 0n) {
            console.warn(`⚠️  WARNING: ${target.name} still has ${balanceFormatted} DNG!`);
        }
    }
    
    const newOwnerBalance = await dngContract.balanceOf(wallet.address);
    const recovered = newOwnerBalance - ownerBalance;
    
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Owner wallet: ${ethers.formatEther(newOwnerBalance)} DNG`);
    console.log(`Recovered:    ${ethers.formatEther(recovered)} DNG`);
    console.log('═══════════════════════════════════════════════════════════\n');

    // Summary
    console.log('📊 SUMMARY:\n');
    for (const result of results) {
        if (result.success) {
            console.log(`✅ ${result.contract}: Recovered ${result.amount} DNG`);
            console.log(`   TX: ${result.withdrawTx}`);
        } else {
            console.log(`❌ ${result.contract}: ${result.error}`);
        }
    }
    
    console.log('\n🎉 Recovery complete!');
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error('\n❌ Fatal error:', error);
        process.exit(1);
    });
