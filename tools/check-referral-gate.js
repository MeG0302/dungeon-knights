#!/usr/bin/env node
/**
 * When does an invite start paying?
 *
 *     node tools/check-referral-gate.js
 *
 * A referral is the one way to be paid for somebody else's work, so it is the one way an invite list
 * could be turned into a points faucet: wallets cost nothing to make, and a referrer used to be paid
 * on the first point any of them earned. The rule is that an invite pays only once the invited
 * wallet has bound an X account (one binding per handle, so the same person cannot arrive twice) and
 * has earned a floor of its own. This file holds that rule to three things:
 *
 *   - **the rule itself**, as pure function answers — no X, no points, no username, exactly the
 *     floor, just under it;
 *   - **the money**, driven through the real `clearLevel` path so the commission is paid by the code
 *     that pays it in production, including the two things a rule like this can get wrong: paying
 *     out before the floor, and reaching back for the credits that arrived before it;
 *   - **what the page says**, because a list that shows "240 their points, +0 you earned" without
 *     explaining itself is the kind of screen a player reads as a bug.
 *
 * The floor is read from the environment **before** the module graph loads, so this run uses 250
 * rather than the published ten: a floor of ten is cleared by the first vault floor, and a rule you
 * cannot get underneath is a rule this file could not falsify. Everything below the rule is the same
 * code either way — only the number changes.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

// -------------------------------------------------------------- the sandbox, before imports
// The store picks its driver and its file when the module graph loads, so both are settled first —
// and so is the floor, which `points-config.js` reads at import time.
const ROOT = process.cwd();
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-referral-gate-'));
process.chdir(sandbox);
for (const key of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
    delete process.env[key];
}
process.env.REFERRAL_MIN_POINTS = '250';

(async () => {
    console.log('');
    console.log('Points Program — when an invite starts paying');

    const Config = await import('../lib/points-config.js');
    const Store = await import('../lib/points-store.js');
    const Program = await import('../lib/points-program.js');

    const fresh = () => `0x${crypto.randomBytes(20).toString('hex')}`;
    const points = async (address) => (await Store.getWallet(address))?.points || 0;
    const floor = Config.REFERRAL_MIN_POINTS;

    // ------------------------------------------------------------------ the rule, on its own
    console.log('');
    console.log('The rule');

    // A child process, because the constant is read once when the module loads and this one is
    // already holding 250. A value that cannot be a floor has to fall back to the published ten
    // rather than to `NaN`, which would refuse every referral forever in silence.
    const fallback = execFileSync(process.execPath, ['--input-type=module', '-e',
        "process.env.REFERRAL_MIN_POINTS='not-a-number';"
        + " const m = await import('./lib/points-config.js');"
        + " console.log(m.REFERRAL_MIN_POINTS);",
    ], { cwd: ROOT, encoding: 'utf8' }).trim();

    rec('this run raised the floor on purpose, so the rule can be got underneath', floor === 250, `floor = ${floor}`);
    rec('and a value that cannot be a floor falls back to the published ten', fallback === '10', `REFERRAL_MIN_POINTS=not-a-number → ${fallback}`);

    rec('a wallet that does not exist is not a referral yet', Config.referralQualifies(undefined) === false
        && Config.referralQualifies(null) === false, 'no record, no invite');
    rec('points without an X account are not enough', Config.referralQualifies({ points: 5000 }) === false,
        '5000 PTS and no binding');
    rec('an X account without the points is not enough either',
        Config.referralQualifies({ points: floor - 1, x: { username: 'almost' } }) === false,
        `${floor - 1} PTS of ${floor}`);
    rec('and exactly the floor counts — the line is inclusive',
        Config.referralQualifies({ points: floor, x: { username: 'exact' } }) === true,
        `${floor} PTS`);
    rec('an `x` record with no username is not a binding',
        Config.referralQualifies({ points: 5000, x: {} }) === false, 'x: {}');

    // ------------------------------------------------------------------- the money, through the vault
    console.log('');
    console.log('The money');

    const patron = fresh();
    const guest = fresh();
    await Program.registerVisit(patron);
    await Program.registerVisit(guest, (await Program.stateFor(patron)).refCode);
    rec('the invite is recorded the moment they arrive, before any rule about paying it',
        (await Store.getWallet(guest)).referrer === patron, '');

    await Program.bindX(guest, { id: '9101', username: 'gate_guest' });
    const first = await Program.clearLevel(guest, 0);                 // +100, well under the floor
    const afterFirst = await points(patron);
    rec('a floor cleared under the bar pays the inviter nothing',
        first.credited === 100 && afterFirst === 0, `guest ${first.credited} PTS · inviter ${afterFirst} PTS`);
    rec('  … and the invitee is paid their own points regardless',
        (await points(guest)) === 100, `${await points(guest)} PTS`);

    const second = await Program.clearLevel(guest, 1);                // +300, now past 250
    const grown = (await points(guest));
    rec('the credit that crosses the floor pays commission on that credit',
        (await points(patron)) === Config.commission(300, Config.REFERRAL_1ST_PCT),
        `${await points(patron)} PTS of ${second.credited}`);
    rec('  … and the credits that came before it are not reached back for',
        (await points(patron)) !== Config.commission(100 + 300, Config.REFERRAL_1ST_PCT),
        `paid ${await points(patron)} — a back-payment would be ${Config.commission(100 + 300, Config.REFERRAL_1ST_PCT)}`);
    rec('  … the ledger names which invitee it came from',
        (await Store.getWallet(patron)).referralLedger[guest] === (await points(patron)),
        `ledger[${guest.slice(0, 8)}…] = ${(await Store.getWallet(patron)).referralLedger[guest]}`);
    rec('  … and the invitee’s own balance is untouched by any of it', grown === 400, `${grown} PTS`);

    const beforeThird = await points(patron);
    const third = await Program.clearLevel(guest, 2);                 // +500, and the day's third floor
    // The third floor is also the moment the streak bonus is earned, and that bonus is a credit like
    // any other — so it pays a commission too, and an expectation that forgot it would be wrong about
    // the code rather than the other way round. The award is read from the state the page is shown.
    const streakAward = (await Program.stateFor(guest)).streak.award;
    const expected = Config.commission(third.credited, Config.REFERRAL_1ST_PCT)
        + Config.commission(streakAward, Config.REFERRAL_1ST_PCT);
    rec('and every credit after that pays as normal, the streak bonus included',
        (await points(patron)) - beforeThird === expected,
        `+${(await points(patron)) - beforeThird} = ${Config.REFERRAL_1ST_PCT * 100}% of ${third.credited} + the same of the ${streakAward}-point streak`);

    // A second invitee who never did anything, so the counts below have both answers to show.
    const waiter = fresh();
    await Program.registerVisit(waiter, (await Program.stateFor(patron)).refCode);
    await Program.bindX(waiter, { id: '9102', username: 'gate_waiter' });

    // ---------------------------------------------------------------------- what the page is told
    console.log('');
    console.log('What the page is told');

    const state = await Program.stateFor(patron);
    const of = (a) => state.referrals.find((r) => r.address === a);
    rec('the floor the store is enforcing travels with the state', state.referralMinPoints === floor,
        `referralMinPoints = ${state.referralMinPoints}`);
    rec('a referral that counts is marked as one', of(guest)?.counting === true,
        `${of(guest)?.theirPoints} PTS · counting ${of(guest)?.counting}`);
    rec('and one that does not yet is marked as that, not hidden',
        of(waiter)?.counting === false && of(waiter)?.theirPoints === 0,
        `${of(waiter)?.theirPoints} PTS · counting ${of(waiter)?.counting}`);
    rec('the two are counted apart, so “referrals” cannot mean two things',
        state.referralsCounting === 1 && state.referrals.length === 2,
        `${state.referralsCounting} counting of ${state.referrals.length}`);

    // ------------------------------------------------------------------------- and what it says
    console.log('');
    console.log('What the page says about it');

    const client = fs.readFileSync(path.join(ROOT, 'app', 'points', 'client.js'), 'utf8');
    rec('the row says which invites are paying, and which are waiting',
        /ref\.counting \? 'Counting' : 'Not counting yet'/.test(client),
        'a chip per row');
    rec('  … and the reason is on the row rather than in a paragraph above it',
        /ref\.counting\s*\n?\s*\? 'Bound X and past the earning floor/.test(client),
        'the title attribute explains +0');
    rec('the summary counts them the way the store does',
        /invited · \$\{state\.referralsCounting/.test(client), 'invited · counting');
    rec('and the paragraphs state the rule a player is being held to',
        /bound their X account/.test(client) && /\{state\?\.referralMinPoints \?\? 10\} points of their own/.test(client),
        'both halves of the rule, at the published floor');

    // The code has to be copyable on its own. The link is the wrong thing to paste into a group chat
    // or read out, and five characters are the whole point of having a code at all.
    rec('the five characters can be copied on their own, not only inside a link',
        /ref-code-value">\{state\.refCode\}<\/span>/.test(client)
        && /btn btn-secondary btn-sm ref-code-copy/.test(client)
        && /onClick=\{handleCopyCode\}/.test(client),
        'a button beside the code');
    rec('  … and it copies the code itself rather than the link',
        /const handleCopyCode = async \(\) => \{[\s\S]{0,260}?writeText\(code\)/.test(client),
        'writeText(code)');
    rec('  … with its own “copied” flag, so the two buttons cannot answer for each other',
        /const \[codeCopied, setCodeCopied\] = useState\(false\)/.test(client)
        && /codeCopied \? 'Copied' : 'Copy code'/.test(client),
        'codeCopied is separate from the link’s copied');
    rec('and the button says where a code is used, so it is not a mystery',
        /Invite code copied\. A friend can paste it on the Points page\./.test(client),
        'the toast names the destination');

    // Where the gate sits is the whole design: above the *first* payment, so both commission tiers
    // and any tier added later are downstream of one return. A gate placed after the first payout
    // would leave a 15% door open — and this assertion is the only thing that would notice.
    // Cut to the function first: `REFERRAL_1ST_PCT` is also in the import block at the top of the
    // file, and searching the whole file for it found the import at byte 483 and the real payout at
    // 30,000 — a pass that proved nothing about where the gate sits.
    const program = fs.readFileSync(path.join(ROOT, 'lib', 'points-program.js'), 'utf8');
    const body = program.slice(program.indexOf('async function credit('), program.indexOf('export async function clearLevel('));
    const gateAt = body.indexOf('if (!referralQualifies(doc)) return value;');
    const firstPayAt = body.search(/REFERRAL_1ST_PCT/);
    // What may sit above it is the invitee's own credit and nothing else: the wallet that earned is
    // paid whether or not anybody referred it. What must not is a *commission* — and the two markers
    // of one are the ledger and the referral tally, so those are what this looks for.
    const above = body.slice(0, gateAt === -1 ? body.length : gateAt);
    const commissionAbove = /referralLedger/.test(above) || /referralEarned/.test(above);
    rec('the gate sits above the first payment inside the payout itself',
        gateAt !== -1 && firstPayAt !== -1 && gateAt < firstPayAt,
        gateAt === -1 ? 'the gate is missing' : `gate at ${gateAt} of ${body.length}, first payout at ${firstPayAt}`);
    rec('  … so no commission can be written before it',
        gateAt !== -1 && !commissionAbove,
        commissionAbove
            ? 'a referral ledger is written above the gate'
            : 'the invitee’s own credit is the only write above it');

    // ------------------------------------------------------------------------------ the tally
    try {
        process.chdir(ROOT);
        fs.rmSync(sandbox, { recursive: true, force: true });
    } catch {
        // A temp directory left behind is not a reason to fail every check that passed.
    }

    const failed = results.filter((r) => !r.pass);
    console.log('');
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
