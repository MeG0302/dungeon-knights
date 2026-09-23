/**
 * What a logged earning was for, in words a player reads.
 *
 * The points store records *why* it paid, in the shorthand the code needs: `vault_level_3`,
 * `streak_day_7`, `x_task_quote`, `one_time_follow`, `referral_commission`. That is a fine key and a
 * poor sentence, so the translation lives here — one function, no React, no store — rather than in
 * the Portfolio, for the reason every other rule in this project moved out of a component: a mapping
 * inside a page can only be checked by reading it.
 *
 * Two rules it holds to:
 *
 *   - **Never invent a description.** An unknown reason is humanised rather than guessed at, so a
 *     new way to earn shows up in the list the day it ships, phrased plainly, instead of vanishing
 *     or being labelled as something it is not.
 *   - **Never read a number out loud that is not a number.** A one-time task's id is sometimes a
 *     tweet's id, which has nothing to say to a reader; when there are no letters in it, the label
 *     stops at the kind of task and leaves the id out.
 */

/** `vault_level_2` → `Vault · floor 2`, and so on. Unknown reasons are humanised, not guessed. */
export function describeEarn(reason) {
    const raw = String(reason || '').trim();
    if (!raw) return 'Points';

    const floor = raw.match(/^vault_level_(\d+)$/);
    if (floor) return `Vault · floor ${floor[1]}`;

    if (raw === 'vault_share_bonus') return 'Daily share · run doubled';

    const streak = raw.match(/^streak_day_(\d+)$/);
    if (streak) return `Streak · day ${streak[1]}`;

    if (raw === 'referral_commission') return 'Referral commission';

    // Named rather than humanised: the generic path would read "One-time task · Waitlist", and this
    // is the line a player goes looking for after a task they cannot re-open. Naming the thing they
    // actually did is the whole job of this file.
    if (raw === 'one_time_waitlist') return 'Genesis waitlist';

    const xTask = raw.match(/^x_task_(.+)$/);
    if (xTask) return `X task${suffix(xTask[1])}`;

    const oneTime = raw.match(/^one_time_(.+)$/);
    if (oneTime) return `One-time task${suffix(oneTime[1])}`;

    return humanise(raw) || 'Points';
}

/** The ` · Quote repost` half, or nothing when the id has no letters in it to read. */
function suffix(id) {
    const name = humanise(id);
    return name ? ` · ${name}` : '';
}

/** `quote_repost` → `Quote Repost`; `2101382088767517039` → `` (a tweet id says nothing). */
function humanise(value) {
    const slug = String(value || '').replace(/[^A-Za-z0-9]+/g, ' ').trim();
    if (!slug || !/[A-Za-z]/.test(slug)) return '';
    return slug
        .split(' ')
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join(' ');
}
