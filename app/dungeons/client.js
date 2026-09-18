'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const DUNGEONS = [
  { id: 'crypts', name: 'Forgotten Crypts', desc: 'Ancient tombs filled with restless spirits and cursed treasures.', icon: '🏰', enemy: '💀 Undead', img: '/assets/images/maps/crypts.png' },
  { id: 'mines', name: 'Goblin Mines', desc: 'Deep caverns where goblins hoard stolen gems and gold.', icon: '⛏️', enemy: '👺 Goblins', img: '/assets/images/maps/goblin.png' },
  { id: 'temple', name: 'Overgrown Temple', desc: 'Ruins reclaimed by nature, guarded by plant creatures.', icon: '🌿', enemy: '🌱 Nature', img: '/assets/images/maps/temple.png' },
  { id: 'magma', name: 'Magma Chambers', desc: 'Scorching caverns inhabited by fire elementals and lava beasts.', icon: '🔥', enemy: '🔥 Fire', img: '/assets/images/maps/magma.png' },
  { id: 'void', name: 'Void Rift', desc: 'A tear in reality where cosmic horrors lurk in the darkness.', icon: '🌌', enemy: '🌌 Cosmic', img: '/assets/images/maps/void-rift.png' },
];

export default function DungeonSelectPage() {
  const router = useRouter();
  const [entering, setEntering] = useState(null);

  useEffect(() => {
    const s = document.createElement('script');
    s.src = '/js/core/audio.js';
    s.async = false;
    s.onload = () => {
      if (!window.audioManager && window.AudioManager) {
        window.audioManager = new window.AudioManager();
      }
    };
    document.body.appendChild(s);
    return () => { s.remove(); };
  }, []);

  const choose = (d) => {
    window.audioManager?.play?.('button_click');
    localStorage.setItem('selectedDungeon', d.id);
    setEntering(d.name);
    setTimeout(() => router.push('/game'), 2000);
  };

  return (
    <>
      <link rel="stylesheet" href="/css/dungeon-select.css" />
      <link rel="stylesheet" href="/css/mobile.css" />
      <div className="selection-container">
        <header className="selection-header">
          <h1>Choose Your Dungeon</h1>
          <p className="subtitle">Select your starting dungeon. After completion, dungeons will cycle randomly.</p>
        </header>
        <main className="dungeon-grid">
          {DUNGEONS.map((d) => (
            <div key={d.id} className="dungeon-card" onClick={() => choose(d)}>
              <div className="dungeon-image-wrapper">
                <img src={d.img} alt={d.name} className="dungeon-image" />
                <div className="dungeon-overlay"><span className="dungeon-icon">{d.icon}</span></div>
              </div>
              <div className="dungeon-info">
                <h2 className="dungeon-name">{d.name}</h2>
                <p className="dungeon-desc">{d.desc}</p>
                <div className="dungeon-stats">
                  <span>{d.enemy}</span>
                  <span>⚔️ Difficulty: ★★☆☆☆</span>
                </div>
              </div>
            </div>
          ))}
        </main>
        <footer className="selection-footer">
          <button className="btn-back" onClick={() => router.push('/menu')}>🏠 Back to Menu</button>
        </footer>
      </div>
      {entering && (
        <div className="loading-transition">
          <div className="loading-content">
            <h2>Entering {entering}...</h2>
            <div className="loading-spinner"></div>
            <p className="loading-text">Preparing your knights...</p>
          </div>
        </div>
      )}
    </>
  );
}
