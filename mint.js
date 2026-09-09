// Minting Page Controller with Web3 Integration

class MintingPage {
    constructor() {
        this.knightManager = new KnightManager();
        this.musicStarted = false;
        this.isWeb3Connected = false;
        
        this.loadKnights();
        this.initElements();
        this.bindEvents();
        this.updateDisplay();
        this.setupMusicStarter();
        this.initWeb3();
    }
    
    setupMusicStarter() {
        if (window.audioManager) {
            window.audioManager.startMenuMusic();
        }
        
        const startMusic = () => {
            if (!this.musicStarted && window.audioManager) {
                window.audioManager.startMenuMusic();
                this.musicStarted = true;
            }
        };
        
        document.addEventListener('click', startMusic, { once: true });
        document.addEventListener('mousemove', startMusic, { once: true });
    }
    
    loadKnights() {
        const savedKnights = localStorage.getItem('allKnights');
        if (savedKnights) {
            try {
                const knightsData = JSON.parse(savedKnights);
                knightsData.forEach(data => {
                    const knight = new Knight(data.id);
                    knight.rarity = data.rarity;
                    knight.stats = data.stats;
                    knight.fromBlockchain = data.fromBlockchain || false;
                    knight.tokenId = data.tokenId || null;
                    this.knightManager.knights.push(knight);
                    if (data.id >= this.knightManager.nextId) {
                        this.knightManager.nextId = data.id + 1;
                    }
                });
            } catch (e) {
                console.error('Failed to load knights:', e);
            }
        }
    }
    
    initElements() {
        this.backBtn = document.getElementById('backBtn');
        this.capsuleImg = document.getElementById('capsuleImg');
        this.capsuleEnergy = document.getElementById('capsuleEnergy');
        this.capsuleParticles = document.getElementById('capsuleParticles');
        this.mintResult = document.getElementById('mintResult');
        this.mintQty = document.getElementById('mintQty');
        this.qtyMinus = document.getElementById('qtyMinus');
        this.qtyPlus = document.getElementById('qtyPlus');
        this.totalMintCost = document.getElementById('totalMintCost');
        this.mintBtn = document.getElementById('mintBtn');
        this.mintBtnQty = document.getElementById('mintBtnQty');
        this.mintBtnPlural = document.getElementById('mintBtnPlural');
        this.knightCount = document.getElementById('knightCount');
        this.knightsGrid = document.getElementById('knightsGrid');
        this.networkInfo = document.getElementById('networkInfo');
    }
    
    bindEvents() {
        this.backBtn.addEventListener('click', () => {
            this.saveAndReturn();
        });
        
        this.qtyMinus.addEventListener('click', () => {
            const current = parseInt(this.mintQty.value);
            if (current > 1) {
                this.mintQty.value = current - 1;
                this.updateCost();
            }
        });
        
        this.qtyPlus.addEventListener('click', () => {
            const current = parseInt(this.mintQty.value);
            if (current < 5) {
                this.mintQty.value = current + 1;
                this.updateCost();
            }
        });
        
        this.mintBtn.addEventListener('click', () => {
            this.performMint();
        });
    }
    
    // Initialize Web3 Manager
    async initWeb3() {
        // Widget handles everything now
        console.log('✅ Wallet widget will handle connection');
    }
    
    // Load NFT knights from blockchain
    async loadNFTKnights() {
        try {
            console.log('📦 Loading NFT knights from blockchain...');
            const nftKnights = await window.web3Manager.getMyKnights();
            
            // Merge with existing knights (avoid duplicates)
            nftKnights.forEach(nftKnight => {
                const exists = this.knightManager.knights.find(k => 
                    k.tokenId === nftKnight.tokenId && k.fromBlockchain
                );
                
                if (!exists) {
                    const knight = new Knight(this.knightManager.nextId++);
                    knight.rarity = nftKnight.rarity;
                    knight.stats = nftKnight.stats;
                    knight.stamina = nftKnight.stamina;
                    knight.fromBlockchain = true;
                    knight.tokenId = nftKnight.tokenId;
                    
                    this.knightManager.knights.push(knight);
                    console.log('✅ Loaded NFT Knight #' + nftKnight.tokenId);
                }
            });
            
            // Save updated knights
            this.saveKnights();
            this.updateDisplay();
            
            if (nftKnights.length > 0) {
                console.log(`✅ Loaded ${nftKnights.length} NFT knights`);
            }
        } catch (error) {
            console.error('❌ Failed to load NFT knights:', error);
        }
    }
    
    updateCost() {
        const qty = parseInt(this.mintQty.value);
        const cost = (qty * 0.001).toFixed(3);
        this.totalMintCost.textContent = cost;
        this.costCurrency.textContent = 'ETH';
        
        this.mintBtnQty.textContent = qty;
        this.mintBtnPlural.textContent = qty > 1 ? 'S' : '';
    }
    
    updateDisplay() {
        this.knightCount.textContent = this.knightManager.knights.length;
        this.renderKnights();
    }
    
    renderKnights() {
        const knights = this.knightManager.knights;
        
        if (knights.length === 0) {
            this.knightsGrid.innerHTML = '<p class="empty-msg">No knights summoned yet</p>';
            return;
        }
        
        this.knightsGrid.innerHTML = '';
        knights.forEach(knight => {
            const mini = document.createElement('div');
            mini.className = 'knight-mini';
            mini.style.borderColor = knight.rarity.color;
            
            const nftBadge = knight.fromBlockchain ? '<div style="position:absolute;top:2px;right:2px;font-size:10px;">💎</div>' : '';
            
            mini.innerHTML = `
                ${nftBadge}
                <div style="font-size: 1.5rem;">⚔️</div>
                <div style="color: ${knight.rarity.color}; font-weight: bold; font-size: 0.75rem;">${knight.rarity.name}</div>
            `;
            this.knightsGrid.appendChild(mini);
        });
    }
    
    async performMint() {
        if (!this.isWeb3Connected) {
            alert('⚠️ Please connect your wallet first to mint NFT knights!');
            return;
        }
        await this.mintNFTKnight();
    }
    
    // NFT mode minting (blockchain)
    async mintNFTKnight() {
        const qty = parseInt(this.mintQty.value);
        
        if (!this.isWeb3Connected) {
            alert('⚠️ Please connect your wallet first!');
            return;
        }
        
        // Start animation
        this.startMintAnimation();
        this.mintBtn.classList.add('loading');
        this.mintBtn.querySelector('.btn-text').textContent = 'MINTING ON BLOCKCHAIN';
        
        try {
            console.log(`⏳ Minting ${qty} NFT knight(s)...`);
            
            let result;
            if (qty === 1) {
                result = await window.web3Manager.mintKnight();
                if (!result) throw new Error('Mint transaction failed or was cancelled');
            } else {
                result = await window.web3Manager.mintKnights(qty);
                if (!result) throw new Error('Batch mint failed or was cancelled');
            }
            
            console.log('✅ NFT minted successfully!', result);
            
            // Wait a bit for blockchain to process
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Reload NFT knights from blockchain
            await this.loadNFTKnights();
            
            // Get the newly minted knights (last N knights)
            const mintedKnights = this.knightManager.knights.slice(-qty);
            
            this.showResult(mintedKnights, true);
            this.endMintAnimation();
            
            // Play rare sound for NFT
            if (window.audioManager) {
                window.audioManager.play('rare_drop');
            }
            
        } catch (error) {
            console.error('❌ NFT mint failed:', error);
            const errorMessage = error.message || 'Unknown error occurred';
            alert('❌ Minting failed: ' + errorMessage);
            this.endMintAnimation();
        }
    }
    
    startMintAnimation() {
        this.capsuleImg.classList.add('charging');
        this.capsuleEnergy.classList.add('active');
        this.capsuleParticles.classList.add('active');
        this.mintBtn.disabled = true;
    }
    
    endMintAnimation() {
        this.capsuleImg.classList.remove('charging');
        this.capsuleEnergy.classList.remove('active');
        this.capsuleParticles.classList.remove('active');
        this.mintBtn.classList.remove('loading');
        
        setTimeout(() => {
            this.mintBtn.disabled = false;
            this.mintBtn.querySelector('.btn-text').textContent = `SUMMON ${this.mintQty.value} KNIGHT${this.mintQty.value > 1 ? 'S' : ''}`;
            this.updateDisplay();
        }, 500);
    }
    
    showResult(knights, isNFT = false) {
        const rarityCounts = {};
        knights.forEach(k => {
            const rarity = k.rarity.name;
            rarityCounts[rarity] = (rarityCounts[rarity] || 0) + 1;
        });
        
        const resultText = Object.entries(rarityCounts)
            .map(([rarity, count]) => `${count}x ${rarity}`)
            .join(', ');
        
        // Highest rarity color
        let highestColor = '#808080';
        knights.forEach(k => {
            if (['MYTHIC', 'LEGENDARY', 'EPIC'].includes(k.rarity.tier)) {
                highestColor = k.rarity.color;
            }
        });
        
        const nftText = isNFT ? ' [NFT] 💎' : '';
        this.mintResult.textContent = `⚔️ Summoned: ${resultText}${nftText}`;
        this.mintResult.style.borderColor = highestColor;
        this.mintResult.style.color = highestColor;
        this.mintResult.classList.add('show');
        
        setTimeout(() => {
            this.mintResult.classList.remove('show');
        }, 4000);
    }
    
    saveKnights() {
        localStorage.setItem('allKnights', JSON.stringify(this.knightManager.knights.map(k => ({
            id: k.id,
            rarity: k.rarity,
            stats: k.stats,
            fromBlockchain: k.fromBlockchain || false,
            tokenId: k.tokenId || null
        }))));
    }
    
    saveAndReturn() {
        this.saveKnights();
        window.location.href = 'landing.html';
    }
}

// Initialize
window.addEventListener('DOMContentLoaded', () => {
    new MintingPage();
});
