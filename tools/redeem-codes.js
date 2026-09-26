#!/usr/bin/env node
/**
 * The gift-card codes behind `/redeem` — what is left, what has gone out, and how to top it up.
 *
 *     node tools/redeem-codes.js --list                       # how many codes each card has left
 *     node tools/redeem-codes.js --add amazon  AB12-CD34-EF56 GH78-IJ90-KL12
 *     node tools/redeem-codes.js --add google --from codes-google.txt
 *     node tools/redeem-codes.js --given                      # what has been handed out, newest last
 *     node tools/redeem-codes.js --remove AB12-CD34-EF56      # a code that was mistyped or void
 *     node tools/redeem-codes.js --audit                      # what the pool and the wallets disagree about
 *
 * WHY THIS EXISTS
 * ---------------
 * The codes are the one thing on this site that is worth money to whoever reads it, so they are the
 * one thing that is not in the repository. They live in the same store the game uses, under one key
 * (`dk:points:redeem`, written by `lib/points-redeem.js`), and this is the only way in or out:
 * the wheel pops one when a spin wins, and nothing anywhere serves the list — a page is handed the
 * single code its own wallet won, and `tools/check-redeem.js` proves that with sentinel codes.
 *
 * A code is checked for shape and for duplicates before it is stored, because both mistakes are
 * silent otherwise: a code pasted with a trailing space, or the same code loaded twice, would only
 * be discovered by the player who could not redeem it.
 *
 * THE PRODUCTION RUN
 * ------------------
 * The same store the deployment uses — the local file in development, Redis when the KV variables
 * are in the environment. In production that means pulling them in for one command, **never** into
 * `.env.local`:
 *
 *     npx vercel env pull /tmp/prod.env --environment=production
 *     node --env-file=/tmp/prod.env tools/redeem-codes.js --list
 *     node --env-file=/tmp/prod.env tools/redeem-codes.js --add amazon --from /tmp/amazon-codes.txt
 *
 * The file passed to `--from` is read line by line, so a column copied out of a spreadsheet works
 * as it is. Nothing is printed back except a masked form (`AB12…EF56`) unless `--show` is passed,
 * which is there for the moment a code has to be read out over a support call.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
// `pathToFileURL`, not a hand-built `file://` string: this repository lives in a directory with a
// space in its name, and a specifier with a raw space in it is a `MODULE_NOT_FOUND` with a message
// that names the file it just failed to find.
const lib = (name) => pathToFileURL(path.join(ROOT, 'lib', name)).href;

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
    const index = args.indexOf(`--${name}`);
    if (index === -1) return fallback;
    const next = args[index + 1];
    return next && !next.startsWith('--') ? next : true;
};
const has = (name) => args.includes(`--${name}`);

/** `AB12-CD34-EF56` → `AB12…EF56`, so a terminal in a screenshot is not a giveaway. */
function mask(code) {
    const text = String(code || '');
    if (text.length <= 10) return `${text.slice(0, 2)}…${text.slice(-2)}`;
    return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

function show(code) {
    return has('show') ? String(code) : mask(code);
}

function when(at) {
    const ms = Number(at);
    if (!ms) return '(no date)';
    return new Date(ms).toISOString().replace('T', ' ').slice(0, 16);
}

/** Every code in the arguments after `--add <prize>`, `--from` files included. */
function codesFromArgs(prize) {
    const collected = [];
    const start = args.indexOf('--add');
    for (let i = start + 1; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === '--from') { i += 1; continue; }
        if (arg.startsWith('--')) break;
        if (arg === prize || arg === 'amazon' || arg === 'google') continue;
        collected.push(arg);
    }
    const file = flag('from');
    if (typeof file === 'string' && file) {
        const text = fs.readFileSync(path.isAbsolute(file) ? file : path.join(process.cwd(), file), 'utf8');
        for (const line of text.split(/\r?\n/)) {
            // A spreadsheets column arrives with quotes and commas; take the field and drop the rest.
            const value = line.split(/[,\t;]/)[0].replace(/^["'\s]+|["'\s]+$/g, '');
            if (value) collected.push(value);
        }
    }
    return collected;
}

(async () => {
    const {
        REDEEM_POOL_KEY, looksLikeCode, readPool, stockOf, writePool,
    } = await import(lib('points-redeem.js'));
    const { REDEEM_OUTCOMES, REDEEM_PRIZES } = await import(lib('points-config.js'));
    const { storageDescription } = await import(lib('points-store.js'));

    const prizeArg = String(flag('add', '') || '').toLowerCase();
    const pool = await readPool();

    console.log('');
    console.log(`Gift codes — ${REDEEM_POOL_KEY}`);
    console.log(`  storage: ${storageDescription()}`);

    // ------------------------------------------------------------------ adding
    if (prizeArg) {
        if (!REDEEM_PRIZES.includes(prizeArg)) {
            console.log(`  add: --add needs one of ${REDEEM_PRIZES.join(' / ')} — nothing was written.`);
            process.exitCode = 1;
            return;
        }
        const incoming = codesFromArgs(prizeArg);
        if (!incoming.length) {
            console.log('  add: no codes given. Pass them after the prize, or point --from at a file.');
            process.exitCode = 1;
            return;
        }

        const existing = new Set([...pool.amazon, ...pool.google]);
        const clean = [];
        const rejected = [];
        const duplicates = [];
        for (const raw of incoming) {
            const code = String(raw).trim();
            if (!looksLikeCode(code)) { rejected.push(code); continue; }
            if (existing.has(code) || clean.includes(code)) { duplicates.push(code); continue; }
            clean.push(code);
        }

        console.log(`  add: ${clean.length} of ${incoming.length} codes for ${REDEEM_OUTCOMES[prizeArg].name}`);
        if (rejected.length) console.log(`       REFUSED ${rejected.length} — not the shape of a code: ${rejected.slice(0, 4).map(mask).join(', ')}`);
        if (duplicates.length) console.log(`       SKIPPED ${duplicates.length} — already in the pool: ${duplicates.slice(0, 4).map(mask).join(', ')}`);

        if (has('dry')) {
            console.log('       --dry: nothing was written.');
        } else if (clean.length) {
            pool[prizeArg] = [...pool[prizeArg], ...clean];
            await writePool(pool);
            console.log('       written.');
        }

        const after = stockOf(pool);
        console.log(`       now: Amazon Pay ${after.amazon} · Google Play ${after.google}`);
        return;
    }

    // ------------------------------------------------------------------ removing
    const remove = flag('remove');
    if (typeof remove === 'string' && remove) {
        const code = remove.trim();
        const where = REDEEM_PRIZES.filter((prize) => pool[prize].includes(code));
        if (!where.length) {
            console.log("  remove: that code is not in the pool. If it was already won, it is on the winner's wallet.");
            process.exitCode = 1;
            return;
        }
        for (const prize of where) pool[prize] = pool[prize].filter((row) => row !== code);
        if (has('dry')) {
            console.log(`  remove: ${show(code)} would be removed from ${where.join(', ')} — --dry, nothing written.`);
        } else {
            await writePool(pool);
            console.log(`  remove: ${show(code)} removed from ${where.join(', ')}.`);
        }
        return;
    }

    // ------------------------------------------------------------------ what went out
    if (has('given')) {
        const rows = pool.given.slice().reverse();
        console.log(`  given: ${rows.length} code${rows.length === 1 ? '' : 's'} handed out`);
        for (const row of rows.slice(0, Number(flag('limit', 40)) || 40)) {
            console.log(`    ${when(row.at)}  ${REDEEM_OUTCOMES[row.prize]?.short || row.prize}  ${show(row.code)}  ${row.address}`);
        }
        if (rows.length > 40) console.log(`    … ${rows.length - 40} older. --limit N to see more.`);
        return;
    }

    // ------------------------------------------------------------------ the audit
    if (has('audit')) {
        // The one thing worth checking by hand: a code that left the pool and is on nobody's wallet
        // is a code that was popped in the moment between the pool write and the charge. The spin
        // puts it back when that happens, so anything here is a crash, and the answer is to hand
        // the code to the address in the row.
        const { getWallet } = await import(lib('points-store.js'));
        const addresses = [...new Set(pool.given.map((row) => row.address).filter(Boolean))];
        const wallets = new Map();
        for (const address of addresses) wallets.set(address, await getWallet(address));
        const missing = pool.given.filter((row) => {
            const wallet = wallets.get(row.address);
            return !(wallet?.redeems || []).some((spin) => spin.id === row.id);
        });
        console.log(`  audit: ${pool.given.length} given, ${missing.length} not on the winner's wallet`);
        for (const row of missing.slice(-10)) {
            console.log(`    ${when(row.at)}  ${REDEEM_OUTCOMES[row.prize]?.short || row.prize}  ${show(row.code)}  ${row.address}`);
        }
        if (missing.length) console.log('    These were popped but never charged for — the code is free to re-add or hand over.');
        return;
    }

    // ------------------------------------------------------------------ the list
    const stock = stockOf(pool);
    console.log('');
    for (const prize of REDEEM_PRIZES) {
        console.log(`  ${REDEEM_OUTCOMES[prize].name.padEnd(24)} ${String(stock[prize]).padStart(6)} left`);
    }
    console.log(`  ${'handed out so far'.padEnd(24)} ${String(pool.given.length).padStart(6)}`);
    const duplicated = REDEEM_PRIZES.flatMap((prize) => pool[prize].filter((code, index) => pool[prize].indexOf(code) !== index));
    if (duplicated.length) {
        console.log(`  DUPLICATES: ${duplicated.length} — the same code is in the pool twice: ${duplicated.slice(0, 4).map(mask).join(', ')}`);
        process.exitCode = 1;
    }
    if (!REDEEM_PRIZES.every((prize) => stock[prize] > 0)) {
        console.log('  BOXED OFF: a card with no codes left stops every spin (the wheel refuses before it charges).');
    }
    console.log('');
})();
