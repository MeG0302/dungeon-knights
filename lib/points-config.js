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

/* ================================================================== the streak bonus
 *
 * Clearing all three floors pays the same 900 whatever yesterday looked like, which rewards one
 * good day and says nothing about coming back. The streak is the other half of that bargain: a
 * bonus **on top of the run** that grows while a player keeps showing up — 150 points times the
 * day they are on, 1× on the first consecutive day, 15× on the fifteenth, and 15× for every day
 * after that. A missed day starts again at 1×, because a run that survives a gap is not a run.
 *
 * The numbers live here, beside the floors, so the page, the API and the harness that asserts the
 * ladder cannot disagree about what day seven pays. `streakFor` is pure — a wallet record, a day,
 * an answer — which is what lets the whole fifteen-day climb be tested without a clock.
 */
export const STREAK_BASE = 150;
export const STREAK_MAX_MULTIPLIER = 15;

/** The UTC day before a day key. */
export function previousDayKey(day) {
    const date = new Date(`${day}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
}

/**
 * The streak as of `day`.
 *
 * `days` is which day of the run today is: 1 for a first clear, and it keeps counting past fifteen
 * so the page can say "day 22" while the multiplier stays capped. `paid` is whether today's bonus
 * has already been credited — the record's own `lastDay` is what makes that true, so re-clearing a
 * floor, or reloading the page, can never pay it a second time.
 */
export function streakFor(doc, day = todayKey()) {
    const last = doc?.streak?.lastDay || null;
    const run = Math.max(0, Number(doc?.streak?.days) || 0);
    const paid = last === day;
    // Continuing from yesterday, or starting again: anything else — a gap, or a wallet that has
    // never cleared a floor — is day one.
    const days = paid ? Math.max(run, 1) : (last === previousDayKey(day) ? run + 1 : 1);
    const multiplier = Math.min(days, STREAK_MAX_MULTIPLIER);
    return {
        days,
        multiplier,
        base: STREAK_BASE,
        max: STREAK_MAX_MULTIPLIER,
        award: STREAK_BASE * multiplier,
        paid,
        lastDay: last,
        capped: multiplier >= STREAK_MAX_MULTIPLIER,
    };
}

/** Referral programme: 15% of a first-degree referee's points, 5% of a second-degree's. */
export const REFERRAL_1ST_PCT = 0.15;
export const REFERRAL_2ND_PCT = 0.05;

/**
 * What an invited wallet has to be before its inviter is paid anything.
 *
 * An empty wallet costs nothing to make, so without a floor an invite list is a way to conjure
 * points out of nothing: wallets that never played could still be handed out as referrals. Two
 * things make an invite real, and they cover different cheats. **A bound X account** is the one
 * identity that is not free — the binding is one per handle, so the same person cannot arrive twice
 * under one name — and **ten points earned** is proof the wallet actually played, since every way to
 * earn runs through X or through the vault.
 *
 * The floor is small on purpose: the follow task alone clears it, so the rule costs a genuine player
 * one action and costs a farming wallet a real identity. Nothing is back-paid — commission begins
 * with the credit that qualifies them, which is what keeps every payment traceable to one event.
 */
export const REFERRAL_MIN_POINTS = (() => {
    const configured = Number(process.env.REFERRAL_MIN_POINTS);
    return Number.isFinite(configured) && configured > 0 ? configured : 10;
})();

/**
 * Does an invited wallet count yet? The whole rule in one function.
 *
 * `points` is what the wallet holds, and nothing in this program spends, so the balance is the
 * lifetime total. Used by the payout *and* by what the page says about each referral, so the list a
 * player reads and the money that moves cannot disagree.
 */
export function referralQualifies(doc) {
    if (!doc?.x?.username) return false;
    return (Number(doc?.points) || 0) >= REFERRAL_MIN_POINTS;
}

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

/**
 * The day the program opened, in UTC. Day 1 is this date, and a shared post counts from it.
 *
 * It is an env var because it is a fact about the world rather than about the code, and the one
 * thing it must never be is *wrong on the day it matters*: the marker in a shared post is what
 * tells a post made today from the same player's post yesterday, so every player has to be
 * counting the same days. The default is the day the program opened to players — **Day 1 is
 * 2026-09-23 in UTC**, and the marker rolls over at 00:00 UTC, not at anybody's local midnight.
 * A player mid-post at 23:50 UTC is posting today's marker and is checked against today's.
 */
export const PROGRAM_DAY_ONE = (process.env.X_PROGRAM_DAY_ONE || '2026-09-23').trim();

/** `YYYY-MM-DD` as a UTC midnight, or null. The one place a day key becomes a number. */
function dayKeyMs(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
    if (!match) return null;
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * Which day of the program a UTC day is, 1-based.
 *
 * Never 0 or negative: a deployment whose clock, or whose `X_PROGRAM_DAY_ONE`, is set after the
 * day being asked about gives Day 1 rather than a day that would read as a negative number to a
 * player. Nothing else depends on it being clever — the share and the check both call this, which
 * is the point.
 */
export function programDay(day = todayKey()) {
    const started = dayKeyMs(PROGRAM_DAY_ONE);
    const now = dayKeyMs(day);
    if (started === null || now === null) return 1;
    const days = Math.floor((now - started) / 86400000) + 1;
    return days < 1 ? 1 : days;
}

/** The marker a shared post carries, e.g. `Day 3`. One function, so text and check cannot drift. */
export function dayMarker(day = todayKey()) {
    return `Day ${programDay(day)}`;
}

/**
 * A day key as a person would say it: `today`, `yesterday`, `3 days ago`.
 *
 * A capsule ledger is a list about *days*, and the date is the one thing about a day that nobody
 * reads at a glance: "2026-09-24" says nothing about whether the claim window is still open, and
 * that is the only question a winner has. So the words come first.
 *
 * Two weeks is where the words stop. "23 days ago" is a sentence the reader has to convert back
 * into a date to do anything with, so past a fortnight the date is returned instead — which is also
 * the point at which a win is unclaimable and the exact day is what somebody would look up.
 */
export function relativeDayLabel(day, now = new Date()) {
    const key = isDayKey(day);
    if (!key) return '';
    const target = dayKeyMs(key);
    const today = dayKeyMs(todayKey(now));
    if (target === null || today === null) return key;
    const days = Math.round((today - target) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 14) return `${days} days ago`;
    return key;
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
 * The server invite.
 *
 * One constant for two cards: the door beside the X binding, and the one-time task that pays for
 * joining. They have to point at the same place, and a second copy of an invite URL is a second place
 * to forget when the invite is reissued.
 */
export const DISCORD_INVITE = 'https://discord.gg/zZFqA9Fqe';

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
 *
 * It is also the only picture on the share card now: the kit previews this file rather than a
 * second crop of it, so what a player is shown and what X unfurls cannot drift apart.
 */
export const SHARE_OG_IMAGE = '/assets/points/points-og.jpg';

/** X renders a link card at 1.91:1, so the crop is made here rather than left to X's own. */
export const SHARE_OG_SIZE = { width: 1200, height: 630 };

/**
 * What a shared post says.
 *
 * The points are the **doubled** total the player is claiming, which is why the caller passes
 * `entryTotalToday × 2`: the post is written before the bonus is paid, and it says what the run is
 * worth once it lands. Everything above is fixed; the invite link is the player's own.
 */
export function sharePostText({ points = VAULT_ENTRY_TOTAL * 2, refUrl = '', tag = X_SHARE_TAG, day = null } = {}) {
    const invite = refUrl ? ` ${refUrl}` : '';
    // `day` is the UTC day the post is made on; the marker it produces is the same string the
    // verifier looks for, which is what stops a post from an earlier day being filed again.
    const marker = day ? `${dayMarker(day)}: ` : '';
    return `${marker}I just cleared all three Points Vault dungeons today and racked up ${points} points @${tag}${invite}`;
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
 * **A third kind of task is neither.** The two that ask for a step off our own pages — the waitlist
 * and the Discord (`proof: 'visit'`) — pay on the claim with nothing behind them at all: no verifier,
 * no review window. Their own proof value is what keeps them from inheriting the follow's mode, or
 * they would start demanding a follow event the day this deployment is wired to X's webhook.
 *
 * **Where a task cannot be checked, the card makes no claim either way.** It asks for the step and
 * says what it pays; it does not promise a check it cannot run, and it does not advertise the absence
 * of one. The sentence a player reads is an invitation, and the receipt on the card — the line that
 * says what happened — is where `credited on claim` appears and a review window does not.
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
 * **Four tasks that ask the same thing are four chances to pay for one post**, so the guard is what
 * keeps them honest: `submitTask` asks X about the pasted post — who wrote it, and whether it tags us
 * — and refuses to pay a second one-time task for a post that has already paid one. The worst case is
 * a player who writes four junk posts instead of four quote-posts, not a player who writes one and
 * collects all four.
 *
 * **The card copy is an ask, not a description of our plumbing.** A player reading a task should read
 * what to do and that it pays once; the sentence that used to sit under every card explaining what a
 * check can and cannot see was longer than the task and read as a caveat rather than an invitation.
 */

/** What each quote-repost pays, once per wallet, ever. */
export const X_QUOTE_REWARD = Number(process.env.X_QUOTE_REWARD || 500);

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
        hint: 'Quote the teaser with your own words and tag @{handle}.',
    },
    {
        id: 'quote-map',
        post: 'https://x.com/DNGrobinhood/status/2100974935208570893',
        title: 'Quote-post the Map Reveal',
        cta: 'Open the map reveal',
        hint: 'Quote the Map Reveal, name your dungeon, and tag @{handle}.',
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
        hint: 'Quote the launch announcement about $DNG and Robinhood Chain, and tag @{handle}.',
    },
];

export const ONE_TIME_TASKS = [
    {
        id: 'follow',
        title: 'Follow us on X',
        reward: 500,
        // No automated check stands behind this one, so it is not paid on the spot either: the claim
        // goes into a review window (see `review`), which is a real queue with a real tool behind it
        // (`tools/points-pending.js`) rather than a decoration on an instant payout. What the card
        // says about that is `blurb`/`blurbChecked` below — short, and chosen by the server from the
        // mode the deployment actually runs.
        proof: 'claim',
        cta: 'Follow @{handle}',
        url: 'https://x.com/{handle}',
        // The wait before a claim is credited. Randomised per claim so the queue does not read as a
        // fixed timer, and stored on the claim itself — the window is decided once, when it is
        // claimed, not recomputed on every read (which would move the goalposts every refresh).
        review: { minMinutes: 30, maxMinutes: 45 },
        blurb: 'Follow @{handle} on X, then claim. Points land after a short review, usually within 30\u201345 minutes. Pays once per account.',
        blurbChecked: 'Follow @{handle} on X, then claim. X tells us when someone follows us \u2014 the follow itself is the check. Pays once per account.',
    },
    {
        /* The one task that is neither checked nor reviewed: joining the Genesis waitlist.
         *
         * There is nothing for a verifier to ask. The waitlist is a form on our own page, and it is
         * the player's own address that goes in it — so a check would mean refusing somebody who
         * signed up with an exchange address, and the honest thing is to say the task pays on the
         * claim rather than dress it in a review window it does not have.
         *
         * What still holds it down is identity: `claimOneTime` needs a bound X account, and a binding
         * is permanent and one-per-handle, so the cheapest way to farm this is still a real X account.
         *
         * `proof: 'visit'` is its **own kind on purpose**. Reusing `claim` would hand it the follow's
         * mode, and the day this deployment is wired to X's follow webhook that task would start
         * demanding a follow event for something that has nothing to do with following. A task's proof
         * is what is true about it, and what is true here is that nothing is checked.
         */
        id: 'waitlist',
        title: 'Join the Genesis waitlist',
        reward: 500,
        proof: 'visit',
        cta: 'Open the waitlist',
        // The page it sends them to, built from the site's own URL so a domain change moves the card
        // with it instead of pointing players at a host we no longer answer on.
        url: `${SITE_URL}/genesis`,
        // An ask, not a caveat: what to do, and nothing about how it is judged. The card carries the
        // reward and the button; the receipt at the foot says what happened once it has.
        blurb: 'Open the Genesis waitlist and add your email and wallet, then claim.',
    },
    {
        /* The other step off our own pages, and the same bargain: join the server, claim, once.
         *
         * The invite is the card's button, so the task and the Discord door beside the X binding open
         * the same URL — see `DISCORD_INVITE`. There is nothing to check here either: Discord tells us
         * nothing about who has joined, and the card asks for the step rather than claiming a check.
         */
        id: 'discord',
        title: 'Join the Discord',
        reward: 500,
        proof: 'visit',
        cta: 'Open the invite',
        url: DISCORD_INVITE,
        blurb: 'Join the server \u2014 announcements, task drops and support live there.',
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
        hint: entry.hint,
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

/* ============================================================ the daily capsule draw
 *
 * Ten capsules a day, to the top ten of **that day's** board.
 *
 * The bargain is the same one the vault already makes — earn today, and what you earned today is
 * what counts — with a prize that is not points. Three things about it are worth writing down here
 * rather than in the code that computes it:
 *
 *   - **The board is the day's, not the season's.** A season-long board would hand the same ten
 *     capsules to the same ten wallets every night, which is a giveaway nobody else has a reason to
 *     enter. Ranking the *day* means a wallet that finishes a full run is genuinely in the running
 *     on its first evening.
 *   - **Only points earned by playing count.** Commission from a referral is points the program owes
 *     an inviter, not something that wallet did today, and letting it into the board would let a
 *     well-connected wallet hold a top-ten place without playing. `countsTowardDaily` is that rule,
 *     named once, and the daily tally and the draw both read it.
 *   - **Ranks are decided by `at`, not by luck.** The daily earning is close to capped — three
 *     floors, the streak, the share — so ties are normal, and a tie is broken by who got there
 *     first. That is a rule a player can plan around, and it needs no random seed to be trusted.
 */

/** How many capsules a day, and therefore how many wallets a day are paid. */
export const DRAW_SIZE = 10;

/**
 * What one win is worth. One object rather than three strings so a page, a tool and a ledger entry
 * cannot disagree about which rung of the ladder was handed out — and so changing the prize is this
 * line. `id` is the on-chain capsule id in `lib/staking-config.js#CAPSULE_TYPES`.
 */
export const DRAW_CAPSULE = Object.freeze({
    id: 1,
    key: 'common',
    name: 'Common Capsule',
    rarity: 'Common',
});

/**
 * The capsule in the round: the frames of one full turn, and where they are served from.
 *
 * The prize is a thing you look at, and the only honest picture of it is the object itself — so the
 * eight-second 3D turn the art came with is cut into `frames` stills, evenly spaced around the
 * rotation, and the portfolio spins them under the player's thumb. Stills rather than the video,
 * because a drag has to answer on the first frame it is asked for: a `<video>` can only be seeked,
 * and seeking a 72 MB ProRes file is not a thing a page does.
 *
 * The count lives here because three things have to agree about it — the exporter that writes the
 * files, the page that asks for them, and the harness that checks every one of them exists. `dir`
 * is public, no build step touches it, so a frame that was never exported is a 404 on a page about
 * a prize.
 */
export const CAPSULE_SPIN = Object.freeze({
    dir: '/assets/points/capsule-spin',
    frames: 36,
    ext: 'webp',
});

/**
 * One frame of `CAPSULE_SPIN`, 1-based and zero-padded, the way the exporter names them.
 *
 * Wraps in both directions, and that is the whole point of it being a function: a drag is a
 * subtraction, so the frame it lands on is routinely 0 or less (dragging right from the first
 * frame) and just as routinely past the last one. `0` is the frame before the first — it is a wheel,
 * not a list — so it comes back as the last frame rather than being clamped into the one the reader
 * is already looking at. Only a value that is not a number at all falls back to the first frame.
 */
export function capsuleSpinFrame(index, spin = CAPSULE_SPIN) {
    const total = Math.max(1, Math.floor(Number(spin?.frames) || 1));
    const raw = Number(index);
    const wanted = Number.isFinite(raw) ? Math.floor(raw) : 1;
    const frame = ((wanted - 1) % total + total) % total + 1;
    return `${spin.dir}/capsule-${String(frame).padStart(2, '0')}.${spin.ext}`;
}

/**
 * What the capsule weighs: how a flick carries on after the hand lets go.
 *
 * The turn is dragged by the pointer, and a wheel that stops dead on release is a picture that has
 * been *placed* rather than one that has been *spun*. So a release hands its momentum to a decaying
 * animation at the speed the hand was moving, and **everything that decides how that feels lives
 * here** rather than in the page: the page then reads one object instead of four loose numbers, and
 * the coast becomes something a harness can *walk* — `capsuleFling` below turns a release speed into
 * a duration and a distance, so `tools/check-portfolio.js` asserts how long a flick lasts instead of
 * pattern-matching constants that might add up to nothing.
 *
 * Speeds are frames per millisecond, and the page maps 10 px to a frame, so a hand crossing at
 * 500 px/s releases at 0.05.
 *
 *   - `min` — below this the release was a careful placement and is left where it was put. A quarter
 *     of a turn a second is not a throw; a hand moving at 60 px/s is.
 *   - `max` — a throw is **capped**, and the cap is load bearing. One pointer event can cross the
 *     width of a phone in a single frame, and the smoothed velocity on a fast swipe comes out in
 *     the frames-per-millisecond tens: uncapped that is a hundred turns of spinning after one
 *     flick. Capped, the hardest flick allowed travels the same distance as any other hard one.
 *   - `friction` and `stop` — the decay per millisecond, and the speed under which the wheel is
 *     standing still. Slower friction and the capsule creeps for eight seconds after every tap;
 *     faster and the flick is over before the hand has left the screen.
 *
 * Chosen by measuring, not by taste: a normal flick (500 px/s) coasts **5.8 s over 2.3 turns**, the
 * hardest flick allowed (1200 px/s) **7.3 s over 5.6 turns**, and a light toss at the threshold a
 * quarter turn over 2.3 s. The length is deliberate — the throw this replaced settled in about two
 * seconds and read as a nudge rather than a wheel.
 */
export const CAPSULE_FLING = Object.freeze({
    min: 0.006,
    max: 0.12,
    friction: 0.9994,
    stop: 0.0015,
});

/**
 * What a release at `speed` becomes: the coast, in frames and milliseconds.
 *
 * The whole throw as arithmetic, with no browser in it, which is the point — this is the function
 * the harness walks and the page obeys. `speed` is clamped to `max` and zeroed under `min`, so "a
 * careful placement is not thrown" and "no flick spins for ever" are properties of the curve rather
 * than checks at the call site. The decay is geometric, so the distance is `speed / λ` and the time
 * to fall under `stop` is `ln(speed / stop) / λ`, where `λ = -ln(friction)`.
 *
 * Answers `frames` (total travel), `durationMs`, and `turns` (travel over one rotation), so a caller
 * can ask how *far* as well as how long. Nothing finite in, nothing NaN out: a speed that is not a
 * number is a release that did not happen.
 */
export function capsuleFling(speed, fling = CAPSULE_FLING, spin = CAPSULE_SPIN) {
    const asked = Number(speed);
    const wanted = Number.isFinite(asked) ? asked : 0;
    const capped = Math.max(-fling.max, Math.min(fling.max, wanted));
    const thrown = Math.abs(capped) >= fling.min ? capped : 0;
    const decay = -Math.log(fling.friction);
    const perTurn = Math.max(1, Math.floor(Number(spin?.frames) || 1));
    if (!thrown || !(decay > 0)) return { speed: 0, frames: 0, durationMs: 0, turns: 0 };
    const travel = Math.abs(thrown) / decay;
    const durationMs = Math.max(0, Math.log(Math.abs(thrown) / fling.stop) / decay);
    return { speed: thrown, frames: travel, durationMs, turns: travel / perTurn };
}

/**
 * How long a win may be claimed for, in days, counting the day it was won.
 *
 * One, on purpose: the owner's rule is that a winner submits their wallet **that day**, and a window
 * that quietly carried over would mean the site and the announcement disagreed about whether the
 * wallet had to be handed over daily. The ledger keeps a missed win visible (and the fulfilment tool
 * lists it) so nothing is silently taken away — the window closes on the *claim*, not on the win.
 */
export const CAPSULE_CLAIM_WINDOW_DAYS = (() => {
    const configured = Math.floor(Number(process.env.CAPSULE_CLAIM_WINDOW_DAYS));
    return Number.isFinite(configured) && configured > 0 ? configured : 1;
})();

/**
 * Where a capsule win is handed over: the form the team reads and sends from.
 *
 * **The server fills it in.** A claim posts the winner's address and the day it won straight into
 * this form (see `lib/capsule-form.js`), so the player's part is the signature and nothing else —
 * no copy, no paste, no "I submitted it". The link is still published on the card as the way
 * through when that post does not land, which is why it stays a value the page can render.
 *
 * It is an env var because the form is the owner's and editing it is not a deploy: a new link is one
 * Vercel value, and the code reads the *page* rather than a set of question ids, so a form that gains
 * a "wallet" and a "date" question needs nothing here at all.
 */
export const CAPSULE_FORM_URL = (process.env.CAPSULE_FORM_URL
    || 'https://forms.gle/sJk6MEta7BpEsTeY9').trim();

/**
 * Does this form link ask a player to sign in before they can hand their wallet over?
 *
 * A Docs **editor** link — `docs.google.com/forms/d/<id>/edit` — is the form as its owner sees it:
 * anybody else who clicks it meets a Google sign-in and never reaches a question. The link this
 * used to point at was exactly that, which is why the card had a paragraph warning about it and a
 * Discord invite beside it as the way round. A published link (the `forms.gle` short one, or
 * `…/viewform`) opens for everybody.
 *
 * Derived from the link rather than written down beside it, because the two go out of step the
 * moment somebody swaps one: the page should be able to *read* whether the form it is holding is
 * open, and say so, instead of promising a sign-in that no longer happens or hiding one that does.
 * An unreadable link counts as restricted — "check on Discord" is the safe thing to say about a
 * URL we cannot parse.
 */
export function capsuleFormNeedsSignIn(url = CAPSULE_FORM_URL) {
    const link = String(url || '').trim();
    if (!link) return true;
    let parsed;
    try {
        parsed = new URL(link);
    } catch {
        return true;
    }
    const host = parsed.hostname.toLowerCase();
    if (host !== 'forms.gle' && !/(^|\.)google\.com$/.test(host)) return true;
    // The editor, in both its spellings: `/edit` and the bare `/forms/d/<id>`.
    return /\/edit\b/.test(parsed.pathname) || /\/forms\/d\/[^/]+\/?$/.test(parsed.pathname);
}

/**
 * The first day a capsule may be drawn for, or null to work it out from the store.
 *
 * Null is the useful default and the honest one: the daily tally does not exist before the day this
 * code is deployed, so the earliest day the store actually holds a board for **is** the giveaway's
 * first day. Setting the env var pins it instead — for holding the giveaway back, or for starting it
 * on an announced date rather than the day of a deploy.
 */
export const GIVEAWAY_DAY_ONE = (process.env.GIVEAWAY_DAY_ONE || '').trim() || null;

/* =================================================================== redeeming points
 *
 * The wheel at `/redeem`: three reels of knight PFPs, paid for with points, paying out gift
 * cards. Four facts live here — what a spin costs, what the reels can land on, how often a
 * spin wins, and what the codes are for — and nothing else in the project is allowed to know
 * them: the page prints the odds from this table, and `tools/check-redeem.js` reads it back.
 *
 * **The odds are one weighted row.** `REDEEM_WEIGHTS` is the whole probability model: a draw
 * picks an outcome in proportion to its weight, so "1 in 3 spins wins a card" is
 * `(amazon + google) / total` — 2/6 — and changing the odds later is editing these integers
 * rather than hunting for a `0.333` in a page. The weights cannot go stale silently: the
 * harness recomputes the rate from this table and then measures a hundred thousand real
 * draws against it.
 *
 * Points are *spent* here, which is why the cost is a constant rather than a number in the
 * button: `spendPoints` reads this, the page prints it, and a spin that cannot be afforded is
 * refused on the server by comparing the two.
 */
export const REDEEM_SPIN_COST = 1000;

/**
 * Is the wheel published?
 *
 * The wheel is built, harnessed and finished — and **held back**, which is a decision rather than an
 * unfinished state. It is the one place points are spent and the one place a real gift card leaves
 * the building, and a card whose pool is empty is a prize that cannot be paid. Until codes are
 * loaded into the store the deployment reads, nothing points at it: the Points page does not render
 * its link, the sitemap does not carry it, and the routing table answers it the way it answers every
 * other unpublished path — reachable on the game's own host behind the password, never on the apex.
 *
 * **One switch on purpose.** Flipping it publishes the link, the sitemap entry, the page and its API
 * together, because all four read this constant rather than repeating the decision; and
 * `tools/check-redeem.js` fails if any one of them is wired to something else. The route itself is
 * already written — there is no second half of "turning it on" besides loading the codes.
 */
export const REDEEM_LIVE = false;

/**
 * The three things a spin can land on, by key.
 *
 * Keys are the API's vocabulary and the counter keys in the pool; `name` is what a player reads.
 * `badge` is the tile the reel stops on, and it is the same file the result line names, so the
 * wheel and the sentence cannot end up pointing at two different cards.
 */
export const REDEEM_OUTCOMES = Object.freeze({
    tryAgain: {
        name: 'Try again',
        line: 'Nothing this time — the knights came up short. Spin again once the vault has paid you.',
    },
    amazon: {
        name: 'Amazon Pay gift card',
        short: 'Amazon Pay',
        line: 'An **Amazon Pay gift card** is yours — your code is below. Redeem it and treat yourself, champion.',
    },
    google: {
        name: 'Google Play gift card',
        short: 'Google Play',
        line: 'A **Google Play gift card** is yours — your code is below. Redeem it and treat yourself, champion.',
    },
});

/** The prizes, in the order the page lists them. `tryAgain` is not a prize and is not in here. */
export const REDEEM_PRIZES = Object.freeze(['amazon', 'google']);

/**
 * How likely each outcome is, in whole parts of the total.
 *
 * 4 / 1 / 1 out of six: two parts win, four parts do not, and the two cards are a coin flip
 * between them. Read by `redeemOdds()` below and by the draw.
 */
export const REDEEM_WEIGHTS = Object.freeze({ tryAgain: 4, amazon: 1, google: 1 });

/** The outcomes and their weights as one list, which is the shape a draw wants. */
export function redeemTable() {
    return Object.keys(REDEEM_WEIGHTS).map((key) => ({ key, weight: REDEEM_WEIGHTS[key] }));
}

/**
 * The odds, as numbers and as the sentence the page prints.
 *
 * Derived, never typed: `prize` is the chance a spin wins anything, `each` is the chance of one
 * named card, and `line` is what a player reads — so a change to the weights changes the copy on
 * the page in the same commit, which is the failure this function exists to make impossible.
 */
export const REDEEM_RULE = 'three of a kind wins a gift card';

export function redeemOdds() {
    const table = redeemTable();
    const total = table.reduce((sum, row) => sum + row.weight, 0);
    const prize = REDEEM_PRIZES.reduce((sum, key) => sum + (REDEEM_WEIGHTS[key] || 0), 0) / total;
    return {
        total,
        prize,
        each: prize / REDEEM_PRIZES.length,
        // Both halves of the deal a player reads before paying: how often a spin pays, computed
        // from the weights rather than typed, and how a paying spin *looks* on the reels. The
        // second one is not a probability — it is the shape the page animates to, and
        // `landedKeys` in `app/redeem/client.js` produces three of a kind for every prize and a
        // pair for every loss, so the rule on the marquee and the reels under it agree.
        rule: REDEEM_RULE,
        odds: `1 in ${Math.round(total / (total - REDEEM_WEIGHTS.tryAgain))} spins`,
        line: `${REDEEM_SPIN_COST.toLocaleString('en-US')} points a spin · ${REDEEM_RULE} · 1 in ${Math.round(total / (total - REDEEM_WEIGHTS.tryAgain))} spins`,
    };
}

/**
 * How to turn a code into a card, in four lines — the panel under the reels.
 *
 * Copy rather than logic, but it lives here beside the outcomes because it is the *same* fact: a
 * card named on this page without a way to redeem it is a page that hands a winner nothing they can
 * use. Kept to four short rows on purpose, so the panel stays a footnote to the wheel.
 */
export const REDEEM_HOWTO = Object.freeze([
    {
        what: 'Amazon Pay',
        how: 'amazon.in → Your Account → Gift cards → Add to balance, then paste the code. At checkout: Add a gift card.',
    },
    {
        what: 'Google Play',
        how: 'play.google.com/redeem, or the Play Store app → your photo → Payments & subscriptions → Redeem code.',
    },
    {
        what: 'One use only',
        how: 'Each code works once and belongs to the wallet that won it. Do not post it anywhere.',
    },
    {
        what: 'Stuck?',
        how: 'Ask in Discord with your wallet address and the day you won — we can look the code up.',
    },
]);

/**
 * Does this earning belong on the day's board?
 *
 * Every way to earn counts except commission: those points are paid to the inviter for somebody
 * else's work, and on a board that decides who wins there is no reading of "today" under which they
 * belong. Exported as a predicate because the tally and the draw must ask the same question — and
 * because a new reason added later gets a decision here rather than being silently included.
 */
export function countsTowardDaily(reason) {
    return String(reason || '') !== 'referral_commission';
}

/**
 * `YYYY-MM-DD` if this is a day key, else null.
 *
 * The shape is checked **and** the date has to exist. The regex alone is not enough, and the way it
 * fails is expensive: every day key ends up in a store key and, for a draw, in a record that is never
 * rewritten — so `--draw 2026-09-99` (a typo, or a month typed as a day) drew an empty board from
 * nobody and wrote that as a settled day, permanently. Round-tripping through `Date` is the whole
 * check: a key that comes back as a different key was not a date.
 */
export function isDayKey(value) {
    const text = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    const date = new Date(`${text}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : text;
}

/** The UTC day after a day key. */
export function nextDayKey(day) {
    const date = new Date(`${day}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
}

/**
 * When the drawing for the day now running closes: the next UTC midnight.
 *
 * Built server-side and handed to the page as an instant, because a countdown computed from the
 * browser's clock is a countdown to a different moment for a player whose machine is a minute out —
 * and this one closes a competition.
 */
export function nextDrawAt(now = new Date()) {
    return `${nextDayKey(todayKey(now))}T00:00:00.000Z`;
}

/** How the draw is described, in one string, so the page and the tool cannot word it differently. */
export function drawLabel(day) {
    return `${drawCapsuleLabel()} · ${dayMarker(day)}`;
}

export function drawCapsuleLabel() {
    return `${DRAW_SIZE} free Knight capsules`;
}
