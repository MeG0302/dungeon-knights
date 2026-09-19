#!/usr/bin/env node
/**
 * Checks `public/dungeon-session.js` — the client half of the signed-run path.
 *
 *     node tools/check-session.js
 *
 * No browser, no chain, no server: the module runs in a `vm` sandbox with a stubbed
 * window, localStorage, fetch and ethers, so the interesting behaviour can be driven
 * directly and deterministically. This is the half of V4 that cannot be tested by
 * reading a contract, and it is the half that decides whether a player's run is
 * claimable at all:
 *
 *   - a signed run is stored with its receipt, and claimed on V4 in the tuple shape the
 *     contract expects
 *   - a run earned before the upgrade (no receipt, no token) is claimed on V3 instead
 *   - a 409 "too fast to sign" is waited out and retried rather than dropping the run
 *   - with no V4 configured, everything falls back to the legacy path untouched
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SCRIPT = path.join(process.cwd(), 'public', 'dungeon-session.js');

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

const ADDRESS = '0xd99aB6773E06A440D9927905a5C4070C4064D3aC';
const V3 = '0xD8de9385Db7DfE925882E76849B6e067e47236e5';
const V4 = '0x00000000000000000000000000000000000000v4'.replace('v4', '44');

function makeSandbox({ v4, session, configError, completeResponses }) {
    const calls = { contracts: [], claims: { v4: [], v3: [] } };
    const alerts = [];

    const logs = [];
    const store = {};
    const localStorage = {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
    };
    const sessionStorage = {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
    };

    if (session) {
        localStorage.setItem('dk_points_session', JSON.stringify({
            address: session, token: 'fake-token', expiresAt: Math.floor(Date.now() / 1000) + 3600,
        }));
    }

    const responses = completeResponses ? [...completeResponses] : null;

    const fetchStub = async (url, options = {}) => {
        const body = options.body ? JSON.parse(options.body) : null;
        const json = (data, status = 200) => ({
            ok: status >= 200 && status < 300, status, json: async () => data,
        });

        if (url.includes('/api/game/config')) {
            if (configError) throw new Error('offline');
            return json({ v3: V3, v4: v4 || null, signing: !!v4, minSeconds: { 1: 1, 15: 1 } });
        }
        if (url.includes('/api/game/start')) {
            return json({ runToken: 'run-token-1', startedAt: Math.floor(Date.now() / 1000), minSeconds: 1 });
        }
        if (url.includes('/api/game/complete')) {
            if (responses && responses.length) {
                const next = responses.shift();
                return json(next.body, next.status);
            }
            return json({
                receipt: {
                    knightIds: [1], dungeonId: 1, reward: '10000000000000000000',
                    nonce: '0x' + '11'.repeat(32), expiry: Math.floor(Date.now() / 1000) + 900,
                    signature: '0x' + '22'.repeat(65),
                },
                reward: '10000000000000000000',
            });
        }
        return json({ error: 'unexpected url ' + url }, 404);
    };

    class FakeContract {
        constructor(address, abi, signer) {
            this.address = address;
            calls.contracts.push({ address, abi });
        }

        async claimSignedRuns(runs) {
            calls.claims.v4.push(runs);
            return {
                hash: '0xsign tx',
                wait: async () => ({
                    events: [{
                        event: 'RewardsClaimed',
                        args: {
                            amount: (BigInt(runs.length) * 10n * 10n ** 18n).toString(),
                            knightCount: runs.length,
                        },
                    }],
                }),
            };
        }

        async batchClaimRewards(runs) {
            calls.claims.v3.push(runs);
            return {
                hash: '0xlegacy tx',
                wait: async () => ({
                    events: [{
                        event: 'RewardsClaimed',
                        args: {
                            amount: (BigInt(runs.length) * 10n * 10n ** 18n).toString(),
                            knightCount: runs.length,
                        },
                    }],
                }),
            };
        }
    }

    const ethers = {
        providers: { Web3Provider: class { getSigner() { return { fake: true }; } } },
        Contract: FakeContract,
        utils: { formatEther: (v) => String(Number(v.toString()) / 1e18) },
    };

    const sandbox = {
        console: {
            log: () => {},
            warn: (...a) => logs.push(`warn: ${a.join(' ')}`),
            error: (...a) => logs.push(`error: ${a.join(' ')}`),
        },
        setTimeout, clearTimeout, setInterval, clearInterval,
        localStorage, sessionStorage, fetch: fetchStub, ethers, alert: (m) => alerts.push(m),
        ethereum: { request: async () => { throw new Error('should not need to sign'); } },
        walletManager: { isConnected: true, userAddress: ADDRESS },
        RARITY: { COMMON: { dungeonReward: 10 } },
        DUNGEON_CONFIG: { getGameContract: () => V3 },
    };
    sandbox.window = sandbox;

    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(SCRIPT, 'utf8'), sandbox, { filename: SCRIPT });

    return { session: sandbox.dungeonSession, calls, alerts, store, logs };
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    console.log('');
    console.log('Client run sessions (public/dungeon-session.js)');

    // ---------------------------------------------------------------- signed path
    console.log('');
    console.log('With V4 configured');
    {
        const box = makeSandbox({ v4: V4, session: ADDRESS });
        await tick(30);

        box.session.startDungeon([1], 'crypts', 'Forgotten Crypts');
        const done = await box.session.completeDungeon(
            [{ tokenId: 1, rarity: 'COMMON' }],
            { kills: 40, totalNodes: 60, chests: 2 }
        );

        rec('the run is reported complete', !!done, done && `reward ${done.reward}`);
        rec('a receipt is attached to the pending run', !!box.session.pendingRuns[0].receipt);
        rec('the reward comes from the server, not the estimate',
            box.session.pendingRuns[0].reward === 10, `${box.session.pendingRuns[0].reward} DNG`);
        rec('the run is classified as signed', box.session.signedRuns().length === 1);
        rec('nothing is classified as legacy', box.session.legacyRuns().length === 0);

        const claimed = await box.session.claimAllRewards();

        const v4payload = box.calls.claims.v4[0];
        rec('one V4 claim was sent', !!v4payload, v4payload ? `${v4payload.length} run(s)` : 'none');
        rec('the claim itself reported success', claimed === true, box.logs.join(' | '));
        rec('no V3 claim was sent', box.calls.claims.v3.length === 0);
        if (v4payload) {
            const tuple = v4payload[0];
            rec('the tuple has six fields, as SignedRun does', tuple.length === 6, `length ${tuple.length}`);
            rec('knight ids travel as an array', Array.isArray(tuple[0]) && tuple[0][0] === 1);
            rec('dungeon id is carried', tuple[1] === 1);
            rec('the reward is the signed wei amount', String(tuple[2]) === '10000000000000000000', String(tuple[2]));
            rec('the nonce is carried', /^0x[0-9a-f]{64}$/.test(String(tuple[3])));
            rec('the signature is carried', String(tuple[5]).startsWith('0x'));
        }
        rec('the claimed run is cleared from storage', box.session.pendingRuns.length === 0);
        // With no transaction modal on the page, alert() is how success is reported.
        rec('a success was reported', box.alerts.some((m) => /Successfully claimed/.test(m)), box.alerts.join(' | '));
    }

    // ------------------------------------------------------------ the 409 retry
    console.log('');
    console.log('A run too fast to sign');
    {
        const retryAfter = 1;
        const box = makeSandbox({
            v4: V4,
            session: ADDRESS,
            completeResponses: [
                { status: 409, body: { error: 'too fast', retryAfter } },
                { status: 200, body: { receipt: { knightIds: [1], dungeonId: 1, reward: '10000000000000000000', nonce: '0x' + '33'.repeat(32), expiry: Math.floor(Date.now() / 1000) + 900, signature: '0x' + '44'.repeat(65) } } },
            ],
        });
        await tick(30);

        const startedAt = Date.now();
        box.session.startDungeon([1], 'crypts', 'Forgotten Crypts');
        await box.session.completeDungeon([{ tokenId: 1, rarity: 'COMMON' }], {});
        const waited = Date.now() - startedAt;

        rec('the 409 was waited out and retried', !!box.session.pendingRuns[0].receipt);
        rec('it actually waited before retrying', waited >= retryAfter * 1000, `${waited}ms`);
    }

    // -------------------------------------------------------------- legacy runs
    console.log('');
    console.log('Runs earned before the upgrade');
    {
        const box = makeSandbox({ v4: V4, session: ADDRESS });
        await tick(30);

        // Exactly what V3's client wrote: no receipt, no token.
        box.session.pendingRuns = [
            { knightIds: [1, 2], dungeonId: 1, dungeonName: 'Forgotten Crypts', clearedAt: 1, timeSpent: 90 },
            { knightIds: [3], dungeonId: 2, dungeonName: 'Goblin Mines', clearedAt: 2, timeSpent: 120 },
        ];

        rec('both are classified as legacy', box.session.legacyRuns().length === 2);
        rec('neither is classified as signed', box.session.signedRuns().length === 0);

        box.session.startDungeon([1], 'crypts', 'Forgotten Crypts');
        await box.session.completeDungeon([{ tokenId: 1, rarity: 'COMMON' }], {});

        const claimed = await box.session.claimAllRewards();

        rec('the claim reported success', claimed === true, box.logs.join(' | '));
        rec('the new run went to V4', box.calls.claims.v4.length === 1);
        rec('the old runs went to V3', box.calls.claims.v3.length === 1,
            box.calls.claims.v3.length ? JSON.stringify(box.calls.claims.v3[0]) : 'none');
        if (box.calls.claims.v3.length) {
            rec('the legacy payload is the V3 tuple', box.calls.claims.v3[0][0].length === 2);
        }
        rec('storage is empty afterwards', box.session.pendingRuns.length === 0);
    }

    // ------------------------------------------------------------- no V4 at all
    console.log('');
    console.log('With no V4 configured (today\'s production)');
    {
        const box = makeSandbox({ v4: null, session: ADDRESS });
        await tick(30);

        rec('the config reports no V4', box.session.gameContractV4Address === null);

        box.session.startDungeon([1], 'crypts', 'Forgotten Crypts');
        const done = await box.session.completeDungeon([{ tokenId: 1, rarity: 'COMMON' }], {});

        rec('the run still completes', !!done);
        rec('no receipt is attached', !box.session.pendingRuns[0].receipt);
        rec('it is classified as legacy, so V3 can pay it', box.session.legacyRuns().length === 1);
        rec('the displayed reward falls back to the local estimate', box.session.pendingRuns[0].reward === 10);

        await box.session.claimAllRewards();
        rec('the claim goes to the legacy contract', box.calls.claims.v3.length === 1);
        rec('V4 is never called', box.calls.claims.v4.length === 0);
    }

    // -------------------------------------------------------- unreachable server
    console.log('');
    console.log('When the API cannot be reached');
    {
        const box = makeSandbox({ v4: V4, session: ADDRESS, configError: true });
        await tick(30);

        box.session.startDungeon([1], 'crypts', 'Forgotten Crypts');
        const done = await box.session.completeDungeon([{ tokenId: 1, rarity: 'COMMON' }], {});

        rec('play is not blocked by an unreachable backend', !!done);
        rec('the run is kept rather than dropped', box.session.pendingRuns.length === 1);
    }

    console.log('');
    const failed = results.filter((r) => !r.pass);
    console.log(`${results.length - failed.length}/${results.length} checks passed`);
    for (const f of failed) console.log(`  FAILED: ${f.label}`);
    console.log('');
    process.exit(failed.length ? 1 : 0);
})();
