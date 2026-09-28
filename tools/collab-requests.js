#!/usr/bin/env node
/**
 * The collab requests — who has asked, and what to do about it.
 *
 *     node tools/collab-requests.js                       # everything, oldest first
 *     node tools/collab-requests.js --status pending
 *     node tools/collab-requests.js --show 3
 *     node tools/collab-requests.js --approve 3           # by row, wallet or handle
 *     node tools/collab-requests.js --reject 3 --note "Too short notice — ask again in October."
 *     node tools/collab-requests.js --remove 3
 *     node tools/collab-requests.js --projects            # what the giveaway tab shows right now
 *
 * WHY THIS EXISTS
 * ---------------
 * A project *asks* on `/collab`, and a status a browser could set would be a status nobody decided —
 * so deciding happens behind a wallet on the deployment's owner list (`lib/collab-owners.js`), and
 * there are two ways in. The page at `/collab/review` is the same job with a face on it; this is the
 * one that works from a terminal, against the store's own credentials, with the site down. It also
 * keeps the two jobs the browser deliberately does not have: **`--remove`**, and reading requests from
 * a store the page is not configured to reach.
 *
 * **Approval is what puts the project on the page.** The upload route refuses anything that is not
 * approved (`lib/collab-store.js#attachRequestPhoto`), so the order is: read the request, decide,
 * approve, and the project can then upload its profile picture on `/collab#submit` and download the
 * finished card. And the giveaway tab reads the approved rows **out of the store**
 * (`listedProjects`), so approving is the whole of adding a project: nothing is pasted into
 * `COLLAB_PROJECTS`, no file is edited, and no deploy is needed. The slug is minted from the handle
 * on approval and is the project's key from then on — which is why it is printed: it is what the
 * entries for that project are filed under, and what `--projects` shows.
 *
 * `--projects` is the check that the two halves meet: it prints the list the page would render,
 * pinned and approved together, with whether each one has a picture yet.
 *
 * It reads the same store the deployment does: the local file in development, and Redis when
 * `KV_REST_API_URL` + `KV_REST_API_TOKEN` are in the environment — which for production means pulling
 * them into the shell for one command, **never** into `.env.local`:
 *
 *     npx vercel env pull /tmp/prod.env --environment=production
 *     node --env-file=/tmp/prod.env tools/collab-requests.js
 *
 * This is the only place a request is printed, and a request is somebody's plan rather than personal
 * data: a project name, a handle, and a note — no email, no IP, nothing about a person. What it does
 * print is *who asked* (the wallet), because two people claiming one handle is a thing the owner has
 * to be able to see.
 */

const args = process.argv.slice(2);

const flag = (name, fallback = null) => {
    const index = args.indexOf(`--${name}`);
    if (index === -1) return fallback;
    const next = args[index + 1];
    return next && !next.startsWith('--') ? next : true;
};

const statusFilter = String(flag('status', '') || '').trim() || null;
const wanted = [flag('show', null), flag('approve', null), flag('reject', null), flag('remove', null)]
    .find((value) => value !== null && value !== undefined) ?? null;
const action = args.includes('--approve') ? 'approve'
    : args.includes('--reject') ? 'reject'
        : args.includes('--remove') ? 'remove'
            : args.includes('--projects') ? 'projects'
                : args.includes('--show') ? 'show'
                    : 'list';
const note = String(flag('note', '') || '').trim() || null;

/** The address printed in the paste-ready snippet and in the "go here" line. */
const SITE = String(process.env.SITE_URL || 'https://dungeonknights.io').replace(/\/$/, '');

/** `2026-09-28T06:31:11.204Z` → `2026-09-28 06:31`, which is what a person reads. */
function when(value) {
    const text = String(value || '');
    return /^\d{4}-\d{2}-\d{2}T/.test(text) ? `${text.slice(0, 10)} ${text.slice(11, 16)}` : (text || '—');
}

function shortWallet(address) {
    const text = String(address || '');
    return text.length > 12 ? `${text.slice(0, 6)}…${text.slice(-4)}` : text;
}

/**
 * Find the row a person meant.
 *
 * By the row number this tool prints (the way you point at something you can see), by the wallet, or
 * by the handle — case-insensitively, because X does not care about the case and neither should this.
 */
function find(rows, needle) {
    const text = String(needle ?? '').trim();
    if (!text) return { error: 'say which request — a row number from the listing, a wallet, or a handle' };

    if (/^\d+$/.test(text)) {
        const index = Number(text) - 1;
        if (index < 0 || index >= rows.length) return { error: `there is no row ${text}` };
        return { row: rows[index] };
    }

    if (text.startsWith('0x') && text.length === 42) {
        const row = rows.find((candidate) => String(candidate.wallet).toLowerCase() === text.toLowerCase());
        return row ? { row } : { error: `no request from ${text}` };
    }

    const handle = text.replace(/^@+/, '').toLowerCase();
    const matches = rows.filter((candidate) => String(candidate.handle || '').toLowerCase() === handle);
    if (!matches.length) return { error: `no request from @${handle}` };
    if (matches.length > 1) {
        return { error: `@${handle} has ${matches.length} requests — use a row number or a wallet` };
    }
    return { row: matches[0] };
}

(async () => {
    const Store = await import('../lib/collab-store.js');

    console.log('');
    console.log(`Collab requests  —  ${Store.storageDescription()}`);

    if (statusFilter && !Store.REQUEST_STATUSES.includes(statusFilter)) {
        console.log('');
        console.log(`  "${statusFilter}" is not a status. One of: ${Store.REQUEST_STATUSES.join(', ')}`);
        process.exitCode = 1;
        return;
    }

    if (action === 'projects') {
        const projects = await Store.listedProjects();
        console.log(`The giveaway tab shows ${projects.length} project${projects.length === 1 ? '' : 's'}:`);
        console.log('');
        for (const project of projects) {
            console.log(`  ${project.slug}  —  ${project.name} @${project.handle}`);
            console.log(`       prize    ${project.prize}`);
            console.log(`       blurb    ${project.blurb}`);
            console.log(`       source   ${project.approved ? 'an approved request (read from the store)' : 'pinned in lib/collab-content.js'}`);
            console.log(`       picture  ${project.avatar ? project.avatar : 'none yet — the tab shows the initial'}`);
            console.log('');
        }
        console.log('  A project appears here by being approved: nothing is pasted into a file.');
        console.log('');
        return;
    }

    const all = await Store.listRequests({ status: statusFilter });
    console.log(`${all.length} request${all.length === 1 ? '' : 's'}${statusFilter ? ` (${statusFilter})` : ''}`);
    console.log('');

    if (!all.length) {
        console.log('  Nothing waiting. A project asks at /collab#submit.');
        console.log('');
        return;
    }

    all.forEach((row, index) => {
        console.log(`  ${String(index + 1).padStart(2)}.  [${row.status}]  ${row.name}  @${row.handle}`);
        console.log(`       prize   ${row.prize}`);
        if (row.dates) console.log(`       dates   ${row.dates}`);
        if (row.note) console.log(`       note    ${row.note}`);
        console.log(`       wallet  ${shortWallet(row.wallet)}   sent ${when(row.at)}` +
            `${row.revisions > 1 ? `  (${row.revisions} revisions)` : ''}`);
        if (row.photo) console.log(`       picture ${Math.round((row.photoBytes || 0) / 1024)} KB, uploaded ${when(row.photoAt)}`);
        if (row.decidedAt) console.log(`       decided ${when(row.decidedAt)}${row.decidedNote ? ` — ${row.decidedNote}` : ''}`);
        console.log('');
    });

    if (action === 'list') {
        console.log('  --approve  <row|wallet|handle>  let it through — it goes on the giveaway tab, and');
        console.log('                                  unlocks the picture upload');
        console.log('  --reject   <row|wallet|handle>  turn it down, with --note "why"');        console.log('  --remove  <row|wallet|handle>   take the request out of the store entirely');
        console.log('  --projects                      print what the giveaway tab shows right now');
        console.log('');
        console.log(`  The same decisions in a browser, signed with the owner wallet: ${SITE}/collab/review`);
        console.log(`  pending: ${all.filter((row) => row.status === 'pending').length}`);
        console.log('');
        return;
    }

    const found = find(all, wanted === true ? '' : wanted);
    if (found.error) {
        console.log(`  ${found.error}`);
        console.log('');
        process.exitCode = 1;
        return;
    }

    const row = found.row;
    console.log(`  → ${action} ${row.name} @${row.handle} (${shortWallet(row.wallet)})`);

    if (action === 'approve') {
        const result = await Store.setRequestStatus(row.wallet, 'approved', { note });
        if (result.error) {
            console.log(`  ${result.error}`);
            process.exitCode = 1;
            return;
        }
        console.log(`  approved. slug: ${result.request.slug}`);
        console.log('');
        console.log('  It is on the giveaway tab now — /collab reads the approved projects out of the');
        console.log('  store, so there is nothing to paste and nothing to deploy.');
        console.log('');
        console.log(`  The project can upload its picture at ${SITE}/collab#submit (it must sign with the`);
        console.log('  same wallet) and download the finished card. Until it does, the tab shows the first');
        console.log('  letter of its name rather than somebody else\'s face.');
        console.log('');
        return;
    }

    if (action === 'reject') {
        const result = await Store.setRequestStatus(row.wallet, 'rejected', { note });
        if (result.error) {
            console.log(`  ${result.error}`);
            process.exitCode = 1;
            return;
        }
        console.log('  rejected. The project is told on the page, can edit the details and send it again.');
        if (!note) console.log('  (no --note given, so the page shows the generic line)');
        console.log('');
        return;
    }

    const purged = await Store.purgeRequest(row.wallet);
    console.log(`  removed ${purged.removed.length} row(s)${row.photo ? ', picture included' : ''}.`);
    console.log('');
})();
