// Pathfinding AI - A* Algorithm for autonomous knight movement

class PathfindingAI {
    constructor(dungeon) {
        this.dungeon = dungeon;
    }

    // A* pathfinding algorithm
    findPath(startX, startY, endX, endY) {
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

                const g = current.g + 1;
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

    // Find nearest loot node that has at least one adjacent walkable tile
    findNearestLoot(knightX, knightY, lootNodes) {
        let nearest = null;
        let shortestDistance = Infinity;

        for (const node of lootNodes) {
            if (node.isDestroyed) continue;
            
            // Check if node has at least one adjacent walkable tile
            const hasAccess = this.hasAdjacentWalkableTile(node.gridX, node.gridY);
            if (!hasAccess) {
                console.log(`⚠️ Skipping unreachable loot at (${node.gridX}, ${node.gridY})`);
                continue;
            }
            
            const distance = this.heuristic(knightX, knightY, node.gridX, node.gridY);
            if (distance < shortestDistance) {
                shortestDistance = distance;
                nearest = node;
            }
        }

        return nearest;
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
    isAdjacent(x1, y1, x2, y2, range = 1) {
        // For melee (range = 1), must be directly adjacent (not diagonal)
        const dx = Math.abs(x1 - x2);
        const dy = Math.abs(y1 - y2);
        
        // Must be exactly 1 tile away in one direction, 0 in the other (no diagonal)
        return (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
    }
}

// Knight AI Controller
class KnightAI {
    constructor(pathfinding) {
        this.pathfinding = pathfinding;
    }

    updateKnight(knight, dungeon, deltaTime) {
        if (!knight.isDeployed || knight.state === 'exhausted' || knight.state === 'resting') {
            return;
        }

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
                lootNodes
            );
            
            if (!knight.target) {
                console.log(`⚠️ Knight #${knight.id} couldn't find target`);
                return;
            }
            
            console.log(`🎯 Knight #${knight.id} found new target at (${knight.target.gridX}, ${knight.target.gridY})`);

            // Find path to an adjacent tile (not ON the target)
            const adjacentTile = this.findAdjacentWalkableTile(knight.target.gridX, knight.target.gridY, dungeon);
            
            if (adjacentTile) {
                knight.path = this.pathfinding.findPath(
                    knight.gridPosition.x,
                    knight.gridPosition.y,
                    adjacentTile.x,
                    adjacentTile.y
                );
                
                if (knight.path.length === 0) {
                    console.log(`❌ Knight #${knight.id} found no path to target`);
                    knight.target = null; // Try different target next frame
                }
            } else {
                // No adjacent tile available, pick different target
                console.log(`❌ Knight #${knight.id} no adjacent tile for target`);
                knight.target = null;
                return;
            }
        }

        // Check if in melee attack range (directly adjacent)
        if (knight.target && this.pathfinding.isAdjacent(
            knight.gridPosition.x,
            knight.gridPosition.y,
            knight.target.gridX,
            knight.target.gridY,
            knight.stats.range
        )) {
            knight.state = 'attacking';
            knight.path = []; // Clear path when attacking
            return;
        }

        // Move along path
        if (knight.path.length > 1) {
            knight.state = 'moving';
            this.moveKnight(knight, deltaTime);
        } else if (knight.path.length === 1) {
            // Reached destination, should be adjacent to target now
            knight.state = 'idle';
        } else if (knight.target && !knight.target.isDestroyed) {
            // No path but have target - recalculate
            const adjacentTile = this.findAdjacentWalkableTile(knight.target.gridX, knight.target.gridY, dungeon);
            if (adjacentTile) {
                knight.path = this.pathfinding.findPath(
                    knight.gridPosition.x,
                    knight.gridPosition.y,
                    adjacentTile.x,
                    adjacentTile.y
                );
            } else {
                // Can't reach target, get new one
                knight.target = null;
            }
        }
    }
    
    // Find an adjacent walkable tile to the target
    findAdjacentWalkableTile(targetX, targetY, dungeon) {
        const directions = [
            { x: 0, y: -1 }, // North
            { x: 1, y: 0 },  // East
            { x: 0, y: 1 },  // South
            { x: -1, y: 0 }  // West
        ];
        
        // Shuffle to get random adjacent tile
        const shuffled = directions.sort(() => Math.random() - 0.5);
        
        for (const dir of shuffled) {
            const adjX = targetX + dir.x;
            const adjY = targetY + dir.y;
            
            if (dungeon.isWalkable(adjX, adjY)) {
                return { x: adjX, y: adjY };
            }
        }
        
        return null; // No walkable adjacent tile
    }

    moveKnight(knight, deltaTime) {
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
            
            knight.gridPosition.x += dx;
            knight.gridPosition.y += dy;
        }
    }
}
