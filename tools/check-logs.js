#!/usr/bin/env node
/**
 * Does the on-chain history decode the events the contract actually emits?
 *
 *     node tools/check-logs.js [rpc-url]
 *
 * This is the guard for a bug that shipped: `public/leaderboard.js` queried
 * `DungeonCompleted(address,uint256,uint256,uint256,uint256,uint256)` while the contract
 * emits `(address,uint256,uint256,uint8,uint256,uint256)`. Different signature, different
 * topic hash, zero matches — and the board said "no claims yet" forever, looking exactly
 * like a young game rather than a broken query.
 *
 * The unit phase therefore builds its logs the way the chain does — encoded through the
 * same interface the reader uses — and then asks whether that interface's topic hash is
 * the contract's. The live phase then runs the real sweep against the testnet and reports
 * what it found, so "the query works" is a measurement and not a claim.
 *
 * The live phase needs network access; if the RPC cannot be reached it says so and does not
 * count the skipped checks either way.
 */

const { utils } = require('ethers');

// One extra contract address, so the two-contract path (V4 next to V3) is exercised.
process.env.GAME_CONTRACT_V4 = process.env.GAME_CONTRACT_V4 || '0x00000000000000000000000000000000000000aa';

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

// The signature strings are what a topic hash is computed from — `indexed` is not part of
// them — while the ABI strings below carry `indexed`, which is what decides whether an
// argument lands in `topics` or in `data`. Getting that second part wrong encodes a
// *different* log, which is the whole failure class this battery exists for.
const CONTRACT_SIGNATURES = {
    DungeonCompleted: 'DungeonCompleted(address,uint256,uint256,uint8,uint256,uint256)',
    RewardsClaimed: 'RewardsClaimed(address,uint256,uint256,uint256)',
};
const EVENT_ABI = [
    'event DungeonCompleted(address indexed player, uint256 indexed knightId, uint256 indexed dungeonId, uint8 rarity, uint256 reward, uint256 timestamp)',
    'event RewardsClaimed(address indexed player, uint256 amount, uint256 runsCount, uint256 knightCount)',
];
const WRONG_SIGNATURE = 'DungeonCompleted(address,uint256,uint256,uint256,uint256,uint256)';

const IFACE = new utils.Interface(EVENT_ABI);

const P1 = '0x1111111111111111111111111111111111111111';
const P2 = '0x2222222222222222222222222222222222222222';
const GAME_V3 = '0xD8de9385Db7DfE925882E76849B6e067e47236e5';
const GAME_V4 = process.env.GAME_CONTRACT_V4;
const FIRST_LOG = 1003;       // the earliest log the V4 contract holds, in the fake

let hash = 0;
const fakeTx = () => `0x${(++hash).toString(16).padStart(64, '0')}`;

function makeLog(eventName, args, block, address = GAME_V3) {
    const encoded = IFACE.encodeEventLog(eventName, args);
    return {
        address: address.toLowerCase(),
        topics: encoded.topics,
        data: encoded.data,
        blockNumber: `0x${block.toString(16)}`,
        transactionHash: fakeTx(),
        logIndex: '0x0',
    };
}

// Five claims across two players, one run each, plus two runs, plus one log the reader
// must skip (encoded with the wrong signature, the way the old client would have).
const LOGS = [
    makeLog('RewardsClaimed', [P1, utils.parseEther('100'), 1, 1], 1000),
    makeLog('RewardsClaimed', [P2, utils.parseEther('300'), 2, 2], 1001),
    makeLog('RewardsClaimed', [P1, utils.parseEther('50'), 1, 1], 1002),
    makeLog('RewardsClaimed', [P2, utils.parseEther('7'), 1, 1], 1003, GAME_V4),
    makeLog('DungeonCompleted', [P1, 7, 1, 4, utils.parseEther('150'), 1700000000], 1004),
    makeLog('DungeonCompleted', [P2, 9, 2, 0, utils.parseEther('10'), 1700000100], 1005),
    // The wrong signature from the shipped client: a real log the reader must not decode.
    { ...makeLog('DungeonCompleted', [P1, 7, 1, 4, utils.parseEther('150'), 1700000000], 1006), topics: [utils.id(WRONG_SIGNATURE)] },
];

const getLogsCalls = [];

const realFetch = globalThis.fetch;

// The fake node is deliberately capped: a range wider than this is refused, which is how
// the real testnet behaved before the reader learned to sweep windows.
const MAX_RANGE = 20000;      // for a filtered query
const PROBE_RANGE = 60000;    // for the topic-less probes the start finder makes
const V3_FIRST_LOG = 1000;    // the earliest log the V3 contract holds, in the fake
let probeCalls = 0;

function installFakeRpc() {
    globalThis.fetch = async (url, options) => {
        const body = JSON.parse(options.body);
        const reply = (result) => ({ ok: true, json: async () => ({ jsonrpc: '2.0', id: body.id, result }) });
        const fail = (message) => ({ ok: true, json: async () => ({ jsonrpc: '2.0', id: body.id, error: { code: -32005, message } }) });
        if (body.method === 'eth_blockNumber') return reply('0x' + (40000).toString(16));
        if (body.method === 'eth_getBlockByNumber') return reply({ timestamp: '0x6553f100' });
        if (body.method === 'eth_getLogs') {
            const [filter] = body.params;
            const from = parseInt(filter.fromBlock, 16);
            const to = parseInt(filter.toBlock, 16);
            if (!filter.topics) probeCalls += 1;
            if (to - from + 1 > (filter.topics ? MAX_RANGE : PROBE_RANGE)) {
                return fail('query returned more than 10000 results');
            }
            if (filter.topics) getLogsCalls.push(filter);
            // A topic-less query is how the reader asks "is there anything here at all?".
            const topic0 = filter.topics ? filter.topics[0] : null;
            const player = filter.topics ? filter.topics[1] : null;
            const mine = LOGS.filter((log) => {
                if (topic0 && log.topics[0] !== topic0) return false;
                if (log.address !== String(filter.address).toLowerCase()) return false;
                if (player && log.topics[1] !== player.toLowerCase()) return false;
                const block = parseInt(log.blockNumber, 16);
                return block >= from && block <= to;
            });
            return reply(mine);
        }
        return reply(null);
    };
}

(async () => {
    // ---------------------------------------------------------------- unit phase
    installFakeRpc();
    const logs = await import('../lib/chain-logs.js');

    console.log('');
    console.log('The event signatures (the bug this exists for)');

    const right = utils.id(CONTRACT_SIGNATURES.DungeonCompleted);
    const wrong = utils.id(WRONG_SIGNATURE);
    rec('the reader filters on the contract\'s own DungeonCompleted signature',
        logs.EVENT_TOPICS.DungeonCompleted === right,
        `${logs.EVENT_SIGNATURES.DungeonCompleted} → ${String(logs.EVENT_TOPICS.DungeonCompleted).slice(0, 18)}`);
    rec('the same for RewardsClaimed',
        logs.EVENT_TOPICS.RewardsClaimed === utils.id(CONTRACT_SIGNATURES.RewardsClaimed),
        String(logs.EVENT_TOPICS.RewardsClaimed).slice(0, 18));
    rec('the signature the old client used is a different topic (why it matched nothing)',
        right !== wrong, `${right.slice(0, 12)} ≠ ${wrong.slice(0, 12)}`);

    console.log('');
    console.log('Decoding and aggregation (synthetic logs, encoded the way the chain does)');

    const board = await logs.claimedBoard({ limit: 10 });
    rec('every player the contracts have paid is on the board', board.rows.length === 2, `${board.rows.length} players`);
    rec('the board is ranked by DNG actually paid', board.rows[0].address === P2,
        `top: ${board.rows[0].address.slice(0, 10)} with ${board.rows[0].totalRewards}`);
    rec('amounts are summed per player', board.rows[0].totalRewards === 307, `${board.rows[0].totalRewards} DNG`);
    rec('claims are counted per player', board.rows[0].claimCount === 2, `${board.rows[0].claimCount} claims`);
    rec('the totals agree with the rows', board.totalClaimed === 457, `${board.totalClaimed} DNG`);
    rec('a second contract\'s events are included', board.claims === 4, `${board.claims} claims seen`);
    rec('an undecodable log is skipped, not fatal', board.rows.length === 2, 'board still rendered');

    console.log('');
    console.log('Sweeping');

    // A second module instance, so this contract's start is not already cached from the
    // board sweep above — this is the first sweep that has to *find* where history begins.
    probeCalls = 0;
    getLogsCalls.length = 0;
    const freshModule = await import('../lib/chain-logs.js?fresh=1');
    await freshModule.readEventLogs('RewardsClaimed', { address: GAME_V4 });
    rec('the sweep starts at the first log, not at block 0',
        getLogsCalls[0] && parseInt(getLogsCalls[0].fromBlock, 16) === FIRST_LOG,
        `first window at block ${getLogsCalls[0] ? parseInt(getLogsCalls[0].fromBlock, 16) : '?'}`);
    rec('finding it costs a bisection, not a walk of the chain',
        probeCalls >= 5 && probeCalls <= 40,
        `${probeCalls} range probes to locate block ${FIRST_LOG} of a 40,000-block chain`);
    rec('a second sweep at that address reuses the answer',
        await (async () => {
            probeCalls = 0;
            await freshModule.readEventLogs('RewardsClaimed', { address: GAME_V4 });
            return probeCalls === 0;
        })(), 'no further probes');

    probeCalls = 0;
    getLogsCalls.length = 0;
    await logs.readEventLogs('RewardsClaimed', { address: GAME_V3, fromBlock: 0, toBlock: 59999 });
    rec('a range the node refuses is split into windows', getLogsCalls.length === 3,
        `${getLogsCalls.length} window calls for 60,000 blocks, at 20,000 per window`);
    rec('an explicit floor is still narrowed to the first event',
        parseInt(getLogsCalls[0].fromBlock, 16) === V3_FIRST_LOG, getLogsCalls[0].fromBlock);
    rec('windows cover the range in order',
        getLogsCalls.every((call, i) => i === 0 || parseInt(call.fromBlock, 16) === parseInt(getLogsCalls[i - 1].toBlock, 16) + 1),
        getLogsCalls.map((c) => `${parseInt(c.fromBlock, 16)}+`).join(' '));
    rec('an explicit fromBlock skips the search entirely', probeCalls === 0, `${probeCalls} probes`);

    getLogsCalls.length = 0;
    await logs.readEventLogs('RewardsClaimed', { address: GAME_V3, player: P1 });
    rec('a player filter is an indexed-topic filter, not a post-filter',
        getLogsCalls[0].topics[1] === utils.hexZeroPad(P1, 32), String(getLogsCalls[0].topics[1]).slice(0, 20));

    console.log('');
    console.log('One wallet\'s history');

    const history = await logs.historyFor(P1);
    rec('the wallet is recognised', history?.address === P1, String(history?.address));
    rec('only that wallet\'s claims are summed', history.totals.claimed === 150, `${history.totals.claimed} DNG`);
    rec('runs are listed with their dungeon and rarity',
        history.runs.length === 1 && history.runs[0].dungeon === 'Forgotten Crypts' && history.runs[0].rarity === 'Legendary',
        `${history.runs[0]?.dungeon} / ${history.runs[0]?.rarity} (rarity index 4)`);
    rec('a run carries its own timestamp', history.runs[0].at === 1700000000, String(history.runs[0].at));
    rec('a bad address is refused rather than queried', (await logs.historyFor('not-an-address')) === null, 'null');
    rec('an empty wallet is a valid, empty history',
        (await logs.historyFor('0x9999999999999999999999999999999999999999'))?.totals.claims === 0, '0 claims');

    // ---------------------------------------------------------------- live phase
    console.log('');
    console.log('Live: the real testnet, the real contract');

    const { CHAIN } = await import('../lib/game-runs.js');
    globalThis.fetch = realFetch;   // the fake was only ever for the unit phase
    try {
        const live = await logs.claimedBoard({ limit: 50 });
        rec('the sweep returns claims', live.claims > 0, `${live.claims} RewardsClaimed logs on ${CHAIN.rpc}`);
        rec('the board is a real address list',
            live.rows.every((row) => /^0x[0-9a-f]{40}$/.test(row.address)), `${live.rows.length} rows`);
        rec('every amount is positive', live.rows.every((row) => row.totalRewards > 0),
            `${live.totalClaimed.toFixed(2)} DNG claimed in total`);
        const sample = live.rows[0];
        const wallet = await logs.historyFor(sample.address);
        rec('a player from the board has a matching history',
            Math.abs(wallet.totals.claimed - sample.totalRewards) < 1e-9,
            `${wallet.totals.claimed} on the board vs ${sample.totalRewards} in their history`);
    } catch (error) {
        console.log(`  skipped  live checks — ${error.message || error}`);
    }

    console.log('');
    const failed = results.filter((r) => !r.pass);
    console.log(`${results.length - failed.length}/${results.length} checks passed`);
    for (const f of failed) console.log(`  FAILED: ${f.label}`);
    console.log('');
    process.exit(failed.length ? 1 : 0);
})().catch((error) => {
    console.error('Harness failed:', error);
    process.exit(1);
});
