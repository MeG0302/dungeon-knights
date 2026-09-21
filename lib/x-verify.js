/**
 * Proving an X post is real, without an X API key.
 *
 * WHAT THIS SOLVES
 * ----------------
 * Tasks 3 and 4 pay points for something a player did on X: a quote-retweet carrying our site
 * link, and a share of a finished vault run that tags our account. Paying on trust is not an
 * option (the browser is the claim, never the proof), and in February 2026 X closed its free API
 * tier and moved everyone to per-request credits — so reading a post through the official API
 * costs money per check, for every player, forever.
 *
 * X's **oEmbed endpoint** is the way out. It is the service behind every embedded post on the
 * web: you give it a post URL, it gives you back the author and the post's text, and it needs no
 * key, no OAuth and no credits. It was measured before this module was written, not assumed:
 *
 *   GET https://publish.twitter.com/oembed?url=<post url>&omit_script=1
 *   → 301 to publish.x.com, then 200 with
 *     { "url": "https://x.com/jack/status/20", "author_name": "jack",
 *       "author_url": "https://x.com/jack",
 *       "html": "<blockquote …><p lang=\"en\">just setting up my twttr</p>&mdash; jack (@jack) …" }
 *
 * Two edge cases from that same measurement are the reason this file is a module with a
 * harness rather than six lines in a route handler:
 *
 *   - A status that does not exist answers **404**, which is how "you just posted it and X has
 *     not indexed it yet" is told apart from "that link is wrong". It is the only retryable
 *     answer.
 *   - A URL that is *not* a status — `x.com/jack`, a profile — answers **200**. So the response
 *     body is checked against the status id we asked for; a status code alone would have
 *     accepted a profile page as proof of a post.
 *
 * WHAT IT CAN AND CANNOT PROVE — read this before adding a reward that needs more
 * ------------------------------------------------------------------------------
 * It proves a post **exists**, who **wrote** it, what it **says**, and — because a mention
 * survives into the embed's own text and its anchors — whether it **tags** an account. It cannot
 * prove a *like* or a *retweet*: oEmbed has no view of either, and claiming otherwise would be the
 * exact kind of guess this project's other checks exist to prevent. Those two need X API credits or
 * a zkTLS proof (Reclaim / TLSNotary), which is a dependency this file deliberately does not have.
 *
 * Two more limits worth knowing, both stated on the page rather than hidden:
 *   - A **protected** account cannot be read at all, by design. The player is told.
 *   - It cannot see **attachments**. A photo the player attached is invisible here, which is why
 *     the campaign's picture travels as the post's link preview instead — see `SHARE_OG_IMAGE` in
 *     `lib/points-config.js`. A reward that depended on a photo would be a reward no check could
 *     settle.
 *   - It is an undocumented public endpoint. It publishes no rate-limit headers, and its
 *     `cache_age` is enormous, so a just-posted tweet can be invisible for a while. Hence the
 *     retry ladder in `lib/points-program.js` and the manual fallback: a check that never
 *     succeeds leaves the submission *pending*, never silently credited.
 */

/** The embed service. `publish.twitter.com` redirects here; both are the same thing. */
export const OEMBED_ENDPOINT = 'https://publish.twitter.com/oembed';

/**
 * A status URL, however it was pasted: either host, the `/status/` and `/statuses/` spellings,
 * `mobile.`/`www.`, a trailing `/photo/1`, or a `?s=20&t=…` share suffix.
 */
const STATUS_IN_URL = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})(?:[/?#].*)?$/i;

/** The first URL in whatever was pasted — people paste the whole share sheet. */
const ANY_URL = /(https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/\S+)/i;

const HANDLE = /^[A-Za-z0-9_]{1,15}$/;

/** The status id out of any X URL, or null. Used to check the embed is about the post we asked for. */
export function statusIdFromUrl(url) {
    const match = /\/status(?:es)?\/(\d{5,25})/i.exec(String(url || ''));
    return match ? match[1] : null;
}

/**
 * Parse what the player pasted into the post's id and handle.
 *
 * The handle it returns is a **hint**, not evidence: it is the handle in the URL they typed,
 * and the whole point of checking `author_url` afterwards is that a pasted link is cheap. So a
 * link to someone else's post fails on the author check with a reason that says so, rather than
 * failing here as a malformed URL.
 */
export function parseStatusUrl(input) {
    const raw = typeof input === 'string' ? input.trim() : '';
    if (!raw) return { ok: false, code: 'missing', reason: 'Paste the link to your post.' };

    const extracted = ANY_URL.exec(raw);
    const candidate = extracted ? extracted[1] : raw;
    const parsed = STATUS_IN_URL.exec(candidate);
    if (!parsed) {
        return {
            ok: false,
            code: 'not-a-status-url',
            reason: 'That is not a link to a post. It should look like https://x.com/yourhandle/status/1234567890',
        };
    }
    return {
        ok: true,
        id: parsed[2],
        handle: parsed[1].toLowerCase(),
        url: `https://x.com/${parsed[1]}/status/${parsed[2]}`,
    };
}

/**
 * Decode the entities X puts in embed HTML.
 *
 * `&amp;` last on purpose: decoding it first would turn a literal `&amp;lt;` into `<`, which is
 * how a text-matching check starts passing on the wrong input.
 */
export function decodeEntities(text) {
    return String(text || '')
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
        .replace(/&quot;/g, '"')
        .replace(/&apos;|&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/&mdash;/g, '—')
        .replace(/&ndash;/g, '–')
        .replace(/&hellip;/g, '…')
        .replace(/&amp;/g, '&');
}

/**
 * The post's text, out of the blockquote.
 *
 * The embed is `<blockquote><p>the text</p>&mdash; handle (@handle) <a>date</a></blockquote>`,
 * so the paragraph is the post and the rest is the byline. Taking the whole blockquote instead
 * would put the author's own handle into the "text" — and then a post that merely @-mentioned
 * our account would look like it contained whatever we were searching for.
 */
export function textFromEmbed(html) {
    const source = String(html || '');
    const paragraph = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(source);
    const body = paragraph ? paragraph[1] : source;
    return decodeEntities(
        body.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
    ).replace(/\s+/g, ' ').trim();
}

/** The handle that actually wrote the post: `author_url` first, `author_name` as the fallback. */
export function authorFromEmbed(embed) {
    const fromUrl = /(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})/i.exec(String(embed?.author_url || ''));
    if (fromUrl) return fromUrl[1].toLowerCase();
    const name = String(embed?.author_name || '').trim().replace(/^@/, '');
    return HANDLE.test(name) ? name.toLowerCase() : null;
}

/** Every URL the embed points at, so a link can be found even when its text is shortened. */
export function hrefsIn(html) {
    const out = [];
    for (const match of String(html || '').matchAll(/href="([^"]+)"/gi)) {
        out.push(decodeEntities(match[1]));
    }
    return out;
}

/**
 * Does the post tag an account?
 *
 * `@handle`, never `@handleish`: the trailing boundary is the whole point of the check, since a
 * post tagging `@DNGrobinhoodFan` has not tagged `@DNGrobinhood`. Two spellings count, because X
 * renders one mention two ways — as visible text inside the post, and as an anchor at the profile —
 * and the visible text is the reliable one while the anchor is the fallback. Requiring the text
 * alone would reject honest posts on the days X decides to shorten a mention into a link.
 *
 * The anchor has to be the profile itself (`x.com/handle`) and not a post by that account, because
 * the embed's byline links to the post's own URL. Matching that would mean any post *written by*
 * the tagged account passed without mentioning it — the exact loophole this is here to close.
 *
 * A tag that is not a valid X handle matches nothing at all. Deliberately: a typo in the configured
 * tag would otherwise read as every player failing, and failing closed is the only direction a
 * payout rule may be wrong in.
 */
export function mentionsTag(html, text, tag) {
    const wanted = String(tag || '').trim().replace(/^@/, '').toLowerCase();
    if (!HANDLE.test(wanted)) return false;

    const inText = new RegExp(`(^|[^A-Za-z0-9_])@${wanted}(?![A-Za-z0-9_])`, 'i');
    if (inText.test(String(text || ''))) return true;

    return hrefsIn(html).some((href) => {
        const match = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?$/i.exec(href);
        return match ? match[1].toLowerCase() === wanted : false;
    });
}

/**
 * Does the post carry our link?
 *
 * Checked against the visible text **and** every href, because X renders a link's display form
 * as the anchor text only sometimes: a shortened `t.co` link shows as `t.co/…` in the text but
 * carries the real host in the href. Requiring the visible form alone would reject honest posts
 * on the days X decides to shorten.
 */
export function linksTo(html, text, host) {
    if (!host) return false;
    const needle = String(host).toLowerCase();
    if (String(text || '').toLowerCase().includes(needle)) return true;
    return hrefsIn(html).some((href) => href.toLowerCase().includes(needle));
}

/**
 * Ask X about one post and decide whether it is the post we were promised.
 *
 * `expect` is what the reward requires:
 *   - `handle`   the bound X account (required — this is the whole authorship check)
 *   - `mention`  an account the post has to tag, e.g. `DNGrobinhood` (the share's rule)
 *   - `host`     a host the text must mention, e.g. `dungeon-knights.vercel.app`
 *   - `keyword`  an alternative marker (a campaign hashtag), accepted in place of `host`
 *   - `statusId` a specific post id the text should reference (informational; see below)
 *
 * Returns `{ ok: true, post }` or `{ ok: false, code, reason, retryable? }`. The codes are the
 * contract the caller switches on, and `retryable` is the difference between "check again in a
 * minute" (`not-found-yet`, `unreachable`, `unavailable`) and a player who has to fix their link.
 *
 * A note on `statusId`: we cannot verify that a post **quotes** the campaign post, because the
 * oEmbed blockquote contains only the quoting post's own text — the quoted post is not in it.
 * So the campaign requirement is the one we can actually prove (author + our link), and a typed
 * campaign link is recorded rather than required. Pretending otherwise would be a check that
 * passes on the wrong input.
 */
export async function verifyPost(input, options = {}) {
    const { expect = {}, fetchImpl = fetch, timeoutMs = 8000, allowMissingAuthor = false } = options;

    // Authorship is the check that makes the rest meaningful, so a caller that forgets to pass the
    // bound handle is a bug, not a weaker check: without it, *any* post carrying our link would
    // pay. The only caller allowed to skip it is the diagnostic tool, explicitly.
    if (!expect.handle && !allowMissingAuthor) {
        return {
            ok: false,
            code: 'no-expectation',
            reason: 'internal error: verification needs the bound X handle',
        };
    }

    const parsed = parseStatusUrl(input);
    if (!parsed.ok) return parsed;

    const endpoint = `${OEMBED_ENDPOINT}?url=${encodeURIComponent(parsed.url)}&omit_script=1`;

    let res;
    try {
        res = await fetchImpl(endpoint, {
            redirect: 'follow',
            cache: 'no-store',
            headers: { accept: 'application/json' },
            signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
                ? AbortSignal.timeout(timeoutMs)
                : undefined,
        });
    } catch (error) {
        return {
            ok: false,
            code: 'unreachable',
            retryable: true,
            reason: 'X could not be reached to check that post. It will be checked again.',
            detail: error?.message || String(error),
        };
    }

    if (res.status === 404) {
        return {
            ok: false,
            code: 'not-found-yet',
            retryable: true,
            reason: 'That post is not visible to X yet. If you posted it seconds ago, that is normal — it will be checked again.',
        };
    }
    if (!res.ok) {
        return {
            ok: false,
            code: 'unavailable',
            retryable: true,
            reason: `X answered ${res.status} while checking that post. It will be checked again.`,
            detail: `http ${res.status}`,
        };
    }

    let embed;
    try {
        embed = await res.json();
    } catch {
        return {
            ok: false,
            code: 'unreadable-response',
            retryable: true,
            reason: 'X did not return a post from that link.',
        };
    }

    // The 200-for-a-profile-URL case: without this, `x.com/someone` verifies as a post.
    if (!embed || typeof embed !== 'object' || !embed.html || !embed.url || !embed.author_name) {
        return {
            ok: false,
            code: 'not-a-status-url',
            reason: 'That link did not resolve to a post on X.',
        };
    }
    const embedId = statusIdFromUrl(embed.url);
    // No status id at all means X answered about something that is not a post — the profile-URL
    // case that returns 200. A status code alone would have accepted it.
    if (!embedId) {
        return {
            ok: false,
            code: 'not-a-status-url',
            reason: 'That link did not resolve to a post on X.',
            detail: `x answered with ${embed.url}`,
        };
    }
    if (embedId !== parsed.id) {
        return {
            ok: false,
            code: 'mismatched-post',
            reason: 'X returned a different post than the one in that link.',
            detail: `asked for ${parsed.id}, got ${embedId}`,
        };
    }

    const author = authorFromEmbed(embed);
    const text = textFromEmbed(embed.html);
    const post = { id: embedId, author, text, url: parsed.url, handleHint: parsed.handle };

    if (!author) {
        return { ok: false, code: 'unreadable-response', retryable: true, reason: 'X did not say who wrote that post.' };
    }

    // Authorship. The bound handle is the account this wallet proved, so a post from anyone else
    // is not this player's post no matter how good the link in it is.
    if (expect.handle && author !== String(expect.handle).toLowerCase()) {
        return {
            ok: false,
            code: 'wrong-author',
            reason: `That post was written by @${author}, but this wallet has @${expect.handle} bound to it.`,
            post,
        };
    }

    // The tag, before the link: the two tasks ask for different things, and the sentence a player is
    // told should name the one they actually missed.
    if (expect.mention && !mentionsTag(embed.html, text, expect.mention)) {
        return {
            ok: false,
            code: 'missing-tag',
            reason: `That post does not tag @${String(expect.mention).replace(/^@/, '')} — this reward is for a post that tags the account.`,
            post,
        };
    }

    const wantedLink = expect.host ? linksTo(embed.html, text, expect.host) : false;
    const wantedKeyword = expect.keyword
        ? text.toLowerCase().includes(String(expect.keyword).toLowerCase())
        : false;
    const needsSomething = Boolean(expect.host || expect.keyword);
    if (needsSomething && !wantedLink && !wantedKeyword) {
        return {
            ok: false,
            code: 'missing-link',
            reason: expect.host
                ? `That post does not mention ${expect.host}. It has to carry our site link for the reward.`
                : 'That post is missing the campaign tag the reward asks for.',
            post,
        };
    }

    const mentionsCampaign = expect.statusId ? text.includes(expect.statusId) : false;
    return {
        ok: true,
        post: {
            ...post,
            mentionsCampaign,
            keyword: wantedKeyword,
            tagged: expect.mention ? true : null,
        },
    };
}

/** A one-line summary for logs and for the owner-only review path. Never throws. */
export function describeVerdict(verdict) {
    if (!verdict) return 'no verdict';
    if (verdict.ok) return `verified post ${verdict.post?.id} by @${verdict.post?.author}`;
    return `${verdict.code}: ${verdict.reason || ''}`.trim();
}
