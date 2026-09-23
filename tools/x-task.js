#!/usr/bin/env node
/**
 * Publish a one-time task from a post you have just made.
 *
 *     node tools/x-task.js add https://x.com/DNGrobinhood/status/2101…             # comment task
 *     node tools/x-task.js add https://x.com/DNGrobinhood/status/2101… --kind quote
 *     node tools/x-task.js add <link> --reward 750 --title "Quote the Genesis teaser"
 *     node tools/x-task.js list
 *     node tools/x-task.js remove 2101382088767517039        # or the link itself
 *
 * WHY THIS EXISTS
 * ---------------
 * The four quote tasks that launched were written into `lib/points-config.js`, so publishing the
 * next one meant a code change and a deploy. Tasks now live in the store instead, and this is what
 * writes them: run it and the card is in every player's One-time tab on the next read.
 *
 * The task is identified by the **post's own id**, so running `add` twice for the same post updates
 * that one task rather than putting two cards behind the same reward, and `remove` takes either the
 * id or the link.
 *
 * WHAT IT ASKS FOR
 * ----------------
 * `--kind comment` (the default) asks the player to reply to the post, tag us in the reply, and
 * paste the link to their reply. `--kind quote` asks them to quote-post it, tag us, and paste the
 * link to their quote. Both are checked by the same verifier the shipped tasks use: X is asked who
 * wrote the pasted post and whether it tags us. X cannot see *which* post was replied to or quoted
 * — the generated hint says so, because a card that implied otherwise would promise a check nobody
 * can run.
 *
 * WHERE IT WRITES
 * ---------------
 * The store the deployment uses, which is printed before anything else, because the difference is
 * the difference between "everyone sees this now" and "only this checkout sees this":
 *
 *   - `local file .data/points.json` — development. The dev server reads the same file, so the card
 *     appears there; production is untouched.
 *   - `Upstash/Vercel KV (REST)` — production. Pull the credentials into the shell for one command,
 *     **never** into a committed file:
 *
 *         npx vercel env pull /tmp/prod.env --environment=production
 *         node --env-file=/tmp/prod.env tools/x-task.js add <link>
 *
 *   - `in-memory` — a warning, not a place to publish. Nothing survives the process.
 *
 * Removing a task stops it being offered. It cannot un-pay anybody: the record lives on the wallet,
 * and a player already credited keeps the points and the receipt.
 */

import { STORAGE_DRIVER, storageDescription, debugDump } from '../lib/points-store.js';
import { TASK_KINDS, addExtraTask, extraOneTimeTasks, parsePostUrl, removeExtraTask } from '../lib/points-tasks.js';
import { ONE_TIME_TASKS, X_SHARE_TAG } from '../lib/points-config.js';

const [command = '', ...rest] = process.argv.slice(2);

function flag(name, fallback = null) {
    const index = rest.indexOf(`--${name}`);
    if (index === -1) return fallback;
    const next = rest[index + 1];
    return next && !next.startsWith('--') ? next : true;
}

/** The first argument that is not a flag or a flag's value. */
function positional() {
    for (let i = 0; i < rest.length; i++) {
        const value = rest[i];
        if (value.startsWith('--')) {
            const next = rest[i + 1];
            if (next && !next.startsWith('--')) i += 1;
            continue;
        }
        return value;
    }
    return null;
}

function usage() {
    console.log(`
Publish a one-time task from a post.

  node tools/x-task.js add <post-url> [--kind ${TASK_KINDS.join('|')}] [--reward N] [--title "…"]
  node tools/x-task.js list
  node tools/x-task.js remove <id|post-url>

  --kind comment   reply to the post, tag us, paste the link to your reply   (default)
  --kind quote     quote-post it, tag it us, paste the link to your quote
  --reward N       points for the task (default: the published quote reward)
  --title "…"      the card's heading (default: taken from the post itself)
`);
}

/** The store first, always: it decides whether this write reaches players or only this machine. */
function whereItWrites() {
    console.log(`\nPoints store: ${storageDescription()}`);
    if (STORAGE_DRIVER === 'memory') {
        console.log('  ⚠  in memory — a task published here is lost when this process exits.');
        console.log('     Set KV_REST_API_URL + KV_REST_API_TOKEN (production) before publishing.');
    } else if (STORAGE_DRIVER === 'file') {
        console.log('  → this checkout only. Production has its own store; see the header for the');
        console.log('    one command that publishes with production credentials.');
    }
}

/**
 * The post's own words, for the card's heading.
 *
 * X's oEmbed endpoint answers for a public post with no key — the same free thing `lib/x-verify.js`
 * is built on — and the post's text comes back inside a blockquote. A heading taken from it reads
 * like the tasks that shipped ("Quote-post the Map Reveal") instead of "Task 2100974…". If it
 * refuses, or there is no network, the ask's own heading is used: publishing a task must never fail
 * because a public endpoint changed.
 */
async function postTitle(post) {
    try {
        const res = await fetch(
            `https://publish.twitter.com/oembed?omit_script=1&dnt=true&url=${encodeURIComponent(post.url)}`,
            { signal: AbortSignal.timeout(6000) }
        );
        if (!res.ok) return null;
        const { html } = await res.json();
        const text = String(html || '')
            .replace(/<br\s*\/?>/gi, ' ')
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ')
            .trim();
        // The furniture at the end of that HTML: "— Author (@handle) August 12, 2026".
        const body = text.replace(/\s*—\s*[^—]*$/, '').trim();
        if (!body) return null;
        return body.length > 90 ? `${body.slice(0, 87).trimEnd()}…` : body;
    } catch {
        return null;
    }
}

/** How many wallets this tool can see have been paid for a task, with the reach of the read. */
function paidCount(wallets, taskId) {
    return Object.values(wallets || {}).filter((doc) => doc?.tasks?.[`one:${taskId}`]?.state === 'verified').length;
}

async function add() {
    const url = positional();
    if (!url) {
        console.error('Which post? Give the link: node tools/x-task.js add <post-url>');
        process.exitCode = 1;
        return;
    }

    const post = parsePostUrl(url);
    if (!post) {
        console.error(`That is not a link to a post: ${url}`);
        console.error('It has to be x.com/<handle>/status/<id>.');
        process.exitCode = 1;
        return;
    }

    const kind = String(flag('kind', 'comment'));
    const reward = flag('reward', null);
    const explicitTitle = flag('title', null);
    const title = typeof explicitTitle === 'string' && explicitTitle.trim()
        ? explicitTitle.trim()
        : (await postTitle(post));

    whereItWrites();

    const result = await addExtraTask({
        url: post.url,
        kind,
        reward: reward === true ? undefined : reward,
        title: title || undefined,
    });

    if (result.error) {
        console.error(`\n${result.error}`);
        process.exitCode = 1;
        return;
    }

    const { task, replaced } = result;
    console.log(`\n${replaced ? 'Updated' : 'Published'}  —  ${task.kind}`);
    console.log(`  ${task.title}   +${task.reward} PTS`);
    console.log(`  post   ${task.url}`);
    console.log(`  asks   ${task.ask === 'quote' ? 'quote it' : 'reply to it'}, tag @${X_SHARE_TAG},`
        + ' then paste the link to what you wrote');
    console.log(`\n  It is in the One-time tab for every player on this store now.`);
    console.log(`  Take it down with:  node tools/x-task.js remove ${task.id}`);
    if (STORAGE_DRIVER === 'file') {
        console.log(`  (this checkout's store only — production needs the KV command in this file's header)`);
    }
}

async function list() {
    whereItWrites();
    const stored = await extraOneTimeTasks();
    const wallets = await debugDump();
    const reach = STORAGE_DRIVER === 'redis' ? 'the top 200 wallets it can read' : 'every wallet it can read';

    console.log(`\nShipped with the program (${ONE_TIME_TASKS.length})`);
    for (const task of ONE_TIME_TASKS) {
        console.log(`  ${task.id.padEnd(14)} ${String(task.proof).padEnd(7)} +${String(task.reward).padStart(4)} PTS  ${task.title}`);
    }

    console.log(`\nPublished from here (${stored.length})`);
    if (!stored.length) {
        console.log('  none — `add` a post to make one');
    }
    for (const task of stored) {
        const paid = paidCount(wallets, task.id);
        console.log(`  ${task.id.padEnd(14)} ${task.ask.padEnd(7)} +${String(task.reward).padStart(4)} PTS  ${task.title}`);
        console.log(`  ${''.padEnd(14)} ${task.url}`);
        console.log(`  ${''.padEnd(14)} paid for ${paid} wallet${paid === 1 ? '' : 's'} (of ${Object.keys(wallets || {}).length} read — ${reach})`);
    }
    console.log('');
}

async function remove() {
    const target = positional();
    if (!target) {
        console.error('What should come down? Give the id or the link.');
        process.exitCode = 1;
        return;
    }

    whereItWrites();
    const result = await removeExtraTask(target);
    if (result.error) {
        console.error(`\n${result.error}`);
        process.exitCode = 1;
        return;
    }

    console.log(`\nRemoved  —  ${result.removed}`);
    console.log(`  ${result.remaining} stored task${result.remaining === 1 ? '' : 's'} left.`);
    console.log('  Anyone already paid for it keeps the points: the record is on their wallet.');
}

(async () => {
    if (command === 'add') return add();
    if (command === 'list') return list();
    if (command === 'remove') return remove();
    usage();
    process.exitCode = command ? 1 : 0;
})().catch((error) => {
    console.error(`x-task failed: ${error?.message || error}`);
    process.exitCode = 1;
});
