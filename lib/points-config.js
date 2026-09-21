/**
 * The Points Program's rules, in one place.
 *
 * Kept free of any storage or browser import so the API routes, the page and the vault
 * mini-game can all read exactly these numbers without dragging a driver into the module
 * graph. Because every one of them imports this file, they cannot disagree about what a
 * floor pays.
 *
 * The one import is `lib/site.js`, which is a constant — so the module stays safe to pull into a
 * browser bundle, which the vault mini-game does.
 */

import { SITE_URL } from './site.js';

export const VAULT_LEVELS = [
    { name: 'Vault Entrance', points: 100 },
    { name: 'Treasury Hall', points: 300 },
    { name: 'Inner Sanctum', points: 500 },
];

export const VAULT_ENTRY_TOTAL = VAULT_LEVELS.reduce((sum, level) => sum + level.points, 0);

/** Referral programme: 15% of a first-degree referee's points, 5% of a second-degree's. */
export const REFERRAL_1ST_PCT = 0.15;
export const REFERRAL_2ND_PCT = 0.05;

/* ======================================================================= the ref code
 *
 * A wallet's invite link used to carry its own address, and links like that are already out in
 * posts people published, so an address is still a valid `?ref=` — see `refToken`, which fixes that
 * in place rather than breaking every link that has been shared. But an address is a miserable
 * thing to read off a screen, type on a phone or dictate to a friend, and a player who arrived by
 * playing (rather than through somebody's link) has nothing to hand out at all. So each wallet also
 * gets five characters of its own.
 *
 * The alphabet is 31 characters — the digits 2–9 and every letter that is not I, L or O — because a
 * code's whole job is to survive being read aloud and typed back correctly. That leaves no pair that
 * differs only by a stroke: `0`/`O`, `1`/`I`/`L` cannot be confused here because only one of each is
 * in the set. 31^5 is 28.6M, and uniqueness is **not** assumed from that number — the store keeps an
 * index and a collision is retried (see `assignRefCode`).
 */
export const REF_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const REF_CODE_LENGTH = 5;
const REF_CODE_RE = new RegExp(`^[${REF_CODE_ALPHABET}]{${REF_CODE_LENGTH}}$`);

/**
 * Whatever a person typed, as the canonical code — or null when it cannot be one.
 * Uppercased and stripped of the spaces and dashes people add when copying from a screenshot.
 */
export function normaliseRefCode(value) {
    if (typeof value !== 'string') return null;
    const cleaned = value.trim().toUpperCase().replace(/[\s-]/g, '');
    return REF_CODE_RE.test(cleaned) ? cleaned : null;
}

export function isRefCode(value) {
    return normaliseRefCode(value) !== null;
}

/**
 * The value a `?ref=` should carry for this token: an address as-is, a code uppercased. Null when
 * it is neither, which is what keeps a garbage `?ref=` from being stored and offered back.
 */
export function refToken(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    // `0[xX]`: a checksummed address is mixed case, and one pasted out of an all-caps document
    // writes the prefix in capitals too. The store only accepts the lowercase form, so a rejected
    // token here would be a link that silently credits nobody.
    if (/^0[xX][0-9a-fA-F]{40}$/.test(trimmed)) return trimmed.toLowerCase();
    return normaliseRefCode(trimmed);
}

/**
 * What a player pasted, reduced to something resolvable.
 *
 * The page puts the code and the invite link side by side, so somebody will paste the whole link —
 * and on a phone, the share sheet's copy is the link. Unwrapping it is friendlier than refusing it
 * and asking them to pick the last five characters out by hand.
 */
export function refTokenFromInput(input) {
    if (typeof input !== 'string') return null;
    const text = input.trim();
    if (!text) return null;

    const match = /[?&]ref=([^&?#\s]+)/i.exec(text);
    if (match) {
        let value = match[1];
        try {
            value = decodeURIComponent(value);
        } catch {
            // Not percent-encoded — use it as it came.
        }
        const fromLink = refToken(value);
        if (fromLink) return fromLink;
    }
    return refToken(text);
}

/** Points are whole numbers; every commission is floored, never rounded up. */
export function commission(points, pct) {
    return Math.floor(points * pct);
}

/** The UTC day key. Every daily rule (floors, share, resets) keys off this one function. */
export function todayKey(now = new Date()) {
    return now.toISOString().slice(0, 10);
}

/* ===================================================================== earning on X
 *
 * Two of the ways to earn are things done on X, and both are proved the same way: the player
 * hands over the link to the post they made, and `lib/x-verify.js` asks X about it. What makes a
 * post pay is **who wrote it** (the X account bound to this wallet) and **what it says** — the
 * campaign's repost has to carry our site link, a share has to tag the account below — and nothing
 * else. See that module's header for what X will and will not tell us.
 *
 * `X_CAMPAIGN_POST` is **server-side only**. The page never reads it: it renders the campaign
 * from `state.campaign`, which the API builds here. A client that read this constant would get
 * `undefined` (Next only inlines `NEXT_PUBLIC_*` into the bundle) and would quietly render a task
 * with no post to quote — the kind of bug this comment exists to prevent.
 */

/** What the engagement task pays, once per wallet per campaign post. */
export const X_ENGAGEMENT_REWARD = Number(process.env.X_ENGAGEMENT_REWARD || 500);

/** The campaign post players quote-retweet. Empty means the task is not configured at all. */
export const X_CAMPAIGN_POST = (process.env.X_CAMPAIGN_POST || '').trim();

/** An optional campaign tag, accepted *instead of* the site link when we set one. */
export const X_CAMPAIGN_KEYWORD = (process.env.X_CAMPAIGN_KEYWORD || '').trim();

/** How many times a pending submission is re-checked before it is left expired, not credited. */
export const X_VERIFY_MAX_ATTEMPTS = 20;

/** And how long between those checks, so a player cannot turn the button into an X-shaped load test. */
export const X_VERIFY_MIN_GAP_SECONDS = 60;

/**
 * The host a post has to mention. Derived from the site's own URL rather than typed again, so a
 * custom domain moves the rule with it instead of silently invalidating every honest post.
 */
export const SITE_LINK_HOST = (() => {
    try {
        return new URL(SITE_URL).host.toLowerCase();
    } catch {
        return 'dungeon-knights.vercel.app';
    }
})();

/** The campaign post's status id, out of whatever URL was configured, or null. */
export function campaignPostId() {
    const match = /\/status(?:es)?\/(\d{5,25})/.exec(X_CAMPAIGN_POST);
    return match ? match[1] : null;
}

/**
 * Task ids. The campaign's carries the post's id, so publishing a second post later creates a
 * second payable task instead of a second claim on the first one. The share's is a **stable** id
 * and the UTC day lives inside its record: a per-day id would make yesterday's pending submission
 * invisible today — it would read as "never submitted" instead of expiring with a sentence about
 * the day that ended.
 */
export function campaignTaskId() {
    const id = campaignPostId();
    return id ? `x:${id}` : null;
}

export function shareTaskId() {
    return 'share';
}

/* ----------------------------------------------------------------- the daily share
 *
 * A share is a **different bargain** from the campaign task, and it is verified differently: X is
 * asked two things about a shared post — who wrote it, and whether it tags the account below. The
 * invite link rides along because recruiting is half of what the Points Program is for, but it is
 * not what decides the payout, so it is not what the verifier checks.
 *
 * The text is written **here, on the server**, and reaches the page through `state.share` rather
 * than being typed into the client. A post has to say what the campaign says it says, and one
 * function writing it is the only way to be sure of that.
 */

/** The account a shared post must tag. The `@` is optional in the env var; the check adds it. */
export const X_SHARE_TAG = (process.env.X_SHARE_TAG || 'DNGrobinhood').trim().replace(/^@/, '');

/**
 * The picture that goes out with a share, served from our own domain.
 *
 * X's composer link cannot attach a file — posting an image on someone's behalf needs the paid API
 * — so the photo reaches the post the way any link does: X unfurls the invite link into a card,
 * and `/points` declares this image as that card (see `app/points/page.js`). What that buys is the
 * thing a download link cannot: the picture is *in* the post, for every player, on every platform,
 * with nothing to attach.
 */
export const SHARE_OG_IMAGE = '/assets/points/points-og.jpg';

/** The same picture at its own aspect, for the player who would rather attach it by hand. */
export const SHARE_CARD_IMAGE = '/assets/points/share-card.jpg';

/** X renders a link card at 1.91:1, so the crop is made here rather than left to X's own. */
export const SHARE_OG_SIZE = { width: 1200, height: 630 };

/**
 * What a shared post says.
 *
 * The points are the **doubled** total the player is claiming, which is why the caller passes
 * `entryTotalToday × 2`: the post is written before the bonus is paid, and it says what the run is
 * worth once it lands. Everything above is fixed; the invite link is the player's own.
 */
export function sharePostText({ points = VAULT_ENTRY_TOTAL * 2, refUrl = '', tag = X_SHARE_TAG } = {}) {
    const invite = refUrl ? ` ${refUrl}` : '';
    return `I just cleared all three Points Vault dungeons today and racked up ${points} points @${tag}${invite}`;
}

/** The composer, prefilled. It takes text and nothing else — see `SHARE_OG_IMAGE`. */
export function shareIntentUrl(text) {
    return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

/**
 * A wallet's invite link, built on the server so the posted text cannot disagree with the program
 * about where a referral has to land to be counted.
 *
 * Takes a code or an address — whichever the caller has — and both land on the same route, because
 * `?ref=` is resolved either way on arrival.
 */
export function referralUrl(token) {
    const ref = refToken(token);
    return ref ? `${SITE_URL}/points?ref=${ref}` : `${SITE_URL}/points`;
}

/* ============================================================== the one-time tasks
 *
 * Steps a player takes once and never again, which is why they get a tab of their own rather than
 * a row among the daily things: the bargain is different — one claim, ever, per X account.
 *
 * The first one is a **follow**, and it is worth being blunt about what that means, because the
 * rest of this program is scrupulous about proof and this one cannot be proved at all. X's
 * oEmbed — the only free way to ask X anything, and the whole of `lib/x-verify.js` — has no view
 * of who a player follows; likes, reposts and follows all need the paid API or a zkTLS proof.
 * So this task is **taken on the player's word**, and the page says so in those words instead of
 * implying a check that never happens.
 *
 * What is *not* on their word is who is claiming it:
 *   - a bound X account is required, exactly as it is for every other award (`x-required`);
 *   - a binding is permanent and one account belongs to one wallet for good, so the same account
 *     cannot be carried to a second wallet to claim the same task again — the account index
 *     refuses that move before points are ever involved;
 *   - the claim is recorded on the wallet and taken under an atomic guard, so a second tap, a
 *     reload or a hand-rolled request cannot pay it twice.
 *
 * **Two copies of the sentence, because there are two truths.** `blurb` is what a deployment that
 * cannot check says, and `blurbChecked` is what one that can says; the server picks between them
 * from `lib/x-webhook.js`'s `followProofMode()` and never the client — a page cannot be allowed to
 * claim a check exists, or that it does not. Whichever is chosen, the reward, the task and the gate
 * are identical, so switching the mode is a configuration change and not a rewrite.
 *
 * `{handle}` is filled in by the **server** (see `oneTimeView` in `lib/points-program.js`), never
 * here: `X_SHARE_TAG` is not `NEXT_PUBLIC_`, so a client that read this literal would render
 * "follow @undefined" — the failure this file's header warns about.
 */
/* ------------------------------------------------------- the quote-repost tasks
 *
 * One task per campaign post: quote it, tag us, paste the link to your post, and it is paid once per
 * wallet — the same engine the campaign reward uses (`submitTask` → X's own record of the post).
 *
 * **What these can and cannot prove is worth stating plainly**, because four tasks that ask the same
 * thing are four chances to pay for one post. X's free embed carries only the *quoting* post's own
 * text — the post it quotes is not in it — so neither the verifier nor anything else free can tell
 * which post was quoted. What the check *can* do is confirm the post is the player's and that it
 * tags our account, and that is what it does. Quoting the post named on the card is therefore on the
 * player, and the card says so rather than implying a check it cannot run.
 *
 * The four are still separate rewards rather than one, because they are four separate posts to quote
 * — and `submitTask` refuses to pay a second one-time task for a post that has already paid one, so
 * the worst case is a player who writes four junk posts instead of four quote-posts, not a player who
 * writes one and collects all four.
 */

/** What each quote-repost pays, once per wallet, ever. */
export const X_QUOTE_REWARD = Number(process.env.X_QUOTE_REWARD || 500);

/** The sentence every quote task carries about what is actually checked. Filled by the server. */
export const QUOTE_CHECK_NOTE = 'X is asked two things about the post you paste: that the account bound to your wallet wrote it, and that it tags @{handle}. X\u2019s free embed cannot see which post you quoted, so quoting the one above is on you.';

/**
 * The campaign posts, one task each.
 *
 * The `hint` is different per post on purpose: four cards reading the same sentence read like one
 * task repeated, and the player has no way to tell which post a card is about without opening it.
 */
export const ONE_TIME_POSTS = [
    {
        id: 'quote-points',
        post: 'https://x.com/DNGrobinhood/status/2101382088767517039',
        title: 'Quote-post the Points Program teaser',
        cta: 'Open the teaser',
        hint: 'Quote the teaser that introduces Arya and Points \u2014 add your own words to it \u2014 and tag @{handle}.',
    },
    {
        id: 'quote-map',
        post: 'https://x.com/DNGrobinhood/status/2100974935208570893',
        title: 'Quote-post the Map Reveal',
        cta: 'Open the map reveal',
        hint: 'Quote the Map Reveal, say which dungeon you are heading for, and tag @{handle}.',
    },
    {
        id: 'quote-lava',
        post: 'https://x.com/DNGrobinhood/status/2098123786558259251',
        title: 'Quote-post the lava teaser',
        cta: 'Open the lava teaser',
        hint: 'Quote the teaser with the knight, the monster and the lava, and tag @{handle}.',
    },
    {
        id: 'quote-launch',
        post: 'https://x.com/DNGrobinhood/status/2097632632515567678',
        title: 'Quote-post the launch announcement',
        cta: 'Open the announcement',
        hint: 'Quote the launch announcement \u2014 the one about $DNG and Robinhood Chain \u2014 and tag @{handle}.',
    },
];

export const ONE_TIME_TASKS = [
    {
        id: 'follow',
        title: 'Follow us on X',
        reward: 500,
        // No verifier runs on this one, and the copy says so — but it is not paid on the spot either:
        // the claim goes into a review window (see `review`), which is a real queue with a real tool
        // behind it (`tools/points-pending.js`) rather than a decoration on an instant payout.
        proof: 'claim',
        cta: 'Follow @{handle}',
        url: 'https://x.com/{handle}',
        // The wait before a claim is credited. Randomised per claim so the queue does not read as a
        // fixed timer, and stored on the claim itself — the window is decided once, when it is
        // claimed, not recomputed on every read (which would move the goalposts every refresh).
        review: { minMinutes: 30, maxMinutes: 45 },
        blurb: 'Follow @{handle} on X, then claim. Follows are verified manually, so points are granted after review — usually within 30\u201345 minutes — and the task pays once per X account, ever.',
        blurbChecked: 'Follow @{handle} on X, then claim. X tells us when someone follows us, so this one is checked against X\u2019s own record rather than your word — and it pays once per X account, ever.',
    },
    ...ONE_TIME_POSTS.map((entry) => ({
        id: entry.id,
        // What the page sends back to `submitTask`, and what `taskConfig` recognises. One string, so
        // a card cannot file its link against a different task than the one it is showing.
        kind: `onetime:${entry.id}`,
        title: entry.title,
        reward: X_QUOTE_REWARD,
        // A task that **is** checked. `claim` is taken on the player's word (the follow); `verify` is
        // paid by `submitTask` once X has answered about a pasted post, and the claim path refuses it
        // — otherwise the other endpoint would pay a checked task on the tap, bypassing the check.
        proof: 'verify',
        cta: entry.cta,
        // Our post: what the card's button opens, and what the player is asked to quote. Their own
        // post arrives later, as the link they paste.
        url: entry.post,
        hint: `${entry.hint} ${QUOTE_CHECK_NOTE}`,
    })),
];

/** One task by id, or null. The route never trusts anything but an id from this list. */
export function oneTimeTask(id) {
    const wanted = String(id || '').trim();
    return ONE_TIME_TASKS.find((task) => task.id === wanted) || null;
}

/**
 * One task by the `kind` the page sends to `submitTask` — `onetime:quote-points` and friends.
 *
 * A separate lookup from `oneTimeTask` because the two answer different questions: the claim path
 * asks "which task is this id", and the verified path asks "which task is this kind". A task that is
 * not `verify` has no `kind` at all, so this can never resolve the follow — the one task that is
 * paid without a post.
 */
export function oneTimeTaskByKind(kind) {
    const wanted = String(kind || '').trim();
    return ONE_TIME_TASKS.find((task) => task.kind === wanted) || null;
}
