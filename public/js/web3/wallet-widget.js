// Wallet Widget - Reusable wallet connection UI for all pages

class WalletWidget {
  constructor(buttonId) {
    this.walletBtn = document.getElementById(buttonId);
    this.dropdownOpen = false;
    
    if (!this.walletBtn) {
      console.error('Wallet button not found:', buttonId);
      return;
    }
    
    this.init();
  }
  
  async init() {
    // Wait for wallet managers to load
    await this.waitForWalletManagers();
    
    // Determine which wallet system to use
    this.usePrivy = window.DUNGEON_CONFIG && 
                    window.DUNGEON_CONFIG.PRIVY.enabled && 
                    window.privyWallet;
    
    console.log('🔗 Wallet system:', this.usePrivy ? 'Privy (Multi-wallet)' : 'MetaMask');
    
    // Try auto-reconnect
    if (this.usePrivy) {
      // Privy handles auto-reconnect
      if (window.privyWallet.isConnected()) {
        this.updateUI();
      }
    } else {
      // MetaMask auto-reconnect
      await window.web3Manager.autoReconnect();
      this.updateUI();
    }
    
    // Bind events
    this.walletBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.isConnected()) {
        this.toggleDropdown();
      } else {
        this.handleConnect();
      }
    });
    
    // Listen for wallet events
    window.addEventListener('walletConnected', () => this.updateUI());
    window.addEventListener('walletDisconnected', () => this.updateUI());
    
    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      if (this.dropdownOpen) {
        this.closeDropdown();
      }
    });
    
    // Listen for account changes (MetaMask)
    if (window.ethereum && !this.usePrivy) {
      window.ethereum.on('accountsChanged', (accounts) => {
        if (accounts.length === 0) {
          window.web3Manager.disconnect();
          this.updateUI();
        } else {
          window.web3Manager.userAddress = accounts[0];
          localStorage.setItem('walletAddress', accounts[0]);
          this.updateUI();
        }
      });
      
      window.ethereum.on('chainChanged', () => {
        window.location.reload();
      });
    }
  }
  
  async waitForWalletManagers() {
    let attempts = 0;
    while (attempts < 50) {
      const hasMetaMask = typeof window.web3Manager !== 'undefined';
      const hasPrivy = typeof window.privyWallet !== 'undefined';
      const hasRainbow = typeof window.rainbowKit !== 'undefined';
      const walletMethod = window.DUNGEON_CONFIG && window.DUNGEON_CONFIG.WALLET.method;
      
      if (hasMetaMask || hasPrivy || hasRainbow || walletMethod === 'metamask') {
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
  }
  
  isConnected() {
    const method = window.DUNGEON_CONFIG && window.DUNGEON_CONFIG.WALLET.method;
    
    if (method === 'rainbowkit' && window.rainbowKit) {
      return window.rainbowKit.isConnected();
    } else if (this.usePrivy && window.privyWallet) {
      return window.privyWallet.isConnected();
    } else if (window.web3Manager) {
      return window.web3Manager.isConnected;
    }
    return false;
  }
  
  async handleConnect() {
    const method = window.DUNGEON_CONFIG && window.DUNGEON_CONFIG.WALLET.method;
    
    if (method === 'rainbowkit' && window.rainbowKit) {
      await window.rainbowKit.connect();
      // Modal will handle connection and trigger update
    } else if (this.usePrivy && window.privyWallet) {
      const connected = await window.privyWallet.connect();
      if (connected) this.updateUI();
    } else if (window.web3Manager) {
      const connected = await window.web3Manager.connect();
      if (connected) this.updateUI();
    }
  }
  
  handleDisconnect() {
    const method = window.DUNGEON_CONFIG && window.DUNGEON_CONFIG.WALLET.method;
    
    if (method === 'rainbowkit' && window.rainbowKit) {
      window.rainbowKit.disconnect();
    } else if (this.usePrivy && window.privyWallet) {
      window.privyWallet.disconnect();
    } else if (window.web3Manager) {
      window.web3Manager.disconnect();
    }
    
    this.updateUI();
    this.closeDropdown();
  }
  
  toggleDropdown() {
    if (this.dropdownOpen) {
      this.closeDropdown();
    } else {
      this.openDropdown();
    }
  }
  
  openDropdown() {
    // Create dropdown if it doesn't exist
    if (!this.dropdown) {
      this.createDropdown();
    }
    
    this.dropdown.classList.add('show');
    this.dropdownOpen = true;
  }
  
  closeDropdown() {
    if (this.dropdown) {
      this.dropdown.classList.remove('show');
    }
    this.dropdownOpen = false;
  }
  
  createDropdown() {
    this.dropdown = document.createElement('div');
    this.dropdown.className = 'wallet-dropdown';
    this.dropdown.innerHTML = `
      <div class="wallet-dropdown-item wallet-type">
        <span class="label">Wallet:</span>
        <span class="value" id="dropdownWalletType">MetaMask</span>
      </div>
      <div class="wallet-dropdown-item wallet-address">
        <span class="label">Address:</span>
        <span class="value" id="dropdownAddress"></span>
      </div>
      <div class="wallet-dropdown-item wallet-network">
        <span class="label">Network:</span>
        <span class="value" id="dropdownNetwork"></span>
      </div>
      <div class="wallet-dropdown-divider"></div>
      <button class="wallet-dropdown-btn disconnect-btn" id="disconnectBtn">
        🔌 Disconnect Wallet
      </button>
    `;
    
    // Insert dropdown after button
    this.walletBtn.parentNode.style.position = 'relative';
    this.walletBtn.parentNode.appendChild(this.dropdown);
    
    // Bind disconnect button
    const disconnectBtn = this.dropdown.querySelector('#disconnectBtn');
    disconnectBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleDisconnect();
    });
    
    // Prevent dropdown clicks from closing it
    this.dropdown.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }
  
  updateUI() {
    let address = null;
    let walletType = 'Unknown';
    const method = window.DUNGEON_CONFIG && window.DUNGEON_CONFIG.WALLET.method;
    
    if (method === 'rainbowkit' && window.rainbowKit) {
      address = window.rainbowKit.getAddress();
      walletType = localStorage.getItem('walletType') || 'Wallet';
    } else if (this.usePrivy && window.privyWallet) {
      address = window.privyWallet.getAddress();
      walletType = localStorage.getItem('walletType') || 'Privy';
    } else if (window.web3Manager) {
      address = window.web3Manager.userAddress;
      walletType = 'MetaMask';
    }
    
    if (address) {
      const short = address.slice(0, 6) + '...' + address.slice(-4);
      this.walletBtn.textContent = '🔗 ' + short;
      this.walletBtn.classList.add('connected');
      this.walletBtn.title = 'Click for options';
      
      // Update dropdown if it exists
      if (this.dropdown) {
        const addrElem = this.dropdown.querySelector('#dropdownAddress');
        const networkElem = this.dropdown.querySelector('#dropdownNetwork');
        const walletTypeElem = this.dropdown.querySelector('#dropdownWalletType');
        
        if (addrElem) addrElem.textContent = address;
        if (networkElem) {
          const network = window.DUNGEON_CONFIG.getCurrentNetwork();
          networkElem.textContent = network === 'mainnet' ? 'Robinhood Mainnet' : 'Robinhood Testnet';
        }
        if (walletTypeElem) {
          walletTypeElem.textContent = walletType;
        }
      }
    } else {
      this.walletBtn.textContent = '🔌 Connect Wallet';
      this.walletBtn.classList.remove('connected');
      this.walletBtn.title = 'Connect Wallet';
      this.closeDropdown();
    }
  }
}

// Auto-initialize if button exists
window.addEventListener('DOMContentLoaded', () => {
  const walletBtn = document.getElementById('connectWalletBtn');
  if (walletBtn && !window.walletWidget) {
    window.walletWidget = new WalletWidget('connectWalletBtn');
  }
});
