// Minting Page Controller with Web3 Integration
console.log('🔧 DEBUG: ========================================');
console.log('🔧 DEBUG: mint-v2.js loading... (VERSION 2 with debug)');
console.log('🔧 DEBUG: Timestamp:', new Date().toISOString());
console.log('🔧 DEBUG: ========================================');

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
        console.log('🔧 DEBUG: performMint() called');
        console.log('🔧 DEBUG: this.isWeb3Connected =', this.isWeb3Connected);
        
        if (!this.isWeb3Connected) {
            alert('⚠️ Please connect your wallet first to mint NFT knights!');
            return;
        }
        
        // Ensure web3Manager is initialized and connected
        console.log('🔧 DEBUG: Checking window.web3Manager...');
        console.log('🔧 DEBUG: typeof window.web3Manager =', typeof window.web3Manager);
        console.log('🔧 DEBUG: window.web3Manager exists?', !!window.web3Manager);
        
        if (!window.web3Manager) {
            console.log('🔌 Web3Manager not found, initializing...');
            console.log('🔧 DEBUG: typeof window.Web3Manager =', typeof window.Web3Manager);
            console.log('🔧 DEBUG: window.Web3Manager exists?', !!window.Web3Manager);
            
            if (typeof window.Web3Manager === 'undefined') {
                console.error('❌ CRITICAL: Web3Manager class not available!');
                alert('❌ Web3Manager class not loaded. Please refresh the page.');
                return;
            }
            
            window.web3Manager = new window.Web3Manager();
            console.log('🔧 DEBUG: Created new Web3Manager instance');
            await window.web3Manager.connect();
        }
        
        console.log('🔧 DEBUG: Checking web3Manager.isConnected...');
        console.log('🔧 DEBUG: window.web3Manager.isConnected =', window.web3Manager.isConnected);
        
        if (!window.web3Manager.isConnected) {
            console.log('🔌 Web3Manager not connected, connecting...');
            const connected = await window.web3Manager.connect();
            console.log('🔧 DEBUG: Connection result =', connected);
            if (!connected) {
                alert('⚠️ Failed to connect to Web3. Please refresh and try again.');
                return;
            }
        }
        
        console.log('🔧 DEBUG: About to call mintNFTKnight()...');
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
        this.mintBtn.querySelector('.btn-text').textContent = 'APPROVING $DNG...';
        
        try {
            console.log(`⏳ Minting ${qty} NFT knight(s)...`);
            
            // Step 1: Check and approve $DNG tokens
            const mintCost = 500; // 500 $DNG per knight
            const totalCost = mintCost * qty;
            
            console.log(`💰 Checking $DNG allowance for ${totalCost} $DNG...`);
            this.mintBtn.querySelector('.btn-text').textContent = `APPROVING ${totalCost} $DNG...`;
            
            // Approve tokens (if needed)
            const approved = await window.web3Manager.approveDNG(totalCost);
            if (!approved) {
                throw new Error('Token approval failed or was cancelled');
            }
            
            console.log('✅ $DNG tokens approved');
            
            // Step 2: Mint NFT
            this.mintBtn.querySelector('.btn-text').textContent = 'MINTING NFT...';
            
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
    
    // Initialize Web3 and check connection
    async initWeb3() {
        console.log('🔌 Initializing Web3 connection...');
        
        // Create Web3Manager instance
        if (typeof Web3Manager !== 'undefined') {
            window.web3Manager = new Web3Manager();
            console.log('✅ Web3Manager created');
        } else {
            console.error('❌ Web3Manager class not found');
        }
        
        // Check if RainbowKit wallet is already connected
        if (window.rainbowKitWallet && window.rainbowKitWallet.account) {
            console.log('✅ RainbowKit wallet detected:', window.rainbowKitWallet.account);
            this.isWeb3Connected = true;
            this.updateWalletDisplay(window.rainbowKitWallet.account);
            
            // Connect web3Manager
            if (window.web3Manager) {
                await window.web3Manager.connect();
            }
            return;
        }
        
        // Check if MetaMask is connected
        if (window.ethereum && window.ethereum.selectedAddress) {
            console.log('✅ MetaMask connected:', window.ethereum.selectedAddress);
            this.isWeb3Connected = true;
            this.updateWalletDisplay(window.ethereum.selectedAddress);
            
            // Connect web3Manager
            if (window.web3Manager) {
                await window.web3Manager.connect();
            }
            return;
        }
        
        // Listen for wallet connection events
        window.addEventListener('walletConnected', async (event) => {
            console.log('🔗 Wallet connected event:', event.detail);
            this.isWeb3Connected = true;
            this.updateWalletDisplay(event.detail.address);
            
            // Connect web3Manager
            if (window.web3Manager) {
                await window.web3Manager.connect();
            }
        });
        
        // Listen for account changes
        if (window.ethereum) {
            window.ethereum.on('accountsChanged', async (accounts) => {
                if (accounts.length > 0) {
                    console.log('🔄 Account changed:', accounts[0]);
                    this.isWeb3Connected = true;
                    this.updateWalletDisplay(accounts[0]);
                    
                    // Reconnect web3Manager
                    if (window.web3Manager) {
                        await window.web3Manager.connect();
                    }
                } else {
                    console.log('❌ Wallet disconnected');
                    this.isWeb3Connected = false;
                }
            });
        }
    }
    
    updateWalletDisplay(address) {
        console.log('📝 Updating wallet display:', address);
        // Update UI to show connected wallet
        const walletBtn = document.querySelector('.wallet-btn');
        if (walletBtn) {
            const shortAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;
            walletBtn.textContent = `🔗 ${shortAddress}`;
        }
    }
}

// Initialize
window.addEventListener('DOMContentLoaded', () => {
    new MintingPage();
});
