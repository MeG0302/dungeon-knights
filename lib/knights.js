// Shared knight helpers (mirrors the rarity + stat math in public/config.js)
// Used by React pages so mint/menu stay consistent with the game engine.

export const RARITY = {
  COMMON: { name: 'Common', multiplier: 1.0, color: '#9E9E9E', dropRate: 0.50, dungeonReward: 10, dailyRuns: 5 },
  UNCOMMON: { name: 'Uncommon', multiplier: 1.7, color: '#4CAF50', dropRate: 0.30, dungeonReward: 17, dailyRuns: 5 },
  RARE: { name: 'Rare', multiplier: 3.0, color: '#2196F3', dropRate: 0.15, dungeonReward: 30, dailyRuns: 4 },
  EPIC: { name: 'Epic', multiplier: 7.5, color: '#9C27B0', dropRate: 0.04, dungeonReward: 75, dailyRuns: 3 },
  LEGENDARY: { name: 'Legendary', multiplier: 15.0, color: '#FFD700', dropRate: 0.01, dungeonReward: 150, dailyRuns: 4 },
};

// The five tiers in on-chain enum order (0 = Common … 4 = Legendary). Derived from
// `RARITY` rather than typed out again, so there is no second list to drift. Anything that
// hands out or prices a knight — the vault's capsule odds included — is bounded by these.
export const KNIGHT_TIERS = Object.keys(RARITY);

export const KNIGHT_IMAGES = {
  LEGENDARY: '/assets/images/characters/Knight_in_golden_armor_stands_2K_202609041404_jpeg_2K_202609041417.png',
  EPIC: '/assets/images/characters/Pixel_knight_holding_cosmic_shield_2K_202609041402_jpeg_2K_202609041417.png',
  RARE: '/assets/images/characters/Pixelated_knight_standing_on_tile_2K_202609041402_jpeg_2K_202609041417.png',
  UNCOMMON: '/assets/images/characters/Pixel_knight_standing_on_floor_2K_202609041402_jpeg_2K_202609041417.png',
  COMMON: '/assets/images/characters/Pixel_knight_holding_wooden_shield_2K_202609041402_jpeg_2K_202609041417.png',
};

const BASE_SPEED = {
  LEGENDARY: 15,
  EPIC: 7.5,
  RARE: 3,
  UNCOMMON: 1.7,
  COMMON: 1,
};

export function rollRarity() {
  const roll = Math.random();
  let cumulative = 0;
  for (const [key, rarity] of Object.entries(RARITY)) {
    cumulative += rarity.dropRate;
    if (roll <= cumulative) return { ...rarity, tier: key };
  }
  return { ...RARITY.COMMON, tier: 'COMMON' };
}

export function generateStats(rarity) {
  const mult = rarity.multiplier;
  const variance = () => 0.8 + Math.random() * 0.4;
  return {
    power: Math.floor((10 + Math.random() * 15) * mult * variance()),
    range: 1,
    speed: BASE_SPEED[rarity.tier] ?? 1,
    maxStamina: Math.floor((300 + Math.random() * 100) * mult),
    recoveryRate: Math.floor((5 + Math.random() * 5) * mult),
  };
}

export function recruitKnight(nextId) {
  const rarity = rollRarity();
  const stats = generateStats(rarity);
  return {
    id: nextId,
    rarity,
    stats,
    stamina: stats.maxStamina,
    state: 'idle',
    totalEarned: 0,
  };
}

export function loadKnights() {
  try {
    const raw = localStorage.getItem('allKnights');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveKnights(knights) {
  localStorage.setItem('allKnights', JSON.stringify(knights));
}

export function nextKnightId(knights) {
  return knights.reduce((m, k) => Math.max(m, k.id ?? 0), 0) + 1;
}
