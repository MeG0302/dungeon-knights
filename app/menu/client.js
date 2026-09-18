'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KNIGHT_IMAGES, loadKnights } from '../../lib/knights';

const MAX_SQUAD = 15;

export default function MenuPage() {
  const router = useRouter();
  const [knights, setKnights] = useState([]);
  const [gold, setGold] = useState(500);
  const [selected, setSelected] = useState(new Set());
  const [sortBy, setSortBy] = useState('id');
  const [filterRarity, setFilterRarity] = useState('all');
  const [modalKnight, setModalKnight] = useState(null);

  useEffect(() => {
    setKnights(loadKnights());
    const g = localStorage.getItem('gameGold');
    if (g) setGold(parseInt(g, 10));
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

  const visible = useMemo(() => {
    let list = [...knights];
    if (filterRarity !== 'all') list = list.filter((k) => k.rarity?.tier === filterRarity);
    const val = (k) => {
      switch (sortBy) {
        case 'rarity': return -(k.rarity?.multiplier ?? 0);
        case 'power': return -(k.stats?.power ?? 0);
        case 'speed': return -(k.stats?.speed ?? 0);
        case 'stamina': return -(k.stats?.maxStamina ?? 0);
        default: return k.id;
      }
    };
    return list.sort((a, b) => val(a) - val(b));
  }, [knights, sortBy, filterRarity]);

  const toggle = (id) => {
    window.audioManager?.play?.('button_click');
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_SQUAD) next.add(id);
      return next;
    });
  };

  const play = () => {
    const squad = knights.filter((k) => selected.has(k.id));
    if (squad.length === 0) {
      alert('⚠️ Select at least 1 knight!');
      return;
    }
    localStorage.setItem('selectedKnights', JSON.stringify(squad));
    localStorage.setItem('gameGold', String(gold));
    router.push('/dungeons');
  };

  return (
    <>
      <link rel="stylesheet" href="/css/menu.css" />
      <link rel="stylesheet" href="/css/wallet-widget.css" />
      <link rel="stylesheet" href="/css/mobile.css" />
      <div className="wallet-header">
        <button className="wallet-btn" onClick={() => window.audioManager?.play?.('button_click')}>
          🔌 Connect Wallet
        </button>
      </div>
      <div className="menu-container">
        <div className="bg-animation"></div>
        <header className="game-header">
          <h1 className="game-title">DUNGEON KNIGHTS</h1>
          <div className="gold-display">
            <span className="gold-icon">💰</span>
            <span id="menuGold">{gold}</span> Gold
          </div>
        </header>
        <main className="menu-main">
          <section className="menu-panel left-panel">
            <h2 className="panel-title">⚔️ ADVENTURE</h2>
            <button className="menu-btn play-btn" onClick={play}>
              <span className="btn-icon">🎮</span>
              <span className="btn-text">ENTER DUNGEON</span>
              <span className="btn-subtitle">Deploy Selected Knights</span>
            </button>
            <button className="menu-btn back-menu-btn" onClick={() => router.push('/')}>
              <span className="btn-icon">🏠</span>
              <span className="btn-text">MAIN MENU</span>
              <span className="btn-subtitle">Return to Landing</span>
            </button>
            <div className="quick-actions">
              <button className="quick-btn" onClick={() => setSelected(new Set(knights.slice(0, MAX_SQUAD).map((k) => k.id)))}>
                <span>✓ Select All</span>
              </button>
              <button className="quick-btn" onClick={() => setSelected(new Set())}>
                <span>✗ Clear Selection</span>
              </button>
            </div>
          </section>
          <section className="menu-panel right-panel">
            <div className="panel-header">
              <h2 className="panel-title">🛡️ KNIGHT ROSTER</h2>
              <div className="filter-controls">
                <label className="filter-label">Sort By:</label>
                <select className="filter-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                  <option value="id">Knight ID</option>
                  <option value="rarity">Rarity</option>
                  <option value="power">Power</option>
                  <option value="speed">Speed</option>
                  <option value="stamina">Stamina</option>
                </select>
                <label className="filter-label">Filter:</label>
                <select className="filter-select" value={filterRarity} onChange={(e) => setFilterRarity(e.target.value)}>
                  <option value="all">All Rarities</option>
                  <option value="MYTHIC">Mythic</option>
                  <option value="LEGENDARY">Legendary</option>
                  <option value="EPIC">Epic</option>
                  <option value="RARE">Rare</option>
                  <option value="UNCOMMON">Uncommon</option>
                  <option value="COMMON">Common</option>
                </select>
              </div>
            </div>
            <div className="troops-info">
              <span>Selected: <strong>{selected.size}</strong> / {MAX_SQUAD}</span>
              <span>Total Knights: <strong>{knights.length}</strong></span>
            </div>
            <div className="knight-roster" id="knightRoster">
              {visible.length === 0 ? (
                <p className="empty-message">No knights recruited yet. Visit the Summoning Chamber to forge your first knight!</p>
              ) : (
                visible.map((k) => (
                  <div
                    key={k.id}
                    className={`knight-card${selected.has(k.id) ? ' selected' : ''}`}
                    onClick={() => toggle(k.id)}
                    onDoubleClick={() => setModalKnight(k)}
                    style={{ borderColor: k.rarity?.color }}
                  >
                    <img src={KNIGHT_IMAGES[k.rarity?.tier] ?? KNIGHT_IMAGES.COMMON} alt={`Knight #${k.id}`} width={64} height={64} />
                    <div>#{k.id} {k.rarity?.name}</div>
                    <div>⚡{k.stats?.power} 🏃{k.stats?.speed}</div>
                  </div>
                ))
              )}
            </div>
          </section>
        </main>
        <footer className="menu-footer">
          <p>Select up to {MAX_SQUAD} knights and deploy them into the dungeons!</p>
          <p className="music-hint">🎵 Music starts on interaction</p>
        </footer>
      </div>
      {modalKnight && (
        <div className="modal-overlay" onClick={() => setModalKnight(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setModalKnight(null)}>✕</button>
            <div className="modal-header">
              <div className="modal-knight-avatar">
                <img src={KNIGHT_IMAGES[modalKnight.rarity?.tier] ?? KNIGHT_IMAGES.COMMON} alt="Knight" />
              </div>
              <div className="modal-knight-info">
                <h2>Knight #{modalKnight.id}</h2>
                <div className="modal-rarity">{modalKnight.rarity?.name} Knight</div>
              </div>
            </div>
            <div className="modal-body">
              <div className="modal-stat"><span>⚡ Power:</span><span>{modalKnight.stats?.power}</span></div>
              <div className="modal-stat"><span>🏃 Speed:</span><span>{modalKnight.stats?.speed}</span></div>
              <div className="modal-stat"><span>💪 Max Stamina:</span><span>{modalKnight.stats?.maxStamina}</span></div>
              <div className="modal-stat"><span>Total Earned:</span><span>{modalKnight.totalEarned ?? 0} Gold</span></div>
            </div>
            <div className="modal-footer">
              <button className="modal-btn select-btn" onClick={() => { toggle(modalKnight.id); setModalKnight(null); }}>
                {selected.has(modalKnight.id) ? 'Remove from Squad' : 'Add to Squad'}
              </button>
              <button className="modal-btn close-btn" onClick={() => setModalKnight(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
