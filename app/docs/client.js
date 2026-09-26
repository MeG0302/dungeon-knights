'use client';

/**
 * `/docs` — the documentation, as one read.
 *
 * The reference page this follows is a single scroll: a coloured band with the wordmark and a mono
 * nav, a ticker under it, and then sections that each open with a loud uppercase heading and sit in
 * a `1500px` column with `44px` gutters. That is the *shape* of this file. What it renders in is
 * this project's skin — charcoal stone, bronze and one gold accent, Cinzel for the headings — so a
 * reader arriving from `/points` recognises the place.
 *
 * Four decisions worth spelling out:
 *
 *   - **The nav is sticky, and it is the only one.** The shell every other route wears (`.page`, a
 *     fixed-height column with its own scrolling child) is kept, so `/docs` behaves like the rest of
 *     the game — the game's own header stays at the top and the *document* scrolls underneath it.
 *     The nav sticks inside that scroll box, which is what makes a seven-section page navigable
 *     without a sidebar.
 *   - **Nothing is typed in twice.** Every figure, address and nav label comes from
 *     `lib/docs-content.js`, which computes them from the modules the contracts were deployed from.
 *     The markup below has no number in it that the game does not pay.
 *   - **The art is slotted.** `ART` in the content module names the file each image wants and the
 *     file it stands in with today; this file renders `artOf(key)` and fixes every box with
 *     `aspect-ratio`, so a piece of art at any size drops into its slot without moving the layout.
 *   - **The wallet control is here like it is everywhere else.** My Portfolio is only reachable
 *     through the menu hanging off that pill, so this route carries one and attaches the menu by
 *     hand — this page renders after hydration, and the module's own DOM scan would find nothing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import BackLink from '../back-link';
import { CHAIN, CONTRACTS, fmt } from '../../lib/pitch-deck';
import {
    ART,
    CONTRACTS_SECTION,
    DRAW,
    FAQ,
    FOOTER,
    HERO,
    LORE,
    NAV,
    NUMBERS,
    POINTS,
    START,
    TICKER,
    artOf,
} from '../../lib/docs-content';

/**
 * `**bold**` and `` `code` `` in a string, as React nodes.
 *
 * Exactly those two markers and no more: the copy in `lib/docs-content.js` stays readable as data,
 * and nothing in it can inject markup into the page. `tools/check-docs.js` walks the same grammar
 * over every string and fails on a marker that does not pair — an unmatched `**` prints literally,
 * on the page whose whole claim is that the numbers are checkable.
 */
function rich(text) {
    const source = String(text ?? '');
    const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    const out = [];
    let last = 0;
    let key = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
        if (match.index > last) out.push(source.slice(last, match.index));
        const token = match[1];
        if (token.startsWith('**')) out.push(<strong key={`b${key++}`}>{token.slice(2, -2)}</strong>);
        else out.push(<code key={`c${key++}`}>{token.slice(1, -1)}</code>);
        last = match.index + token.length;
    }
    if (last < source.length) out.push(source.slice(last));
    return out;
}

/** The ticker's phrases, repeated until the row is at least twice the viewport — the seam of a
 * marquee spelled `translateX(-50%)` has to be off screen, and a strip shorter than the screen
 * cannot hide it. */
const TICKER_REPEATS = 4;

/** One section heading: the loud uppercase one, plus whatever the section says under it. */
function SectionHead({ title, sub, id }) {
    return (
        <>
            <h2 className="docs-h2" id={id}>
                {title}
            </h2>
            {sub ? <p className="docs-sub">{sub}</p> : null}
        </>
    );
}

/** The rule between sections. A bronze line drawn by the stylesheet, with the ornament — when it
 * lands — painted over it. */
function Divider() {
    return <div className="docs-divider" aria-hidden="true" />;
}

export default function DocsClient() {
    // The header's wallet menu, on the control this route renders. `onDisconnect` clears the saved
    // address through the same helper every other route uses, so the header stops showing one.
    const walletPill = useRef(null);
    const scrollBox = useRef(null);
    const [address, setAddress] = useState(null);
    const handleDisconnectRef = useRef(() => {});

    /**
     * Land on the section `/docs#faq` asked for — *after* the page has stopped moving.
     *
     * The browser jumps to a fragment as soon as it has parsed one, and on this page that is far too
     * early: every heading is Cinzel, which swaps in after the first paint, so the document is
     * shorter when the browser measures it and the reader arrives a section or two past where they
     * aimed. Measured: `#draw` landed on the contracts table.
     *
     * So it is re-applied once the fonts have settled — but only if the reader has not taken over. A
     * second jump under somebody who has already started scrolling is worse than landing imprecisely,
     * which is what the four listeners below are for.
     */
    useEffect(() => {
        const id = String(window.location.hash || '').slice(1);
        const box = scrollBox.current;
        const target = id ? document.getElementById(id) : null;
        if (!box || !target) return undefined;

        target.scrollIntoView();
        let taken = false;
        const note = () => {
            taken = true;
        };
        for (const event of ['wheel', 'touchstart', 'keydown', 'mousedown']) {
            box.addEventListener(event, note, { passive: true });
        }
        const settle = () => {
            if (!taken) target.scrollIntoView();
        };
        document.fonts?.ready?.then(settle, settle);
        return () => {
            for (const event of ['wheel', 'touchstart', 'keydown', 'mousedown']) {
                box.removeEventListener(event, note);
            }
        };
    }, []);

    useEffect(() => {
        let live = true;
        import('../../lib/points-client')
            .then((module) => {
                if (live) setAddress(module.savedAddress());
            })
            .catch(() => {});
        return () => {
            live = false;
        };
    }, []);

    const handleDisconnect = useCallback(() => {
        import('../../lib/points-client').then((module) => {
            module.forgetWallet();
            setAddress(null);
        });
    }, []);
    handleDisconnectRef.current = handleDisconnect;

    useEffect(() => {
        const pill = walletPill.current;
        if (!pill) return undefined;
        let cancelled = false;
        const attach = () => {
            if (cancelled || !window.WalletMenu) return false;
            window.WalletMenu.attach(pill, { onDisconnect: handleDisconnectRef.current });
            return true;
        };
        if (!attach()) {
            // `afterInteractive`, so on a cold load the script can land after this effect runs. A
            // few polls beat assuming a load order the framework chooses.
            let tries = 0;
            const timer = setInterval(() => {
                if (attach() || tries++ > 40) clearInterval(timer);
            }, 100);
            return () => {
                cancelled = true;
                clearInterval(timer);
            };
        }
        return () => {
            cancelled = true;
        };
    }, []);

    const pageStyles = (
        <>
            {/* `/theme.css` is the root sheet, not `/css/theme.css`, and it is versioned like every
                other one: an unversioned sheet is a CSS change that never reaches a returning
                reader. */}
            <link rel="stylesheet" href="/theme.css?v=9" />
            <link rel="stylesheet" href="/css/docs.css?v=1" />
            {/* The header's wallet pill gets the menu every other route's control has. */}
            <Script src="/wallet-menu.js?v=1" strategy="afterInteractive" />
            {/* The wallets this page can read: it is a React route, so it has to pull the source in
                itself, and on a phone nothing else injects one. */}
            <Script src="/wallet-source.js?v=3" strategy="afterInteractive" />
        </>
    );

    return (
        <>
            {pageStyles}
            {/* The painting behind the whole document. A fixed layer rather than a `background`
                property on the sections, because `cover` on a 7,000px-tall element zooms the art 6×
                and the usual workaround — `background-attachment: fixed` — is not supported on iOS.
                Sized to the viewport by construction, so it is the same picture everywhere. */}
            <div className="page docs-page" style={{ '--docs-hall': `url(${artOf('hall')})` }}>
                <div className="docs-backdrop" aria-hidden="true" />
                {/* The game's own header, kept so the route looks like the rest of the product
                    rather than like a page from a different site. */}
                <header className="header">
                    <div className="header-left">
                        <BackLink />
                        <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                                window.location.href = '/';
                            }}
                            type="button"
                        >
                            <img src="assets/ui/exit cross.png" className="btn-icon-img" alt="" /> Kingdom Gate
                        </button>
                    </div>
                    <div className="header-title">DOCS</div>
                    <div className="header-actions">
                        {address && (
                            <button
                                className="btn btn-ghost btn-sm wallet-chip"
                                onClick={handleDisconnect}
                                title="Click to disconnect"
                                type="button"
                            >
                                <span className="wallet-chip-dot" aria-hidden="true" />
                                {`${address.slice(0, 6)}…${address.slice(-4)}`}
                            </button>
                        )}
                        <div className="wallet-pill" ref={walletPill}>
                            <span>{address ? 'CONNECTED' : 'CONNECT'}</span>
                        </div>
                    </div>
                </header>

                <div className="docs-scroll" ref={scrollBox}>
                    {/* The nav is the *scrolling box's* own child, not the hero's: sticky is bounded
                        by the parent's box, so a nav parked inside the band would unstick the moment
                        the hero scrolled past — which is exactly when a seven-section page needs it.
                        The band colour lives on both, so it still reads as one block of colour. */}
                    <nav className="docs-nav" aria-label="Documentation sections">
                        <ul className="docs-nav-links">
                            {NAV.slice(0, 3).map((entry) => (
                                <li key={entry.id}>
                                    <a href={`#${entry.id}`}>{entry.label}</a>
                                </li>
                            ))}
                        </ul>
                        <a className="docs-wordmark" href="/">
                            <img className="docs-wordmark-mark" src={artOf('crest')} alt="" width={30} height={32} />
                            <span>{FOOTER.wordmark}</span>
                        </a>
                        <ul className="docs-nav-links docs-nav-links-right">
                            {NAV.slice(3).map((entry) => (
                                <li key={entry.id}>
                                    <a href={`#${entry.id}`}>{entry.label}</a>
                                </li>
                            ))}
                        </ul>
                    </nav>

                    <div className="docs-hero">
                        <img className="docs-hero-mark" src={artOf('hero')} alt="" width={152} height={166} />
                        <p className="docs-kicker">{HERO.kicker}</p>
                        <h1 className="docs-headline">
                            <span className="docs-headline-lead">{HERO.lead}</span>
                            <span className="docs-headline-claim">{HERO.claim}</span>
                        </h1>
                        <p className="docs-hero-sub">{HERO.sub}</p>
                        <p className="docs-available">{HERO.network}</p>
                    </div>

                    {/* The strip. It is a marquee rather than a sentence because it is the page's
                        one piece of decoration, and it stops entirely under `prefers-reduced-motion`
                        — see the stylesheet. */}
                    <div className="docs-ticker" aria-hidden="true">
                        <div className="docs-ticker-track">
                            {Array.from({ length: TICKER_REPEATS }, (_, repeat) => (
                                <div className="docs-ticker-group" key={`group-${repeat}`}>
                                    {TICKER.map((phrase, index) => (
                                        <span className="docs-ticker-item" key={`${repeat}-${phrase}`}>
                                            <span className="docs-ticker-glyph" data-glyph={(index % 3) + 1} />
                                            <span className="docs-ticker-text">{phrase}</span>
                                        </span>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="docs-dark">
                        {/* ---------------------------------------------------------------- lore */}
                        <section className="docs-section" id={LORE.id}>
                            <div className="docs-wrap docs-split">
                                <div className="docs-copy">
                                    <SectionHead title={LORE.title} sub={null} />
                                    {LORE.paragraphs.map((paragraph) => (
                                        <p className="docs-p" key={paragraph.slice(0, 40)}>
                                            {rich(paragraph)}
                                        </p>
                                    ))}
                                    <a className="docs-pill" href={LORE.source.href} target="_blank" rel="noopener noreferrer">
                                        <span className="docs-pill-label">{LORE.source.label}</span>
                                        <span className="docs-pill-sub">{LORE.source.sub}</span>
                                    </a>
                                </div>
                                <figure className="docs-frame">
                                    <img className="docs-frame-art" src={artOf('lore')} alt={LORE.caption} />
                                    <figcaption className="docs-frame-caption">{LORE.caption}</figcaption>
                                </figure>
                            </div>
                        </section>

                        <Divider />

                        {/* --------------------------------------------------------------- start */}
                        <section className="docs-section" id={START.id}>
                            <div className="docs-wrap docs-howto">
                                <img className="docs-tile" src={artOf('start')} alt="" />
                                <div className="docs-howto-copy">
                                    <SectionHead title={START.title} sub={START.sub} />
                                    <ol className="docs-steps">
                                        {START.steps.map((step, index) => (
                                            <li className="docs-step" key={step.title}>
                                                <span className="docs-step-n" aria-hidden="true">
                                                    {index + 1}
                                                </span>
                                                <span className="docs-step-body">
                                                    <span className="docs-step-title">{step.title}</span>
                                                    <span className="docs-step-text">{rich(step.text)}</span>
                                                </span>
                                            </li>
                                        ))}
                                    </ol>
                                    <p className="docs-note">{START.note}</p>
                                </div>
                            </div>
                        </section>

                        <Divider />

                        {/* ------------------------------------------------------------- numbers */}
                        <section className="docs-section" id={NUMBERS.id}>
                            <div className="docs-wrap">
                                <SectionHead title={NUMBERS.title} sub={NUMBERS.sub} />
                                <div className="docs-stats">
                                    {NUMBERS.stats.map((stat) => (
                                        <div className="docs-stat" key={stat.label}>
                                            {/* `docs-stat-value-tba` exists because "To be announced" is
                                                four times the length of the figure this box was sized for.
                                                The modifier is a class rather than an inline font size so the
                                                sheet keeps owning how a long value looks. */}
                                            <span className={`docs-stat-value${stat.tba ? ' docs-stat-value-tba' : ''}`}>
                                                {stat.value}
                                            </span>
                                            <span className="docs-stat-label">{stat.label}</span>
                                            <span className="docs-stat-sub">{stat.sub}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </section>

                        <Divider />

                        {/* -------------------------------------------------------------- points */}
                        <section className="docs-section" id={POINTS.id}>
                            <div className="docs-wrap">
                                <SectionHead title={POINTS.title} sub={POINTS.sub} />
                                <div className="docs-cards">
                                    {POINTS.cards.map((card) => (
                                        <article className="docs-card" key={card.title}>
                                            <h3 className="docs-card-title">{card.title}</h3>
                                            <p className="docs-card-text">{rich(card.text)}</p>
                                        </article>
                                    ))}
                                </div>
                                <a className="docs-cta" href={POINTS.cta.href}>
                                    {POINTS.cta.label}
                                </a>
                            </div>
                        </section>

                        <Divider />

                        {/* ---------------------------------------------------------------- draw */}
                        <section className="docs-section" id={DRAW.id}>
                            <div className="docs-wrap">
                                <div className="docs-band-card" style={{ '--docs-band-art': `url(${artOf('draw')})` }}>
                                    <div className="docs-band-inner">
                                        <h2 className="docs-h2 docs-h2-tight">{DRAW.title}</h2>
                                        <p className="docs-band-body">{rich(DRAW.body)}</p>
                                        <p className="docs-band-note">{rich(DRAW.note)}</p>
                                        <a className="docs-cta" href={DRAW.cta.href}>
                                            {DRAW.cta.label}
                                        </a>
                                    </div>
                                </div>
                            </div>
                        </section>

                        <Divider />

                        {/* ----------------------------------------------------------- contracts */}
                        <section className="docs-section" id={CONTRACTS_SECTION.id}>
                            <div className="docs-wrap">
                                <SectionHead title={CONTRACTS_SECTION.title} sub={CONTRACTS_SECTION.sub} />
                                <ul className="docs-rows">
                                    {CONTRACTS_SECTION.rows.map((row) => {
                                        const address = CONTRACTS[row.key];
                                        return (
                                            <li className="docs-row" key={row.key}>
                                                <span className="docs-row-name">
                                                    <span className="docs-row-title">{row.name}</span>
                                                    <span className="docs-row-role">{row.role}</span>
                                                </span>
                                                <a
                                                    className="docs-row-address"
                                                    href={`${CONTRACTS_SECTION.explorer}${address}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    title={`${address} on the explorer`}
                                                >
                                                    {address}
                                                </a>
                                            </li>
                                        );
                                    })}
                                </ul>
                                <p className="docs-note">
                                    {CONTRACTS_SECTION.note} Chain ID {fmt(CHAIN.id)}, {CHAIN.name}.
                                </p>
                            </div>
                        </section>

                        <Divider />

                        {/* ----------------------------------------------------------------- faq */}
                        <section className="docs-section" id={FAQ.id}>
                            <div className="docs-wrap">
                                <SectionHead title={FAQ.title} sub={null} />
                                <div className="docs-faq">
                                    {FAQ.items.map((item) => (
                                        <details className="docs-faq-item" key={item.q}>
                                            <summary className="docs-faq-q">
                                                <span className="docs-faq-text">{item.q}</span>
                                                <span className="docs-faq-mark" aria-hidden="true" />
                                            </summary>
                                            <p className="docs-faq-a">{rich(item.a)}</p>
                                        </details>
                                    ))}
                                </div>
                            </div>
                        </section>
                    </div>

                    <footer className="docs-footer">
                        <div className="docs-wrap">
                            <p className="docs-footer-word">{FOOTER.wordmark}</p>
                            <ul className="docs-footer-links">
                                {FOOTER.links.map((link) => (
                                    <li key={link.label}>
                                        <a
                                            href={link.href}
                                            {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                                        >
                                            {link.label}
                                        </a>
                                    </li>
                                ))}
                            </ul>
                            <p className="docs-footer-legal">{FOOTER.legal}</p>
                        </div>
                    </footer>
                </div>
            </div>
        </>
    );
}
