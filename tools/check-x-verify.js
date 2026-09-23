#!/usr/bin/env node
/**
 * Does the X verifier pay only for the post it was promised?
 *
 *     node tools/check-x-verify.js
 *
 * The stakes are points, and points are a liability — so every check here is a way the verifier
 * could hand out a reward for something that did not happen. It runs entirely **offline** against
 * a stubbed X: no network, no key, no rate limit, which also means the table below is a
 * specification of X's behaviour rather than a description of whatever it answered today. The
 * shape of that stub is not invented — it is what the live endpoint returned when it was measured
 * (see the header of `lib/x-verify.js`), including the two cases that make this file necessary:
 * a status that does not exist answers **404**, and a URL that is not a status answers **200**.
 *
 * Every guard here was falsified by mutation before it was trusted; the two that caught real
 * mistakes in the first draft are marked in their labels.
 */

import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
    parseStatusUrl, statusIdFromUrl, decodeEntities, textFromEmbed, authorFromEmbed,
    linksTo, hrefsIn, mentionsTag, verifyPost, describeVerdict,
} = await import(pathToFileURL(path.join(ROOT, 'lib', 'x-verify.js')).href);
const source = (await import('fs')).readFileSync(path.join(ROOT, 'lib', 'x-verify.js'), 'utf8');

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

const HOST = 'dungeon-knights.vercel.app';
const ID = '1234567890123456789';

// ------------------------------------------------------------------------------- the stub
function jsonResponse(body, status = 200) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** One embed, exactly the shape the live endpoint returns. */
function embedFor({ id = ID, handle = 'knightfan', text = 'cleared the vault', link = null } = {}) {
    const body = link
        ? `${text} <a href="https://t.co/abc123">${link}</a>`
        : text;
    return {
        url: `https://x.com/${handle}/status/${id}`,
        author_name: handle,
        author_url: `https://x.com/${handle}`,
        html: `<blockquote class="twitter-tweet"><p lang="en" dir="ltr">${body}</p>`
            + `&mdash; ${handle} (@${handle}) `
            + `<a href="https://x.com/${handle}/status/${id}?ref_src=twsrc%5Etfw">September 21, 2026</a>`
            + '</blockquote>\n\n',
        provider_name: 'X',
        version: '1.0',
    };
}

/** A fetch double that records what it was asked for. */
function stub(handler) {
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({ url: String(url), options });
        return handler(String(url), options);
    };
    fetchImpl.calls = calls;
    return fetchImpl;
}

const expect = { handle: 'knightfan', host: HOST };

// ------------------------------------------------------------------ 1. no key, no credits
rec('the verifier carries no X API credential',
    !/api\.x\.com|authorization|bearer|api[_-]?key/i.test(source.replace(/\/\*[\s\S]*?\*\//g, '')),
    'the oEmbed endpoint is the whole mechanism');
rec('and it is an unauthenticated, redirect-following GET',
    /redirect: 'follow'/.test(source) && /publish\.twitter\.com\/oembed/.test(source));

// ------------------------------------------------------------------------ 2. parse the URL
const good = [
    ['https://x.com/knightfan/status/1234567890123456789', 'x.com/status'],
    ['https://twitter.com/KnightFan/statuses/1234567890123456789', 'twitter.com + /statuses/ + case'],
    ['https://mobile.twitter.com/knightfan/status/1234567890123456789', 'mobile host'],
    ['https://www.x.com/knightfan/status/1234567890123456789?s=20&t=abc', 'share suffix'],
    ['https://x.com/knightfan/status/1234567890123456789/photo/1', 'photo suffix'],
    ['I just did it! https://x.com/knightfan/status/1234567890123456789?s=20 have a look', 'pasted share sheet'],
    ['  https://x.com/knightfan/status/1234567890123456789  ', 'surrounding whitespace'],
];
for (const [input, why] of good) {
    const parsed = parseStatusUrl(input);
    rec(`  parses ${why}`,
        parsed.ok && parsed.id === ID && parsed.handle === 'knightfan',
        parsed.ok ? `id ${parsed.id}, @${parsed.handle}` : parsed.code);
}

const bad = [
    ['', 'empty'],
    ['   ', 'whitespace only'],
    ['https://x.com/knightfan', 'a profile, not a post'],
    ['https://dungeon-knights.vercel.app', 'our own site'],
    ['1234567890123456789', 'a bare id'],
    ['https://x.com/knightfan/status/notanumber', 'a non-numeric status'],
];
for (const [input, why] of bad) {
    const parsed = parseStatusUrl(input);
    rec(`  refuses ${why}`, !parsed.ok && !!parsed.code, parsed.ok ? 'accepted it' : parsed.code);
}

rec('an http link is normalised to https rather than fetched as pasted',
    parseStatusUrl('http://x.com/knightfan/status/1234567890123456789').url
        === `https://x.com/knightfan/status/1234567890123456789`,
    'we always ask X about our own canonical URL, never the string a player handed us');

rec('statusIdFromUrl reads the id out of either host',
    statusIdFromUrl(`https://twitter.com/a/status/${ID}`) === ID
    && statusIdFromUrl('https://x.com/a') === null);

// ---------------------------------------------------------------------- 3. the embed text
rec('entities decode in an order that cannot create markup  [caught a draft bug]',
    decodeEntities('a &amp;lt;b&amp;gt; c') === 'a &lt;b&gt; c',
    decodeEntities('a &amp;lt;b&amp;gt; c'));
rec('numeric and hex entities decode',
    decodeEntities('&#39;quoted&#39; &#x27;again&#x27;') === "'quoted' 'again'");
rec('the post text excludes the byline, so a handle is not mistaken for content  [caught a draft bug]',
    !textFromEmbed(embedFor().html).includes('@knightfan'),
    textFromEmbed(embedFor().html));
rec('the post text is the paragraph',
    textFromEmbed(embedFor({ text: 'a vault run' }).html) === 'a vault run',
    textFromEmbed(embedFor({ text: 'a vault run' }).html));
rec('line breaks survive as spaces rather than gluing words together',
    textFromEmbed('<blockquote><p>one<br>two</p></blockquote>') === 'one two');

// ------------------------------------------------------------------------- 4. the author
rec('the author comes from author_url', authorFromEmbed(embedFor({ handle: 'someone' })) === 'someone');
rec('and falls back to author_name when the url is missing',
    authorFromEmbed({ author_name: 'OnlyName' }) === 'onlyname');
rec('an unreadable author is null rather than a guess',
    authorFromEmbed({ author_name: 'not a handle!', author_url: '' }) === null);

// --------------------------------------------------------------------------- 5. the link
rec('the link is found in the visible text', linksTo('<p>x</p>', `see ${HOST} for it`, HOST));
rec('the link is found in an href when X shortened the text',
    linksTo(`<a href="https://${HOST}/points">t.co/abc</a>`, 't.co/abc', HOST));
rec('a post without our link is not credited', !linksTo('<p>hello</p>', 'hello', HOST));
rec('no configured host means no link match', !linksTo('<p>x</p>', HOST, ''));
rec('hrefs are decoded, not raw HTML', hrefsIn('<a href="x&amp;y">').includes('x&y'));

// ---------------------------------------------------------------------------- 5b. the tag
// The share's entire requirement, and the check with a trap built into the data: the embed's
// byline is an anchor to the *author's* profile, so a post written by the tagged account must not
// pass on its own byline. That is exactly what a naive href scan would have done.
const TAG = 'DNGrobinhood';
rec('a post that tags the account passes', mentionsTag('<p>x</p>', `cleared it @${TAG}`, TAG));
rec('case does not matter', mentionsTag('<p>x</p>', `cleared it @${TAG.toLowerCase()}` , TAG));
rec('so does punctuation right after the name',
    mentionsTag('<p>x</p>', `@${TAG}, 1800 points`, TAG));
rec('a longer handle is not the tag  [the trailing boundary]',
    !mentionsTag('<p>x</p>', `@${TAG}Fan cleared it`, TAG));
rec('a bare name without the @ is not a tag',
    !mentionsTag('<p>x</p>', `${TAG} cleared it`, TAG));
rec('an account the post never mentions does not match',
    !mentionsTag('<p>x</p>', 'cleared it @someoneelse', TAG));
rec('the author\u2019s own byline is not a tag  [the loophole this closes]',
    !mentionsTag(embedFor({ handle: TAG, text: 'cleared the vault' }).html, 'cleared the vault', TAG),
    'a post *written by* the account is not a post *tagging* it');
rec('a mention whose visible text is shortened still counts',
    mentionsTag(`<a href="https://x.com/${TAG}">x.com/${TAG}</a>`, 'go', TAG));
rec('a tag that is not a valid handle matches nothing at all  [fails closed]',
    !mentionsTag('<p>x</p>', '@not a handle!', 'not a handle!'));

// ------------------------------------------------------------------- 6. the whole verdict
async function withStub(handler, options = {}) {
    const fetchImpl = stub(handler);
    const verdict = await verifyPost(
        `https://x.com/knightfan/status/${ID}`,
        { expect, fetchImpl, ...options }
    );
    return { verdict, fetchImpl };
}

{
    const { verdict, fetchImpl } = await withStub(() => jsonResponse(embedFor({ link: HOST })));
    rec('a real post from the bound handle, carrying our link, verifies',
        verdict.ok === true && verdict.post.author === 'knightfan' && verdict.post.id === ID,
        describeVerdict(verdict));
    rec('and it asked X about the canonical post, following the redirect',
        fetchImpl.calls.length === 1
        && fetchImpl.calls[0].url.includes(`url=${encodeURIComponent(`https://x.com/knightfan/status/${ID}`)}`)
        && fetchImpl.calls[0].options.redirect === 'follow',
        fetchImpl.calls[0]?.url.slice(0, 90));
}

{
    const { verdict } = await withStub(() => jsonResponse(embedFor({ handle: 'someoneelse', link: HOST })));
    rec('a post carrying our link but written by someone else pays nothing',
        verdict.ok === false && verdict.code === 'wrong-author',
        verdict.reason);
    // Optional chaining throughout: when a guard is mutated out, this assertion must *report* the
    // violation rather than throw on the missing `reason` — a harness that crashes on the first
    // failure hides the other three it would have caught.
    rec('and the refusal names both handles',
        verdict.reason?.includes('@someoneelse') && verdict.reason?.includes('@knightfan'),
        verdict.reason);
}

{
    const { verdict } = await withStub(() => jsonResponse(embedFor({ text: 'no link here' })));
    rec('a post from the right account without our link pays nothing',
        verdict.ok === false && verdict.code === 'missing-link',
        verdict.reason);
}

{
    // The share's verdict, end to end: one requirement, the tag, and authorship still standing
    // behind it.
    const shareExpect = { handle: 'knightfan', mention: TAG };
    const posting = (text, handle = 'knightfan') => stub(() => jsonResponse(embedFor({ text, handle })));
    const verify = (text, handle) => verifyPost(`https://x.com/knightfan/status/${ID}`, {
        expect: shareExpect, fetchImpl: posting(text, handle),
    });

    const tagged = await verify(`I cleared the vault today @${TAG}`);
    rec('a share that tags the account verifies',
        tagged.ok === true && tagged.post.tagged === true, describeVerdict(tagged));

    const untagged = await verify('cleared all three floors, 1800 points');
    rec('a share from the right author without the tag pays nothing',
        untagged.ok === false && untagged.code === 'missing-tag', untagged.reason);

    const nearMiss = await verify(`cleared it @${TAG}Fan`);
    rec('nor does a post tagging a name that merely starts with ours',
        nearMiss.ok === false && nearMiss.code === 'missing-tag', nearMiss.code);

    const wrongAuthor = await verify(`cleared it @${TAG}`, 'someoneelse');
    rec('and a tagged post from another account is still not yours',
        wrongAuthor.ok === false && wrongAuthor.code === 'wrong-author', wrongAuthor.reason);

    // The link is not the share's business any more, and this is the pair that proves the two rules
    // did not leak into each other: no link required, no tag accepted in its place.
    const noLink = await verify(`cleared it @${TAG}`);
    rec('a share needs no link of ours, only the tag', noLink.ok === true, describeVerdict(noLink));
    const linkOnly = await verify(`cleared the vault ${HOST}`);
    rec('and our link alone does not stand in for the tag',
        linkOnly.ok === false && linkOnly.code === 'missing-tag', linkOnly.code);
}

{
    // The day marker, which is what makes a daily reward daily rather than per post: the same
    // player can be paid once a day, so the cheapest repeat is yesterday's link filed today.
    //
    // The pair that matters is the last two: loose on how a human writes it, strict on the number,
    // because `Day 3` is today and `Day 30` is a different day of the program.
    const shareExpect = { handle: 'knightfan', mention: TAG };
    const posting = (text) => stub(() => jsonResponse(embedFor({ text })));
    const verify = (text, marker = null) => verifyPost(`https://x.com/knightfan/status/${ID}`, {
        expect: marker ? { ...shareExpect, marker } : shareExpect,
        fetchImpl: posting(text),
    });

    const noMarker = await verify(`cleared the vault today @${TAG}`, 'Day 3');
    rec('a share from another day does not pay today',
        noMarker.ok === false && noMarker.code === 'missing-marker', noMarker.reason);

    const morning = await verify(`Day 3: cleared the vault today @${TAG}`, 'Day 3');
    rec('today’s marker in the post is what lets it pay', morning.ok === true, describeVerdict(morning));

    const shapes = ['DAY  3', 'day3', '(day 3)'];
    const accepted = [];
    for (const shape of shapes) accepted.push((await verify(`cleared it, ${shape}, @${TAG}`, 'Day 3')).ok === true);
    rec('and how a player types it is not the check — “DAY  3”, “day3”, “(day 3)” all count',
        accepted.every(Boolean), accepted.map((ok) => (ok ? 'ok' : 'REFUSED')).join(' · '));

    const later = await verify(`Day 30: cleared the vault today @${TAG}`, 'Day 3');
    rec('but another day is another day — “Day 30” is not “Day 3”',
        later.ok === false && later.code === 'missing-marker', `Day 30 vs Day 3 → ${later.code || 'paid'}`);

    const unchecked = await verify(`cleared the vault today @${TAG}`);
    rec('a caller that asks for no marker gets the old behaviour, unchanged', unchecked.ok === true);
}

{
    const { verdict } = await withStub(() => jsonResponse(embedFor({ text: 'campaign #DungeonKnights' })));
    const kw = await verifyPost(`https://x.com/knightfan/status/${ID}`, {
        expect: { handle: 'knightfan', host: HOST, keyword: '#DungeonKnights' },
        fetchImpl: stub(() => jsonResponse(embedFor({ text: 'campaign #DungeonKnights' }))),
    });
    rec('a campaign keyword can stand in for the link, but only when configured',
        verdict.ok === false && kw.ok === true,
        verdict.code);
}

{
    const { verdict } = await withStub(() => jsonResponse({ error: 'not found' }, 404));
    rec('404 is retryable — that is "X has not indexed it yet"',
        verdict.ok === false && verdict.code === 'not-found-yet' && verdict.retryable === true);
    const { verdict: five } = await withStub(() => jsonResponse({}, 500));
    rec('5xx is retryable', five.code === 'unavailable' && five.retryable === true);
    const { verdict: down } = await withStub(() => { throw new Error('ETIMEDOUT'); });
    rec('a network failure is retryable, not a rejection',
        down.code === 'unreachable' && down.retryable === true);
    rec('and it never leaks the network error as the reason a player sees',
        !/ETIMEDOUT/.test(down.reason || ''), down.reason);
}

{
    // The measured case: a URL that is not a status answers 200.
    const profile = { url: 'https://x.com/knightfan', author_name: 'knightfan', author_url: 'https://x.com/knightfan', html: '<blockquote><p>bio</p></blockquote>' };
    const { verdict } = await withStub(() => jsonResponse(profile));
    rec('a 200 that is not a post is refused  [the profile-URL case]',
        verdict.ok === false && verdict.code === 'not-a-status-url',
        verdict.reason);
}

{
    const { verdict } = await withStub(() => jsonResponse(embedFor({ id: '9999999999999999999', link: HOST })));
    rec('an embed for a different post than the link is refused',
        verdict.ok === false && verdict.code === 'mismatched-post',
        verdict.detail);
}

{
    const { verdict } = await withStub(() => ({
        ok: true, status: 200, json: async () => { throw new Error('not json'); },
    }));
    rec('a body that is not JSON is retryable, not credited',
        verdict.code === 'unreadable-response' && verdict.retryable === true);
    const { verdict: shapeless } = await withStub(() => jsonResponse({ hello: 'world' }));
    rec('a JSON body without an author is refused',
        shapeless.ok === false, shapeless.code);
}

{
    const verdict = await verifyPost(`https://x.com/knightfan/status/${ID}`, {
        expect: { host: HOST },
        fetchImpl: stub(() => jsonResponse(embedFor({ link: HOST }))),
    });
    rec('a caller that forgets the bound handle gets an error, not a weaker check',
        verdict.ok === false && verdict.code === 'no-expectation',
        verdict.reason);
    const diagnostic = await verifyPost(`https://x.com/knightfan/status/${ID}`, {
        expect: { host: HOST }, allowMissingAuthor: true,
        fetchImpl: stub(() => jsonResponse(embedFor({ link: HOST }))),
    });
    rec('the diagnostic tool can skip authorship only by asking to',
        diagnostic.ok === true);
}

{
    // The campaign case: the caller also passes the campaign post's id, so a player who typed
    // that link gets it recorded. It is informational on purpose — a quote-retweet does not put
    // the quoted post's URL in the text, so requiring it would reject honest posts.
    const campaignExpect = { ...expect, statusId: ID };
    const verdict = await verifyPost(`https://x.com/knightfan/status/${ID}`, {
        expect: campaignExpect,
        fetchImpl: stub(() => jsonResponse(embedFor({ text: `quoting ${ID} — go`, link: HOST }))),
    });
    rec('a typed campaign id is recorded, not required',
        verdict.ok === true && verdict.post.mentionsCampaign === true,
        `mentionsCampaign=${verdict.post?.mentionsCampaign}`);

    const without = await verifyPost(`https://x.com/knightfan/status/${ID}`, {
        expect: campaignExpect,
        fetchImpl: stub(() => jsonResponse(embedFor({ link: HOST }))),
    });
    rec('and its absence does not fail a post that carries the link',
        without.ok === true && without.post.mentionsCampaign === false,
        'quoting the campaign post is not visible in oEmbed, so it is not a gate');
}

console.log('');
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
    console.log('');
    for (const f of failed) console.log(`  FAILED: ${f.label}`);
    process.exitCode = 1;
}
