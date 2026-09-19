// Pathfinding AI - A* Algorithm for autonomous knight movement

class PathfindingAI {
    constructor(dungeon) {
        this.dungeon = dungeon;
    }

    // A* pathfinding algorithm.
    // `blocked` marks tiles a knight may walk AROUND but should not stroll over —
    // tiles held by another knight, a monster or a chest. They are given a heavy
    // step cost rather than being impassable, so a monster standing in a doorway
    // can never make a target unreachable.
    findPath(startX, startY, endX, endY, blocked) {
        const openSet = [];
        const closedSet = new Set();
        const startNode = { x: startX, y: startY, g: 0, h: 0, f: 0, parent: null };
        
        openSet.push(startNode);

        while (openSet.length > 0) {
            // Get node with lowest f score
            openSet.sort((a, b) => a.f - b.f);
            const current = openSet.shift();

            // Reached goal
            if (current.x === endX && current.y === endY) {
                return this.reconstructPath(current);
            }

            closedSet.add(`${current.x},${current.y}`);

            // Check all neighbors
            const neighbors = this.getNeighbors(current.x, current.y);
            for (const neighbor of neighbors) {
                const key = `${neighbor.x},${neighbor.y}`;
                
                if (closedSet.has(key)) continue;

                const occupied = blocked && blocked(neighbor.x, neighbor.y);
                const g = current.g + (occupied ? 8 : 1);
                const h = this.heuristic(neighbor.x, neighbor.y, endX, endY);
                const f = g + h;

                // Check if neighbor is already in open set with better score
                const existing = openSet.find(n => n.x === neighbor.x && n.y === neighbor.y);
                if (existing && g >= existing.g) continue;

                const node = {
                    x: neighbor.x,
                    y: neighbor.y,
                    g: g,
                    h: h,
                    f: f,
                    parent: current
                };

                if (existing) {
                    Object.assign(existing, node);
                } else {
                    openSet.push(node);
                }
            }
        }

        return []; // No path found
    }

    getNeighbors(x, y) {
        const neighbors = [];
        const directions = [
            { x: 0, y: -1 }, // North
            { x: 1, y: 0 },  // East
            { x: 0, y: 1 },  // South
            { x: -1, y: 0 }  // West
        ];

        for (const dir of directions) {
            const newX = x + dir.x;
            const newY = y + dir.y;
            
            if (this.dungeon.isWalkable(newX, newY)) {
                neighbors.push({ x: newX, y: newY });
            }
        }

        return neighbors;
    }

    heuristic(x1, y1, x2, y2) {
        // Manhattan distance
        return Math.abs(x1 - x2) + Math.abs(y1 - y2);
    }

    reconstructPath(node) {
        const path = [];
        let current = node;
        
        while (current) {
            path.unshift({ x: current.x, y: current.y });
            current = current.parent;
        }
        
        return path;
    }

    // Find nearest loot node this knight can actually get to and strike.
    // Monsters are only reachable from their LEFT or RIGHT tile, so a monster
    // walled in above and below is not a target a knight can ever attack.
    findNearestLoot(knightX, knightY, lootNodes, knights, self) {
        let nearest = null;
        let shortestDistance = Infinity;

        for (const node of lootNodes) {
            if (node.isDestroyed) continue;

            const hasAccess = node.type === 'monster'
                ? this.hasLateralApproach(node.gridX, node.gridY)
                : this.hasAdjacentWalkableTile(node.gridX, node.gridY);
            if (!hasAccess) continue;

            // Prefer a monster nobody is already standing beside, so knights spread
            // out instead of piling onto the same two tiles.
            const crowd = this.approachCrowding(node.gridX, node.gridY, node, knights, self, node.type === 'monster');
            const distance = this.heuristic(knightX, knightY, node.gridX, node.gridY) + crowd * 4;
            if (distance < shortestDistance) {
                shortestDistance = distance;
                nearest = node;
            }
        }

        return nearest;
    }

    // Can a knight strike this monster from the side? Its left or right tile has to
    // exist and be free of other loot.
    hasLateralApproach(x, y) {
        return [-1, 1].some(dx =>
            this.dungeon.isWalkable(x + dx, y) && !this.dungeon.hasLootNodeAt(x + dx, y));
    }

    // How contested this target already is: knights standing on its strike tiles, plus
    // the ones merely walking there. Counting the walkers is what stops a whole squad
    // from picking the same monster, which otherwise leaves them jostling for the two
    // tiles it can be hit from.
    approachCrowding(x, y, node, knights, self, lateralOnly) {
        if (!knights || !knights.length) return 0;
        const tiles = lateralOnly
            ? [{ x: x - 1, y }, { x: x + 1, y }]
            : [{ x: x - 1, y }, { x: x + 1, y }, { x, y: y - 1 }, { x, y: y + 1 }];
        let crowd = 0;
        for (const k of knights) {
            if (!k || k === self) continue;
            if (node && k.target === node) { crowd += 1.5; continue; }
            if (k.gridPosition && tiles.some(t => k.gridPosition.x === t.x && k.gridPosition.y === t.y)) crowd += 1;
        }
        return crowd;
    }

    // A tile no unit may stand on: another knight, or a monster/chest
    isOccupied(x, y, knights, self) {
        if (this.dungeon.hasLootNodeAt(x, y)) return true;
        return (knights || []).some(k => k && k !== self && k.gridPosition &&
            k.gridPosition.x === x && k.gridPosition.y === y);
    }
    
    // Check if a position has at least one adjacent walkable tile
    hasAdjacentWalkableTile(x, y) {
        const directions = [
            { x: 0, y: -1 }, // North
            { x: 1, y: 0 },  // East
            { x: 0, y: 1 },  // South
            { x: -1, y: 0 }  // West
        ];
        
        for (const dir of directions) {
            const adjX = x + dir.x;
            const adjY = y + dir.y;
            
            if (this.dungeon.isWalkable(adjX, adjY)) {
                return true;
            }
        }
        
        return false;
    }

    // Check if knight is adjacent to target (for melee attacking)
    // `lateralOnly` is used for monsters: a knight fights what stands directly to
    // its left or right and never reaches up or down. Chests keep the 4-way rule,
    // so a chest tucked into a corner can still be opened and a run can still end.
    isAdjacent(x1, y1, x2, y2, range = 1, lateralOnly = false) {
        const dx = Math.abs(x1 - x2);
        const dy = Math.abs(y1 - y2);
        const reach = Math.max(1, range || 1);

        if (lateralOnly) return dy === 0 && dx >= 1 && dx <= reach;

        // Must be exactly 1 tile away in one direction, 0 in the other (no diagonal)
        return (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
    }
}

// Knight AI Controller
class KnightAI {
    constructor(pathfinding) {
        this.pathfinding = pathfinding;
    }

    updateKnight(knight, dungeon, deltaTime, deployedKnights = []) {
        if (!knight.isDeployed || knight.state === 'exhausted' || knight.state === 'resting') {
            return;
        }

        // Everyone else on the board — knights share no tile with anyone.
        const others = (deployedKnights || []).filter(k => k !== knight);
        const occupied = (x, y) => this.pathfinding.isOccupied(x, y, others, knight);

        // Always check for new target if current is destroyed or doesn't exist
        if (!knight.target || knight.target.isDestroyed) {
            knight.state = 'idle';
            knight.path = [];
            
            const lootNodes = dungeon.getActiveLootNodes();
            
            if (lootNodes.length === 0) {
                // No more loot, mission complete
                return;
            }
            
            knight.target = this.pathfinding.findNearestLoot(
                knight.gridPosition.x,
                knight.gridPosition.y,
                lootNodes,
                others,
                knight
            );
            
            if (!knight.target) {
                console.log(`⚠️ Knight #${knight.id} couldn't find target`);
                return;
            }
            
            console.log(`🎯 Knight #${knight.id} found new target at (${knight.target.gridX}, ${knight.target.gridY})`);

            // Find the tile to strike from (not ON the target)
            const adjacentTile = this.findAdjacentTile(
                knight.target.gridX,
                knight.target.gridY,
                dungeon,
                others,
                knight,
                knight.target.type === 'monster'
            );

            if (adjacentTile) {
                knight.path = this.pathfinding.findPath(
                    knight.gridPosition.x,
                    knight.gridPosition.y,
                    adjacentTile.x,
                    adjacentTile.y,
                    occupied
                );
                
                if (knight.path.length === 0) {
                    console.log(`❌ Knight #${knight.id} found no path to target`);
                    knight.target = null; // Try different target next frame
                }
            } else {
                // No strike tile available, pick different target
                console.log(`❌ Knight #${knight.id} no adjacent tile for target`);
                knight.target = null;
                return;
            }
        }

        // Monsters are struck from the side only; chests can be opened from any side
        const lateral = knight.target && knight.target.type === 'monster';

        // Check if in melee attack range
        if (knight.target && this.pathfinding.isAdjacent(
            knight.gridPosition.x,
            knight.gridPosition.y,
            knight.target.gridX,
            knight.target.gridY,
            knight.stats.range,
            lateral
        )) {
            knight.state = 'attacking';
            knight.path = []; // Clear path when attacking
            knight.blockedFor = 0;
            return;
        }

        // Move along path
        if (knight.path.length > 1) {
            knight.state = 'moving';
            this.moveKnight(knight, deltaTime, occupied);
        } else if (knight.path.length === 1) {
            // Reached destination but not in striking range (something moved in, or
            // the monster strolled) — re-plan rather than stand about
            knight.state = 'idle';
            knight.target = null;
            knight.path = [];
        } else if (knight.target && !knight.target.isDestroyed) {
            // No path but have target - recalculate
            const adjacentTile = this.findAdjacentTile(
                knight.target.gridX,
                knight.target.gridY,
                dungeon,
                others,
                knight,
                knight.target.type === 'monster'
            );
            if (adjacentTile) {
                knight.path = this.pathfinding.findPath(
                    knight.gridPosition.x,
                    knight.gridPosition.y,
                    adjacentTile.x,
                    adjacentTile.y,
                    occupied
                );
            } else {
                // Can't reach target, get new one
                knight.target = null;
            }
        }
    }
    
    // Find the tile a knight strikes a target from. Monsters only expose their
    // left/right tiles; chests keep all four sides so a corner chest still opens.
    // A tile already held by another knight is ranked last, so knights spread out.
    findAdjacentTile(targetX, targetY, dungeon, knights, self, lateralOnly) {
        const directions = lateralOnly
            ? [{ x: -1, y: 0 }, { x: 1, y: 0 }]
            : [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];

        const candidates = directions
            .map(dir => ({ x: targetX + dir.x, y: targetY + dir.y }))
            .filter(t => dungeon.isWalkable(t.x, t.y) && !dungeon.hasLootNodeAt(t.x, t.y));

        if (!candidates.length) return null; // no strike tile at all

        // Prefer a free tile; fall back to a taken one so target selection never
        // starves (the knight that gets there second waits its turn instead).
        const free = candidates.filter(t => !(knights || []).some(k => k && k !== self &&
            k.gridPosition && k.gridPosition.x === t.x && k.gridPosition.y === t.y));
        const pool = free.length ? free : candidates;
        return pool[Math.floor(Math.random() * pool.length)];
    }

    moveKnight(knight, deltaTime, occupied) {
        if (knight.path.length < 2) return;

        const nextNode = knight.path[1]; // [0] is current position
        
        // Check if reached next grid position
        if (knight.gridPosition.x === nextNode.x && knight.gridPosition.y === nextNode.y) {
            knight.path.shift(); // Remove current position from path
            return;
        }

        // Calculate movement based on speed (1-10 scale)
        // Speed 10 = move every 0.1 seconds, Speed 1 = move every 1 second
        const moveInterval = 1 / knight.stats.speed; // seconds per tile
        
        // Create movement timer if doesn't exist
        if (!knight.moveTimer) {
            knight.moveTimer = 0;
        }
        
        knight.moveTimer += deltaTime;
        
        // Move when timer exceeds interval
        if (knight.moveTimer >= moveInterval) {
            knight.moveTimer = 0;

            const dx = Math.sign(nextNode.x - knight.gridPosition.x);
            const dy = Math.sign(nextNode.y - knight.gridPosition.y);
            const stepX = knight.gridPosition.x + dx;
            const stepY = knight.gridPosition.y + dy;

            // Units never share a tile: if a knight or a monster is standing there,
            // hold the step. Waiting too long means the tile is genuinely taken, so
            // drop the plan and pick a different target rather than deadlock.
            if (occupied && occupied(stepX, stepY)) {
                knight.blockedFor = (knight.blockedFor || 0) + moveInterval;
                if (knight.blockedFor >= 1.2) {
                    knight.blockedFor = 0;
                    knight.path = [];
                    knight.target = null;
                }
                return;
            }

            knight.blockedFor = 0;
            knight.gridPosition.x = stepX;
            knight.gridPosition.y = stepY;
        }
    }
}
