#!/usr/bin/env node
/**
 * Does the Points Program hold its rules under concurrency — and does it refuse to pay without a
 * bound X account?
 *
 *     node tools/check-points-guard.js http://localhost:3000
 *
 * The original bug this exists for was measured on production: with no shared store, six concurrent
 * re-clears of the *same* floor credited the wallet five times, and ten concurrent balance reads
 * disagreed with each other. Sequentially everything looked perfect, which is why it survived so
 * long — a single player clicking through the vault is sequential traffic. It shows up the moment
 * two requests overlap.
 *
 * Since then the program grew a gate and two verified rewards, so the harness does three jobs:
 *
 *   - the **gate**: nothing is paid to a wallet with no bound X account, whatever it asks for;
 *   - the **guards**: N concurrent clears pay once, N concurrent unpriced shares pay nothing at
 *     all, N concurrent reads agree, and floors cannot be claimed out of order;
 *   - the **throttle**: the same post cannot be re-checked on demand.
 *
 * It talks to a real server on purpose — this is the layer where a request is a string and the
 * answer is a status code, and the offline harness (`check-points-x.js`) cannot prove that the
 * routes wire the rules up. It needs one thing of the server: the same `POINTS_SESSION_SECRET`
 * this script uses. In development neither sets one, so the shared dev fallback is used and this
 * just works; against a deployment with a secret set, pass `POINTS_SESSION_SECRET` in the
 * environment to both.
 *
 * Every URL it submits points at a post that does not exist, so it never depends on a real post
 * being up — and the "not visible to X yet" answer is a state the program has to handle anyway.
 */

const crypto = require('crypto');

const BASE = process.argv[2] || 'http://localhost:3000';
const CONCURRENCY = 8;

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

async function api(path, { method = 'GET', body, token } = {}) {
    const res = await fetch(`${BASE}${path}`, {
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

(async () => {
    console.log('');
    console.log(`Points guard — ${BASE}, ${CONCURRENCY}-way concurrency`);

    const session = await import('../lib/points-session.js');

    // A fresh wallet and a fresh handle every run, so nothing needs resetting and runs cannot
    // interfere — including through the one-handle-one-wallet index, which is persistent.
    const fresh = () => `0x${crypto.randomBytes(20).toString('hex')}`;
    const freshHandle = () => `harness${crypto.randomBytes(4).toString('hex')}`;

    const address = fresh();
    const handle = freshHandle();
    const token = session.issueToken(address).token;

    console.log('');
    console.log('Setup');
    const started = await api('/api/points/session?address=' + address);
    rec('the API is reachable', started.status === 200, `${started.status}`);

    // ------------------------------------------------------------------------- the gate
    console.log('');
    console.log('The earning gate');

    const unbound = await api('/api/points/vault', {
        method: 'POST', token, body: { action: 'clear', level: 0 },
    });
    rec('a wallet with no X account is refused, by code',
        unbound.status === 400 && unbound.data?.code === 'x-required', `${unbound.status} ${unbound.data?.code}`);
    rec('and is paid nothing',
        (await api('/api/points/me', { token })).data?.state?.points === 0, '0 PTS');

    const bind = await api('/api/points/x', {
        method: 'POST', token, body: { action: 'bind', identity: { username: handle } },
    });
    rec('binding a handle opens the gate',
        bind.status === 200 && bind.data?.ok === true, `${bind.status} @${bind.data?.x?.username}`);
    rec('  … and the state reports it as bound but unproved',
        (await api('/api/points/me', { token })).data?.state?.canEarn === true, '');
    rec('  … and says the campaign is not configured on this deployment',
        (await api('/api/points/me', { token })).data?.state?.tasks?.campaign === null, '');

    // ------------------------------------------------------------------ floors
    console.log('');
    console.log('Concurrent clears of the same floor');

    const clears = await Promise.all(
        Array.from({ length: CONCURRENCY }, () => api('/api/points/vault', {
            method: 'POST', token, body: { action: 'clear', level: 0 },
        }))
    );

    const paid = clears.filter((r) => (r.data?.credited || 0) > 0);
    const creditedTotal = clears.reduce((sum, r) => sum + (r.data?.credited || 0), 0);

    rec(`exactly one clear was paid (${paid.length} of ${CONCURRENCY})`, paid.length === 1,
        clears.map((r) => `${r.status}:${r.data?.credited ?? r.data?.error ?? ''}`).join(', '));
    rec('the total credited is one floor, not several', creditedTotal === 100, `${creditedTotal} PTS`);

    const me = await api('/api/points/me', { token });
    rec('the balance agrees with that', me.data?.state?.points === 100, `${me.data?.state?.points} PTS`);

    // ------------------------------------------------------------- the share, unpriced
    console.log('');
    console.log('The share cannot pay for a tap');

    const shares = await Promise.all(
        Array.from({ length: CONCURRENCY }, () => api('/api/points/vault', {
            method: 'POST', token, body: { action: 'share' },
        }))
    );
    const sharePaid = shares.filter((r) => (r.data?.credited || 0) > 0);
    rec(`no unpriced share paid (${sharePaid.length} of ${CONCURRENCY})`, sharePaid.length === 0,
        shares.map((r) => `${r.status}:${r.data?.code || r.data?.credited || ''}`).join(', '));
    rec('  … and every one of them was refused for the same reason',
        shares.every((r) => r.status === 400 && r.data?.code === 'missing'), `${shares[0]?.data?.code}`);
    rec('  … and the balance is untouched',
        (await api('/api/points/me', { token })).data?.state?.points === 100, '100 PTS');

    // ------------------------------------------------------- concurrent reads
    console.log('');
    console.log('Concurrent reads');
    const reads = await Promise.all(
        Array.from({ length: CONCURRENCY }, () => api('/api/points/me', { token }))
    );
    const points = [...new Set(reads.map((r) => r.data?.state?.points))];
    rec('every read agrees', points.length === 1, points.join(' / '));

    // ------------------------------------------------------ out-of-order guard
    console.log('');
    console.log('Order is still enforced under overlap');
    const other = fresh();
    const otherToken = session.issueToken(other).token;
    await api('/api/points/x', {
        method: 'POST', token: otherToken, body: { action: 'bind', identity: { username: freshHandle() } },
    });
    const jump = await api('/api/points/vault', {
        method: 'POST', token: otherToken, body: { action: 'clear', level: 2 },
    });
    rec('floor 3 cannot be claimed first', jump.status === 400, `${jump.status} ${jump.data?.error || ''}`);

    const burst = await Promise.all([
        api('/api/points/vault', { method: 'POST', token: otherToken, body: { action: 'clear', level: 0 } }),
        api('/api/points/vault', { method: 'POST', token: otherToken, body: { action: 'clear', level: 1 } }),
        api('/api/points/vault', { method: 'POST', token: otherToken, body: { action: 'clear', level: 2 } }),
    ]);
    const burstTotal = burst.reduce((sum, r) => sum + (r.data?.credited || 0), 0);
    rec('an overlapping burst never pays more than the floors it cleared',
        burstTotal <= 900, `${burstTotal} PTS (100+300+500 = 900 max)`);

    // -------------------------------------------------------------- the streak bonus
    // The bonus is paid when the third floor falls, once per day, and the ways it could pay twice
    // are the ways the floors themselves could: a replay, a fresh run of a day already finished,
    // and two clears landing at the same moment. Each is exercised on its own wallet, because a
    // streak is a per-wallet fact and a shared one would prove nothing.
    console.log('');
    console.log("The day's streak bonus");

    const runner = fresh();
    const runnerHandle = freshHandle();
    const runnerToken = session.issueToken(runner).token;
    await api('/api/points/x', {
        method: 'POST', token: runnerToken, body: { action: 'bind', identity: { username: runnerHandle } },
    });

    const streakBefore = (await api('/api/points/me', { token: runnerToken })).data?.state?.streak;
    rec('a wallet that has never run is on day one, unpaid',
        streakBefore?.days === 1 && streakBefore?.multiplier === 1 && streakBefore?.award === 150
        && streakBefore?.paid === false && streakBefore?.max === 15,
        `day ${streakBefore?.days} · ${streakBefore?.multiplier}× · ${streakBefore?.award} PTS`);

    const floorOne = await api('/api/points/vault', { method: 'POST', token: runnerToken, body: { action: 'clear', level: 0 } });
    const floorTwo = await api('/api/points/vault', { method: 'POST', token: runnerToken, body: { action: 'clear', level: 1 } });
    rec('the first two floors pay the floors, and no bonus',
        floorOne.data?.credited === 100 && floorTwo.data?.credited === 300
        && !floorOne.data?.streakAward && !floorTwo.data?.streakAward,
        `${floorOne.data?.credited} + ${floorTwo.data?.credited} PTS, streak ${floorOne.data?.streakAward || 0}/${floorTwo.data?.streakAward || 0}`);

    const floorThree = await api('/api/points/vault', { method: 'POST', token: runnerToken, body: { action: 'clear', level: 2 } });
    rec('the third floor pays the run and the day-one bonus',
        floorThree.data?.credited === 500 && floorThree.data?.streakAward === 150,
        `${floorThree.data?.credited} PTS + ${floorThree.data?.streakAward} PTS streak`);

    const runDone = (await api('/api/points/me', { token: runnerToken })).data?.state;
    rec('so the day pays 900 + 150, and the state says it is paid',
        runDone?.points === 1050 && runDone?.streak?.paid === true && runDone?.streak?.days === 1,
        `${runDone?.points} PTS · day ${runDone?.streak?.days} paid=${runDone?.streak?.paid}`);

    const replay = await api('/api/points/vault', { method: 'POST', token: runnerToken, body: { action: 'clear', level: 2 } });
    const encore = await api('/api/points/vault', { method: 'POST', token: runnerToken, body: { action: 'clear', level: 0 } });
    rec('replaying a floor pays nothing, and neither does starting the day again',
        replay.data?.alreadyCleared === true && !replay.data?.streakAward
        && encore.data?.alreadyCleared === true && !encore.data?.streakAward,
        `replay ${replay.data?.credited ?? 0} PTS · encore ${encore.data?.credited ?? 0} PTS`);
    rec('  … and the balance is still one run and one bonus',
        (await api('/api/points/me', { token: runnerToken })).data?.state?.points === 1050, '1050 PTS');

    const racer = fresh();
    const racerHandle = freshHandle();
    const racerToken = session.issueToken(racer).token;
    await api('/api/points/x', {
        method: 'POST', token: racerToken, body: { action: 'bind', identity: { username: racerHandle } },
    });
    await api('/api/points/vault', { method: 'POST', token: racerToken, body: { action: 'clear', level: 0 } });
    await api('/api/points/vault', { method: 'POST', token: racerToken, body: { action: 'clear', level: 1 } });
    const race = await Promise.all(Array.from({ length: CONCURRENCY }, () => api('/api/points/vault', {
        method: 'POST', token: racerToken, body: { action: 'clear', level: 2 },
    })));
    const raceFloors = race.reduce((sum, r) => sum + (r.data?.credited || 0), 0);
    const raceStreak = race.reduce((sum, r) => sum + (r.data?.streakAward || 0), 0);
    rec(`eight simultaneous third floors pay one bonus (${raceStreak} of 150)`,
        raceStreak === 150 && raceFloors === 500, `${raceFloors} PTS floors + ${raceStreak} PTS streak`);
    rec('  … and the racer ends the day on 900 + 150',
        (await api('/api/points/me', { token: racerToken })).data?.state?.points === 1050, '1050 PTS');

    // The wallets this section invented are removed rather than left on the board: it runs against
    // whatever store the server has (a shared one, on a deployment), and a harness that leaves fake
    // players behind is one nobody can run twice without polluting the leaderboard it just read.
    const { purgeWallet } = await import('../lib/points-store.js');
    await purgeWallet(runner, { handles: [runnerHandle] });
    await purgeWallet(racer, { handles: [racerHandle] });
    rec('the wallets this section created are cleaned up',
        !(await (await import('../lib/points-store.js')).getWallet(runner))
        && !(await (await import('../lib/points-store.js')).getWallet(racer)),
        'two wallets purged');

    // ------------------------------------------------------------------ the throttle
    console.log('');
    console.log('A post is not re-checked on demand');

    // Two links that are not posts. The first is not even the *shape* of one — a status id is long,
    // so this is refused before X is asked. The second has the shape and does not exist: X answers
    // 404, which the program has to hold as "not visible yet" and never as a payment.
    const notAPost = `https://x.com/${handle}/status/1`;
    const ghost = `https://x.com/${handle}/status/1900000000000000999`;

    const shapedWrong = await api('/api/points/task', {
        method: 'POST', token, body: { action: 'submit', task: 'share', url: notAPost },
    });
    rec('a link that is not the shape of a post is refused without asking X',
        shapedWrong.status === 400 && shapedWrong.data?.code === 'not-a-status-url',
        `${shapedWrong.status} ${shapedWrong.data?.code}`);
    const first = await api('/api/points/task', {
        method: 'POST', token, body: { action: 'submit', task: 'campaign', url: ghost },
    });
    const configured = first.status === 400 && first.data?.code === 'no-campaign';
    rec('with no campaign configured the task refuses to exist',
        configured, `${first.status} ${first.data?.code}`);

    const shareTask = await api('/api/points/task', {
        method: 'POST', token, body: { action: 'submit', task: 'share', url: ghost },
    });
    rec('a share whose post X cannot see is pending, not paid',
        shareTask.status === 200 && shareTask.data?.pending === true && !shareTask.data?.credited,
        `${shareTask.status} pending=${shareTask.data?.pending}`);
    rec('  … and the balance did not move',
        (await api('/api/points/me', { token })).data?.state?.points === 100, '100 PTS');

    const again = await api('/api/points/task', {
        method: 'POST', token, body: { action: 'submit', task: 'share', url: ghost },
    });
    rec('submitting the same link again is throttled, not re-checked',
        again.status === 429 && again.data?.code === 'throttled', `${again.status} ${again.data?.code}`);

    const check = await api('/api/points/task', {
        method: 'POST', token, body: { action: 'check', task: 'share' },
    });
    rec('and so is checking it again immediately',
        check.status === 429 && (check.data?.retryInSeconds || 0) > 0,
        `${check.status} retry in ${check.data?.retryInSeconds}s`);

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
