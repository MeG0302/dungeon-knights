#!/usr/bin/env node
/**
 * Print the constructor arguments for the phase 2 deployment — derived, never typed.
 *
 *     node tools/deploy-args.js
 *
 * The deployment has nine contracts, four of which take numbers that matter and one of which
 * takes a four-element share array that must sum to exactly 10,000. Typing `2968/2671/2295/2066`
 * from a document into Remix is how a deploy becomes a different economy than the one that was
 * published: the vault accepts any array that sums to 10,000, and 3000/2600/2400/2000 also sums
 * to 10,000 while moving a fifth of the budget from one product to another.
 *
 * So this prints what `lib/` derives — the same functions the API and the pages read — and the
 * deploy copies from here. Anything in the output that is a decision rather than a derivation
 * is marked as such, because those are the numbers a person has to choose:
 *
 *   - the four DNG bucket addresses (custody, not arithmetic)
 *   - the raffle's stock split across the four capsule rungs (an open question in
 *     `lib/staking-config.js`: the total is fixed at 200, the split is not)
 *   - the backend signer address for the game contract
 *
 * This is an ES module so it can import `lib/` directly. The contracts harness is CommonJS
 * (it needs `require('solc')`) and so re-parses those files; this one does not have to.
 */

import { DISTRIBUTION, DNG_SUPPLY, MIN_WEEKS, lineBps, weeklyBudgetDng } from '../lib/reward-config.js';
import { CAPSULES_PER_WEEK, KNIGHTS_REFERENCE_SIZE } from '../lib/staking-config.js';
import { RARITY } from '../lib/knights.js';

const env = process.env;

const buckets = [
    ['Reward vault', env.VAULT_ADDRESS || '<the RewardVault address — deploy it first>'],
    ['Liquidity', env.LIQUIDITY_ADDRESS || '<the LP custody address>'],
    ['Treasury', env.TREASURY_ADDRESS || '<the treasury multisig>'],
    ['Marketing / community', env.MARKETING_ADDRESS || '<the marketing multisig>'],
];

const stock = (env.RAFFLE_STOCK || '50,50,50,50')
    .split(',')
    .map((value) => Number(value.trim()));

/** DNG to wei, as the decimal string a constructor argument field wants. */
const wei = (amount) => (BigInt(Math.round(amount)) * 10n ** 18n).toString();

function section(title, lines) {
    console.log('');
    console.log(`  ${title}`);
    for (const line of lines) console.log(`      ${line}`);
}

console.log('');
console.log('Dungeon Knights — phase 2 deploy arguments');
console.log('');

section('1. DNGToken(address rewardVault, address liquidity, address treasury, address marketing)', [
    ...buckets.map(([name, address]) => `${name.padEnd(22)} ${address}`),
    '',
    `supply   ${DNG_SUPPLY.toLocaleString('en-US')} DNG, minted in full at construction`,
    `shares   ${DISTRIBUTION.filter((b) => b.pct > 0).map((b) => `${b.pct}%`).join(' / ')}`,
    'note     there is no team bucket and no mint function, by design',
]);

section('2. RewardVault(address dngToken, uint256 configuredWeeklyBudget, uint16[4] lineBps)', [
    `dngToken                  <the DNGToken address>`,
    `configuredWeeklyBudget    ${wei(weeklyBudgetDng())}   (${weeklyBudgetDng().toLocaleString('en-US')} DNG)`,
    `lineBps                   [${lineBps().join(', ')}]   (sums to ${lineBps().reduce((a, b) => a + b, 0)})`,
    '',
    `line order   genesis dungeon, genesis staking, knights dungeon, knights staking`,
    `MIN_WEEKS    ${MIN_WEEKS} — the constructor rejects any other runway floor`,
    'note         derived from the reference population: 50 Genesis and 500 Knights playing daily',
]);

section('3. GenesisKnights()', ['no arguments — the six bands and their counts are in the contract,',
    'and the constructor refuses a table that does not tile 300–1,000 or sum to 1,024']);

section('4. Knights(address dngToken, address rewardVault)', [
    'dngToken       <the DNGToken address>',
    'rewardVault    <the RewardVault address>',
    '',
    'MAX_SUPPLY     none — the collection is unlimited by design',
    `PRICE_ANCHOR   ${KNIGHTS_REFERENCE_SIZE.toLocaleString('en-US')} — in Capsules, the size the open-price ramp is`,
    '               measured against and flat above. Not a supply limit.',
    `drop rates     ${Object.values(RARITY).map((t) => `${t.name} ${(t.dropRate * 100).toFixed(0)}%`).join('  ')}`,
]);

section('5. Capsules(address dngToken, address rewardVault, address knights, string uri)', [
    'dngToken       <the DNGToken address>',
    'rewardVault    <the RewardVault address>',
    'knights        <the Knights address>',
    'uri            <metadata base URI>',
    '',
    'note           four rungs, odds checked at construction: every rung must sum to 100% and',
    '               every outcome must be a tier the game can pay (no Mythic)',
]);

section('6. GenesisStaking(address genesisNFT, address vault)  → vault line 1', [
    'genesisNFT     <the GenesisKnights address>',
    'vault          <the RewardVault address>',
    'note           adds the raffle ticket ledger and the staker registry',
]);

section('7. KnightsStaking(address knightsNFT, address vault)  → vault line 3', [
    'knightsNFT     <the Knights address>',
    'vault          <the RewardVault address>',
]);

section('8. RaffleContract(address capsules, address ticketLedger, uint256[4] stock)', [
    'capsules       <the Capsules address>',
    'ticketLedger   <the GenesisStaking address>',
    `stock          [${stock.join(', ')}]   (sums to ${stock.reduce((a, b) => a + b, 0)})`,
    '',
    `the total is fixed: the constructor rejects anything but ${CAPSULES_PER_WEEK} capsules a week.`,
    'The split across Common / Rare / Legendary / Prime is a decision, not a derivation —',
    'the contract enforces the published total and leaves the rest to you.',
]);

section('9. DungeonKnightsGameV4(address knightNFT, address dngToken, address trustedSigner)', [
    'knightNFT       <the Knights address>',
    'dngToken        <the DNGToken address>',
    'trustedSigner   <the backend signer — must match GAME_SIGNER_PRIVATE_KEY>',
]);

console.log('');
console.log('  wiring, in this order (each is one transaction)');
console.log('');
const wiring = [
    ['Knights.setCapsules(capsules)', 'one time only — after this it can never be repointed'],
    ['Capsules.setRaffle(raffle)', 'one time only, same reason'],
    ['RewardVault.setPayer(0, gameV4, true)', "game charges the Genesis dungeon line"],
    ['RewardVault.setPayer(2, gameV4, true)', 'game charges the Knights dungeon line'],
    ['RewardVault.setPayer(1, genesisStaking, true)', "genesis staking charges only its own line"],
    ['RewardVault.setPayer(3, knightsStaking, true)', 'knights staking charges only its own line'],
    ['DNGToken → RewardVault.fund(budget)', `about ${weeklyBudgetDng().toLocaleString('en-US')} DNG for the first week`],
    ['GameV4.setRewardVault(vault) if deployed before the vault', 'zero address falls back to the V3 behaviour'],
    ['GameV4.setGenesisNFT(genesisKnights)', 'zero disables the Genesis path with a clear revert'],
];
for (const [call, why] of wiring) console.log(`      ${call.padEnd(52)} ${why}`);

console.log('');
console.log('  payer grants are per line (`RewardVault.setPayer(line, payer, allowed)`), so a');
console.log('  compromised payer can only drain the one line it was given.');
console.log('');
console.log('  After deploying, verify rather than assume:  node tools/check-v4.js <v4 address>');
console.log('');
