// Wallet Manager with Direct Web3 Integration
//
// Where the provider comes from is not decided here — `public/wallet-source.js` (loaded
// before this file) settles that: an injected extension when there is one, an embedded
// wallet when the server is configured for it, and nothing at all otherwise. Everything
// below still speaks plain EIP-1193, so the same code serves both.
console.log('🔧 Loading wallet.js...');

class WalletManager {
  constructor() {
    this.provider = null;
    this.userAddress = null;
    this.isConnected = false;
    // 'injected' or 'embedded' — read by the UI when it needs to say which wallet is in
    // use (an embedded one has to be funded before it can pay gas).
    this.walletKind = null;
    
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

    // The source waits briefly for a late-injecting extension, then falls back to a
    // silently restored embedded session (no UI — a returning player is just signed in).
    const source = window.DKWallet;
    const provider = source
      ? await source.provider({ waitMs: 1000 })
      : (typeof window.ethereum !== 'undefined' ? window.ethereum : null);

    if (!provider) {
      console.warn('⚠️ No Web3 wallet available');
      return false;
    }

    this.provider = provider;
    this.walletKind = (source && source.kind && source.kind()) || 'injected';
    console.log('✅ Web3 provider found', this.walletKind === 'embedded' ? '(embedded wallet)' : '');
    
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
      const source = window.DKWallet;
      if (source) {
        // Asks the source for a provider, which is where an embedded wallet's email
        // sign-in happens. Returns null when this browser has no wallet to offer.
        try {
          this.provider = await source.connect();
          this.walletKind = source.kind ? source.kind() : null;
        } catch (error) {
          console.error('❌ Wallet sign-in failed:', error);
          alert(error.message || 'Wallet sign-in failed. Please try again.');
          return false;
        }
      } else if (typeof window.ethereum !== 'undefined') {
        console.log('Found ethereum, setting provider...');
        this.provider = window.ethereum;
        this.walletKind = 'injected';
      }

      if (!this.provider) {
        // Honest about the device, and still useful on a desktop: the download link stays
        // for someone who can install an extension, and is not offered to a phone that
        // cannot.
        const mobile = source && source.isMobile && source.isMobile();
        alert((source && source.unavailableMessage && source.unavailableMessage())
          || 'Please install MetaMask or another Web3 wallet!');
        if (!mobile) window.open('https://metamask.io/download/', '_blank');
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
    // An embedded wallet is a real session on Privy's side: clearing localStorage alone
    // would sign the player back in on the next page load.
    if (this.walletKind === 'embedded' && window.DKWallet && window.DKWallet.disconnect) {
      await window.DKWallet.disconnect();
    }
    this.walletKind = null;
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

  // Batch mint knights (up to 10 in parallel)
  async batchMintKnights(quantity) {
    if (!this.isConnected) {
      alert('Please connect your wallet first!');
      return null;
    }

    if (quantity < 1 || quantity > 10) {
      alert('Can only mint 1-10 knights at a time');
      return null;
    }

    try {
      console.log(`⚔️ Batch minting ${quantity} knights...`);
      
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

      const results = [];
      const promises = [];
      
      // Send all transactions in parallel
      for (let i = 0; i < quantity; i++) {
        console.log(`📝 Sending mint transaction ${i + 1}/${quantity}...`);
        promises.push(contract.mintKnight());
      }

      // Wait for all transactions to be sent
      const transactions = await Promise.all(promises);
      console.log(`✅ All ${quantity} transactions sent!`);

      // Wait for all confirmations
      for (let i = 0; i < transactions.length; i++) {
        console.log(`⏳ Waiting for confirmation ${i + 1}/${quantity}... (tx: ${transactions[i].hash})`);
        const receipt = await transactions[i].wait();
        results.push({
          success: true,
          txHash: transactions[i].hash,
          blockNumber: receipt.blockNumber
        });
        console.log(`✅ Knight ${i + 1}/${quantity} minted!`);
      }

      console.log(`🎉 All ${quantity} knights minted successfully!`);
      
      return {
        success: true,
        count: quantity,
        results: results
      };
      
    } catch (error) {
      console.error('❌ Batch mint failed:', error);
      if (error.code !== 4001) {
        alert('Batch mint failed: ' + error.message);
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
