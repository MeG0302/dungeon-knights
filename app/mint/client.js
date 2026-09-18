'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KNIGHT_IMAGES, loadKnights, nextKnightId, recruitKnight, saveKnights } from '../../lib/knights';

const PRICE_PER_KNIGHT = 0.001;

export default function MintPage() {
  const router = useRouter();
  const [qty, setQty] = useState(1);
  const [knights, setKnights] = useState([]);
  const [lastMint, setLastMint] = useState([]);

  useEffect(() => {
    setKnights(loadKnights());
    const s = document.createElement('script');
    s.src = '/js/core/audio.js';
    s.async = false;
    s.onload = () => {
      if (!window.audioManager && window.AudioManager) {
        window.audioManager = new window.AudioManager();
      }
      window.audioManager?.startMenuMusic?.();
    };
    document.body.appendChild(s);
    return () => { s.remove(); };
  }, []);

  const total = useMemo(() => (qty * PRICE_PER_KNIGHT).toFixed(3), [qty]);

  const mint = () => {
    window.audioManager?.play?.('button_click');
    const current = loadKnights();
    let id = nextKnightId(current);
    const fresh = [];
    for (let i = 0; i < qty; i++) {
      fresh.push(recruitKnight(id++));
    }
    const all = [...current, ...fresh];
    saveKnights(all);
    setKnights(all);
    setLastMint(fresh);
    window.audioManager?.play?.('mint_success');
  };

  return (
    <>
      <link rel="stylesheet" href="/css/mint.css" />
      <link rel="stylesheet" href="/css/wallet-widget.css" />
      <link rel="stylesheet" href="/css/mobile.css" />
      <div className="mint-container">
        <div className="bg-animation"></div>
        <header className="mint-header">
          <button className="back-btn" onClick={() => router.push('/')}>← Back</button>
          <h1 className="page-title">SUMMON KNIGHTS</h1>
          <div className="header-right">
            <button className="wallet-btn" onClick={() => window.audioManager?.play?.('button_click')}>
              🔌 Connect Wallet
            </button>
          </div>
        </header>
        <main className="mint-main">
          <section className="capsule-section">
            <div className="capsule-display">
              <div className="capsule-background"></div>
              <div className="capsule-glow"></div>
              <img src="/assets/images/capsule.png" alt="Summoning Capsule" className="capsule-img" />
              <div className="capsule-energy"></div>
              <div className="capsule-particles"></div>
            </div>
            <div className="mint-result">
              {lastMint.map((k) => (
                <div key={k.id} style={{ color: k.rarity.color }}>
                  ⚔️ Knight #{k.id} — {k.rarity.name} (Power {k.stats.power})
                </div>
              ))}
            </div>
          </section>
          <section className="controls-section">
            <div className="mint-info">
              <h2>Forge NFT Knights</h2>
              <p>Mint ERC-721 NFTs on Robinhood Chain</p>
            </div>
            <div className="quantity-selector">
              <label className="selector-label">Summon Quantity:</label>
              <div className="qty-controls">
                <button className="qty-btn" onClick={() => setQty((q) => Math.max(1, q - 1))}>-</button>
                <input type="number" className="qty-display" value={qty} min={1} max={5} readOnly />
                <button className="qty-btn" onClick={() => setQty((q) => Math.min(5, q + 1))}>+</button>
              </div>
            </div>
            <div className="cost-display">
              <span className="cost-label">Total Cost:</span>
              <span className="cost-value"><span>{total}</span> <span className="eth-cost">ETH</span></span>
            </div>
            <button className="mint-action-btn" onClick={mint}>
              <span className="btn-icon">⚡</span>
              <span className="btn-text">MINT {qty} KNIGHT{qty > 1 ? 'S' : ''}</span>
            </button>
            <div className="nft-info">
              <p className="nft-notice">
                💎 <strong>NFT Minting</strong><br />
                Knights will be minted as ERC-721 NFTs on Robinhood Chain<br />
                <span>Testnet • Contract: 0xEA37...e55A</span>
              </p>
            </div>
            <div className="mint-tips">
              <p>💎 Rarity Distribution:</p>
              <ul>
                <li><span className="rarity-dot common"></span> Common: 65%</li>
                <li><span className="rarity-dot uncommon"></span> Uncommon: 20%</li>
                <li><span className="rarity-dot rare"></span> Rare: 10%</li>
                <li><span className="rarity-dot epic"></span> Epic: 4.5%</li>
                <li><span className="rarity-dot legendary"></span> Legendary: 1.2%</li>
                <li><span className="rarity-dot mythic"></span> Mythic: 0.3%</li>
              </ul>
            </div>
          </section>
        </main>
        <footer className="knights-preview">
          <h3>Your Knights: <span>{knights.length}</span></h3>
          <div className="knights-grid">
            {knights.length === 0 ? (
              <p className="empty-msg">No knights summoned yet</p>
            ) : (
              knights.map((k) => (
                <div key={k.id} title={`#${k.id} ${k.rarity?.name}`}>
                  <img src={KNIGHT_IMAGES[k.rarity?.tier] ?? KNIGHT_IMAGES.COMMON} alt={`Knight #${k.id}`} width={48} height={48} />
                </div>
              ))
            )}
          </div>
        </footer>
      </div>
    </>
  );
}
