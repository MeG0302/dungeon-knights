// Shared knight helpers (mirrors js/core/characters.js rarity + stat math)
// Used by React pages so mint/menu stay consistent with the game engine.

export const RARITY = {
  COMMON: { name: 'Common', multiplier: 1.0, color: '#808080', dropRate: 0.65 },
  UNCOMMON: { name: 'Uncommon', multiplier: 1.5, color: '#00ff00', dropRate: 0.20 },
  RARE: { name: 'Rare', multiplier: 2.2, color: '#0080ff', dropRate: 0.10 },
  EPIC: { name: 'Epic', multiplier: 3.5, color: '#a020f0', dropRate: 0.045 },
  LEGENDARY: { name: 'Legendary', multiplier: 5.0, color: '#ffa500', dropRate: 0.012 },
  MYTHIC: { name: 'Mythic', multiplier: 8.0, color: '#ff0000', dropRate: 0.003 },
};

export const KNIGHT_IMAGES = {
  LEGENDARY: '/assets/images/characters/Knight_in_golden_armor_stands_2K_202609041404_jpeg_2K_202609041417.png',
  MYTHIC: '/assets/images/characters/Pixel_knight_holding_cosmic_shield_2K_202609041402_jpeg_2K_202609041417.png',
  EPIC: '/assets/images/characters/Pixel_knight_holding_wooden_shield_2K_202609041402_jpeg_2K_202609041417.png',
  RARE: '/assets/images/characters/Pixel_knight_standing_on_floor_2K_202609041402_jpeg_2K_202609041417.png',
  UNCOMMON: '/assets/images/characters/Pixelated_knight_standing_on_tile_2K_202609041402_jpeg_2K_202609041417.png',
  COMMON: '/assets/images/characters/Pixelated_knight_standing_on_tile_2K_202609041402_jpeg_2K_202609041417.png',
};

const BASE_SPEED = {
  MYTHIC: 15,
  LEGENDARY: 7.5,
  EPIC: 3,
  RARE: 2.14,
  UNCOMMON: 1.5,
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
