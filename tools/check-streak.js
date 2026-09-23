#!/usr/bin/env node
/**
 * Does the daily streak pay what it promises, exactly once, and stop climbing where it should?
 *
 *     node tools/check-streak.js
 *
 * The streak is money: 150 points times the day a player is on, paid when they clear the third
 * floor, climbing to 15× and staying there. Every number a player can plan around is asserted
 * here, and so is every way it could pay twice — because the failure this cannot survive is not
 * "the wrong multiplier on day nine", it is a wallet that gets day fifteen's bonus on every clear.
 *
 * Two halves, both offline. `streakFor` is pure (a record, a day, an answer), so the whole
 * fifteen-day climb and the gap reset are walked without a clock. The wiring gets a source-level
 * check instead of a live one: that the third floor is the only place the bonus is settled, that
 * it is guarded and recorded before it is credited, and that the day's record is what stops a
 * second payout. The live proof — 900 + the bonus on the third clear and nothing on a replay —
 * is `check-points-guard.js`, which clears real floors against a running server.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    STREAK_BASE, STREAK_MAX_MULTIPLIER, VAULT_LEVELS, VAULT_ENTRY_TOTAL,
    previousDayKey, streakFor, todayKey,
} from '../lib/points-config.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

const PROGRAM = fs.readFileSync(path.join(ROOT, 'lib/points-program.js'), 'utf8');
const STORE = fs.readFileSync(path.join(ROOT, 'lib/points-store.js'), 'utf8');

/** A wallet record that cleared three floors on `lastDay` and is on day `days`. */
function docOn(days, lastDay) {
    return { streak: lastDay ? { days, lastDay, award: STREAK_BASE * Math.min(days, STREAK_MAX_MULTIPLIER) } : null };
}

console.log('');
console.log('the ladder — 150 points times the day, capped at 15×');
console.log('');

// ---------------------------------------------------------------- the climb
let wrong = [];
for (let day = 1; day <= STREAK_MAX_MULTIPLIER; day++) {
    // A wallet on day `day` today, with the run still alive: yesterday's record.
    const today = '2026-03-10';
    const yesterday = previousDayKey(today);
    const s = streakFor(docOn(day - 1, yesterday), today);
    const expectedAward = STREAK_BASE * day;
    if (s.days !== day || s.multiplier !== day || s.award !== expectedAward || s.paid) {
        wrong.push(`day ${day} → ${s.days}/${s.multiplier}×/${s.award}`);
    }
}
rec('days 1–15 pay 150 × the day, and the ladder is contiguous', wrong.length === 0,
    wrong.length ? wrong.join(', ') : `1× → ${STREAK_MAX_MULTIPLIER}× · ${STREAK_BASE} → ${STREAK_BASE * STREAK_MAX_MULTIPLIER} PTS`);

const day15 = streakFor(docOn(14, previousDayKey('2026-03-10')), '2026-03-10');
rec('day 15 is the full 15×', day15.multiplier === 15 && day15.award === 2250, `${day15.multiplier}× · ${day15.award} PTS`);

// ---------------------------------------------------------------- the cap
const capped = [16, 40, 365].map((day) => streakFor(docOn(day - 1, previousDayKey('2026-03-10')), '2026-03-10'));
rec('every day past fifteen still pays 15×, and keeps counting the days',
    capped.every((s) => s.multiplier === STREAK_MAX_MULTIPLIER && s.award === 2250 && s.capped)
    && capped.map((s) => s.days).join(',') === '16,40,365',
    capped.map((s) => `day ${s.days} → ${s.award}`).join(' · '));

// ---------------------------------------------------------------- the gap
const afterGap = streakFor(docOn(9, previousDayKey(previousDayKey('2026-03-10'))), '2026-03-10');
rec('a missed day starts the run again at 1×', afterGap.days === 1 && afterGap.award === STREAK_BASE,
    `day ${afterGap.days} → ${afterGap.award} PTS after a day off from day 9`);

const fresh = streakFor(null, '2026-03-10');
const blank = streakFor({}, '2026-03-10');
rec('a wallet that has never cleared a floor is on day one',
    fresh.days === 1 && fresh.award === STREAK_BASE && blank.days === 1,
    `${fresh.days} · ${fresh.award} PTS`);

// A month-old record is as broken as a one-day gap, and must not resume at day 31.
const stale = streakFor(docOn(30, '2025-01-05'), '2026-03-10');
rec('a long-dormant record does not resume where it left off',
    stale.days === 1 && stale.award === STREAK_BASE, `day ${stale.days}`);

// ---------------------------------------------------------------- once a day
const paidToday = streakFor({ streak: { days: 7, lastDay: '2026-03-10' } }, '2026-03-10');
rec('a day that has been paid reads as paid, at the day it was paid for',
    paidToday.paid === true && paidToday.days === 7 && paidToday.award === 1050,
    `paid=${paidToday.paid} · day ${paidToday.days} · ${paidToday.award} PTS`);
rec('and `paid` is what the payout refuses on — not the multiplier',
    /if \(streak\.paid\) return 0;/.test(PROGRAM));

// A record whose days were never written (a corrupted or hand-edited one) still cannot pay twice
// on the day it names: `paid` is decided by the day, not by the counter.
const paidNoDays = streakFor({ streak: { lastDay: '2026-03-10' } }, '2026-03-10');
rec('a paid day with no day count still refuses, and reports day one rather than zero',
    paidNoDays.paid === true && paidNoDays.days === 1 && paidNoDays.award === STREAK_BASE, `day ${paidNoDays.days}`);

// ---------------------------------------------------------------- the wiring
// `await` and not the name alone: the definition is `async function settleStreak(key, day)`, and
// an assertion that counts it as a second call site proves nothing.
const settles = (PROGRAM.match(/await settleStreak\(/g) || []).length;
rec('exactly one call site settles the streak', settles === 1, `${settles} call site(s)`);
rec('and it is behind the third floor, not every floor',
    /if \(cleared\.length \+ 1 >= VAULT_LEVELS\.length\) \{\s*\n\s*streakAward = await settleStreak\(key, day\);/.test(PROGRAM));
rec('the bonus is guarded by the day, the way a floor is guarded by the floor',
    /claimGuard\(`streak:\$\{key\}:\$\{day\}`\)/.test(PROGRAM));
rec('the record is written before the credit, so a failed payout cannot be claimed again',
    PROGRAM.indexOf('w.streak = { days: streak.days, lastDay: day, award: streak.award };')
        < PROGRAM.indexOf('return await credit(key, streak.award, `streak_day_${streak.days}`)'));
rec('the day the run is on is exposed to the page', /streak: streakFor\(doc, day\),/.test(PROGRAM));
rec('and a wallet record carries the field it is read from', /streak: null,/.test(STORE));

// The bonus is on top of the run, not folded into it. `entryTotalToday` is what the daily share
// doubles, so a streak added there would quietly double the bonus too — and the post a player
// publishes says the run's number, not that one.
const entryTotalBody = PROGRAM.slice(PROGRAM.indexOf('function entryTotalToday'), PROGRAM.indexOf('function taskView'));
rec('the run\'s total — what the share doubles — counts floors and nothing else',
    !/streak/i.test(entryTotalBody)
    && /VAULT_LEVELS\[i\]\??\.points/.test(entryTotalBody),
    entryTotalBody.replace(/\s+/g, ' ').trim().slice(0, 120));
rec('so a maxed day pays the run plus the bonus', VAULT_ENTRY_TOTAL === 900 && VAULT_LEVELS.length === 3
    && STREAK_BASE * STREAK_MAX_MULTIPLIER === 2250,
    `${VAULT_ENTRY_TOTAL} PTS run + up to ${STREAK_BASE * STREAK_MAX_MULTIPLIER} PTS streak`);

// A day key and its predecessor have to be a real chain, across month and year ends, or the
// streak breaks for everyone at a boundary the ladder was never tested on.
const boundaries = [
    ['2026-03-01', '2026-02-28'],
    ['2026-01-01', '2025-12-31'],
    ['2024-03-01', '2024-02-29'],   // a leap year, which is the one that gets written by hand
];
rec('the previous day is a real date, across months, years and February 29',
    boundaries.every(([day, before]) => previousDayKey(day) === before),
    boundaries.map(([day]) => `${day} → ${previousDayKey(day)}`).join(' · '));

// The page renders what the server says, so the same day must be the one the request is paid on.
rec('today is a UTC day key, which is what every daily rule here keys on',
    /^\d{4}-\d{2}-\d{2}$/.test(todayKey()) && todayKey(new Date('2026-03-10T23:59:59Z')) === '2026-03-10',
    todayKey());

console.log('');
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
for (const f of failed) console.log(`  FAILED: ${f.label}`);
console.log('');
process.exit(failed.length ? 1 : 0);
