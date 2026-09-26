/**
 * Where the ← in the header goes back to.
 *
 * Every page has a way *home* — the Kingdom Gate button — and no way back to the page you were
 * actually on. On a phone that is the browser's own back gesture; everywhere else it is three taps
 * through the hub. So each header now carries one arrow, and this is the rule behind it.
 *
 * **Why a trail of our own rather than `history.back()`.** The browser's history is the whole tab,
 * not our product: a page opened from a bookmark, a Discord link or a search result has entries in
 * front of it that belong to other sites, and `history.back()` on such a page leaves the app — from
 * the outside that is the button being broken. So we keep our own list of the pages of *ours* this
 * tab has visited, in `sessionStorage` (per tab, gone when the tab goes), and the arrow walks that.
 * The cost is that a page opened cold — directly, with nothing behind it — shows no arrow at all,
 * which is honest: there is no last page to restore, and the button beside it still goes home.
 *
 * **A reload is not a visit.** `rememberPage` collapses a repeat of the page you are already on, so
 * refreshing a page does not push a second copy and leave the arrow pointing at itself. Revisiting a
 * page later is a real visit and lands in the list again.
 *
 * The module is pure — the trail is an array in, an array out, and the storage is the caller's
 * business — which is what lets `tools/check-back.js` walk every one of these rules without a
 * browser, a clock or a `sessionStorage`.
 */

/** Where the trail lives. Namespaced like the rest of the store's keys, and per tab, not per origin. */
export const BACK_TRAIL_KEY = 'dk:back';

/** How deep the trail goes. Long enough to walk back through a session, short enough to stay small. */
export const BACK_TRAIL_MAX = 24;

/** A path of ours: a string that starts at the root. Anything else is junk from an older build. */
const isPath = (value) => typeof value === 'string' && value.startsWith('/');

/**
 * The trail with the page we are on now added to it.
 *
 * Two rules, and both are about not lying to the arrow: a repeat of the *last* entry is dropped
 * rather than pushed (a reload of the page you are on is not a new page), and the list is capped at
 * `max` from the tail, because the pages worth going back to are the recent ones.
 */
export function rememberPage(trail, path, max = BACK_TRAIL_MAX) {
    const cap = Math.max(1, Math.floor(Number(max)) || BACK_TRAIL_MAX);
    const kept = (Array.isArray(trail) ? trail : []).filter(isPath);
    if (!isPath(path)) return kept.slice(-cap);
    const next = kept[kept.length - 1] === path ? kept : [...kept, path];
    return next.slice(-cap);
}

/**
 * The last page in the trail that is not the one we are on, or `null` if there is none.
 *
 * Walks from the newest end, so a trail of `['/points', '/portfolio', '/points']` read from
 * `/points` answers `/portfolio` — the page you actually came from, not the copy of this page that
 * is further up the list.
 */
export function previousPage(trail, path) {
    const list = (Array.isArray(trail) ? trail : []).filter(isPath);
    for (let i = list.length - 1; i >= 0; i -= 1) {
        if (list[i] !== path) return list[i];
    }
    return null;
}

/**
 * The path of a same-origin referrer, or `null`.
 *
 * The second way the arrow can know where you came from: a hard navigation between our own pages
 * (the gate's password form posts and reloads, and a link can be a plain `<a>`) leaves no trace in
 * `sessionStorage`, but it does leave a referrer. Only the *origin* is trusted — a referrer from
 * anywhere else is not a page of ours and never becomes the arrow's destination.
 */
export function sameOriginPath(referrer, origin) {
    if (typeof referrer !== 'string' || !referrer) return null;
    if (typeof origin !== 'string' || !origin) return null;
    try {
        const url = new URL(referrer);
        if (url.origin !== origin) return null;
        const path = `${url.pathname}${url.search}`;
        return isPath(path) ? path : null;
    } catch {
        return null;
    }
}

/**
 * What each page is called, so the arrow can say where it goes instead of only pointing.
 *
 * Named the way the site names them, and only for pages that exist — a path that is not in here is
 * shown as it is (`Back to /new-thing`), which is a worse label but never a wrong one.
 */
const BACK_LABELS = Object.freeze({
    '/': 'Kingdom Gate',
    '/hub': 'Kingdom Gate',
    '/landing': 'Kingdom Gate',
    '/gate': 'Kingdom Gate',
    '/menu': "Knight's Hall",
    '/dungeons': 'Dungeons',
    '/game': 'Dungeons',
    '/mint': 'Summoning Chamber',
    '/staking': 'Staking Vault',
    '/tokenomics': '$DNG Economy',
    '/points': 'Points Program',
    '/portfolio': 'My Portfolio',
    '/redeem': 'Redeem',
    '/pitch': 'Pitch Deck',
    '/genesis': 'Genesis Knights',
});

/** A path with its query and hash off, and no trailing slash, so `/points?ref=X#tab` is `/points`. */
function barePath(path) {
    if (typeof path !== 'string' || !path) return '';
    const cut = path.split(/[?#]/)[0];
    if (!cut.startsWith('/')) return '';
    return cut.length > 1 ? cut.replace(/\/+$/, '') : '/';
}

/** The name of a page, or the path itself when we have never heard of it. */
export function backLabel(path) {
    const bare = barePath(path);
    if (!bare) return 'the last page';
    return BACK_LABELS[bare] || bare;
}
