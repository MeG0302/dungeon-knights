// Shared knight helpers (mirrors the rarity + stat math in public/config.js)
// Used by React pages so mint/menu stay consistent with the game engine.

export const RARITY = {
  COMMON: { name: 'Common', multiplier: 1.0, color: '#9E9E9E', dropRate: 0.50, dungeonReward: 12, dailyRuns: 5, hashPower: 15 },
  UNCOMMON: { name: 'Uncommon', multiplier: 1.7, color: '#4CAF50', dropRate: 0.30, dungeonReward: 20, dailyRuns: 5, hashPower: 25 },
  RARE: { name: 'Rare', multiplier: 3.0, color: '#2196F3', dropRate: 0.15, dungeonReward: 36, dailyRuns: 4, hashPower: 36 },
  EPIC: { name: 'Epic', multiplier: 7.5, color: '#9C27B0', dropRate: 0.04, dungeonReward: 60, dailyRuns: 3, hashPower: 45 },
  LEGENDARY: { name: 'Legendary', multiplier: 15.0, color: '#FFD700', dropRate: 0.01, dungeonReward: 100, dailyRuns: 4, hashPower: 100 },
};

/**
 * Hash power is deliberately `dailyCapacity / 4` for every tier, and that is what makes the
 * 90% staking rule in `lib/reward-config.js` uniform across the whole collection.
 *
 * An earlier table (5 / 8 / 15 / 40 / 100) was not proportional to earning power: under it
 * a Legendary staker earned **2.1x** its own dungeon income passively while a Common earned
 * **0.7x**, because 100 hash power sat beside a 400-DNG daily capacity that a 45-hash-power
 * Epic was already close to. Deriving the value from capacity removes the judgement call —
 * the ratio becomes a property of the table's shape rather than of a number someone typed.
 */
export const HASH_POWER_PER_CAPACITY = 1 / 4;

// The five tiers in on-chain enum order (0 = Common … 4 = Legendary). Derived from
// `RARITY` rather than typed out again, so there is no second list to drift. Anything that
// hands out or prices a knight — the vault's capsule odds included — is bounded by these.
export const KNIGHT_TIERS = Object.keys(RARITY);

/** Drop-rate weighted earning power of one fresh roll, in DNG per day (92.8). */
export function expectedRewardPerDay() {
  return Object.values(RARITY).reduce(
    (sum, tier) => sum + tier.dropRate * tier.dungeonReward * tier.dailyRuns, 0,
  );
}

/** Drop-rate weighted clears per day for one knight (4.76). */
export function expectedClearsPerDay() {
  return Object.values(RARITY).reduce((sum, tier) => sum + tier.dropRate * tier.dailyRuns, 0);
}

/** Drop-rate weighted hash power of one minted knight (23.2). */
export function expectedHashPower() {
  return Object.values(RARITY).reduce((sum, tier) => sum + tier.dropRate * tier.hashPower, 0);
}

/** A tier's daily earning capacity — the number its hash power is derived from. */
export function dailyCapacity(tierKey) {
  const tier = RARITY[String(tierKey).toUpperCase()];
  return tier ? tier.dungeonReward * tier.dailyRuns : null;
}

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
