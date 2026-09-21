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
 *   - does its reward table match the **published** table, and can the vault actually pay it?
 *   - is V3 paused, so the old unsigned claim path is closed?
 *
 * Three of those questions changed meaning in phase 2, and they changed where the money is:
 *
 *   - **The table is compared to `lib/knights.js`, not to V3.** This check used to assert
 *     "V4 pays what V3 pays", which was the right question while V4 was a drop-in for V3.
 *     It is the wrong question now: the published table was deliberately revised to
 *     12/20/36/60/100, so "still 12.0 DNG — V3 pays 10.0" was reporting the migration as a
 *     failure on all five tiers. The invariant that matters is *the contract pays what the
 *     site advertises*, and that is checkable from the published source.
 *   - **Funding is the vault's business, not V4's.** With `rewardVault` set, a claim draws on
 *     the vault's weekly line, so V4 holding 0 DNG is correct and expected. The check now
 *     asks whether the vault can pay the game's lines. V4's own balance is still printed,
 *     because it is the fallback path when no vault is wired.
 *
 * Exit code is 0 only when every critical check passes, so it can gate a deploy step.
 */

const { ethers } = require('ethers');

const RPC = process.env.GAME_RPC_URL || 'https://rpc.testnet.chain.robinhood.com';
const CHAIN_ID = Number(process.env.GAME_CHAIN_ID || 46630);
const KNIGHT_NFT = process.env.KNIGHT_NFT_ADDRESS || '0x27Cfbb763188a50Fe1C0fFfBe2552b1945eE1B2D';
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
    // Phase 2: rewards are paid from the funded vault, and Genesis is a second collection.
    'function rewardVault() view returns (address)',
    'function genesisNFT() view returns (address)',
    'function GENESIS_REWARD() view returns (uint256)',
];

const VAULT_ABI = [
    'function balance() view returns (uint256)',
    'function weeklyBudget() view returns (uint256)',
    'function canPay(uint8 line, address payer) view returns (bool)',
    'function lineRemaining(uint8 line) view returns (uint256)',
];

const V3_ABI = [
    'function paused() view returns (bool)',
    'function treasuryBalance() view returns (uint256)',
    'function rarityReward(uint256) view returns (uint256)',
    'function dailyCap(uint256) view returns (uint8)',
];

const RARITY_NAMES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];

/**
 * The published table, read out of `lib/knights.js` as text.
 *
 * Text rather than an import because this file is CommonJS (`require('ethers')`) and `lib/`
 * is ES modules — the same split `tools/check-contracts.js` handles the same way, and for
 * the same reason: the comparison has to be against the source the site reads, and a copy
 * pasted into this file would be a third home for the numbers.
 */
function publishedTable() {
    const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'knights.js'), 'utf8');
    const rows = [];
    const line = /^\s*([A-Z]+):\s*\{.*dungeonReward:\s*([\d.]+),\s*dailyRuns:\s*([\d.]+),/gm;
    let match;
    while ((match = line.exec(source))) {
        rows.push({ key: match[1], rewardPerClear: Number(match[2]), dailyRuns: Number(match[3]) });
    }
    return rows;
}

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

    const [rewardVault, genesisNFT] = await Promise.all([v4.rewardVault(), v4.genesisNFT()]);
    const vaultWired = rewardVault !== ethers.constants.AddressZero;
    console.log(`  ..    rewardVault ${vaultWired ? rewardVault : 'not set — V4 pays from its own balance'}`);
    console.log(`  ..    genesisNFT  ${genesisNFT === ethers.constants.AddressZero ? 'not set — the Genesis path is off' : genesisNFT}`);

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
    const published = publishedTable();
    check('the published table was readable', published.length === 5, `${published.length} tiers`);
    for (let i = 0; i < RARITY_NAMES.length; i++) {
        const mine = await v4.rarityReward(i);
        const expected = published[i]?.rewardPerClear;
        const onChain = Number(ethers.utils.formatEther(mine));
        const theirs = await v3.rarityReward(i);
        check(`${RARITY_NAMES[i]} pays the published ${expected} DNG`, onChain === expected,
            onChain === expected ? '' : `contract pays ${onChain}`);
        if (Number(ethers.utils.formatEther(theirs)) !== expected) {
            console.log(`  ..    (V3 pays ${ethers.utils.formatEther(theirs)} — the older table, unchanged by design)`);
        }
    }
    const caps = await Promise.all([0, 1, 2, 3, 4].map((i) => v4.dailyCap(i)));
    const capsOk = caps.every((c, i) => c === published[i]?.dailyRuns);
    check('the daily caps are the published ones', capsOk,
        caps.map((c, i) => `${RARITY_NAMES[i]} ${c}`).join(' · '));
    if (genesisNFT !== ethers.constants.AddressZero) {
        check('Genesis pays a flat 300 DNG',
            (await v4.GENESIS_REWARD()).eq(ethers.utils.parseEther('300')),
            ethers.utils.formatEther(await v4.GENESIS_REWARD()) + ' DNG');
    }

    console.log('');
    console.log('Funding');
    console.log(`  ..    V4 holds ${ethers.utils.formatEther(treasury)} DNG (the fallback path, unused while a vault is wired)`);
    if (vaultWired) {
        const vault = new ethers.Contract(rewardVault, VAULT_ABI, provider);
        const [vaultBalance, budget] = await Promise.all([vault.balance(), vault.weeklyBudget()]);
        check('the reward vault holds DNG', !vaultBalance.isZero(),
            `${ethers.utils.formatEther(vaultBalance)} DNG`);
        check('the vault releases a budget this week', !budget.isZero(),
            `${Number(ethers.utils.formatEther(budget)).toLocaleString('en-US')} DNG`);
        const [genesisLine, knightsLine] = await Promise.all([
            vault.canPay(0, v4Address),
            vault.canPay(2, v4Address),
        ]);
        check('the game may charge the Genesis dungeon line', genesisLine);
        check('the game may charge the Knights dungeon line', knightsLine);
        if (genesisLine && knightsLine) {
            const remaining = await Promise.all([vault.lineRemaining(0), vault.lineRemaining(2)]);
            console.log(`  ..    left this week: genesis dungeon ${ethers.utils.formatEther(remaining[0])} · knights dungeon ${ethers.utils.formatEther(remaining[1])} DNG`);
        }
    } else if (treasury.eq(0)) {
        check('V4 is funded', false, 'claims will revert with "Treasury empty" until it is, or until a vault is wired');
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
