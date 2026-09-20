// Shared Header Component with Wallet Integration
console.log('🔧 Loading shared-header.js...');

class SharedHeader {
  constructor() {
    this.walletManager = null;
    this.headerElement = null;
  }
  
  // Initialize header
  async init() {
    console.log('🎯 Initializing shared header...');
    
    // Get or create wallet manager
    if (!window.walletManager) {
      console.error('❌ WalletManager not found!');
      return;
    }
    
    this.walletManager = window.walletManager;
    
    // Create header if it doesn't exist
    this.createHeader();
    
    // Setup wallet listeners
    this.setupWalletListeners();
    
    // Update display if already connected
    if (this.walletManager.isConnected) {
      this.onWalletConnected();
    }
    
    console.log('✅ Shared header ready');
  }
  
  createHeader() {
    // Check if custom header already exists
    let existingHeader = document.getElementById('shared-wallet-header');

    // Some pages (e.g. the game) already render and manage their own wallet
    // UI. Don't inject a second, duplicate copy there.
    if (
      !existingHeader &&
      (document.getElementById('disconnectBtn') ||
        document.getElementById('walletAddressDisplay'))
    ) {
      console.log('ℹ️ Existing wallet UI detected — skipping shared wallet header');
      return;
    }

    if (!existingHeader) {
      // Create new header element
      const header = document.createElement('div');
      header.id = 'shared-wallet-header';
      header.className = 'shared-wallet-header';
      header.innerHTML = `
        <div class="wallet-info">
          <div id="wallet-address-display" style="display: none;">
            <span class="wallet-label">Wallet:</span>
            <span id="wallet-address-text"></span>
          </div>
          <div id="wallet-balance-display" style="display: none;">
            <span class="wallet-label">Balance:</span>
            <span id="wallet-balance-text">0</span> $DNG
          </div>
        </div>
        <button id="shared-connect-wallet" class="shared-wallet-btn">
          🔌 Connect Wallet
        </button>
      `;
      
      // Prefer the header's existing right-hand action cluster so the wallet
      // controls sit with the rest of the header actions instead of wrapping.
      const container = document.querySelector('.mint-header, .game-header, header') || document.body;
      const rightSection =
        container.querySelector && container.querySelector('.header-actions, .header-right');

      if (rightSection) {
        rightSection.appendChild(header);
      } else if (
        container.tagName === 'HEADER' ||
        container.classList.contains('mint-header') ||
        container.classList.contains('game-header')
      ) {
        container.appendChild(header);
      } else {
        container.insertBefore(header, container.firstChild);
      }

      // The shared header already shows address + balance, so hide the
      // legacy balance-only pill to avoid a duplicated readout.
      const legacyPill = (rightSection || container).querySelector('.wallet-pill');
      if (legacyPill && !legacyPill.querySelector('#disconnectBtn')) {
        legacyPill.style.display = 'none';
      }
      
      this.headerElement = header;
    } else {
      this.headerElement = existingHeader;
    }
    
    // Setup button click
    const connectBtn = document.getElementById('shared-connect-wallet');
    if (connectBtn) {
      connectBtn.addEventListener('click', () => this.handleWalletClick());
    }
  }
  
  setupWalletListeners() {
    window.addEventListener('walletConnected', () => this.onWalletConnected());
    window.addEventListener('walletDisconnected', () => this.onWalletDisconnected());
  }
  
  async handleWalletClick() {
    if (this.walletManager.isConnected) {
      // Disconnect
      await this.walletManager.disconnect();
    } else {
      // Connect
      await this.walletManager.connect();
    }
  }
  
  async onWalletConnected() {
    console.log('✅ Header: Wallet connected');
    
    // Update button
    const connectBtn = document.getElementById('shared-connect-wallet');
    if (connectBtn) {
      connectBtn.textContent = 'Disconnect';
      connectBtn.classList.add('connected');
    }
    
    // Show and update address
    const addressDisplay = document.getElementById('wallet-address-display');
    const addressText = document.getElementById('wallet-address-text');
    if (addressDisplay && addressText && this.walletManager.userAddress) {
      const shortAddress = this.walletManager.userAddress.slice(0, 6) + '...' + 
                          this.walletManager.userAddress.slice(-4);
      addressText.textContent = shortAddress;
      addressDisplay.style.display = 'block';
    }
    
    // Show and update balance
    const balanceDisplay = document.getElementById('wallet-balance-display');
    if (balanceDisplay) {
      balanceDisplay.style.display = 'block';
      await this.updateBalance();
    }
  }
  
  onWalletDisconnected() {
    console.log('👋 Header: Wallet disconnected');
    
    // Update button
    const connectBtn = document.getElementById('shared-connect-wallet');
    if (connectBtn) {
      connectBtn.textContent = '🔌 Connect Wallet';
      connectBtn.classList.remove('connected');
    }
    
    // Hide address
    const addressDisplay = document.getElementById('wallet-address-display');
    if (addressDisplay) {
      addressDisplay.style.display = 'none';
    }
    
    // Hide balance
    const balanceDisplay = document.getElementById('wallet-balance-display');
    if (balanceDisplay) {
      balanceDisplay.style.display = 'none';
    }
  }
  
  async updateBalance() {
    try {
      const balance = await this.walletManager.getDNGBalance();
      const balanceText = document.getElementById('wallet-balance-text');
      
      if (balanceText) {
        balanceText.textContent = parseFloat(balance).toFixed(0);
      }
    } catch (error) {
      console.error('❌ Failed to update balance:', error);
    }
  }
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', async () => {
    console.log('🎯 DOM ready, initializing shared header...');
    window.sharedHeader = new SharedHeader();
    await window.sharedHeader.init();
  });
} else {
  // DOM already loaded
  console.log('🎯 DOM already ready, initializing shared header...');
  window.sharedHeader = new SharedHeader();
  window.sharedHeader.init();
}

console.log('✅ shared-header.js loaded');
