#!/usr/bin/env node
/**
 * Redeploy the five contracts that pin a broken `Knights`, and prove the mint path works.
 *
 *     node tools/redeploy-mint-fix.js --list      # what it would deploy, and they are, sending nothing
 *     node tools/redeploy-mint-fix.js             # deploy, wire, verify
 *     node tools/redeploy-mint-fix.js --verify    # re-read the recorded set, send nothing
 *     node tools/redeploy-mint-fix.js --summon    # and then actually summon one knight
 *
 * ## Why five contracts and not one
 *
 * `Knights.summon()` and `Capsules.open()` were each missing the line that collects the player's
 * DNG — `RewardVault.fund(amount)` pulls from `msg.sender`, which inside those calls is the
 * contract, not the player, so the vault asked the collection for 500 DNG it had never held and
 * reverted `ERC20InsufficientBalance(knights)`. `summon()` is the only mint path into the live
 * collection, so the collection could not be filled at all.
 *
 * The fix is one line in each contract, but the deployed ones are immutable — and so are the four
 * references that follow `Knights`:
 *
 *     Knights.capsules                  one-shot setter, already called
 *     Capsules.knights                  immutable
 *     RaffleContract.capsules           immutable
 *     DungeonKnightsGameV4.knightNFT    immutable
 *     StakingPool.collection            immutable
 *
 * So a repaired `Knights` arrives at a new address and drags those four with it. Everything else
 * stays exactly where it is, with its state untouched:
 *
 *     DNGToken        the 550M the site shows, the vault's 450M
 *     RewardVault     four funded lines, the weekly budget, the scale
 *     GenesisKnights  all 1,024 bands, unminted
 *     GenesisStaking  the ticket ledger (empty: no Genesis exists to stake)
 *
 * Nothing is lost by the move, and that was checked rather than assumed: the collection's
 * `totalSupply` is 0, the capsule supply is 0, and no week of the raffle has drawn. The script
 * refuses to revoke a retired pool's vault line if that pool reports stakers, which is the one
 * way this could destroy something.
 *
 * ## What "verified" means here
 *
 * Two checks matter more than the rest, and both are read from the chain:
 *
 *   1. `summon()` called from a wallet with **no** allowance must fail with
 *      `ERC20InsufficientAllowance(<new knights>, 0, 500e18)` — the player's approval is what is
 *      missing. Before the fix the same call failed with `ERC20InsufficientBalance(<knights>)`,
 *      naming the *collection* as the party without funds. The two errors are the whole bug, so
 *      the script decodes the revert and refuses to call the fix verified if it sees the old one.
 *   2. With `--summon`, one real knight is minted end to end: approve → `summon()` → the token
 *      id, its tier and its hash power read back from the new collection.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { ethers } = require('ethers');

const ROOT = path.join(__dirname, '..');
const RECORD = path.join(ROOT, 'deployed-mint-fix.json');
const PHASE2 = path.join(ROOT, 'deployed-phase2.json');
const RPC = env('GAME_RPC_URL') || 'https://rpc.testnet.chain.robinhood.com';
const CHAIN_ID = Number(env('GAME_CHAIN_ID') || 46630);
const SITE = env('NEXT_PUBLIC_SITE_URL') || 'https://dungeon-knights.vercel.app';

const ERC20_BALANCE = ethers.utils.id('ERC20InsufficientBalance(address,uint256,uint256)').slice(0, 10);
const ERC20_ALLOWANCE = ethers.utils.id('ERC20InsufficientAllowance(address,uint256,uint256)').slice(0, 10);

// --------------------------------------------------------------------------------- env + lib
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

async function economy() {
    const lib = (name) => pathToFileURL(path.join(ROOT, 'lib', name)).href;
    const [reward, staking, knights] = await Promise.all([
        import(lib('reward-config.js')),
        import(lib('staking-config.js')),
        import(lib('knights.js')),
    ]);
    return { reward, staking, knights };
}

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return { contracts: {} };
    }
}

// ---------------------------------------------------------------------------------- compile
const EMPTY_IMPORT = { error: 'not found' };

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

// ---------------------------------------------------------------------------------- helpers
const wei = (dng) => ethers.BigNumber.from(Math.round(dng)).mul(ethers.BigNumber.from(10).pow(18));

/** ethers decodes integers by type, not value — `uint256` arrives as a BigNumber, `uint8` as a number. */
const eq = (value, expected) =>
    (ethers.BigNumber.isBigNumber(value) ? value.toString() : String(value)) === String(expected);

let failures = 0;
function check(label, pass, detail) {
    if (!pass) failures += 1;
    console.log(`      ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

function save(state) {
    fs.writeFileSync(RECORD, `${JSON.stringify(state, null, 2)}\n`);
}

function record() {
    const existing = readJson(RECORD);
    return {
        chainId: CHAIN_ID,
        deployer: null,
        kept: {},
        retired: {},
        contracts: {},
        done: [],
        ...existing,
    };
}

/** A raw `eth_call` so a revert's *data* is readable — ethers hides the custom error behind an exception. */
async function rawCall(to, data, from) {
    const response = await fetch(RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_call',
            params: [{ from, to, data }, 'latest'],
        }),
    });
    const body = await response.json();
    return {
        result: body.result || null,
        revert: body.error ? (body.error.data || null) : null,
        message: body.error ? body.error.message : null,
    };
}

/** Which of the two ERC-20 errors a revert carried, and who it named. */
function classifyRevert(revert) {
    if (!revert || revert.length < 10) return { kind: 'unknown', selector: revert || null };
    const selector = revert.slice(0, 10);
    // The two errors carry the same three words in different orders, and getting them the wrong way
    // round is how a correct revert reads as a wrong one:
    //     ERC20InsufficientBalance(address sender,    uint256 balance,   uint256 needed)
    //     ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)
    // Note that an allowance error names the **spender** — the party asking — and never the owner
    // whose approval is missing, so the payer has to be inferred from which contract was called.
    const [who, a, b] = ethers.utils.defaultAbiCoder.decode(['address', 'uint256', 'uint256'], `0x${revert.slice(10)}`);
    if (selector === ERC20_BALANCE) return { kind: 'balance', who, had: a, needed: b };
    if (selector === ERC20_ALLOWANCE) return { kind: 'allowance', who, allowance: a, needed: b };
    return { kind: 'other', selector };
}

// ------------------------------------------------------------------------------ what stays
/**
 * The addresses this redeploy does **not** touch, and the ones it retires.
 *
 * `.env.local` wins over the deploy record, because the environment is what production actually
 * uses; the record is the fallback for a checkout that has never been deployed.
 */
function addresses() {
    const phase2 = readJson(PHASE2).contracts || {};
    const from = (envName, key) => {
        const value = env(envName);
        if (!value) return phase2[key] || null;
        return value;
    };
    return {
        kept: {
            token: from('DNG_TOKEN_ADDRESS', 'token'),
            vault: from('REWARD_VAULT', 'vault'),
            genesis: from('GENESIS_NFT', 'genesis'),
            genesisStaking: from('GENESIS_STAKING', 'genesisStaking'),
        },
        retired: {
            knights: from('KNIGHT_NFT_ADDRESS', 'knights'),
            capsules: from('CAPSULE_NFT', 'capsules'),
            raffle: from('RAFFLE_CONTRACT', 'raffle'),
            knightsStaking: from('KNIGHTS_STAKING', 'knightsStaking'),
            game: from('GAME_CONTRACT_V4', 'game'),
        },
    };
}

/** The backend signer the live game already trusts, so rotating it is not part of this deploy. */
function backendSigner(wallet) {
    const key = env('GAME_SIGNER_PRIVATE_KEY');
    if (key) {
        const derived = new ethers.Wallet(key).address;
        return { address: env('SIGNER_ADDRESS') || derived, source: 'GAME_SIGNER_PRIVATE_KEY' };
    }
    return { address: env('SIGNER_ADDRESS') || wallet.address, source: 'the deployer key' };
}

// -------------------------------------------------------------------------------- the steps
function steps(artifacts, ctx) {
    const { reward, staking, knights: knightTable } = ctx.config;
    const tiers = Object.values(knightTable.RARITY);
    const order = Object.keys(knightTable.RARITY);

    const deploy = async (factory, args) => {
        const contract = await factory.deploy(...args);
        await contract.deployed();
        return contract;
    };
    const factoryOf = (name, wallet) =>
        new ethers.ContractFactory(artifacts[name].abi, artifacts[name].evm.bytecode.object, wallet);

    return [
        {
            key: 'knights',
            contract: 'Knights',
            title: 'Knights (repaired — summon() pulls the player’s DNG)',
            async run(state, wallet) {
                const contract = await deploy(factoryOf('Knights', wallet), [state.kept.token, state.kept.vault]);
                return contract.address;
            },
            async verify(contract, state) {
                let tableOk = true;
                const rows = [];
                for (let i = 0; i < tiers.length; i++) {
                    const power = await contract.rarityHashPower(i);
                    const drop = await contract.tierDropBps(i);
                    rows.push(`${order[i].toLowerCase()} ${power}hp/${drop}bps`);
                    tableOk = tableOk
                        && power === tiers[i].hashPower
                        && drop === Math.round(tiers[i].dropRate * 10000)
                        && (await contract.rarityReward(i)).toString() === wei(tiers[i].dungeonReward).toString()
                        && (await contract.dailyCap(i)) === tiers[i].dailyRuns;
                }
                check('the five-tier table matches lib/knights.js on the new collection', tableOk, rows.join('  '));
                check('the summon price is the published 500 DNG', eq(await contract.SUMMON_PRICE(), wei(500)));
                check('it pays into the same vault', (await contract.rewardVault()).toLowerCase() === state.kept.vault.toLowerCase());
                check('it uses the same token', (await contract.dngToken()).toLowerCase() === state.kept.token.toLowerCase());
                // State-aware, for the same reason the raffle check below is: `--summon` mints into
                // this contract, so "it starts empty" is only the correct expectation before that.
                const expectedSupply = state.summoned ? 1 : 0;
                check(state.summoned ? 'it holds exactly the knight this run minted' : 'it starts empty',
                    eq(await contract.totalSupply(), expectedSupply), String(await contract.totalSupply()));
                let ceiling = 'none';
                try {
                    await contract.MAX_SUPPLY();
                    ceiling = 'MAX_SUPPLY exists';
                } catch { /* expected: the collection is published as unlimited */ }
                check('no supply ceiling on the summonable collection', ceiling === 'none', ceiling);
            },
        },
        {
            key: 'capsules',
            contract: 'Capsules',
            title: 'Capsules (repaired — open() pulls the player’s DNG)',
            async run(state, wallet) {
                const uri = env('CAPSULE_URI') || `${SITE}/api/metadata/capsule/{id}.json`;
                const contract = await deploy(factoryOf('Capsules', wallet), [
                    state.kept.token, state.kept.vault, state.contracts.knights, uri,
                ]);
                return contract.address;
            },
            async verify(contract, state) {
                const anchor = await contract.PRICE_ANCHOR();
                check('the ramp anchor is the published reference size',
                    eq(anchor, staking.KNIGHTS_REFERENCE_SIZE), String(anchor));

                // The ends of the ramp, from `lib/reward-config.js` — the same function the tokenomics
                // page calls, at zero and at the reference size, where it is exact rather than a
                // fraction of a DNG.
                const publishedBase = reward.capsuleOpenPrice(0, staking.KNIGHTS_REFERENCE_SIZE);
                const publishedTop = reward.capsuleOpenPrice(staking.KNIGHTS_REFERENCE_SIZE, staking.KNIGHTS_REFERENCE_SIZE);
                check('the ramp is the published 500 -> 5,000 DNG',
                    eq(await contract.OPEN_PRICE_BASE(), wei(publishedBase))
                    && eq(await contract.OPEN_PRICE_TOP(), wei(publishedTop)),
                    `${ethers.utils.formatEther(await contract.OPEN_PRICE_BASE())} -> ${ethers.utils.formatEther(await contract.OPEN_PRICE_TOP())}`);

                // **The open price is a function of how full the collection is, so it is checked
                // against the size right now** rather than against 500. `--summon` mints a knight,
                // which moves this price, and a check that only knew the empty-collection value
                // failed on every re-run — the same false-failure the raffle check below avoids.
                const minted = await (new ethers.Contract(state.contracts.knights, artifacts.Knights.abi, contract.provider)).totalSupply();
                const base = await contract.OPEN_PRICE_BASE();
                const top = await contract.OPEN_PRICE_TOP();
                const expected = minted.gte(anchor) ? top : base.add(top.sub(base).mul(minted).div(anchor));
                check('the open price is the published ramp at the collection size right now',
                    (await contract.openPrice()).toString() === expected.toString(),
                    `${ethers.utils.formatEther(await contract.openPrice())} DNG at ${minted} minted`);

                check('it mints into the new collection',
                    (await contract.knights()).toLowerCase() === state.contracts.knights.toLowerCase());
                let oddsOk = true;
                const rungs = [];
                for (let id = 1; id <= 4; id++) {
                    const [tierIdx, bpsOut, length] = await contract.odds(id);
                    const published = staking.CAPSULE_TYPES[id - 1];
                    rungs.push(`${published.name} ${length}`);
                    oddsOk = oddsOk && length === published.odds.length;
                    published.odds.forEach((row, i) => {
                        oddsOk = oddsOk && tierIdx[i] === order.indexOf(row.rarity.toUpperCase()) && bpsOut[i] === row.pct * 100;
                    });
                }
                check('all four rungs carry the published odds', oddsOk, rungs.join('  '));
                // State-aware, exactly as `tools/deploy-phase2.js` learned to be: this getter's
                // *correct* value changes during the run, so a check that only knew the first
                // state failed on every re-run — the kind of false failure that teaches people to
                // ignore a harness.
                const raffleSet = state.contracts.raffle && state.done.includes('wire-raffle-to-capsules');
                const expectedRaffle = raffleSet ? state.contracts.raffle : ethers.constants.AddressZero;
                check(raffleSet ? 'the raffle is wired to it' : 'the raffle is not wired yet',
                    (await contract.raffle()).toLowerCase() === expectedRaffle.toLowerCase(),
                    await contract.raffle());
            },
        },
        {
            key: 'raffle',
            contract: 'RaffleContract',
            title: 'RaffleContract',
            async run(state, wallet) {
                const stock = (env('RAFFLE_STOCK') || '50,50,50,50').split(',').map((n) => Number(n.trim()));
                const contract = await deploy(factoryOf('RaffleContract', wallet), [
                    state.contracts.capsules, state.kept.genesisStaking, stock,
                ]);
                return contract.address;
            },
            async verify(contract, state) {
                check('it gives away 200 capsules a week', eq(await contract.CAPSULES_PER_WEEK(), 200));
                const stock = (await contract.weeklyStock()).map((n) => Number(n));
                check('the stock split totals the published 200', stock.reduce((a, b) => a + b, 0) === 200, `[${stock.join(', ')}]`);
                check('it awards into the new capsule contract',
                    (await contract.capsules()).toLowerCase() === state.contracts.capsules.toLowerCase());
                check('it reads tickets from the same Genesis pool',
                    (await contract.ticketLedger()).toLowerCase() === state.kept.genesisStaking.toLowerCase());
            },
        },
        {
            key: 'knightsStaking',
            contract: 'KnightsStaking',
            title: 'KnightsStaking',
            async run(state, wallet) {
                const contract = await deploy(factoryOf('KnightsStaking', wallet), [state.contracts.knights, state.kept.vault]);
                return contract.address;
            },
            async verify(contract, state) {
                check('it pays vault line 3', eq(await contract.vaultLine(), 3));
                check('it holds the new collection',
                    (await contract.collection()).toLowerCase() === state.contracts.knights.toLowerCase());
                check('nobody is staked in it', eq(await contract.totalHashPower(), 0));
            },
        },
        {
            key: 'game',
            contract: 'DungeonKnightsGameV4',
            title: 'DungeonKnightsGameV4',
            async run(state, wallet) {
                const signer = backendSigner(wallet);
                console.log(`      backend signer: ${signer.address}  (from ${signer.source})`);
                const contract = await deploy(factoryOf('DungeonKnightsGameV4', wallet), [
                    state.contracts.knights, state.kept.token, signer.address,
                ]);
                state.signer = signer.address;
                return contract.address;
            },
            async verify(contract, state) {
                let tableOk = true;
                for (let i = 0; i < tiers.length; i++) {
                    tableOk = tableOk
                        && (await contract.rarityReward(i)).toString() === wei(tiers[i].dungeonReward).toString()
                        && (await contract.dailyCap(i)) === tiers[i].dailyRuns;
                }
                check('the game pays the published table', tableOk);
                check('Genesis pays a flat 300 DNG', (await contract.GENESIS_REWARD()).toString() === wei(300).toString());
                check('it validates against the new collection',
                    (await contract.knightNFT()).toLowerCase() === state.contracts.knights.toLowerCase());
                check('it pays in the same token',
                    (await contract.dngToken()).toLowerCase() === state.kept.token.toLowerCase());
                const signer = state.signer || backendSigner({ address: '0x'.padEnd(42, '0') }).address;
                check('the backend signer is the one the site already holds a key for',
                    (await contract.trustedSigner()).toLowerCase() === signer.toLowerCase(),
                    await contract.trustedSigner());
            },
        },

        // ------------------------------------------------------------------------ the wiring
        {
            key: 'wire-capsules-to-knights',
            contract: 'Knights',
            readFrom: 'knights',
            title: 'Knights.setCapsules  (one time only)',
            async run(state, wallet) {
                const knights = new ethers.Contract(state.contracts.knights, artifacts.Knights.abi, wallet);
                await (await knights.setCapsules(state.contracts.capsules)).wait();
                return 'wired';
            },
            async verify(contract, state) {
                const knights = new ethers.Contract(state.contracts.knights, artifacts.Knights.abi, contract.provider);
                check('Knights now mints for the new Capsules contract',
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
                await (await capsules.setRaffle(state.contracts.raffle)).wait();
                return 'wired';
            },
            async verify(contract, state) {
                const capsules = new ethers.Contract(state.contracts.capsules, artifacts.Capsules.abi, contract.provider);
                check('Capsules now mints for the new raffle',
                    (await capsules.raffle()).toLowerCase() === state.contracts.raffle.toLowerCase());
            },
        },
        {
            key: 'wire-vault-payers',
            contract: 'RewardVault',
            readFrom: 'vault',
            title: 'RewardVault.setPayer — grant the new payers, retire the old',
            async run(state, wallet) {
                const vault = new ethers.Contract(state.kept.vault, artifacts.RewardVault.abi, wallet);

                // Retiring a line is the only destructive act in this script, so it is gated on the
                // contract answering "nobody is staked in me" — and the gate only opens on a **read**.
                // A pool that reports staked hash power keeps the right to pay it out, however
                // retired it looks from outside; a pool that cannot be read at all keeps it too,
                // because "I could not check" is not "I checked".
                const retire = [];
                if (state.retired.knightsStaking) {
                    const old = new ethers.Contract(state.retired.knightsStaking, artifacts.KnightsStaking.abi, wallet);
                    let stakedPower = null;
                    try {
                        // `totalHashPower` rather than `stakerCount`: the latter does not exist on
                        // this ABI (`stakedCount` is per wallet), and a gate that throws is a gate
                        // that never opens.
                        stakedPower = (await old.totalHashPower()).toString();
                    } catch { /* unreadable — leave its line alone */ }
                    if (stakedPower === '0') {
                        retire.push([3, state.retired.knightsStaking, 'knights staking (old pool, empty)']);
                    } else if (stakedPower === null) {
                        console.log(`      leaving line 3 with ${state.retired.knightsStaking} — the pool could not be read`);
                    } else {
                        console.log(`      keeping line 3 for ${state.retired.knightsStaking} — it reports ${stakedPower} hash power staked`);
                    }
                }
                if (state.retired.game) {
                    retire.push([0, state.retired.game, 'genesis dungeon (old game)'], [2, state.retired.game, 'knights dungeon (old game)']);
                }

                const grants = [
                    [0, state.contracts.game, 'genesis dungeon -> the new game'],
                    [2, state.contracts.game, 'knights dungeon -> the new game'],
                    [1, state.kept.genesisStaking, 'genesis staking -> genesis pool'],
                    [3, state.contracts.knightsStaking, 'knights staking -> knights pool'],
                ];
                for (const [line, payer, why] of grants) {
                    await (await vault.setPayer(line, payer, true)).wait();
                    console.log(`      granted line ${line} to ${payer}  (${why})`);
                }
                for (const [line, payer, why] of retire) {
                    await (await vault.setPayer(line, payer, false)).wait();
                    console.log(`      revoked line ${line} from ${payer}  (${why})`);
                }
                return 'wired';
            },
            async verify(contract, state) {
                check('the new game may charge line 0', await contract.canPay(0, state.contracts.game));
                check('the new game may charge line 2', await contract.canPay(2, state.contracts.game));
                check('the new knights pool may charge line 3', await contract.canPay(3, state.contracts.knightsStaking));
                check('genesis staking still charges line 1', await contract.canPay(1, state.kept.genesisStaking));
                check('the old game can no longer charge the dungeon lines',
                    !(await contract.canPay(0, state.retired.game)) && !(await contract.canPay(2, state.retired.game)));
                check('the old knights pool can no longer charge line 3',
                    !(await contract.canPay(3, state.retired.knightsStaking)));
                check('and a staking pool still cannot touch a dungeon line',
                    !(await contract.canPay(2, state.contracts.knightsStaking)));
            },
        },
        {
            key: 'wire-game-to-vault',
            contract: 'DungeonKnightsGameV4',
            readFrom: 'game',
            title: 'Game.setRewardVault + setGenesisNFT',
            async run(state, wallet) {
                const game = new ethers.Contract(state.contracts.game, artifacts.DungeonKnightsGameV4.abi, wallet);
                await (await game.setRewardVault(state.kept.vault)).wait();
                await (await game.setGenesisNFT(state.kept.genesis)).wait();
                return 'wired';
            },
            async verify(contract, state) {
                const game = new ethers.Contract(state.contracts.game, artifacts.DungeonKnightsGameV4.abi, contract.provider);
                check('the game pays from the same vault',
                    (await game.rewardVault()).toLowerCase() === state.kept.vault.toLowerCase());
                check('the game knows the same Genesis collection',
                    (await game.genesisNFT()).toLowerCase() === state.kept.genesis.toLowerCase());
            },
        },

        // ------------------------------------------------------------------ the proof
        {
            key: 'prove-the-pull',
            contract: 'Knights',
            readFrom: 'knights',
            title: 'summon() asks the player for the money — read from the chain, not from the source',
            async run() {
                return 'proven';
            },
            async verify(contract, state) {
                const wallet = state.deployer;
                const probe = await rawCall(state.contracts.knights, ethers.utils.id('summon()').slice(0, 10), wallet);
                const verdict = classifyRevert(probe.revert);
                const price = (await contract.SUMMON_PRICE()).toString();

                if (probe.result) {
                    check('summon() reaches the token transfer', true, 'it did not revert at all — already approved');
                } else if (verdict.kind === 'allowance') {
                    // The spender named in the error is the new collection and the amount is exactly
                    // the summon price: that is the collection asking for *the player's* 500 DNG
                    // through the allowance the page collects. Before the fix this same call named
                    // the collection as the party without **funds** instead.
                    check('summon() fails on the player’s missing approval, not on the collection’s funds',
                        verdict.who.toLowerCase() === state.contracts.knights.toLowerCase()
                        && verdict.needed.toString() === price,
                        `ERC20InsufficientAllowance(spender ${verdict.who}, allowance ${verdict.allowance}, needed ${verdict.needed})`);
                } else if (verdict.kind === 'balance') {
                    check('summon() collects the fee from the player', false,
                        `the vault still asks ${verdict.who} for funds it does not hold — the pull is still missing`);
                } else {
                    check('summon() reverts with a recognisable ERC-20 error', false, verdict.selector || verdict.kind);
                }

                // The other half of the fix cannot be probed this way: `open()` burns capsules before it
                // takes the fee, and no capsule has ever been minted (the raffle needs staked Genesis).
                // It is guarded in source instead, by `tools/check-contracts.js`.
                console.log('      note  Capsules.open() cannot be probed on chain — no capsule exists to burn.');
                console.log('            tools/check-contracts.js asserts the same pull for it in source.');
            },
        },
    ];
}

// ----------------------------------------------------------------------------- the real mint
/**
 * One knight, summoned for real, at the end of an optional step.
 *
 * This is the only part of the script that spends anything: 500 DNG (into the vault, which is a
 * deposit against the claims the knight can make, not a fee) plus gas. It is off by default and
 * runs only with `--summon`, because a script that mints on every invocation is a script nobody
 * can safely re-run.
 */
async function summonOne(artifacts, state, wallet) {
    console.log('  summoning one knight, for real');
    const knights = new ethers.Contract(state.contracts.knights, artifacts.Knights.abi, wallet);
    const token = new ethers.Contract(state.kept.token, artifacts.DNGToken.abi, wallet);
    const price = await knights.SUMMON_PRICE();

    if ((await token.allowance(wallet.address, state.contracts.knights)).lt(price)) {
        console.log(`      approving ${ethers.utils.formatEther(price)} DNG to ${state.contracts.knights}`);
        await (await token.approve(state.contracts.knights, price)).wait();
    }

    // **The gas estimate for `summon()` is not a safe limit, and that is not a guess.** The mint
    // writes `rarityOf[tokenId] = rarity`, and a roll of Common (tier 0) makes that an SSTORE of
    // zero into a zero slot — about 20,000 gas cheaper than any other tier. `eth_estimateGas` runs
    // against *one* block's randomness, so an estimate taken when the draw is Common can be 20k
    // under the cost of a transaction that lands on Uncommon or better, and the transaction then
    // reverts out of gas (`status 0`, `gasUsed == gasLimit`) having paid for it. The first real
    // summon this script sent died exactly that way. A buffer is the fix; a fixed limit would have
    // to be sized for the worst case and overpay on every Common.
    const estimate = await knights.estimateGas.summon();
    const gasLimit = estimate.mul(130).div(100);
    console.log(`      gas       estimate ${estimate.toString()} -> limit ${gasLimit.toString()} (+30% for the tier write)`);

    const before = await token.balanceOf(state.kept.vault);
    const tx = await knights.summon({ gasLimit });
    const receipt = await tx.wait();
    const after = await token.balanceOf(state.kept.vault);

    const supply = await knights.totalSupply();
    const tokenId = supply.toNumber();
    const [owner, rarity, rarityName] = await knights.getKnightInfo(tokenId);
    const power = await knights.hashPowerOfToken(tokenId);

    console.log(`      tx        ${receipt.transactionHash}  (block ${receipt.blockNumber}, gas ${receipt.gasUsed.toString()})`);
    console.log(`      knight    #${tokenId}  ${rarityName}  ${power} hp`);
    console.log(`      owner     ${owner}  ${owner.toLowerCase() === wallet.address.toLowerCase() ? '(the summoning wallet)' : '(!! unexpected)'}`);
    console.log(`      vault     ${ethers.utils.formatEther(before)} -> ${ethers.utils.formatEther(after)} DNG`);

    check('the summoning wallet owns the knight', owner.toLowerCase() === wallet.address.toLowerCase());
    check('the vault received the 500 DNG', after.sub(before).eq(price), `${ethers.utils.formatEther(after.sub(before))} DNG`);
    check('the collection now holds exactly what it minted', eq(supply, 1));
    check('the knight carries a tier from the published table', Number(rarity) < 5 && Number(power) > 0, `${rarityName} ${power}hp`);

    state.summoned = { tokenId, rarityName, hashPower: Number(power), tx: receipt.transactionHash };
    return true;
}

// ------------------------------------------------------------------------------------ main
async function main() {
    const argv = process.argv.slice(2);
    const listOnly = argv.includes('--list');
    const verifyOnly = argv.includes('--verify');
    const wantSummon = argv.includes('--summon');

    const privateKey = env('PRIVATE_KEY');
    if (!privateKey) {
        console.error('PRIVATE_KEY is not set in .env.local — nothing to deploy with.');
        process.exit(1);
    }

    const provider = new ethers.providers.JsonRpcProvider(RPC, CHAIN_ID);
    const wallet = new ethers.Wallet(privateKey, provider);
    const artifacts = compile();
    const config = await economy();
    const state = record();
    const { kept, retired } = addresses();

    state.deployer = wallet.address;
    state.chainId = CHAIN_ID;
    state.kept = kept;
    state.retired = retired;

    console.log('');
    console.log('Dungeon Knights — redeploy for the mint fix');
    console.log(`  ${RPC} (chain ${CHAIN_ID})`);
    console.log(`  deployer ${wallet.address}`);

    if (listOnly) {
        console.log(`  balance  ${ethers.utils.formatEther(await provider.getBalance(wallet.address))} ETH`);
        console.log('');
        console.log('  stays exactly where it is');
        for (const [key, value] of Object.entries(kept)) console.log(`      ${key.padEnd(16)} ${value}`);
        console.log('');
        console.log('  retired by this deploy (nothing points at them afterwards)');
        for (const [key, value] of Object.entries(retired)) console.log(`      ${key.padEnd(16)} ${value}`);
        console.log('');
        console.log('  deploys, in this order');
        console.log('      1  Knights(token, vault)                    repaired: pulls the summon fee from the caller');
        console.log('      2  Capsules(token, vault, knights, uri)     repaired: pulls the open fee from the caller');
        console.log('      3  RaffleContract(capsules, genesisStaking, stock)');
        console.log('      4  KnightsStaking(knights, vault)           vault line 3');
        console.log('      5  DungeonKnightsGameV4(knights, token, signer)');
        console.log('      then  setCapsules, setRaffle, four setPayer grants, two revocations, setRewardVault, setGenesisNFT');
        console.log('');
        console.log(`  records  ${path.relative(ROOT, RECORD)}`);
        return;
    }

    console.log(`  balance  ${ethers.utils.formatEther(await provider.getBalance(wallet.address))} ETH`);
    console.log('');

    const all = steps(artifacts, { config });
    for (const step of all) {
        const recorded = state.contracts[step.key];
        failures = 0;
        console.log(`  ${step.title}`);

        let address = recorded;
        if (!verifyOnly && !recorded) {
            try {
                address = await step.run(state, wallet);
            } catch (error) {
                console.log(`      FAIL  deploy reverted: ${String(error.message).slice(0, 200)}`);
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

        // A wiring step acts on a contract that may be one of *ours* this run (`contracts`) or one
        // that stayed put (`kept`) — the vault-payer step is the latter. Both maps are searched so
        // a step never has to know which half of the set it is touching, and the two halves have
        // no keys in common, so the order cannot matter.
        const readAddress = step.readFrom
            ? (state.contracts[step.readFrom] || state.kept[step.readFrom])
            : address;
        const contract = new ethers.Contract(readAddress, artifacts[step.contract].abi, wallet);
        try {
            await step.verify(contract, state);
        } catch (error) {
            console.log(`      FAIL  verify threw: ${String(error.message).slice(0, 200)}`);
            failures += 1;
        }
        console.log('');
        if (failures) {
            console.log(`  ${failures} check(s) failed at ${step.key} — stopping so it can be read.`);
            save(state);
            process.exit(1);
        }
    }

    if (wantSummon && !state.summoned) {
        failures = 0;
        try {
            await summonOne(artifacts, state, wallet);
        } catch (error) {
            console.log(`      FAIL  the summon reverted: ${String(error.message).slice(0, 200)}`);
            save(state);
            process.exit(1);
        }
        console.log('');
        // A summon whose checks failed must not reach "every step done and verified" — the record
        // would then describe a mint that did not happen the way it says it did.
        if (failures) {
            save(state);
            console.log(`  ${failures} check(s) failed while summoning — the knight may exist, but not as described.`);
            process.exit(1);
        }
    }

    save(state);

    console.log('  every step done and verified.');
    console.log('');
    console.log('  the new set');
    for (const [key, value] of Object.entries(state.contracts)) {
        console.log(`      ${key.padEnd(18)} ${value}`);
    }
    console.log('');
    console.log('  unchanged');
    for (const [key, value] of Object.entries(kept)) {
        console.log(`      ${key.padEnd(18)} ${value}`);
    }
    console.log('');
    console.log('  environment for the site (Vercel -> project settings -> environment variables)');
    console.log(`      DNG_TOKEN_ADDRESS      ${kept.token}          (unchanged)`);
    console.log(`      REWARD_VAULT           ${kept.vault}          (unchanged)`);
    console.log(`      GENESIS_NFT            ${kept.genesis}          (unchanged)`);
    console.log(`      GENESIS_STAKING        ${kept.genesisStaking}          (unchanged)`);
    console.log(`      KNIGHT_NFT_ADDRESS     ${state.contracts.knights}   <- changed`);
    console.log(`      CAPSULE_NFT            ${state.contracts.capsules}   <- changed`);
    console.log(`      RAFFLE_CONTRACT        ${state.contracts.raffle}   <- changed`);
    console.log(`      KNIGHTS_STAKING        ${state.contracts.knightsStaking}   <- changed`);
    console.log(`      GAME_CONTRACT_V4       ${state.contracts.game}   <- changed`);
    console.log('');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
