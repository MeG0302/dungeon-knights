'use client';

import { useEffect, useRef, useState } from 'react';
import { VAULT_LEVELS, VAULT_ENTRY_TOTAL } from '../../lib/points-config';

// The vault is a scripted mini-game, not an engine dungeon: the player is handed
// five identical dummy knights (not real NFTs) and each sub-dungeon auto-resolves
// in about twenty seconds. The outcome is fixed — only the show varies — so the
// Points payout can never depend on frame timing.
const ASSETS = '/assets/points/';

// The points each sub-dungeon pays live in lib/points-config.js so the page, the
// mini-game and the payout API can never disagree about them; this adds the staging.
const STAGING = [
    { color: '#d4a843', monsters: 4, chests: 1 },
    { color: '#c09830', monsters: 6, chests: 2 },
    { color: '#b8860b', monsters: 8, chests: 3 },
];
const LEVELS = VAULT_LEVELS.map((level, i) => ({ ...level, ...STAGING[i] }));
const VAULT_TOTAL = VAULT_ENTRY_TOTAL;

const SPRITES = {
    // Every dummy knight uses the same placeholder art — they are not owned NFTs
    knights: [`${ASSETS}dummy-knight.png`],
    monsters: [
        `${ASSETS}monster-1.png`,
        `${ASSETS}monster-2.png`,
        `${ASSETS}monster-3.png`,
    ],
    chest: `${ASSETS}chest.png`,
    map: `${ASSETS}background.mp4`,
};

const KNIGHT_COUNT = 5;
const LEVEL_SECONDS = 22;          // hard cap per sub-dungeon
const MONSTER_HP = 150;
// Later floors hold more monsters, so they also hit softer: without this the eight-monster
// floor could never be cleared inside its cap and every run ended on the timer instead of
// on a finished room.
const HP_FALLOFF = 0.12;
const KNIGHT_DAMAGE = 16;
const SWING_TIME = 0.42;           // seconds per swing
const KNIGHT_SPEED = 150;          // px per second
const COUNTER_COOLDOWN = 1.9;      // seconds between a monster's counters
const ROW_DEPTH = 1.6;             // how much shorter a floor row is than it is wide

// Every clearance in this room is derived from the art, which is where the numbers come
// from: dummy-knight 1599x1798 (0.889), monsters 1.076 / 1.066 / 0.755 wide, chest 1.166.
// They used to be hard-coded (an 88 px keep-out, a 100 px fight ring) and that is what
// broke the eight-monster floor: at this canvas width the monsters sat 111 px apart while
// the ring demanded 100, so the ring fought the neighbouring keep-out and shoved knights
// from both sides — none of them ever steadied long enough to swing a sword.
const KNIGHT_ASPECT = 0.889;
const MONSTER_ASPECT = 1.076;      // the widest of the three monster sprites
const CHEST_ASPECT = 1.166;

function spriteScale(W) {
    return Math.min(1.25, Math.max(0.7, W / 1100));
}

/** Drawn sizes and the clearances implied by them, all in screen pixels. */
function sizes(W) {
    const s = spriteScale(W);
    const knightH = 62 * s;
    const monsterH = 72 * s;
    const chestH = 40 * s;
    const knightW = knightH * KNIGHT_ASPECT;
    const monsterW = monsterH * MONSTER_ASPECT;
    const chestW = chestH * CHEST_ASPECT;
    return {
        s, knightH, monsterH, chestH, knightW, monsterW, chestW,
        // The fight ring is the distance at which the two sprites stop touching, plus a
        // little air. Keep-out uses the exact same number, so a knight standing on its
        // slot is never pushed off it — the ring can no longer fight the keep-out.
        ring: (monsterW + knightW) / 2 + 10 * s,
        chestRing: (chestW + knightW) / 2 + 14 * s,
        keepKnight: knightW + 8 * s,
    };
}

export default function PointsDungeon({
    onLevelComplete, onExit, onShare, alreadyShared = false, clearedLevels = [],
}) {
    const canvasRef = useRef(null);
    const frameRef = useRef(0);
    const worldRef = useRef(null);
    const spritesRef = useRef(null);

    // Re-entering resumes at the first floor still uncleared today, instead of
    // replaying floors the player already finished. Which floors those are comes from
    // the server — the same state the payout is enforced against, so the vault can
    // never open on a floor that has already been paid.
    const [level, setLevel] = useState(() => {
        const firstUncleared = VAULT_LEVELS.findIndex((_, i) => !clearedLevels.includes(i));
        return firstUncleared === -1 ? 0 : firstUncleared;
    });
    // Declared after `level` — useRef(level) above the useState would read it in
    // its temporal dead zone and throw on every render.
    const levelRef = useRef(level);
    const [progress, setProgress] = useState(0);
    // loading → ready (knights stand at the gate) → fighting ⇄ recalled → complete.
    // Mirrors the main game's control bar: nothing happens until the player deploys.
    const [status, setStatus] = useState('loading');
    const [shared, setShared] = useState(alreadyShared);
    // Set when the player has been sent to X from here, so the vault does not pretend the bonus
    // is already theirs.
    const [handoff, setHandoff] = useState(false);
    const [ready, setReady] = useState(false);

    const statusRef = useRef('loading');
    const awardedRef = useRef({});

    // ---------------------------------------------------------------- sprites
    useEffect(() => {
        let cancelled = false;
        const load = (src) => new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null); // a missing sprite must not stall the run
            img.src = src;
        });
        (async () => {
            const [knight, m1, m2, m3, chest] = await Promise.all([
                load(SPRITES.knights[0]),
                load(SPRITES.monsters[0]),
                load(SPRITES.monsters[1]),
                load(SPRITES.monsters[2]),
                load(SPRITES.chest),
            ]);
            if (cancelled) return;
            spritesRef.current = { knight, monsters: [m1, m2, m3], chest };
            setReady(true);
            statusRef.current = 'ready';
            setStatus('ready');
        })();
        return () => { cancelled = true; };
    }, []);

    // ------------------------------------------------------------------ world
    function buildWorld(canvas, levelIndex) {
        const cfg = LEVELS[levelIndex];
        const hp = Math.round(MONSTER_HP * (1 - HP_FALLOFF * levelIndex));
        const W = canvas.width;
        const H = canvas.height;
        const geo = sizes(W);
        const floorTop = H * 0.54;
        const floorBottom = H * 0.9;
        const band = floorBottom - floorTop;
        const rowAt = (i, n) => floorTop + band * ((i + 0.5) / Math.max(1, n));

        // Two columns one knight-sprite apart (plus air) and one row each, so the
        // deployment formation never overlaps itself while it waits for orders.
        const knights = Array.from({ length: KNIGHT_COUNT }, (_, i) => ({
            x: W * 0.07 + (i % 2) * (geo.knightW + 10 * geo.s),
            y: rowAt(i, KNIGHT_COUNT),
            row: i,
            swing: 0,
            lunge: 0,
            moveTime: 0,
            facing: 1,
            target: null,
            bob: Math.random() * Math.PI * 2,
            // Slight per-knight speed difference stops the five of them marching
            // in lockstep like one rigid block.
            speedScale: 0.82 + (i * 0.09),
        }));

        // Monsters sit on a jittered grid instead of a random scatter. Random x with one
        // row each packed eight of them ~27 px apart, so their sprites overlapped into a
        // single bestiary blob.
        // Columns are spaced by the fight ring rather than by the canvas: two monsters
        // closer together than 2 x ring put a knight's slot inside the next monster's
        // keep-out, and it would be shoved off that slot forever. Columns that do not fit
        // are traded for rows, which are cheap — rows are depth-weighted 1.6x, so a row
        // pitch of ~70 px separates bodies as much as 112 px of horizontal gap.
        const xStart = W * 0.55;
        const xEnd = W * 0.94;
        const minPitch = geo.ring * 2 + 8 * geo.s;
        const maxCols = Math.max(1, Math.floor((xEnd - xStart) / minPitch) + 1);
        const monsterCols = Math.max(1, Math.min(maxCols, Math.ceil(Math.sqrt(cfg.monsters * 1.6))));
        const monsterRows = Math.ceil(cfg.monsters / monsterCols);
        const xStep = monsterCols > 1 ? (xEnd - xStart) / (monsterCols - 1) : 0;
        const monsters = Array.from({ length: cfg.monsters }, (_, i) => ({
            x: monsterCols === 1 ? (xStart + xEnd) / 2
                : xStart + (i % monsterCols) * xStep + (Math.random() - 0.5) * 10,
            y: rowAt(Math.floor(i / monsterCols), monsterRows),
            hp,
            maxHp: hp,
            hurt: 0,
            counter: 0,
            counterIn: 0.6 + Math.random() * 1.4,
            dying: 0,
            image: spritesRef.current.monsters[i % spritesRef.current.monsters.length],
            art: i % spritesRef.current.monsters.length,   // which sprite this is, for art-accurate checks
            wobble: Math.random() * Math.PI * 2,
        }));

        // Chests stay clear of the monster grid so the two never crowd each other.
        const chests = Array.from({ length: cfg.chests }, (_, i) => ({
            x: W * (0.24 + 0.12 * i) + Math.random() * 14,
            // One row each: ~72 px apart, so a knight walking past one chest to reach
            // another no longer clips its art.
            y: rowAt(i, cfg.chests),
            open: 0,
            opened: false,
            claimedBy: 0,
        }));

        worldRef.current = {
            W, H, cfg,
            knights, monsters, chests,
            geo,
            // How far apart the monster rows ended up: slots cap their vertical offset to
            // a third of this, so a knight attacking the middle row never swings into the
            // row above it.
            monsterRows,
            rowPitch: band / Math.max(1, monsterRows),
            floorTop, floorBottom,
            particles: [],
            slashes: [],
            spits: [],
            coins: [],
            elapsed: 0,
            finished: false,
            last: performance.now(),
        };
    }

    // ------------------------------------------------------------------- loop
    useEffect(() => {
        if (!ready) return undefined;
        const canvas = canvasRef.current;
        if (!canvas) return undefined;
        const ctx = canvas.getContext('2d');

        const resize = () => {
            const rect = canvas.parentElement.getBoundingClientRect();
            canvas.width = Math.max(320, Math.floor(rect.width));
            canvas.height = Math.max(240, Math.floor(rect.height));
        };
        resize();
        buildWorld(canvas, levelRef.current);
        // Live handle on the room, mirroring `window.game` in the main engine — it is
        // how the vault is checked in the browser.
        window.__vault = worldRef;

        // Resizing re-lays the room out instead of rebuilding it: rebuilding used to
        // reset half-cleared monsters and chests mid-fight, and the listener was
        // never removed, so every resize added another one.
        const onResize = () => {
            resize();
            if (worldRef.current) relayout(worldRef.current, canvas);
        };
        window.addEventListener('resize', onResize);

        let raf = 0;

        const step = (now) => {
            const world = worldRef.current;
            if (world) {
                const dt = Math.min(0.05, (now - world.last) / 1000);
                world.last = now;
                // A bare rAF chain cannot recover from a throw — one bad frame used to
                // freeze the vault for good, exactly like the main engine's loop.
                try {
                    if (statusRef.current === 'fighting') update(world, dt);
                    else stepEffects(world, dt);
                    draw(ctx, world);
                } catch (err) {
                    console.error('[Vault] frame error', err);
                }
            }
            raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('resize', onResize);
        };
    }, [ready, level]);

    // Keeps an in-progress fight when the window changes size — rescale, do not
    // rebuild. Rows were laid out from the old floor band, so y is rescaled too.
    function relayout(world, canvas) {
        const sx = canvas.width / world.W;
        const sy = canvas.height / world.H;
        world.W = canvas.width;
        world.H = canvas.height;
        // Clearances follow the new width, or a narrower window would leave the fight
        // ring too wide for the columns it was measured against.
        world.geo = sizes(canvas.width);
        world.floorTop = canvas.height * 0.54;
        world.floorBottom = canvas.height * 0.9;
        world.rowPitch = (world.floorBottom - world.floorTop) / Math.max(1, world.monsterRows);
        [...world.knights, ...world.monsters, ...world.chests].forEach((o) => {
            o.x *= sx;
            o.y *= sy;
        });
    }

    // ----------------------------------------------------------------- update
    function update(world, dt) {
        world.elapsed += dt;
        const fighters = world.knights;
        // One source for every clearance in this room, recomputed on resize, so the
        // geometry the physics enforces is exactly the geometry the draw pass paints.
        const geo = world.geo;

        // Knights pick the nearest living monster, then the nearest unopened chest
        // once the room is clear. They never share a target, so the pack fans out.
        // Claim targets first, then hand every knight its own slot around the target
        // it claimed. Without the slots all five walk to the same pixel and fuse
        // into one blob; with them they circle a monster like a real squad.
        const living = world.monsters.filter((m) => m.dying === 0);
        const pool = living.length ? living : world.chests.filter((c) => !c.opened);
        const claims = new Map();

        fighters.forEach((knight) => {
            let target = null;
            let best = Infinity;
            pool.forEach((candidate, i) => {
                // Crowding gets expensive fast (sharing²) so five knights spread
                // over the room instead of piling onto whichever monster is nearest.
                const sharing = (claims.get(candidate) || []).length;
                const d = Math.abs(candidate.y - knight.y) * 1.4 +
                          Math.abs(candidate.x - knight.x) +
                          sharing * sharing * 200 + i * 3;
                if (d < best) { best = d; target = candidate; }
            });
            knight.target = target;
            if (target) {
                if (!claims.has(target)) claims.set(target, []);
                claims.get(target).push(knight);
            }
        });

        fighters.forEach((knight) => {
            if (knight.swing > 0) knight.swing = Math.max(0, knight.swing - dt);
            if (knight.lunge > 0) knight.lunge = Math.max(0, knight.lunge - dt * 3);
            knight.bob += dt * 6;

            const target = knight.target;
            if (!target) return;

            const group = claims.get(target) || [knight];
            const rank = Math.max(0, group.indexOf(knight));
            const angle = (rank / group.length) * Math.PI * 2 - 0.5;
            const isMonster = world.monsters.includes(target);
            // A knight attacks from its ring, and the ring is exactly the distance at which
            // the two sprites stop touching — so keep-out and ring are the same number and
            // can never fight each other. Extra knights on one target sit a little wider
            // apart so a squad reads as a squad and not as one gold blob.
            const radius = isMonster
                ? geo.ring + 10 * geo.s * Math.max(0, group.length - 1)
                : geo.chestRing;
            // Slots keep the exact ring distance even when the floor band clips them: y is
            // clamped and x is derived from it, so a knight is never squashed up against
            // its target by the band edge. The vertical offset is capped to a third of the
            // row pitch so a knight on one row cannot swing from inside the row above.
            const rawY = target.y + Math.sin(angle) * Math.min(radius * 0.62, world.rowPitch * 0.34);
            const slotY = Math.max(world.floorTop, Math.min(world.floorBottom, rawY));
            const dyKeep = slotY - target.y;
            const dxKeep = Math.sqrt(Math.max(0, radius * radius - dyKeep * dyKeep));
            // Slots take the side of the target that fits inside the arena, so the rightmost
            // column does not try to park its knights off the edge of the floor.
            const wantsRight = Math.cos(angle) >= 0;
            const slotRight = target.x + dxKeep;
            const slotLeft = target.x - dxKeep;
            const fits = (x) => x > 38 && x < world.W - 38;
            const slotX = (wantsRight && fits(slotRight)) || (!wantsRight && !fits(slotLeft))
                ? slotRight : slotLeft;

            const toTarget = Math.hypot(target.x - knight.x, target.y - knight.y);
            const toSlot = Math.hypot(slotX - knight.x, slotY - knight.y);
            // In range means it swings. Standing exactly on its slot is a nicety, never a
            // precondition — this is the bug the eight-monster floor exposed: all five
            // knights spent the whole run between their ring and the next monster's
            // keep-out, and a knight that cannot reach its slot would stand in the middle
            // of a battle without ever raising its sword. moveTime stays as a backstop so
            // nobody orbits forever.
            const inReach = toTarget <= radius;
            const moving = !inReach && toSlot > 12 && knight.moveTime < 3;
            knight.facing = target.x >= knight.x ? 1 : -1;

            if (moving) {
                // Only counts time spent milling around the target: the long walk in from
                // the gate must not trip the backstop, or knights swing at empty air.
                knight.moveTime = toTarget < radius * 2 ? knight.moveTime + dt : 0;
                const speed = KNIGHT_SPEED * knight.speedScale * dt;
                let dirX = slotX - knight.x;
                let dirY = slotY - knight.y;
                const len = Math.hypot(dirX, dirY) || 1;
                dirX /= len;
                dirY /= len;
                // Push out of every body in the way — the target's and, crucially, any
                // monster the knight is merely walking past, which is how knights used to
                // march straight through a neighbour's sprite. Rows are shallower than
                // columns on screen, so y is weighted: something one row away is a body to
                // step around, something at the same depth is a body to step around harder.
                const avoidRadius = geo.ring + 16 * geo.s;
                const avoid = (o, weight) => {
                    const dx = knight.x - o.x;
                    const dy = (knight.y - o.y) * ROW_DEPTH;
                    const d = Math.hypot(dx, dy);
                    if (d <= 1 || d >= avoidRadius) return;
                    const push = (1 - d / avoidRadius) * weight;
                    dirX += (dx / d) * push;
                    dirY += (dy / d) * push;
                };
                world.monsters.forEach((m) => { if (m.dying === 0) avoid(m, m === target ? 1.8 : 1.4); });
                world.chests.forEach((c) => { if (!c.opened && c !== target) avoid(c, 1); });
                const l2 = Math.hypot(dirX, dirY) || 1;
                knight.x += (dirX / l2) * speed;
                knight.y += (dirY / l2) * speed;
                knight.x = Math.max(24, Math.min(world.W - 24, knight.x));
                knight.y = Math.max(world.floorTop, Math.min(world.floorBottom, knight.y));
            } else if (knight.swing === 0) {
                knight.moveTime = 0;
                knight.swing = SWING_TIME;
                strike(world, knight, target);
            }
        });

        // Gentle body separation: crossing paths nudge knights apart instead of letting
        // two of them walk through each other on the way to a slot.
        const separation = geo.keepKnight * 1.25;
        for (let i = 0; i < fighters.length; i++) {
            for (let j = i + 1; j < fighters.length; j++) {
                const a = fighters[i];
                const b = fighters[j];
                const dx = b.x - a.x;
                const dy = (b.y - a.y) * ROW_DEPTH;
                const d = Math.hypot(dx, dy);
                if (d <= 0 || d >= separation) continue;
                const push = (separation - d) * 6 * dt;
                a.x -= (dx / d) * push;
                a.y -= (dy / d) * push / ROW_DEPTH;
                b.x += (dx / d) * push;
                b.y += (dy / d) * push / ROW_DEPTH;
            }
        }
        // Final placement pass. Steering pushes mostly keep the squad out of bodies, but
        // they cannot guarantee it — a knight shoved sideways by a neighbour could still
        // be left standing inside a monster. This makes it a rule rather than a tendency.
        // Knights are separated first, then bodies, so a body always wins the last word.
        for (let i = 0; i < fighters.length; i++) {
            for (let j = i + 1; j < fighters.length; j++) {
                const a = fighters[i];
                const b = fighters[j];
                const dx = b.x - a.x;
                const dy = (b.y - a.y) * ROW_DEPTH;
                const d = Math.hypot(dx, dy);
                if (d <= 1 || d >= geo.keepKnight) continue;
                const shift = (geo.keepKnight - d) / 2;
                a.x -= (dx / d) * shift;
                a.y -= (dy / d) * (shift / ROW_DEPTH);
                b.x += (dx / d) * shift;
                b.y += (dy / d) * (shift / ROW_DEPTH);
            }
        }
        fighters.forEach((k) => {
            const resolve = (o, keep) => {
                const dx = k.x - o.x;
                const dy = (k.y - o.y) * ROW_DEPTH;
                const d = Math.hypot(dx, dy);
                if (d <= 1 || d >= keep) return;
                k.x += (dx / d) * (keep - d);
                k.y += (dy / d) * ((keep - d) / ROW_DEPTH);
            };
            world.monsters.forEach((m) => { if (m.dying === 0) resolve(m, geo.ring); });
            world.chests.forEach((c) => { if (!c.opened) resolve(c, geo.chestRing - 6 * geo.s); });
            k.x = Math.max(24, Math.min(world.W - 24, k.x));
            k.y = Math.max(world.floorTop, Math.min(world.floorBottom, k.y));
        });

        // Monster counters: spectacle only, exactly like the main dungeons — the
        // knights take no damage from it.
        world.monsters.forEach((m) => {
            if (m.dying > 0) return;   // dead: fading out, handled in stepEffects
            const nearest = fighters.reduce((acc, k) => {
                const d = Math.hypot(k.x - m.x, k.y - m.y);
                return d < acc.d ? { d, k } : acc;
            }, { d: Infinity, k: null });
            const inDomain = nearest.k && nearest.d < 250;
            m.counterIn -= dt;
            if (inDomain && m.counterIn <= 0) {
                m.counterIn = COUNTER_COOLDOWN + Math.random() * 0.6;
                world.spits.push({
                    x: m.x, y: m.y - 18,
                    tx: nearest.k.x, ty: nearest.k.y - 16,
                    t: 0, life: 0.5,
                });
            }
        });

        // Chests open on contact
        world.chests.forEach((c) => {
            if (c.opened) return;
            c.claimedBy = 0;
            const near = fighters.filter((k) => k.target === c && Math.hypot(k.x - c.x, k.y - c.y) <= geo.chestRing + 6 * geo.s);
            if (near.length) {
                c.open += dt * 2.2;
                if (c.open >= 1) {
                    c.opened = true;
                    burstCoins(world, c);
                }
            }
        });

        stepEffects(world, dt);

        const cleared = world.monsters.every((m) => m.dying > 0) && world.chests.every((c) => c.opened);
        const timedOut = world.elapsed >= LEVEL_SECONDS;
        if ((cleared || timedOut) && !world.finished) {
            world.finished = true;
            if (!cleared) {
                // Ran out of time: wind the room down instead of snapping it shut, so
                // the reward lands and the ending still reads as a victory. The fades
                // keep playing because stepEffects runs after the room is finished.
                world.monsters.forEach((m) => { m.dying = Math.max(m.dying, 0.5); });
                world.chests.forEach((c) => {
                    if (c.opened) return;
                    c.opened = true;
                    burstCoins(world, c);
                });
            }
            statusRef.current = 'complete';
            setStatus('complete');
            setProgress(1);
            // The gate keeper sees the vault off too, once per entry, on the final floor.
            if (levelRef.current >= LEVELS.length - 1 && window.Arya) {
                window.Arya.say('clear', {
                    message: `The <strong>Points Vault</strong> is yours — ${VAULT_TOTAL} PTS banked. Well run, champion!`,
                });
            }
            if (!awardedRef.current[levelRef.current]) {
                awardedRef.current[levelRef.current] = true;
                if (onLevelComplete) onLevelComplete(levelRef.current);
            }
        }
        setProgress(Math.min(1, world.elapsed / LEVEL_SECONDS));
    }

    function strike(world, knight, target) {
        const isMonster = world.monsters.includes(target);
        world.slashes.push({ x: knight.x + knight.facing * 30, y: knight.y - 24, life: 0.22, facing: knight.facing });
        knight.lunge = 1;
        if (!isMonster) return;
        target.hp -= KNIGHT_DAMAGE;
        target.hurt = 1;
        for (let i = 0; i < 5; i++) {
            world.particles.push({
                x: target.x + (Math.random() - 0.5) * 20,
                y: target.y - 20 + (Math.random() - 0.5) * 20,
                vx: (Math.random() - 0.5) * 90,
                vy: -40 - Math.random() * 70,
                life: 0.5, color: '#ffd873', size: 2 + Math.random() * 2,
            });
        }
        if (target.hp <= 0) {
            // `dying` is the fade-out clock: 1 → gone. It must never reach 0, or the
            // draw pass treats the corpse as a live monster and paints it back at full
            // opacity.
            target.dying = 1;
            for (let i = 0; i < 16; i++) {
                world.particles.push({
                    x: target.x, y: target.y - 22,
                    vx: (Math.random() - 0.5) * 220,
                    vy: -60 - Math.random() * 160,
                    life: 0.8, color: i % 3 === 0 ? '#fff3c4' : '#d4a843', size: 2 + Math.random() * 3,
                });
            }
        }
    }

    function burstCoins(world, chest) {
        for (let i = 0; i < 26; i++) {
            world.coins.push({
                x: chest.x, y: chest.y - 10,
                vx: (Math.random() - 0.5) * 150,
                vy: -140 - Math.random() * 190,
                life: 1.1, spin: Math.random() * Math.PI,
            });
        }
    }

    // Cosmetics only — particles, projectiles, coins, plus the fade-outs and chest
    // swings that keep animating while the room is paused, recalled or finished.
    function stepEffects(world, dt) {
        world.monsters.forEach((m) => {
            if (m.hurt > 0) m.hurt = Math.max(0, m.hurt - dt * 4);
            m.wobble += dt * 2.4;
            if (m.dying > 0) m.dying = Math.max(0.02, m.dying - dt * 2);
        });
        world.chests.forEach((c) => {
            if (c.opened && c.open < 1) c.open = Math.min(1, c.open + dt * 2.6);
        });
        world.particles.forEach((p, i) => {
            p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 260 * dt; p.life -= dt;
            if (p.life <= 0) world.particles.splice(i, 1);
        });
        world.slashes.forEach((s, i) => { s.life -= dt; if (s.life <= 0) world.slashes.splice(i, 1); });
        world.spits.forEach((s, i) => {
            s.t += dt / s.life;
            if (s.t >= 1) {
                world.particles.push({ x: s.tx, y: s.ty, vx: 0, vy: -40, life: 0.35, color: '#ffe9a8', size: 3 });
                world.spits.splice(i, 1);
            }
        });
        world.coins.forEach((c, i) => {
            c.x += c.vx * dt; c.y += c.vy * dt; c.vy += 420 * dt; c.spin += dt * 8; c.life -= dt;
            if (c.life <= 0) world.coins.splice(i, 1);
        });
    }

    // ------------------------------------------------------------------- draw
    function drawSprite(ctx, img, x, y, height, opts = {}) {
        if (!img) return;
        const w = height * (img.width / img.height);
        ctx.save();
        ctx.translate(x, y);
        if (opts.rotate) ctx.rotate(opts.rotate);
        if (opts.scale) ctx.scale(opts.scale, opts.scale);
        // Mirror horizontally only. ctx.scale(-1, -1) would spin the sprite 180°,
        // which is how knights facing left ended up walking on their heads.
        if (opts.flipX) ctx.scale(-1, 1);
        if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
        ctx.drawImage(img, -w / 2, -height, w, height);
        ctx.restore();
    }

    function shadow(ctx, x, y, w) {
        ctx.fillStyle = 'rgba(0,0,0,0.42)';
        ctx.beginPath();
        ctx.ellipse(x, y + 2, w, w * 0.28, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawChest(ctx, c, chestH) {
        shadow(ctx, c.x, c.y, chestH * 0.42);
        if (c.opened && c.open >= 1) ctx.globalAlpha = 0.92;
        drawSprite(ctx, spritesRef.current.chest, c.x, c.y, chestH, {
            rotate: c.opened ? -0.12 : 0,
        });
        ctx.globalAlpha = 1;
        if (c.open > 0 && c.open < 1) {
            ctx.fillStyle = `rgba(255, 216, 115, ${0.5 * (1 - c.open)})`;
            ctx.beginPath();
            ctx.arc(c.x, c.y - chestH * 0.5, chestH * (0.5 + c.open), 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function drawMonster(ctx, m, monsterH) {
        if (m.dying > 0 && m.dying <= 0.02) return;   // faded out for good
        const alpha = m.dying > 0 ? Math.min(1, m.dying) : 1;
        const bob = Math.sin(m.wobble) * 2.5;
        shadow(ctx, m.x, m.y, monsterH * 0.36);
        if (m.hurt > 0) {
            ctx.save();
            ctx.globalAlpha = 0.55 * m.hurt;
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.ellipse(m.x, m.y - monsterH * 0.45, monsterH * 0.34, monsterH * 0.42, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        drawSprite(ctx, m.image, m.x, m.y + bob, monsterH, {
            alpha,
            scale: m.hurt > 0 ? 1 + 0.06 * m.hurt : 1,
            rotate: m.dying > 0 ? (1 - alpha) * 0.35 : 0,
        });
        if (m.dying === 0 && m.hp < m.maxHp) {
            const w = monsterH * 0.6;
            const pct = Math.max(0, m.hp / m.maxHp);
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(m.x - w / 2, m.y - monsterH - 12, w, 5);
            ctx.fillStyle = pct > 0.4 ? '#7ee081' : '#e0736f';
            ctx.fillRect(m.x - w / 2 + 1, m.y - monsterH - 11, (w - 2) * pct, 3);
        }
    }

    function drawKnight(ctx, k, knightH) {
        const bob = Math.sin(k.bob) * 1.8;
        const lunge = k.lunge * 14 * k.facing;
        const swing = k.swing > 0 ? Math.sin((1 - k.swing / SWING_TIME) * Math.PI) : 0;
        shadow(ctx, k.x, k.y, knightH * 0.32);
        drawSprite(ctx, spritesRef.current.knight, k.x + lunge, k.y + bob, knightH, {
            rotate: k.facing * (0.04 + swing * 0.12),
            flipX: k.facing === -1,
        });
    }

    function draw(ctx, world) {
        const { W, H } = world;
        ctx.clearRect(0, 0, W, H);

        // Sized against the map's own tiles (roughly 27 px each at this width) so the
        // sprites sit at the same scale as the art behind them — a knight about two
        // tiles tall, a monster a little over two and a half. The sizes come from the same
        // helper the physics uses: a knight that is drawn 62 px tall has to be reasoned
        // about 62 px tall when it walks up to a monster.
        const geo = world.geo;
        const scale = geo.s;
        const knightH = geo.knightH;
        const monsterH = geo.monsterH;
        const chestH = geo.chestH;

        // Anything standing further up the screen is further away, so it is painted
        // first. Three separate passes (all chests, then all monsters, then all knights)
        // put a knight that was standing *behind* a monster on top of it, which read as
        // the squad intermixing with the bestiary.
        const actors = [
            ...world.chests.map((c) => ({ y: c.y, kind: 0, ref: c })),
            ...world.monsters.map((m) => ({ y: m.y, kind: 1, ref: m })),
            ...world.knights.map((k) => ({ y: k.y, kind: 2, ref: k })),
        ].sort((a, b) => a.y - b.y);
        actors.forEach((actor) => {
            if (actor.kind === 0) drawChest(ctx, actor.ref, chestH);
            else if (actor.kind === 1) drawMonster(ctx, actor.ref, monsterH);
            else drawKnight(ctx, actor.ref, knightH);
        });

        // Slash arcs
        world.slashes.forEach((s) => {
            ctx.save();
            ctx.globalAlpha = Math.max(0, s.life / 0.22);
            ctx.strokeStyle = '#fff3c4';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(s.x, s.y, 26 * scale + 12, -0.9, 0.9);
            ctx.stroke();
            ctx.restore();
        });

        // Monster counters (themed for the vault: gold bolts)
        world.spits.forEach((s) => {
            const x = s.x + (s.tx - s.x) * s.t;
            const y = s.y + (s.ty - s.y) * s.t;
            ctx.save();
            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = '#d4a843';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(s.x, s.y);
            ctx.lineTo(x, y);
            ctx.stroke();
            ctx.fillStyle = '#fff6d5';
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });

        world.coins.forEach((c) => {
            ctx.save();
            ctx.globalAlpha = Math.max(0, c.life);
            ctx.fillStyle = '#ffd873';
            ctx.beginPath();
            ctx.ellipse(c.x, c.y, 5, 3 + Math.abs(Math.cos(c.spin)) * 3, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });

        world.particles.forEach((p) => {
            ctx.save();
            ctx.globalAlpha = Math.max(0, p.life * 2);
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x, p.y, p.size, p.size);
            ctx.restore();
        });

        // Level name watermark
        ctx.save();
        ctx.fillStyle = 'rgba(212, 168, 67, 0.10)';
        ctx.font = `bold ${Math.max(20, 44 * scale)}px Cinzel, serif`;
        ctx.textAlign = 'center';
        ctx.fillText(world.cfg.name.toUpperCase(), W / 2, H * 0.3);
        ctx.restore();
    }

    // ------------------------------------------------------------------ actions
    // Deploy / Recall / Exit, the same three controls the main dungeon game has.
    // The room holds still while recalled — its clock only runs while deployed.
    function deploy() {
        const world = worldRef.current;
        // Rewind the frame clock, otherwise the first frame after a pause bills the
        // whole idle gap (clamped to 50 ms, but this keeps it exact).
        if (world) world.last = performance.now();
        statusRef.current = 'fighting';
        setStatus('fighting');
    }

    function recall() {
        if (statusRef.current !== 'fighting') return;
        statusRef.current = 'recalled';
        setStatus('recalled');
    }

    function handleNext() {
        const next = level + 1;
        levelRef.current = next;
        setLevel(next);
        setProgress(0);
        deploy();   // straight into the next floor
    }

    /**
     * Hand the share over to the Points page.
     *
     * This used to set `shared` and call it a doubling — which was a lie the moment the payout
     * moved behind a verification: the bonus is paid when the player pastes the link to their post
     * and X confirms the bound handle wrote it. So the vault opens the post and steps out of the
     * way, and the card that takes the link does the claiming.
     *
     * It also hands the picture over on the way past: `onShare` saves it and opens the composer with
     * the text written, so a player who taps here does not have to find the Daily Share card first
     * to get what the post is supposed to contain.
     */
    function handleShare() {
        if (shared) return;
        setHandoff(true);
        if (onShare) onShare();
    }

    // Space deploys or recalls, Esc recalls — the shortcuts the main game documents.
    useEffect(() => {
        const onKey = (e) => {
            if (e.code === 'Space') {
                e.preventDefault();
                if (statusRef.current === 'fighting') recall();
                else if (statusRef.current === 'ready' || statusRef.current === 'recalled') deploy();
            } else if (e.key === 'Escape') {
                recall();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const cfg = LEVELS[level];
    const secondsLeft = Math.max(0, Math.ceil(LEVEL_SECONDS * (1 - progress)));
    const isLast = level === LEVELS.length - 1;

    return (
        <div className="dungeon-overlay">
            <video className="dungeon-map" src={SPRITES.map} autoPlay muted loop playsInline />
            <div className="dungeon-vignette" />
            <div className="dungeon-container">
                <div className="dungeon-top-bar">
                    <div className="dungeon-level-info">
                        <span className="dungeon-level-name" style={{ color: cfg.color }}>{cfg.name}</span>
                        <span className="dungeon-level-num">{level + 1}/{LEVELS.length}</span>
                    </div>
                    <div className="dungeon-timer">
                        <span className="dungeon-timer-text">
                            {status === 'fighting' ? `${secondsLeft}s`
                                : status === 'complete' ? 'Cleared'
                                : status === 'recalled' ? `Held · ${secondsLeft}s`
                                : `${LEVEL_SECONDS}s`}
                        </span>
                        <div className="dungeon-timer-bar">
                            <div className="dungeon-timer-fill" style={{ width: `${progress * 100}%`, background: cfg.color }} />
                        </div>
                    </div>
                    <div className="dungeon-points-so-far">
                        {LEVELS.slice(0, level + (status === 'complete' ? 1 : 0)).reduce((s, l) => s + l.points, 0).toLocaleString()} PTS
                    </div>
                </div>

                <div className="dungeon-stage">
                    <canvas ref={canvasRef} className="dungeon-canvas" />
                    {status === 'loading' && (
                        <div className="dungeon-loading">Opening the vault...</div>
                    )}
                </div>

                <div className="dungeon-bottom">
                    {status !== 'complete' && status !== 'loading' && (
                        <>
                            <div className="dungeon-controls">
                                <button
                                    className="btn btn-primary btn-md dungeon-btn"
                                    onClick={deploy}
                                    disabled={status === 'fighting'}
                                    title="Space"
                                >
                                    Deploy
                                </button>
                                <button
                                    className="btn btn-danger btn-md dungeon-btn"
                                    onClick={recall}
                                    disabled={status !== 'fighting'}
                                    title="Esc"
                                >
                                    Recall
                                </button>
                                <button
                                    className="btn btn-secondary btn-md dungeon-btn"
                                    onClick={onExit}
                                >
                                    Exit
                                </button>
                            </div>
                            <div className="dungeon-fighting">
                                <span className="dungeon-dummy-label">{KNIGHT_COUNT} dummy knights</span>
                                <span className="dungeon-status-text">
                                    {status === 'ready'
                                        ? 'Awaiting orders — deploy to begin'
                                        : status === 'fighting'
                                            ? 'Knights battling...'
                                            : 'Knights recalled — the clock is held'}
                                </span>
                            </div>
                        </>
                    )}

                    {status === 'complete' && !isLast && (
                        <div className="dungeon-complete">
                            <div className="dungeon-reward-announce">+{cfg.points} PTS</div>
                            <button className="btn btn-primary btn-md dungeon-btn" onClick={handleNext}>
                                Next Dungeon
                            </button>
                        </div>
                    )}

                    {status === 'complete' && isLast && (
                        <div className="dungeon-complete dungeon-final">
                            <div className="dungeon-reward-announce">Vault conquered · {VAULT_TOTAL} PTS</div>
                            <p className="dungeon-final-note">
                                Exit with your {VAULT_TOTAL} points, or post the run on X — the picture and the
                                text are ready on the Points page — and paste the link there to double it to{' '}
                                {VAULT_TOTAL * 2}.
                            </p>
                            <div className="dungeon-final-btns">
                                <button className="btn btn-secondary btn-md dungeon-btn" onClick={onExit}>
                                    Exit Dungeon
                                </button>
                                <button
                                    className={`btn btn-primary btn-md dungeon-btn ${shared ? 'is-shared' : ''}`}
                                    onClick={handleShare}
                                    disabled={shared}
                                >
                                    {shared
                                        ? 'Already claimed today'
                                        : `Post on X for x2 (${VAULT_TOTAL * 2})`}
                                </button>
                            </div>
                            {handoff && !shared && (
                                <p className="dungeon-final-note" role="status">
                                    X is open with the post written — the picture goes with it where your device
                                    offers that, and your link card shows it either way. Finish the post, then
                                    paste its link into the Daily Share card to claim the double.
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
