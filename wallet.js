// Wallet Manager with Direct Web3 Integration
console.log('🔧 Loading wallet.js...');

class WalletManager {
  constructor() {
    this.provider = null;
    this.userAddress = null;
    this.isConnected = false;
    
    // Contract addresses
    this.nftContractAddress = '0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512';
    this.tokenContractAddress = '0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910';
    
    // Chain config
    this.chainId = 46630; // Robinhood Chain Testnet
    this.chainIdHex = '0xB626'; // Fixed: 46630 in hex (was 0xB616 = 46614)
    
    console.log('✅ WalletManager initialized');
  }
  
  // Initialize wallet manager
  async init() {
    console.log('🔌 Initializing wallet...');
    
    // Wait a bit for MetaMask to inject if needed
    let retries = 0;
    while (typeof window.ethereum === 'undefined' && retries < 10) {
      console.log('⏳ Waiting for Web3 provider...', retries);
      await new Promise(resolve => setTimeout(resolve, 100));
      retries++;
    }
    
    // Check if MetaMask or other wallet is available
    if (typeof window.ethereum === 'undefined') {
      console.warn('⚠️ No Web3 wallet detected after waiting');
      return false;
    }
    
    this.provider = window.ethereum;
    console.log('✅ Web3 provider found');
    
    // Check if already connected (from localStorage)
    const wasConnected = localStorage.getItem('walletConnected') === 'true';
    
    // Check if already connected
    try {
      const accounts = await this.provider.request({ 
        method: 'eth_accounts' 
      });
      
      if (accounts.length > 0 && wasConnected) {
        console.log('👤 Wallet already connected');
        this.userAddress = accounts[0];
        this.isConnected = true;
        
        // Save to localStorage
        localStorage.setItem('walletConnected', 'true');
        localStorage.setItem('walletAddress', this.userAddress);
        
        // Dispatch connected event
        window.dispatchEvent(new CustomEvent('walletConnected', { 
          detail: { address: this.userAddress } 
        }));
      }
    } catch (error) {
      console.error('❌ Failed to check existing connection:', error);
    }
    
    // Listen for account changes
    this.provider.on('accountsChanged', (accounts) => {
      if (accounts.length === 0) {
        this.onDisconnect();
      } else {
        this.userAddress = accounts[0];
        this.isConnected = true;
        localStorage.setItem('walletAddress', this.userAddress);
        window.dispatchEvent(new CustomEvent('walletConnected', { 
          detail: { address: this.userAddress } 
        }));
      }
    });
    
    // Listen for chain changes
    this.provider.on('chainChanged', () => {
      window.location.reload();
    });
    
    console.log('✅ Wallet manager ready');
    return true;
  }
  
  // Connect wallet
  async connect() {
    console.log('🔌 Connecting wallet...');
    
    if (!this.provider) {
      // Check if ethereum is available but not yet set
      if (typeof window.ethereum !== 'undefined') {
        console.log('Found ethereum, setting provider...');
        this.provider = window.ethereum;
      } else {
        alert('Please install MetaMask or another Web3 wallet!');
        window.open('https://metamask.io/download/', '_blank');
        return false;
      }
    }
    
    try {
      // Request account access
      const accounts = await this.provider.request({ 
        method: 'eth_requestAccounts' 
      });
      
      this.userAddress = accounts[0];
      this.isConnected = true;
      
      // Save to localStorage
      localStorage.setItem('walletConnected', 'true');
      localStorage.setItem('walletAddress', this.userAddress);
      
      console.log('✅ Connected:', this.userAddress);
      
      // Switch to Robinhood Chain
      await this.switchToRobinhoodChain();
      
      // Dispatch connected event
      window.dispatchEvent(new CustomEvent('walletConnected', { 
        detail: { address: this.userAddress } 
      }));
      
      return true;
      
    } catch (error) {
      console.error('❌ Connection failed:', error);
      if (error.code !== 4001) {
        alert('Connection failed: ' + error.message);
      }
      return false;
    }
  }
  
  // Switch to Robinhood Chain
  async switchToRobinhoodChain() {
    try {
      // First check current chain
      const currentChainId = await this.provider.request({ method: 'eth_chainId' });
      console.log('Current chain:', currentChainId, 'Target:', this.chainIdHex);
      
      if (currentChainId === this.chainIdHex) {
        console.log('✅ Already on Robinhood Chain');
        return;
      }
      
      // Try to switch
      await this.provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: this.chainIdHex }],
      });
      console.log('✅ Switched to Robinhood Chain');
    } catch (switchError) {
      console.log('Switch error code:', switchError.code);
      
      // Chain not added, try to add it
      if (switchError.code === 4902) {
        try {
          await this.provider.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: this.chainIdHex,
              chainName: 'Robinhood Testnet',
              nativeCurrency: {
                name: 'ETH',
                symbol: 'ETH',
                decimals: 18
              },
              rpcUrls: ['https://rpc.testnet.chain.robinhood.com'],
              blockExplorerUrls: ['https://explorer.testnet.chain.robinhood.com']
            }],
          });
          console.log('✅ Added Robinhood Chain');
        } catch (addError) {
          console.error('❌ Failed to add chain:', addError);
          
          // If it's already added but with a different name, just inform user
          if (addError.code === -32602 || addError.message?.includes('same RPC')) {
            console.log('⚠️ Chain already exists in MetaMask, please switch manually to Robinhood Chain Testnet');
            alert('Please switch to Robinhood Chain Testnet in MetaMask manually (it\'s already added with a different name)');
            return;
          }
          
          throw addError;
        }
      } else if (switchError.code === 4001) {
        // User rejected
        console.log('User rejected network switch');
        throw switchError;
      } else {
        console.error('❌ Failed to switch chain:', switchError);
        throw switchError;
      }
    }
  }
  
  // Disconnect wallet
  async disconnect() {
    this.onDisconnect();
  }
  
  // Handle disconnect
  onDisconnect() {
    console.log('👋 Wallet disconnected');
    this.isConnected = false;
    this.userAddress = null;
    
    // Clear localStorage
    localStorage.removeItem('walletConnected');
    localStorage.removeItem('walletAddress');
    
    window.dispatchEvent(new Event('walletDisconnected'));
  }
  
  // Get $DNG balance
  async getDNGBalance() {
    if (!this.isConnected) return '0';
    
    try {
      const tokenABI = [
        'function balanceOf(address) view returns (uint256)'
      ];
      
      const provider = new ethers.providers.Web3Provider(this.provider);
      const contract = new ethers.Contract(
        this.tokenContractAddress,
        tokenABI,
        provider
      );
      
      const balance = await contract.balanceOf(this.userAddress);
      return ethers.utils.formatEther(balance);
      
    } catch (error) {
      console.error('❌ Failed to get DNG balance:', error);
      return '0';
    }
  }
  
  // Approve $DNG tokens
  async approveDNG(amount) {
    if (!this.isConnected) {
      alert('Please connect your wallet first!');
      return false;
    }
    
    try {
      console.log('💰 Approving', amount, '$DNG...');
      
      const tokenABI = [
        'function approve(address spender, uint256 amount) returns (bool)',
        'function allowance(address owner, address spender) view returns (uint256)'
      ];
      
      const provider = new ethers.providers.Web3Provider(this.provider);
      const signer = provider.getSigner();
      const contract = new ethers.Contract(
        this.tokenContractAddress,
        tokenABI,
        signer
      );
      
      const amountWei = ethers.utils.parseEther(amount.toString());
      
      // Check current allowance
      const allowance = await contract.allowance(this.userAddress, this.nftContractAddress);
      
      if (allowance.gte(amountWei)) {
        console.log('✅ Already approved');
        return true;
      }
      
      // Request approval
      const tx = await contract.approve(this.nftContractAddress, amountWei);
      console.log('⏳ Waiting for approval...');
      await tx.wait();
      
      console.log('✅ Approved!');
      return true;
      
    } catch (error) {
      console.error('❌ Approval failed:', error);
      if (error.code !== 4001) {
        alert('Approval failed: ' + error.message);
      }
      return false;
    }
  }
  
  // Mint knight
  async mintKnight() {
    if (!this.isConnected) {
      alert('Please connect your wallet first!');
      return null;
    }
    
    try {
      console.log('⚔️ Minting knight...');
      
      const nftABI = [
        'function mintKnight() returns (uint256)'
      ];
      
      const provider = new ethers.providers.Web3Provider(this.provider);
      const signer = provider.getSigner();
      const contract = new ethers.Contract(
        this.nftContractAddress,
        nftABI,
        signer
      );
      
      const tx = await contract.mintKnight();
      console.log('📝 Transaction sent:', tx.hash);
      
      console.log('⏳ Waiting for confirmation...');
      const receipt = await tx.wait();
      
      console.log('✅ Knight minted!');
      
      return {
        success: true,
        txHash: tx.hash,
        blockNumber: receipt.blockNumber
      };
      
    } catch (error) {
      console.error('❌ Mint failed:', error);
      if (error.code !== 4001) {
        alert('Mint failed: ' + error.message);
      }
      return null;
    }
  }
  
  // Get knights from blockchain
  async getMyKnights() {
    if (!this.isConnected) return [];
    
    try {
      console.log('📦 Fetching knights from blockchain...');
      
      const nftABI = [
        'function balanceOf(address) view returns (uint256)',
        'function totalMinted() view returns (uint256)',
        'function getKnightInfo(uint256) view returns (address owner, uint8 rarity, string memory rarityName)'
      ];
      
      const provider = new ethers.providers.Web3Provider(this.provider);
      const contract = new ethers.Contract(
        this.nftContractAddress,
        nftABI,
        provider
      );
      
      const balance = await contract.balanceOf(this.userAddress);
      const knightCount = balance.toNumber();
      
      console.log('Found', knightCount, 'knights');
      
      if (knightCount === 0) return [];
      
      const knights = [];
      const totalMinted = (await contract.totalMinted()).toNumber();
      
      for (let tokenId = 0; tokenId < totalMinted && knights.length < knightCount; tokenId++) {
        try {
          const info = await contract.getKnightInfo(tokenId);
          
          if (info.owner.toLowerCase() === this.userAddress.toLowerCase()) {
            const rarityNames = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
            knights.push({
              tokenId,
              rarity: rarityNames[info.rarity] || 'common',
              owner: info.owner
            });
          }
        } catch (e) {
          // Token doesn't exist, skip
        }
      }
      
      console.log('✅ Loaded', knights.length, 'knights');
      return knights;
      
    } catch (error) {
      console.error('❌ Failed to fetch knights:', error);
      return [];
    }
  }
}

// Create global instance
console.log('🔧 Creating global WalletManager...');
window.walletManager = new WalletManager();

// Initialize immediately when script loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('🎯 DOM ready, initializing wallet...');
    window.walletManager.init();
  });
} else {
  // DOM already loaded
  console.log('🎯 DOM already ready, initializing wallet...');
  window.walletManager.init();
}

console.log('✅ wallet.js loaded');
