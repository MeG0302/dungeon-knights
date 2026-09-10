// Minting Page Controller - Clean Implementation
console.log('🔧 Loading minting.js...');

class MintingPage {
  constructor() {
    this.knightManager = new KnightManager();
    this.connected = false;
    this.minting = false;
    
    console.log('🎮 MintingPage initialized');
    this.initElements();
    this.setupEventListeners();
    this.loadKnights();
  }
  
  initElements() {
    // Buttons
    this.connectBtn = document.getElementById('connectWalletBtn');
    this.mintBtn = document.getElementById('mintBtn');
    this.backBtn = document.getElementById('backBtn');
    
    // Quantity controls
    this.mintQty = document.getElementById('mintQty');
    this.qtyDecrease = document.getElementById('qtyDecrease');
    this.qtyIncrease = document.getElementById('qtyIncrease');
    
    // Display elements
    this.totalMintCost = document.getElementById('totalMintCost');
    this.costCurrency = document.getElementById('costCurrency');
    this.mintBtnQty = document.getElementById('mintBtnQty');
    this.mintBtnPlural = document.getElementById('mintBtnPlural');
    this.knightCount = document.getElementById('knightCount');
    this.knightsGrid = document.getElementById('knightsGrid');
    
    console.log('✅ Elements initialized');
  }
  
  setupEventListeners() {
    // Connect button
    if (this.connectBtn) {
      this.connectBtn.addEventListener('click', () => this.handleConnect());
    }
    
    // Mint button
    if (this.mintBtn) {
      this.mintBtn.addEventListener('click', () => this.handleMint());
    }
    
    // Back button
    if (this.backBtn) {
      this.backBtn.addEventListener('click', () => {
        window.location.href = 'landing.html';
      });
    }
    
    // Quantity controls
    if (this.qtyDecrease) {
      this.qtyDecrease.addEventListener('click', () => {
        const current = parseInt(this.mintQty.value);
        if (current > 1) {
          this.mintQty.value = current - 1;
          this.updateCost();
        }
      });
    }
    
    if (this.qtyIncrease) {
      this.qtyIncrease.addEventListener('click', () => {
        const current = parseInt(this.mintQty.value);
        if (current < 10) {
          this.mintQty.value = current + 1;
          this.updateCost();
        }
      });
    }
    
    if (this.mintQty) {
      this.mintQty.addEventListener('change', () => this.updateCost());
    }
    
    console.log('✅ Event listeners setup');
  }
  
  async handleConnect() {
    console.log('🔌 Connect button clicked');
    
    if (this.connected) {
      console.log('Already connected');
      return;
    }
    
    // Show loading state
    if (this.connectBtn) {
      this.connectBtn.textContent = 'Connecting...';
      this.connectBtn.disabled = true;
    }
    
    try {
      // Connect using web3Manager
      const success = await window.web3Manager.connect();
      
      if (success) {
        this.connected = true;
        console.log('✅ Connected successfully');
        
        // Update UI
        if (this.connectBtn) {
          this.connectBtn.textContent = '✅ Connected';
          this.connectBtn.style.background = '#4CAF50';
        }
        
        // Check balance
        const balance = await window.web3Manager.checkDNGBalance();
        console.log('💰 Balance:', balance, '$DNG');
        
        // Update cost display
        this.updateCost();
        
        // AUTO-FETCH KNIGHTS FROM BLOCKCHAIN
        console.log('📦 Auto-fetching knights...');
        await this.loadKnights();
        
        alert(`✅ Connected!\n\nAddress: ${window.web3Manager.userAddress.slice(0, 6)}...${window.web3Manager.userAddress.slice(-4)}\nBalance: ${parseFloat(balance).toFixed(2)} $DNG\nKnights: ${this.knightManager.knights.length}`);
      } else {
        throw new Error('Connection failed');
      }
      
    } catch (error) {
      console.error('❌ Connection error:', error);
      
      // Reset button
      if (this.connectBtn) {
        this.connectBtn.textContent = 'Connect Wallet';
        this.connectBtn.disabled = false;
      }
    }
  }
  
  async handleMint() {
    console.log('⚔️ Mint button clicked');
    
    if (this.minting) {
      console.log('Already minting...');
      return;
    }
    
    if (!this.connected) {
      alert('⚠️ Please connect your wallet first!');
      return;
    }
    
    const qty = parseInt(this.mintQty.value) || 1;
    console.log('Minting quantity:', qty);
    
    try {
      this.minting = true;
      
      // Update button
      if (this.mintBtn) {
        this.mintBtn.textContent = 'MINTING...';
        this.mintBtn.disabled = true;
      }
      
      // Calculate total cost (500 $DNG per knight)
      const costPerKnight = 500;
      const totalCost = costPerKnight * qty;
      
      console.log('💰 Total cost:', totalCost, '$DNG');
      
      // Step 1: Approve $DNG
      console.log('📝 Step 1: Approving $DNG...');
      const approved = await window.web3Manager.approveDNG(totalCost);
      
      if (!approved) {
        throw new Error('Token approval failed or cancelled');
      }
      
      console.log('✅ Tokens approved');
      
      // Step 2: Mint knights one by one
      console.log('⚔️ Step 2: Minting', qty, 'knight(s)...');
      
      const results = [];
      
      for (let i = 0; i < qty; i++) {
        console.log(`Minting knight ${i + 1}/${qty}...`);
        
        if (this.mintBtn) {
          this.mintBtn.textContent = `MINTING ${i + 1}/${qty}...`;
        }
        
        const result = await window.web3Manager.mintKnight();
        
        if (result && result.success) {
          results.push(result);
          console.log(`✅ Knight ${i + 1} minted! Token ID:`, result.tokenId);
          
          // Small delay between mints
          if (i < qty - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        } else {
          console.error(`❌ Knight ${i + 1} failed`);
          break;
        }
      }
      
      // Success!
      if (results.length > 0) {
        console.log('🎉 Minting complete!', results.length, 'knights minted');
        
        alert(`🎉 Success!\n\nMinted ${results.length} knight(s)!\n\nYour knights are ready for battle!`);
        
        // Reload knights from blockchain
        await this.loadKnights();
      }
      
    } catch (error) {
      console.error('❌ Minting error:', error);
      alert('❌ Minting failed: ' + error.message);
      
    } finally {
      this.minting = false;
      
      // Reset button
      if (this.mintBtn) {
        this.mintBtn.textContent = `MINT ${qty} KNIGHT${qty > 1 ? 'S' : ''}`;
        this.mintBtn.disabled = false;
      }
    }
  }
  
  updateCost() {
    const qty = parseInt(this.mintQty.value) || 1;
    const costPerKnight = 500; // 500 $DNG per knight
    const totalCost = costPerKnight * qty;
    
    if (this.totalMintCost) {
      this.totalMintCost.textContent = totalCost;
    }
    
    if (this.costCurrency) {
      this.costCurrency.textContent = '$DNG';
    }
    
    if (this.mintBtnQty) {
      this.mintBtnQty.textContent = qty;
    }
    
    if (this.mintBtnPlural) {
      this.mintBtnPlural.textContent = qty > 1 ? 'S' : '';
    }
  }
  
  async loadKnights() {
    try {
      console.log('📦 Loading knights from blockchain...');
      
      // Check if connected
      if (!window.web3Manager || !window.web3Manager.isConnected) {
        console.log('⚠️ Not connected, no knights to load');
        this.knightManager.knights = [];
        this.updateDisplay();
        return;
      }
      
      // Show loading message
      if (this.knightsGrid) {
        this.knightsGrid.innerHTML = '<p class="empty-msg">🔄 Loading knights from blockchain...</p>';
      }
      
      // Fetch knights from blockchain
      const blockchainKnights = await window.web3Manager.getMyKnights();
      console.log('📦 Fetched', blockchainKnights.length, 'knights from blockchain');
      
      // Clear existing knights
      this.knightManager.knights = [];
      
      // Convert blockchain knights to game knights
      for (const bknight of blockchainKnights) {
        console.log('🎲 Processing knight:', bknight);
        const knight = await this.createKnightFromBlockchain(bknight);
        if (knight) {
          this.knightManager.knights.push(knight);
          console.log('✅ Added knight:', knight.name, '- Rarity:', knight.rarity, '- Stats:', knight.stats);
        }
      }
      
      console.log('✅ Loaded', this.knightManager.knights.length, 'knights total');
      this.updateDisplay();
      
    } catch (error) {
      console.error('❌ Failed to load knights:', error);
      this.knightManager.knights = [];
      this.updateDisplay();
    }
  }
  
  // Create Knight object from blockchain data
  async createKnightFromBlockchain(blockchainKnight) {
    try {
      const rarityConfig = window.DUNGEON_CONFIG ? 
        window.DUNGEON_CONFIG.getRarity(blockchainKnight.rarity) : 
        { 
          name: blockchainKnight.rarity, 
          baseStats: { hp: 100, attack: 10, defense: 5, speed: 8 },
          statsMultiplier: 1.0
        };
      
      const knight = new Knight(this.knightManager.nextId++);
      knight.name = `Knight #${blockchainKnight.tokenId}`;
      knight.rarity = blockchainKnight.rarity;
      knight.tokenId = blockchainKnight.tokenId;
      knight.fromBlockchain = true;
      
      // Set stats based on rarity
      knight.stats = {
        hp: Math.floor(rarityConfig.baseStats.hp * rarityConfig.statsMultiplier),
        attack: Math.floor(rarityConfig.baseStats.attack * rarityConfig.statsMultiplier),
        defense: Math.floor(rarityConfig.baseStats.defense * rarityConfig.statsMultiplier),
        speed: Math.floor(rarityConfig.baseStats.speed * rarityConfig.statsMultiplier)
      };
      
      knight.maxHp = knight.stats.hp;
      knight.stamina = 100;
      knight.maxStamina = 100;
      
      return knight;
      
    } catch (error) {
      console.error('Failed to create knight:', error);
      return null;
    }
  }
  
  updateDisplay() {
    if (this.knightCount) {
      this.knightCount.textContent = this.knightManager.knights.length;
    }
    
    this.renderKnights();
  }
  
  renderKnights() {
    if (!this.knightsGrid) return;
    
    const knights = this.knightManager.knights;
    
    if (knights.length === 0) {
      this.knightsGrid.innerHTML = '<p class="empty-msg">No knights summoned yet. Connect your wallet to see your NFTs!</p>';
      return;
    }
    
    this.knightsGrid.innerHTML = '';
    
    knights.forEach(knight => {
      const card = document.createElement('div');
      card.className = 'knight-card';
      
      const rarityConfig = window.DUNGEON_CONFIG ? 
        window.DUNGEON_CONFIG.getRarity(knight.rarity) : 
        { name: knight.rarity, color: '#888', glowColor: 'rgba(136,136,136,0.3)' };
      
      // Add rarity-based styling
      card.style.borderColor = rarityConfig.color;
      card.style.boxShadow = `0 0 20px ${rarityConfig.glowColor}`;
      
      card.innerHTML = `
        <div class="knight-avatar" style="background: linear-gradient(135deg, ${rarityConfig.color}33, ${rarityConfig.color}11);">
          <div class="knight-sprite" style="font-size: 48px;">
            ⚔️
          </div>
        </div>
        <div class="knight-info">
          <div class="knight-name" style="color: ${rarityConfig.color}; font-weight: bold;">
            ${knight.name || `Knight #${knight.tokenId}`}
          </div>
          <div class="knight-rarity" style="color: ${rarityConfig.color}; font-size: 14px; margin: 4px 0;">
            ✨ ${rarityConfig.name.toUpperCase()}
          </div>
          ${knight.tokenId !== undefined ? `<div class="knight-tokenid" style="color: #888; font-size: 12px;">Token #${knight.tokenId}</div>` : ''}
        </div>
        <div class="knight-stats" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; padding: 8px; background: rgba(0,0,0,0.3); border-radius: 8px;">
          <div class="stat" style="text-align: center;">
            <div style="font-size: 10px; color: #888;">ATK</div>
            <div style="font-weight: bold; color: #ff6b6b;">⚔️ ${knight.stats.attack}</div>
          </div>
          <div class="stat" style="text-align: center;">
            <div style="font-size: 10px; color: #888;">DEF</div>
            <div style="font-weight: bold; color: #4dabf7;">🛡️ ${knight.stats.defense}</div>
          </div>
          <div class="stat" style="text-align: center;">
            <div style="font-size: 10px; color: #888;">HP</div>
            <div style="font-weight: bold; color: #51cf66;">❤️ ${knight.stats.hp}</div>
          </div>
          <div class="stat" style="text-align: center;">
            <div style="font-size: 10px; color: #888;">SPD</div>
            <div style="font-weight: bold; color: #ffd43b;">⚡ ${knight.stats.speed}</div>
          </div>
        </div>
      `;
      
      this.knightsGrid.appendChild(card);
    });
    
    console.log('✅ Rendered', knights.length, 'knight cards with metadata');
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('🎮 DOM ready, creating MintingPage...');
    window.mintingPage = new MintingPage();
  });
} else {
  console.log('🎮 DOM already ready, creating MintingPage...');
  window.mintingPage = new MintingPage();
}

console.log('✅ minting.js loaded');
