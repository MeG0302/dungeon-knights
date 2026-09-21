#!/usr/bin/env node
/**
 * Deploy the phase 2 contract set, one contract per step, verifying each as it lands.
 *
 *     node tools/deploy-phase2.js --list          # the plan, args and predicted addresses
 *     node tools/deploy-phase2.js --step vault    # deploy (or verify) one step
 *     node tools/deploy-phase2.js                 # every remaining step, in order
 *     node tools/deploy-phase2.js --verify        # read-only: check what is already deployed
 *
 * Why a script rather than nine paste-into-Remix rounds:
 *
 *   - **One of the nine arguments cannot be typed safely.** `RewardVault` takes
 *     `uint16[4] lineBps`, and the vault accepts *any* four values that sum to 10,000. The
 *     published split is 2968/2671/2295/2066; 3000/2600/2400/2000 also sums to 10,000 and
 *     moves a fifth of the budget between products. Both deploy. Only one is the economy
 *     that was published, so the number is derived from `lib/reward-config.js` here rather
 *     than copied from a document.
 *   - **The token and the vault each need the other's address.** `RewardVault` needs
 *     `dngToken`, and `DNGToken` mints 45% of the supply *to the vault* in its constructor.
 *     That is a cycle, and the order below breaks it deliberately: **vault first, with the
 *     next contract address predicted**, then the token. If the prediction is ever wrong the
 *     mistake is a vault pointing at the wrong token — a redeploy, with no tokens minted —
 *     whereas the other order would mint 450,000,000 DNG to an address that is not a vault
 *     and cannot be recovered. The prediction is verified at the end, not assumed.
 *   - **Every step is checked, not just broadcast.** A deploy that reverts and a deploy that
 *     lands with the wrong constant look the same until someone reads the contract back, so
 *     each step reads its own published numbers and fails loudly on a mismatch.
 *
 * Progress lives in `deployed-phase2.json`, so a re-run resumes instead of deploying a
 * second set. Steps already recorded are verified rather than repeated.
 *
 * `services` it needs, all from `.env.local`: `PRIVATE_KEY` (the deployer — it becomes the
 * owner of every contract), and optionally `GAME_RPC_URL`, `GAME_CHAIN_ID`,
 * `SIGNER_ADDRESS`, `RAFFLE_STOCK`, `CAPSULE_URI`, `LIQUIDITY_ADDRESS`, `TREASURY_ADDRESS`,
 * `MARKETING_ADDRESS`.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { ethers } = require('ethers');

const ROOT = path.join(__dirname, '..');
const RECORD = path.join(ROOT, 'deployed-phase2.json');
const RPC = env('GAME_RPC_URL') || 'https://rpc.testnet.chain.robinhood.com';
const CHAIN_ID = Number(env('GAME_CHAIN_ID') || 46630);
const SITE = env('NEXT_PUBLIC_SITE_URL') || 'https://dungeon-knights.vercel.app';

// ------------------------------------------------------------------------------- env + lib
function env(name) {
    if (process.env[name]) return process.env[name];
    try {
        const text = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
        const match = new RegExp(`^${name}=(.*)$`, 'm').exec(text);
        return match ? match[1].trim().replace(/^["']|["']$/g, '') : null;
    } catch {
        return null;
    }
}

/**
 * The published economy, read from `lib/` — the same source the site and the API read.
 *
 * `pathToFileURL` rather than string-concatenating a `file://` prefix: this repository's
 * directory name contains a space, so a hand-built URL resolves to a path that does not
 * exist and the failure reads like a missing module.
 */
async function economy() {
    const lib = (name) => pathToFileURL(path.join(ROOT, 'lib', name)).href;
    const [reward, staking, knights] = await Promise.all([
        import(lib('reward-config.js')),
        import(lib('staking-config.js')),
        import(lib('knights.js')),
    ]);
    return { reward, staking, knights };
}

// ------------------------------------------------------------------------------- compile
const EMPTY_IMPORT = { error: 'not found' };

/**
 * Compile with the same settings as `foundry.toml` and `tools/check-contracts.js` —
 * 0.8.28, optimizer 200 runs, `evmVersion cancun` (measured against this chain by
 * `tools/check-opcodes.js`, which is why cancun and not the usual `paris`).
 */
function compile() {
    const solc = require('solc');
    const sources = {};
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.sol')) {
                sources[path.relative(ROOT, full).replace(/\\/g, '/')] = {
                    content: fs.readFileSync(full, 'utf8'),
                };
            }
        }
    };
    walk(path.join(ROOT, 'contracts'));

    const input = {
        language: 'Solidity',
        sources,
        settings: {
            optimizer: { enabled: true, runs: 200 },
            evmVersion: 'cancun',
            remappings: ['@openzeppelin/contracts/=node_modules/@openzeppelin/contracts/'],
            outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
        },
    };

    const OZ = path.join(ROOT, 'node_modules', '@openzeppelin', 'contracts');
    const callback = (importPath) => {
        const candidates = [];
        if (importPath.startsWith('@openzeppelin/')) {
            candidates.push(path.join(OZ, importPath.slice('@openzeppelin/contracts/'.length)));
        }
        candidates.push(path.join(ROOT, 'contracts', importPath), path.join(ROOT, importPath));
        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) return { contents: fs.readFileSync(candidate, 'utf8') };
        }
        return EMPTY_IMPORT;
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input), { import: callback }));
    const errors = (output.errors || []).filter((e) => e.severity === 'error');
    if (errors.length) {
        for (const error of errors) console.log(error.formattedMessage.trim());
        throw new Error(`${errors.length} compile error(s)`);
    }

    const artifacts = {};
    for (const contracts of Object.values(output.contracts)) {
        for (const [name, artifact] of Object.entries(contracts)) {
            if (artifact.evm.bytecode.object) artifacts[name] = artifact;
        }
    }
    return artifacts;
}

// ------------------------------------------------------------------------------- helpers
const wei = (dng) => ethers.BigNumber.from(Math.round(dng)).mul(ethers.BigNumber.from(10).pow(18));

let failures = 0;
function check(label, pass, detail) {
    if (!pass) failures += 1;
    console.log(`      ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

/**
 * Compare a getter's value with an expected number, whatever ethers handed back.
 *
 * ethers v5 decodes integers **by type, not by value**: `uint8` and `uint16` come back as
 * plain numbers, `uint256` as a `BigNumber`. So `await c.MAX_SUPPLY() === 1024` is `false`
 * for a uint256 that plainly returns 1,024, and the check reads as a contract fault when it
 * is a comparison fault. One helper, used for every numeric assertion, so that mistake
 * cannot be made twice in the same file.
 */
const eq = (value, expected) =>
    (ethers.BigNumber.isBigNumber(value) ? value.toString() : String(value)) === String(expected);

function record() {
    try {
        return JSON.parse(fs.readFileSync(RECORD, 'utf8'));
    } catch {
        return { chainId: CHAIN_ID, deployer: null, contracts: {}, done: [] };
    }
}

function save(state) {
    fs.writeFileSync(RECORD, `${JSON.stringify(state, null, 2)}\n`);
}

/** `--list` prints exactly what will be deployed and with what, and sends nothing. */
async function plan(artifacts, state, wallet) {
    const { reward, staking } = await economy();
    const budget = wei(reward.weeklyBudgetDng());
    const bps = reward.lineBps();
    // The vault is deployed *first*, at the current nonce, so the token it points at is the
    // contract at nonce + 1. Getting this off by one would point a vault's immutable `dngToken`
    // at whatever contract happened to land next, which the token step then verifies against.
    const nonce = await wallet.provider.getTransactionCount(wallet.address);
    const tokenPredicted = ethers.utils.getContractAddress({ from: wallet.address, nonce: nonce + 1 });

    console.log('');
    console.log('  deployer   ' + wallet.address);
    console.log('  balance    ' + ethers.utils.formatEther(await wallet.provider.getBalance(wallet.address)) + ' ETH');
    console.log('  nonce      ' + nonce);
    console.log('  chain      ' + CHAIN_ID + '  ' + RPC);
    console.log('');
    console.log('  order and arguments');
    console.log('');
    console.log(`    1  RewardVault(dngToken, budget, lineBps)`);
    console.log(`         dngToken  ${tokenPredicted}   <- predicted from nonce ${nonce} + 1, verified after`);
    console.log(`         budget    ${budget.toString()}  (${reward.weeklyBudgetDng().toLocaleString('en-US')} DNG)`);
    console.log(`         lineBps   [${bps.join(', ')}]  (sums to ${bps.reduce((a, b) => a + b, 0)})`);
    console.log(`    2  DNGToken(vault, liquidity, treasury, marketing)`);
    console.log(`         vault     45% -> the RewardVault above`);
    console.log(`         other 3   55% -> ${env('LIQUIDITY_ADDRESS') || wallet.address} (a plain ERC-20 transfer can move them later)`);
    console.log(`    3  GenesisKnights()                       1,024, bands from lib/staking-config.js`);
    console.log(`    4  Knights(dngToken, vault)               five tiers, no supply ceiling`);
    console.log(`    5  Capsules(dngToken, vault, knights, uri)`);
    console.log(`    6  GenesisStaking(genesis, vault)         vault line 1`);
    console.log(`    7  KnightsStaking(knights, vault)         vault line 3`);
    console.log(`    8  RaffleContract(capsules, genesis, stock)`);
    console.log(`    9  DungeonKnightsGameV4(knights, dngToken, signer)`);
    console.log('    then the wiring: setCapsules, setRaffle, four setPayer grants, setRewardVault, setGenesisNFT');
    console.log('');
    console.log(`  records    ${path.relative(ROOT, RECORD)}`);
    console.log(`  done       ${state.done.length ? state.done.join(', ') : 'nothing yet'}`);
    console.log('');
}

// ------------------------------------------------------------------------------- the steps
/**
 * Each step deploys (or verifies) one contract and then checks its published numbers.
 * `deploy` is only called when the step has not been recorded.
 */
function steps(artifacts, ctx) {
    const { reward, staking, knights: knightTable } = ctx.config;
    const tiers = Object.values(knightTable.RARITY);
    const order = Object.keys(knightTable.RARITY);

    const deploy = async (factory, args) => {
        const contract = await factory.deploy(...args);
        await contract.deployed();
        return contract;
    };

    return [
        {
            key: 'vault',
            contract: 'RewardVault',
            title: 'RewardVault',
            async run(state, wallet) {
                const predicted = state.predictions.token;
                const factory = new ethers.ContractFactory(artifacts.RewardVault.abi, artifacts.RewardVault.evm.bytecode.object, wallet);
                const contract = await deploy(factory, [predicted, wei(reward.weeklyBudgetDng()), reward.lineBps()]);
                return contract.address;
            },
            async verify(contract, state) {
                const bps = reward.lineBps();
                check('LINE_COUNT is 4', (await contract.LINE_COUNT()) === 4);
                check('MIN_WEEKS is 12', (await contract.MIN_WEEKS()) === 12);
                check('the budget is the derived one',
                    (await contract.configuredWeeklyBudget()).toString() === wei(reward.weeklyBudgetDng()).toString(),
                    ethers.utils.formatEther(await contract.configuredWeeklyBudget()) + ' DNG/week');
                let linesOk = true;
                for (let i = 0; i < 4; i++) linesOk = linesOk && (await contract.lineBps(i)) === bps[i];
                check('the four line shares are the derived ones', linesOk, `[${bps.join(', ')}]`);
                check('the vault starts at scale 1.00', (await contract.epochScaleBps()) === 10000);
                // Its immutable `dngToken` is the *predicted* address here, and the vault is
                // deliberately deployed first. Two consequences worth stating: this read is
                // the only way to prove the vault accepted the prediction before the token
                // exists, and **`balance()`/`weeklyBudget()` cannot be read at all yet** —
                // they call `balanceOf` on an address with no code, which the ABI decoder
                // reports as a revert. That is an ordering fact, not a fault in the vault; the
                // token step is where the funded balance is checked.
                check('the vault holds the predicted token address',
                    (await contract.dngToken()).toLowerCase() === state.predictions.token.toLowerCase(),
                    await contract.dngToken());
            },
        },
        {
            key: 'token',
            contract: 'DNGToken',
            title: 'DNGToken',
            async run(state, wallet) {
                const factory = new ethers.ContractFactory(artifacts.DNGToken.abi, artifacts.DNGToken.evm.bytecode.object, wallet);
                const liquidity = env('LIQUIDITY_ADDRESS') || wallet.address;
                const treasury = env('TREASURY_ADDRESS') || wallet.address;
                const marketing = env('MARKETING_ADDRESS') || wallet.address;
                const contract = await deploy(factory, [state.contracts.vault, liquidity, treasury, marketing]);
                return contract.address;
            },
            async verify(contract, state) {
                const supply = await contract.totalSupply();
                check('MAX_SUPPLY is 1,000,000,000', (await contract.MAX_SUPPLY()).toString() === wei(1_000_000_000).toString());
                check('the whole supply is minted', supply.toString() === wei(1_000_000_000).toString(),
                    ethers.utils.formatEther(supply) + ' DNG');
                // The prediction is verified here rather than trusted: the vault was deployed
                // expecting its token to land at this address, and the token's biggest bucket
                // is that vault. If the two disagree, one of them is costing a redeploy.
                const vaultToken = await new ethers.Contract(
                    state.contracts.vault,
                    ['function dngToken() view returns (address)'],
                    contract.provider,
                ).dngToken();
                check('the vault points at this token (predicted address was right)',
                    vaultToken.toLowerCase() === contract.address.toLowerCase(),
                    vaultToken);
                const vaultBalance = await contract.balanceOf(state.contracts.vault);
                check('the vault holds its 45%', vaultBalance.toString() === wei(450_000_000).toString(),
                    ethers.utils.formatEther(vaultBalance) + ' DNG');
                const buckets = await contract.distribution();
                check('the distribution is the published four', buckets.length === 4,
                    buckets.map((b) => `${b.name} ${b.bps / 100}%`).join('  '));
            },
        },
        {
            key: 'genesis',
            contract: 'GenesisKnights',
            title: 'GenesisKnights',
            async run(state, wallet) {
                const factory = new ethers.ContractFactory(artifacts.GenesisKnights.abi, artifacts.GenesisKnights.evm.bytecode.object, wallet);
                const contract = await deploy(factory, []);
                return contract.address;
            },
            async verify(contract) {
                check('MAX_SUPPLY is 1,024', eq(await contract.MAX_SUPPLY(), 1024));
                const bands = await contract.bands();
                const expected = staking.HASH_POWER_BANDS;
                const same = bands.length === expected.length && bands.every((band, i) =>
                    band.name === expected[i].name && band.lo === expected[i].lo
                    && band.hi === expected[i].hi && band.count === expected[i].count);
                check('the six bands match lib/staking-config.js', same,
                    bands.map((b) => `${b.lo}-${b.hi}x${b.count}`).join('  '));
                const remaining = await contract.bandRemaining();
                const pool = remaining.reduce((sum, n) => sum + n, 0);
                check('every roll is still in the pool', pool === 1024, `${pool} rolls`);
            },
        },
        {
            key: 'knights',
            contract: 'Knights',
            title: 'Knights',
            async run(state, wallet) {
                const factory = new ethers.ContractFactory(artifacts.Knights.abi, artifacts.Knights.evm.bytecode.object, wallet);
                const contract = await deploy(factory, [state.contracts.token, state.contracts.vault]);
                return contract.address;
            },
            async verify(contract) {
                let tableOk = true;
                const rows = [];
                for (let i = 0; i < tiers.length; i++) {
                    const perClear = await contract.rarityReward(i);
                    const cap = await contract.dailyCap(i);
                    const power = await contract.rarityHashPower(i);
                    const drop = await contract.tierDropBps(i);
                    rows.push(`${order[i].toLowerCase()} ${ethers.utils.formatEther(perClear)}/${cap}R/${power}hp`);
                    tableOk = tableOk && perClear.toString() === wei(tiers[i].dungeonReward).toString()
                        && cap === tiers[i].dailyRuns
                        && power === tiers[i].hashPower
                        && drop === Math.round(tiers[i].dropRate * 10000);
                }
                check('the five-tier table matches lib/knights.js', tableOk, rows.join('  '));
                check('the summon price is the published 500 DNG', eq(await contract.SUMMON_PRICE(), wei(500)));
                // The absence that matters: the collection is published as unlimited, so a
                // MAX_SUPPLY getter existing at all would mean the chain disagrees with the page.
                let ceiling = 'none';
                try {
                    await contract.MAX_SUPPLY();
                    ceiling = 'MAX_SUPPLY exists';
                } catch { /* expected */ }
                check('no supply ceiling on the summonable collection', ceiling === 'none', ceiling);
            },
        },
        {
            key: 'capsules',
            contract: 'Capsules',
            title: 'Capsules',
            async run(state, wallet) {
                const factory = new ethers.ContractFactory(artifacts.Capsules.abi, artifacts.Capsules.evm.bytecode.object, wallet);
                const uri = env('CAPSULE_URI') || `${SITE}/api/metadata/capsule/{id}.json`;
                const contract = await deploy(factory, [
                    state.contracts.token, state.contracts.vault, state.contracts.knights, uri,
                ]);
                return contract.address;
            },
            async verify(contract, state) {
                check('the ramp anchor is the published reference size',
                    eq(await contract.PRICE_ANCHOR(), staking.KNIGHTS_REFERENCE_SIZE),
                    String(await contract.PRICE_ANCHOR()));
                check('the open price starts at 500 DNG',
                    (await contract.openPrice()).toString() === wei(500).toString(),
                    ethers.utils.formatEther(await contract.openPrice()) + ' DNG');
                const rungs = [];
                let oddsOk = true;
                for (let id = 1; id <= 4; id++) {
                    const [tiersOut, bpsOut, length] = await contract.odds(id);
                    const published = staking.CAPSULE_TYPES[id - 1];
                    rungs.push(`${published.name} ${length} outcomes`);
                    oddsOk = oddsOk && length === published.odds.length;
                    published.odds.forEach((row, i) => {
                        oddsOk = oddsOk && tiersOut[i] === order.indexOf(row.rarity.toUpperCase())
                            && bpsOut[i] === row.pct * 100;
                    });
                }
                check('all four rungs carry the published odds', oddsOk, rungs.join('  '));
                // State-aware, because this getter's *correct* value changes during the deploy:
                // before the wiring step the raffle is unset, afterwards it is the raffle. A
                // check that only knew the first state failed on every `--verify` re-run —
                // which is the kind of "failure" that teaches people to ignore the harness.
                const raffleSet = state.contracts.raffle && state.done.includes('wire-raffle-to-capsules');
                const expectedRaffle = raffleSet ? state.contracts.raffle : ethers.constants.AddressZero;
                check(raffleSet ? 'the raffle is wired' : 'the raffle is not wired yet',
                    (await contract.raffle()).toLowerCase() === expectedRaffle.toLowerCase(),
                    await contract.raffle());
            },
        },
        {
            key: 'genesisStaking',
            contract: 'GenesisStaking',
            title: 'GenesisStaking',
            async run(state, wallet) {
                const factory = new ethers.ContractFactory(artifacts.GenesisStaking.abi, artifacts.GenesisStaking.evm.bytecode.object, wallet);
                const contract = await deploy(factory, [state.contracts.genesis, state.contracts.vault]);
                return contract.address;
            },
            async verify(contract, state) {
                check('it pays vault line 1', eq(await contract.vaultLine(), 1));
                check('it holds the Genesis collection',
                    (await contract.collection()).toLowerCase() === state.contracts.genesis.toLowerCase());
                check('the ticket cap is 168 hours', eq(await contract.TICKET_CAP_HOURS(), 168));
                check('nobody has staked yet', eq(await contract.stakerCount(), 0));
            },
        },
        {
            key: 'knightsStaking',
            contract: 'KnightsStaking',
            title: 'KnightsStaking',
            async run(state, wallet) {
                const factory = new ethers.ContractFactory(artifacts.KnightsStaking.abi, artifacts.KnightsStaking.evm.bytecode.object, wallet);
                const contract = await deploy(factory, [state.contracts.knights, state.contracts.vault]);
                return contract.address;
            },
            async verify(contract, state) {
                check('it pays vault line 3', eq(await contract.vaultLine(), 3));
                check('it holds the summonable collection',
                    (await contract.collection()).toLowerCase() === state.contracts.knights.toLowerCase());
            },
        },
        {
            key: 'raffle',
            contract: 'RaffleContract',
            title: 'RaffleContract',
            async run(state, wallet) {
                const stock = (env('RAFFLE_STOCK') || '50,50,50,50').split(',').map((n) => Number(n.trim()));
                const factory = new ethers.ContractFactory(artifacts.RaffleContract.abi, artifacts.RaffleContract.evm.bytecode.object, wallet);
                const contract = await deploy(factory, [state.contracts.capsules, state.contracts.genesisStaking, stock]);
                return contract.address;
            },
            async verify(contract) {
                check('it gives away 200 capsules a week', eq(await contract.CAPSULES_PER_WEEK(), 200));
                const stock = (await contract.weeklyStock()).map((n) => Number(n));
                const sum = stock.reduce((total, n) => total + n, 0);
                check('the stock split totals the published 200', sum === 200, `[${stock.join(', ')}]`);
                check('no week has been drawn yet', (await contract.drawn(0)) === false);
            },
        },
        {
            key: 'game',
            contract: 'DungeonKnightsGameV4',
            title: 'DungeonKnightsGameV4',
            async run(state, wallet) {
                // The backend signer is not in this repo's environment, so unless one is given
                // the deployer is used and the wiring step below says so out loud. Rotating it
                // is `setTrustedSigner`, and the site signs with GAME_SIGNER_PRIVATE_KEY.
                const signer = env('SIGNER_ADDRESS') || wallet.address;
                const factory = new ethers.ContractFactory(artifacts.DungeonKnightsGameV4.abi, artifacts.DungeonKnightsGameV4.evm.bytecode.object, wallet);
                const contract = await deploy(factory, [state.contracts.knights, state.contracts.token, signer]);
                return contract.address;
            },
            async verify(contract, state) {
                let tableOk = true;
                const rows = [];
                for (let i = 0; i < tiers.length; i++) {
                    const perClear = await contract.rarityReward(i);
                    const cap = await contract.dailyCap(i);
                    rows.push(`${order[i].toLowerCase()} ${ethers.utils.formatEther(perClear)}`);
                    tableOk = tableOk && perClear.toString() === wei(tiers[i].dungeonReward).toString() && cap === tiers[i].dailyRuns;
                }
                check('the game pays the published table', tableOk, rows.join('  '));
                check('Genesis pays a flat 300 DNG',
                    (await contract.GENESIS_REWARD()).toString() === wei(300).toString());
                check('it reads the new collection',
                    (await contract.knightNFT()).toLowerCase() === state.contracts.knights.toLowerCase());
                check('it pays in the new token',
                    (await contract.dngToken()).toLowerCase() === state.contracts.token.toLowerCase());
            },
        },

        // ------------------------------------------------------------------ the wiring
        {
            key: 'wire-capsules-to-knights',
            contract: 'Knights',
            readFrom: 'knights',
            title: 'Knights.setCapsules  (one time only)',
            async run(state, wallet) {
                const knights = new ethers.Contract(state.contracts.knights, artifacts.Knights.abi, wallet);
                const tx = await knights.setCapsules(state.contracts.capsules);
                await tx.wait();
                return 'wired';
            },
            async verify(contract, state) {
                const knights = new ethers.Contract(state.contracts.knights, artifacts.Knights.abi, contract.provider);
                check('Knights now mints for the Capsules contract',
                    (await knights.capsules()).toLowerCase() === state.contracts.capsules.toLowerCase());
            },
        },
        {
            key: 'wire-raffle-to-capsules',
            contract: 'Capsules',
            readFrom: 'capsules',
            title: 'Capsules.setRaffle  (one time only)',
            async run(state, wallet) {
                const capsules = new ethers.Contract(state.contracts.capsules, artifacts.Capsules.abi, wallet);
                const tx = await capsules.setRaffle(state.contracts.raffle);
                await tx.wait();
                return 'wired';
            },
            async verify(contract, state) {
                const capsules = new ethers.Contract(state.contracts.capsules, artifacts.Capsules.abi, contract.provider);
                check('Capsules now mints for the raffle',
                    (await capsules.raffle()).toLowerCase() === state.contracts.raffle.toLowerCase());
            },
        },
        {
            key: 'wire-vault-payers',
            contract: 'RewardVault',
            readFrom: 'vault',
            title: 'RewardVault.setPayer x4  (per line)',
            async run(state, wallet) {
                const vault = new ethers.Contract(state.contracts.vault, artifacts.RewardVault.abi, wallet);
                const grants = [
                    [0, state.contracts.game, 'genesis dungeon -> the game'],
                    [2, state.contracts.game, 'knights dungeon -> the game'],
                    [1, state.contracts.genesisStaking, 'genesis staking -> genesis pool'],
                    [3, state.contracts.knightsStaking, 'knights staking -> knights pool'],
                ];
                for (const [line, payer, why] of grants) {
                    const tx = await vault.setPayer(line, payer, true);
                    await tx.wait();
                    console.log(`      granted line ${line} to ${payer}  (${why})`);
                }
                return 'wired';
            },
            async verify(contract, state) {
                const vault = new ethers.Contract(state.contracts.vault, artifacts.RewardVault.abi, contract.provider);
                check('the game may charge line 0', await vault.canPay(0, state.contracts.game));
                check('the game may charge line 2', await vault.canPay(2, state.contracts.game));
                check('genesis staking may charge line 1', await vault.canPay(1, state.contracts.genesisStaking));
                check('knights staking may charge line 3', await vault.canPay(3, state.contracts.knightsStaking));
                // The point of per-line grants, checked rather than asserted in a comment: a
                // trusted payer must not be able to spend a line it has nothing to do with.
                check('genesis staking may NOT charge the knights dungeon line',
                    !(await vault.canPay(2, state.contracts.genesisStaking)));
                check('the game may NOT charge a staking line', !(await vault.canPay(1, state.contracts.game)));
            },
        },
        {
            key: 'wire-game-to-vault',
            contract: 'DungeonKnightsGameV4',
            readFrom: 'game',
            title: 'Game.setRewardVault + setGenesisNFT',
            async run(state, wallet) {
                const game = new ethers.Contract(state.contracts.game, artifacts.DungeonKnightsGameV4.abi, wallet);
                await (await game.setRewardVault(state.contracts.vault)).wait();
                await (await game.setGenesisNFT(state.contracts.genesis)).wait();
                return 'wired';
            },
            async verify(contract, state) {
                const game = new ethers.Contract(state.contracts.game, artifacts.DungeonKnightsGameV4.abi, contract.provider);
                check('the game pays from the vault',
                    (await game.rewardVault()).toLowerCase() === state.contracts.vault.toLowerCase());
                check('the game knows the Genesis collection',
                    (await game.genesisNFT()).toLowerCase() === state.contracts.genesis.toLowerCase());
            },
        },
    ];
}

// ----------------------------------------------------------------------------------- main
async function main() {
    const argv = process.argv.slice(2);
    const listOnly = argv.includes('--list');
    const verifyOnly = argv.includes('--verify');
    const stepIndex = argv.indexOf('--step');
    const onlyStep = stepIndex >= 0 ? argv[stepIndex + 1] : null;
    const fromIndex = argv.indexOf('--from');
    const fromStep = fromIndex >= 0 ? argv[fromIndex + 1] : null;

    const privateKey = env('PRIVATE_KEY');
    if (!privateKey) {
        console.error('PRIVATE_KEY is not set in .env.local — nothing to deploy with.');
        process.exit(1);
    }

    const provider = new ethers.providers.JsonRpcProvider(RPC, CHAIN_ID);
    const wallet = new ethers.Wallet(privateKey, provider);

    console.log('');
    console.log('Dungeon Knights — phase 2 deploy');
    console.log(`  ${RPC} (chain ${CHAIN_ID})`);
    console.log(`  deployer ${wallet.address}`);

    const artifacts = compile();
    const config = await economy();
    const state = record();
    state.deployer = wallet.address;
    state.chainId = CHAIN_ID;

    const nonce = await provider.getTransactionCount(wallet.address);
    const predictions = state.predictions || {};
    predictions.token = predictions.token
        || ethers.utils.getContractAddress({ from: wallet.address, nonce: nonce + 1 });
    state.predictions = predictions;

    if (listOnly) {
        await plan(artifacts, state, wallet);
        return;
    }

    const all = steps(artifacts, { config });
    const ctx = { artifacts, wallet, provider };
    const targets = onlyStep
        ? all.filter((s) => s.key === onlyStep || s.key.endsWith(onlyStep))
        : fromStep
            ? all.slice(all.findIndex((s) => s.key === fromStep))
            : all;

    if (!targets.length) {
        console.error(`  no step matches ${onlyStep || fromStep}`);
        process.exit(1);
    }

    console.log(`  balance  ${ethers.utils.formatEther(await provider.getBalance(wallet.address))} ETH`);
    console.log('');

    for (const step of targets) {
        const recorded = state.contracts[step.key];
        failures = 0;
        console.log(`  ${step.title}`);

        let address = recorded;
        if (!verifyOnly && !recorded) {
            try {
                address = await step.run(state, wallet);
            } catch (error) {
                console.log(`      FAIL  deploy reverted: ${String(error.message).slice(0, 160)}`);
                console.log('');
                console.log('  stopped — nothing after this step was attempted.');
                process.exit(1);
            }
            state.contracts[step.key] = address;
            if (!state.done.includes(step.key)) state.done.push(step.key);
            save(state);
            console.log(`      deployed ${address}`);
        } else if (!recorded) {
            console.log('      skipped — not deployed yet (run without --verify to deploy)');
            console.log('');
            continue;
        } else {
            console.log(`      already at ${address}`);
        }

        // Verifying needs an ABI to read through, and a wiring step's "address" is the word
        // `wired` rather than an address — so the read target is stated per step instead of
        // guessed from the title. `readFrom` is the recorded contract a wiring step acted on;
        // deploy steps read their own address.
        const readAddress = step.readFrom ? state.contracts[step.readFrom] : address;
        const contract = new ethers.Contract(readAddress, artifacts[step.contract].abi, wallet);
        try {
            await step.verify(contract, state);
        } catch (error) {
            console.log(`      FAIL  verify threw: ${String(error.message).slice(0, 160)}`);
            failures += 1;
        }
        console.log('');
        if (failures) {
            console.log(`  ${failures} check(s) failed at ${step.key} — stopping so it can be read.`);
            process.exit(1);
        }
    }

    save(state);
    console.log('  every step done and verified.');
    console.log('');
    console.log('  addresses');
    for (const [key, value] of Object.entries(state.contracts)) {
        console.log(`      ${key.padEnd(18)} ${value}`);
    }
    console.log('');
    console.log('  environment for the site (Vercel -> project settings -> environment variables)');
    console.log(`      DNG_TOKEN_ADDRESS      ${state.contracts.token}`);
    console.log(`      KNIGHT_NFT_ADDRESS     ${state.contracts.knights}`);
    console.log(`      GENESIS_NFT            ${state.contracts.genesis}`);
    console.log(`      STAKING_CONTRACT       ${state.contracts.genesisStaking}`);
    console.log(`      RAFFLE_CONTRACT        ${state.contracts.raffle}`);
    console.log(`      CAPSULE_NFT            ${state.contracts.capsules}`);
    console.log(`      REWARD_VAULT           ${state.contracts.vault}`);
    console.log(`      GAME_CONTRACT_V4       ${state.contracts.game}`);
    console.log('');
    const signer = env('SIGNER_ADDRESS');
    if (!signer) {
        console.log('  NOTE  the game\'s trustedSigner is the deployer address, because no');
        console.log('        SIGNER_ADDRESS was given. Point it at the backend signer with');
        console.log(`        game.setTrustedSigner(<address>) before signing any run.`);
        console.log('');
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
