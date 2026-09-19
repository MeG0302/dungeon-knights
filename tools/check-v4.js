#!/usr/bin/env node
/**
 * Verify a deployed Game V4.
 *
 *     node tools/check-v4.js 0x<v4 address>
 *
 * Reads only — no key, no transactions, nothing to mis-sign. It answers the questions
 * that actually matter after a deploy:
 *
 *   - is the NFT and the DNG token the ones the game uses?
 *   - does V4's trustedSigner match GAME_SIGNER_PRIVATE_KEY (the key the backend signs with)?
 *   - is V4 funded, and does its reward table still match V3's?
 *   - is V3 paused, so the old unsigned claim path is closed?
 *
 * Exit code is 0 only when every critical check passes, so it can gate a deploy step.
 */

const { ethers } = require('ethers');

const RPC = process.env.GAME_RPC_URL || 'https://rpc.testnet.chain.robinhood.com';
const CHAIN_ID = Number(process.env.GAME_CHAIN_ID || 46630);
const KNIGHT_NFT = process.env.KNIGHT_NFT_ADDRESS || '0x06c7D4b0C35858c78c3B213fbf50fB4A25f20512';
const DNG_TOKEN = process.env.DNG_TOKEN_ADDRESS || '0xA8D54F6FEeAFaf5C2c546D1D1644aE2f46A2d910';
const GAME_V3 = process.env.GAME_CONTRACT_V3 || '0xD8de9385Db7DfE925882E76849B6e067e47236e5';

const V4_ABI = [
    'function knightNFT() view returns (address)',
    'function dngToken() view returns (address)',
    'function trustedSigner() view returns (address)',
    'function paused() view returns (bool)',
    'function treasuryBalance() view returns (uint256)',
    'function rarityReward(uint256) view returns (uint256)',
    'function dailyCap(uint256) view returns (uint8)',
    'function currentDayIndex() view returns (uint32)',
];

const V3_ABI = [
    'function paused() view returns (bool)',
    'function treasuryBalance() view returns (uint256)',
    'function rarityReward(uint256) view returns (uint256)',
    'function dailyCap(uint256) view returns (uint8)',
];

const RARITY_NAMES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];

let failures = 0;

function check(label, pass, detail) {
    const mark = pass ? 'ok  ' : 'FAIL';
    if (!pass) failures += 1;
    console.log(`  ${mark}  ${label}${detail ? `  — ${detail}` : ''}`);
}

async function main() {
    const v4Address = process.argv[2] || process.env.GAME_CONTRACT_V4;
    if (!/^0x[0-9a-fA-F]{40}$/.test(v4Address || '')) {
        console.error('Usage: node tools/check-v4.js 0x<v4 address>');
        process.exit(1);
    }

    const provider = new ethers.providers.JsonRpcProvider(RPC, CHAIN_ID);

    console.log('');
    console.log(`Game V4 check — ${v4Address}`);
    console.log(`RPC ${RPC} (chain ${CHAIN_ID})`);
    console.log('');

    const v4 = new ethers.Contract(v4Address, V4_ABI, provider);
    const v3 = new ethers.Contract(GAME_V3, V3_ABI, provider);

    const [nft, token, signer, paused, treasury] = await Promise.all([
        v4.knightNFT(),
        v4.dngToken(),
        v4.trustedSigner(),
        v4.paused(),
        v4.treasuryBalance(),
    ]);

    console.log('Wiring');
    check('knight NFT matches', nft.toLowerCase() === KNIGHT_NFT.toLowerCase(),
        `${nft}${nft.toLowerCase() === KNIGHT_NFT.toLowerCase() ? '' : `  (expected ${KNIGHT_NFT})`}`);
    check('DNG token matches', token.toLowerCase() === DNG_TOKEN.toLowerCase(),
        `${token}${token.toLowerCase() === DNG_TOKEN.toLowerCase() ? '' : `  (expected ${DNG_TOKEN})`}`);
    check('V4 is not paused', !paused);

    console.log('');
    console.log('Signer');
    const localKey = (process.env.GAME_SIGNER_PRIVATE_KEY || '').trim();
    if (/^0x[0-9a-fA-F]{64}$/.test(localKey)) {
        const localAddress = new ethers.Wallet(localKey).address;
        check('trustedSigner matches GAME_SIGNER_PRIVATE_KEY', localAddress.toLowerCase() === signer.toLowerCase(),
            `contract ${signer} · env ${localAddress}`);
    } else {
        console.log(`  ..    GAME_SIGNER_PRIVATE_KEY not set locally — contract expects ${signer}`);
        console.log('        (run with the env var set to confirm the two match)');
    }

    console.log('');
    console.log('Reward table');
    for (let i = 0; i < RARITY_NAMES.length; i++) {
        const mine = await v4.rarityReward(i);
        const theirs = await v3.rarityReward(i);
        check(`${RARITY_NAMES[i]} still ${ethers.utils.formatEther(mine)} DNG`,
            mine.eq(theirs), mine.eq(theirs) ? '' : `V3 pays ${ethers.utils.formatEther(theirs)}`);
    }
    const caps = await Promise.all([0, 1, 2, 3, 4].map((i) => v4.dailyCap(i)));
    console.log(`  ..    daily caps ${caps.map((c, i) => `${RARITY_NAMES[i]} ${c}`).join(' · ')}`);

    console.log('');
    console.log('Treasury');
    console.log(`  ..    V4 holds ${ethers.utils.formatEther(treasury)} DNG`);
    if (treasury.eq(0)) {
        check('V4 is funded', false, 'claims will revert with "Treasury empty" until it is');
    } else {
        check('V4 is funded', true);
    }

    console.log('');
    console.log('Old contract (V3)');
    const [v3Paused, v3Treasury] = await Promise.all([v3.paused(), v3.treasuryBalance()]);
    check('V3 is paused', v3Paused, v3Paused ? '' : 'the unsigned claim path is still open');
    console.log(`  ..    V3 still holds ${ethers.utils.formatEther(v3Treasury)} DNG`);
    if (!v3Paused && Number(ethers.utils.formatEther(v3Treasury)) > 0) {
        console.log('        expected order: pause V3, withdrawAllTokens, then fund V4 with the sweep');
    }

    console.log('');
    console.log(failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`);
    console.log('');
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error('');
    console.error('Check failed to run:', error.message || error);
    process.exit(1);
});
