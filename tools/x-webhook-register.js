#!/usr/bin/env node
/**
 * Wire `@DNGrobinhood`'s follows to `/api/x/events`.
 *
 *     node tools/x-webhook-register.js                    # preflight only: no writes, no cost
 *     node tools/x-webhook-register.js --register          # POST /2/webhooks
 *     node tools/x-webhook-register.js --subscribe         # the two follow subscriptions
 *     node tools/x-webhook-register.js --subscribe --auth oauth1
 *     node tools/x-webhook-register.js --status            # what X currently holds
 *
 * THREE STEPS, AND THE FIRST ONE IS THE ONE THAT SAVES AN AFTERNOON
 * ----------------------------------------------------------------
 * Registering a webhook makes X call **our** URL with a CRC challenge, and it answers
 * `CrcValidationFailed` if that call does not come back with the right token — with no detail about
 * which half was wrong. The three ways to get there are indistinguishable from X's side: the route
 * is not deployed, the secret is not set on the deployment, or the secret is the wrong one. So this
 * asks our own URL the same question X will ask, compares the answer to the HMAC it computes locally,
 * and only then offers to register. A failure says which of the three it is.
 *
 * WHAT EACH STEP COSTS
 * --------------------
 * Creating a subscription is **$0.010 per request** on X's pay-per-use card, and a webhook has its
 * own limits per app. Neither is charged by the default run, which only reads — so the default is a
 * dry run for the same reason the backfill's is: this is the one part of the suite that spends money.
 *
 * AUTHENTICATION, AND WHY BOTH KINDS ARE HERE
 * -------------------------------------------
 * Webhook management (`/2/webhooks`) is OAuth2 App Only — the bearer token. Subscriptions are
 * documented with several accepted authorizations, and there are reports of **OAuth 2.0 user tokens
 * returning a bare 403** on `/2/activity/subscriptions` while OAuth 1.0a works. Rather than discover
 * which one this app's tier accepts by trial, `--auth` selects it: `bearer` (default) or `oauth1`
 * (consumer key/secret + access token/secret, signed here with `node:crypto` — no dependency).
 *
 * Needs, from the X developer portal: `X_CONSUMER_SECRET` (the API secret key — the same one the
 * deployment uses to verify deliveries), `X_BEARER_TOKEN` for webhook management, and
 * `X_FOLLOW_TARGET_ID` (the numeric id of our own account).
 */

import { createHmac, randomBytes } from 'crypto';

const API = 'https://api.x.com';

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const value = (name, fallback = null) => {
    const index = args.indexOf(`--${name}`);
    if (index === -1) return fallback;
    const next = args[index + 1];
    return next && !next.startsWith('--') ? next : true;
};

const auth = String(value('auth', 'bearer')).toLowerCase();
const url = String(value('url', process.env.X_WEBHOOK_URL || 'https://dungeon-knights.vercel.app/api/x/events'));
const targetId = String(process.env.X_FOLLOW_TARGET_ID || '').trim();
const consumerSecret = String(process.env.X_CONSUMER_SECRET || '').trim();
const consumerKey = String(process.env.X_CONSUMER_KEY || process.env.X_API_KEY || '').trim();
const accessToken = String(process.env.X_ACCESS_TOKEN || '').trim();
const accessSecret = String(process.env.X_ACCESS_TOKEN_SECRET || '').trim();
const bearer = String(process.env.X_BEARER_TOKEN || '').trim();

const doRegister = has('register');
const doSubscribe = has('subscribe');
const onlyStatus = has('status');

/* ------------------------------------------------------------------ OAuth 1.0a, by hand
 * HMAC-SHA1 over the canonical parameter string. Written out rather than pulled in as a dependency:
 * there is no OAuth library in this project, and the signature is thirty lines that can be checked
 * against X's own documented example.
 */
function percent(value_) {
    return encodeURIComponent(String(value_))
        .replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function oauthHeader(method, baseUrl, query = {}) {
    const oauth = {
        oauth_consumer_key: consumerKey,
        oauth_nonce: randomBytes(16).toString('hex'),
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: String(Math.floor(Date.now() / 1000)),
        oauth_token: accessToken,
        oauth_version: '1.0',
    };
    const signatureParams = { ...oauth, ...query };
    const canonical = Object.keys(signatureParams).sort()
        .map((key) => `${percent(key)}=${percent(signatureParams[key])}`)
        .join('&');
    const base = [method.toUpperCase(), percent(baseUrl), percent(canonical)].join('&');
    const key = `${percent(consumerSecret)}&${percent(accessSecret)}`;
    oauth.oauth_signature = createHmac('sha1', key).update(base).digest('base64');

    return `OAuth ${Object.keys(oauth).sort()
        .map((k) => `${percent(k)}="${percent(oauth[k])}"`)
        .join(', ')}`;
}

/** Headers for one call, in whichever style `--auth` asked for. */
function authHeaders(method, fullUrl, query = {}) {
    if (auth === 'oauth1') {
        if (!consumerKey || !accessToken || !accessSecret) {
            throw new Error('--auth oauth1 needs X_CONSUMER_KEY, X_ACCESS_TOKEN and X_ACCESS_TOKEN_SECRET');
        }
        return { Authorization: oauthHeader(method, fullUrl.split('?')[0], query) };
    }
    if (!bearer) throw new Error('X_BEARER_TOKEN is required (or pass --auth oauth1 with the keys)');
    return { Authorization: `Bearer ${bearer}` };
}

async function call(method, path, body, query = {}) {
    const full = `${API}${path}`;
    const headers = { 'Content-Type': 'application/json', ...authHeaders(method, `${full}${Object.keys(query).length ? `?${new URLSearchParams(query)}` : ''}`, query) };
    const res = await fetch(full, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* X answers with an HTML page for some failures */ }
    return { status: res.status, ok: res.ok, body: parsed, text };
}

function fail(step, result) {
    const detail = result.body?.detail || result.body?.title || result.body?.error_description
        || result.body?.errors?.[0]?.detail || result.body?.errors?.[0]?.message
        || result.text?.slice(0, 300) || `HTTP ${result.status}`;
    console.error(`  ${step} failed — ${detail}`);
    if (result.body?.reason || result.body?.error) {
        console.error(`  reason: ${result.body.reason || result.body.error}`);
    }
}

/* ---------------------------------------------------------------------- the CRC preflight */
/**
 * Ask our own URL the question X will ask, and check the answer the way X will.
 *
 * `sha256=<base64 hmac of the token with the consumer secret>` is the whole protocol, and it is the
 * same one `lib/x-webhook.js` implements — this recomputes it independently so a deployment that is
 * answering with the *wrong* secret is caught here rather than by X's opaque `CrcValidationFailed`.
 */
async function preflight() {
    console.log('');
    console.log(`CRC preflight — ${url}`);

    if (!consumerSecret) {
        console.log('  SKIPPED: X_CONSUMER_SECRET is not set here, so there is nothing to compare against.');
        console.log('  (Set it to the app\'s API secret key — the same value the deployment verifies with.)');
        return null;
    }

    const token = `preflight-${Date.now()}`;
    const expected = `sha256=${createHmac('sha256', consumerSecret).update(token, 'utf8').digest('base64')}`;

    let res;
    try {
        res = await fetch(`${url}?crc_token=${encodeURIComponent(token)}`, { headers: { Accept: 'application/json' } });
    } catch (error) {
        console.error(`  FAILED: could not reach it at all — ${error.message || error}`);
        return false;
    }

    const text = await res.text();
    if (res.status === 404) {
        console.error('  FAILED: the route is not deployed (404). Deploy before registering.');
        return false;
    }
    if (!res.ok) {
        console.error(`  FAILED: HTTP ${res.status} — ${text.slice(0, 200)}`);
        if (/no consumer secret/i.test(text)) {
            console.error('  → the route is live but the deployment has no X_CONSUMER_SECRET set.');
        }
        return false;
    }

    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    if (parsed?.response_token !== expected) {
        console.error('  FAILED: the answer does not match this secret.');
        console.error(`    ours: ${expected}`);
        console.error(`    url : ${parsed?.response_token || text.slice(0, 120)}`);
        console.error('  → the deployment is answering with a different secret than the one set here.');
        return false;
    }

    console.log('  ok — the URL answers the CRC with exactly this secret, so X\'s check will pass.');
    return true;
}

/* ------------------------------------------------------------------------------ the work */
(async () => {
    console.log('');
    console.log(`Webhook target: ${url}`);
    console.log(`  auth: ${auth}${auth === 'oauth1' ? ` (consumer key ${consumerKey ? 'set' : 'MISSING'}, access token ${accessToken ? 'set' : 'MISSING'})` : ` (bearer ${bearer ? 'set' : 'MISSING'})`}`);
    console.log(`  our account id: ${targetId || 'MISSING — X_FOLLOW_TARGET_ID'}`);

    const reachable = await preflight();

    // A write that cannot pass X's CRC is a wasted request at best and a confusing failure at worst,
    // so the preflight is a **gate** on both writes rather than advice printed above them.
    if ((doRegister || doSubscribe) && reachable !== true) {
        console.error('');
        console.error('Refusing to register: the CRC preflight did not pass, and X asks our URL the same');
        console.error('question while creating the webhook. Fix that first — it is one of: the route is not');
        console.error('deployed, or X_CONSUMER_SECRET here is not the one the deployment verifies with.');
        process.exit(1);
    }

    if (!bearer && auth !== 'oauth1') {
        console.log('');
        console.log('Stopping here: nothing below this point can run without a credential.');
        console.log('What is needed, all from the X developer portal for the app that owns @DNGrobinhood:');
        console.log('  X_CONSUMER_SECRET   the API secret key (also what the deployment verifies deliveries with)');
        console.log('  X_BEARER_TOKEN      app-only token, for /2/webhooks');
        console.log('  X_FOLLOW_TARGET_ID  our numeric account id:  curl -H "Authorization: Bearer $X_BEARER_TOKEN" https://api.x.com/2/users/by/username/DNGrobinhood');
        process.exit(reachable === false ? 1 : 0);
    }

    // --------------------------------------------------------------- what X already holds
    const existing = { webhooks: [], subscriptions: [] };
    const hooks = await call('GET', '/2/webhooks');
    if (hooks.ok) existing.webhooks = hooks.body?.data || [];
    else fail('GET /2/webhooks', hooks);

    const subs = await call('GET', '/2/activity/subscriptions');
    if (subs.ok) existing.subscriptions = subs.body?.data || [];
    else if (subs.status !== 403) fail('GET /2/activity/subscriptions', subs);

    console.log('');
    console.log(`X currently holds ${existing.webhooks.length} webhook(s) and ${existing.subscriptions.length} subscription(s)`);
    for (const hook of existing.webhooks) {
        console.log(`  webhook ${hook.id}  valid=${hook.valid}  ${hook.url}`);
    }
    for (const sub of existing.subscriptions) {
        console.log(`  subscription ${sub.subscription_id}  ${sub.event_type}  user=${sub.filter?.user_id}  webhook=${sub.webhook_id || '(stream only)'}`);
    }

    if (onlyStatus) process.exit(0);

    // ------------------------------------------------------------------- register the webhook
    let webhookId = existing.webhooks.find((hook) => hook.url === url)?.id || null;
    const duplicate = Boolean(webhookId);

    if (doRegister) {
        if (duplicate) {
            console.log('');
            console.log(`  a webhook for this URL already exists (${webhookId}) — reusing it rather than creating a duplicate`);
        } else {
            console.log('');
            console.log('  POST /2/webhooks — this makes X call our URL for a CRC right now');
            const created = await call('POST', '/2/webhooks', { url });
            if (!created.ok) {
                fail('POST /2/webhooks', created);
                console.error('  the CRC preflight above passed, so a failure here is one of: this app already has a webhook for this URL, the app has reached its webhook limit, or the URL is not acceptable (no port, https only).');
                process.exit(1);
            }
            webhookId = created.body?.data?.id || null;
            console.log(`  ok — webhook ${webhookId} valid=${created.body?.data?.valid}`);
        }
    }

    // -------------------------------------------------------------- subscribe follow + unfollow
    if (doSubscribe) {
        if (!webhookId) {
            console.error('');
            console.error('  no webhook id: run with --register first (or make sure the URL matches an existing one).');
            process.exit(1);
        }
        if (!/^\d{1,25}$/.test(targetId)) {
            console.error('');
            console.error('  X_FOLLOW_TARGET_ID must be our own numeric account id — the events are filtered by it.');
            process.exit(1);
        }

        for (const eventType of ['follow.follow', 'follow.unfollow']) {
            const already = existing.subscriptions.find((sub) => sub.event_type === eventType && sub.filter?.user_id === targetId);
            if (already) {
                console.log(`  ${eventType}: already subscribed (${already.subscription_id}) — skipping, a duplicate is a wasted request`);
                continue;
            }
            console.log(`  POST /2/activity/subscriptions ${eventType} (billed $0.010)`);
            const made = await call('POST', '/2/activity/subscriptions', {
                event_type: eventType,
                filter: { user_id: targetId },
                webhook_id: webhookId,
                tag: 'points-follow',
            });
            if (!made.ok) {
                fail(`POST ${eventType}`, made);
                if (made.status === 403 && auth !== 'oauth1') {
                    console.error('  → a 403 here is the known case where this endpoint wants OAuth 1.0a: retry with --auth oauth1.');
                }
                process.exit(1);
            }
            const id = made.body?.data?.subscription_id || made.body?.data?.subscription?.subscription_id || '(created)';
            console.log(`  ok — ${eventType} ${id}`);
        }
    }

    if (!doRegister && !doSubscribe) {
        console.log('');
        console.log('Nothing was created, and nothing was charged. Next:');
        console.log('  node tools/x-webhook-register.js --register            # make X call our URL');
        console.log('  node tools/x-webhook-register.js --subscribe           # follow.follow + follow.unfollow');
        console.log('  node tools/x-webhook-register.js --status              # what X holds now');
        console.log('');
        console.log('Then set FOLLOW_PROOF_MODE=webhook, X_CONSUMER_SECRET and X_FOLLOW_TARGET_ID for Production,');
        console.log('redeploy, and have somebody follow @DNGrobinhood to produce a real event.');
    }
})().catch((error) => {
    console.error('');
    console.error(error.message || error);
    process.exit(1);
});
