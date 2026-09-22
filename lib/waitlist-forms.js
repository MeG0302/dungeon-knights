/**
 * The Google Form copy of the waitlist.
 *
 * Every signup that reaches the store is also written to the form the owner watches, so the list
 * exists in two places: ours, which the page counts, and theirs, which a person can open on a phone
 * and sort in Sheets. The form is the one a human reads when they make a mint list, so a signup that
 * only reached our store would be a signup nobody acts on.
 *
 * Three facts shape how this is written, and all three come from how Google Forms actually behaves
 * rather than from taste:
 *
 *   1. **There is no API key here.** This is the published-form route: the same POST a browser makes
 *      when someone presses Submit — `formResponse` with `entry.<id>` fields. It needs no credentials,
 *      which is why it is the right tool for a two-field form, and it is also why it can break without
 *      telling anyone. So the caller must treat a failure as **a failure to copy, never a failure to
 *      sign up**.
 *   2. **The POST needs the form's own `fbzx` token.** A submission without it is quietly answered
 *      with the blank form again — status 200 and no error — which is exactly the kind of failure
 *      that would have looked like success forever. The token is read from the form page and cached
 *      for minutes rather than fetched per signup, and a submission that comes back unrecorded is
 *      retried **once** against a freshly fetched token, because that is what an expired token looks
 *      like.
 *   3. **The form has one question, titled `email:address`.** So both values go in one answer — the
 *      email, a newline, then the address when there is one. Newline rather than a separator on
 *      purpose: Sheets splits a column on it with one menu command, and it reads correctly in the
 *      form's own responses view, which wraps text. The question's id is a default here and an env
 *      override (`WAITLIST_FORM_ENTRY`) because a form can be rebuilt by someone who never opens this
 *      file, and the fix for that should be a value in Vercel, not a deploy.
 *
 * Server-only, and never throws: `forwardToForm` returns what happened.
 */

/** The published form, resolved from the short link the owner sent (`forms.gle/GvCPEAcLzDRJhBfx5`). */
const FORM_ID = '1FAIpQLSc-x7_f6u1jAm6fskoNnQhSr9HgmJMkmrIvSmiYPiXSzPo7Rw';

/** The `entry.<id>` of the form's single question. Overridable — see the note above. */
const ENTRY_ID = '2051617427';

/** How long a fetched `fbzx` is trusted. It is a token for a rendered page, not a session. */
const TOKEN_TTL_MS = 10 * 60 * 1000;

/** Long enough for Google on a good day, short enough that a signup is never held hostage. */
const REQUEST_TIMEOUT_MS = 4000;

const FORM_ORIGIN = 'https://docs.google.com/forms/d/e/';

/** The view URL, for reading the token and the entry ids off the live form. */
export function formViewUrl() {
    return `${FORM_ORIGIN}${FORM_ID}/viewform`;
}

/** Where a submission goes. */
export function formResponseUrl() {
    return `${FORM_ORIGIN}${FORM_ID}/formResponse`;
}

/** The entry id in use, env first so a rebuilt form is a config change rather than an edit. */
export function formEntryId() {
    return (process.env.WAITLIST_FORM_ENTRY || ENTRY_ID).trim();
}

/** Off-switch, for a branch that should not be writing into the owner's form at all. */
export function formForwardingEnabled() {
    return String(process.env.WAITLIST_FORM_DISABLED || '').toLowerCase() !== 'true';
}

/**
 * The one answer the form accepts, built from a signup.
 *
 * `email` on the first line and the address on the second, because the question is titled
 * `email:address` — a person reading the responses sees the pair in the order the title promises.
 * An address-less signup is just the email: an empty second line would be a blank row in Sheets that
 * reads like a missing answer rather than an optional one.
 */
export function formAnswer(email, address = null) {
    const cleanEmail = String(email || '').trim();
    const cleanAddress = address ? String(address).trim() : '';
    if (!cleanAddress) return cleanEmail;
    return `${cleanEmail}\n${cleanAddress}`;
}

/**
 * Pull the `fbzx` token out of the form's own markup.
 *
 * Exported because it is the fragile part: if Google renames the field, this returns null and the
 * harness says so, instead of every signup silently going nowhere.
 */
export function parseFormToken(html) {
    const match = String(html || '').match(/name="fbzx"\s+value="([^"]+)"/);
    return match ? match[1] : null;
}

/** The cached token, and the instant it was fetched. Module scope: one form, one process. */
let tokenCache = { value: null, at: 0 };

/** Forget the cached token — used by the retry, and by the harness between cases. */
export function resetFormTokenCache() {
    tokenCache = { value: null, at: 0 };
}

/**
 * The form's current token, fetched at most once every `TOKEN_TTL_MS`.
 *
 * A fetch that fails leaves the cache alone rather than clearing it: a form that is briefly
 * unreachable should not force every signup afterwards to pay for a page fetch.
 */
export async function formToken({ fetchImpl = fetch, nowMs = Date.now(), fresh = false } = {}) {
    if (!fresh && tokenCache.value && nowMs - tokenCache.at < TOKEN_TTL_MS) return tokenCache.value;
    try {
        const response = await fetchImpl(formViewUrl(), { cache: 'no-store', signal: timeoutSignal() });
        const html = await response.text();
        const token = parseFormToken(html);
        if (token) tokenCache = { value: token, at: nowMs };
        return token;
    } catch {
        return tokenCache.value;
    }
}

/** An abort signal for the request, when the runtime has one. */
function timeoutSignal() {
    try {
        return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    } catch {
        return undefined;
    }
}

/**
 * Write one signup into the owner's form.
 *
 * Returns `{ ok, skipped, reason, status, attempt }` and never throws. Callers are expected to ignore
 * the result for the visitor's sake — the waitlist has already been written by then — and to log it
 * for the owner's, because "the form stopped accepting answers in April" is a fact worth noticing.
 */
export async function forwardToForm(entry, { fetchImpl = fetch, nowMs = Date.now() } = {}) {
    const email = String(entry?.email || '').trim();
    if (!email) return { ok: false, skipped: true, reason: 'no email address to forward' };
    if (!formForwardingEnabled()) return { ok: false, skipped: true, reason: 'forwarding is switched off' };

    const entryId = formEntryId();
    if (!entryId) return { ok: false, skipped: true, reason: 'no form question is configured' };

    const answer = formAnswer(email, entry?.address);
    let lastReason = 'the form did not confirm the answer';

    // Two attempts, and the second only exists because a stale token answers 200 with the blank form.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        const token = await formToken({ fetchImpl, nowMs, fresh: attempt === 2 });
        if (!token) {
            lastReason = 'the form offered no submission token';
            continue;
        }

        const body = new URLSearchParams();
        body.set(`entry.${entryId}`, answer);
        // The three fields a browser sends and Google checks. `fbzx` is the one that matters.
        body.set('fvv', '1');
        body.set('pageHistory', '0');
        body.set('fbzx', token);

        try {
            const response = await fetchImpl(formResponseUrl(), {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: body.toString(),
                redirect: 'follow',
                cache: 'no-store',
                signal: timeoutSignal(),
            });
            const text = await response.text();
            // The only in-band signal the published route gives. Anything else — including a 200 —
            // is the form rendered back at us, which means it did not record anything.
            if (/response has been recorded/i.test(text)) {
                return { ok: true, status: response.status, attempt };
            }
            lastReason = `the form answered without recording (status ${response.status})`;
            resetFormTokenCache();
        } catch (error) {
            lastReason = String(error?.message || error);
        }
    }

    return { ok: false, reason: lastReason };
}
