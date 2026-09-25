'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
    BACK_TRAIL_KEY, backLabel, previousPage, rememberPage, sameOriginPath,
} from '../lib/back-trail';

/**
 * The ← in the header: back to the page you were on, not to the front door.
 *
 * Rendered as the first thing in every page header, immediately to the left of the Kingdom Gate
 * button, so the two read as one control: *back* and *home*. The rule it follows — a trail of our
 * own pages, per tab, rather than the browser's history — is documented in `lib/back-trail.js`; what
 * is here is the small amount of browser that rule needs.
 *
 * Three decisions worth stating:
 *
 *   - **It reads storage in an effect, never during render.** The server has no tab and no trail,
 *     so rendering from it would mean the first paint disagreeing with the second. The arrow appears
 *     when there is somewhere to go, which is one frame after the page.
 *   - **Nothing is remembered until the arrow has read the trail.** Remember first and a reload
 *     would bury the page you came from under a copy of this one.
 *   - **A missing `sessionStorage` is not an error.** Safari in a private window can refuse it; the
 *     arrow then falls back to the referrer and, failing that, simply is not drawn.
 */
export default function BackLink() {
    const pathname = usePathname();
    const router = useRouter();
    const [back, setBack] = useState(null);

    useEffect(() => {
        if (!pathname) return;
        let trail = null;
        try {
            const raw = window.sessionStorage.getItem(BACK_TRAIL_KEY);
            trail = raw ? JSON.parse(raw) : [];
        } catch {
            trail = [];
        }
        // The trail first — it is only ever pages of ours — and a same-origin referrer second, for
        // the hard navigations (a link, or the gate's own form) that leave no trail behind.
        const fromTrail = previousPage(trail, pathname);
        const fromReferrer = sameOriginPath(document.referrer, window.location.origin);
        const last = fromTrail || (fromReferrer && fromReferrer !== pathname ? fromReferrer : null);
        setBack(last);
        if (trail) {
            try {
                window.sessionStorage.setItem(BACK_TRAIL_KEY, JSON.stringify(rememberPage(trail, pathname)));
            } catch { /* full or blocked storage: the arrow still works, it just forgets sooner */ }
        }
    }, [pathname]);

    if (!back) return null;
    const label = backLabel(back);

    return (
        <button
            type="button"
            className="btn btn-ghost btn-sm back-link"
            title={`Back to ${label}`}
            aria-label={`Back to ${label}`}
            data-arya="back"
            onClick={() => router.push(back)}
        >
            <span aria-hidden="true">←</span>
        </button>
    );
}
