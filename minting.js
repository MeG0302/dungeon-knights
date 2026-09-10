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
        
        alert(`✅ Connected!\n\nAddress: ${window.web3Manager.userAddress.slice(0, 6)}...${window.web3Manager.userAddress.slice(-4)}\nBalance: ${parseFloat(balance).toFixed(2)} $DNG`);
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
        
        // Fetch knight details from blockchain and add to game
        for (const result of results) {
          if (result.tokenId) {
            await this.addKnightFromBlockchain(result.tokenId);
          }
        }
        
        // Save to localStorage
        this.saveKnights();
        
        alert(`🎉 Success!\n\nMinted ${results.length} knight(s)!\n\nYour knights are ready for battle!`);
        
        // Reload display
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
  
  // Add knight from blockchain to game
  async addKnightFromBlockchain(tokenId) {
    try {
      console.log('📦 Fetching knight data for token', tokenId);
      
      // Get knight info from contract
      const info = await window.web3Manager.contract.getKnightInfo(tokenId);
      const rarityIndex = info.rarity; // 0=Common, 1=Uncommon, 2=Rare, 3=Epic, 4=Legendary
      
      const rarityNames = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
      const rarityName = rarityNames[rarityIndex] || 'common';
      
      console.log('🎲 Knight rarity:', rarityName);
      
      // Get rarity config
      const rarityConfig = window.DUNGEON_CONFIG ? 
        window.DUNGEON_CONFIG.getRarity(rarityName) : 
        { 
          name: rarityName, 
          baseStats: { hp: 100, attack: 10, defense: 5, speed: 8 },
          statsMultiplier: 1.0
        };
      
      // Create knight
      const knight = new Knight(this.knightManager.nextId++);
      knight.name = `Knight #${tokenId}`;
      knight.rarity = rarityName;
      knight.tokenId = tokenId;
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
      
      // Add to knights list
      this.knightManager.knights.push(knight);
      console.log('✅ Added knight to game:', knight);
      
    } catch (error) {
      console.error('❌ Failed to fetch knight data:', error);
    }
  }
  
  // Save knights to localStorage
  saveKnights() {
    try {
      const data = {
        knights: this.knightManager.knights,
        gold: this.knightManager.gold || 0,
        dungeonToken: this.knightManager.dungeonToken || 0,
        nextId: this.knightManager.nextId
      };
      
      localStorage.setItem('dungeonKnights', JSON.stringify(data));
      console.log('💾 Saved', this.knightManager.knights.length, 'knights to localStorage');
      
    } catch (error) {
      console.error('❌ Failed to save knights:', error);
    }
  }
  
  loadKnights() {
    try {
      // Load from localStorage
      const saved = localStorage.getItem('dungeonKnights');
      if (saved) {
        const data = JSON.parse(saved);
        if (data.knights) {
          this.knightManager.knights = data.knights.map(k => Object.assign(new Knight(), k));
          console.log('📦 Loaded', this.knightManager.knights.length, 'knights');
        }
      }
      
      this.updateDisplay();
      
    } catch (error) {
      console.error('Failed to load knights:', error);
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
      this.knightsGrid.innerHTML = '<p class="empty-msg">No knights summoned yet</p>';
      return;
    }
    
    this.knightsGrid.innerHTML = '';
    
    knights.forEach(knight => {
      const card = document.createElement('div');
      card.className = 'knight-card';
      
      const rarityConfig = window.DUNGEON_CONFIG ? 
        window.DUNGEON_CONFIG.getRarity(knight.rarity) : 
        { name: knight.rarity, color: '#888' };
      
      card.innerHTML = `
        <div class="knight-avatar">
          <div class="knight-sprite" style="background: linear-gradient(135deg, ${rarityConfig.color}33, ${rarityConfig.color}11);">
            ⚔️
          </div>
        </div>
        <div class="knight-info">
          <div class="knight-name">${knight.name}</div>
          <div class="knight-rarity" style="color: ${rarityConfig.color}">
            ${rarityConfig.name}
          </div>
          ${knight.tokenId ? `<div class="knight-tokenid">Token #${knight.tokenId}</div>` : ''}
        </div>
        <div class="knight-stats">
          <div class="stat">⚔️ ${knight.stats.attack}</div>
          <div class="stat">🛡️ ${knight.stats.defense}</div>
          <div class="stat">❤️ ${knight.stats.hp}</div>
        </div>
      `;
      
      this.knightsGrid.appendChild(card);
    });
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
