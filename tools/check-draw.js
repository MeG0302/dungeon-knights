#!/usr/bin/env node
/**
 * Does the daily capsule draw rank the day it says it ranks, pay exactly ten wallets, and survive
 * being run twice?
 *
 *     node tools/check-draw.js
 *
 * The draw hands out ten capsules a night, so the failures that matter are not cosmetic: a wrong
 * order pays the wrong wallet, a re-run pays a wallet twice, and a day that nobody settled is a
 * promise broken in public. All of that is checked here, **offline**, in a throwaway working
 * directory against the file driver — the store picks its file when the module graph loads, so the
 * sandbox is set up before the imports (the same shape `tools/check-refs.js` uses).
 *
 * Two halves, and they test different things:
 *
 *   - `pickWinners` is pure, so the ordering, the tie-break and the size ceiling are walked directly.
 *   - settlement is exercised for real — boards written through `bumpDailyPoints`, days drawn through
 *     `settleDraws`, capsules read back off the wallet records — because "settle once" is a property
 *     of the code and its guards, not of a function's declaration.
 *
 * Every guard here was falsified by mutation before it was trusted: the rule broken on purpose, the
 * harness watched to fail **by name**, then the rule restored (the table in `.freebuff/run.md` lists
 * the mutations and what caught each one).
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

// -------------------------------------------------------------- the sandbox, before imports
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-points-draw-'));
const origin = process.cwd();
process.chdir(sandbox);
for (const key of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
    delete process.env[key];
}

(async () => {
    console.log('');
    console.log('Points Program — the daily capsule draw');

    const Config = await import('../lib/points-config.js');
    const Store = await import('../lib/points-store.js');
    const Draw = await import('../lib/points-draw.js');

    const fresh = () => `0x${crypto.randomBytes(20).toString('hex')}`;

    /** A wallet that has earned, with a bound handle, written the way the page would find it. */
    async function earner(username, points = 0) {
        const address = fresh();
        await Store.putWallet({
            ...Store.blankWallet(address),
            points,
            x: { id: `1${Math.floor(Math.random() * 1e6)}`, username, verified: true, boundAt: new Date().toISOString() },
        });
        return address;
    }

    // ------------------------------------------------------------------------ the ordering rule
    console.log('');
    console.log('Who wins, from the day\u2019s rows (pure)');

    const rows = [
        { address: '0x' + 'a'.repeat(40), points: 1950, at: 500 },
        { address: '0x' + 'b'.repeat(40), points: 4050, at: 900 },
        { address: '0x' + 'c'.repeat(40), points: 1950, at: 100 },
        { address: '0x' + 'd'.repeat(40), points: 0, at: 10 },
        { address: '0x' + 'e'.repeat(40), points: 1950, at: 100 },
    ];
    const picked = Draw.pickWinners(rows, 5);

    rec('the biggest day wins', picked[0].address === rows[1].address && picked[0].points === 4050,
        `${picked[0].points} PTS first`);
    rec('a tie is broken by who got there first, not by luck',
        picked[1].at === 100 && picked[2].at === 100 && picked[3].at === 500,
        `at ${picked.map((r) => r.at).join(' \u2192 ')}`);
    rec('  \u2026 and a tie in *that* falls back to the address, so two runs cannot disagree',
        picked[1].address === rows[2].address && picked[2].address === rows[4].address,
        `${picked[1].address.slice(0, 8)}\u2026 before ${picked[2].address.slice(0, 8)}\u2026`);
    rec('a wallet that earned nothing is not on the board at all',
        !picked.some((r) => r.address === rows[3].address), '0 PTS dropped');

    const ten = Array.from({ length: 14 }, (unused, i) => ({
        address: `0x${String(i).padStart(40, '0')}`, points: 100 + i, at: 1,
    }));
    rec('exactly ten are paid, however many played',
        Draw.pickWinners(ten).length === Config.DRAW_SIZE && Config.DRAW_SIZE === 10,
        `${Draw.pickWinners(ten).length} of ${ten.length} rows`);
    rec('a shorter field is paid in full rather than padded',
        Draw.pickWinners(ten.slice(0, 4)).length === 4, '4 rows \u2192 4 winners');
    rec('no rows, no winners — and no exception',
        Array.isArray(Draw.pickWinners([])) && Draw.pickWinners([]).length === 0
        && Draw.pickWinners(null).length === 0, '');

    // ----------------------------------------------------------------------------- the cut line
    console.log('');
    console.log('The cut line, and the wallets fighting for it (pure)');

    /**
     * A row for the pure rule. The addresses are zero-padded so they sort in the order they were
     * made, which keeps the tie-break's last resort (the address) out of the way of the checks about
     * `at` — a harness that could not tell those two apart could not check either.
     */
    const row = (n, points, at) => ({ address: `0x${String(n).padStart(40, '0')}`, points, at });

    // Nine clear of the line, then three level on 2450, then one wallet below it that has no business
    // in the band. The wallet holding the tenth capsule is deliberately *not* the first of the three:
    // `at` decides, and the row stamped earliest is the tenth, which is the whole reason the band can
    // be shown without changing who is paid.
    const tied = [
        row(1, 3400, 10), row(2, 3300, 20), row(3, 3200, 30), row(4, 3100, 40), row(5, 3000, 50),
        row(6, 2900, 60), row(7, 2800, 70), row(8, 2700, 80), row(9, 2600, 90),
        row(10, 2450, 200), row(11, 2450, 150), row(12, 2450, 300), row(13, 2100, 400),
    ];
    const split = Draw.cutLine(tied, 10);

    rec('the ten that are paid are still the ten, whatever is level with them',
        split.winners.length === 10 && split.winners[9].points === 2450 && split.points === 2450,
        `the cut is ${split.points} PTS`);
    rec('the wallets level with the tenth are listed, ranked on from the cut',
        split.contenders.length === 2 && split.contenders[0].rank === 11
        && split.contenders[1].rank === 12 && split.contenders.every((r) => r.points === 2450),
        `#${split.contenders.map((r) => r.rank).join(' and #')} at the same score`);
    rec('  and the spot is the tie-break\u2019s: the earliest stamp of the level wallets takes it',
        split.winners[9].at === 150 && split.winners[9].address === tied[10].address
        && split.contenders.map((r) => r.at).join(',') === '200,300',
        `at ${split.winners[9].at} holds it over at ${split.contenders.map((r) => r.at).join(' and ')}`);
    rec('the count is about the line, so the wallet holding the spot is counted too',
        split.level === 3, `${split.level} wallets level`);
    rec('the band is ordered by the rule that pays, so the page cannot disagree with the draw',
        split.contenders.map((r) => r.at).every((at, i, all) => i === 0 || all[i - 1] < at),
        'earliest first, same as the winners');
    rec('the winners the band is cut under are the winners the draw pays',
        Draw.pickWinners(tied, 10).map((r) => r.address).join(',') === split.winners.map((r) => r.address).join(','),
        'one ordering, two views');

    // Ten distinct scores and an eleventh wallet well below the line: nothing here is level with the
    // cut, so the band must be empty even though there *are* rows under it.
    const sharp = [
        row(1, 3400, 10), row(2, 3300, 20), row(3, 3200, 30), row(4, 3100, 40), row(5, 3000, 50),
        row(6, 2900, 60), row(7, 2800, 70), row(8, 2700, 80), row(9, 2600, 90), row(10, 2451, 100),
        row(11, 1000, 110),
    ];
    rec('an outright cut has no band to show, however many wallets are under it',
        Draw.cutLine(sharp, 10).contenders.length === 0 && Draw.cutLine(sharp, 10).level === 1,
        `nobody level with the tenth, of ${sharp.length} on the board`);
    rec('a field shorter than the prize has no cut line at all: it is paid in full',
        Draw.cutLine(sharp.slice(0, 4), 10).points === null
        && Draw.cutLine(sharp.slice(0, 4), 10).contenders.length === 0
        && Draw.cutLine(sharp.slice(0, 4), 10).winners.length === 4,
        '4 rows, 4 capsules, no line drawn');

    // Twenty-five wallets level on a two-digit score is a pathological day, and the band must describe
    // it without either lying about the size of the tie or turning into twenty-five identical rows.
    const crowd = [...sharp.slice(0, 9), ...Array.from({ length: 25 }, (u, i) => row(100 + i, 2450, 500 + i))];
    const capped = Draw.cutLine(crowd, 10, { max: 3 });
    rec('a tie too big to list is bounded, and said as a lower bound rather than counted as shown',
        capped.contenders.length === 3 && capped.truncated === true && capped.level === 25,
        `3 of ${capped.level} listed`);
    rec('  and with room to list it, every wallet in the tie is named and nothing more is claimed',
        Draw.cutLine(crowd, 10, { max: 30 }).contenders.length === 24
        && Draw.cutLine(crowd, 10, { max: 30 }).truncated === false,
        '24 listed, 25 level');

    // Handed in ascending on purpose. A caller\u2019s array that is already in score order is the one
    // case where an in-place sort inside the rule cannot be seen, so the fixture is a scrambled copy:
    // the mistake this pins is `rows.sort(...)` on the caller\u2019s list, and only disorder reveals it.
    const scrambled = [...tied].reverse();
    const orderBefore = scrambled.map((r) => r.address).join(',');
    Draw.cutLine(scrambled, 10);
    rec('the rule reads the rows it is given and leaves them alone',
        scrambled.map((r) => r.address).join(',') === orderBefore,
        'no in-place sort of a caller\u2019s array');

    // --------------------------------------------------------------------------- the day key
    console.log('');
    console.log('A day key has to be a day');

    // The regex is not the check. A key that is shaped like a date but is not one used to settle a
    // day nobody played and write it into a record that is never rewritten — `--draw 2026-09-99` did
    // exactly that before the round-trip below was added.
    rec('a shape that is not a real date is not a day key',
        Config.isDayKey('2026-09-23') === '2026-09-23'
        && Config.isDayKey('2026-02-30') === null
        && Config.isDayKey('2026-09-99') === null
        && Config.isDayKey('2026-13-01') === null
        && Config.isDayKey('2026-9-3') === null,
        '2026-02-30 and 2026-09-99 rejected');

    const recordBefore = (await Draw.recentDraws(60)).length;
    const nonsense = await Draw.drawDay('2026-09-99');
    rec('  — and the draw refuses it by name, writing nothing down',
        nonsense.code === 'bad-day' && (await Draw.recentDraws(60)).length === recordBefore,
        nonsense.error);

    // ----------------------------------------------------------------------------- the tally
    console.log('');
    console.log('The day\u2019s board, written where the points are written');

    rec('commission is not a day\u2019s play, and every other reason is',
        Config.countsTowardDaily('referral_commission') === false
        && Config.countsTowardDaily('vault_level_3') === true
        && Config.countsTowardDaily('streak_day_7') === true
        && Config.countsTowardDaily('vault_share_bonus') === true
        && Config.countsTowardDaily('one_time_follow') === true,
        'referral_commission excluded');

    const program = fs.readFileSync(path.join(__dirname, '..', 'lib', 'points-program.js'), 'utf8');
    const creditBody = /async function credit\(address, amount, reason\)[\s\S]*?\n}/.exec(program)?.[0] || '';
    rec('`credit` asks that same function before it touches a board',
        /if \(countsTowardDaily\(reason\)\) await bumpDailyPoints\(address, todayKey\(\), value, Date\(\)\.now|if \(countsTowardDaily\(reason\)\) await bumpDailyPoints\(/.test(creditBody),
        'one predicate, one decision');
    rec('  \u2026 and the day\u2019s facts are written in exactly one place',
        !/w\.daily/.test(creditBody) && !/w\.daily/.test(
            fs.readFileSync(path.join(__dirname, '..', 'lib', 'points-store.js'), 'utf8')),
        'no second tally on the record to drift from the board');

    const day = '2026-09-22';
    const early = await earner('early');
    const late = await earner('late');
    const quiet = await earner('quiet');

    await Store.bumpDailyPoints(early, day, 900, 1000);
    await Store.bumpDailyPoints(late, day, 900, 2000);
    await Store.bumpDailyPoints(late, day, 1050, 3000);
    await Store.bumpDailyPoints(quiet, day, 0, 4000);

    rec('a day\u2019s points are the day\u2019s, added up as they are earned',
        (await Store.dailyPointsFor(late, day)) === 1950, `${await Store.dailyPointsFor(late, day)} PTS`);
    rec('  \u2026 and a wallet that earned nothing has no place on it',
        (await Store.dailyPointsFor(quiet, day)) === 0 && (await Store.dailyRankOf(quiet, day)) === null,
        'unranked, not last');
    rec('the board is ranked by points, and the stamp is the last credit',
        (await Store.dailyRankOf(late, day)) === 1 && (await Store.dailyRankOf(early, day)) === 2,
        `${(await Store.dailyRankOf(late, day))} \u00b7 ${(await Store.dailyRankOf(early, day))}`);
    const board = await Store.topWalletsOnDay(day, 10);
    rec('the rows a draw reads carry the handle, the points and the tie-break stamp',
        board.length === 2 && board[0].address === late && board[0].dayPoints === 1950
        && board[0].handle === 'late' && board[0].at === 3000 && board[1].at === 1000,
        `${board.length} rows, newest stamp ${board[0].at}`);
    rec('the stamp is the day\u2019s own, written by the same call that scored it',
        board.every((row) => row.at > 0), 'no stamp read from a second place');
    rec('another day is a different board, not a running total',
        (await Store.topWalletsOnDay('2026-09-21', 10)).length === 0, 'yesterday is empty');

    // -------------------------------------------------------------------------- the settlement
    console.log('');
    console.log('Settling the days that are owed');

    const now = new Date('2026-09-24T00:20:00.000Z');
    const settled = await Draw.settleDraws({ now });

    rec('the first day is the earliest board the store holds — no separate start date to get wrong',
        settled.firstDay === day, settled.firstDay);
    rec('every closed day since then is drawn, in order, including one nobody played',
        settled.settled.map((s) => s.day).join(',') === '2026-09-22,2026-09-23',
        settled.settled.map((s) => `${s.day} (${s.winners})`).join(' \u00b7 '));
    rec('  \u2026 so the day still running is untouched', (await Draw.recentDraws(10)).every((d) => d.day < '2026-09-24'));

    const drawn = (await Draw.recentDraws(10)).find((d) => d.day === day);
    rec('the record names the field, the cut and the day number',
        drawn.qualifiers === 2 && drawn.winners.length === 2 && drawn.size === 10
        && drawn.capsule.name === Config.DRAW_CAPSULE.name && drawn.dayNumber === Config.programDay(day),
        `${drawn.qualifiers} played, ${drawn.winners.length} paid, ${drawn.capsule.name}`);
    rec('the winners are the board, in the board\u2019s order, named by handle',
        drawn.winners[0].address === late && drawn.winners[0].rank === 1 && drawn.winners[0].handle === 'late'
        && drawn.winners[0].points === 1950 && drawn.winners[1].address === early,
        drawn.winners.map((w) => `@${w.handle} ${w.points}`).join(' \u00b7 '));

    const lateDoc = await Store.getWallet(late);
    const earlyDoc = await Store.getWallet(early);
    rec('a win is written on the wallet that won it',
        lateDoc.capsules?.[day]?.status === 'won' && lateDoc.capsules[day].capsule.key === 'common'
        && lateDoc.capsules[day].points === 1950 && lateDoc.capsuleNotice === day,
        `${Object.keys(lateDoc.capsules || {}).length} capsule(s)`);
    rec('a short field still pays everyone on it, second place included',
        earlyDoc.capsules?.[day]?.status === 'won' && earlyDoc.capsules[day].rank === 2,
        `@early second on a board of ${drawn.qualifiers}`);
    rec('and a wallet that did not play is paid nothing',
        Object.keys((await Store.getWallet(quiet)).capsules || {}).length === 0, '0 PTS, no capsule');

    const again = await Draw.settleDraws({ now });
    rec('settling again settles nothing',
        again.settled.length === 0 && (await Draw.recentDraws(10)).length === 2,
        'the record is the guard');

    const redraw = await Draw.drawDay(day);
    rec('drawing a settled day draws nothing new, and says so',
        redraw.already === true
        && Object.keys((await Store.getWallet(late)).capsules || {}).length === 1,
        'one capsule each, still');

    // The worst case this file exists for: the award landed and the *record* did not. A re-settlement
    // must rebuild the record without paying a second capsule — the day is the key, and it is checked
    // inside the wallet write.
    await Draw.resetDraws();
    const rebuilt = await Draw.drawDay(day);
    rec('a lost record is rebuilt without paying twice',
        rebuilt.winners.length === 2 && rebuilt.awarded === 0
        && Object.keys((await Store.getWallet(late)).capsules || {}).length === 1,
        'record restored, no second capsule');

    rec('a day with no board is drawn as an empty day rather than skipped',
        (await Draw.drawDay('2026-09-21')).winners.length === 0, 'nobody earned that day');
    rec('and the announcements feed says exactly that',
        (await Draw.newsFeed(5)).some((n) => n.day === '2026-09-21' && /no wallet earned/i.test(n.body)),
        'the record explains the empty day');
    rec('a day key that is not a day is refused, not guessed at',
        (await Draw.drawDay('yesterday')).code === 'bad-day', 'bad-day');

    // ------------------------------------------------------------------ the near miss, and order
    console.log('');
    console.log('A short field, a quiet day, and the days in between');

    // One at a time on purpose: the file driver is a read-modify-write over a single JSON document,
    // so three `earner()` calls in flight at once can each read the same file and the last write wins —
    // a dev-only hazard (production's driver is atomic per command), and one a harness must not trip
    // over while it is busy pretending to be three players.
    const field = [];
    for (const name of ['a', 'b', 'c']) field.push(await earner(`dc-${name}`));
    for (const address of field) await Store.bumpDailyPoints(address, '2026-09-23', 900, 500);

    const catchUp = await Draw.settleDraws({ now });
    const short = (await Draw.recentDraws(10)).find((d) => d.day === '2026-09-23');
    rec('a day with three players pays three capsules, not ten',
        short.winners.length === 3 && short.awarded === 3 && short.qualifiers === 3,
        `${short.awarded} awarded of ${Config.DRAW_SIZE}`);
    rec('and the announcements say the field was short rather than pretending otherwise',
        (await Draw.newsFeed(5)).some((n) => n.day === '2026-09-23' && /3 of 10/.test(n.body)),
        '3 of 10 capsules');
    rec('every day since the first is accounted for, newest first, with no gap',
        (await Draw.recentDraws(10)).map((d) => d.day).join(',') === '2026-09-23,2026-09-22,2026-09-21',
        (await Draw.recentDraws(10)).map((d) => d.day).join(' \u2192 '));
    rec('the newest record is the one the page shows as "last draw"',
        (await Draw.latestDraw()).day === '2026-09-23', (await Draw.latestDraw()).day);
    const shown = await Draw.dayBoard('2026-09-23', 10, field[1]);
    rec('today\u2019s board is the day board, with the caller\u2019s row flagged',
        shown.length === 3 && shown.filter((row) => row.isYou).length === 1,
        `${shown.length} rows, ${shown.filter((r) => r.isYou).length} flagged`);
    rec('  \u2026 and it is ranked by the same rule the draw pays by',
        shown.map((row) => row.points).every((p, i, all) => i === 0 || all[i - 1] >= p),
        shown.map((row) => `${row.points}`).join(' \u2265 '));
    rec('a day nobody played has no board rows to show', (await Draw.dayBoard('2026-09-24', 10)).length === 0, '');

    // ------------------------------------------------------------------ the band, off a real board
    console.log('');
    console.log('The band, read off a day board the store actually holds');

    // A day that has not closed, so nothing settles it and the running state of the page is the thing
    // under test. Three wallets on one score and a two-capsule prize: the third is the tie the band
    // exists for, and it is the wallet that is reading the page.
    const band = '2026-10-01';
    const tiedField = [];
    for (const name of ['tie-a', 'tie-b', 'tie-c']) tiedField.push(await earner(name));
    for (const [i, address] of tiedField.entries()) await Store.bumpDailyPoints(address, band, 800, 500 + i);

    const banded = await Draw.dayBoardCut(band, { me: tiedField[2], size: 2, depth: 10 });
    rec('a day board carries its cut line, and the wallets standing on it',
        banded.board.length === 2 && banded.cut.points === 800
        && banded.cut.contenders.length === 1 && banded.cut.contenders[0].rank === 3,
        `#${banded.cut.contenders[0].rank} level on ${banded.cut.points} PTS`);
    rec('  and the wallet reading the page is flagged in the band it is in',
        banded.cut.contenders[0].isYou === true && banded.board.every((r) => r.isYou === false),
        'the band knows who is looking at it');
    rec('a board the read saw in full is not called incomplete',
        banded.cut.level === 2 && banded.cut.truncated === false,
        'two level at the cut, and both of them seen');
    rec('  but a read that stops inside the tie says so rather than guessing',
        (await Draw.dayBoardCut(band, { size: 2, depth: 3 })).cut.truncated === true,
        'a three-row read of a three-row tie');
    rec('no cut is drawn until the prize is full',
        (await Draw.dayBoardCut(band, { size: 5, depth: 10 })).cut === null,
        'three wallets, five capsules');
    rec('dayBoard is the same board with the band thrown away',
        (await Draw.dayBoard(band, 2)).length === 2 && (await Draw.dayBoard(band, 2))[0].rank === 1,
        'the shape the ladder reads');

    // -------------------------------------------------------------------------------- wiring
    console.log('');
    console.log('The wiring a unit test cannot see');

    const route = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'points', 'draw', 'route.js'), 'utf8');
    const routing = fs.readFileSync(path.join(__dirname, '..', 'lib', 'app-routing.js'), 'utf8');
    const vercel = fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8');

    rec('the cron\u2019s path is reachable on a gated host, by name',
        /GLOBAL_OPEN = \[[^\]]*'\/api\/points\/draw'/.test(routing),
        "GLOBAL_OPEN includes '/api/points/draw'");
    rec('  \u2026 and the route is what closes it: a constant-time compare, and 503 with no secret',
        /timingSafeEqual/.test(route) && /code: 'no-secret'/.test(route) && /status: 503/.test(route),
        'fails closed, not open');
    rec('nothing in the browser bundle holds the draw secret',
        !/CRON_SECRET/.test(fs.readFileSync(path.join(__dirname, '..', 'lib', 'points-client.js'), 'utf8'))
        && !/CRON_SECRET/.test(fs.readFileSync(path.join(__dirname, '..', 'app', 'points', 'client.js'), 'utf8')),
        'client files are clean');
    rec('the draw is scheduled, daily, at a fixed minute past UTC midnight',
        /"crons"[\s\S]*?"path":\s*"\/api\/points\/draw"[\s\S]*?"schedule":\s*"10 0 \* \* \*"/.test(vercel),
        '10 0 * * *');

    const stateFor = /export async function stateFor\(address\)[\s\S]*?\n}/.exec(program)?.[0] || '';
    rec('a page read settles the draw too, so the cron is not load-bearing',
        /await settleDraws\(\)/.test(stateFor) && /giveaway: await giveawayView\(key, \{ doc \}\)/.test(stateFor),
        'settle + render in one read');
    rec('  \u2026 and it renders from the record already in hand',
        /giveawayView\(key, \{ doc \}\)/.test(stateFor) && /doc: loaded = null/.test(
            fs.readFileSync(path.join(__dirname, '..', 'lib', 'points-capsules.js'), 'utf8')),
        'no second wallet read');
    const capsules = fs.readFileSync(path.join(__dirname, '..', 'lib', 'points-capsules.js'), 'utf8');
    const pointsClient = fs.readFileSync(path.join(__dirname, '..', 'app', 'points', 'client.js'), 'utf8');
    rec('the panel\u2019s board is read past the ten it pays, so the tie has something to render',
        /dayBoardCut\(day, \{ me: key \}\)/.test(capsules) && /cut: board\.cut/.test(capsules),
        'the view carries the cut to the page');
    rec('  and the band is drawn for the wallets it names, with the tie-break said out loud',
        /data-arya="cut"/.test(pointsClient) && /cut\?\.contenders\?\.length/.test(pointsClient)
        && /reached the total first/.test(pointsClient),
        'the band, and why somebody is standing on it');

    rec('draw boards are pruned once a settlement has drawn something',
        /await pruneDailyKeys\(/.test(fs.readFileSync(path.join(__dirname, '..', 'lib', 'points-draw.js'), 'utf8')),
        '35 days kept');

    // ------------------------------------------------------------------------------ the tally
    try {
        process.chdir(origin);
        fs.rmSync(sandbox, { recursive: true, force: true });
    } catch {
        // A temp directory left behind is not a reason to fail every check that passed.
    }

    const failed = results.filter((r) => !r.pass);
    console.log('');
    if (!results.length) {
        console.log('nothing was checked');
        process.exitCode = 1;
        return;
    }
    console.log(`${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length) {
        console.log('');
        for (const f of failed) console.log(`  FAILED  ${f.label}`);
        process.exitCode = 1;
    }
})().catch((error) => {
    console.error(`harness stopped: ${error.message || error}`);
    process.exitCode = 1;
});
