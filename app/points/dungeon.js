'use client';

import { useEffect, useRef, useState } from 'react';

const LEVELS = [
    { name: 'Vault Entrance', points: 100, color: '#d4a843', duration: 22000 },
    { name: 'Treasury Hall', points: 300, color: '#c09830', duration: 22000 },
    { name: 'Inner Sanctum', points: 500, color: '#b8860b', duration: 22000 },
];

const KNIGHT_COLORS = ['#4d9fff', '#ff6b6b', '#4dff4d', '#ffdd4d', '#dd4dff'];
const kColors = KNIGHT_COLORS;

export default function PointsDungeon({ onExit, onShare }) {
    const canvasRef = useRef(null);
    const animRef = useRef(null);
    const [level, setLevel] = useState(0);
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState('fighting');
    const [shared, setShared] = useState(false);
    const levelRef = useRef(0);
    const statusRef = useRef('fighting');

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight || 500;
        const W = canvas.width;
        const H = canvas.height;
        const TILE = 40;
        const COLS = Math.floor(W / TILE);
        const ROWS = Math.floor(H / TILE);

        const knights = [
            { x: 3, y: 3 }, { x: 4, y: 4 }, { x: 5, y: 3 },
            { x: 4, y: 5 }, { x: 6, y: 4 },
        ];

        let enemies = [];
        let particles = [];
        const startTime = Date.now();

        function spawnEnemies() {
            enemies = [];
            const count = 4 + levelRef.current * 2;
            for (let i = 0; i < count; i++) {
                enemies.push({
                    x: COLS - 3 - Math.floor(Math.random() * 3),
                    y: 1 + Math.floor(Math.random() * (ROWS - 2)),
                    hp: 100, maxHp: 100, hit: 0,
                    type: ['slime', 'skeleton', 'golem', 'demon'][Math.floor(Math.random() * 4)],
                });
            }
        }
        spawnEnemies();

        const enemyColors = { slime: '#44ff44', skeleton: '#cccccc', golem: '#aa7744', demon: '#ff4444' };

        function spawnParticles(x, y, color, count = 6) {
            for (let i = 0; i < count; i++) {
                particles.push({
                    x, y, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3,
                    life: 1, color, size: 2 + Math.random() * 2,
                });
            }
        }

        function draw() {
            ctx.fillStyle = '#0a0f1a';
            ctx.fillRect(0, 0, W, H);

            // Floor
            for (let r = 0; r < ROWS; r++) {
                for (let c = 0; c < COLS; c++) {
                    ctx.fillStyle = (r + c) % 2 === 0 ? '#1a2535' : '#162030';
                    ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
                }
            }

            // Walls
            ctx.fillStyle = '#0d1520';
            ctx.fillRect(0, 0, W, TILE * 0.4);
            ctx.fillRect(0, H - TILE * 0.4, W, TILE * 0.4);
            ctx.fillRect(0, 0, TILE * 0.4, H);
            ctx.fillRect(W - TILE * 0.4, 0, TILE * 0.4, H);

            // Torches on walls
            for (let i = 0; i < W; i += TILE * 3) {
                ctx.fillStyle = '#d4a843';
                ctx.beginPath();
                ctx.arc(i + TILE, TILE * 0.25, 3, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = 'rgba(212, 168, 67, 0.08)';
                ctx.beginPath();
                ctx.arc(i + TILE, TILE * 0.25, 15, 0, Math.PI * 2);
                ctx.fill();
            }

            // Chests
            [[2, 2], [COLS - 3, 2], [Math.floor(COLS / 2), 1]].forEach(([cx, cy]) => {
                const cx_px = cx * TILE + TILE / 2;
                const cy_px = cy * TILE + TILE / 2;
                ctx.fillStyle = '#8B4513';
                ctx.fillRect(cx_px - 12, cy_px - 4, 24, 14);
                ctx.fillStyle = '#A0522D';
                ctx.beginPath();
                ctx.arc(cx_px, cy_px - 4, 12, Math.PI, 0);
                ctx.fill();
                ctx.fillStyle = '#d4a843';
                ctx.fillRect(cx_px - 12, cy_px + 2, 24, 2);
                ctx.fillRect(cx_px - 2, cy_px - 4, 4, 14);
                ctx.fillStyle = '#ffd700';
                ctx.beginPath();
                ctx.arc(cx_px, cy_px + 3, 2, 0, Math.PI * 2);
                ctx.fill();
            });

            // Enemies
            enemies.forEach((e) => {
                const ex = e.x * TILE + TILE / 2;
                const ey = e.y * TILE + TILE / 2;
                if (e.hit > 0) { ctx.fillStyle = 'rgba(255,0,0,0.3)'; ctx.beginPath(); ctx.arc(ex, ey, 18, 0, Math.PI * 2); ctx.fill(); e.hit--; }
                ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(ex, ey + 8, 10, 3, 0, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = enemyColors[e.type] || '#ff4444'; ctx.beginPath(); ctx.arc(ex, ey, 11, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#f00'; ctx.beginPath(); ctx.arc(ex - 4, ey - 2, 2.5, 0, Math.PI * 2); ctx.arc(ex + 4, ey - 2, 2.5, 0, Math.PI * 2); ctx.fill();
                if (e.hp < e.maxHp) { ctx.fillStyle = '#333'; ctx.fillRect(ex - 12, ey - 20, 24, 3); ctx.fillStyle = '#f44'; ctx.fillRect(ex - 12, ey - 20, 24 * (e.hp / e.maxHp), 3); }
            });

            // Knights
            knights.forEach((k, i) => {
                const kx = k.x * TILE + TILE / 2;
                const ky = k.y * TILE + TILE / 2;
                ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(kx, ky + 12, 11, 3, 0, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = kColors[i]; ctx.fillRect(kx - 9, ky - 10, 18, 18);
                ctx.fillStyle = '#ffd5a0'; ctx.beginPath(); ctx.arc(kx, ky - 14, 7, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#777'; ctx.fillRect(kx - 8, ky - 20, 16, 5);
            });

            // Particles
            particles.forEach((p, i) => {
                p.x += p.vx; p.y += p.vy; p.life -= 0.02;
                ctx.globalAlpha = Math.max(0, p.life);
                ctx.fillStyle = p.color;
                ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
                ctx.globalAlpha = 1;
                if (p.life <= 0) particles.splice(i, 1);
            });

            // Level name watermark
            const lvl = LEVELS[levelRef.current];
            ctx.fillStyle = 'rgba(212, 168, 67, 0.06)';
            ctx.font = 'bold 24px serif';
            ctx.textAlign = 'center';
            ctx.fillText(lvl.name.toUpperCase(), W / 2, H / 2);
        }

        function update() {
            if (statusRef.current !== 'fighting') return;
            const elapsed = Date.now() - startTime;
            const dur = LEVELS[levelRef.current].duration;
            const pct = Math.min(elapsed / dur, 1);
            setProgress(pct);

            if (enemies.length > 0 && Math.random() < 0.04) {
                const idx = Math.floor(Math.random() * enemies.length);
                const e = enemies[idx];
                e.hp -= 12; e.hit = 8;
                spawnParticles(e.x * TILE + TILE / 2, e.y * TILE + TILE / 2, '#f44', 3);
                if (e.hp <= 0) { spawnParticles(e.x * TILE + TILE / 2, e.y * TILE + TILE / 2, '#fd0', 8); enemies.splice(idx, 1); }
            }

            knights.forEach((k) => {
                if (Math.random() < 0.04) {
                    k.x = Math.max(1, Math.min(COLS - 2, k.x + Math.floor(Math.random() * 3) - 1));
                    k.y = Math.max(1, Math.min(ROWS - 2, k.y + Math.floor(Math.random() * 3) - 1));
                }
            });

            if (pct >= 1 || enemies.length === 0) {
                statusRef.current = 'complete';
                setStatus('complete');
            }
        }

        function loop() { update(); draw(); animRef.current = requestAnimationFrame(loop); }
        loop();

        return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
    }, [level]);

    function handleNext() {
        if (level < LEVELS.length - 1) {
            const n = level + 1;
            setLevel(n); levelRef.current = n;
            setProgress(0); setStatus('fighting'); statusRef.current = 'fighting';
        } else {
            setStatus('finished'); statusRef.current = 'finished';
        }
    }

    function handleShareX() {
        const text = encodeURIComponent(`I just conquered the Points Vault and earned 900 PTS in Dungeon Knights!`);
        window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank');
        if (onShare) onShare();
        setShared(true);
    }

    function handleExit() {
        if (onExit) onExit();
    }

    const totalVault = LEVELS.reduce((s, l) => s + l.points, 0);

    return (
        <div className="dungeon-overlay">
            <div className="dungeon-container">
                <div className="dungeon-top-bar">
                    <div className="dungeon-level-info">
                        <span className="dungeon-level-name" style={{ color: LEVELS[level].color }}>{LEVELS[level].name}</span>
                        <span className="dungeon-level-num">{level + 1}/3</span>
                    </div>
                    <div className="dungeon-timer">
                        <div className="dungeon-timer-bar">
                            <div className="dungeon-timer-fill" style={{ width: `${progress * 100}%`, background: LEVELS[level].color }} />
                        </div>
                        <span className="dungeon-timer-text">{Math.max(0, Math.ceil((1 - progress) * LEVELS[level].duration / 1000))}s</span>
                    </div>
                </div>
                <canvas ref={canvasRef} className="dungeon-canvas" />
                <div className="dungeon-bottom">
                    {status === 'fighting' && (
                        <div className="dungeon-fighting">
                            <div className="dungeon-knights-status">
                                {kColors.map((c, i) => <span key={i} className="dungeon-knight-dot" style={{ background: c, animationDelay: `${i * 0.15}s` }} />)}
                                <span className="dungeon-status-text">Knights battling...</span>
                            </div>
                        </div>
                    )}
                    {status === 'complete' && level < LEVELS.length - 1 && (
                        <div className="dungeon-complete">
                            <div className="dungeon-reward-announce">+{LEVELS[level].points} PTS</div>
                            <button className="dungeon-btn dungeon-btn-next" onClick={handleNext}>Next Dungeon</button>
                        </div>
                    )}
                    {status === 'complete' && level === LEVELS.length - 1 && (
                        <div className="dungeon-complete dungeon-final">
                            <div className="dungeon-reward-announce">+{totalVault} PTS</div>
                            <div className="dungeon-final-btns">
                                <button className="dungeon-btn dungeon-btn-exit" onClick={handleExit}>Exit Dungeon</button>
                                <button className={`dungeon-btn dungeon-btn-share ${shared ? 'shared' : ''}`} onClick={handleShareX} disabled={shared}>
                                    {shared ? 'Shared (x2 Active)' : 'Share on X for x2'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
