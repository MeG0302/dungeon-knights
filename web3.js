// Clean Web3 Manager for Dungeon Knights
// Handles wallet connection and NFT minting on Robinhood Chain

console.log('🔧 Loading web3.js...');

class Web3Manager {
  constructor() {
    this.provider = null;
    this.signer = null;
    this.contract = null;
    this.tokenContract = null;
    this.userAddress = null;
    this.isConnected = false;
    
    // Contract addresses from config
    this.contractAddress = '0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512'; // NFT
    this.tokenAddress = '0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910'; // $DNG
    
    // Network config - Robinhood Chain Testnet
    this.networkConfig = {
      chainId: '0xb626', // 46630
      chainName: 'Robinhood Chain Testnet',
      rpcUrls: ['https://rpc.testnet.chain.robinhood.com'],
      blockExplorerUrls: ['https://explorer.testnet.chain.robinhood.com'],
      nativeCurrency: {
        name: 'ETH',
        symbol: 'ETH',
        decimals: 18
      }
    };
    
    // Contract ABIs
    this.nftABI = [
      "function mintKnight() public returns (uint256)",
      "function mintCost() public view returns (uint256)",
      "function knightRarity(uint256 tokenId) public view returns (uint8)",
      "function getKnightInfo(uint256 tokenId) public view returns (address owner, uint8 rarity, string memory rarityName)",
      "function balanceOf(address owner) public view returns (uint256)",
      "function totalMinted() public view returns (uint256)"
    ];
    
    this.tokenABI = [
      "function approve(address spender, uint256 amount) public returns (bool)",
      "function allowance(address owner, address spender) public view returns (uint256)",
      "function balanceOf(address account) public view returns (uint256)"
    ];
    
    console.log('✅ Web3Manager initialized');
  }
  
  // Connect to MetaMask
  async connect() {
    console.log('🔌 Connecting to MetaMask...');
    
    if (!window.ethereum) {
      alert('⚠️ MetaMask not found! Please install MetaMask to mint NFTs.');
      return false;
    }
    
    try {
      // Request accounts
      const accounts = await window.ethereum.request({ 
        method: 'eth_requestAccounts' 
      });
      
      this.userAddress = accounts[0];
      console.log('✅ Connected:', this.userAddress);
      
      // Create provider and signer
      this.provider = new ethers.providers.Web3Provider(window.ethereum);
      this.signer = this.provider.getSigner();
      
      // Check network
      const network = await this.provider.getNetwork();
      console.log('🌐 Network:', network.chainId);
      
      // Switch to Robinhood Chain if needed
      if (network.chainId !== 46630) {
        console.log('⚠️ Wrong network, switching to Robinhood Chain Testnet...');
        await this.switchNetwork();
      }
      
      // Create contract instances
      this.contract = new ethers.Contract(
        this.contractAddress,
        this.nftABI,
        this.signer
      );
      
      this.tokenContract = new ethers.Contract(
        this.tokenAddress,
        this.tokenABI,
        this.signer
      );
      
      this.isConnected = true;
      console.log('✅ Web3 fully connected and ready');
      
      return true;
      
    } catch (error) {
      console.error('❌ Connection failed:', error);
      alert('Failed to connect: ' + error.message);
      return false;
    }
  }
  
  // Switch to Robinhood Chain
  async switchNetwork() {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: this.networkConfig.chainId }]
      });
      console.log('✅ Switched to Robinhood Chain Testnet');
    } catch (error) {
      // Chain not added, add it
      if (error.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [this.networkConfig]
          });
          console.log('✅ Added Robinhood Chain Testnet');
        } catch (addError) {
          console.error('❌ Failed to add network:', addError);
          throw addError;
        }
      } else {
        throw error;
      }
    }
  }
  
  // Check $DNG balance
  async checkDNGBalance() {
    if (!this.isConnected) return '0';
    
    try {
      const balance = await this.tokenContract.balanceOf(this.userAddress);
      const formatted = ethers.utils.formatEther(balance);
      console.log('💰 $DNG Balance:', formatted);
      return formatted;
    } catch (error) {
      console.error('❌ Failed to check balance:', error);
      return '0';
    }
  }
  
  // Approve $DNG for minting
  async approveDNG(amount) {
    if (!this.isConnected) {
      alert('Please connect wallet first!');
      return false;
    }
    
    try {
      console.log('💰 Approving', amount, '$DNG for NFT contract...');
      
      // Convert to wei
      const amountWei = ethers.utils.parseEther(amount.toString());
      
      // Check current allowance
      const allowance = await this.tokenContract.allowance(
        this.userAddress,
        this.contractAddress
      );
      
      console.log('Current allowance:', ethers.utils.formatEther(allowance), '$DNG');
      
      if (allowance.gte(amountWei)) {
        console.log('✅ Already approved!');
        return true;
      }
      
      // Request approval
      console.log('📝 Sending approval transaction...');
      const tx = await this.tokenContract.approve(this.contractAddress, amountWei);
      
      console.log('⏳ Waiting for approval confirmation...');
      await tx.wait();
      
      console.log('✅ $DNG approved!');
      return true;
      
    } catch (error) {
      console.error('❌ Approval failed:', error);
      if (error.code === 4001) {
        alert('Approval cancelled');
      } else {
        alert('Approval failed: ' + error.message);
      }
      return false;
    }
  }
  
  // Mint a knight
  async mintKnight() {
    if (!this.isConnected) {
      alert('Please connect wallet first!');
      return null;
    }
    
    try {
      console.log('⚔️ Minting knight...');
      
      // Send mint transaction
      const tx = await this.contract.mintKnight();
      console.log('📝 Transaction sent:', tx.hash);
      
      // Wait for confirmation
      console.log('⏳ Waiting for confirmation...');
      const receipt = await tx.wait();
      
      console.log('✅ Knight minted!');
      console.log('Block:', receipt.blockNumber);
      
      // Try to get token ID from events
      let tokenId = null;
      try {
        const event = receipt.logs.find(log => {
          try {
            const parsed = this.contract.interface.parseLog(log);
            return parsed.name === 'KnightMinted';
          } catch {
            return false;
          }
        });
        
        if (event) {
          const parsed = this.contract.interface.parseLog(event);
          tokenId = parsed.args.tokenId.toString();
          console.log('🎉 Token ID:', tokenId);
        }
      } catch (e) {
        console.log('Could not parse token ID from event');
      }
      
      return { success: true, tokenId, txHash: tx.hash };
      
    } catch (error) {
      console.error('❌ Mint failed:', error);
      
      if (error.code === 4001) {
        alert('Transaction cancelled');
      } else if (error.message.includes('insufficient funds')) {
        alert('Insufficient ETH for gas fees');
      } else if (error.message.includes('DNG transfer failed')) {
        alert('Not enough $DNG tokens or not approved');
      } else {
        alert('Mint failed: ' + error.message);
      }
      
      return null;
    }
  }
  
  // Get mint cost
  async getMintCost() {
    try {
      const cost = await this.contract.mintCost();
      return ethers.utils.formatEther(cost);
    } catch (error) {
      console.error('Failed to get mint cost:', error);
      return '500'; // Default
    }
  }
  
  // Get all knights owned by connected wallet
  async getMyKnights() {
    if (!this.isConnected) {
      console.log('Not connected to wallet');
      return [];
    }
    
    try {
      console.log('📦 Fetching your knights from blockchain...');
      
      // Get balance
      const balance = await this.contract.balanceOf(this.userAddress);
      const knightCount = balance.toNumber();
      
      console.log('Found', knightCount, 'knights');
      
      if (knightCount === 0) {
        return [];
      }
      
      const knights = [];
      
      // For each knight, get details
      // Note: We need to scan token IDs - this is simplified
      // In production, you'd want to track this better
      const totalMinted = await this.contract.totalMinted ? 
        (await this.contract.totalMinted()).toNumber() : 100;
      
      for (let tokenId = 0; tokenId < totalMinted && knights.length < knightCount; tokenId++) {
        try {
          const info = await this.contract.getKnightInfo(tokenId);
          
          // Check if this wallet owns it
          if (info.owner.toLowerCase() === this.userAddress.toLowerCase()) {
            const rarityNames = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
            const rarityName = rarityNames[info.rarity] || 'common';
            
            knights.push({
              tokenId,
              rarity: rarityName,
              owner: info.owner
            });
            
            console.log(`✅ Knight #${tokenId} - ${rarityName}`);
          }
        } catch (e) {
          // Token doesn't exist or error, skip
        }
      }
      
      console.log('✅ Loaded', knights.length, 'knights from blockchain');
      return knights;
      
    } catch (error) {
      console.error('❌ Failed to fetch knights:', error);
      return [];
    }
  }
}

// Create global instance
console.log('🔧 Creating global Web3Manager instance...');
window.Web3Manager = Web3Manager;
window.web3Manager = new Web3Manager();
console.log('✅ web3.js loaded - window.web3Manager ready');
