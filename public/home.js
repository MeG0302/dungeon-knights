// dungeonknights.io — the coming-soon landing.
//
// One job, and it is the only thing this page asks the server for: how many people are already in
// line for the Genesis collection. It used to carry the waitlist form too; that has moved to
// `/genesis`, which is where the collection is explained and therefore where an address belongs.
// The page you land on should not be the page that asks for your email.
//
// The number is read from the endpoint that owns it rather than baked into the markup, and a failed
// read leaves the line hidden — a landing page that guesses at its own queue size is worse than one
// that says nothing.

class HomeLanding {
    constructor() {
        this.countLine = document.getElementById('genesisCount');
        this.loadCount();
    }

    /** Just the number, so the page can show a real queue instead of a slogan. */
    async loadCount() {
        if (!this.countLine) return;
        try {
            const res = await fetch('/api/waitlist', { cache: 'no-store' });
            const body = await res.json();
            const count = Number(body?.count) || 0;
            // Zero is not a queue and "0 knights already in line" is not a sentence — the line stays
            // hidden until somebody is in it.
            if (count > 0) {
                this.countLine.textContent = `${count.toLocaleString()} knight${count === 1 ? '' : 's'} already in line.`;
                this.countLine.hidden = false;
            }
        } catch {
            // A missing count is not worth a word on a landing page.
        }
    }
}

(function boot() {
    const start = () => new HomeLanding();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
    // The legacy pages re-fire DOMContentLoaded after their scripts are injected; guard against a
    // second instance if this file is ever loaded the same way.
    window.__homeLandingBound = true;
})();
