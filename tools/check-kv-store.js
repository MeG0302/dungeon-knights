#!/usr/bin/env node
/**
 * Does the daily-award guard hold across *separate server processes*?
 *
 *     node tools/check-kv-store.js
 *
 * The guard added to `lib/points-store.js` uses `SET … NX` when a shared store is
 * configured, and a local Set when it is not. Those are not equivalent, and the
 * difference only shows up on a real deployment: Vercel serves one app from many
 * isolated processes, each with its own memory.
 *
 * Measured on production, which is running the `memory` driver because no Redis is
 * configured — twelve simultaneous clears of today's first floor on one wallet:
 *
 *     said-credited: 12 of 12, final balance: 100
 *
 * Twelve payouts, from twelve processes that each believed the floor was untouched. The
 * balance looked right only because each process also keeps its own copy of the wallet,
 * so every one of them wrote `0 + 100`. That is worse than it sounds: two tabs read
 * different balances depending on which process answers, and the leaderboard reshuffles
 * at random between requests.
 *
 * So this harness runs the *library* directly in two child processes with one shared
 * store between them, which is the only way to reproduce multi-instance behaviour
 * without deploying. No account, no credentials, no Redis install: the store is a fake
 * that speaks the same REST dialect (`GET`, `SET NX EX`, `DEL`, `ZADD`, `ZREVRANGE`,
 * `ZREVRANK`, `ZCARD`, and `/pipeline`), and `SET NX` is atomic inside it because Node
 * handles each request to completion.
 *
 *   1. redis driver, two processes, 8 overlapping clears each -> exactly one payout
 *   2. both processes read back the same balance
 *   3. memory driver, same burst -> two payouts (expected; documents why KV is required)
 */

const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');
const crypto = require('crypto');

const PROGRAM_URL = pathToFileURL(path.join(__dirname, '..', 'lib', 'points-program.js')).href;
const STORE_URL = pathToFileURL(path.join(__dirname, '..', 'lib', 'points-store.js')).href;

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

// --------------------------------------------------------------- a fake Upstash
/**
 * The subset of the Upstash/Vercel-KV REST API that `lib/points-store.js` speaks.
 * Deliberately literal: a `SET` with `NX` on an existing key must answer null, exactly
 * as the real thing does, or the guard would look like it worked when it had not.
 */
function startFakeKv() {
    const strings = new Map();
    const hashes = new Map(); // sorted sets

    const command = (args) => {
        const [name, ...rest] = args.map((a) => String(a));
        const op = name.toUpperCase();
        if (op === 'GET') return strings.get(rest[0]) ?? null;
        if (op === 'DEL') return strings.delete(rest[0]) ? 1 : 0;
        if (op === 'SET') {
            const [key, value, ...flags] = rest;
            const nx = flags.map((f) => f.toUpperCase()).includes('NX');
            if (nx && strings.has(key)) return null;
            strings.set(key, value);
            return 'OK';
        }
        if (op === 'ZADD') {
            const [key, score, member] = rest;
            const set = hashes.get(key) || new Map();
            const added = set.has(member) ? 0 : 1;
            set.set(member, Number(score));
            hashes.set(key, set);
            return added;
        }
        if (op === 'ZCARD') return (hashes.get(rest[0]) || new Map()).size;
        if (op === 'ZREVRANK') {
            const ordered = reverseRanked(rest[0]);
            const index = ordered.indexOf(rest[1]);
            return index === -1 ? null : index;
        }
        if (op === 'ZREVRANGE') {
            const ordered = reverseRanked(rest[0]);
            return ordered.slice(Number(rest[1]), Number(rest[2]) + 1);
        }
        throw new Error(`fake KV got an unsupported command: ${name}`);
    };

    const reverseRanked = (key) => [...(hashes.get(key) || new Map()).entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([member]) => member);

    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            const send = (payload) => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(payload));
            };
            try {
                const parsed = JSON.parse(body || '[]');
                if (req.url.startsWith('/pipeline')) {
                    return send(parsed.map((args) => ({ result: command(args) })));
                }
                return send({ result: command(parsed) });
            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
    });

    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            resolve({ port: server.address().port, close: () => server.close() });
        });
    });
}

// ------------------------------------------------------------- the child process
/**
 * One "instance": imports the real `clearLevel` and fires an overlapping burst at the
 * same wallet, floor and day as its sibling. Prints what its own ledger saw.
 */
const CHILD = `
const [address, burst] = process.argv.slice(1);
const program = await import(${JSON.stringify(PROGRAM_URL)});
const out = await Promise.all(Array.from({ length: Number(burst) }, () => program.clearLevel(address, 0)));
const paid = out.filter((r) => (r.credited || 0) > 0).length;
const store = await import(${JSON.stringify(STORE_URL)});
const wallet = await store.getWallet(address);
process.stdout.write(JSON.stringify({ paid, balance: wallet?.points ?? null, driver: store.STORAGE_DRIVER }));
`;

function runInstance(address, burst, env) {
    // Never inherit the parent's store config: the driver must come from `env` alone.
    const base = { ...process.env, NODE_NO_WARNINGS: '1' };
    for (const key of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
        delete base[key];
    }
    return new Promise((resolve, reject) => {
        execFile(process.execPath, ['--input-type=module', '-e', CHILD, address, String(burst)], {
            cwd: path.join(__dirname, '..'),
            env: { ...base, ...env },
            timeout: 30000,
        }, (error, stdout, stderr) => {
            if (error) return reject(new Error(`${error.message}\n${stderr}`));
            try {
                resolve(JSON.parse(stdout));
            } catch {
                reject(new Error(`child printed something unparseable: ${stdout}\n${stderr}`));
            }
        });
    });
}

(async () => {
    console.log('');
    console.log('Points store — is the daily guard atomic across server processes?');

    const address = `0x${crypto.randomBytes(20).toString('hex')}`;
    const BURST = 8;

    // ------------------------------------------------------- shared store (redis)
    console.log('');
    console.log('Shared store configured (KV_REST_API_URL / KV_REST_API_TOKEN)');

    const kv = await startFakeKv();
    const sharedEnv = {
        KV_REST_API_URL: `http://127.0.0.1:${kv.port}`,
        KV_REST_API_TOKEN: 'fake-token',
    };
    // The driver is chosen from the environment, so neither child may see the other's.

    const [a, b] = await Promise.all([
        runInstance(address, BURST, sharedEnv),
        runInstance(address, BURST, sharedEnv),
    ]);

    rec('both processes used the shared driver',
        a.driver === 'redis' && b.driver === 'redis', `${a.driver} / ${b.driver}`);
    rec(`exactly one payout across 2 processes × ${BURST} overlapping clears`,
        a.paid + b.paid === 1, `${a.paid} + ${b.paid} paid`);
    rec('both processes read back the same balance', a.balance === b.balance,
        `${a.balance} / ${b.balance}`);
    rec('and that balance is one floor, not two', a.balance === 100, `${a.balance} PTS`);

    kv.close();

    // -------------------------------------------------- no shared store (memory)
    console.log('');
    console.log('No shared store — the shape production is in right now');

    const memoryEnv = { NODE_ENV: 'production' }; // the driver is only `memory` in production
    const other = `0x${crypto.randomBytes(20).toString('hex')}`;
    const [c, d] = await Promise.all([
        runInstance(other, BURST, memoryEnv),
        runInstance(other, BURST, memoryEnv),
    ]);

    rec('both processes fell back to per-process memory',
        c.driver === 'memory' && d.driver === 'memory', `${c.driver} / ${d.driver}`);
    rec('so each one paid the same floor (this is the defect KV fixes)',
        c.paid + d.paid === 2, `${c.paid} + ${d.paid} paid — 2 payouts for one floor`);

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
