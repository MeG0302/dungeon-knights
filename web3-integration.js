// Web3 Integration for Dungeon Knights
// Connects game to Robinhood Chain smart contract

// Contract ABI (minimal - just the functions we need)
const CONTRACT_ABI = [
  "function mintKnight() public returns (uint256)",
  "function getKnightInfo(uint256 tokenId) public view returns (address owner, uint8 rarity, string memory rarityName)",
  "function getKnightsByOwner(address owner) public view returns (uint256[])",
  "function mintCost() public view returns (uint256)",
  "function totalMinted() public view returns (uint256)",
  "function balanceOf(address owner) public view returns (uint256)",
  "function knightRarity(uint256 tokenId) public view returns (uint8)"
];

class Web3Manager {
  constructor(useTestnet = null) {
    this.provider = null;
    this.signer = null;
    this.contract = null;
    this.userAddress = null;
    this.isConnected = false;
    
    // Use config file to determine network (if config exists)
    if (typeof window.DUNGEON_CONFIG !== 'undefined') {
      if (useTestnet === null) {
        this.isTestnet = !window.DUNGEON_CONFIG.USE_MAINNET;
      } else {
        this.isTestnet = useTestnet;
      }
      
      const networkKey = this.isTestnet ? 'testnet' : 'mainnet';
      const networkConfig = window.DUNGEON_CONFIG.NETWORKS[networkKey];
      
      this.network = {
        chainId: networkConfig.chainId,
        chainName: networkConfig.name,
        nativeCurrency: networkConfig.currency,
        rpcUrls: [networkConfig.rpc],
        blockExplorerUrls: [networkConfig.explorer]
      };
      
      this.contractAddress = window.DUNGEON_CONFIG.getNFTContract();
      
      console.log('🎮 Web3Manager initialized');
      console.log('📍 Network:', this.isTestnet ? 'Testnet' : 'Mainnet');
      console.log('📝 NFT Contract:', this.contractAddress);
      console.log('💰 Uses Token:', window.DUNGEON_CONFIG.usesCustomToken() ? window.DUNGEON_CONFIG.TOKEN.symbol : 'ETH');
    } else {
      console.error('⚠️ config.js not loaded! Using defaults.');
      this.isTestnet = true;
      this.contractAddress = '0xEA37B1D036a880DfF372bCdd8b2A3AEeEe01e55A';
    }
  }

  // Check if MetaMask is installed
  isMetaMaskInstalled() {
    return typeof window.ethereum !== 'undefined';
  }

  // Wait for ethers.js library to load
  async waitForEthers() {
    console.log('🔍 Checking for ethers.js...');
    console.log('typeof ethers:', typeof ethers);
    console.log('typeof window.ethers:', typeof window.ethers);
    console.log('window.ethersLoaded:', window.ethersLoaded);
    
    let attempts = 0;
    while (typeof ethers === 'undefined' && typeof window.ethers === 'undefined' && attempts < 50) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
    
    if (typeof ethers === 'undefined' && typeof window.ethers === 'undefined') {
      console.error('❌ ethers.js failed to load after 5 seconds');
      console.log('Check network tab in DevTools to see if script loaded');
      throw new Error('Failed to load ethers.js library. Please refresh the page and check your internet connection.');
    }
    
    // Use window.ethers if ethers global doesn't exist
    if (typeof ethers === 'undefined' && typeof window.ethers !== 'undefined') {
      window.ethers = window.ethers;
    }
    
    console.log('✅ ethers.js loaded successfully');
  }

  // Connect wallet
  async connect() {
    if (!this.isMetaMaskInstalled()) {
      alert('Please install MetaMask to use NFT features!\n\nVisit: https://metamask.io/');
      return false;
    }

    // Wait for ethers.js to load
    if (typeof ethers === 'undefined') {
      console.log('⏳ Waiting for ethers.js to load...');
      await this.waitForEthers();
    }

    try {
      // Request account access
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts'
      });
      
      this.userAddress = accounts[0];
      console.log('✅ Wallet connected:', this.userAddress);

      // Switch to Robinhood Chain
      await this.switchNetwork();

      // Initialize ethers.js v5
      this.provider = new ethers.providers.Web3Provider(window.ethereum);
      this.signer = this.provider.getSigner();
      this.contract = new ethers.Contract(
        this.contractAddress,
        CONTRACT_ABI,
        this.signer
      );

      this.isConnected = true;
      
      // Store connection state in localStorage
      localStorage.setItem('walletConnected', 'true');
      localStorage.setItem('walletAddress', this.userAddress);
      
      console.log('✅ Connected to', this.isTestnet ? 'Testnet' : 'Mainnet');
      console.log('📝 Contract:', this.contractAddress);
      
      // Update UI
      this.updateConnectionUI();
      
      return true;
    } catch (error) {
      console.error('❌ Connection failed:', error);
      alert('Failed to connect wallet: ' + error.message);
      return false;
    }
  }

  // Switch to Robinhood Chain
  async switchNetwork() {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: this.network.chainId }]
      });
      console.log('✅ Switched to Robinhood Chain');
    } catch (switchError) {
      // Chain not added, add it
      if (switchError.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [this.network]
          });
          console.log('✅ Added Robinhood Chain to MetaMask');
        } catch (addError) {
          console.error('❌ Failed to add network:', addError);
          throw addError;
        }
      } else {
        throw switchError;
      }
    }
  }

  // Disconnect wallet
  disconnect() {
    this.provider = null;
    this.signer = null;
    this.contract = null;
    this.userAddress = null;
    this.isConnected = false;
    
    // Clear localStorage
    localStorage.removeItem('walletConnected');
    localStorage.removeItem('walletAddress');
    
    this.updateConnectionUI();
    console.log('🔌 Wallet disconnected');
  }
  
  // Auto-reconnect if previously connected
  async autoReconnect() {
    const wasConnected = localStorage.getItem('walletConnected') === 'true';
    const savedAddress = localStorage.getItem('walletAddress');
    
    if (wasConnected && savedAddress && window.ethereum && window.ethereum.selectedAddress) {
      console.log('🔄 Auto-reconnecting wallet...');
      try {
        await this.connect();
        return true;
      } catch (error) {
        console.error('❌ Auto-reconnect failed:', error);
        localStorage.removeItem('walletConnected');
        localStorage.removeItem('walletAddress');
        return false;
      }
    }
    return false;
  }

  // Approve $DNG tokens for NFT contract
  async approveDNG(amount) {
    if (!this.isConnected) {
      alert('Please connect your wallet first!');
      return false;
    }

    try {
      // Get token address from config with fallback
      let tokenAddress = '0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910'; // Testnet default
      
      if (typeof window.DUNGEON_CONFIG !== 'undefined' && window.DUNGEON_CONFIG.getTokenAddress) {
        const configAddress = window.DUNGEON_CONFIG.getTokenAddress();
        if (configAddress) {
          tokenAddress = configAddress;
        }
      }
      
      console.log('💰 Approving $DNG tokens...');
      console.log('   Token:', tokenAddress);
      console.log('   NFT Contract:', this.contractAddress);
      console.log('   Amount:', amount, '$DNG');

      // ERC20 ABI for approve function
      const ERC20_ABI = [
        'function approve(address spender, uint256 amount) public returns (bool)',
        'function allowance(address owner, address spender) public view returns (uint256)'
      ];

      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.signer);

      // Check current allowance
      const walletAddress = await this.signer.getAddress();
      const currentAllowance = await tokenContract.allowance(walletAddress, this.contractAddress);
      const requiredAmount = ethers.utils.parseEther(amount.toString());

      console.log('   Wallet:', walletAddress);
      console.log('   Current allowance:', ethers.utils.formatEther(currentAllowance), '$DNG');
      console.log('   Required:', ethers.utils.formatEther(requiredAmount), '$DNG');

      if (currentAllowance.gte(requiredAmount)) {
        console.log('✅ Already approved!');
        return true;
      }

      // Request approval
      console.log('⏳ Requesting approval...');
      const tx = await tokenContract.approve(this.contractAddress, requiredAmount);
      
      console.log('⏳ Waiting for approval confirmation...');
      console.log('🔗 TX:', tx.hash);
      
      const receipt = await tx.wait();
      console.log('✅ $DNG approved! Block:', receipt.blockNumber);
      
      return true;
    } catch (error) {
      console.error('❌ Approval failed:', error);
      alert('Token approval failed: ' + (error.message || 'Unknown error'));
      return false;
    }
  }

  // Mint a single knight NFT
  async mintKnight() {
    if (!this.isConnected) {
      alert('Please connect your wallet first!');
      return null;
    }

    try {
      console.log('📝 Sending mint transaction...');
      
      // Call the mintKnight function (no ETH value needed, uses $DNG)
      const tx = await this.contract.mintKnight();
      
      console.log('⏳ Minting knight... TX:', tx.hash);
      console.log('🔗 View on explorer:', `${this.network.blockExplorerUrls[0]}/tx/${tx.hash}`);
      
      // Wait for confirmation
      console.log('⏳ Waiting for blockchain confirmation...');
      const receipt = await tx.wait();
      console.log('✅ Knight minted! Block:', receipt.blockNumber);
      
      // Get the token ID from the event
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
        const tokenId = parsed.args.tokenId;
        console.log('🎉 Minted Knight #' + tokenId);
        return tokenId;
      }
      
      return receipt;
    } catch (error) {
      console.error('❌ Mint failed:', error);
      
      // Better error messages
      let errorMsg = 'Unknown error';
      if (error.code === 4001) {
        errorMsg = 'Transaction rejected by user';
      } else if (error.code === 'INSUFFICIENT_FUNDS') {
        errorMsg = 'Insufficient ETH balance';
      } else if (error.reason) {
        errorMsg = error.reason;
      } else if (error.message) {
        errorMsg = error.message;
      }
      
      throw new Error(errorMsg);
    }
  }

  // Mint multiple knights (calls single mint multiple times)
  async mintKnights(amount) {
    if (!this.isConnected) {
      alert('Please connect your wallet first!');
      return null;
    }

    if (amount < 1 || amount > 10) {
      alert('You can mint 1-10 knights at once');
      return null;
    }

    try {
      console.log(`⏳ Minting ${amount} knights (one by one)...`);
      
      const tokenIds = [];
      
      for (let i = 0; i < amount; i++) {
        console.log(`🎲 Minting knight ${i + 1}/${amount}...`);
        
        const tx = await this.contract.mintKnight();
        
        console.log(`⏳ Waiting for confirmation... TX: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log(`✅ Knight ${i + 1}/${amount} minted! Block: ${receipt.blockNumber}`);
        
        // Try to get token ID from event
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
          const tokenId = parsed.args.tokenId;
          tokenIds.push(tokenId);
          console.log(`🎉 Minted Knight #${tokenId}`);
        }
        
        // Small delay between mints
        if (i < amount - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      console.log(`✅ All ${amount} knights minted!`, tokenIds);
      return tokenIds;
      
    } catch (error) {
      console.error('❌ Batch mint failed:', error);
      
      let errorMsg = 'Unknown error';
      if (error.code === 4001) {
        errorMsg = 'Transaction rejected by user';
      } else if (error.reason) {
        errorMsg = error.reason;
      } else if (error.message) {
        errorMsg = error.message;
      }
      
      throw new Error(errorMsg);
    }
  }

  // Get all knights owned by connected wallet
  async getMyKnights() {
    if (!this.isConnected) {
      return [];
    }

    try {
      const tokenIds = await this.contract.getKnightsByOwner(this.userAddress);
      const knights = [];
      
      for (const tokenId of tokenIds) {
        const knightData = await this.contract.getKnight(tokenId);
        
        // Convert to game format
        const knight = {
          id: Number(tokenId),
          tokenId: Number(tokenId),
          rarity: this.getRarityObject(Number(knightData.rarity)),
          stats: {
            power: Number(knightData.power),
            speed: Number(knightData.speed),
            maxStamina: Number(knightData.maxStamina),
            recoveryRate: Number(knightData.recoveryRate),
            range: Number(knightData.range)
          },
          stamina: Number(knightData.maxStamina), // Start with full stamina
          state: 'idle',
          isDeployed: false,
          totalEarned: 0,
          fromBlockchain: true // Mark as NFT
        };
        
        knights.push(knight);
      }
      
      console.log('📦 Loaded', knights.length, 'knights from blockchain');
      return knights;
    } catch (error) {
      console.error('❌ Failed to load knights:', error);
      return [];
    }
  }

  // Get rarity object from enum value
  getRarityObject(rarityValue) {
    const rarities = [
      { name: 'Common', multiplier: 1.0, color: '#808080', tier: 'COMMON' },
      { name: 'Uncommon', multiplier: 1.5, color: '#00ff00', tier: 'UNCOMMON' },
      { name: 'Rare', multiplier: 2.2, color: '#0080ff', tier: 'RARE' },
      { name: 'Epic', multiplier: 3.5, color: '#a020f0', tier: 'EPIC' },
      { name: 'Legendary', multiplier: 5.0, color: '#ffa500', tier: 'LEGENDARY' },
      { name: 'Mythic', multiplier: 8.0, color: '#ff0000', tier: 'MYTHIC' }
    ];
    
    return rarities[rarityValue] || rarities[0];
  }

  // Update UI to show connection status
  updateConnectionUI() {
    // Update wallet button text
    const walletBtn = document.getElementById('connectWalletBtn');
    if (walletBtn) {
      if (this.isConnected) {
        const shortAddress = this.userAddress.slice(0, 6) + '...' + this.userAddress.slice(-4);
        walletBtn.textContent = '🔗 ' + shortAddress;
        walletBtn.classList.add('connected');
      } else {
        walletBtn.textContent = '🔌 Connect Wallet';
        walletBtn.classList.remove('connected');
      }
    }
    
    // Show/hide NFT mint button
    const nftMintBtn = document.getElementById('mintNFTKnightBtn');
    if (nftMintBtn) {
      nftMintBtn.style.display = this.isConnected ? 'block' : 'none';
    }
  }

  // Get mint price
  async getMintPrice() {
    if (!this.isConnected) return '500';
    
    try {
      // New contract uses mintCost instead of mintPrice
      const cost = await this.contract.mintCost();
      return ethers.utils.formatEther(cost);
    } catch (error) {
      console.error('Error getting mint cost:', error);
      return '500'; // Default 500 $DNG
    }
  }
}

// Expose Web3Manager class globally
window.Web3Manager = Web3Manager;

// Initialize global Web3 manager
window.web3Manager = new Web3Manager(true); // true = use testnet

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Web3Manager;
}

console.log('🔗 Web3 Integration loaded');
console.log('💡 Call web3Manager.connect() to connect MetaMask');
