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
    console.log('🔍 Checking window.ethereum:', typeof window.ethereum);
    console.log('🔍 Checking window.web3Manager:', typeof window.web3Manager);
    console.log('🔍 Checking ethers:', typeof ethers);
    
    if (this.connected) {
      console.log('Already connected');
      return;
    }
    
    // Check if web3Manager exists
    if (!window.web3Manager) {
      console.error('❌ window.web3Manager not found!');
      alert('Error: Web3Manager not loaded. Please refresh the page.');
      return;
    }
    
    // Check if MetaMask exists
    if (!window.ethereum) {
      alert('⚠️ MetaMask not detected!\n\nPlease install MetaMask browser extension to connect your wallet.');
      return;
    }
    
    // Show loading state
    if (this.connectBtn) {
      this.connectBtn.textContent = 'Connecting...';
      this.connectBtn.disabled = true;
    }
    
    try {
      console.log('📞 Calling web3Manager.connect()...');
      
      // Connect using web3Manager
      const success = await window.web3Manager.connect();
      
      console.log('📊 Connection result:', success);
      
      if (success) {
        this.connected = true;
        console.log('✅ Connected successfully');
        console.log('📍 Address:', window.web3Manager.userAddress);
        
        // Update UI
        if (this.connectBtn) {
          this.connectBtn.textContent = '✅ Connected';
          this.connectBtn.style.background = '#4CAF50';
        }
        
        // Check balance
        console.log('💰 Checking balance...');
        const balance = await window.web3Manager.checkDNGBalance();
        console.log('💰 Balance:', balance, '$DNG');
        
        // Update cost display
        this.updateCost();
        
        // AUTO-FETCH KNIGHTS FROM BLOCKCHAIN
        console.log('📦 Auto-fetching knights...');
        await this.loadKnights();
        
        alert(`✅ Connected!\n\nAddress: ${window.web3Manager.userAddress.slice(0, 6)}...${window.web3Manager.userAddress.slice(-4)}\nBalance: ${parseFloat(balance).toFixed(2)} $DNG\nKnights: ${this.knightManager.knights.length}`);
      } else {
        throw new Error('Connection returned false');
      }
      
    } catch (error) {
      console.error('❌ Connection error:', error);
      console.error('❌ Error stack:', error.stack);
      
      let errorMessage = 'Failed to connect wallet';
      if (error.code === 4001) {
        errorMessage = 'Connection rejected by user';
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      alert(`❌ Connection Failed\n\n${errorMessage}`);
      
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
      
      // Start capsule animation
      this.startCapsuleAnimation();
      
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
        
        // Pulse capsule for each mint
        this.pulseCapsule();
        
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
      
      // Stop capsule animation
      this.stopCapsuleAnimation();
      
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
      this.stopCapsuleAnimation();
      
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
    
    knights.forEach((knight, index) => {
      const card = document.createElement('div');
      card.className = 'knight-card-custom';
      
      const rarityConfig = window.DUNGEON_CONFIG ? 
        window.DUNGEON_CONFIG.getRarity(knight.rarity) : 
        { name: knight.rarity, color: '#888', glowColor: 'rgba(136,136,136,0.3)' };
      
      const knightImage = rarityImages[knight.rarity.toLowerCase()] || rarityImages.common;
      
      // Apply inline styles with unique rarity colors
      card.style.cssText = `
        position: relative;
        background: linear-gradient(135deg, rgba(26, 26, 46, 0.95), rgba(16, 16, 30, 0.95));
        border: 2px solid ${rarityConfig.color};
        border-radius: 16px;
        padding: 16px;
        transition: all 0.3s ease;
        overflow: hidden;
        cursor: pointer;
      `;
      
      card.innerHTML = `
        <div class="knight-avatar-wrapper" style="
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
        ">
          <div class="rotating-bg" style="
            content: '';
            position: absolute;
            width: 150%;
            height: 150%;
            background: conic-gradient(from 0deg, transparent, ${rarityConfig.color}33, transparent);
            animation: rotate 4s linear infinite;
          "></div>
          <img src="${knightImage}" alt="${rarityConfig.name} Knight" style="
            position: relative;
            width: 100%;
            height: 100%;
            object-fit: contain;
            filter: drop-shadow(0 0 20px ${rarityConfig.color});
            animation: float 3s ease-in-out infinite;
            z-index: 1;
          " />
        </div>
        
        <div style="text-align: center; margin-bottom: 12px;">
          <div style="
            font-size: 16px;
            font-weight: bold;
            color: #fff;
            margin-bottom: 4px;
            text-shadow: 0 0 10px ${rarityConfig.color}, 0 0 20px ${rarityConfig.color};
          ">
            ${knight.name || `Knight #${knight.tokenId}`}
          </div>
          <div style="
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
          ">
            ✨ ${rarityConfig.name}
          </div>
          ${knight.tokenId !== undefined ? `<div style="font-size: 11px; color: #888; margin-top: 4px;">NFT Token #${knight.tokenId}</div>` : ''}
        </div>
        
        <div style="margin-top: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span style="font-size: 12px; color: #888; text-transform: uppercase;">Stamina</span>
            <span style="font-size: 14px; font-weight: bold; color: #ffd43b;">${knight.stamina || 100}%</span>
          </div>
          <div style="width: 100%; height: 8px; background: rgba(0,0,0,0.5); border-radius: 10px; overflow: hidden; border: 1px solid rgba(255,212,59,0.3);">
            <div style="width: ${knight.stamina || 100}%; height: 100%; background: linear-gradient(90deg, #ffd43b, #ffa94d); border-radius: 10px; transition: width 0.3s ease; box-shadow: 0 0 10px rgba(255,212,59,0.5);"></div>
          </div>
        </div>
      `;
      
      // Add hover effect
      card.addEventListener('mouseenter', function() {
        this.style.transform = 'translateY(-8px) scale(1.02)';
        this.style.boxShadow = `0 12px 40px ${rarityConfig.glowColor}, 0 0 60px ${rarityConfig.glowColor}`;
      });
      
      card.addEventListener('mouseleave', function() {
        this.style.transform = '';
        this.style.boxShadow = '';
      });
      
      this.knightsGrid.appendChild(card);
    });
    
    console.log('✅ Rendered', knights.length, 'knight cards with unique rarity colors');
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

  
  // Capsule animation functions
  startCapsuleAnimation() {
    const capsuleImg = document.getElementById('capsuleImg');
    const capsuleGlow = document.querySelector('.capsule-glow');
    
    if (capsuleImg) {
      capsuleImg.classList.add('minting-active');
      capsuleImg.style.animation = 'shake 0.5s infinite, glow 1.5s ease-in-out infinite';
    }
    
    if (capsuleGlow) {
      capsuleGlow.style.opacity = '1';
      capsuleGlow.style.animation = 'pulse 1s ease-in-out infinite';
    }
  }
  
  pulseCapsule() {
    const capsuleImg = document.getElementById('capsuleImg');
    if (capsuleImg) {
      capsuleImg.style.transform = 'scale(1.2)';
      setTimeout(() => {
        capsuleImg.style.transform = 'scale(1)';
      }, 300);
    }
  }
  
  stopCapsuleAnimation() {
    const capsuleImg = document.getElementById('capsuleImg');
    const capsuleGlow = document.querySelector('.capsule-glow');
    
    if (capsuleImg) {
      capsuleImg.classList.remove('minting-active');
      capsuleImg.style.animation = '';
      capsuleImg.style.transform = '';
    }
    
    if (capsuleGlow) {
      capsuleGlow.style.opacity = '0';
      capsuleGlow.style.animation = '';
    }
  }
