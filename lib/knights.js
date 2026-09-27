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

/**
 * The order a screen lists the tiers in: loudest first.
 *
 * `KNIGHT_TIERS` is on-chain enum order (0 = Common), which is the right order for anything that
 * has to match the contract and the wrong order for anything a person reads — a rarity strip that
 * opened with Common would bury the two tiers the collection is actually about. Derived from
 * `KNIGHT_TIERS` rather than typed out, so there is no second list to drift — and declared *after*
 * it, because `[...KNIGHT_TIERS]` in a `const` above it is a temporal-dead-zone throw at import
 * time, which is how the first version of this took the whole portfolio page down.
 */
export const TIER_DISPLAY_ORDER = [...KNIGHT_TIERS].reverse();

/**
 * The sample squad — one knight of every tier, for building the screens that list them.
 *
 * The Knights panel is being built before the collection has holders to draw from, so it needs a
 * fixture: one knight per tier, loudest first, which is what puts the whole rarity ramp on screen at
 * once. Four decisions in here are deliberate.
 *
 * **One of each tier, not a roll.** `lib/staking-source.js` already previews a *wallet's* knights by
 * drawing tokens across the published odds. That is the right shape for a preview and the wrong
 * shape for this: at a 1% Legendary roll, most wallets draw none, so the tier the panel exists to
 * show would usually be missing. A fixture that guarantees the ramp is a different job from a
 * simulation of a wallet, and this is the first one.
 *
 * **Every figure comes from `RARITY`.** Hash power, reward, runs and drop rate are read out of the
 * published table at the moment the squad is built, never typed here. A sample knight carrying a
 * number that could not be minted would teach the wrong design to whoever builds against it, which
 * is the failure `lib/staking-source.js` avoids the same way ("a Knight's power is fixed by its
 * tier and inventing one would show a knight that cannot exist").
 *
 * **Deterministic, with no seed and no clock.** There is nothing to shuffle: the squad is the tier
 * list. The vault's preview is seeded from the wallet address for exactly this reason — a list that
 * rearranges itself between renders is a list nobody can judge — and a fixed list satisfies it more
 * simply than a seeded one.
 *
 * **The ids are the tier's position.** `#1` is the Legendary, `#5` the Common, and that is a
 * statement about this array rather than about anyone's wallet. The sample is only ever rendered
 * behind a label that says so, on the gated host only.
 */
export function sampleKnights() {
  return TIER_DISPLAY_ORDER.map((key, index) => {
    const tier = RARITY[key];
    const tokenId = index + 1;
    return {
      tokenId,
      name: `${tier.name} Knight #${tokenId}`,
      rarity: key.toLowerCase(),
      tierName: tier.name,
      hashPower: tier.hashPower,
    };
  });
}

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

/**
 * The portrait a knight is *listed* with, one per tier.
 *
 * `KNIGHT_IMAGES` above is what the dungeon draws on the map; this is what a knight looks like
 * wherever it appears as a record — the Hall's roster, the Summoning Chamber, the Staking Vault.
 * They are deliberately different files. A map sprite is read at 32–64px against a busy tileset
 * and has to stay legible there; a portrait is read at card size against a dark panel, where the
 * sprite reads as mud. Substituting one for the other is not a bug either page recovers from —
 * the map stops being readable, or the roster stops looking like anything.
 *
 * Mirrors `public/config.js` (`RARITY_CONFIG[tier].pfp`), which the roster and the Summoning
 * Chamber read. `tools/check-rarity.js` fails if the two tables disagree, because a disagreement
 * means the same tier is a different knight on the vault than it is in the Hall.
 */
export const KNIGHT_PFP = {
  LEGENDARY: '/assets/pfp/legendary.webp',
  EPIC: '/assets/pfp/epic.webp',
  RARE: '/assets/pfp/rare.webp',
  UNCOMMON: '/assets/pfp/uncommon.webp',
  COMMON: '/assets/pfp/common.webp',
};

/**
 * Genesis Knights are one collection with one portrait — 1,024 knights, no tiers, so there is
 * nothing to key an image off except the collection itself.
 */
export const GENESIS_PFP = '/assets/pfp/genesis.webp';

/** The portrait for a tier in any casing, or `null` when the tier is not one of the five. */
export function knightPfp(tierKey) {
  return KNIGHT_PFP[String(tierKey || '').toUpperCase()] || null;
}

/**
 * The portrait a screen should draw for a knight record.
 *
 * `isKnights` is which collection the record came from, not a property of the knight itself: the
 * two collections are separate contracts, and a Genesis Knight carries no tier at all. It has to
 * be the caller's answer because "no rarity" means two different things on the two sides — a
 * normal Genesis record, and a Knights record whose tier did not come back. Only the caller knows
 * which question it asked, and getting it wrong shows a Genesis portrait on a tiered Knight
 * (or a broken frame on one that has a tier but no portrait).
 */
export function knightPortrait(knight, isKnights) {
  return isKnights ? knightPfp(knight?.rarity) : GENESIS_PFP;
}

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
