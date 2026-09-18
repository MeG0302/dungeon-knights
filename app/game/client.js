'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const ENGINE_SCRIPTS = [
  '/js/core/audio.js',
  '/js/core/characters.js',
  '/js/core/dungeon.js',
  '/js/core/pathfinding.js',
  '/js/core/combat.js',
  '/js/core/ui.js',
  '/js/core/game.js',
  '/js/window-bridge.js',
];

export default function GamePage() {
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
        for (const src of ENGINE_SCRIPTS) {
          // eslint-disable-next-line no-await-in-loop
          await load(src);
        }
        if (cancelled) return;
        // Scripts use classic DOMContentLoaded auto-init; dynamically injected
        // scripts miss the real event, so re-fire it to boot the engine.
        if (!window.game) {
          document.dispatchEvent(new Event('DOMContentLoaded'));
        }
        // Engine redirects to /menu itself when no squad is selected.
      } catch (e) {
        console.error('Failed to load game engine:', e);
      }
    })();

    return () => {
      cancelled = true;
      try {
        if (window.game) window.game.isRunning = false;
        delete window.game;
        delete window.ui;
      } catch {}
    };
  }, []);

  return (
    <>
      <link rel="stylesheet" href="/css/styles.css" />
      <link rel="stylesheet" href="/css/mobile.css" />
      <div className="game-container">
        <header className="game-header">
          <div className="header-logo"><h1>Dungeon<br />Knights</h1></div>
          <div className="header-stats">
            <div className="stat-item dungeon-progress">
              <span className="stat-label" id="dungeonNameDisplay">Forgotten Crypts</span>
              <span className="stat-value" id="dungeonProgress">Loot: 0</span>
            </div>
            <div className="stat-item knights-count">
              <span className="stat-label">Knights</span>
              <span className="stat-value" id="knightsCount">0</span>
            </div>
            <div className="stat-item treasure-count">
              <span className="stat-label">Gold</span>
              <span className="stat-value" id="treasureAmount">500</span>
            </div>
          </div>
        </header>
        <main className="game-main" id="gameMain">
          <div className="border-decoration border-top-left"></div>
          <div className="border-decoration border-top-right"></div>
          <div className="border-decoration border-bottom-left"></div>
          <div className="border-decoration border-bottom-right"></div>
          <canvas id="gameCanvas" width="1200" height="800"></canvas>
          <div className="atmosphere-text" id="atmosphereText"></div>
          <aside className="knight-sidebar">
            <div className="sidebar-header">Active Squad</div>
            <div id="activeKnightPortraits" className="knight-portraits-container"></div>
          </aside>
          <div className="minimap-container">
            <canvas id="minimapCanvas" width="150" height="150"></canvas>
          </div>
          <div className="game-log-container">
            <div id="gameLog" className="game-log">
              <p className="log-entry">🎮 Welcome to Dungeon Knights!</p>
              <p className="log-entry">💡 Press &apos;H&apos; for keyboard shortcuts</p>
            </div>
          </div>
        </main>
        <footer className="control-panel">
          <div className="control-section">
            <button id="startDungeon" className="btn-action btn-start" title="Deploy Knights (Space)">⚔️ Deploy</button>
            <button id="stopDungeon" className="btn-action btn-stop" title="Recall Knights (Esc)">🛡️ Recall</button>
            <button id="returnMenuBtn" className="btn-action btn-menu" title="Return to Menu" onClick={() => router.push('/menu')}>🏠 Menu</button>
          </div>
          <div className="control-section">
            <div className="quick-stats">
              <span>Gold/min: <strong id="goldRate">0</strong></span>
              <span>Active: <strong id="activeKnights">0/15</strong></span>
              <span>Loot: <strong id="activeLoot">0</strong></span>
            </div>
          </div>
          <div className="control-section">
            <button id="muteBtn" className="btn-action btn-mute" title="Toggle Sound Effects (S)">🔊</button>
            <button id="muteMusicBtn" className="btn-action btn-mute-music" title="Toggle Music (M)">🎵</button>
            <button id="helpBtn" className="btn-action btn-menu" title="Show Shortcuts (H)">❓</button>
          </div>
        </footer>
        <div className="squad-panel" id="squadPanel">
          <button className="panel-toggle" id="squadToggle">Squad Manager</button>
          <div className="panel-content">
            <div className="panel-section">
              <h3>⚔️ Deployed Knights (<span id="deployedCount">0</span>)</h3>
              <div id="deployedKnights" className="knight-roster">
                <p className="placeholder-text">No knights deployed</p>
              </div>
            </div>
            <div className="panel-section">
              <h3>🏰 All Knights (<span id="totalKnightsCount">0</span>)</h3>
              <div id="allKnightsRoster" className="knight-roster scrollable-roster">
                <p className="placeholder-text">Loading knights...</p>
              </div>
            </div>
            <div className="panel-section">
              <h3>😴 Resting Knights</h3>
              <div id="restingKnights" className="knight-roster">
                <p className="placeholder-text">No knights resting</p>
              </div>
            </div>
            <div className="panel-section">
              <h3>📊 Squad Stats</h3>
              <div id="squadStats" className="squad-stats">
                <p>Total Power: <strong id="totalPower">0</strong></p>
                <p>Avg Speed: <strong id="avgSpeed">0</strong></p>
                <p>Total Stamina: <strong id="totalStamina">0</strong></p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div id="completionModal" className="modal hidden">
        <div className="modal-content">
          <h2>🎉 Dungeon Cleared!</h2>
          <div className="completion-stats">
            <p><strong>Dungeon:</strong> <span id="completedDungeon">-</span></p>
            <p><strong>Gold Earned:</strong> <span id="completionGold">0</span> 💰</p>
            <p><strong>Time:</strong> <span id="completionTime">0:00</span> ⏱️</p>
          </div>
          <div className="modal-actions">
            <button className="btn-primary" id="nextDungeonBtn">🗺️ Next Dungeon</button>
            <button className="btn-secondary" id="replayDungeonBtn">🔄 Replay This Dungeon</button>
            <button className="btn-secondary" id="restHeroesBtn">🍺 Rest All Heroes</button>
          </div>
        </div>
      </div>
      <div id="shortcutsOverlay" className="shortcuts-overlay hidden">
        <h3>⌨️ Keyboard Shortcuts</h3>
        <div className="shortcut-list">
          <div className="shortcut-key">Space</div><div className="shortcut-desc">Deploy Knights</div>
          <div className="shortcut-key">Esc</div><div className="shortcut-desc">Recall Knights</div>
          <div className="shortcut-key">S</div><div className="shortcut-desc">Toggle Sound Effects</div>
          <div className="shortcut-key">M</div><div className="shortcut-desc">Toggle Music</div>
          <div className="shortcut-key">H</div><div className="shortcut-desc">Show/Hide This Menu</div>
          <div className="shortcut-key">Q</div><div className="shortcut-desc">Toggle Squad Panel</div>
        </div>
        <button className="btn-secondary shortcuts-close" id="shortcutsClose">Close</button>
      </div>
      <div id="tooltip" className="tooltip hidden"></div>
    </>
  );
}
