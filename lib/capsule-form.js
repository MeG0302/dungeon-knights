/**
 * Handing a win over in the Google Form — done by the server, not by the player.
 *
 * The form is where a capsule actually goes out from: the team reads it and sends the prize by hand,
 * so an entry is the delivery note. Until this file existed the note was the *player's* job — claim,
 * then open the form, then paste your address, then tap "I submitted it" — and that is three steps
 * asked of somebody who has already won, to produce a record the server was holding the whole time.
 * The wallet that claimed is on the wallet record; the day it won is on the capsule record; the two
 * together are exactly the entry. Asking a person to retype them is where "no wallet has been
 * shared" comes from.
 *
 * ##  How a form is read, and why it is read at all
 *
 * A published Google Form is an HTML page that carries its own machine-readable description — the
 * `FB_PUBLIC_LOAD_DATA_` blob — and a POST target (`…/formResponse`) with one `entry.<id>` parameter
 * per question. Both halves are parsed here rather than configured, because *configured* is how this
 * breaks silently: a form is edited in a browser by somebody who is not thinking about code, and
 * question ids are not things anybody should have to copy and paste into Vercel. Read the page and
 * the wiring follows the form.
 *
 * Which question gets which value is decided by **title**, in that order:
 *
 *   - a question titled anything with `wallet` or `address` in it gets the address;
 *   - a question titled anything with `date` or `day` gets the day it was won;
 *   - and a form with **one** question — which is what this program's form is today, a single
 *     paragraph box called `knight capsule` — gets one line, `0x… · 2026-09-25`, because a form with
 *     nowhere to put a date separately is still owed the date.
 *
 * So the owner can add two titled questions whenever he likes and the entries separate themselves,
 * with no deploy and no env var. That is the whole reason for the title rule: the form is his to
 * edit, and the code should not have to be told what he decided.
 *
 * ##  What it will not do
 *
 * It never throws and it never blocks a claim. A form that is slow, unreachable, edited into
 * something unrecognisable or refusing writes leaves the claim itself untouched — the win is
 * recorded on the wallet either way, the failure is written on the record, and the player is still
 * offered the form by hand. The claim is the fact; the form is a delivery note about it.
 */

const FORM_TIMEOUT_MS = 8000;
const FIELDS_TTL_MS = 10 * 60 * 1000;

/** A question that wants the address, by the only thing we can know about it: its title. */
const WALLET_TITLE = /wallet|address|0x/i;
/** A question that wants the day. */
const DAY_TITLE = /date|day/i;

/** The separator in a combined single-field entry. Visible in the sheet, so it is a readable one. */
const SEPARATOR = ' · ';

/**
 * The line an entry carries: the wallet, and the day it won.
 *
 * One function so the form's cell, the tool's printout and the harness cannot word it differently —
 * and so the shape is decided in a place a reader can find.
 */
export function capsuleEntryLine({ address, day } = {}) {
    const wallet = String(address || '').trim();
    const when = String(day || '').trim();
    if (!wallet) return when;
    if (!when) return wallet;
    return `${wallet}${SEPARATOR}${when}`;
}

/** HTML entities, the six that appear in a Google Form's own attributes. */
function decodeEntities(text) {
    return String(text || '')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&');
}

/** The attributes of one tag, as a plain object. Attribute order is not something to rely on. */
function tagAttributes(tag) {
    const attributes = {};
    const re = /([a-zA-Z-]+)\s*=\s*"([^"]*)"/g;
    let match;
    while ((match = re.exec(tag))) attributes[match[1].toLowerCase()] = decodeEntities(match[2]);
    return attributes;
}

/**
 * Every question in the bootstrap blob, in the order the form shows them.
 *
 * The blob is nested arrays rather than a schema, so this walks it instead of indexing into it: a
 * question is any array whose second slot is a title and whose fifth slot holds `[entryId, …]`. The
 * shape is Google's, and it has been stable for years — but a walk survives it growing a level,
 * which indexing does not.
 */
function collectQuestions(blob) {
    const found = [];
    const walk = (node) => {
        if (!Array.isArray(node)) return;
        const title = typeof node[1] === 'string' ? node[1] : null;
        const entries = Array.isArray(node[4]) ? node[4] : null;
        if (title !== null && entries && Array.isArray(entries[0]) && Number.isFinite(Number(entries[0][0]))) {
            found.push({ title: title.trim(), entryId: String(entries[0][0]) });
            return;
        }
        for (const child of node) walk(child);
    };
    walk(blob);
    return found;
}

/**
 * A form page, as everything the submission needs: where to POST, which question takes what, and the
 * hidden fields a browser would have sent back.
 *
 * `hidden` is captured rather than invented. Google's own page posts `fvv`, `pageHistory` and a
 * `fbzx` marker along with the answers, and the marker is what ties a submission to the revision of
 * the form the browser was looking at. Sending back exactly what the page handed us is the closest a
 * server-side POST gets to being a browser, and it costs one regex.
 */
export function parseCapsuleForm(html, baseUrl = '') {
    const text = String(html || '');
    const formTag = /<form\b[^>]*>/i.exec(text)?.[0] || '';
    const action = tagAttributes(formTag).action || '';
    if (!action) return null;

    const hidden = {};
    const inputRe = /<input\b[^>]*>/gi;
    let input;
    while ((input = inputRe.exec(text))) {
        const attributes = tagAttributes(input[0]);
        if ((attributes.type || '').toLowerCase() !== 'hidden') continue;
        if (!attributes.name) continue;
        hidden[attributes.name] = attributes.value || '';
    }

    const blob = /FB_PUBLIC_LOAD_DATA_\s*=\s*([\s\S]*?);\s*<\/script>/.exec(text)?.[1];
    const questions = blob ? collectQuestions(JSON.parse(blob)) : [];

    return {
        // Relative actions exist in Google's markup; a URL needs an origin to be postable.
        actionUrl: baseUrl ? new URL(action, baseUrl).toString() : action,
        title: /<title>([^<]*)<\/title>/i.exec(text)?.[1]?.trim() || '',
        questions,
        hidden,
    };
}

/**
 * Which question takes which value.
 *
 * Answers without a question are dropped, and a question without an answer stays empty — so this
 * reports both halves rather than assuming a form has the two fields it ought to.
 */
export function capsuleFieldPlan(questions = []) {
    const list = Array.isArray(questions) ? questions : [];
    const wallet = list.find((q) => WALLET_TITLE.test(q.title || '')) || null;
    const day = wallet ? list.find((q) => q !== wallet && DAY_TITLE.test(q.title || '')) || null : null;
    // A form with nowhere to put an address is a form this cannot fill: pick the first question and
    // put the whole line in it, which at least keeps the wallet and the date together.
    const combined = !wallet && list.length > 0;
    return {
        walletField: wallet || (combined ? list[0] : null),
        dayField: day,
        combined,
        unmatched: list.filter((q) => q !== (wallet || (combined ? list[0] : null)) && q !== day).length,
    };
}

/** What a submission will carry, as `{ 'entry.123': 'value' }`. */
export function capsuleEntryValues({ questions = [], address, day } = {}) {
    const plan = capsuleFieldPlan(questions);
    if (!plan.walletField) return { values: {}, plan, error: 'the form asks for nothing' };
    const values = plan.combined || !plan.dayField
        ? { [`entry.${plan.walletField.entryId}`]: capsuleEntryLine({ address, day }) }
        : {
            [`entry.${plan.walletField.entryId}`]: String(address || ''),
            [`entry.${plan.dayField.entryId}`]: String(day || ''),
        };
    return { values, plan, error: null };
}

/** Read a published form. Cached briefly: the shape changes when a person edits it, not per claim. */
const fieldCache = new Map();

export async function readCapsuleForm(formUrl, { fetchImpl = fetch, now = Date.now, timeoutMs = FORM_TIMEOUT_MS } = {}) {
    const url = String(formUrl || '').trim();
    if (!url) return { ok: false, error: 'no form is configured' };

    const cached = fieldCache.get(url);
    if (cached && now() - cached.at < FIELDS_TTL_MS) return cached.value;

    const fetched = await withTimeout(fetchImpl, url, { redirect: 'follow' }, timeoutMs);
    if (!fetched.ok) return { ok: false, error: fetched.error };
    // A page that answered is not the same as a page that answered with a form: a link edited into a
    // login wall, or a form that has been taken down, comes back as HTML that parses to nothing.
    if (!fetched.response.ok) {
        return { ok: false, error: `the form answered HTTP ${fetched.response.status}` };
    }

    try {
        const html = await fetched.response.text();
        const parsed = parseCapsuleForm(html, fetched.response.url || url);
        if (!parsed) return { ok: false, error: 'that page is not a form' };
        if (!parsed.questions.length) return { ok: false, error: 'the form has no questions to fill' };
        const value = { ok: true, ...parsed };
        // Only a success is cached. A form that was unreachable this minute is worth asking again
        // next minute, and a cached failure is a delivery that never gets retried.
        fieldCache.set(url, { at: now(), value });
        return value;
    } catch (error) {
        return { ok: false, error: error?.message || 'the form could not be read' };
    }
}

/**
 * File one claim: read the form, fill it in, post it.
 *
 * Answers `{ ok, status, error, values }` and **never throws** — see the header for why a delivery
 * note is not allowed to take a claim down with it.
 */
export async function submitCapsuleEntry({
    formUrl, address, day, fetchImpl = fetch, timeoutMs = FORM_TIMEOUT_MS,
} = {}) {
    const form = await readCapsuleForm(formUrl, { fetchImpl, timeoutMs });
    if (!form.ok) return { ok: false, error: form.error, values: {} };

    const { values, plan, error } = capsuleEntryValues({ questions: form.questions, address, day });
    if (error) return { ok: false, error, values: {} };

    const body = new URLSearchParams({ ...form.hidden, ...values });
    const posted = await withTimeout(fetchImpl, form.actionUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        redirect: 'follow',
    }, timeoutMs);

    if (!posted.ok) return { ok: false, error: posted.error, values, plan };
    // Google answers a refusal with a status of its own, and a 500 is a refusal — the entry did not
    // land. Treating "the server said no" as delivered is the failure mode that loses a capsule.
    if (!posted.response.ok) {
        return { ok: false, error: `the form refused the entry (HTTP ${posted.response.status})`, values, plan };
    }
    return {
        ok: true,
        status: posted.response.status,
        error: null,
        values,
        plan,
        questions: form.questions,
    };
}

/**
 * A fetch with a deadline, returning `{ ok, response }` or `{ ok: false, error }`.
 *
 * `AbortSignal.timeout` is not used: it is newer than some of the Node versions this repo runs on, and
 * a claim path that dies on an older runtime is a worse bug than one that wraps `AbortController`.
 * A refusal and a timeout are the same answer to the caller — the note was not delivered — and the
 * sentence says which, because that is the difference between "try again" and "fix the link".
 */
async function withTimeout(fetchImpl, url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || FORM_TIMEOUT_MS));
    try {
        const response = await fetchImpl(url, { ...options, signal: controller.signal });
        return { ok: true, response };
    } catch (error) {
        const aborted = error?.name === 'AbortError';
        return { ok: false, error: aborted ? 'the form did not answer in time' : `the form could not be reached (${error?.message || error})` };
    } finally {
        clearTimeout(timer);
    }
}

/** Forget what was read — for a harness that edits its own form, and for a redeploy that must re-read. */
export function forgetCapsuleForms() {
    fieldCache.clear();
}
