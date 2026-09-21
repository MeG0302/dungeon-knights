// Mint Page Logic — price and odds both come from config.js, so the page cannot
// advertise a number the engine and the contracts do not pay.
console.log('🔧 Loading mint-page.js...');

class MintPage {
  constructor() {
    this.mintQuantity = 1;
    this.isMinting = false;
    this.walletManager = window.walletManager;
    console.log('✅ MintPage initialized');
  }

  async init() {
    // The odds and the price are facts about the contracts, not about the wallet, so they
    // are drawn before anything wallet-shaped gets a chance to bail out.
    this.renderRarityChances();
    // Not awaited: the panel draws immediately and fills its price in when the economy
    // lands, so a slow API cannot hold up the wallet connect below it.
    this.renderCapsules();

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

  /** Mint price in $DNG for the connected network, from the single config. */
  mintPrice() {
    return window.DUNGEON_CONFIG?.getMintPrice?.() ?? 500;
  }

  /**
   * Draw the odds table from the one rarity config instead of the markup's hard-coded
   * percentages. The list in the page body is a placeholder — this replaces it, so the
   * advertised odds are always the odds `rollRarity()` actually uses.
   */
  renderRarityChances() {
    const container = document.getElementById('rarityChances');
    if (!container || !window.RARITY_TIERS || !window.RARITY_CONFIG) return;

    // Drop rate alone is not what a buyer needs: the odds say how likely a tier is, the
    // reward says what the tier is worth, and only both together answer "is this 500 DNG
    // well spent". The earnings line is the tier's own capacity, so it is the same number
    // the game pays and `check-token-math` pins.
    container.innerHTML = window.RARITY_TIERS.map(tier => {
      const r = window.RARITY_CONFIG[tier];
      const cap = r.dungeonReward * r.dailyRuns;
      return `
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:12px">
          <span style="display:flex;align-items:center;gap:6px"><span class="dot dot-${tier}"></span> ${r.name}</span>
          <span style="color:var(--text-muted)">${(r.dropRate * 100).toFixed(1)}%</span>
        </div>
        <div style="display:flex;justify-content:space-between;gap:8px;font-size:10px;color:var(--text-muted);margin:-2px 0 3px 16px">
          <span>${r.dungeonReward} DNG / clear &middot; ${r.dailyRuns} runs</span>
          <span>${cap} a day &middot; ${r.hashPower} HP</span>
        </div>
      `;
    }).join('');

    // The expectation is the *weighted capacity* (sum of p x reward x runs), not the product
    // of the average reward and the average run count — the tiers that pay most also get the
    // most runs, so the product overstates it.
    const expectedPerDay = window.RARITY_TIERS.reduce((sum, tier) => {
      const r = window.RARITY_CONFIG[tier];
      return sum + r.dropRate * r.dungeonReward * r.dailyRuns;
    }, 0);
    const price = this.mintPrice();

    container.innerHTML += `
      <div style="border-top:1px solid var(--border-dim);margin-top:9px;padding-top:9px;font-size:10.5px;line-height:1.6;color:var(--text-muted)">
        Expected at the published odds and the published budget (scale 1.00):
        <strong style="color:var(--text-secondary)">${expectedPerDay.toFixed(1)} DNG a day</strong> per knight,
        so a ${price} DNG summon repays itself in about
        <strong style="color:var(--text-secondary)">${Math.ceil(price / expectedPerDay)} days</strong> of running every dungeon it is allowed.
      </div>
    `;

    const perKnight = document.getElementById('cost-per-knight');
    if (perKnight) perKnight.textContent = `${this.mintPrice()} DNG`;

    this.updateTotalCost();
  }

  updateTotalCost() {
    const costDisplay = document.getElementById('total-cost');
    if (costDisplay) costDisplay.textContent = `${this.mintQuantity * this.mintPrice()} DNG`;
  }

  setupQuantityControls() {
    const decreaseBtn = document.getElementById('decrease-quantity');
    const increaseBtn = document.getElementById('increase-quantity');
    const quantityDisplay = document.getElementById('quantity-display');

    if (decreaseBtn) {
      decreaseBtn.addEventListener('click', () => {
        if (this.mintQuantity > 1) {
          this.mintQuantity--;
          if (quantityDisplay) quantityDisplay.textContent = this.mintQuantity;
          this.updateTotalCost();
        }
      });
    }

    if (increaseBtn) {
      increaseBtn.addEventListener('click', () => {
        if (this.mintQuantity < 10) {
          this.mintQuantity++;
          if (quantityDisplay) quantityDisplay.textContent = this.mintQuantity;
          this.updateTotalCost();
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
    await this.refreshCapsuleHeld();
  }

  onWalletDisconnected() {
    this.updateMintButton();
    this.clearKnights();
    // Capsule holdings are a fact about a wallet, so they go with it.
    this.capsulesHeld = null;
    this.updateCapsulePanel();
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
      const cost = this.mintQuantity * this.mintPrice();
      mintBtn.innerHTML = `<img src="assets/ui/sword.png" class="btn-icon-img" alt=""> SUMMON ${this.mintQuantity} KNIGHT${this.mintQuantity > 1 ? 'S' : ''} (${cost} DNG)`;
    }
  }

  async handleMint() {
    if (!this.walletManager?.isConnected) {
      alert('Please connect your wallet first!');
      return;
    }
    if (this.isMinting) return;

    // Declared **outside** the try, and that is the whole point: the catch below needs it, and a
    // `const` declared inside the try block is not in scope there. So the handler threw its own
    // `ReferenceError: portal is not defined` and replaced the real reason the mint failed — a
    // second bug hiding the first, in the one place a player needs to read.
    const portal = document.getElementById('portalAnimation');

    try {
      this.isMinting = true;
      this.updateMintButton();

      // Show portal animation
      if (portal) portal.classList.remove('hidden');

      const cost = this.mintQuantity * this.mintPrice();

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

    // The portrait, not the map sprite: a summoned knight is shown here as a record of what was
    // minted. The dungeon keeps `image`, and `pfp` falls back to it so a tier added to config.js
    // without a portrait yet shows *something* rather than a broken image.
    const rarityConfig = window.RARITY_CONFIG?.[knight.rarity] || {
      color: '#9E9E9E',
      pfp: '/assets/pfp/common.webp',
      image: 'characters/Pixel_knight_holding_wooden_shield_2K_202609041402_jpeg_2K_202609041417.png'
    };
    const knightArt = rarityConfig.pfp || rarityConfig.image;

    card.innerHTML = `
      <div class="knight-header" style="background:linear-gradient(135deg,${rarityConfig.color}20,transparent)">
        <h3 style="color:${rarityConfig.color}">Knight #${knight.tokenId}</h3>
        <span class="rarity-badge" style="background:${rarityConfig.color}">${knight.rarity.toUpperCase()}</span>
      </div>
      <div class="knight-image">
        <img src="${knightArt}" alt="${knight.rarity} knight" loading="lazy">
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

  // ------------------------------------------------------------------ capsules
  /**
   * The capsule panel.
   *
   * Capsules are the only way a Knight enters circulation and the weekly draw is the only
   * way to get one, so this is where one is *opened*. The price is read from the published
   * economy rather than typed into the markup: a price that lives in two places is a price
   * that will eventually disagree with the contract.
   *
   * It rises with the collection — 500 DNG at zero Knights to 5,000 at the reference size,
   * flat above it — because a
   * flat fee cannot price a growing collection — at 200 opens a week a 500-DNG fee funds
   * roughly 2% of the reward budget, and per-Knight payouts would fall about ten-fold a
   * year. The marker on the track is the crossover: from about 5,700 Knights the 200 weekly
   * opens alone cover the whole Knights reward line.
   */
  async renderCapsules() {
    this.capsuleQuantity = 1;
    this.capsulePrice = null;
    this.capsulePriceAtReference = null;
    this.capsuleBreakEvenMinted = null;
    this.capsuleReferenceSize = null;
    this.capsulesPerWeek = null;
    this.capsulesHeld = null;
    this.capsuleReason = null;
    this.isOpeningCapsules = false;

    this.setupCapsuleControls();
    this.updateCapsulePanel();

    try {
      const config = await fetch('/api/staking/config').then((r) => (r.ok ? r.json() : null));
      const economy = config?.economy || null;
      if (!economy) throw new Error('no economy');

      this.capsulePrice = economy.capsuleOpenPriceAtZero;
      this.capsulePriceAtReference = economy.capsuleOpenPriceAtReference;
      this.capsuleBreakEvenMinted = economy.capsuleBreakEvenMinted;
      this.capsuleReferenceSize = economy.knightsReferenceSize;
      this.capsulesPerWeek = economy.capsulesPerWeek;
      // `config.reason` is deliberately *not* used here. It explains why the *Staking
      // Vault* is showing preview data, which is not a fact about this page — the button
      // label and the holdings chip already say capsules are not deployed.
    } catch (err) {
      // Withheld rather than guessed. The open price is published, and a page that invented
      // one would be advertising a number no contract pays.
      this.capsuleReason = 'The published economy could not be loaded, so the open price is withheld rather than guessed.';
    }

    this.updateCapsulePanel();
    await this.refreshCapsuleHeld();
  }

  setupCapsuleControls() {
    const decrease = document.getElementById('capsule-decrease');
    const increase = document.getElementById('capsule-increase');
    const open = document.getElementById('capsule-open');
    if (decrease) decrease.addEventListener('click', () => this.setCapsuleQuantity(this.capsuleQuantity - 1));
    if (increase) increase.addEventListener('click', () => this.setCapsuleQuantity(this.capsuleQuantity + 1));
    if (open) open.addEventListener('click', () => this.handleOpenCapsules());
  }

  setCapsuleQuantity(next) {
    const max = Math.max(1, this.capsulesHeld || 1);
    this.capsuleQuantity = Math.min(max, Math.max(1, next));
    this.updateCapsulePanel();
  }

  capsuleCost() {
    if (this.capsulePrice === null) return null;
    return this.capsulePrice * this.capsuleQuantity;
  }

  capsuleAddress() {
    return this.walletManager?.capsuleContractAddress?.() || null;
  }

  updateCapsulePanel() {
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    const fmt = (n) => Number(n).toLocaleString();
    const connected = Boolean(this.walletManager?.isConnected);
    const address = this.capsuleAddress();

    set('capsule-price', this.capsulePrice === null ? '—' : `${fmt(this.capsulePrice)} DNG`);
    set('capsule-price-min', this.capsulePrice === null ? '—' : `${fmt(this.capsulePrice)} DNG`);
    set('capsule-price-max', this.capsulePriceAtReference === null ? '—' : `${fmt(this.capsulePriceAtReference)} DNG`);

    const marker = document.getElementById('capsule-track-marker');
    if (marker) {
      const fraction = this.capsuleReferenceSize
        ? (this.capsuleBreakEvenMinted || 0) / this.capsuleReferenceSize
        : 0;
      marker.style.left = `${Math.min(100, Math.max(0, fraction * 100))}%`;
    }

    if (!connected) set('capsule-held', 'Connect a wallet');
    else if (!address) set('capsule-held', 'Not deployed yet');
    else set('capsule-held', this.capsulesHeld === null ? 'Reading…' : `${fmt(this.capsulesHeld)} held`);

    set('capsule-quantity', String(this.capsuleQuantity));

    const open = document.getElementById('capsule-open');
    if (open) {
      const enough = (this.capsulesHeld || 0) >= this.capsuleQuantity;
      open.disabled = !(connected && address && enough && !this.isOpeningCapsules);

      if (this.isOpeningCapsules) open.textContent = 'OPENING…';
      else if (!connected) open.textContent = 'CONNECT WALLET FIRST';
      else if (!address) open.textContent = 'CAPSULES NOT DEPLOYED YET';
      else if (!this.capsulesHeld) open.textContent = 'NO CAPSULES TO OPEN';
      else {
        const cost = this.capsuleCost();
        open.textContent = `OPEN ${this.capsuleQuantity} CAPSULE${this.capsuleQuantity > 1 ? 'S' : ''}`
          + (cost === null ? '' : ` (${fmt(cost)} DNG)`);
      }
    }

    const note = [];
    if (this.capsuleReason) {
      note.push(this.capsuleReason);
    } else if (this.capsuleReferenceSize) {
      note.push('Capsules are awarded by the weekly draw to staked Genesis Knights — never sold. '
        + 'Opening one reveals a Knight at the published odds, and the price rises with the '
        + `collection: ${fmt(this.capsulePrice)} DNG at zero Knights to ${fmt(this.capsulePriceAtReference)} `
        + `at ${fmt(this.capsuleReferenceSize)}.`);
      if (this.capsuleBreakEvenMinted) {
        note.push(`The marker is the crossover: from about ${fmt(this.capsuleBreakEvenMinted)} Knights `
          + `the ${fmt(this.capsulesPerWeek)} weekly opens alone cover the whole Knights reward line.`);
      }
    }
    set('capsule-note', note.join(' '));
  }

  async refreshCapsuleHeld() {
    if (!this.walletManager?.isConnected || !this.capsuleAddress()) return;
    const held = await this.walletManager.getMyCapsules();
    this.capsulesHeld = held;
    if (held !== null && this.capsuleQuantity > held) this.capsuleQuantity = Math.max(1, held);
    this.updateCapsulePanel();
  }

  async handleOpenCapsules() {
    if (this.isOpeningCapsules) return;
    if (!this.capsuleAddress()) {
      alert('The Capsules collection is not deployed yet.');
      return;
    }

    const portal = document.getElementById('portalAnimation');
    const title = portal ? portal.querySelector('.modal-title') : null;
    const wasTitle = title ? title.textContent : null;

    try {
      this.isOpeningCapsules = true;
      this.updateCapsulePanel();

      if (portal) portal.classList.remove('hidden');
      if (title) title.textContent = 'Opening capsules...';

      const result = await this.walletManager.openCapsules(this.capsuleQuantity);
      if (!result?.success) throw new Error(result?.error || 'Opening failed');

      if (portal) portal.classList.add('hidden');

      await this.refreshCapsuleHeld();
      await this.loadKnights();
      await this.updateBalance();
    } catch (error) {
      if (portal) portal.classList.add('hidden');
      if (error.message !== 'Cancelled') alert('Could not open the capsule: ' + error.message);
    } finally {
      if (title && wasTitle !== null) title.textContent = wasTitle;
      this.isOpeningCapsules = false;
      this.updateCapsulePanel();
    }
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
