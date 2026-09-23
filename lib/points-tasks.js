/**
 * The one-time tasks that arrive after the code shipped.
 *
 * The four quote-reposts in `lib/points-config.js` are written down in code, which is right for the
 * tasks that launched with the program and wrong for the next one: publishing a task should not
 * need a deploy, and it should not need anybody to remember which id the page files a link against.
 * So the extra ones live in the store as a single document, and `tools/x-task.js` is what writes it.
 *
 * **A task is identified by the post it is about.** The id is the tweet's own id, which makes
 * adding the same post twice an update rather than a second card paying the same reward twice, and
 * makes `remove` work from either the id or the link.
 *
 * **One post carries one task, and a second one is refused at publish time.** The engine already
 * refuses to pay two tasks for the same link (`post-already-used` in `submitTask`), because that is
 * how one post would collect four rewards. So a second card about a post that already has one could
 * never settle for a player who did the first — it would ask for work and then disappoint — and the
 * refusal belongs where a human can still fix it, not in a card a player has already worked on.
 *
 * **Nothing here decides whether a task pays.** A stored task is a `proof: 'verify'` task, so it is
 * settled by exactly the engine the four shipped ones use (`submitTask` in `lib/points-program.js`):
 * X is asked who wrote the pasted post and whether it tags us, once per wallet, ever. The claim path
 * deliberately cannot see these tasks at all — `claimOneTime` reads the static registry — so a
 * checked task can never be paid on a tap with its verifier bypassed.
 *
 * **The copy stays an ask.** A generated card says what to do and where its link comes from, in one
 * sentence: the reward, the button and the post are already on the card, and the tax of explaining
 * what a check can and cannot see belongs in this file, not under a task a player is trying to finish.
 */

import { ONE_TIME_POSTS, X_QUOTE_REWARD } from './points-config.js';
import { documentRead, documentWrite, documentDelete } from './points-store.js';

/** One document, on the store's existing drivers: the dev file, the KV, or memory. */
const TASKS_KEY = 'dk:points:tasks';

/** The two things a post can ask for. Both are checked the same way; only the ask differs. */
export const TASK_KINDS = ['comment', 'quote'];

/**
 * A link to a post, and only that.
 *
 * Handles are 1–15 characters and a status id is a long run of digits, so a profile link, a
 * shortened link or another host cannot pass — which matters, because the card opens this URL and
 * the whole task is about the post behind it. The scheme is optional because a link is often pasted
 * as it was copied out of the address bar, or typed by hand as `x.com/…`.
 */
const POST_RE = /^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})(?:[/?#][^\s]*)?$/i;

/**
 * The two asks, as short as they can be while still saying what to do.
 *
 * An ask is one sentence: what to do, and where the link comes from. The card already carries the
 * reward and a button that opens the post, so the hint is not the place for our side of the check.
 */
const ASKS = {
    comment: {
        title: 'Reply to our post and tag us',
        cta: 'Open the post to reply',
        hint: 'Reply to this post with your own words and tag @{handle}, then paste the link to your reply.',
    },
    quote: {
        title: 'Quote-post our post and tag us',
        cta: 'Open the post to quote',
        hint: 'Quote this post with your own words and tag @{handle}, then paste the link to your quote.',
    },
};

/**
 * The post behind a pasted link, or null.
 *
 * Tracking is dropped rather than stored: a link arrives as `…?s=20` as often as not, and the
 * canonical form is what the card opens and what a later `remove` is matched against.
 */
export function parsePostUrl(input) {
    const match = POST_RE.exec(String(input || '').trim());
    if (!match) return null;
    const [, handle, id] = match;
    return { id, handle, url: `https://x.com/${handle}/status/${id}` };
}

/**
 * A stored entry, made renderable.
 *
 * A hand-edited document — or one written by a version of the tool that knew fewer fields — still
 * has to produce a card rather than a blank one, so every field the page reads is either present or
 * filled from the ask it names. Nothing here invents a reward: an amount that is not a positive
 * whole number falls back to the published one.
 */
function normaliseTask(entry) {
    const id = String(entry?.id || '').trim();
    const ask = String(entry?.ask || 'comment').toLowerCase();
    const copy = ASKS[ask] || ASKS.comment;
    const reward = Math.floor(Number(entry?.reward));
    const post = parsePostUrl(entry?.url);

    return {
        id,
        kind: `onetime:${id}`,
        title: String(entry?.title || copy.title).slice(0, 120),
        reward: Number.isFinite(reward) && reward > 0 ? reward : X_QUOTE_REWARD,
        proof: 'verify',
        cta: String(entry?.cta || copy.cta),
        url: post ? post.url : String(entry?.url || ''),
        hint: String(entry?.hint || copy.hint),
        ask: ask in ASKS ? ask : 'comment',
        addedAt: entry?.addedAt || null,
    };
}

/** Every stored task, in the order they were added. Empty when there are none. */
export async function extraOneTimeTasks() {
    const raw = await documentRead(TASKS_KEY);
    if (!raw) return [];

    let list = null;
    try {
        list = JSON.parse(raw);
    } catch {
        // A corrupted document is not a reason to stop earning: the shipped tasks still render.
        return [];
    }
    if (!Array.isArray(list)) return [];

    const seen = new Set();
    return list
        .map(normaliseTask)
        .filter((task) => {
            if (!task.id || seen.has(task.id)) return false;
            // The id is the link's, so a card cannot open a post it is not about.
            if (!parsePostUrl(task.url)) return false;
            seen.add(task.id);
            return true;
        });
}

/** The stored task a `kind` names, or null. */
export function findExtraTask(tasks, kind) {
    const wanted = String(kind || '').trim();
    return (tasks || []).find((task) => task.kind === wanted) || null;
}

/**
 * Publish a task for a post.
 *
 * Returns `{ ok, task, replaced }` or `{ error, code }`. Re-adding the same post rewrites that one
 * task rather than adding a second — the same reward behind two cards is the one shape this must
 * never produce.
 */
export async function addExtraTask({ url, kind = 'comment', reward, title, hint } = {}) {
    const post = parsePostUrl(url);
    if (!post) {
        return { error: 'That is not a link to a post — it has to be x.com/<handle>/status/<id>.', code: 'not-a-post' };
    }

    const ask = String(kind || '').trim().toLowerCase();
    if (!ASKS[ask]) {
        return { error: `Unknown kind "${kind}". Use ${TASK_KINDS.join(' or ')}.`, code: 'unknown-kind' };
    }

    const amount = reward === undefined || reward === null || reward === '' ? X_QUOTE_REWARD : Math.floor(Number(reward));
    if (!Number.isFinite(amount) || amount <= 0) {
        return { error: 'The reward has to be a whole number of points.', code: 'bad-reward' };
    }

    const list = await extraOneTimeTasks();
    const existing = list.find((task) => task.id === post.id);

    // A post that already has a shipped card is not a second task: see the note at the top of the
    // file. The id is the post's, so the two cannot be told apart by anything but their link. An
    // *update* of a stored task is still allowed — that is one card either way, and refusing it
    // would leave a stale duplicate nobody could correct except by removing it first.
    const shipped = ONE_TIME_POSTS.find((entry) => parsePostUrl(entry.post)?.id === post.id);
    if (shipped && !existing) {
        return {
            error: `That post already has a task (${shipped.id}). One post carries one task, because the `
                + 'same link cannot pay two of them — pick a different post.',
            code: 'already-shipped',
            taskId: shipped.id,
        };
    }
    const task = normaliseTask({
        id: post.id,
        // The title is the one thing that *must* be stored: it is taken from the post itself, so
        // nothing can derive it later. The ask's own copy — what the task wants, what its button
        // says — is deliberately **not** stored unless the caller overrides it, so wording fixed in
        // this file reaches every task already published rather than only the next one.
        title,
        reward: amount,
        url: post.url,
        hint,
        ask,
        addedAt: new Date().toISOString(),
    });
    // Whatever was not given is dropped rather than frozen at today's wording: `normaliseTask`
    // fills it from the ask on every read, which is what makes a copy fix reach every task.
    if (!hint) { delete task.hint; delete task.cta; }
    if (!title) delete task.title;

    const next = existing ? list.map((entry) => (entry.id === post.id ? task : entry)) : [...list, task];
    await documentWrite(TASKS_KEY, JSON.stringify(next, null, 2));

    // What comes back is the **view**, not the stored entry: the document deliberately omits
    // everything that can be derived, and a caller printing or asserting on this should see what a
    // card will actually show.
    return { ok: true, task: normaliseTask(task), replaced: Boolean(existing) };
}

/**
 * Take a task down, by id or by its link.
 *
 * Removal only stops the task being *offered*. Anything already paid for it stays paid: the record
 * lives on the wallet, not in this document, and nothing here can un-credit a player.
 */
export async function removeExtraTask(input) {
    const raw = String(input || '').trim();
    const post = parsePostUrl(raw);
    const id = post ? post.id : raw.replace(/^onetime:/, '').replace(/^one:/, '');

    const list = await extraOneTimeTasks();
    const next = list.filter((task) => task.id !== id);
    if (next.length === list.length) {
        return { error: `No stored task with id ${id}.`, code: 'not-found' };
    }

    if (next.length) await documentWrite(TASKS_KEY, JSON.stringify(next, null, 2));
    else await documentDelete(TASKS_KEY);

    return { ok: true, removed: id, remaining: next.length };
}
