// Privy Integration - Multi-Wallet Support
// Supports MetaMask, Coinbase, WalletConnect, Email, Social Login

class PrivyWalletManager {
  constructor() {
    this.privy = null;
    this.authenticated = false;
    this.user = null;
    this.provider = null;
    this.signer = null;
    this.address = null;
    
    this.init();
  }
  
  async init() {
    // Check if Privy is enabled
    if (!window.DUNGEON_CONFIG.PRIVY.enabled) {
      console.log('ℹ️ Privy disabled, using MetaMask only');
      return;
    }
    
    // Wait for Privy SDK to load
    await this.waitForPrivySDK();
    
    // Check if Privy SDK is loaded
    if (typeof Privy === 'undefined' && typeof window.Privy === 'undefined') {
      console.error('❌ Privy SDK not loaded - falling back to MetaMask');
      window.DUNGEON_CONFIG.PRIVY.enabled = false; // Disable and fallback
      return;
    }
    
    try {
      // Initialize Privy
      const PrivyConstructor = typeof Privy !== 'undefined' ? Privy : window.Privy;
      
      this.privy = new PrivyConstructor.PrivyClient({
        appId: window.DUNGEON_CONFIG.PRIVY.appId,
      });
      
      // Check if user is already logged in
      const isAuthenticated = await this.privy.isAuthenticated();
      if (isAuthenticated) {
        console.log('🔄 User already authenticated');
        await this.handleAuthenticated();
      }
      
      // Listen for auth events
      this.privy.on('login', () => this.handleAuthenticated());
      this.privy.on('logout', () => this.handleLogout());
      
      console.log('✅ Privy initialized');
    } catch (error) {
      console.error('❌ Privy init failed:', error);
      window.DUNGEON_CONFIG.PRIVY.enabled = false; // Disable and fallback
    }
  }
  
  async waitForPrivySDK() {
    let attempts = 0;
    while (attempts < 30) {
      if (typeof Privy !== 'undefined' || typeof window.Privy !== 'undefined') {
        console.log('✅ Privy SDK loaded');
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
    console.warn('⚠️ Privy SDK timeout');
    return false;
  }
  
  async connect() {
    if (!this.privy) {
      alert('⚠️ Wallet connection not available');
      return false;
    }
    
    try {
      // Open Privy login modal (shows all wallet options)
      await this.privy.login();
      return true;
    } catch (error) {
      console.error('❌ Connection failed:', error);
      return false;
    }
  }
  
  async handleAuthenticated() {
    try {
      this.authenticated = true;
      this.user = await this.privy.getUser();
      
      // Get wallet address
      const wallet = this.user.wallet;
      if (wallet) {
        this.address = wallet.address;
        console.log('✅ Connected:', this.address);
        
        // Get provider for ethers.js
        this.provider = await this.privy.getProvider();
        
        // Store in localStorage for persistence
        localStorage.setItem('walletConnected', 'true');
        localStorage.setItem('walletAddress', this.address);
        localStorage.setItem('walletType', wallet.walletClientType || 'privy');
        
        // Switch to correct network
        await this.switchNetwork();
        
        // Create ethers provider and signer
        if (typeof ethers !== 'undefined') {
          this.ethersProvider = new ethers.providers.Web3Provider(this.provider);
          this.signer = this.ethersProvider.getSigner();
        }
        
        // Trigger update event
        window.dispatchEvent(new CustomEvent('walletConnected', {
          detail: { address: this.address, provider: this.provider }
        }));
        
        return true;
      }
    } catch (error) {
      console.error('❌ Auth handling failed:', error);
      return false;
    }
  }
  
  async handleLogout() {
    this.authenticated = false;
    this.user = null;
    this.address = null;
    this.provider = null;
    this.signer = null;
    
    localStorage.removeItem('walletConnected');
    localStorage.removeItem('walletAddress');
    localStorage.removeItem('walletType');
    
    console.log('🔌 Disconnected');
    
    window.dispatchEvent(new Event('walletDisconnected'));
  }
  
  async disconnect() {
    if (!this.privy) return;
    
    try {
      await this.privy.logout();
    } catch (error) {
      console.error('❌ Disconnect failed:', error);
    }
  }
  
  async switchNetwork() {
    if (!this.provider) return;
    
    const networkConfig = window.DUNGEON_CONFIG.getNetworkConfig();
    const chainId = networkConfig.chainIdDecimal;
    
    try {
      // Check current network
      const currentChainId = await this.provider.request({ method: 'eth_chainId' });
      const currentChainIdNum = parseInt(currentChainId, 16);
      
      if (currentChainIdNum === chainId) {
        console.log('✅ Already on correct network');
        return;
      }
      
      // Try to switch
      await this.provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: networkConfig.chainId }],
      });
      
      console.log('✅ Switched to', networkConfig.name);
    } catch (switchError) {
      // Network not added, try to add it
      if (switchError.code === 4902) {
        try {
          await this.provider.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: networkConfig.chainId,
              chainName: networkConfig.name,
              nativeCurrency: networkConfig.currency,
              rpcUrls: [networkConfig.rpc],
              blockExplorerUrls: [networkConfig.explorer]
            }],
          });
          console.log('✅ Added', networkConfig.name);
        } catch (addError) {
          console.error('❌ Failed to add network:', addError);
        }
      }
    }
  }
  
  isConnected() {
    return this.authenticated && this.address !== null;
  }
  
  getAddress() {
    return this.address;
  }
  
  getProvider() {
    return this.provider;
  }
  
  getSigner() {
    return this.signer;
  }
}

// Initialize Privy wallet manager
window.addEventListener('DOMContentLoaded', () => {
  if (window.DUNGEON_CONFIG && window.DUNGEON_CONFIG.PRIVY.enabled) {
    window.privyWallet = new PrivyWalletManager();
  }
});
