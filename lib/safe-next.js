/**
 * Only a path on this site, ever.
 *
 * Lives in its own module with **no env reads** so the browser can import it: `lib/app-gate.js`
 * builds its secret at module scope, and a client component pulling that in would either read a
 * server variable or ship a fallback secret into the bundle. This file is just the rule.
 */

/** `?next=` is attacker-visible input, so anything that is not a local path becomes `/`. */
export function safeNext(value) {
    if (typeof value !== 'string') return '/';
    if (!value.startsWith('/')) return '/';
    // `//host` and `/\host` are both protocol-relative once a browser normalises them, which is the
    // whole trick this exists to stop: a login screen that redirects off-site is a phishing pattern.
    if (value.startsWith('//') || value.startsWith('/\\')) return '/';
    return value;
}
