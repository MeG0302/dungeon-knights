/* ========================================
   DUNGEON KNIGHTS - MEDIEVAL EFFECTS JS
   JavaScript handlers for visual effects
   ======================================== */

class MedievalEffects {
    constructor() {
        this.initialized = false;
    }

    // Initialize all effects
    init() {
        if (this.initialized) return;
        
        this.createParticles();
        this.setupRippleEffects();
        this.setupScrollReveal();
        this.setupButtonEffects();
        
        this.initialized = true;
        console.log('✨ Medieval effects initialized');
    }

    // Create floating particles
    createParticles() {
        // Check if user prefers reduced motion
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            return;
        }

        // Check if mobile (skip particles for performance)
        if (window.innerWidth < 768) {
            return;
        }

        let container = document.querySelector('.particle-container');
        
        if (!container) {
            container = document.createElement('div');
            container.className = 'particle-container';
            document.body.appendChild(container);
        }

        // Create 10 particles
        for (let i = 0; i < 10; i++) {
            const particle = document.createElement('div');
            particle.className = 'particle';
            
            // Make some particles embers
            if (Math.random() > 0.7) {
                particle.classList.add('ember');
            }
            
            container.appendChild(particle);
        }
    }

    // Setup ripple effect on buttons
    setupRippleEffects() {
        document.addEventListener('click', (e) => {
            const target = e.target.closest('.medieval-btn, .quest-btn, .accept-quest-btn');
            
            if (target && !target.disabled) {
                this.createRipple(e, target);
            }
        });
    }

    createRipple(event, element) {
        const ripple = document.createElement('span');
        ripple.className = 'ripple';
        
        const rect = element.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const x = event.clientX - rect.left - size / 2;
        const y = event.clientY - rect.top - size / 2;
        
        ripple.style.width = ripple.style.height = `${size}px`;
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;
        
        element.classList.add('ripple-container');
        element.appendChild(ripple);
        
        setTimeout(() => {
            ripple.remove();
        }, 600);
    }

    // Setup scroll reveal animations
    setupScrollReveal() {
        const revealElements = document.querySelectorAll('.scroll-reveal');
        
        if (revealElements.length === 0) return;

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('revealed');
                }
            });
        }, {
            threshold: 0.1
        });

        revealElements.forEach(el => observer.observe(el));
    }

    // Add press effect to buttons
    setupButtonEffects() {
        const buttons = document.querySelectorAll('.medieval-btn, .quest-btn, .accept-quest-btn');
        
        buttons.forEach(btn => {
            if (!btn.classList.contains('btn-press-effect')) {
                btn.classList.add('btn-press-effect');
            }
        });
    }

    // Show notification toast
    showNotification(type = 'info', title, message, duration = 5000) {
        const toast = document.createElement('div');
        toast.className = `notification-toast ${type} fade-in`;
        
        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: '📜'
        };
        
        toast.innerHTML = `
            <div class="toast-header">
                <div class="toast-icon">${icons[type] || icons.info}</div>
                <div class="toast-title">${title}</div>
                <div class="toast-close" onclick="this.closest('.notification-toast').remove()">×</div>
            </div>
            <div class="toast-message">${message}</div>
        `;
        
        document.body.appendChild(toast);
        
        // Auto-remove after duration
        setTimeout(() => {
            toast.classList.add('hiding');
            setTimeout(() => toast.remove(), 500);
        }, duration);
        
        return toast;
    }

    // Show page transition
    showTransition(text = 'Loading...', icon = '⚔️') {
        let overlay = document.querySelector('.page-transition-overlay');
        
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'page-transition-overlay';
            overlay.innerHTML = `
                <div class="transition-content">
                    <div class="transition-icon">${icon}</div>
                    <div class="transition-text">${text}</div>
                </div>
            `;
            document.body.appendChild(overlay);
        }
        
        setTimeout(() => overlay.classList.add('active'), 10);
        
        return overlay;
    }

    // Hide page transition
    hideTransition() {
        const overlay = document.querySelector('.page-transition-overlay');
        if (overlay) {
            overlay.classList.remove('active');
            setTimeout(() => overlay.remove(), 500);
        }
    }

    // Show loading spinner
    showLoader(container) {
        const loader = document.createElement('div');
        loader.className = 'medieval-loader';
        loader.innerHTML = `
            <div class="loader-ring"></div>
            <div class="loader-ring"></div>
            <div class="loader-ring"></div>
            <div class="loader-center">⚔️</div>
        `;
        
        if (typeof container === 'string') {
            container = document.querySelector(container);
        }
        
        if (container) {
            container.appendChild(loader);
        }
        
        return loader;
    }

    // Add shake animation (for errors)
    shake(element) {
        if (typeof element === 'string') {
            element = document.querySelector(element);
        }
        
        if (element) {
            element.classList.add('shake');
            setTimeout(() => element.classList.remove('shake'), 500);
        }
    }

    // Add bounce animation (for success)
    bounce(element) {
        if (typeof element === 'string') {
            element = document.querySelector(element);
        }
        
        if (element) {
            element.classList.add('bounce');
            setTimeout(() => element.classList.remove('bounce'), 800);
        }
    }

    // Add coin flip animation
    coinFlip(element) {
        if (typeof element === 'string') {
            element = document.querySelector(element);
        }
        
        if (element) {
            element.classList.add('coin-flip');
            setTimeout(() => element.classList.remove('coin-flip'), 1000);
        }
    }

    // Add glow effect to element
    addGlow(element) {
        if (typeof element === 'string') {
            element = document.querySelector(element);
        }
        
        if (element && !element.classList.contains('glow-on-hover')) {
            element.classList.add('glow-on-hover');
        }
    }

    // Highlight element temporarily
    highlight(element, duration = 2000) {
        if (typeof element === 'string') {
            element = document.querySelector(element);
        }
        
        if (element) {
            element.style.transition = 'box-shadow 0.3s ease';
            element.style.boxShadow = '0 0 30px rgba(212, 175, 55, 0.8)';
            
            setTimeout(() => {
                element.style.boxShadow = '';
            }, duration);
        }
    }

    // Confetti effect (gold coins)
    confetti(x, y, count = 20) {
        const colors = ['#D4AF37', '#F4D03F', '#B8860B', '#FFD700'];
        
        for (let i = 0; i < count; i++) {
            const confetti = document.createElement('div');
            confetti.style.position = 'fixed';
            confetti.style.left = `${x}px`;
            confetti.style.top = `${y}px`;
            confetti.style.width = '8px';
            confetti.style.height = '8px';
            confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.borderRadius = '50%';
            confetti.style.pointerEvents = 'none';
            confetti.style.zIndex = '10000';
            confetti.style.boxShadow = '0 0 8px currentColor';
            
            document.body.appendChild(confetti);
            
            const angle = (Math.random() * 360) * Math.PI / 180;
            const velocity = 100 + Math.random() * 200;
            const vx = Math.cos(angle) * velocity;
            const vy = Math.sin(angle) * velocity - 200;
            
            let posX = x;
            let posY = y;
            let velocityY = vy;
            const gravity = 500;
            let opacity = 1;
            
            const startTime = Date.now();
            const duration = 2000;
            
            const animate = () => {
                const elapsed = Date.now() - startTime;
                const progress = elapsed / duration;
                
                if (progress >= 1) {
                    confetti.remove();
                    return;
                }
                
                const dt = 1 / 60;
                velocityY += gravity * dt;
                posX += vx * dt;
                posY += velocityY * dt;
                opacity = 1 - progress;
                
                confetti.style.left = `${posX}px`;
                confetti.style.top = `${posY}px`;
                confetti.style.opacity = opacity;
                
                requestAnimationFrame(animate);
            };
            
            animate();
        }
    }
}

// Create global instance
window.medievalEffects = new MedievalEffects();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.medievalEffects.init();
    });
} else {
    window.medievalEffects.init();
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MedievalEffects;
}
