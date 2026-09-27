#!/usr/bin/env node
/**
 * Checks the server-signed run gate.
 *
 *     node tools/check-runs.js                      # unit tests only
 *     node tools/check-runs.js http://localhost:3111 # + live API checks
 *
 * Two phases:
 *
 *   1. **Unit** — the parts that need no server. The important one is the encoding
 *      agreement: the receipt the backend signs must hash to exactly the digest
 *      `receiptHash()` builds on chain, or every claim would revert with "Bad
 *      signature" and the cause would be invisible. That is recomputed here from the
 *      same inputs, independently of `lib/game-runs.js`'s own copy.
 *   2. **Live** — drives the real routes with a real wallet session against the real
 *      testnet: a run too fast to sign is refused, a valid one comes back signed and
 *      recovers to the signer, and forged/foreign/misowned runs are turned away.
 *
 * For phase 2 the server must run with GAME_CONTRACT_V4 and GAME_SIGNER_PRIVATE_KEY, and
 * this script needs the same POINTS_SESSION_SECRET the server was started with — it
 * mints a wallet session for a knight owner it finds on chain, which is what lets the
 * real ownership, timing and forgery paths be exercised without a wallet.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

// Read by lib/game-runs.js at import time, so these must be set before it is loaded.
process.env.GAME_CONTRACT_V4 = process.env.GAME_CONTRACT_V4
    || '0x000000000000000000000000000000000000d0d0';
process.env.GAME_SIGNER_PRIVATE_KEY = process.env.GAME_SIGNER_PRIVATE_KEY
    || `0x${crypto.randomBytes(32).toString('hex')}`;

const BASE = process.argv[2] || null;
const DEGRADED_BASE = process.argv[3] || null;
const RPC = process.env.GAME_RPC_URL || 'https://rpc.testnet.chain.robinhood.com';
// The live collection. It used to default to the first one (`0x06c7…`), which meant this
// harness read a retired contract the server stopped signing for — a green run against the
// wrong collection is worse than a red one against the right one.
const NFT = process.env.KNIGHT_NFT_ADDRESS || '0x27Cfbb763188a50Fe1C0fFfBe2552b1945eE1B2D';
// Must match the server's POINTS_SESSION_SECRET: game routes authenticate with the same
// wallet session the Points Program issues.
const SECRET = process.env.POINTS_SESSION_SECRET || 'dev-only-points-session-secret';

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass, detail });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

function section(name) {
    console.log('');
    console.log(name);
}

// --------------------------------------------------------------------------- unit

async function unit() {
    const runs = await import('../lib/game-runs.js');

    section('Minimum time (KNIGHT-SCALING.md)');
    rec('1 knight → 300s', runs.minSecondsFor(1) === 300, `${runs.minSecondsFor(1)}s`);
    rec('15 knights → 77s', runs.minSecondsFor(15) === 77, `${runs.minSecondsFor(15)}s`);
    rec('100 knights floors at 30s', runs.minSecondsFor(100) === 30, `${runs.minSecondsFor(100)}s`);

    section('Run tokens');
    const address = '0x1111111111111111111111111111111111111111';
    const issued = runs.issueRunToken({ address, knightIds: [1, 2], dungeonId: 3 });
    const read = runs.readRunToken(issued.token);
    rec('a token round-trips', !!read, read ? `${read.knightIds.join(',')} @ ${read.startedAt}` : 'null');
    rec('the address survives', read && read.address === address);
    rec('the dungeon survives', read && read.dungeonId === 3);
    rec('the start time is the server\'s', read && Math.abs(Math.floor(Date.now() / 1000) - read.startedAt) < 5);

    const [payload] = issued.token.split('.');
    const tampered = `${payload}.${'0'.repeat(64)}`;
    rec('a tampered MAC is rejected', runs.readRunToken(tampered) === null);
    const movedPayload = Buffer.from(
        `0x2222222222222222222222222222222222222222|1,2|3|${read.startedAt}`, 'utf8'
    ).toString('base64url');
    rec('a re-encoded payload is rejected', runs.readRunToken(`${movedPayload}.${issued.token.split('.')[1]}`) === null);
    rec('garbage is rejected', runs.readRunToken('not-a-token') === null);

    section('Receipt encoding (must match receiptHash() on chain)');
    const signer = runs.signerWallet();
    rec('a signer key is available', !!signer, signer ? signer.address : 'none');

    const knightIds = [7, 11];
    const dungeonId = 2;
    const reward = ethers.BigNumber.from('27' + '0'.repeat(18));
    const receipt = await runs.buildReceipt({ address, knightIds, dungeonId, reward });

    // Recompute the digest from scratch — the same numbers, the same ABI types, nothing
    // borrowed from the module under test beyond the returned nonce/expiry.
    const digest = ethers.utils.arrayify(ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(
        ['address', 'bytes32', 'uint256', 'uint256', 'uint256', 'uint256', 'uint8', 'uint256', 'address'],
        [
            address,
            ethers.utils.solidityKeccak256(['uint256[]'], [knightIds]),
            dungeonId,
            reward,
            receipt.nonce,
            receipt.expiry,
            receipt.knightType,
            runs.CHAIN.id,
            runs.ADDRESSES.gameV4,
        ]
    )));
    // `receipt.hash` is the inner digest — exactly what receiptHash() returns in Solidity
    // and what the contract then wraps with the EIP-191 prefix before recovering.
    rec('the inner digest matches the contract\'s receiptHash()',
        ethers.utils.hexlify(digest) === receipt.hash,
        ethers.utils.hexlify(digest) === receipt.hash ? '' : `${ethers.utils.hexlify(digest)} vs ${receipt.hash}`);

    const signed = ethers.utils.keccak256(ethers.utils.concat([
        ethers.utils.toUtf8Bytes('\x19Ethereum Signed Message:\n32'),
        digest,
    ]));
    const recovered = ethers.utils.recoverAddress(signed, receipt.signature);
    rec('the signature recovers to the backend signer', recovered.toLowerCase() === signer.address.toLowerCase(),
        recovered);

    rec('the nonce is 32 bytes', /^0x[0-9a-f]{64}$/.test(receipt.nonce));
    const other = await runs.buildReceipt({ address, knightIds, dungeonId, reward });
    rec('two receipts for the same run differ', other.nonce !== receipt.nonce);
    rec('the receipt carries the summonable knight type', receipt.knightType === runs.KNIGHT_TYPE.SUMMONABLE,
        `${receipt.knightType}`);

    section('Claim ABI (the deployed V4 only knows the knightType tuple)');
    // The contract's struct is (knightIds, dungeonId, reward, nonce, expiry, knightType,
    // signature). A client ABI without `knightType` computes a **different selector**, and
    // the deployed contract has no function for it: the call reverts before the signature
    // is checked, so the player sees no wallet prompt and no transaction. The digest tests
    // above cannot catch it — they never look at the ABI — which is why it is pinned here.
    //
    // Prefixes only (the ABI line continues `[] runs) external`), so this matches the
    // declaration however the rest of the line is written.
    const tupleTypes = '(uint256[],uint256,uint256,uint256,uint256,uint8,bytes)[]';
    const oldTupleTypes = '(uint256[],uint256,uint256,uint256,uint256,bytes)[]';
    const selector = ethers.utils.id(`claimSignedRuns(${tupleTypes})`).slice(0, 10);
    const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'dungeon-session.js'), 'utf8');
    rec('the client ABI declares the knightType tuple', client.includes(`claimSignedRuns(${tupleTypes}`));
    rec('the client ABI no longer declares the old tuple', !client.includes(`claimSignedRuns(${oldTupleTypes}`));

    // Checked against the live contract with an eth_call: `No runs` means it was found.
    rec('that selector is the one the deployed V4 accepts', selector === '0x92f442bb', selector);

    section('Degraded mode');
    const savedV4 = runs.ADDRESSES.gameV4;
    runs.ADDRESSES.gameV4 = '';
    rec('signing is off without a V4 address', runs.signingReady() === false);
    runs.ADDRESSES.gameV4 = savedV4;
}

// --------------------------------------------------------------------------- live

async function api(base, path, { method = 'GET', body, token } = {}) {
    const res = await fetch(`${base}${path}`, {
        method,
        headers: {
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let data = null;
    try {
        data = await res.json();
    } catch {
        data = {};
    }
    return { status: res.status, data };
}

/**
 * A wallet session for an address, minted with the server's own issuer so the token
 * format is never duplicated here — if the session format changes, this breaks loudly
 * instead of quietly testing nothing.
 */
let sessionIssuer = null;
async function sessionFor(address) {
    if (!sessionIssuer) sessionIssuer = await import('../lib/points-session.js');
    return sessionIssuer.issueToken(address).token;
}

async function live(base) {
    const provider = new ethers.providers.JsonRpcProvider(RPC);
    const nft = new ethers.Contract(NFT, [
        'function ownerOf(uint256) view returns (address)',
        'function balanceOf(address) view returns (uint256)',
        'function getKnightInfo(uint256) view returns (address, uint8, string)',
    ], provider);

    section('Live API — config');
    const config = await api(base, '/api/game/config');
    rec('config is served', config.status === 200);
    rec('V4 address is published', !!config.data.v4, config.data.v4 || 'null');

    section('Live API — authentication');
    const anon = await api(base, '/api/game/start', { method: 'POST', body: { knightIds: [1], dungeonId: 1 } });
    rec('starting a run without a session is 401', anon.status === 401, `${anon.status}`);

    // Find a knight that actually exists on chain, and who owns it.
    let knightId = null;
    let owner = null;
    for (let id = 1; id <= 60 && !knightId; id++) {
        try {
            const candidate = await nft.ownerOf(id);
            if (candidate && candidate !== ethers.constants.AddressZero) {
                knightId = id;
                owner = candidate;
            }
        } catch { /* not minted */ }
    }
    if (!knightId) {
        rec('found a knight to test with', false, 'no knights minted on this chain');
        return;
    }
    rec(`found knight #${knightId}`, true, `owner ${owner}`);

    const session = await sessionFor(owner);

    section('Live API — run token');
    const started = await api(base, '/api/game/start', {
        method: 'POST',
        token: session,
        body: { knightIds: [knightId], dungeonId: 1 },
    });
    rec('a run starts and returns a token', started.status === 200 && !!started.data.runToken,
        started.data.error || `min ${started.data.minSeconds}s`);
    if (!started.data.runToken) return;

    const badDungeon = await api(base, '/api/game/start', {
        method: 'POST', token: session, body: { knightIds: [knightId], dungeonId: 99 },
    });
    rec('an unknown dungeon is refused', badDungeon.status === 400, `${badDungeon.status}`);

    section('Live API — too fast to sign');
    const early = await api(base, '/api/game/complete', {
        method: 'POST', token: session, body: { runToken: started.data.runToken },
    });
    const earlyIsRight = early.status === 409 && early.data.retryAfter > 0;
    rec('a run that is too fast is refused, with a retry hint', earlyIsRight,
        earlyIsRight ? `wait ${early.data.retryAfter}s` : `${early.status} ${early.data.error || ''}`);

    section('Live API — forgery');
    const forged = await api(base, '/api/game/complete', {
        method: 'POST', token: session, body: { runToken: 'Zm9yZ2Vk.deadbeef' },
    });
    rec('a forged run token is refused', forged.status === 400, `${forged.status}`);

    const otherSession = await sessionFor('0x2222222222222222222222222222222222222222');
    const foreign = await api(base, '/api/game/complete', {
        method: 'POST', token: otherSession, body: { runToken: started.data.runToken },
    });
    rec("another wallet cannot finish someone else's run", foreign.status === 403, `${foreign.status}`);

    const wild = await api(base, '/api/game/complete', {
        method: 'POST', token: session, body: { runToken: started.data.runToken, kills: 500 },
    });
    rec('an impossible kill count is refused as malformed', wild.status === 400, `${wild.status} ${wild.data.error || ''}`);

    const wildPair = await api(base, '/api/game/complete', {
        method: 'POST', token: session, body: { runToken: started.data.runToken, kills: 60, totalNodes: 50 },
    });
    rec('more kills than monsters is refused', wildPair.status === 400, `${wildPair.status} ${wildPair.data.error || ''}`);

    section('Live API — the valid path');
    const wait = Math.max(0, (early.data.retryAfter || 0) + 1);
    if (wait) {
        console.log(`  ..    waiting ${wait}s for the run to age`);
        await new Promise((r) => setTimeout(r, wait * 1000));
    }

    const done = await api(base, '/api/game/complete', {
        method: 'POST', token: session, body: { runToken: started.data.runToken, kills: 40, totalNodes: 60, chests: 2 },
    });
    rec('a valid run is signed', done.status === 200 && !!done.data.receipt, done.data.error || '');

    if (done.data.receipt) {
        const receipt = done.data.receipt;
        const signer = new ethers.Wallet(process.env.GAME_SIGNER_PRIVATE_KEY).address;
        const digest = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(
            ['address', 'bytes32', 'uint256', 'uint256', 'uint256', 'uint256', 'uint8', 'uint256', 'address'],
            [
                owner.toLowerCase(),
                ethers.utils.solidityKeccak256(['uint256[]'], [[knightId]]),
                receipt.dungeonId,
                receipt.reward,
                receipt.nonce,
                receipt.expiry,
                receipt.knightType,
                Number(process.env.GAME_CHAIN_ID || 46630),
                config.data.v4,
            ]
        ));
        const signed = ethers.utils.keccak256(ethers.utils.concat([
            ethers.utils.toUtf8Bytes('\x19Ethereum Signed Message:\n32'),
            ethers.utils.arrayify(digest),
        ]));
        const recovered = ethers.utils.recoverAddress(signed, receipt.signature);
        rec('the live receipt recovers to the signer', recovered.toLowerCase() === signer.toLowerCase(), recovered);
        rec('the live receipt is bound to the caller', recovered.toLowerCase() !== '0x0000000000000000000000000000000000000000');

        const rarity = (await nft.getKnightInfo(knightId))[1];
        // Priced against the contract that actually signed this receipt, not a hard-coded
        // ladder: V4 pays the published table (12/20/36/60/100) and V3 the older one, so a
        // fixed list is only ever right for one of the two paths.
        const pricing = new ethers.Contract(
            config.data.v4 || config.data.v3,
            ['function rarityReward(uint256) view returns (uint256)'],
            provider
        );
        const onChain = await pricing.rarityReward(rarity).catch(() => null);
        rec('the reward is priced from on-chain rarity',
            onChain !== null && receipt.reward.eq(onChain),
            `${ethers.utils.formatEther(receipt.reward)} DNG for rarity ${rarity}`
            + (onChain === null ? ' (the table could not be read)' : ` (the chain pays ${ethers.utils.formatEther(onChain)})`));
    }

    section('Live API — ownership');
    // A knight that exists but belongs to someone else must be refused for this wallet.
    let foreignKnight = null;
    for (let id = 1; id <= 60 && !foreignKnight; id++) {
        try {
            const candidate = await nft.ownerOf(id);
            if (candidate && candidate.toLowerCase() !== owner.toLowerCase()) foreignKnight = id;
        } catch { /* not minted */ }
    }
    if (foreignKnight) {
        const stealStart = await api(base, '/api/game/start', {
            method: 'POST', token: session, body: { knightIds: [foreignKnight], dungeonId: 1 },
        });
        // Age it first, so the refusal can only come from the ownership check rather
        // than the clock.
        await new Promise((r) => setTimeout(r, (stealStart.data.minSeconds || 1) * 1000 + 1200));
        const steal = await api(base, '/api/game/complete', {
            method: 'POST', token: session, body: { runToken: stealStart.data.runToken },
        });
        rec("a knight owned by someone else cannot be claimed", steal.status === 400,
            `${steal.status} ${steal.data.error || ''}`);
    } else {
        console.log('  ..    only one owner on chain — ownership refusal not exercised');
    }
}

// -------------------------------------------------------------------------- main

async function degraded(base) {
    section('Degraded mode (no V4 configured)');
    const config = await api(base, '/api/game/config');
    rec('config reports no V4 address', config.status === 200 && !config.data.v4, JSON.stringify(config.data.v4));
    rec('config reports signing off', config.data.signing === false);

    const session = await sessionFor('0x1111111111111111111111111111111111111111');
    const started = await api(base, '/api/game/start', {
        method: 'POST', token: session, body: { knightIds: [1], dungeonId: 1 },
    });
    rec('starting a run degrades with 503, not an error', started.status === 503, `${started.status}`);
    rec('the client can tell it should fall back', /not configured/.test(started.data.error || ''), started.data.error || '');
}

(async () => {
    console.log('');
    console.log('Signed-run gate');
    await unit();
    if (BASE) await live(BASE);
    if (DEGRADED_BASE) await degraded(DEGRADED_BASE);
    console.log('');

    const failed = results.filter((r) => !r.pass);
    console.log(`${results.length - failed.length}/${results.length} checks passed`);
    for (const f of failed) console.log(`  FAILED: ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
    console.log('');
    process.exit(failed.length ? 1 : 0);
})().catch((error) => {
    console.error('Harness failed:', error);
    process.exit(1);
});
