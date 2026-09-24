#!/usr/bin/env node
/**
 * The fulfilment list for the daily capsule giveaway — who won, whether they have proved the
 * wallet, and whether the capsule has actually been sent.
 *
 *     node tools/points-capsules.js                                  # every drawn day, newest first
 *     node tools/points-capsules.js --day 2026-09-23                 # one day, in full
 *     node tools/points-capsules.js --todo                           # only what still needs sending
 *     node tools/points-capsules.js --csv --day 2026-09-23 > day.csv # the spreadsheet form
 *     node tools/points-capsules.js --send 2026-09-23 0xabc… --note "tx 0x…"
 *     node tools/points-capsules.js --scan                           # read the wallets, not the record
 *     node tools/points-capsules.js --draw 2026-09-23                # settle a day by hand
 *
 * WHY THIS EXISTS
 * ---------------
 * The prize is real and the path to it is manual. There is nowhere on chain to mint a giveaway
 * capsule yet (`contracts/Capsules.sol` mints for the weekly raffle and nothing else), so the win is
 * recorded against the wallet, the winner proves the address by signing for it, and the team sends
 * the capsule by hand. That last mile is this file: the day's winners, the address to send to, and
 * enough evidence — a signature, a registered wallet, a form submission — to know the address is the
 * player's before anything valuable leaves.
 *
 * Read it as two halves. The listing is the draw record (`dk:points:draws`) joined with each
 * winner's wallet, which is where the claim and the sent marker live. `--send` is the only thing
 * here that writes, and it refuses a wallet nobody has claimed for unless `--force` says the team
 * decided otherwise by hand — the whole point of the signature is that it happens before the send.
 *
 * WHERE THE DATA LIVES
 * --------------------
 * The same store the deployment uses: the local file in development (`STORAGE_DRIVER=file`), and
 * Redis when `KV_REST_API_URL` and `KV_REST_API_TOKEN` are in the environment — which in production
 * means pulling them in for one command, **never** into `.env.local`:
 *
 *     npx vercel env pull /tmp/prod.env --environment=production
 *     node --env-file=/tmp/prod.env tools/points-capsules.js
 *
 * HONESTY ABOUT THE WINDOW
 * ------------------------
 * A win whose claim window has closed is `missed` on the player's ledger, and it stays on this list
 * anyway. The window closes on the *claim*, not on the win: a wallet that won and never came back is
 * a delivery the team can still choose to make, and quietly dropping it from the list is how a
 * promised prize goes missing.
 */

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
    const index = args.indexOf(`--${name}`);
    if (index === -1) return fallback;
    const next = args[index + 1];
    return next && !next.startsWith('--') ? next : true;
};

/** `--send` takes a day and an address, in either order, so a tired operator cannot get it backwards. */
function sendPair() {
    const index = args.indexOf('--send');
    if (index === -1) return { day: null, address: null, stray: [] };
    const rest = args.slice(index + 1).filter((a) => !a.startsWith('--')).slice(0, 2);
    const day = rest.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || String(flag('day', '') || '') || null;
    const address = rest.find((a) => /^0x[0-9a-fA-F]{40}$/.test(a)) || null;
    return { day, address, stray: rest.filter((a) => a !== day && a !== address) };
}

const send = sendPair();
const sending = args.includes('--send');
const csv = args.includes('--csv');
const todo = args.includes('--todo');
const scan = args.includes('--scan');
const forced = args.includes('--force');
const note = String(flag('note', '') || '').trim();
const day = String(flag('day', '') || '').trim();
const drawArg = flag('draw', null);

(async () => {
    const Store = await import('../lib/points-store.js');
    const Draw = await import('../lib/points-draw.js');
    const Capsules = await import('../lib/points-capsules.js');
    const Config = await import('../lib/points-config.js');

    const quiet = csv;
    const say = (...parts) => { if (!quiet) console.log(...parts); };

    // ------------------------------------------------------------------ settling, if that was asked
    if (drawArg) {
        const wanted = String(drawArg === true ? Config.todayKey() : drawArg).trim();
        // A day that has not started yet is not settled, it is guessed: the board would be empty by
        // definition and the record would then say that was the day's result. The cron settles the
        // days behind it; this is for catching up, not for reaching forward.
        if (Config.isDayKey(wanted) && wanted > Config.todayKey()) {
            console.error('');
            console.error(`${wanted} has not happened yet (today is ${Config.todayKey()}) — there is no board to settle.`);
            process.exit(1);
        }
        const result = await Draw.drawDay(wanted);
        say('');
        if (result.error) {
            console.error(`could not settle ${wanted}: ${result.error}`);
            process.exit(1);
        }
        if (result.busy) {
            console.error(`${wanted} is being settled by another process right now — try again in a moment.`);
            process.exit(1);
        }
        if (result.already) {
            say(`${wanted} was already settled (${result.winners.length} winner(s) on record) — nothing changed.`);
        } else {
            say(`settled ${wanted}: ${result.winners.length} winner(s), ${result.awarded} capsule(s) awarded, out of ${result.qualifiers} wallet(s) on the board.`);
        }
        // `--draw` on its own is a settlement and nothing else. Any of the listing flags on the same
        // line means the operator also wants to see the list, which is the natural thing to want next.
        if (!sending && !day && !csv && !todo && !scan) return;
    }

    // ------------------------------------------------------------------ sending one capsule
    if (sending) {
        say('');
        say(`Points capsules — store: ${Store.storageDescription()}`);
        if (send.stray.length) {
            console.error('');
            console.error(`Not sure what to do with: ${send.stray.join(', ')}`);
            console.error('Usage: --send <day> <address> --note "tx 0x…"');
            process.exit(1);
        }
        if (!send.day || !send.address) {
            console.error('');
            console.error('A send needs the day and the wallet: --send 2026-09-23 0xabc…');
            process.exit(1);
        }
        if (!Config.isDayKey(send.day)) {
            console.error('');
            console.error(`"${send.day}" is not a UTC day key (YYYY-MM-DD).`);
            process.exit(1);
        }

        const address = Store.normaliseAddress(send.address);
        const wallet = (await Store.getWallet(address)) || {};
        const stored = wallet.capsules?.[send.day];
        if (!stored) {
            console.error('');
            console.error(`No capsule is recorded for ${address} on ${send.day} — nothing to send.`);
            console.error('(A plain run lists the wins that do exist. --scan reads the wallets instead of the draw record.)');
            process.exit(1);
        }
        if (stored.status === 'sent') {
            say('');
            say(`${address} was already marked sent on ${stored.sentAt || '?'} — left alone.`);
            if (stored.sentNote) say(`note on record: ${stored.sentNote}`);
            return;
        }
        // The signature is what makes the address the player's, so a send without one is a decision
        // the team makes on purpose rather than one this tool makes by accident.
        if (!wallet.registration && !stored.claimedAt && !forced) {
            console.error('');
            console.error(`${address} has not proved the wallet — nobody has registered or claimed for it.`);
            console.error('The capsule would go to an address nobody has shown is theirs.');
            console.error('Wait for the claim, or pass --force if the team has established it another way.');
            process.exit(1);
        }

        const at = new Date().toISOString();
        await Store.updateWallet(address, (w) => {
            const row = w.capsules?.[send.day];
            if (row && row.status !== 'sent') {
                row.status = 'sent';
                row.sentAt = at;
                row.sentNote = note || null;
            }
            return w;
        });

        say('');
        say(`sent — ${send.day} · ${Config.DRAW_CAPSULE.name} → ${address}`);
        if (wallet.x?.username) say(`  handle            @${wallet.x.username}`);
        say(`  claimed           ${stored.claimedAt || (wallet.registration ? 'unsigged — the wallet is registered' : 'no')}`);
        say(`  form submitted    ${stored.formSubmittedAt || 'no'}`);
        say(`  marked sent at    ${at}`);
        if (note) say(`  note              ${note}`);
        say('');
        say('The wallet now reads “sent” on its own ledger. Tell the winner in Discord if you can —');
        say('nothing else about this reaches them.');
        if (!day && !csv && !todo && !scan) return;
    }

    // ------------------------------------------------------------------ gather the rows
    const draws = await Draw.recentDraws(180);

    /** One line of the list, joined from the draw record and the wallet that holds the win. */
    async function rowFor(record, winner, address, loaded = null) {
        const wallet = loaded || (await Store.getWallet(address)) || {};
        const stored = wallet.capsules?.[record.day] || null;
        const view = stored ? Capsules.capsuleView(stored) : null;
        return {
            day: record.day,
            dayNumber: record.dayNumber ?? Config.programDay(record.day),
            rank: Number(winner.rank) || null,
            address,
            handle: wallet.x?.username || winner.handle || null,
            handleProved: wallet.x?.verified === true || winner.handleProved === true,
            points: Number(stored?.points ?? winner.points) || 0,
            wonAt: stored?.wonAt || null,
            registered: Boolean(wallet.registration),
            registeredAt: wallet.registration?.at || null,
            claimedAt: stored?.claimedAt || null,
            claimed: Boolean(stored?.claimedAt),
            formSubmittedAt: stored?.formSubmittedAt || null,
            sentAt: stored?.sentAt || null,
            sentNote: stored?.sentNote || null,
            status: view?.status || (stored ? 'won' : 'missing'),
            // A win the record knows about and the wallet does not is the failure this listing is
            // here to catch: the record says a capsule was handed out and the address never got one.
            onRecordOnly: !stored,
            onWalletOnly: !winner.rank,
        };
    }

    /**
     * Every win we know of, newest day first: the record's rows, then — with `--scan` — anything the
     * wallets hold that the record does not. A record write that failed is invisible above (the
     * awards are made on the wallet, so the capsule was paid) and this is the only way to see it.
     */
    const rows = [];
    const seen = new Set();
    for (const record of day ? draws.filter((d) => d.day === day) : draws) {
        for (const winner of record.winners || []) {
            const address = Store.normaliseAddress(winner.address);
            if (!address) continue;
            seen.add(`${record.day}:${address}`);
            rows.push(await rowFor(record, winner, address));
        }
    }
    if (scan) {
        const all = await Store.debugDump();
        for (const wallet of Object.values(all)) {
            const address = Store.normaliseAddress(wallet.address);
            for (const [key, capsule] of Object.entries(wallet.capsules || {})) {
                if (!Config.isDayKey(key)) continue;
                if (day && key !== day) continue;
                if (seen.has(`${key}:${address}`)) continue;
                seen.add(`${key}:${address}`);
                const record = draws.find((d) => d.day === key) || { day: key, dayNumber: capsule.dayNumber };
                rows.push(await rowFor(record, { address, points: capsule.points, rank: capsule.rank }, address, wallet));
            }
        }
    }
    rows.sort((a, b) => (a.day === b.day ? (a.rank ?? 0) - (b.rank ?? 0) : (a.day < b.day ? 1 : -1)));

    // ------------------------------------------------------------------ the listing
    const list = todo ? rows.filter((r) => r.status !== 'sent') : rows;

    if (csv) {
        const head = ['day', 'day_number', 'rank', 'handle', 'handle_proved', 'address', 'points',
            'won_at', 'registered', 'claimed', 'form_submitted', 'sent', 'sent_note', 'status'];
        console.log(head.join(','));
        for (const r of list) {
            console.log([
                r.day, r.dayNumber, r.rank ?? '', r.handle || '', r.handleProved ? 'yes' : 'no',
                r.address, r.points, r.wonAt || '', r.registered ? 'yes' : 'no',
                r.claimed ? (r.claimedAt || 'yes') : 'no', r.formSubmittedAt || '',
                r.sentAt || '', r.sentNote || '', r.status,
            ].map(cell).join(','));
        }
        return;
    }

    say('');
    say(`Points capsules — store: ${Store.storageDescription()}`);
    say(`prize: one ${Config.DRAW_CAPSULE.name} per winner · ${Config.DRAW_SIZE} a day · claim window ${Config.CAPSULE_CLAIM_WINDOW_DAYS} day(s)`);

    if (!list.length) {
        say('');
        say(day ? `${day} has no wins on record.` : 'No draw has been settled yet, so there is nothing to send.');
        if (draws.length && !day) say(`(draws on record: ${draws.map((d) => d.day).join(', ')})`);
        return;
    }

    let currentDay = null;
    for (const r of list) {
        if (r.day !== currentDay) {
            currentDay = r.day;
            // The whole day, not just the rows left after `--todo`: the header is how the day went,
            // and a filtered list reporting "2 capsule(s) won" out of four is a number that reads as
            // a lost prize.
            const dayRows = rows.filter((x) => x.day === r.day);
            const settled = draws.find((d) => d.day === r.day);
            say('');
            say(`${r.day}  ·  day ${r.dayNumber}  ·  settled ${settled?.at ? `${settled.at.slice(0, 16).replace('T', ' ')}Z` : '—'}`
                + (settled?.winners ? `  ·  ${settled.winners.length} of ${settled.qualifiers} on the board` : ''));
            say(`  ${summary(dayRows)}`);
        }
        say('');
        say(`  #${r.rank ?? '-'}  @${r.handle || '(no handle)'}${r.handleProved ? '' : ' (unproved handle)'}`);
        say(`      wallet         ${r.address}`);
        say(`      earned         ${r.points.toLocaleString('en-US')} PTS`);
        say(`      wallet proved  ${r.registered ? `yes — registered ${r.registeredAt || '?'}` : 'NO — nobody has signed for this address'}`);
        say(`      claimed        ${r.claimed ? r.claimedAt : (r.status === 'missed' ? 'no — the window has closed' : 'no')}`);
        say(`      form           ${r.formSubmittedAt ? `submitted ${r.formSubmittedAt}` : 'not marked submitted'}`);
        say(`      capsule        ${r.status}${r.sentAt ? ` — sent ${r.sentAt}${r.sentNote ? ` (${r.sentNote})` : ''}` : ''}`);
        if (r.onRecordOnly) {
            say('      !! the draw record lists this win but the wallet does not hold it — the award did not land.');
        }
        if (r.onWalletOnly) {
            say('      !! this win is on the wallet but not in the draw record — recovered by --scan.');
        }
    }

    say('');
    say(`  ${list.length} capsule(s) listed${todo ? ' still to send' : ''}`
        + `  ·  ${list.filter((r) => r.status === 'sent').length} sent`
        + `  ·  ${list.filter((r) => r.claimed).length} claimed`
        + `  ·  ${list.filter((r) => !r.registered).length} with an unproved wallet`);

    if (day) {
        say('');
        say(`How ${day} went, in one line:`);
        say(`  ${summary(rows)}`);
    }

    say('');
    say('  --day <YYYY-MM-DD>    one day, in full');
    say('  --todo                only the capsules still to send');
    say('  --csv                 the same list as CSV (for the form responses or a spreadsheet)');
    say('  --send <day> <addr>   mark one capsule sent (--note "tx 0x…" records the proof)');
    say('  --force               send to a wallet nobody has claimed or registered for (the team decides)');
    say('  --scan                read the wallets rather than the draw record, to catch a lost record write');
    say('  --draw <YYYY-MM-DD>   settle a day by hand, e.g. if the cron never fired');
    say('');
    say('  Send the capsule first, then run --send: the marker is a claim about the world, and the');
    say('  wallet reads whatever you write there. The form is at');
    say(`  ${Config.CAPSULE_FORM_URL}`);
})().catch((error) => {
    console.error('');
    console.error(error.message || error);
    process.exit(1);
});

/** A CSV cell, quoted only when it has to be. */
function cell(value) {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The day in one sentence, which is what a person reading this actually wants first. */
function summary(dayRows) {
    const claimed = dayRows.filter((r) => r.claimed).length;
    const proved = dayRows.filter((r) => r.registered).length;
    const sent = dayRows.filter((r) => r.sentAt).length;
    const missed = dayRows.filter((r) => r.status === 'missed').length;
    return `${dayRows.length} capsule(s) won · ${proved} wallet(s) proved · ${claimed} claimed · ${sent} sent`
        + (missed ? ` · ${missed} window(s) closed unclaimed` : '');
}
