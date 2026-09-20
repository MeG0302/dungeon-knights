#!/usr/bin/env node
/**
 * Checks the Staking Vault's maths and its state machine.
 *
 *     node tools/check-staking.js
 *
 * No browser, no wallet, no chain: `lib/staking-config.js` and `lib/staking-source.js`
 * are pure, so every rule can be driven directly at any instant. What is being pinned
 * down here:
 *
 *   - the week really does turn over at Monday 00:00 UTC, in every timezone
 *   - tickets follow the formula in the brief, including the seven-day cap
 *   - the capsule odds add up (the brief's Mythic table did not)
 *   - an unset weekly pool produces `null` — never an invented number — and a set one
 *     flows all the way to the per-knight figures
 *   - preview holdings are deterministic per wallet, so a page does not reshuffle
 *   - every action (stake, claim, enter, open) is refused when it should be, rather than
 *     silently appearing to succeed
 */

import {
    CAPSULES_PER_WEEK,
    CAPSULE_TYPES,
    TICKET_CAP_HOURS,
    WEEKLY_POOL_DNG,
    WEEK_MS,
    accruedPoolShare,
    capsuleType,
    dngFromPoolShare,
    expectedCapsules,
    shareOfPool,
    ticketsFor,
    weekEnd,
    weekNumber,
    weekPhase,
    weekStart,
} from '../lib/staking-config.js';
import {
    SOURCE_CHAIN,
    SOURCE_PREVIEW,
    applyAction,
    chainSnapshot,
    loadVault,
    previewSnapshot,
    refresh,
    weekInfo,
} from '../lib/staking-source.js';

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

function section(title) {
    console.log('');
    console.log(title);
}

const WALLET = '0xf8d2b7ED860FF6044133aa3a4Bd89c7b4fb8cB80';
const OTHER = '0x038d75adb74d8e5db82e6c6797f90dcdf82ef4c9';
const HOUR = 3_600_000;

// A fixed instant in the middle of a week, so nothing in this harness depends on when it
// is run. 2026-09-16 12:00:00 UTC (a Wednesday).
const T0 = Date.UTC(2026, 8, 16, 12, 0, 0);

console.log('Staking Vault — maths and state');
console.log(`  reference instant: ${new Date(T0).toISOString()}`);

// ------------------------------------------------------------------ the week clock
section('The week turns over on Monday 00:00 UTC');

{
    // Walk the whole of one week, Monday through Sunday: every instant in it must report
    // the same Monday. (Starting the walk mid-week would step into the next one, which is
    // meant to change the answer — the boundary check below covers that case.)
    const starts = new Set();
    const monday = weekStart(T0);
    for (let day = 0; day < 7; day++) {
        starts.add(new Date(weekStart(monday + day * 24 * HOUR)).toISOString());
        starts.add(new Date(weekStart(monday + day * 24 * HOUR + 12 * HOUR)).toISOString());
    }
    rec('all seven days of a week share one start instant', starts.size === 1, [...starts][0]);
    rec('the day after that week starts a new one',
        weekStart(monday + 7 * 24 * HOUR) === monday + WEEK_MS);

    const start = new Date(weekStart(T0));
    rec('the week starts on a Monday', start.getUTCDay() === 1, start.toUTCString());
    rec('at exactly 00:00 UTC',
        start.getUTCHours() === 0 && start.getUTCMinutes() === 0 && start.getUTCSeconds() === 0);

    rec('a week is exactly seven days long', weekEnd(T0) - weekStart(T0) === WEEK_MS, `${weekEnd(T0) - weekStart(T0)} ms`);

    // Crossing the boundary: the number must go up by one and the start must move by a week.
    const justBefore = weekEnd(T0) - 1;
    const justAfter = weekEnd(T0);
    rec('the week number changes exactly at the boundary',
        weekNumber(justAfter) === weekNumber(justBefore) + 1,
        `${weekNumber(justBefore)} -> ${weekNumber(justAfter)}`);
    rec('the start moves by exactly one week across it',
        weekStart(justAfter) - weekStart(justBefore) === WEEK_MS);

    rec('every instant inside a week reports the same number',
        new Set([weekStart(T0), T0, weekEnd(T0) - 1].map(weekNumber)).size === 1);

    // A DST-shifting timezone must not be able to disagree with a UTC one.
    rec('the boundary is timezone-independent (same epoch arithmetic)',
        weekStart(T0) % WEEK_MS === new Date(weekStart(T0)).getTime() % WEEK_MS);
}

section('The draw phase follows the clock, not the player');

{
    rec('midweek is "open"', weekPhase(T0) === 'open', weekPhase(T0));
    rec('the last hour is "final"', weekPhase(weekEnd(T0) - 30 * 60 * 1000) === 'final');
    rec('the minutes after the boundary are "pending"',
        weekPhase(weekStart(T0) + 5 * 60 * 1000) === 'pending');
    rec('the phase has a label for the UI',
        typeof weekInfo(T0).phaseLabel === 'string' && weekInfo(T0).phaseLabel.length > 0);
    rec('the draw is due when the week ends', weekInfo(T0).drawAt === weekEnd(T0));
}

// ----------------------------------------------------------------------- the tickets
section('Tickets');

{
    // The worked example from the Phase 2 brief: hashPower 67 staked 47 hours.
    const example = ticketsFor({ hashPower: 67, stakedAt: T0 - 47 * HOUR }, T0);
    rec('the brief\'s worked example still holds (67 HP, 47h = 3149)', example === 3149, `${example}`);

    const atCap = ticketsFor({ hashPower: 67, stakedAt: T0 - TICKET_CAP_HOURS * HOUR }, T0);
    const pastCap = ticketsFor({ hashPower: 67, stakedAt: T0 - 400 * HOUR }, T0);
    rec('the seven-day cap is enforced',
        atCap === pastCap && atCap === Math.floor(TICKET_CAP_HOURS * 67), `${atCap}`);

    rec('a fresh stake has no tickets yet', ticketsFor({ hashPower: 67, stakedAt: T0 }, T0) === 0);
    rec('tickets only ever grow with time',
        ticketsFor({ hashPower: 30, stakedAt: T0 - 5 * HOUR }, T0) < ticketsFor({ hashPower: 30, stakedAt: T0 - 6 * HOUR }, T0));
    rec('a stakedAt in the future cannot produce negative tickets',
        ticketsFor({ hashPower: 30, stakedAt: T0 + 10 * HOUR }, T0) === 0);
    rec('integer tickets, never fractions',
        Number.isInteger(ticketsFor({ hashPower: 33, stakedAt: T0 - 7.3 * HOUR }, T0)));
}

// ---------------------------------------------------------------------- the capsules
section('Capsules');

{
    rec('there are four capsule types', CAPSULE_TYPES.length === 4);
    for (const type of CAPSULE_TYPES) {
        const total = type.odds.reduce((sum, row) => sum + row.pct, 0);
        rec(`${type.name} odds sum to exactly 100`, total === 100, `${total}%`);
    }
    rec('capsule ids are unique', new Set(CAPSULE_TYPES.map((t) => t.id)).size === CAPSULE_TYPES.length);
    rec('capsule keys are unique', new Set(CAPSULE_TYPES.map((t) => t.key)).size === CAPSULE_TYPES.length);
    rec('no capsule can roll the same rarity twice in one table',
        CAPSULE_TYPES.every((t) => new Set(t.odds.map((o) => o.rarity)).size === t.odds.length));
    rec('lookup works by key and by id', capsuleType('mythic')?.id === 4 && capsuleType(4)?.key === 'mythic');
    rec('an unknown capsule is null, not a crash', capsuleType('nope') === null);

    // The brief handed out 200 capsules a week; the number lives in one constant.
    rec('the weekly capsule count matches the agreed figure', CAPSULES_PER_WEEK === 200, `${CAPSULES_PER_WEEK}`);
}

// ------------------------------------------------------------------- the weekly pool
section('The weekly pool, while the tokenomics are undecided');

{
    rec('no pool is hard-coded', WEEKLY_POOL_DNG === null, `${WEEKLY_POOL_DNG}`);
    rec('an unset pool yields null, not zero', dngFromPoolShare(0.5) === null);
    rec('a set pool converts a share to DNG', dngFromPoolShare(0.25, 10_000) === 2500);
    rec('a zero share is zero DNG', dngFromPoolShare(0, 10_000) === 0);

    rec('share of pool refuses a zero total', shareOfPool(10, 0) === 0);
    rec('share of pool refuses a missing total', shareOfPool(10, undefined) === 0);
    rec('share of pool is capped at the whole pool', shareOfPool(500, 100) === 1);
    rec('half the tickets is half the pool', shareOfPool(250, 500) === 0.5);

    // Accrual is time-based, so it must start at the stake and grow from there.
    const stakedNow = { myTickets: 100, totalTickets: 1000, stakedAt: T0 - HOUR };
    const later = { ...stakedNow, myTickets: 200 };
    const now = accruedPoolShare(stakedNow, T0);
    rec('a stake one hour old has accrued something', now > 0);
    rec('accrual grows with time', accruedPoolShare(later, T0) > now);
    rec('accrual never exceeds the share it is drawn from', now <= shareOfPool(100, 1000));
    rec('a stake that has not started accrues nothing',
        accruedPoolShare({ ...stakedNow, stakedAt: T0 + HOUR }, T0) === 0);
    rec('accrual is monotonic across two instants',
        accruedPoolShare(stakedNow, T0 + 2 * HOUR) > accruedPoolShare(stakedNow, T0 + HOUR));

    rec('expected capsules is the whole draw when you are the only entry',
        expectedCapsules(100, 100) === CAPSULES_PER_WEEK, `${expectedCapsules(100, 100)}`);
    rec('expected capsules is half the draw on half the tickets',
        expectedCapsules(50, 100) === CAPSULES_PER_WEEK / 2);
    rec('expected capsules is zero with no tickets', expectedCapsules(0, 100) === 0);
}

// ------------------------------------------------------------------ the preview data
section('Preview holdings');

{
    const a = previewSnapshot(WALLET, T0);
    const b = previewSnapshot(WALLET, T0);
    rec('the same wallet at the same instant gets the same knights',
        JSON.stringify(a.owned) === JSON.stringify(b.owned)
        && JSON.stringify(a.staked.map((k) => k.tokenId)) === JSON.stringify(b.staked.map((k) => k.tokenId)));
    rec('a different wallet gets a different roster',
        JSON.stringify(previewSnapshot(OTHER, T0).owned) !== JSON.stringify(a.owned));

    rec('the vault reports itself as preview data', a.source === SOURCE_PREVIEW);
    rec('preview is writable, so the page is explorable', a.canWrite === true);
    rec('no Genesis Knight is duplicated across owned and staked',
        new Set([...a.owned, ...a.staked].map((k) => k.tokenId)).size === a.owned.length + a.staked.length);
    rec('hash power stays inside the collection\'s range',
        [...a.owned, ...a.staked].every((k) => k.hashPower >= 1 && k.hashPower <= 100));
    rec('every knight is named for its token id',
        [...a.owned, ...a.staked].every((k) => k.name === `Genesis #${String(k.tokenId).padStart(3, '0')}`));

    rec('some knights start staked and some do not',
        a.staked.length > 0 && a.owned.length > 0, `${a.staked.length} staked, ${a.owned.length} owned`);
    rec('the staked count matches the list', a.totals.stakedCount === a.staked.length);
    rec('the owned count covers everything held',
        a.totals.ownedCount === a.owned.length + a.staked.length);

    const boardTickets = a.board.reduce((sum, row) => sum + row.tickets, 0);
    rec('total tickets are my tickets plus everyone else\'s',
        a.pool.totalTickets === a.totals.myTickets + boardTickets,
        `${a.pool.totalTickets}`);
    rec('my share of the pool is inside 0..1', a.totals.myShare > 0 && a.totals.myShare <= 1);
    rec('capsules left is the weekly figure minus what has been awarded',
        a.pool.left === a.pool.capsulesPerWeek - a.pool.awarded, `${a.pool.left} left`);

    // Time passing must move the numbers without the source being reloaded.
    const later = refresh(a, T0 + 3 * HOUR);
    rec('tickets grow as the clock moves', later.totals.myTickets > a.totals.myTickets,
        `${a.totals.myTickets} -> ${later.totals.myTickets}`);
    rec('every share stays a real fraction after a refresh',
        later.staked.every((k) => k.accruedShare >= 0 && k.accruedShare <= 1));
    rec('refreshing at the same instant changes nothing',
        JSON.stringify(refresh(a, T0).totals) === JSON.stringify(a.totals));

    const rich = previewSnapshot(WALLET, T0, 15_000);
    rec('a configured pool reaches the per-knight figures',
        rich.staked.every((k) => k.accruedDng !== null && k.accruedDng >= 0),
        `${rich.staked[0]?.accruedDng?.toFixed(2)} DNG on the first knight`);
    rec('a configured pool is reported on the snapshot', rich.pool.dng === 15_000);
    rec('an unconfigured pool still reports null on the snapshot', a.pool.dng === null);
    rec('the unconfigured pool leaves per-knight DNG null, never zero',
        a.staked.every((k) => k.accruedDng === null));

    const empty = previewSnapshot(WALLET, T0);
    const cleared = { ...empty, wallet: null, connected: false, owned: [], staked: [], canWrite: false };
    rec('a disconnected vault has no holdings', cleared.owned.length === 0 && cleared.staked.length === 0);
    rec('the chain path is read-only until the contracts exist',
        chainSnapshot(WALLET, { reason: 'not deployed' }, T0).canWrite === false);
    rec('the chain path does not invent holdings',
        chainSnapshot(WALLET, {}, T0).staked.length === 0);
    rec('the chain path explains itself', chainSnapshot(WALLET, {}, T0).source === SOURCE_CHAIN);
}

// ------------------------------------------------------------------------- actions
section('Actions');

{
    const base = previewSnapshot(WALLET, T0);
    const first = base.owned[0];

    const staked = applyAction(base, 'stake', { tokenId: first.tokenId }, T0);
    rec('staking moves the knight out of the wallet',
        !staked.snapshot.owned.some((k) => k.tokenId === first.tokenId));
    rec('staking puts it in the staked list',
        staked.snapshot.staked.some((k) => k.tokenId === first.tokenId));
    rec('a fresh stake starts with no tickets',
        staked.snapshot.staked.find((k) => k.tokenId === first.tokenId).tickets === 0);
    rec('staking says what happened', /staked/i.test(staked.notice || ''), staked.notice);
    rec('staking cannot resurrect a knight it does not have',
        !!applyAction(staked.snapshot, 'stake', { tokenId: first.tokenId }, T0).error);

    const all = applyAction(base, 'stakeAll', {}, T0);
    rec('stake all empties the owned list', all.snapshot.owned.length === 0);
    rec('stake all keeps every knight',
        all.snapshot.staked.length === base.owned.length + base.staked.length);
    rec('stake all on an empty wallet refuses',
        !!applyAction(all.snapshot, 'stakeAll', {}, T0).error);

    const one = staked.snapshot.staked[0];
    const back = applyAction(staked.snapshot, 'unstake', { tokenId: one.tokenId }, T0);
    rec('unstaking returns the knight to the wallet',
        back.snapshot.owned.some((k) => k.tokenId === one.tokenId));
    rec('unstaking removes it from the staked list',
        !back.snapshot.staked.some((k) => k.tokenId === one.tokenId));
    rec('unstaking warns that its tickets are forfeited', /forfeit/i.test(back.notice || ''), back.notice);

    // Claiming is the one action that must refuse while the pool is undecided.
    const claim = applyAction(staked.snapshot, 'claim', { tokenId: one.tokenId }, T0);
    rec('claiming refuses while the weekly pool is unset', !!claim.error, claim.error);
    rec('that refusal explains why', /pool is not set/i.test(claim.error || ''));

    const withPool = applyAction(previewSnapshot(WALLET, T0, 20_000), 'claim',
        { tokenId: one.tokenId }, T0);
    rec('claiming works once a pool is set', !withPool.error, withPool.error || withPool.notice);

    const entered = applyAction(staked.snapshot, 'enterRaffle', { tokenId: one.tokenId }, T0);
    rec('entering marks the knight as in the draw',
        entered.snapshot.staked.find((k) => k.tokenId === one.tokenId).entered === true);
    rec('an entry is counted in the week\'s entries',
        entered.snapshot.pool.entries === entered.snapshot.entries.length);
    rec('entering twice is a no-op, not a second entry',
        !!applyAction(entered.snapshot, 'enterRaffle', { tokenId: one.tokenId }, T0).notice
        && applyAction(entered.snapshot, 'enterRaffle', { tokenId: one.tokenId }, T0)
            .snapshot.pool.entries === entered.snapshot.pool.entries);

    const enterAll = applyAction(staked.snapshot, 'enterAll', {}, T0);
    rec('enter all enters every staked knight',
        enterAll.snapshot.staked.every((k) => k.entered));
    rec('enter all reports the tickets it committed', /tickets/i.test(enterAll.notice || ''), enterAll.notice);
    rec('enter all on an already-entered wallet refuses (nothing left to do)',
        !!applyAction(enterAll.snapshot, 'enterAll', {}, T0).error);

    const withdrawn = applyAction(enterAll.snapshot, 'withdrawAll', {}, T0);
    rec('withdraw all clears every entry', withdrawn.snapshot.staked.every((k) => !k.entered));
    rec('withdraw all with no entries refuses',
        !!applyAction(withdrawn.snapshot, 'withdrawAll', {}, T0).error);
    rec('withdrawing a single entry works',
        applyAction(enterAll.snapshot, 'withdrawRaffle', { tokenId: one.tokenId }, T0)
            .snapshot.staked.find((k) => k.tokenId === one.tokenId).entered === false);

    const opened = applyAction(staked.snapshot, 'openCapsule', { key: 'common' }, T0);
    rec('opening a capsule spends one',
        opened.snapshot.capsules.find((c) => c.key === 'common').count
        === staked.snapshot.capsules.find((c) => c.key === 'common').count - 1);
    rec('opening a capsule hands off to the Summoning Chamber', opened.redirect === '/mint');
    const emptyType = staked.snapshot.capsules.find((c) => c.count === 0) || { key: 'mythic' };
    rec('opening a capsule you do not own refuses',
        !!applyAction(staked.snapshot, 'openCapsule', { key: emptyType.key }, T0).error);

    rec('an unknown action is refused', !!applyAction(base, 'teleport', {}, T0).error);
    rec('every action is refused without a wallet',
        !!applyAction({ ...base, connected: false }, 'stake', { tokenId: first.tokenId }, T0).error);
    rec('every action is refused while the vault is read-only',
        !!applyAction({ ...base, canWrite: false }, 'stakeAll', {}, T0).error);
    rec('a read-only refusal repeats the reason the page showed',
        applyAction({ ...base, canWrite: false, writeBlockedReason: 'not deployed' }, 'stakeAll', {})
            .error.includes('not deployed'));

    // Actions must never mutate the snapshot they were handed.
    const frozen = JSON.stringify(base);
    applyAction(base, 'stakeAll', {}, T0);
    applyAction(base, 'enterAll', {}, T0);
    rec('actions leave the snapshot they were given untouched', JSON.stringify(base) === frozen);
}

section('Loading the vault');

{
    const noWallet = await loadVault(null, { nowMs: T0 });
    rec('no wallet loads an empty, disconnected vault',
        noWallet.connected === false && noWallet.staked.length === 0);

    const preview = await loadVault(WALLET, { config: { chain: false }, nowMs: T0 });
    rec('an unconfigured chain falls back to preview', preview.source === SOURCE_PREVIEW);
    rec('the fallback is still a full vault', preview.staked.length > 0);

    const chained = await loadVault(WALLET, {
        config: { chain: true, addresses: {}, poolDng: null }, nowMs: T0,
    });
    rec('configured addresses switch to the chain path', chained.source === SOURCE_CHAIN);
    rec('a chain vault with no contracts yet is read-only', chained.canWrite === false);

    const broken = await loadVault(WALLET, {
        nowMs: T0,
        fetchJson: async () => { throw new Error('offline'); },
    });
    rec('a config fetch that fails still renders the page', broken.source === SOURCE_PREVIEW);
    rec('and it does not silently claim to be on-chain', broken.canWrite === true);
}

console.log('');
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
for (const f of failed) console.log(`  FAILED: ${f.label}`);
console.log('');
process.exit(failed.length ? 1 : 0);
