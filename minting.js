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
    
    // Map rarity to knight images
    const rarityImages = {
      common: 'characters/Pixel_knight_holding_wooden_shield_2K_202609041402_jpeg_2K_202609041417.png',
      uncommon: 'characters/Pixelated_knight_standing_on_tile_2K_202609041402_jpeg_2K_202609041417.png',
      rare: 'characters/Pixel_knight_standing_on_floor_2K_202609041402_jpeg_2K_202609041417.png',
      epic: 'characters/Pixel_knight_holding_cosmic_shield_2K_202609041402_jpeg_2K_202609041417.png',
      legendary: 'characters/Knight_in_golden_armor_stands_2K_202609041404_jpeg_2K_202609041417.png'
    };
    
    knights.forEach(knight => {
      const card = document.createElement('div');
      card.className = 'knight-card';
      
      const rarityConfig = window.DUNGEON_CONFIG ? 
        window.DUNGEON_CONFIG.getRarity(knight.rarity) : 
        { name: knight.rarity, color: '#888', glowColor: 'rgba(136,136,136,0.3)' };
      
      const knightImage = rarityImages[knight.rarity.toLowerCase()] || rarityImages.common;
      
      // Create stunning card with rarity-specific colors
      card.innerHTML = `
        <style>
          .knight-card {
            position: relative;
            background: linear-gradient(135deg, rgba(26, 26, 46, 0.95), rgba(16, 16, 30, 0.95));
            border: 2px solid ${rarityConfig.color};
            border-radius: 16px;
            padding: 16px;
            transition: all 0.3s ease;
            overflow: hidden;
            cursor: pointer;
          }
          
          .knight-card::before {
            content: '';
            position: absolute;
            top: -2px;
            left: -2px;
            right: -2px;
            bottom: -2px;
            background: linear-gradient(45deg, ${rarityConfig.color}, transparent, ${rarityConfig.color});
            border-radius: 16px;
            z-index: -1;
            opacity: 0;
            transition: opacity 0.3s ease;
          }
          
          .knight-card:hover {
            transform: translateY(-8px) scale(1.02);
            box-shadow: 0 12px 40px ${rarityConfig.glowColor}, 0 0 60px ${rarityConfig.glowColor};
          }
          
          .knight-card:hover::before {
            opacity: 0.6;
            animation: borderGlow 2s ease-in-out infinite;
          }
          
          @keyframes borderGlow {
            0%, 100% { opacity: 0.3; }
            50% { opacity: 0.8; }
          }
          
          .knight-avatar-wrapper {
            position: relative;
            width: 100%;
            height: 140px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 12px;
            background: radial-gradient(circle, ${rarityConfig.color}22, transparent);
            border-radius: 12px;
            overflow: hidden;
          }
          
          .knight-avatar-wrapper::before {
            content: '';
            position: absolute;
            width: 150%;
            height: 150%;
            background: conic-gradient(from 0deg, transparent, ${rarityConfig.color}33, transparent);
            animation: rotate 4s linear infinite;
          }
          
          @keyframes rotate {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          
          .knight-image {
            position: relative;
            width: 100%;
            height: 100%;
            object-fit: contain;
            filter: drop-shadow(0 0 20px ${rarityConfig.color});
            animation: float 3s ease-in-out infinite;
            z-index: 1;
          }
          
          @keyframes float {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-10px); }
          }
          
          .knight-info-section {
            text-align: center;
            margin-bottom: 12px;
          }
          
          .knight-name-display {
            font-size: 16px;
            font-weight: bold;
            color: #fff;
            margin-bottom: 4px;
            text-shadow: 0 0 10px ${rarityConfig.color}, 0 0 20px ${rarityConfig.color};
          }
          
          .knight-rarity-badge {
            display: inline-block;
            padding: 4px 12px;
            background: linear-gradient(135deg, ${rarityConfig.color}44, ${rarityConfig.color}22);
            border: 1px solid ${rarityConfig.color};
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
            color: ${rarityConfig.color};
            text-transform: uppercase;
            letter-spacing: 1px;
            margin: 4px 0;
            box-shadow: 0 0 15px ${rarityConfig.glowColor}, inset 0 0 10px ${rarityConfig.glowColor};
          }
          
          .knight-token-id {
            font-size: 11px;
            color: #888;
            margin-top: 4px;
          }
          
          .knight-stats-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-top: 12px;
          }
          
          .stat-box {
            background: linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02));
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 8px;
            padding: 8px;
            text-align: center;
            transition: all 0.2s ease;
          }
          
          .stat-box:hover {
            background: linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05));
            border-color: ${rarityConfig.color};
            transform: scale(1.05);
            box-shadow: 0 0 10px ${rarityConfig.glowColor};
          }
          
          .stat-label {
            font-size: 10px;
            color: #888;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 4px;
          }
          
          .stat-value {
            font-size: 18px;
            font-weight: bold;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
          }
          
          .stat-icon {
            font-size: 16px;
          }
        </style>
        
        <div class="knight-avatar-wrapper">
          <img src="${knightImage}" alt="${rarityConfig.name} Knight" class="knight-image" />
        </div>
        
        <div class="knight-info-section">
          <div class="knight-name-display">
            ${knight.name || `Knight #${knight.tokenId}`}
          </div>
          <div class="knight-rarity-badge">
            ✨ ${rarityConfig.name}
          </div>
          ${knight.tokenId !== undefined ? `<div class="knight-token-id">NFT Token #${knight.tokenId}</div>` : ''}
        </div>
        
        <div class="knight-stats-grid">
          <div class="stat-box">
            <div class="stat-label">Attack</div>
            <div class="stat-value" style="color: #ff6b6b;">
              <span class="stat-icon">⚔️</span>
              <span>${knight.stats.attack}</span>
            </div>
          </div>
          
          <div class="stat-box">
            <div class="stat-label">Defense</div>
            <div class="stat-value" style="color: #4dabf7;">
              <span class="stat-icon">🛡️</span>
              <span>${knight.stats.defense}</span>
            </div>
          </div>
          
          <div class="stat-box">
            <div class="stat-label">Health</div>
            <div class="stat-value" style="color: #51cf66;">
              <span class="stat-icon">❤️</span>
              <span>${knight.stats.hp}</span>
            </div>
          </div>
          
          <div class="stat-box">
            <div class="stat-label">Speed</div>
            <div class="stat-value" style="color: #ffd43b;">
              <span class="stat-icon">⚡</span>
              <span>${knight.stats.speed}</span>
            </div>
          </div>
        </div>
      `;
      
      this.knightsGrid.appendChild(card);
    });
    
    console.log('✅ Rendered', knights.length, 'enhanced knight cards with rarity-specific images');
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
