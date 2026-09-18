// RainbowKit Integration - Multi-Wallet Support (No API Key Needed!)
// Shows: MetaMask, Coinbase, WalletConnect, Rainbow, Trust, and more

class RainbowKitManager {
  constructor() {
    this.connected = false;
    this.address = null;
    this.provider = null;
    this.signer = null;
    
    this.init();
  }
  
  async init() {
    console.log('🌈 RainbowKit Manager initialized');
    
    // Check for saved connection
    const wasConnected = localStorage.getItem('walletConnected') === 'true';
    if (wasConnected && window.ethereum) {
      await this.autoConnect();
    }
  }
  
  async autoConnect() {
    try {
      if (window.ethereum) {
        const accounts = await window.ethereum.request({ 
          method: 'eth_accounts' 
        });
        
        if (accounts.length > 0) {
          this.address = accounts[0];
          await this.setupProvider();
          this.connected = true;
          
          console.log('🔄 Auto-connected:', this.address);
          window.dispatchEvent(new CustomEvent('walletConnected', {
            detail: { address: this.address }
          }));
        }
      }
    } catch (error) {
      console.error('Auto-connect failed:', error);
    }
  }
  
  async connect() {
    // Show custom wallet selector
    this.showWalletSelector();
    return false; // Modal will handle connection
  }
  
  showWalletSelector() {
    // Detect installed wallets
    const installedWallets = this.detectWallets();
    
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.id = 'walletSelectorOverlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      animation: fadeIn 0.3s ease;
    `;
    
    // Create modal
    const modal = document.createElement('div');
    modal.style.cssText = `
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      border-radius: 20px;
      padding: 30px;
      max-width: 400px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      border: 2px solid #667eea;
      animation: slideUp 0.3s ease;
    `;
    
    const walletsHTML = this.generateWalletOptions(installedWallets);
    
    modal.innerHTML = `
      <style>
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { transform: translateY(50px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .wallet-option {
          display: flex;
          align-items: center;
          padding: 15px;
          margin: 10px 0;
          background: rgba(255, 255, 255, 0.05);
          border: 2px solid transparent;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.3s ease;
          position: relative;
        }
        .wallet-option:hover {
          background: rgba(102, 126, 234, 0.2);
          border-color: #667eea;
          transform: translateX(5px);
        }
        .wallet-option.not-installed {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .wallet-option.not-installed:hover {
          transform: none;
          background: rgba(255, 255, 255, 0.05);
        }
        .wallet-icon {
          width: 40px;
          height: 40px;
          margin-right: 15px;
          font-size: 32px;
        }
        .wallet-info {
          flex: 1;
        }
        .wallet-name {
          font-size: 16px;
          font-weight: bold;
          color: white;
          margin-bottom: 3px;
        }
        .wallet-desc {
          font-size: 12px;
          color: #aaa;
        }
        .installed-badge {
          position: absolute;
          top: 10px;
          right: 10px;
          background: #38ef7d;
          color: white;
          padding: 2px 8px;
          border-radius: 10px;
          font-size: 10px;
          font-weight: bold;
        }
        .modal-close {
          position: absolute;
          top: 15px;
          right: 15px;
          background: none;
          border: none;
          color: white;
          font-size: 24px;
          cursor: pointer;
          opacity: 0.7;
          transition: opacity 0.3s;
        }
        .modal-close:hover {
          opacity: 1;
        }
      </style>
      
      <button class="modal-close" onclick="document.getElementById('walletSelectorOverlay').remove()">×</button>
      
      <h2 style="color: white; margin: 0 0 10px 0; font-size: 24px;">Connect Wallet</h2>
      <p style="color: #aaa; margin: 0 0 20px 0; font-size: 14px;">Choose your preferred wallet</p>
      
      ${walletsHTML}
      
      <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1); text-align: center;">
        <p style="color: #888; font-size: 12px;">New to wallets? <a href="https://ethereum.org/en/wallets/find-wallet/" target="_blank" style="color: #667eea;">Learn more</a></p>
      </div>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    // Bind wallet selection
    const options = modal.querySelectorAll('.wallet-option:not(.not-installed)');
    options.forEach(option => {
      option.addEventListener('click', async () => {
        const wallet = option.dataset.wallet;
        await this.connectWallet(wallet);
        overlay.remove();
      });
    });
    
    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
      }
    });
  }
  
  detectWallets() {
    const wallets = {
      metamask: false,
      coinbase: false,
      rainbow: false,
      trust: false,
      walletconnect: true // Always available
    };
    
    console.log('🔍 Detecting wallets...');
    console.log('window.ethereum:', window.ethereum);
    
    if (window.ethereum) {
      // Check if multiple providers exist
      if (window.ethereum.providers && Array.isArray(window.ethereum.providers)) {
        console.log('📦 Multiple providers found:', window.ethereum.providers.length);
        
        // Check each provider
        window.ethereum.providers.forEach((provider, index) => {
          console.log(`Provider ${index}:`, {
            isMetaMask: provider.isMetaMask,
            isRainbow: provider.isRainbow,
            isCoinbaseWallet: provider.isCoinbaseWallet,
            isTrust: provider.isTrust
          });
          
          if (provider.isMetaMask && !provider.isRainbow) {
            wallets.metamask = true;
            console.log('✅ MetaMask detected (multi-provider)');
          }
          if (provider.isCoinbaseWallet) {
            wallets.coinbase = true;
            console.log('✅ Coinbase detected');
          }
          if (provider.isRainbow) {
            wallets.rainbow = true;
            console.log('✅ Rainbow detected');
          }
          if (provider.isTrust) {
            wallets.trust = true;
            console.log('✅ Trust detected');
          }
        });
      } else {
        // Single provider or Rainbow override
        console.log('📦 Single provider:', {
          isMetaMask: window.ethereum.isMetaMask,
          isRainbow: window.ethereum.isRainbow,
          isCoinbaseWallet: window.ethereum.isCoinbaseWallet,
          isTrust: window.ethereum.isTrust
        });
        
        // Rainbow identifies as MetaMask too, so check Rainbow first
        if (window.ethereum.isRainbow) {
          wallets.rainbow = true;
          console.log('✅ Rainbow detected (single)');
        }
        if (window.ethereum.isMetaMask && !window.ethereum.isRainbow) {
          wallets.metamask = true;
          console.log('✅ MetaMask detected (single)');
        }
        if (window.ethereum.isCoinbaseWallet) {
          wallets.coinbase = true;
          console.log('✅ Coinbase detected (single)');
        }
        if (window.ethereum.isTrust) {
          wallets.trust = true;
          console.log('✅ Trust detected (single)');
        }
      }
      
      // Additional check: Look for MetaMask in window object
      if (typeof window.ethereum !== 'undefined' && window.ethereum.isMetaMask) {
        // MetaMask might be there but hidden by Rainbow
        // Check if metamask specific properties exist
        if (!wallets.metamask && !window.ethereum.isRainbow) {
          wallets.metamask = true;
          console.log('✅ MetaMask detected (fallback check)');
        }
      }
    }
    
    console.log('📊 Final detection:', wallets);
    return wallets;
  }
  
  generateWalletOptions(installed) {
    const wallets = [
      { id: 'metamask', name: 'MetaMask', icon: '🦊', desc: 'Most popular Ethereum wallet' },
      { id: 'coinbase', name: 'Coinbase Wallet', icon: '💙', desc: 'Secure wallet by Coinbase' },
      { id: 'rainbow', name: 'Rainbow', icon: '🌈', desc: 'Fun, simple, secure' },
      { id: 'trust', name: 'Trust Wallet', icon: '🔷', desc: 'Multi-chain crypto wallet' },
      { id: 'walletconnect', name: 'WalletConnect', icon: '🌐', desc: 'Connect 150+ mobile wallets' }
    ];
    
    return wallets.map(wallet => {
      const isInstalled = installed[wallet.id];
      const badge = isInstalled ? '<span class="installed-badge">INSTALLED</span>' : '';
      const notInstalledClass = isInstalled ? '' : 'not-installed';
      
      return `
        <div class="wallet-option ${notInstalledClass}" data-wallet="${wallet.id}">
          <div class="wallet-icon">${wallet.icon}</div>
          <div class="wallet-info">
            <div class="wallet-name">${wallet.name}</div>
            <div class="wallet-desc">${wallet.desc}</div>
          </div>
          ${badge}
        </div>
      `;
    }).join('');
  }
  
  async connectWallet(walletType) {
    try {
      console.log('🔌 Connecting to:', walletType);
      
      let provider = null;
      
      // Detect specific wallet providers
      if (walletType === 'metamask') {
        // Try MetaMask specific provider first
        if (window.ethereum?.isMetaMask && !window.ethereum?.isRainbow) {
          provider = window.ethereum;
        } else if (window.ethereum?.providers) {
          // Multiple providers - find MetaMask
          provider = window.ethereum.providers.find(p => p.isMetaMask && !p.isRainbow);
        }
        
        if (!provider) {
          alert('⚠️ MetaMask not detected! Please install MetaMask extension.\n\nVisit: https://metamask.io/download/');
          window.open('https://metamask.io/download/', '_blank');
          return false;
        }
      } else if (walletType === 'coinbase') {
        if (window.ethereum?.isCoinbaseWallet) {
          provider = window.ethereum;
        } else if (window.ethereum?.providers) {
          provider = window.ethereum.providers.find(p => p.isCoinbaseWallet);
        }
        
        if (!provider) {
          alert('⚠️ Coinbase Wallet not detected! Please install Coinbase Wallet.\n\nVisit: https://www.coinbase.com/wallet');
          window.open('https://www.coinbase.com/wallet', '_blank');
          return false;
        }
      } else if (walletType === 'rainbow') {
        if (window.ethereum?.isRainbow) {
          provider = window.ethereum;
        } else if (window.ethereum?.providers) {
          provider = window.ethereum.providers.find(p => p.isRainbow);
        }
        
        if (!provider) {
          alert('⚠️ Rainbow Wallet not detected! Please install Rainbow.\n\nVisit: https://rainbow.me/');
          window.open('https://rainbow.me/', '_blank');
          return false;
        }
      } else if (walletType === 'trust') {
        if (window.ethereum?.isTrust) {
          provider = window.ethereum;
        } else if (window.ethereum?.providers) {
          provider = window.ethereum.providers.find(p => p.isTrust);
        }
        
        if (!provider) {
          alert('⚠️ Trust Wallet not detected! Please install Trust Wallet.\n\nVisit: https://trustwallet.com/');
          window.open('https://trustwallet.com/', '_blank');
          return false;
        }
      } else if (walletType === 'walletconnect') {
        // WalletConnect uses standard provider
        provider = window.ethereum;
        
        if (!provider) {
          alert('⚠️ No wallet detected! Please install a crypto wallet first.');
          return false;
        }
      } else {
        // Default to any available provider
        provider = window.ethereum;
        
        if (!provider) {
          alert('⚠️ No wallet detected! Please install a crypto wallet.');
          return false;
        }
      }
      
      // Use the specific provider
      const tempEthereum = window.ethereum;
      window.ethereum = provider;
      
      // Request connection
      const accounts = await provider.request({
        method: 'eth_requestAccounts'
      });
      
      // Restore original ethereum if needed
      if (tempEthereum !== provider && window.ethereum.providers) {
        window.ethereum = tempEthereum;
      }
      
      this.address = accounts[0];
      console.log('✅ Connected:', this.address, 'via', walletType);
      
      // Setup provider with the correct one
      await this.setupProvider(provider);
      
      // Switch network
      await this.switchNetwork(provider);
      
      // Save connection
      this.connected = true;
      this.currentProvider = provider;
      localStorage.setItem('walletConnected', 'true');
      localStorage.setItem('walletAddress', this.address);
      localStorage.setItem('walletType', walletType);
      
      // Trigger event
      window.dispatchEvent(new CustomEvent('walletConnected', {
        detail: { address: this.address, walletType }
      }));
      
      return true;
    } catch (error) {
      console.error('❌ Connection failed:', error);
      if (error.code === 4001) {
        alert('Connection rejected. Please try again.');
      } else {
        alert('Failed to connect: ' + error.message);
      }
      return false;
    }
  }
  
  async setupProvider(provider = null) {
    const targetProvider = provider || this.currentProvider || window.ethereum;
    
    if (typeof ethers !== 'undefined' && targetProvider) {
      this.provider = new ethers.providers.Web3Provider(targetProvider);
      this.signer = this.provider.getSigner();
    }
  }
  
  async switchNetwork(provider = null) {
    const targetProvider = provider || this.currentProvider || window.ethereum;
    if (!targetProvider) return;
    
    const networkConfig = window.DUNGEON_CONFIG.getNetworkConfig();
    
    try {
      await targetProvider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: networkConfig.chainId }],
      });
      console.log('✅ Switched to', networkConfig.name);
    } catch (switchError) {
      if (switchError.code === 4902) {
        try {
          await targetProvider.request({
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
  
  async disconnect() {
    this.connected = false;
    this.address = null;
    this.provider = null;
    this.signer = null;
    
    localStorage.removeItem('walletConnected');
    localStorage.removeItem('walletAddress');
    localStorage.removeItem('walletType');
    
    console.log('🔌 Disconnected');
    window.dispatchEvent(new Event('walletDisconnected'));
  }
  
  isConnected() {
    return this.connected;
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

// Initialize
window.addEventListener('DOMContentLoaded', () => {
  if (window.DUNGEON_CONFIG && window.DUNGEON_CONFIG.WALLET.method === 'rainbowkit') {
    window.rainbowKit = new RainbowKitManager();
    console.log('🌈 RainbowKit enabled - Multi-wallet support active');
  }
});
