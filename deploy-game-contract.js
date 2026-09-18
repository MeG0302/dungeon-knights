const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

// Robinhood Chain Testnet Configuration
const RPC_URL = 'https://rpc.testnet.chain.robinhood.com';
const CHAIN_ID = 46630;

// Contract addresses (already deployed)
const KNIGHT_NFT_ADDRESS = '0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512';
const DNG_TOKEN_ADDRESS = '0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910';

// Read compiled contract (you'll need to provide this from Remix)
function getContractData() {
    console.log('📖 Instructions to get contract bytecode from Remix:\n');
    console.log('1. Compile your contract in Remix');
    console.log('2. Click "Compilation Details" button');
    console.log('3. Scroll down to find "BYTECODE"');
    console.log('4. Copy the "object" field value');
    console.log('5. Also copy the ABI from the ABI section');
    console.log('6. Create a file called "compiled-contract.json" with this format:');
    console.log(`{
  "bytecode": "0x...",
  "abi": [...]
}`);
    console.log('\n📝 Or just paste them when prompted!\n');
    
    // Check if compiled file exists
    const compiledPath = path.join(__dirname, 'compiled-contract.json');
    if (fs.existsSync(compiledPath)) {
        return JSON.parse(fs.readFileSync(compiledPath, 'utf8'));
    }
    
    return null;
}

async function main() {
    console.log('\n🚀 Deploying DungeonKnightsGame Contract...\n');

    // Check for compiled contract
    const contractData = getContractData();
    if (!contractData) {
        console.error('❌ Error: compiled-contract.json not found\n');
        console.log('Please compile in Remix first and save the bytecode + ABI!\n');
        process.exit(1);
    }

    // Check private key
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey || privateKey === 'your_private_key_here') {
        console.error('❌ Error: PRIVATE_KEY not found in .env.local');
        console.log('\n📝 Instructions:');
        console.log('1. Open MetaMask');
        console.log('2. Click on your account → Account Details → Show Private Key');
        console.log('3. Copy your private key');
        console.log('4. Open .env.local file');
        console.log('5. Replace "your_private_key_here" with your actual private key');
        console.log('6. Save the file');
        console.log('7. Run this script again: npm run deploy\n');
        process.exit(1);
    }

    try {
        // Connect to Robinhood Chain Testnet
        console.log('🔗 Connecting to Robinhood Chain Testnet...');
        const provider = new ethers.JsonRpcProvider(RPC_URL, {
            chainId: CHAIN_ID,
            name: 'Robinhood Chain Testnet'
        });

        // Create wallet
        const wallet = new ethers.Wallet(privateKey, provider);
        console.log('✅ Connected wallet:', wallet.address);

        // Check balance
        const balance = await provider.getBalance(wallet.address);
        console.log('💰 Balance:', ethers.formatEther(balance), 'ETH');

        if (balance === 0n) {
            console.error('\n❌ Error: Insufficient balance');
            console.log('You need testnet ETH to deploy. Get some from a faucet!\n');
            process.exit(1);
        }

        // Create contract factory
        console.log('\n📝 Preparing contract deployment...');
        console.log('   Knight NFT:', KNIGHT_NFT_ADDRESS);
        console.log('   DNG Token:', DNG_TOKEN_ADDRESS);

        // Deploy contract
        console.log('\n🔨 Deploying contract (this may take 30-60 seconds)...');
        
        const factory = new ethers.ContractFactory(
            contractData.abi,
            contractData.bytecode,
            wallet
        );

        const contract = await factory.deploy(
            KNIGHT_NFT_ADDRESS,
            DNG_TOKEN_ADDRESS,
            {
                gasLimit: 5000000
            }
        );

        console.log('⏳ Transaction sent! Waiting for confirmation...');
        console.log('   TX Hash:', contract.deploymentTransaction().hash);

        // Wait for deployment
        await contract.waitForDeployment();
        const contractAddress = await contract.getAddress();

        console.log('\n✅ CONTRACT DEPLOYED SUCCESSFULLY! ✅\n');
        console.log('═'.repeat(60));
        console.log('📍 Game Contract Address:', contractAddress);
        console.log('═'.repeat(60));

        console.log('\n📋 Next Steps:\n');
        console.log('1. ✅ Copy the contract address above');
        console.log('2. 📝 I will update dungeon-session.js automatically');
        console.log('3. 💰 Fund the contract with $DNG tokens');
        console.log('4. 🚀 Deploy to Vercel: vercel --prod');
        console.log('5. 🎮 Test the game!\n');

        // Save contract address to file
        const deploymentInfo = {
            gameContractAddress: contractAddress,
            knightNFTAddress: KNIGHT_NFT_ADDRESS,
            dngTokenAddress: DNG_TOKEN_ADDRESS,
            deployedAt: new Date().toISOString(),
            deployer: wallet.address,
            txHash: contract.deploymentTransaction().hash,
            network: 'Robinhood Chain Testnet',
            chainId: CHAIN_ID
        };

        fs.writeFileSync(
            'deployed-contracts.json',
            JSON.stringify(deploymentInfo, null, 2)
        );

        console.log('💾 Deployment info saved to: deployed-contracts.json\n');

        return contractAddress;

    } catch (error) {
        console.error('\n❌ Deployment failed:', error.message);
        if (error.code === 'INSUFFICIENT_FUNDS') {
            console.log('\n💡 You need more testnet ETH. Get some from a faucet!');
        }
        process.exit(1);
    }
}

// Run deployment
main()
    .then((address) => {
        console.log('🎉 Deployment complete!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
