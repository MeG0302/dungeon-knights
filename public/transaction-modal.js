// Transaction Modal Manager
console.log('Loading transaction-modal.js...');

class TransactionModal {
    constructor() {
        this.modal = null;
        this.particleInterval = null;
        this.createModal();
        console.log('✅ TransactionModal initialized');
    }

    createModal() {
        // Create modal HTML
        const modalHTML = `
            <div id="transactionModal" class="transaction-modal">
                <div class="transaction-content">
                    <div class="particle-container" id="particleContainer"></div>
                    
                    <div id="transactionIcon" class="transaction-icon">⏳</div>
                    <h2 id="transactionTitle" class="transaction-title">Processing Transaction</h2>
                    <p id="transactionMessage" class="transaction-message">Please confirm the transaction in your wallet...</p>
                    
                    <div id="transactionSpinner" class="spinner"></div>
                    
                    <div id="transactionAmount" class="transaction-amount" style="display: none;">0 $DNG</div>
                    
                    <div id="transactionHash" class="transaction-hash" style="display: none;"></div>
                    
                    <button id="transactionCloseBtn" class="transaction-close-btn" style="display: none;">
                        Continue
                    </button>
                </div>
            </div>
        `;

        // Inject into DOM
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // Get references
        this.modal = document.getElementById('transactionModal');
        this.icon = document.getElementById('transactionIcon');
        this.title = document.getElementById('transactionTitle');
        this.message = document.getElementById('transactionMessage');
        this.spinner = document.getElementById('transactionSpinner');
        this.amount = document.getElementById('transactionAmount');
        this.hashDisplay = document.getElementById('transactionHash');
        this.closeBtn = document.getElementById('transactionCloseBtn');
        this.particleContainer = document.getElementById('particleContainer');

        // Setup close button
        this.closeBtn.addEventListener('click', () => this.hide());
    }

    show() {
        this.modal.classList.add('active');
    }

    hide() {
        this.modal.classList.remove('active');
        this.stopParticles();
    }

    showLoading(message = 'Please confirm the transaction in your wallet...') {
        this.show();
        this.icon.textContent = '⏳';
        this.title.textContent = 'Processing Transaction';
        this.message.textContent = message;
        this.spinner.style.display = 'block';
        this.amount.style.display = 'none';
        this.hashDisplay.style.display = 'none';
        this.closeBtn.style.display = 'none';
    }

    showWaiting(txHash) {
        this.icon.textContent = '⛓️';
        this.title.textContent = 'Waiting for Confirmation';
        this.message.textContent = 'Your transaction is being processed on the blockchain...';
        
        if (txHash) {
            this.hashDisplay.innerHTML = `
                <div style="margin-bottom: 8px; font-weight: bold;">Transaction Hash:</div>
                <a href="https://explorer.testnet.chain.robinhood.com/tx/${txHash}" target="_blank">
                    ${txHash.slice(0, 10)}...${txHash.slice(-8)}
                </a>
            `;
            this.hashDisplay.style.display = 'block';
        }
    }

    showSuccess(amount, txHash) {
        this.icon.textContent = '';
        this.spinner.style.display = 'none';
        
        // Create checkmark
        const checkmarkHTML = `
            <div class="checkmark-circle success-glow">
                <div class="checkmark"></div>
            </div>
        `;
        this.icon.innerHTML = checkmarkHTML;
        
        this.title.textContent = 'Claim Successful!';
        this.message.textContent = 'Your rewards have been transferred to your wallet.';
        
        // Show amount
        if (amount) {
            this.amount.textContent = `${amount.toFixed(2)} $DNG`;
            this.amount.style.display = 'block';
        }
        
        // Update hash display
        if (txHash) {
            this.hashDisplay.innerHTML = `
                <div style="margin-bottom: 8px; font-weight: bold;">Transaction Hash:</div>
                <a href="https://explorer.testnet.chain.robinhood.com/tx/${txHash}" target="_blank">
                    ${txHash.slice(0, 10)}...${txHash.slice(-8)}
                </a>
            `;
            this.hashDisplay.style.display = 'block';
        }
        
        this.closeBtn.style.display = 'inline-block';
        
        // Start particle effects
        this.startParticles();
        this.spawnCoinParticles();
    }

    showError(errorMessage) {
        this.icon.textContent = '❌';
        this.spinner.style.display = 'none';
        this.title.textContent = 'Transaction Failed';
        this.message.textContent = errorMessage || 'An error occurred. Please try again.';
        this.closeBtn.style.display = 'inline-block';
        this.closeBtn.textContent = 'Close';
    }

    startParticles() {
        // Create floating particles
        this.particleInterval = setInterval(() => {
            this.createParticle();
        }, 100);

        // Stop after 3 seconds
        setTimeout(() => this.stopParticles(), 3000);
    }

    stopParticles() {
        if (this.particleInterval) {
            clearInterval(this.particleInterval);
            this.particleInterval = null;
        }
    }

    createParticle() {
        const particle = document.createElement('div');
        particle.className = 'particle';
        
        // Random position at bottom
        particle.style.left = Math.random() * 100 + '%';
        particle.style.bottom = '0';
        
        // Random delay
        particle.style.animationDelay = Math.random() * 0.5 + 's';
        
        this.particleContainer.appendChild(particle);
        
        // Remove after animation
        setTimeout(() => {
            particle.remove();
        }, 1500);
    }

    spawnCoinParticles() {
        // Create coin emoji particles
        for (let i = 0; i < 10; i++) {
            setTimeout(() => {
                const coin = document.createElement('div');
                coin.className = 'coin-particle';
                coin.textContent = '💰';
                
                // Random position
                coin.style.left = (30 + Math.random() * 40) + '%';
                coin.style.bottom = '40%';
                
                // Random animation delay
                coin.style.animationDelay = Math.random() * 0.3 + 's';
                
                this.particleContainer.appendChild(coin);
                
                // Remove after animation
                setTimeout(() => {
                    coin.remove();
                }, 2000);
            }, i * 150);
        }
    }

    // Convenience methods for claim flow
    async showClaimFlow(claimFunction) {
        this.showLoading('Confirm the transaction to claim your rewards...');
        
        try {
            // Execute claim function
            const result = await claimFunction();
            
            if (result && result.txHash) {
                this.showWaiting(result.txHash);
                // Success will be shown by external code after tx.wait()
            }
            
            return result;
        } catch (error) {
            let errorMsg = 'Transaction failed. Please try again.';
            
            if (error.message.includes('user rejected')) {
                errorMsg = 'Transaction was cancelled.';
            } else if (error.message.includes('insufficient funds')) {
                errorMsg = 'Insufficient funds for gas fees.';
            }
            
            this.showError(errorMsg);
            return null;
        }
    }
}

// Global instance
window.transactionModal = new TransactionModal();

console.log('✅ transaction-modal.js loaded');
