#!/usr/bin/env node
/**
 * The Genesis waitlist — who is in line, and how to get them back out.
 *
 *     node tools/waitlist.js                 # the list, oldest first
 *     node tools/waitlist.js --count         # just the number
 *     node tools/waitlist.js --csv > list.csv
 *     node tools/waitlist.js --followers     # only the people who said they followed
 *     node tools/waitlist.js --remove you@example.com
 *
 * WHY THIS EXISTS
 * ---------------
 * The signup form is public and writes to a store, and until now nothing could read it back. That is
 * the wrong half to have: a list nobody can export is a list you cannot use, and a record that
 * cannot be deleted is one you should not have collected. This tool is both ends — it is the only
 * reader of the waitlist, and the only way to take an entry back out.
 *
 * It reads the same store the deployment does: the local file in development, and Redis when
 * `KV_REST_API_URL` + `KV_REST_API_TOKEN` are in the environment — which for production means
 * pulling them into the shell for one command, **never** into `.env.local`:
 *
 *     npx vercel env pull /tmp/prod.env --environment=production
 *     node --env-file=/tmp/prod.env tools/waitlist.js
 *
 * WHAT THE COLUMNS MEAN
 * ---------------------
 * `position` is the place in the queue when the person signed up, and it never moves. `follow` is
 * **their word, not a fact** — X's free API has no view of who follows whom, so the landing page
 * says so and this listing prints `claimed, unchecked` rather than a tick. Treat the two together:
 * a position says who is first, the follow column says who to tell twice.
 *
 * This is the one file in the project that prints personal data, so it prints *only* what it is
 * asked for: no `--csv` writes to stdout so the file can be redirected, and nothing is ever written
 * back except the removal you explicitly asked for.
 */

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
    const index = args.indexOf(`--${name}`);
    if (index === -1) return fallback;
    const next = args[index + 1];
    return next && !next.startsWith('--') ? next : true;
};

const asCsv = args.includes('--csv');
const countOnly = args.includes('--count');
const followersOnly = args.includes('--followers');
const removing = String(flag('remove', '') || '').trim();

/** One CSV field, quoted the way a spreadsheet expects. */
function csvField(value) {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

(async () => {
    const Store = await import('../lib/waitlist-store.js');

    // The store resolves its driver from the environment at import time, so this line is also the
    // answer to "which database did I just read?" — the same honesty the points tool prints.
    if (!asCsv) {
        console.log(`Genesis waitlist — store: ${Store.storageDescription()}`);
        console.log('');
    }

    if (removing) {
        if (!Store.normaliseEmail(removing)) {
            console.error(`That is not an email address: ${removing}`);
            process.exit(1);
        }
        const result = await Store.purgeEntry(removing);
        if (asCsv) {
            // A CSV run stays machine-readable even when it is doing something else.
            console.log(`removed,${csvField(removing)},${result.removed.length}`);
        } else if (!result.removed.length) {
            console.log(`${removing} is not on the list — nothing to remove.`);
        } else {
            console.log(`removed ${removing} — ${result.removed.join(', ')}`);
            console.log(result.survived ? '  WARNING: it is still readable, so the removal failed.' : '  and confirmed gone.');
        }
        return;
    }

    const entries = await Store.listWaitlist();
    // The same function the landing page's `GET` uses, so "how many are in line" cannot be one
    // number here and another number there.
    const inLine = await Store.waitlistSize();

    if (countOnly) {
        console.log(String(inLine));
        return;
    }

    if (asCsv) {
        // Positions are exported as they were assigned, so the file is a queue and not a re-ranking.
        console.log(['position', 'email', 'handle', 'wallet', 'follow', 'source', 'joined'].join(','));
        for (const row of entries) {
            console.log([
                csvField(row.position),
                csvField(row.email),
                csvField(row.handle ? `@${row.handle}` : ''),
                csvField(row.address || ''),
                csvField(row.followClaimed ? 'claimed, unchecked' : ''),
                csvField(row.source),
                csvField(row.at),
            ].join(','));
        }
        return;
    }

    if (!entries.length) {
        console.log('Nobody is on the list yet.');
        console.log('');
        console.log('Signups are written to the store this tool just read, so if the landing page has been');
        console.log('live and this is empty, check that the deployment has KV_REST_API_URL and');
        console.log('KV_REST_API_TOKEN set — without them production keeps the list in memory and loses');
        console.log('it on every redeploy.');
        return;
    }

    const shown = followersOnly ? entries.filter((row) => row.followClaimed) : entries;
    const claimed = entries.filter((row) => row.followClaimed).length;

    console.log(`${inLine} on the list — ${claimed} said they followed @DNGrobinhood (unchecked).`);
    if (inLine !== entries.length) {
        // Should never happen; if it does, the two records of the same fact have drifted and the
        // number on the landing page is wrong.
        console.log(`  WARNING: ${entries.length} entries but the page advertises ${inLine} — the count and the list disagree.`);
    }
    console.log('');

    for (const row of shown) {
        const bits = [`#${row.position}`.padEnd(6), row.email.padEnd(34)];
        if (row.handle) bits.push(`@${row.handle}`.padEnd(18));
        if (row.address) bits.push(`${row.address.slice(0, 10)}…`.padEnd(14));
        if (row.followClaimed) bits.push('follow claimed');
        console.log(`  ${bits.join(' ')}`);
        console.log(`        joined ${row.at}${row.source && row.source !== 'landing' ? `  (via ${row.source})` : ''}`);
    }

    if (followersOnly && !shown.length) {
        console.log('  Nobody has claimed a follow yet.');
    }

    console.log('');
    console.log('  --count               just the number, for a script');
    console.log('  --csv                 a spreadsheet-ready export on stdout');
    console.log('  --followers           only the people who said they followed');
    console.log('  --remove <email>      take an entry back out, and confirm it is gone');
    console.log('');
    console.log('  The follow column is a claim the person made about themselves: X\'s free API cannot');
    console.log('  see who follows whom. It is worth a second message, not a verification.');
})().catch((error) => {
    console.error('');
    console.error(error?.message || error);
    process.exit(1);
});
