#!/usr/bin/env node
/**
 * Does a daily award survive concurrency?
 *
 *     node tools/check-points-guard.js http://localhost:3000
 *
 * The bug this exists for was measured on production: with no shared store, six
 * concurrent re-clears of the *same* floor credited the wallet five times, and ten
 * concurrent balance reads disagreed with each other. Sequentially everything looked
 * perfect, which is why it survived so long — a single player clicking through the vault
 * is sequential traffic. It shows up the moment two requests overlap.
 *
 * So this fires overlapping requests on purpose, with a fresh wallet each run so nothing
 * needs resetting:
 *
 *   - N concurrent clears of floor 1  -> exactly one payout
 *   - N concurrent shares             -> exactly one payout
 *   - N concurrent reads              -> one consistent number
 *
 * Requires the server to run with the same POINTS_SESSION_SECRET this script uses; the
 * session is minted with the real issuer rather than reimplemented.
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
    console.log('');
    console.log('Setup');

    // A fresh wallet every run, so no store reset is needed and runs cannot interfere.
    const fresh = () => `0x${crypto.randomBytes(20).toString('hex')}`;

    const address = fresh();
    const token = session.issueToken(address).token;
    const started = await api('/api/points/session?address=' + address);
    rec('the API is reachable', started.status === 200, `${started.status}`);

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

    // ------------------------------------------------------------- the share
    console.log('');
    console.log('Concurrent share claims');

    const shares = await Promise.all(
        Array.from({ length: CONCURRENCY }, () => api('/api/points/vault', {
            method: 'POST', token, body: { action: 'share' },
        }))
    );
    const sharePaid = shares.filter((r) => (r.data?.credited || 0) > 0);
    rec(`exactly one share was paid (${sharePaid.length} of ${CONCURRENCY})`, sharePaid.length === 1,
        shares.map((r) => `${r.status}:${r.data?.credited ?? r.data?.error ?? ''}`).join(', '));

    const afterShare = await api('/api/points/me', { token });
    rec('the balance is floor + one share bonus', afterShare.data?.state?.points === 200,
        `${afterShare.data?.state?.points} PTS`);

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
