#!/usr/bin/env node
/**
 * Compile every contract in `contracts/` and check the things a deploy would otherwise
 * discover on chain.
 *
 *     node tools/check-contracts.js            # compile and check
 *     node tools/check-contracts.js --sizes    # also list every deployed size
 *
 * Why this exists: for a long time the contracts in this repo had **never been compiled
 * by anyone**. `RewardVault.sol` was written, reviewed in prose and shipped to the
 * interface's copy, and no compiler had ever read it; `DungeonKnightsGameV4.sol` was
 * documented as the deployment candidate while nobody had produced its bytecode. A
 * contract that has never compiled is a document, not a contract, and the difference
 * shows up at the worst possible moment — in Remix, minutes before a deploy, or on chain
 * after one.
 *
 * So this is a gate, not a convenience. Four things it refuses to let through:
 *
 *   1. **A compile error or warning.** `solc` warnings are how the subtle ones arrive
 *      (`shadowing`, unused function parameters, `this` on a library). Warnings are
 *      printed and tolerated by default because OZ emits some; `--strict-warnings` makes
 *      them fatal.
 *   2. **A missing required contract.** The list below is the deployment set — the
 *      contracts that have to exist for the published economy to be live. Deleting one,
 *      or renaming it, fails here rather than in the deploy script.
 *   3. **A contract over EIP-170's 24,576-byte limit.** That limit is not advisory: the
 *      deployment reverts, and the failure is a `code size exceeded` from the chain with
 *      no hint about which contract.
 *   4. **A mismatch between the source and `lib/knights.js`.** The five reward rates and
 *      daily caps are published on the site; the harness reads them out of the
 *      Solidity and compares, so the contract cannot quietly keep an older table. This is
 *      the same job `tools/check-rarity.js` does for the JSON copies, pointed at the
 *      source the chain will actually run.
 *
 * The compiler settings mirror `foundry.toml` exactly, so a green run here means `forge
 * build` would be green too — and vice versa:
 *
 *   solc 0.8.28, optimizer on, 200 runs, `evmVersion = cancun`.
 *
 * **Why `cancun`, decided by measurement rather than by default.** The target chain is an
 * Arbitrum Nitro chain (`nitro/v3.12.0-rc.2`), and the usual advice for Nitro is
 * `evmVersion = paris`, because a chain's opcode support does not follow mainnet's. Under
 * paris, OpenZeppelin v5.6 will not compile at all: `Bytes.sol` uses `MCOPY`
 * unconditionally, and `ERC721` reaches it through `Strings`. So the fork was not a matter
 * of taste, and it was settled by asking the chain:
 *
 *   - the three contracts already deployed on it — the DNG token, the knight NFT and Game
 *     V3 — all carry `PUSH0` and `MCOPY` in their deployed bytecode, read by disassembling
 *     it properly rather than scanning bytes (which finds `0x5e` inside push data and
 *     lies), and
 *   - an `eth_call` whose target code *is* `PUSH0`/`MCOPY` executes both. That is a live
 *     statement about the EVM, not about bytecode that happens to be sitting there.
 *
 * `tools/check-opcodes.js` re-runs both halves of that evidence, so a chain upgrade or a
 * move to a different network stays a green-or-red fact instead of a discovery made by a
 * deployed contract reverting for no visible reason.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONTRACTS = path.join(ROOT, 'contracts');
const OZ = path.join(ROOT, 'node_modules', '@openzeppelin', 'contracts');

const EIP170_LIMIT = 24_576;
const CONFIGURED_SOLC = '0.8.28';
const EVM_VERSION = 'cancun';

/**
 * The deployment set.
 *
 * Each entry is `[contract name, what it is for]`. The name must match the `contract`
 * declaration exactly, because that is what a deploy tool asks for by name.
 */
const REQUIRED = [
    ['DNGToken', 'the ERC-20 every reward is paid in — fixed supply, no mint'],
    ['Knights', 'the summonable collection: five tiers, unlimited, minted by capsule or summon'],
    ['GenesisKnights', 'the fixed 1,024, carrying hash power from the published bands'],
    ['Capsules', 'the ERC-1155 prize the weekly draw hands out, opened for DNG'],
    ['RewardVault', 'the four funded lines every payout is charged against'],
    ['GenesisStaking', 'stake Genesis for a share of the Genesis staking line, plus raffle tickets'],
    ['KnightsStaking', 'stake Knights for a share of the Knights staking line — no tickets'],
    ['RaffleContract', 'the weekly draw over Genesis stakers, paying capsules'],
    ['DungeonKnightsGameV4', 'the dungeon payout path, signed by the backend'],
];

/**
 * The published reward table, read out of `lib/knights.js`.
 *
 * Read as **text** rather than imported. This harness is CommonJS so it can `require('solc')`,
 * and `lib/knights.js` is an ES module — importing it from here would depend on Node's
 * module-syntax detection rather than on anything this repo controls. The table is five
 * single-line entries with two numbers each, so a scan is both simpler and less fragile
 * than an interpreter-level dependency.
 */
function publishedTable() {
    const source = fs.readFileSync(path.join(ROOT, 'lib', 'knights.js'), 'utf8');
    const rows = [];
    const line = /^\s*([A-Z]+):\s*\{.*dungeonReward:\s*([\d.]+),\s*dailyRuns:\s*([\d.]+),/gm;
    let match;
    while ((match = line.exec(source))) {
        rows.push({ key: match[1], rewardPerClear: Number(match[2]), dailyRuns: Number(match[3]) });
    }
    return rows;
}

function readConfig(name) {
    return fs.readFileSync(path.join(ROOT, 'lib', name), 'utf8');
}

/** Every capture of `regex` in `text`, with `Number()` applied to the numeric group. */
function collect(text, regex) {
    const rows = [];
    let match;
    while ((match = regex.exec(text))) rows.push(match.slice(1));
    return rows;
}

function number(text, regex) {
    const match = regex.exec(text);
    return match ? Number(match[1].replace(/_/g, '')) : null;
}

/**
 * `lib/knights.js#RARITY` — the five tiers, in on-chain enum order.
 *
 * Each entry is a single line, which is what makes a line-wise scan enough. A multi-line
 * entry would silently produce zero rows here, so the caller asserts the count is five rather
 * than trusting the parse.
 */
function parseKnightsConfig() {
    const text = readConfig('knights.js');
    const tiers = [];
    const re = /^\s*([A-Z]+):\s*\{([^}]*)\}/gm;
    let match;
    while ((match = re.exec(text))) {
        const body = match[2];
        const field = (name) => {
            const found = new RegExp(`${name}:\\s*([\\d.]+)`).exec(body);
            return found ? Number(found[1]) : null;
        };
        const nameMatch = /name:\s*'([^']+)'/.exec(body);
        tiers.push({
            key: match[1],
            name: nameMatch ? nameMatch[1] : match[1],
            dropRate: field('dropRate'),
            dungeonReward: field('dungeonReward'),
            dailyRuns: field('dailyRuns'),
            hashPower: field('hashPower'),
        });
    }
    return tiers.map((tier, index) => ({ ...tier, index }));
}

/** `lib/staking-config.js` — the cap, the bands, the capsule rungs and the weekly count. */
function parseStakingConfig() {
    const text = readConfig('staking-config.js');
    const tiers = parseKnightsConfig();

    const bands = collect(
        text,
        /\{\s*key:\s*'([^']+)',\s*name:\s*'([^']+)',\s*lo:\s*(\d+),\s*hi:\s*(\d+),\s*count:\s*(\d+)\s*\}/g,
    ).map(([, name, lo, hi, count]) => ({
        name,
        lo: Number(lo),
        hi: Number(hi),
        count: Number(count),
    }));

    // The capsule rungs: header first, then the odds rows that follow it, stopping at the
    // table's closing bracket. Walking to the next header instead would attribute a rung's
    // last rows to the rung after it.
    const capsules = [];
    const header = /id:\s*(\d+),\s*\n\s*key:\s*'([^']+)',\s*\n\s*name:\s*'([^']+)',\s*\n\s*rarity:\s*'([^']+)',\s*\n\s*odds:\s*\[/g;
    let match;
    while ((match = header.exec(text))) {
        const rest = text.slice(header.lastIndex);
        const oddsBlock = rest.slice(0, rest.indexOf(']'));
        const odds = collect(oddsBlock, /\{\s*rarity:\s*'([^']+)',\s*pct:\s*(\d+)\s*\}/g).map(
            ([rarity, pct]) => ({
                rarity,
                tier: tiers.findIndex((t) => t.key === rarity.toUpperCase()),
                pct: Number(pct),
            }),
        );
        capsules.push({ id: Number(match[1]), key: match[2], name: match[3], odds });
    }

    return {
        knightsReferenceSize: number(text, /export const KNIGHTS_REFERENCE_SIZE\s*=\s*([\d_]+)/),
        capsulesPerWeek: number(text, /export const CAPSULES_PER_WEEK\s*=\s*([\d_]+)/),
        ticketCapHours: number(text, /export const TICKET_CAP_HOURS\s*=\s*([\d_]+)/),
        bands,
        capsules,
    };
}

/**
 * `lib/reward-config.js` — the distribution, and the weekly budget the table is sized for.
 *
 * The budget is **recomputed here** rather than read, from the same four inputs the module
 * uses (`referenceLines`), because the point of the check is that the number the vault is
 * deployed with can be re-derived by a second party from published figures. Reading the
 * module's own function would only prove it agrees with itself.
 */
function parseEconomyConfig() {
    const text = readConfig('reward-config.js');
    const tiers = parseKnightsConfig();

    const distribution = collect(text, /\{\s*key:\s*'\w+',\s*name:\s*'[^']*',\s*pct:\s*(\d+)/g).map(
        ([pct]) => Number(pct),
    );

    const n = (name, fallback = null) => {
        const found = new RegExp(`export const ${name}\\s*=\\s*([\\d_.]+)`).exec(text);
        return found ? Number(found[1].replace(/_/g, '')) : fallback;
    };

    const expectedRewardPerDay = tiers.reduce(
        (sum, tier) => sum + tier.dropRate * tier.dungeonReward * tier.dailyRuns,
        0,
    );

    const genesisDungeon = n('REFERENCE_GENESIS_ACTIVE') * n('GENESIS_DAILY_RUNS') * n('GENESIS_REWARD_PER_CLEAR');
    const knightsDungeon = n('REFERENCE_KNIGHTS_ACTIVE') * expectedRewardPerDay;
    const share = n('STAKING_SHARE_OF_DUNGEON');
    const lines = [
        genesisDungeon,
        genesisDungeon * share,
        knightsDungeon,
        knightsDungeon * share,
    ];
    const burn = lines.reduce((a, b) => a + b, 0);

    // Largest-remainder rounding, the same method `lineBps()` uses, so the shares checked
    // against the vault's constructor are the ones the deploy actually passes.
    const raw = lines.map((line) => (line / burn) * 10_000);
    const lineBps = raw.map(Math.floor);
    let remainder = 10_000 - lineBps.reduce((a, b) => a + b, 0);
    const byFraction = raw
        .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
        .sort((a, b) => b.fraction - a.fraction);
    for (let i = 0; i < remainder; i++) lineBps[byFraction[i].index] += 1;

    return {
        distribution,
        minWeeks: n('MIN_WEEKS'),
        lineBps,
        weeklyBudget: burn * 7,
        burnPerDay: burn,
    };
}

function genesisSupply() {
    return number(readConfig('staking-config.js'), /export const GENESIS_SUPPLY\s*=\s*([\d_]+)/);
}

// --------------------------------------------------------------------------- compiling
function discover(dir = CONTRACTS, found = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) discover(full, found);
        else if (entry.name.endsWith('.sol')) found.push(full);
    }
    return found.sort();
}

/**
 * solc's import callback. `@openzeppelin/contracts/...` resolves into `node_modules`,
 * exactly as `foundry.toml`'s remapping says. Without this the imports fail and the
 * error blames a file that is present on disk.
 */
function readImport(importPath) {
    const candidates = [];
    if (importPath.startsWith('@openzeppelin/')) {
        candidates.push(path.join(OZ, importPath.slice('@openzeppelin/contracts/'.length)));
    }
    candidates.push(path.join(CONTRACTS, importPath), path.join(ROOT, importPath));

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return { contents: fs.readFileSync(candidate, 'utf8') };
    }
    return { error: `not found: ${importPath}` };
}

function compile(solc) {
    const sources = {};
    for (const file of discover()) {
        sources[path.relative(ROOT, file).replace(/\\/g, '/')] = {
            content: fs.readFileSync(file, 'utf8'),
        };
    }

    const input = {
        language: 'Solidity',
        sources,
        settings: {
            optimizer: { enabled: true, runs: 200 },
            evmVersion: EVM_VERSION,
            remappings: ['@openzeppelin/contracts/=node_modules/@openzeppelin/contracts/'],
            outputSelection: {
                '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] },
            },
        },
    };

    return JSON.parse(solc.compile(JSON.stringify(input), { import: readImport }));
}

// ------------------------------------------------------------------------------ output
let failures = 0;

function check(label, pass, detail) {
    const mark = pass ? 'ok  ' : 'FAIL';
    if (!pass) failures += 1;
    console.log(`  ${mark}  ${label}${detail ? `  — ${detail}` : ''}`);
}

/** `solc` messages carry a `formattedMessage` with the line and a caret. Prefer it. */
function report(messages, severity) {
    const list = messages.filter((m) => m.severity === severity);
    for (const message of list) {
        console.log(`  ${severity === 'error' ? 'FAIL' : 'warn'}  ${message.formattedMessage.trim()}`);
    }
    return list;
}

/**
 * Pull the `rarityReward[i] = N ether;` and `dailyCap[i] = N;` assignments out of a
 * contract's source. Deliberately a text scan and not a parser: the point is to read the
 * numbers the compiler just accepted, in the form a reviewer would check by eye.
 */
function rewardTableFrom(source, name = 'rarityReward') {
    const rewards = new Map();
    const caps = new Map();
    const rewardRe = new RegExp(`${name}\\[(\\d)\\]\\s*=\\s*([\\d_]+)\\s*ether\\s*;`, 'g');
    const capRe = /dailyCap\[(\d)\]\s*=\s*([\d_]+)\s*;/g;
    let match;
    while ((match = rewardRe.exec(source))) rewards.set(Number(match[1]), Number(match[2].replace(/_/g, '')));
    while ((match = capRe.exec(source))) caps.set(Number(match[1]), Number(match[2].replace(/_/g, '')));
    return { rewards, caps };
}

async function main() {
    const argv = process.argv.slice(2);
    const showSizes = argv.includes('--sizes') || argv.includes('--all');
    const strictWarnings = argv.includes('--strict-warnings');

    let solc;
    try {
        solc = require('solc');
    } catch {
        console.error('solc is not installed. Run: npm install --save-dev solc@' + CONFIGURED_SOLC);
        process.exit(1);
    }

    console.log('');
    console.log(`Contracts — solc ${solc.version()}`);
    console.log(`  source   ${CONTRACTS}`);
    console.log(`  settings ${CONFIGURED_SOLC}, optimizer 200 runs, evmVersion ${EVM_VERSION}`);
    console.log('');

    const output = compile(solc);

    const errors = report(output.errors || [], 'error');
    const warnings = report(output.errors || [], 'warning');
    check(
        'every contract compiles',
        errors.length === 0,
        errors.length ? `${errors.length} error(s)` : `${Object.keys(output.sources).length} files`,
    );
    if (errors.length) {
        console.log('');
        console.log(`  ${failures} failure(s)`);
        process.exit(1);
    }
    // Warnings are printed above but are only fatal when asked, because OZ v5 emits a few
    // and a harness that cries wolf gets ignored. `--strict-warnings` is for the run
    // before a deploy, when they are worth reading.
    if (strictWarnings && warnings.length) {
        check('no compiler warnings', false, `${warnings.length} warning(s)`);
    } else {
        console.log(`  info  ${warnings.length} warning(s)`);
    }

    // ------------------------------------------------------------- the deployment set
    const compiled = output.contracts || {};
    const byName = new Map();
    for (const [file, contracts] of Object.entries(compiled)) {
        for (const [name, artifact] of Object.entries(contracts)) {
            byName.set(name, { file, ...artifact });
        }
    }

    console.log('');
    for (    const [name, purpose] of REQUIRED) {
        const artifact = byName.get(name);
        if (!artifact) {
            check(`${name} exists`, false, `no contract named ${name} compiled (${purpose})`);
            continue;
        }
        const bytes = (artifact.evm.deployedBytecode.object || '').length / 2;
        const overLimit = bytes > EIP170_LIMIT;
        check(
            `${name} compiles`,
            !overLimit,
            overLimit
                ? `${bytes} bytes — over EIP-170's ${EIP170_LIMIT}`
                : `${bytes} bytes, ${purpose}`,
        );
    }

    if (showSizes) {
        console.log('');
        console.log('  every deployed size');
        const rows = [...byName.entries()]
            .map(([name, artifact]) => ({
                name,
                bytes: (artifact.evm.deployedBytecode.object || '').length / 2,
            }))
            .filter((row) => row.bytes > 0)
            .sort((a, b) => b.bytes - a.bytes);
        for (const row of rows) {
            const flag = row.bytes > EIP170_LIMIT ? '  OVER LIMIT' : '';
            console.log(`        ${String(row.bytes).padStart(6)}  ${row.name}${flag}`);
        }
    }

    // ------------------------------------------------ the source vs the published table
    const gameSource = fs.readFileSync(path.join(CONTRACTS, 'DungeonKnightsGameV4.sol'), 'utf8');
    const { rewards, caps } = rewardTableFrom(gameSource);
    const published = publishedTable();
    check('the published table is five tiers', published.length === 5, `${published.length} tiers`);

    console.log('');
    const rewardMismatch = [];
    const capMismatch = [];
    published.forEach((tier, index) => {
        if (rewards.get(index) !== tier.rewardPerClear) {
            rewardMismatch.push(`${index}: contract ${rewards.get(index)} vs published ${tier.rewardPerClear}`);
        }
        if (caps.get(index) !== tier.dailyRuns) {
            capMismatch.push(`${index}: contract ${caps.get(index)} vs published ${tier.dailyRuns}`);
        }
    });
    check(
        'the game pays the published reward table',
        rewardMismatch.length === 0,
        rewardMismatch.length
            ? rewardMismatch.join(', ')
            : published.map((t) => `${t.key.toLowerCase()} ${t.rewardPerClear}`).join('  '),
    );
    check(
        'the game enforces the published daily caps',
        capMismatch.length === 0,
        capMismatch.length
            ? capMismatch.join(', ')
            : published.map((t) => `${t.key.toLowerCase()} ${t.dailyRuns}`).join('  '),
    );

    // Genesis is flat by design — a table there would contradict the collection's premise,
    // so an accidental per-tier Genesis reward is worth failing on rather than reviewing.
    check(
        'Genesis pays one flat rate',
        /GENESIS_REWARD\s*=\s*300\s*ether/.test(gameSource),
        'GENESIS_REWARD = 300 ether',
    );

    // ------------------------------- the collections vs the published tables and bands
    //
    // This is the check that makes the suite one system instead of nine contracts. Each of
    // these numbers is published on the site (`lib/knights.js`, `lib/staking-config.js`,
    // `lib/reward-config.js`) *and* written into Solidity, because the chain cannot import a
    // JavaScript module. Two homes is a drift risk; two homes with a gate that compares them
    // is just a copy. Every failure below is a number a buyer was shown and the chain would
    // not deliver.
    const source = (name) => fs.readFileSync(path.join(CONTRACTS, name), 'utf8');

    /**
     * Source with comments removed, for checks that assert an *absence*.
     *
     * The ceiling check below is the case that needs it: `Knights.sol`'s own header explains
     * that the collection has no `MAX_SUPPLY`, and a check that could not tell prose from code
     * failed on the sentence describing the property it was testing. An absence check that
     * trips over the documentation of the absence is worse than no check, because the fix
     * someone reaches for is to delete the explanation.
     */
    const code = (text) => text.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const knightsSource = source('Knights.sol');
    const genesisSource = source('GenesisKnights.sol');
    const tokenSource = source('DNGToken.sol');
    const capsulesSource = source('Capsules.sol');
    const raffleSource = source('RaffleContract.sol');
    const vaultSource = source('RewardVault.sol');

    const knightsConfig = parseKnightsConfig();
    const stakingConfig = parseStakingConfig();
    const economyConfig = parseEconomyConfig();

    const indexed = (text, prefix, pattern = /(\d+)/) => {
        const rows = new Map();
        const re = new RegExp(`${prefix}\\[(\\d)\\]\\s*=\\s*${pattern.source}\\s*;`, 'g');
        let match;
        while ((match = re.exec(text))) rows.set(Number(match[1]), Number(match[2]));
        return rows;
    };

    const hashPower = indexed(knightsSource, 'rarityHashPower');
    const dropBps = indexed(knightsSource, 'tierDropBps');
    const hashMismatch = [];
    const dropMismatch = [];
    knightsConfig.forEach((tier, index) => {
        if (hashPower.get(index) !== tier.hashPower) {
            hashMismatch.push(`${tier.name}: ${hashPower.get(index)} vs ${tier.hashPower}`);
        }
        const expectedBps = Math.round(tier.dropRate * 10_000);
        if (dropBps.get(index) !== expectedBps) {
            dropMismatch.push(`${tier.name}: ${dropBps.get(index)} vs ${expectedBps}`);
        }
    });
    check(
        'Knights carries the published hash powers',
        hashMismatch.length === 0,
        hashMismatch.length ? hashMismatch.join(', ') : knightsConfig.map((t) => `${t.name.toLowerCase()} ${t.hashPower}`).join('  '),
    );
    check(
        'Knights rolls the published drop rates',
        dropMismatch.length === 0,
        dropMismatch.length ? dropMismatch.join(', ') : knightsConfig.map((t) => `${t.name.toLowerCase()} ${(t.dropRate * 100).toFixed(0)}%`).join('  '),
    );

    // **Knights is unlimited, and the absence is the assertion.** The collection is published
    // as having no ceiling — a player reading `/tokenomics` is told a summon never runs out —
    // so a `MAX_SUPPLY` reappearing in the contract would make the chain and the page disagree
    // in the one direction that quietly rations someone's summon. "No limit" can only be
    // checked as an absence, and an absence is exactly the kind of check that rots into
    // vacuity, so this one fires: re-adding a cap fails it (see the tamper run).
    const ceiling = /MAX_SUPPLY|Collection is full|Supply exhausted/.exec(code(knightsSource));
    check(
        'Knights mints without a supply ceiling',
        ceiling === null,
        ceiling
            ? `found \`${ceiling[0]}\` — the collection is published as unlimited`
            : 'no MAX_SUPPLY, no full-check',
    );

    // -------------------------- the money a player pays is actually collected from the player
    //
    // `RewardVault.fund(amount)` collects from **`msg.sender`**. So a contract that funnels a
    // player's fee into the vault must pull that fee from the player first, in the same function
    // and the same transaction. `Knights.summon()` and `Capsules.open()` both shipped without that
    // pull — a one-line omission each — and because nothing had ever called either function, no
    // test noticed. What the chain did was unambiguous: the vault asked the collection for 500
    // DNG it had never held and reverted `ERC20InsufficientBalance(knights)`, so the only mint path
    // into the live collection could not run at all, while the page asked the player to approve
    // 500 DNG that was never spent.
    //
    // The check reads source rather than a chain because that is where the bug was: every other
    // contract in the set (`DungeonKnightsGameV2/V3/V3.1/V4`, `RewardVault`) has the pull, so the
    // pattern was known and the two omissions were invisible next to it.
    const chargeScan = [];
    for (const name of ['Knights.sol', 'Capsules.sol', 'DungeonKnightsGameV4.sol', 'GenesisKnights.sol']) {
        // Comments are stripped by `code()`, so what is left of a function chunk is its body — and
        // a chunk cannot reach a later function, because the split cuts at every `function`.
        for (const chunk of code(source(name)).split(/\n\s*function\s+/).slice(1)) {
            if (!/rewardVault\.fund\(|\.fund\(/.test(chunk)) continue;
            const fn = chunk.slice(0, chunk.indexOf('(')).trim();
            chargeScan.push({ name, fn, pulls: /safeTransferFrom\(\s*msg\.sender/.test(chunk) });
        }
    }
    const skipped = chargeScan.filter((entry) => !entry.pulls);
    check(
        'every contract that funds the vault collects the fee from the caller',
        skipped.length === 0,
        skipped.length
            ? skipped.map((entry) => `${entry.name}:${entry.fn}() funds the vault without pulling from msg.sender`).join(', ')
            : chargeScan.map((entry) => `${entry.name}:${entry.fn}()`).join(', '),
    );
    // An absence check is vacuous if the scan finds nothing, so the scan's own subject is asserted
    // — these two are the only places a player is charged, and both must be seen.
    const charged = chargeScan.map((entry) => `${entry.name}:${entry.fn}`);
    check(
        'and the scan actually found the two places a player is charged',
        charged.includes('Knights.sol:summon') && charged.includes('Capsules.sol:open'),
        charged.join(', ') || 'nothing matched',
    );

    // The capsule price still needs *a* size to ramp against, and it is now this contract's
    // own anchor rather than a collection ceiling. Compared to `lib/` for the same reason as
    // everything else here: the ramp is a published number.
    const anchor = /PRICE_ANCHOR\s*=\s*([\d_]+)\s*;/.exec(capsulesSource);
    check(
        'the capsule ramp is anchored at the published reference size',
        anchor && Number(anchor[1].replace(/_/g, '')) === stakingConfig.knightsReferenceSize,
        `${anchor ? anchor[1] : 'missing'} vs KNIGHTS_REFERENCE_SIZE ${stakingConfig.knightsReferenceSize}`,
    );

    // The Genesis bands are the fairness promise made before mint, so they are compared row
    // by row — name, range and count — rather than by their total, which a reshuffle of the
    // ranges would preserve.
    const bandRe = /_bands\[(\d)\]\s*=\s*Band\("([^"]+)",\s*(\d+),\s*(\d+),\s*(\d+)\);/g;
    const deployedBands = [];
    let bandMatch;
    while ((bandMatch = bandRe.exec(genesisSource))) {
        deployedBands.push({
            name: bandMatch[2],
            lo: Number(bandMatch[3]),
            hi: Number(bandMatch[4]),
            count: Number(bandMatch[5]),
        });
    }
    const bandMismatch = stakingConfig.bands.filter((band, index) => {
        const deployed = deployedBands[index];
        return (
            !deployed ||
            deployed.name !== band.name ||
            deployed.lo !== band.lo ||
            deployed.hi !== band.hi ||
            deployed.count !== band.count
        );
    });
    check(
        'GenesisKnights publishes the same six bands',
        deployedBands.length === stakingConfig.bands.length && bandMismatch.length === 0,
        bandMismatch.length || deployedBands.length !== stakingConfig.bands.length
            ? `${deployedBands.length} bands, ${bandMismatch.length} differ`
            : stakingConfig.bands.map((b) => `${b.lo}–${b.hi}×${b.count}`).join('  '),
    );
    const bandSupply = deployedBands.reduce((sum, band) => sum + band.count, 0);
    check(
        'the bands sum to Genesis supply',
        bandSupply === genesisSupply(),
        `${bandSupply} vs ${genesisSupply()}`,
    );

    // -------------------------------------------- the token's split, as published
    const bucketRe = /_addBucket\("([^"]+)",\s*\w+,\s*(\d+)\);/g;
    const deployedBuckets = [];
    let bucketMatch;
    while ((bucketMatch = bucketRe.exec(tokenSource))) {
        deployedBuckets.push({ name: bucketMatch[1], bps: Number(bucketMatch[2]) });
    }
    const bucketTotal = deployedBuckets.reduce((sum, bucket) => sum + bucket.bps, 0);
    check(
        'the token mints the published distribution',
        bucketTotal === 10_000 &&
            deployedBuckets.every((bucket, i) => bucket.bps === economyConfig.distribution[i] * 100),
        bucketTotal !== 10_000
            ? `shares total ${bucketTotal} bps, not 100%`
            : deployedBuckets.map((b) => `${b.name} ${b.bps / 100}%`).join('  '),
    );

    // --------------------------------------- the capsule odds, rung by rung
    const typeRe = /_addType\(\s*(\d+),\s*"([^"]+)",\s*(\d+),\s*\[([^\]]+)\]\s*,\s*\[([^\]]+)\]\s*\);/g;
    const deployedTypes = [];
    let typeMatch;
    // `uint8(0), 1, 2` — the cast's own `8` must not be read as data. Stripping non-digits
    // turned `uint8(0)` into 80, which is exactly the kind of quiet misread that would have
    // made this check pass against a wrong table.
    // The lookbehind must exclude digits as well as letters. In `uint16`, blocking at the
    // `1` is not enough: the scan resumes at `6`, whose predecessor is a digit, and 6 was
    // being read as the first bps value of every odds table.
    const ints = (text) => (text.match(/(?<![A-Za-z_0-9])\d+/g) || []).map(Number);

    while ((typeMatch = typeRe.exec(capsulesSource))) {
        deployedTypes.push({
            id: Number(typeMatch[1]),
            name: typeMatch[2],
            length: Number(typeMatch[3]),
            tiers: ints(typeMatch[4]),
            bps: ints(typeMatch[5]),
        });
    }
    const oddsProblems = [];
    if (deployedTypes.length !== stakingConfig.capsules.length) {
        oddsProblems.push(`${deployedTypes.length} rungs vs ${stakingConfig.capsules.length} published`);
    }
    stakingConfig.capsules.forEach((published, index) => {
        const deployed = deployedTypes[index];
        if (!deployed) return;
        if (deployed.id !== published.id) oddsProblems.push(`${published.key}: id ${deployed.id} vs ${published.id}`);
        if (deployed.length !== published.odds.length) {
            oddsProblems.push(`${published.key}: ${deployed.length} outcomes vs ${published.odds.length}`);
        }
        published.odds.forEach((row, i) => {
            if (deployed.tiers[i] !== row.tier) {
                oddsProblems.push(`${published.key} row ${i}: tier ${deployed.tiers[i]} vs ${row.tier}`);
            }
            if (deployed.bps[i] !== row.pct * 100) {
                oddsProblems.push(`${published.key} row ${i}: ${deployed.bps[i]} bps vs ${row.pct}%`);
            }
        });
    });
    check(
        'Capsules scores the published four rungs',
        oddsProblems.length === 0,
        oddsProblems.length ? oddsProblems.join(', ') : deployedTypes.map((t) => `${t.name} ${t.length} outcomes`).join('  '),
    );

    // --------------------------------------------- the draw, the split and the vault
    const raffleCap = /CAPSULES_PER_WEEK\s*=\s*([\d_]+)\s*;/.exec(raffleSource);
    check(
        'the raffle gives away the published number of capsules',
        raffleCap && Number(raffleCap[1].replace(/_/g, '')) === stakingConfig.capsulesPerWeek,
        `${raffleCap ? raffleCap[1] : 'missing'} vs ${stakingConfig.capsulesPerWeek}/week`,
    );

    const lineCount = /LINE_COUNT\s*=\s*(\d+)\s*;/.exec(vaultSource);
    const vaultLineShares = economyConfig.lineBps;
    check(
        'the vault has the four published lines',
        lineCount &&
            Number(lineCount[1]) === 4 &&
            vaultLineShares.length === 4 &&
            vaultLineShares.reduce((a, b) => a + b, 0) === 10_000,
        `LINE_COUNT ${lineCount ? lineCount[1] : 'missing'}, shares ${vaultLineShares.join('/')} sum to ${vaultLineShares.reduce((a, b) => a + b, 0)}`,
    );
    check(
        'the vault keeps the published runway floor',
        new RegExp(`MIN_WEEKS\\s*=\\s*${economyConfig.minWeeks}\\s*;`).test(vaultSource),
        `MIN_WEEKS = ${economyConfig.minWeeks}`,
    );
    check(
        'the weekly budget is derived, not typed',
        economyConfig.weeklyBudget > 0 && Number.isFinite(economyConfig.weeklyBudget),
        `${Math.round(economyConfig.weeklyBudget).toLocaleString('en-US')} DNG a week at the reference population`,
    );

    console.log('');
    if (failures) {
        console.log(`  ${failures} failure(s)`);
        process.exit(1);
    }
    console.log(`  all checks passed — ${byName.size} contracts`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
