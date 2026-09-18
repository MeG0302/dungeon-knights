'use client';

import { useEffect, useRef, useState } from 'react';

const ASSETS = '/assets/points/';

const DUNGEON_LEVELS = [
    { name: 'Vault Entrance', points: 100, color: '#d4a843', duration: 22000 },
    { name: 'Treasury Hall', points: 300, color: '#c09830', duration: 22000 },
    { name: 'Inner Sanctum', points: 500, color: '#b8860b', duration: 22000 },
];

export default function PointsDungeon({ onExit, onComplete }) {
    const canvasRef = useRef(null);
    const animRef = useRef(null);
    const [level, setLevel] = useState(0);
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState('fighting'); // fighting | complete | finished
    const [totalPoints, setTotalPoints] = useState(0);
    const [shared, setShared] = useState(false);
    const levelRef = useRef(0);
    const progressRef = useRef(0);
    const statusRef = useRef('fighting');
    const totalRef = useRef(0);
    const sharedRef = useRef(false);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const W = canvas.width = canvas.offsetWidth;
        const H = canvas.height = canvas.offsetHeight || 400;

        const TILE = 40;
        const COLS = Math.floor(W / TILE);
        const ROWS = Math.floor(H / TILE);

        const knights = [
            { x: 3, y: 3, color: '#4d9fff', label: 'K1' },
            { x: 4, y: 4, color: '#ff6b6b', label: 'K2' },
            { x: 5, y: 3, color: '#4dff4d', label: 'K3' },
            { x: 4, y: 5, color: '#ffdd4d', label: 'K4' },
            { x: 6, y: 4, color: '#dd4dff', label: 'K5' },
        ];

        let enemies = [];
        let particles = [];
        let startTime = Date.now();
        const levelDuration = DUNGEON_LEVELS[levelRef.current].duration;

        function spawnEnemies() {
            enemies = [];
            const count = 3 + levelRef.current * 2;
            for (let i = 0; i < count; i++) {
                enemies.push({
                    x: COLS - 2 - Math.floor(Math.random() * 4),
                    y: 2 + Math.floor(Math.random() * (ROWS - 4)),
                    hp: 100,
                    maxHp: 100,
                    hit: 0,
                    type: ['slime', 'skeleton', 'golem', 'demon'][Math.floor(Math.random() * 4)],
                });
            }
        }

        spawnEnemies();

        function draw() {
            ctx.fillStyle = '#0a0f1a';
            ctx.fillRect(0, 0, W, H);

            // Floor grid
            for (let r = 0; r < ROWS; r++) {
                for (let c = 0; c < COLS; c++) {
                    ctx.fillStyle = (r + c) % 2 === 0 ? '#1a2535' : '#162030';
                    ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
                }
            }

            // Walls
            ctx.fillStyle = '#0d1520';
            ctx.fillRect(0, 0, W, TILE * 0.5);
            ctx.fillRect(0, H - TILE * 0.5, W, TILE * 0.5);
            ctx.fillRect(0, 0, TILE * 0.5, H);
            ctx.fillRect(W - TILE * 0.5, 0, TILE * 0.5, H);

            // Wall details
            ctx.fillStyle = '#1a3040';
            for (let i = 0; i < W; i += TILE * 2) {
                ctx.fillRect(i + TILE * 0.3, TILE * 0.1, TILE * 0.4, TILE * 0.3);
            }

            // Chests (scattered on floor)
            const chestPositions = [[2, 2], [COLS - 3, 2], [2, ROWS - 3], [COLS - 3, ROWS - 3], [Math.floor(COLS / 2), 2]];
            chestPositions.forEach(([cx, cy]) => {
                const cx_px = cx * TILE + TILE / 2;
                const cy_px = cy * TILE + TILE / 2;
                // Chest shadow
                ctx.fillStyle = 'rgba(0,0,0,0.3)';
                ctx.fillRect(cx_px - 14, cy_px + 6, 28, 8);
                // Chest body
                ctx.fillStyle = '#8B4513';
                ctx.fillRect(cx_px - 14, cy_px - 6, 28, 16);
                // Chest lid
                ctx.fillStyle = '#A0522D';
                ctx.beginPath();
                ctx.arc(cx_px, cy_px - 6, 14, Math.PI, 0);
                ctx.fill();
                // Gold trim
                ctx.fillStyle = '#d4a843';
                ctx.fillRect(cx_px - 14, cy_px + 2, 28, 2);
                ctx.fillRect(cx_px - 2, cy_px - 6, 4, 16);
                // Lock
                ctx.fillStyle = '#ffd700';
                ctx.beginPath();
                ctx.arc(cx_px, cy_px + 3, 3, 0, Math.PI * 2);
                ctx.fill();
            });

            // Knights
            knights.forEach((k) => {
                const kx = k.x * TILE + TILE / 2;
                const ky = k.y * TILE + TILE / 2;
                // Shadow
                ctx.fillStyle = 'rgba(0,0,0,0.3)';
                ctx.beginPath();
                ctx.ellipse(kx, ky + 14, 12, 4, 0, 0, Math.PI * 2);
                ctx.fill();
                // Body
                ctx.fillStyle = k.color;
                ctx.fillRect(kx - 10, ky - 12, 20, 20);
                // Head
                ctx.fillStyle = '#ffd5a0';
                ctx.beginPath();
                ctx.arc(kx, ky - 16, 8, 0, Math.PI * 2);
                ctx.fill();
                // Helmet
                ctx.fillStyle = '#888';
                ctx.fillRect(kx - 9, ky - 22, 18, 6);
                // Sword
                ctx.fillStyle = '#ccc';
                ctx.fillRect(kx + 10, ky - 8, 3, 16);
                ctx.fillStyle = '#8B4513';
                ctx.fillRect(kx + 9, ky + 4, 5, 3);
            });

            // Enemies
            enemies.forEach((e) => {
                const ex = e.x * TILE + TILE / 2;
                const ey = e.y * TILE + TILE / 2;
                if (e.hit > 0) {
                    ctx.fillStyle = 'rgba(255,0,0,0.3)';
                    ctx.beginPath();
                    ctx.arc(ex, ey, 20, 0, Math.PI * 2);
                    ctx.fill();
                    e.hit--;
                }
                // Shadow
                ctx.fillStyle = 'rgba(0,0,0,0.3)';
                ctx.beginPath();
                ctx.ellipse(ex, ey + 8, 10, 3, 0, 0, Math.PI * 2);
                ctx.fill();
                // Body
                const colors = { slime: '#44ff44', skeleton: '#cccccc', golem: '#aa7744', demon: '#ff4444' };
                ctx.fillStyle = colors[e.type] || '#ff4444';
                ctx.beginPath();
                ctx.arc(ex, ey, 12, 0, Math.PI * 2);
                ctx.fill();
                // Eyes
                ctx.fillStyle = '#ff0000';
                ctx.beginPath();
                ctx.arc(ex - 4, ey - 2, 3, 0, Math.PI * 2);
                ctx.arc(ex + 4, ey - 2, 3, 0, Math.PI * 2);
                ctx.fill();
                // HP bar
                if (e.hp < e.maxHp) {
                    ctx.fillStyle = '#333';
                    ctx.fillRect(ex - 12, ey - 20, 24, 3);
                    ctx.fillStyle = '#ff4444';
                    ctx.fillRect(ex - 12, ey - 20, 24 * (e.hp / e.maxHp), 3);
                }
            });

            // Particles
            particles.forEach((p, i) => {
                p.x += p.vx;
                p.y += p.vy;
                p.life -= 0.02;
                ctx.globalAlpha = Math.max(0, p.life);
                ctx.fillStyle = p.color;
                ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
                ctx.globalAlpha = 1;
                if (p.life <= 0) particles.splice(i, 1);
            });

            // Atmospheric text
            const current = DUNGEON_LEVELS[levelRef.current];
            ctx.fillStyle = 'rgba(212, 168, 67, 0.08)';
            ctx.font = 'bold 28px serif';
            ctx.textAlign = 'center';
            ctx.fillText(current.name.toUpperCase(), W / 2, H / 2);
        }

        function spawnParticles(x, y, color, count = 8) {
            for (let i = 0; i < count; i++) {
                particles.push({
                    x, y,
                    vx: (Math.random() - 0.5) * 4,
                    vy: (Math.random() - 0.5) * 4,
                    life: 1,
                    color,
                    size: 2 + Math.random() * 3,
                });
            }
        }

        function update() {
            if (statusRef.current !== 'fighting') return;
            const elapsed = Date.now() - startTime;
            const pct = Math.min(elapsed / levelDuration, 1);
            progressRef.current = pct;
            setProgress(pct);

            // Auto-kill enemies over time
            if (enemies.length > 0 && Math.random() < 0.03) {
                const idx = Math.floor(Math.random() * enemies.length);
                const e = enemies[idx];
                e.hp -= 15;
                e.hit = 10;
                spawnParticles(e.x * TILE + TILE / 2, e.y * TILE + TILE / 2, '#ff4444', 3);
                if (e.hp <= 0) {
                    spawnParticles(e.x * TILE + TILE / 2, e.y * TILE + TILE / 2, '#ffdd00', 10);
                    enemies.splice(idx, 1);
                }
            }

            // Move knights randomly
            knights.forEach((k) => {
                if (Math.random() < 0.05) {
                    k.x = Math.max(1, Math.min(COLS - 2, k.x + Math.floor(Math.random() * 3) - 1));
                    k.y = Math.max(1, Math.min(ROWS - 2, k.y + Math.floor(Math.random() * 3) - 1));
                }
            });

            // Check completion
            if (pct >= 1 || enemies.length === 0) {
                statusRef.current = 'complete';
                setStatus('complete');
                const pts = DUNGEON_LEVELS[levelRef.current].points;
                totalRef.current += pts;
                setTotalPoints(totalRef.current);
            }
        }

        function loop() {
            update();
            draw();
            animRef.current = requestAnimationFrame(loop);
        }

        loop();

        return () => {
            if (animRef.current) cancelAnimationFrame(animRef.current);
        };
    }, [level]);

    function handleNext() {
        if (level < DUNGEON_LEVELS.length - 1) {
            const next = level + 1;
            setLevel(next);
            levelRef.current = next;
            setProgress(0);
            progressRef.current = 0;
            setStatus('fighting');
            statusRef.current = 'fighting';
        } else {
            setStatus('finished');
            statusRef.current = 'finished';
        }
    }

    function handleShareX() {
        const text = encodeURIComponent(`I just conquered the Points Vault and earned ${totalPoints} points in Dungeon Knights! 🏰⚔️`);
        window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank');
        sharedRef.current = true;
        setShared(true);
    }

    function handleExit() {
        if (onComplete) onComplete(totalPoints);
    }

    function getMultipliedTotal() {
        return shared ? totalPoints * 2 : totalPoints;
    }

    return (
        <div className="dungeon-overlay">
            <div className="dungeon-container">
                {/* Top Bar */}
                <div className="dungeon-top-bar">
                    <div className="dungeon-level-info">
                        <span className="dungeon-level-name" style={{ color: DUNGEON_LEVELS[level].color }}>
                            {DUNGEON_LEVELS[level].name}
                        </span>
                        <span className="dungeon-level-num">Level {level + 1}/3</span>
                    </div>
                    <div className="dungeon-timer">
                        <div className="dungeon-timer-bar">
                            <div className="dungeon-timer-fill" style={{ width: `${progress * 100}%`, background: DUNGEON_LEVELS[level].color }} />
                        </div>
                        <span className="dungeon-timer-text">{Math.floor((1 - progress) * DUNGEON_LEVELS[level].duration / 1000)}s</span>
                    </div>
                </div>

                {/* Canvas */}
                <canvas ref={canvasRef} className="dungeon-canvas" />

                {/* Bottom Panel */}
                <div className="dungeon-bottom">
                    {status === 'fighting' && (
                        <div className="dungeon-fighting">
                            <div className="dungeon-knights-status">
                                <span className="dungeon-knight-dot" style={{ background: '#4d9fff' }}></span>
                                <span className="dungeon-knight-dot" style={{ background: '#ff6b6b' }}></span>
                                <span className="dungeon-knight-dot" style={{ background: '#4dff4d' }}></span>
                                <span className="dungeon-knight-dot" style={{ background: '#ffdd4d' }}></span>
                                <span className="dungeon-knight-dot" style={{ background: '#dd4dff' }}></span>
                                <span className="dungeon-status-text">Knights battling...</span>
                            </div>
                        </div>
                    )}

                    {status === 'complete' && level < DUNGEON_LEVELS.length - 1 && (
                        <div className="dungeon-complete">
                            <div className="dungeon-reward-announce">
                                +{DUNGEON_LEVELS[level].points} PTS
                            </div>
                            <button className="dungeon-btn dungeon-btn-next" onClick={handleNext}>
                                ⬆ Next Dungeon
                            </button>
                        </div>
                    )}

                    {status === 'complete' && level === DUNGEON_LEVELS.length - 1 && (
                        <div className="dungeon-complete dungeon-final">
                            <div className="dungeon-reward-announce">
                                +{totalPoints} PTS
                            </div>
                            {shared && (
                                <div className="dungeon-multiplier-announce">
                                    x2 MULTIPLIER ACTIVE — {getMultipliedTotal()} PTS TOTAL
                                </div>
                            )}
                            <div className="dungeon-final-btns">
                                <button className="dungeon-btn dungeon-btn-exit" onClick={handleExit}>
                                    Exit Dungeon
                                </button>
                                <button
                                    className={`dungeon-btn dungeon-btn-share ${shared ? 'shared' : ''}`}
                                    onClick={handleShareX}
                                    disabled={shared}
                                >
                                    {shared ? '✓ Shared (x2 Active)' : '𝕏 Share for x2'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
