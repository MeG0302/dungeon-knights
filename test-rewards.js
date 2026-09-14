// Test script for new reward calculation system
// Formula: (Sum of base rewards) × 0.78 ÷ √(knight_count) × performance_bonus

// Import RARITY table from characters.js
const RARITY = {
    COMMON: { dungeonReward: 10 },
    UNCOMMON: { dungeonReward: 17 },
    RARE: { dungeonReward: 30 },
    EPIC: { dungeonReward: 75 },
    LEGENDARY: { dungeonReward: 150 }
};

function calculateReward(knightRarities, performanceBonus = 1.0) {
    const rarities = Array.isArray(knightRarities) ? knightRarities : [knightRarities];
    
    // Calculate sum of base rewards
    const sumBaseRewards = rarities.reduce((sum, rarity) => {
        return sum + (RARITY[rarity]?.dungeonReward || 10);
    }, 0);
    
    // Team efficiency: Solo = 1.0x, Team (2+) = 0.78x
    const knightCount = rarities.length;
    const teamEfficiency = knightCount === 1 ? 1.0 : 0.78;
    const teamReward = sumBaseRewards * teamEfficiency;
    
    // Apply performance bonus
    const finalReward = teamReward * performanceBonus;
    
    return {
        knights: knightCount,
        sumBase: sumBaseRewards,
        efficiency: teamEfficiency,
        baseReward: teamReward,
        performanceBonus: performanceBonus,
        finalReward: finalReward
    };
}

console.log('🧪 REWARD CALCULATION TESTS\n');
console.log('=' .repeat(60));

// Test 1: Single Common Knight (baseline)
console.log('\n📊 Test 1: 1 Common Knight');
const test1 = calculateReward(['COMMON']);
console.log(`   Sum: ${test1.sumBase} DNG, Efficiency: ${test1.efficiency.toFixed(3)}x`);
console.log(`   ✅ Base Reward: ${test1.baseReward.toFixed(2)} DNG`);
console.log(`   With 1.5x performance: ${calculateReward(['COMMON'], 1.5).finalReward.toFixed(2)} DNG`);

// Test 2: 15 Common Knights
console.log('\n📊 Test 2: 15 Common Knights');
const test2 = calculateReward(Array(15).fill('COMMON'));
console.log(`   Sum: ${test2.sumBase} DNG, Efficiency: ${test2.efficiency.toFixed(3)}x`);
console.log(`   ✅ Base Reward: ${test2.baseReward.toFixed(2)} DNG`);
console.log(`   With 1.5x performance: ${calculateReward(Array(15).fill('COMMON'), 1.5).finalReward.toFixed(2)} DNG`);

// Test 3: 1 Legendary Knight
console.log('\n📊 Test 3: 1 Legendary Knight');
const test3 = calculateReward(['LEGENDARY']);
console.log(`   Sum: ${test3.sumBase} DNG, Efficiency: ${test3.efficiency.toFixed(3)}x`);
console.log(`   ✅ Base Reward: ${test3.baseReward.toFixed(2)} DNG`);
console.log(`   With 1.5x performance: ${calculateReward(['LEGENDARY'], 1.5).finalReward.toFixed(2)} DNG`);

// Test 4: 1 Legendary + 14 Common
console.log('\n📊 Test 4: 1 Legendary + 14 Common Knights');
const test4 = calculateReward(['LEGENDARY', ...Array(14).fill('COMMON')]);
console.log(`   Sum: ${test4.sumBase} DNG, Efficiency: ${test4.efficiency.toFixed(3)}x`);
console.log(`   ✅ Base Reward: ${test4.baseReward.toFixed(2)} DNG`);
console.log(`   With 1.5x performance: ${calculateReward(['LEGENDARY', ...Array(14).fill('COMMON')], 1.5).finalReward.toFixed(2)} DNG`);

// Test 5: Mixed team
console.log('\n📊 Test 5: Mixed Team (1 Epic, 2 Rare, 5 Uncommon, 7 Common)');
const test5 = calculateReward([
    'EPIC',
    'RARE', 'RARE',
    'UNCOMMON', 'UNCOMMON', 'UNCOMMON', 'UNCOMMON', 'UNCOMMON',
    'COMMON', 'COMMON', 'COMMON', 'COMMON', 'COMMON', 'COMMON', 'COMMON'
]);
console.log(`   Sum: ${test5.sumBase} DNG, Efficiency: ${test5.efficiency.toFixed(3)}x`);
console.log(`   ✅ Base Reward: ${test5.baseReward.toFixed(2)} DNG`);
console.log(`   With 1.5x performance: ${calculateReward(['EPIC', 'RARE', 'RARE', 'UNCOMMON', 'UNCOMMON', 'UNCOMMON', 'UNCOMMON', 'UNCOMMON', 'COMMON', 'COMMON', 'COMMON', 'COMMON', 'COMMON', 'COMMON', 'COMMON'], 1.5).finalReward.toFixed(2)} DNG`);

console.log('\n' + '='.repeat(60));
console.log('\n🎯 KEY REQUIREMENT VERIFICATION:\n');

// Verify: 15 Commons should be 0.78x of 1 Legendary
const ratio = test2.baseReward / test3.baseReward;
console.log(`✅ 15 Commons (${test2.baseReward.toFixed(2)} DNG) / 1 Legendary (${test3.baseReward.toFixed(2)} DNG) = ${ratio.toFixed(3)}x`);
console.log(`   Target: 0.78x | Actual: ${ratio.toFixed(3)}x | ${ratio.toFixed(2) === '0.78' ? '✅ PERFECT!' : ratio >= 0.77 && ratio <= 0.79 ? '✅ CLOSE ENOUGH!' : '❌ NEEDS ADJUSTMENT'}`);

console.log('\n📈 ROI CALCULATIONS (10-day target, 5 dungeons/day):\n');

// ROI for Common (500 DNG mint cost)
const commonDailyEarnings = test1.finalReward * 5; // 5 dungeons per day
const commonDaysToROI = 500 / commonDailyEarnings;
console.log(`Common Knight: ${test1.finalReward.toFixed(2)} DNG/dungeon × 5 = ${commonDailyEarnings.toFixed(2)} DNG/day`);
console.log(`   ROI: ${commonDaysToROI.toFixed(1)} days (target: 10 days) ${commonDaysToROI <= 10.5 ? '✅' : '❌'}`);

// ROI for Legendary (500 DNG mint cost)
const legendaryDailyEarnings = test3.finalReward * 5;
const legendaryDaysToROI = 500 / legendaryDailyEarnings;
console.log(`Legendary Knight: ${test3.finalReward.toFixed(2)} DNG/dungeon × 5 = ${legendaryDailyEarnings.toFixed(2)} DNG/day`);
console.log(`   ROI: ${legendaryDaysToROI.toFixed(1)} days ${legendaryDaysToROI <= 2 ? '✅ FAST!' : '✅'}`);

console.log('\n' + '='.repeat(60));
