/**
 * The Activity API's push half: what X sends us, and how we know it is X.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A POLLER
 * -------------------------------------------
 * `lib/x-verify.js` proves a *post*, because X's public oEmbed endpoint will describe one for free.
 * Nothing free will describe a **follow**: oEmbed has no view of the follow graph, and v2 has no
 * "does A follow B" endpoint any more — the old v1.1 `friendships/show` is gone, so the only way to
 * *ask* is to page somebody's following list and pay per account row returned ($0.010 each on the
 * 2026 pay-per-use rate card; `Owned Reads` at $0.001 apply only to the app owner's own data). Asking
 * is therefore the expensive direction, and it gets more expensive the more popular the player is.
 *
 * The Activity API inverts it: register a webhook, subscribe our own account once, and X **tells**
 * us when somebody follows — `follow.follow`, billed per delivered event, deduplicated for 24 hours.
 * We hold the fact instead of buying it back one page at a time, so a claim costs nothing to check.
 * That is the whole reason this module exists rather than a polling job.
 *
 * TWO SIGNATURES, ONE SECRET
 * --------------------------
 * Both are HMAC-SHA256 with the app's **consumer secret**, and both are checked here:
 *
 *   - the **CRC handshake**: X calls the webhook URL with `?crc_token=…` before it will deliver
 *     anything, and expects `{"response_token": "sha256=<base64>"}` back. A webhook that fails this
 *     is never subscribed.
 *   - every **delivery**, signed in the `x-twitter-webhooks-signature` header as `sha256=<base64>`.
 *
 * The delivery signature is computed over the **raw request body**, which is why the route reads
 * `request.text()` and never `request.json()`: re-serialising a parsed body changes the bytes, so the
 * signature stops matching — and a verifier that cannot match anything cannot tell a forgery from a
 * shape change. It compares with `timingSafeEqual` for the same reason the session token does.
 *
 * WHAT IT CANNOT DO
 * -----------------
 * It reports what already happened. It cannot see the follows that happened **before** we subscribed
 * — those need `tools/x-followers-backfill.js` (a followers read, billed per row, once) or they simply
 * never arrive. And an unsubscribed, or unauthorised, or over-limit account gets no events at all,
 * which is indistinguishable at this end from "nobody followed us"; the route logs every delivery it
 * accepts so the two can be told apart from the logs.
 */

import { createHmac, timingSafeEqual } from 'crypto';

/** X's own header, verbatim. */
export const SIGNATURE_HEADER = 'x-twitter-webhooks-signature';

/** The `sha256=` prefix both the CRC token and every delivery signature carry. */
const PREFIX = 'sha256=';

function hmacBase64(value, secret) {
    return createHmac('sha256', secret).update(value, 'utf8').digest('base64');
}

/**
 * The answer to X's CRC challenge.
 *
 * Returns null when there is nothing to answer with, which the route turns into a 400 — a webhook
 * that replies with a wrong token is worse than one that admits it cannot: X marks it as failing and
 * we would go looking for the problem in the wrong place.
 */
export function crcResponseToken(crcToken, secret) {
    if (!crcToken || !secret) return null;
    return PREFIX + hmacBase64(String(crcToken), secret);
}

/**
 * Is this delivery really from X?
 *
 * `rawBody` is the exact bytes of the request — read as text, never re-encoded from a parsed object.
 * A missing secret is a no: an unconfigured deployment must not accept unsigned deliveries, because
 * the whole point of this route is that its input is trusted.
 */
export function verifyWebhookSignature(rawBody, header, secret) {
    if (!secret || typeof header !== 'string') return false;
    const expected = PREFIX + hmacBase64(typeof rawBody === 'string' ? rawBody : String(rawBody || ''), secret);
    const given = header.trim();
    const a = Buffer.from(given, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The follow events out of a delivery, in the shape this program cares about.
 *
 * Deliberately total: it returns a verdict rather than throwing, and the route treats "I did not
 * recognise this" as a **200 with a loud log**. That is not sloppiness — every accepted delivery is
 * a billable event and X retries anything that is not a 2xx, so throwing on a shape we have never
 * seen would pay for the same event repeatedly while we worked out why. A shape change should cost
 * us one log line, not a retry storm.
 *
 * The payload is `{ for_user_id, follow_events: [{ type, created_at, source, target }] }` where
 * `source` is the account that did the following and `target` is the account being followed. The
 * follower is therefore `source.id` — the id X will keep saying even if the handle is renamed, which
 * is why ids are the primary key everywhere in this program and the handle is only a fallback.
 *
 * `targetId` (our own account) filters the list when it is configured, and `for_user_id` is checked
 * against it too: an event about somebody else's followers is not ours to pay for.
 */
export function parseFollowEvents(payload, { targetId = '' } = {}) {
    const list = Array.isArray(payload?.follow_events) ? payload.follow_events : null;
    if (!list) return { ok: false, code: 'unrecognised', events: [], reason: 'no follow_events array' };

    const wanted = String(targetId || '').trim();
    const forUser = String(payload?.for_user_id || '').trim();
    if (wanted && forUser && forUser !== wanted) {
        return { ok: false, code: 'not-ours', events: [], reason: `delivered for ${forUser}, not ${wanted}` };
    }

    const events = [];
    let skipped = 0;

    for (const raw of list) {
        const type = String(raw?.type || '').trim().toLowerCase();
        // Only the two verbs this program has an opinion about. An unknown `type` is skipped rather
        // than guessed at: defaulting to "follow" would hand out a reward for an event we misread.
        if (type !== 'follow' && type !== 'unfollow') {
            skipped += 1;
            continue;
        }
        const id = String(raw?.source?.id || '').trim();
        if (!/^\d{1,25}$/.test(id)) {
            skipped += 1;
            continue;
        }
        const target = String(raw?.target?.id || '').trim();
        if (wanted && target && target !== wanted) {
            skipped += 1;
            continue;
        }
        events.push({
            id,
            // Lowercased with no `@`, the same normalisation every binding uses.
            username: String(raw?.source?.screen_name || '').trim().replace(/^@/, '').toLowerCase() || null,
            following: type === 'follow',
            at: String(raw?.created_at || '').trim() || new Date().toISOString(),
        });
    }

    return { ok: true, code: 'follow-events', events, skipped };
}

/* ------------------------------------------------------------------- the deployment's setup
 *
 * Read here rather than in `lib/points-config.js` on purpose: that module is imported by the
 * browser bundle (the vault mini-game reads the floor values off it), and a file that holds the
 * consumer secret should not be one a bundler is even asked about. `process.env.X_CONSUMER_SECRET`
 * would come through as `undefined` on the client, which is *safe* but indistinguishable from
 * "not configured" — this module is never imported by anything that ships to a browser.
 */

function consumerSecret() {
    return process.env.X_CONSUMER_SECRET || '';
}

/**
 * How a follow is proved, as this deployment is configured.
 *
 * **`claim`** is the honest default and the state this shipped in: nothing is checked, and the card
 * says so. **`webhook`** means X is telling us, so the reward is paid against X's own record. The
 * switch is an env var plus a secret, because a mode that says "verified" while nothing can verify
 * is worse than no mode at all — so `webhook` is only ever returned when there is a secret to check
 * a delivery with.
 */
export function followProofMode() {
    if (String(process.env.FOLLOW_PROOF_MODE || '').trim().toLowerCase() !== 'webhook') return 'claim';
    return consumerSecret() ? 'webhook' : 'claim';
}

/** Our own X account id, when it is configured — used to filter deliveries and as a claim's target. */
export function followTargetId() {
    return String(process.env.X_FOLLOW_TARGET_ID || '').trim();
}

/** The CRC answer, with the deployment's own secret. Null when either half is missing. */
export function answerCrcChallenge(crcToken) {
    return crcResponseToken(crcToken, consumerSecret());
}

/** Is this delivery signed by us? False when no secret is configured — see the module header. */
export function isTrustedDelivery(rawBody, header) {
    return verifyWebhookSignature(rawBody, header, consumerSecret());
}

/** A one-line summary for the log, so a delivery can be read without dumping the payload. */
export function describeFollowDelivery(parsed) {
    if (!parsed) return 'no delivery';
    if (!parsed.ok) return `${parsed.code}: ${parsed.reason || ''}`.trim();
    if (!parsed.events.length) return `recognised, nothing to record (${parsed.skipped || 0} skipped)`;
    return parsed.events
        .map((e) => `${e.following ? 'follow' : 'unfollow'} @${e.username || e.id} (${e.id})`)
        .join(', ');
}
