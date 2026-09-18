'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LandingPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const load = (src) =>
      new Promise((resolve, reject) => {
        if (document.querySelector(`script[data-src="${src}"]`)) return resolve();
        const s = document.createElement('script');
        s.src = src;
        s.async = false;
        s.dataset.src = src;
        s.onload = () => resolve();
        s.onerror = reject;
        document.body.appendChild(s);
      });
    (async () => {
      try {
        await load('/js/core/audio.js');
        await load('/js/window-bridge.js');
        if (cancelled) return;
        if (!window.audioManager && window.AudioManager) {
          window.audioManager = new window.AudioManager();
        }
        window.audioManager?.startMenuMusic?.();
      } catch {}
    })();
    const startOnce = () => window.audioManager?.startMenuMusic?.();
    document.addEventListener('click', startOnce, { once: true });
    return () => {
      cancelled = true;
      document.removeEventListener('click', startOnce);
    };
  }, []);

  const clickSfx = () => window.audioManager?.play?.('button_click');

  return (
    <>
      <link rel="stylesheet" href="/css/landing.css" />
      <link rel="stylesheet" href="/css/wallet-widget.css" />
      <link rel="stylesheet" href="/css/mobile.css" />
      <div className="wallet-header">
        <button className="wallet-btn" id="connectWalletBtn" onClick={clickSfx}>
          🔌 Connect Wallet
        </button>
      </div>
      <div className="landing-container">
        <div className="bg-animation"></div>
        <div className="rune-border rune-left"></div>
        <div className="rune-border rune-right"></div>
        <div className="game-logo">
          <h1 className="title-dungeon">Dungeon</h1>
          <h1 className="title-knights">Knights</h1>
        </div>
        <div className="action-buttons">
          <button
            className="action-btn enter-btn"
            onClick={() => { clickSfx(); router.push('/menu'); }}
          >
            <div className="btn-icon-container"><div className="btn-icon-box">🏰</div></div>
            <span className="btn-label">Enter Dungeon</span>
            <span className="btn-arrow">⟫</span>
          </button>
          <button
            className="action-btn summon-btn"
            onClick={() => { clickSfx(); router.push('/mint'); }}
          >
            <div className="btn-icon-container"><div className="btn-icon-box">🔮</div></div>
            <span className="btn-label">Summon Knight</span>
            <span className="btn-arrow">⟫</span>
          </button>
          <button
            className="action-btn marketplace-btn"
            disabled
            onClick={() => alert('🏪 Marketplace coming soon!')}
          >
            <div className="btn-icon-container"><div className="btn-icon-box">💰</div></div>
            <span className="btn-label">Marketplace</span>
            <span className="btn-arrow">🚧</span>
          </button>
        </div>
      </div>
    </>
  );
}
