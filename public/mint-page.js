// Mint Page Logic
console.log('🔧 Loading mint-page.js...');

class MintPage {
  constructor() {
    this.mintQuantity = 1;
    this.isMinting = false;
    this.walletManager = window.walletManager;
    console.log('✅ MintPage initialized');
  }

  async init() {
    if (!this.walletManager) {
      console.error('❌ WalletManager not found!');
      return;
    }

    await this.walletManager.init();

    this.setupQuantityControls();
    this.setupMintButton();
    this.setupListeners();

    if (this.walletManager.isConnected) {
      await this.onWalletConnected();
    }

    console.log('✅ Mint page ready');
  }

  setupQuantityControls() {
    const decreaseBtn = document.getElementById('decrease-quantity');
    const increaseBtn = document.getElementById('increase-quantity');
    const quantityDisplay = document.getElementById('quantity-display');
    const costDisplay = document.getElementById('total-cost');

    if (decreaseBtn) {
      decreaseBtn.addEventListener('click', () => {
        if (this.mintQuantity > 1) {
          this.mintQuantity--;
          if (quantityDisplay) quantityDisplay.textContent = this.mintQuantity;
          if (costDisplay) costDisplay.textContent = this.mintQuantity * 500;
        }
      });
    }

    if (increaseBtn) {
      increaseBtn.addEventListener('click', () => {
        if (this.mintQuantity < 10) {
          this.mintQuantity++;
          if (quantityDisplay) quantityDisplay.textContent = this.mintQuantity;
          if (costDisplay) costDisplay.textContent = this.mintQuantity * 500;
        }
      });
    }
  }

  setupMintButton() {
    const mintBtn = document.getElementById('mint-knight');
    if (!mintBtn) return;
    mintBtn.addEventListener('click', async () => {
      await this.handleMint();
    });
    this.updateMintButton();
  }

  setupListeners() {
    window.addEventListener('walletConnected', () => this.onWalletConnected());
    window.addEventListener('walletDisconnected', () => this.onWalletDisconnected());
  }

  async onWalletConnected() {
    this.updateMintButton();
    await this.loadKnights();
  }

  onWalletDisconnected() {
    this.updateMintButton();
    this.clearKnights();
  }

  updateMintButton() {
    const mintBtn = document.getElementById('mint-knight');
    if (!mintBtn) return;

    if (!this.walletManager?.isConnected) {
      mintBtn.disabled = true;
      // Replace inner HTML while keeping structure
      mintBtn.innerHTML = '<img src="assets/ui/sword.png" class="btn-icon-img" alt=""> CONNECT WALLET FIRST';
    } else if (this.isMinting) {
      mintBtn.disabled = true;
      mintBtn.innerHTML = '<img src="assets/ui/sword.png" class="btn-icon-img" alt=""> MINTING...';
    } else {
      mintBtn.disabled = false;
      const cost = this.mintQuantity * 500;
      mintBtn.innerHTML = `<img src="assets/ui/sword.png" class="btn-icon-img" alt=""> SUMMON ${this.mintQuantity} KNIGHT${this.mintQuantity > 1 ? 'S' : ''} (${cost} DNG)`;
    }
  }

  async handleMint() {
    if (!this.walletManager?.isConnected) {
      alert('Please connect your wallet first!');
      return;
    }
    if (this.isMinting) return;

    try {
      this.isMinting = true;
      this.updateMintButton();

      // Show portal animation
      const portal = document.getElementById('portalAnimation');
      if (portal) portal.classList.remove('hidden');

      const cost = this.mintQuantity * 500;

      // Approve
      const approved = await this.walletManager.approveDNG(cost);
      if (!approved) throw new Error('Token approval failed');

      // Mint
      const result = await this.walletManager.batchMintKnights(this.mintQuantity);
      if (!result?.success) throw new Error('Batch minting failed');

      // Hide portal
      if (portal) portal.classList.add('hidden');

      // Arya, the gate keeper, welcomes the new recruits — a popup in her own voice
      // instead of a browser alert.
      if (window.Arya) {
        window.Arya.say('mint', { count: this.mintQuantity });
      } else {
        alert(`Successfully summoned ${this.mintQuantity} knight(s)!`);
      }

      await this.loadKnights();
      await this.updateBalance();

    } catch (error) {
      if (portal) portal.classList.add('hidden');
      if (error.code !== 4001) {
        alert('Minting failed: ' + error.message);
      }
    } finally {
      this.isMinting = false;
      this.updateMintButton();
    }
  }

  async updateBalance() {
    try {
      const balance = await this.walletManager.getDNGBalance();
      const el = document.getElementById('dng-balance');
      if (el) el.textContent = parseFloat(balance).toFixed(0);
    } catch (e) { /* silent */ }
  }

  async loadKnights() {
    try {
      const knights = await this.walletManager.getMyKnights();
      this.displayKnights(knights);
    } catch (e) { console.error('Failed to load knights:', e); }
  }

  displayKnights(knights) {
    const container = document.getElementById('knights-container');
    const countDisplay = document.getElementById('knight-count');
    if (!container) return;

    if (countDisplay) countDisplay.textContent = knights.length + ' owned';

    container.innerHTML = '';

    if (knights.length === 0) {
      container.innerHTML = '<p class="no-knights">Connect wallet to view your knights</p>';
      return;
    }

    knights.forEach(knight => {
      const card = this.createKnightCard(knight);
      container.appendChild(card);
    });
  }

  createKnightCard(knight) {
    const card = document.createElement('div');
    card.className = `knight-card rarity-${knight.rarity}`;

    const rarityConfig = window.RARITY_CONFIG?.[knight.rarity] || {
      color: '#9E9E9E',
      image: 'characters/Pixel_knight_holding_wooden_shield_2K_202609041402_jpeg_2K_202609041417.png'
    };

    card.innerHTML = `
      <div class="knight-header" style="background:linear-gradient(135deg,${rarityConfig.color}20,transparent)">
        <h3 style="color:${rarityConfig.color}">Knight #${knight.tokenId}</h3>
        <span class="rarity-badge" style="background:${rarityConfig.color}">${knight.rarity.toUpperCase()}</span>
      </div>
      <div class="knight-image">
        <img src="${rarityConfig.image}" alt="${knight.rarity} knight">
      </div>
      <div class="knight-stats">
        <div class="stat-bar">
          <div class="stat-label">Stamina</div>
          <div class="stat-value-bar">
            <div class="stat-fill" style="width:100%;background:${rarityConfig.color}"></div>
          </div>
          <div class="stat-value">100/100</div>
        </div>
      </div>
    `;

    return card;
  }

  clearKnights() {
    const container = document.getElementById('knights-container');
    const countDisplay = document.getElementById('knight-count');
    if (container) {
      container.innerHTML = '<p class="no-knights">Connect wallet to view your knights</p>';
    }
    if (countDisplay) countDisplay.textContent = '0 owned';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const mintPage = new MintPage();
  await mintPage.init();
  window.mintPage = mintPage;
});
