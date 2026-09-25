'use client';

/**
 * The pitch deck, as a deck.
 *
 * The content is data (`lib/pitch-deck.js`); this file is the shell that makes it readable — a
 * full-height, scroll-snapped deck with arrow keys, a dot rail, a progress line and a counter, so
 * the thing can actually be *presented* rather than scrolled through like a document.
 *
 * Four decisions worth spelling out:
 *
 *   - **The animation cannot hide the content.** Every reveal lives behind `.pitch-deck.is-ready`,
 *     a class this component adds after it mounts. If the JavaScript never runs — a crawler, a
 *     reader with scripting off, a bundling mistake — the deck renders as a plain document with
 *     every slide visible, rather than as twelve blank panels.
 *   - **Native scroll does the scrolling.** Slides are `scroll-snap-align` children of one overflow
 *     container, so touch, trackpad, keyboard and the arrow buttons all move the same thing, and
 *     mobile swipe works without a gesture library. What the component adds is the *reporting*: the
 *     active index comes from `scrollTop`, and the dots and counter follow it.
 *   - **The numbers do not come from here.** `lib/pitch-deck.js` builds every figure out of the same
 *     modules the contracts were deployed from; a slide that quoted a budget the vault does not
 *     release would be a bug in the repository, and `tools/check-pitch.js` fails on one.
 *   - **One live read.** The growth slide asks the deployment for today's draw and counts down to
 *     the close from the instant the *server* built, not from this machine's clock. If the read
 *     fails the slide says so instead of showing a zero.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import BackLink from '../back-link';
import { forgetWallet, savedAddress, shortAddress } from '../../lib/points-client';
import { CHAIN, DECK, LINKS, MODEL, SLIDES, fmt } from '../../lib/pitch-deck';
import { DRAW_CAPSULE, DRAW_SIZE, nextDrawAt } from '../../lib/points-config';

/** Two units and a colon: `06:42:11`, or `42:11` under an hour. */
function formatLeft(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const pad = (n) => String(n).padStart(2, '0');
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * `**bold**`, `*italic*` and `` `code` `` in a string, as React nodes.
 *
 * Exactly those three, and deliberately no more: the copy in `lib/pitch-deck.js` stays readable as
 * data, and nothing in this deck can inject markup into a page. `tools/check-pitch.js` walks the
 * same grammar over every string and fails on a marker that does not pair — which is a real
 * failure and not a hypothetical one: an unmatched `*` prints literally, on a slide about rigour.
 */
function rich(text) {
    const source = String(text ?? '');
    // Bold before italic, and ** before *: the alternation is tried left to right, so `**x**` can
    // never be read as an italic that swallowed one asterisk on each side.
    const pattern = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g;
    const out = [];
    let last = 0;
    let match;
    let key = 0;
    while ((match = pattern.exec(source)) !== null) {
        if (match.index > last) out.push(source.slice(last, match.index));
        const token = match[1];
        if (token.startsWith('**')) out.push(<strong key={`b${key++}`}>{token.slice(2, -2)}</strong>);
        else if (token.startsWith('*')) out.push(<em key={`i${key++}`}>{token.slice(1, -1)}</em>);
        else out.push(<code key={`c${key++}`}>{token.slice(1, -1)}</code>);
        last = match.index + token.length;
    }
    if (last < source.length) out.push(source.slice(last));
    return out;
}

/** One live read of the daily draw, rendered as its own block. */
function LiveDrawBlock() {
    const [draw, setDraw] = useState(null);
    const [failed, setFailed] = useState(false);
    const [left, setLeft] = useState(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/points/giveaway', { cache: 'no-store' });
                const body = await res.json();
                if (cancelled) return;
                if (res.ok && body) setDraw(body);
                else setFailed(true);
            } catch {
                if (!cancelled) setFailed(true);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // The instant comes from the API (`nextDrawAt`), built on the server. A countdown from the
    // browser's own midnight would be a countdown to a different moment on a machine that is a
    // minute out — and this one closes a competition.
    const closesAt = draw?.nextDrawAt || nextDrawAt();
    useEffect(() => {
        const tick = () => setLeft(formatLeft(Date.parse(closesAt) - Date.now()));
        tick();
        const timer = setInterval(tick, 1000);
        return () => clearInterval(timer);
    }, [closesAt]);

    const size = Number(draw?.size) || DRAW_SIZE;
    const prize = draw?.capsule?.name || DRAW_CAPSULE.name;

    return (
        <div className="pitch-live">
            <div className="pitch-live-head">
                <span className="pitch-live-dot" aria-hidden="true" />
                <span className="pitch-live-title">Live, read from this deployment</span>
                <span className="pitch-live-source">
                    {failed ? 'the read did not answer' : 'GET /api/points/giveaway'}
                </span>
            </div>
            <div className="pitch-live-cells">
                <div className="pitch-live-cell">
                    <span className="pitch-live-label">Today&rsquo;s draw</span>
                    <span className="pitch-live-value">{draw?.day ? draw.day : '—'}</span>
                    <span className="pitch-live-sub">
                        {draw?.dayNumber ? `day ${fmt(draw.dayNumber)} of the program` : 'reading the board…'}
                    </span>
                </div>
                <div className="pitch-live-cell">
                    <span className="pitch-live-label">Prize</span>
                    <span className="pitch-live-value">{prize}</span>
                    <span className="pitch-live-sub">
                        {fmt(size)} to the day&rsquo;s top {fmt(size)}
                    </span>
                </div>
                <div className="pitch-live-cell is-key">
                    <span className="pitch-live-label">Closes in</span>
                    <span className="pitch-live-value">{left === null ? '—' : left}</span>
                    <span className="pitch-live-sub">00:00 UTC, then the board resets</span>
                </div>
            </div>
            <p className="pitch-live-fine">
                The countdown is computed from the instant the API builds on the server, not from this
                machine&rsquo;s clock. The draw settles on the next page read of the board — the cron that also
                calls it is a promptness feature, never a correctness one.
            </p>
        </div>
    );
}

/** One block of one slide. A slide is a list of these; adding a slide touches no code. */
function Block({ block }) {
    switch (block.kind) {
        case 'cover':
            return (
                <div className="pitch-cover">
                    <img className="pitch-cover-crest" src="/assets/ui/sword-crest.png" alt="" />
                    <p className="pitch-cover-word">{DECK.wordmark}</p>
                    <h1 className="pitch-cover-title">{DECK.title}</h1>
                    <p className="pitch-cover-tagline">{DECK.tagline}</p>
                    <p className="pitch-cover-meta">
                        {DECK.version} · {DECK.network}
                    </p>
                </div>
            );
        case 'kicker':
            return <p className="pitch-kicker">{block.text}</p>;
        case 'title':
            return <h2 className="pitch-title">{rich(block.text)}</h2>;
        case 'lede':
            return <p className="pitch-lede">{rich(block.text)}</p>;
        case 'chips':
            return (
                <ul className="pitch-chips">
                    {block.items.map((item) => (
                        <li className="pitch-chip" key={item}>
                            {item}
                        </li>
                    ))}
                </ul>
            );
        case 'stats':
            return (
                <div className="pitch-stats">
                    {block.items.map((item) => (
                        <div className="pitch-stat" key={`${item.label}-${item.value}`}>
                            <span className="pitch-stat-value">{item.value}</span>
                            <span className="pitch-stat-label">{item.label}</span>
                            {item.sub ? <span className="pitch-stat-sub">{rich(item.sub)}</span> : null}
                        </div>
                    ))}
                </div>
            );
        case 'cards':
            return (
                <div className="pitch-cards">
                    {block.items.map((item) => (
                        <article className="pitch-card" key={item.title}>
                            {item.badge ? <span className="pitch-card-badge">{item.badge}</span> : null}
                            <h3 className="pitch-card-title">{item.title}</h3>
                            <p className="pitch-card-text">{rich(item.text)}</p>
                        </article>
                    ))}
                </div>
            );
        case 'steps':
            return (
                <ol className="pitch-steps">
                    {block.items.map((item, index) => (
                        <li className="pitch-step" key={item.title}>
                            <span className="pitch-step-num" aria-hidden="true">
                                {String(index + 1).padStart(2, '0')}
                            </span>
                            <div className="pitch-step-body">
                                <h3 className="pitch-step-title">{item.title}</h3>
                                <p className="pitch-step-text">{rich(item.text)}</p>
                            </div>
                        </li>
                    ))}
                </ol>
            );
        case 'table':
            return (
                <figure className="pitch-table-wrap">
                    <table className="pitch-table">
                        <thead>
                            <tr>
                                {block.head.map((cell) => (
                                    <th key={cell} scope="col">
                                        {cell}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {block.rows.map((row, rowIndex) => (
                                <tr key={`row-${rowIndex}`}>
                                    {row.map((cell, cellIndex) =>
                                        cellIndex === 0 ? (
                                            <th key={`c-${cellIndex}`} scope="row">
                                                {rich(cell)}
                                            </th>
                                        ) : (
                                            <td key={`c-${cellIndex}`}>{rich(cell)}</td>
                                        ),
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {block.caption ? (
                        <figcaption className="pitch-table-caption">{rich(block.caption)}</figcaption>
                    ) : null}
                </figure>
            );
        case 'quote':
            return (
                <blockquote className="pitch-quote">
                    <p className="pitch-quote-text">{rich(block.text)}</p>
                </blockquote>
            );
        case 'code':
            return (
                <figure className="pitch-code">
                    {block.label ? <figcaption className="pitch-code-label">{block.label}</figcaption> : null}
                    <pre className="pitch-code-pre">{block.lines.join('\n')}</pre>
                </figure>
            );
        case 'note':
            return <p className={`pitch-note ${block.isWarn ? 'is-warn' : ''}`}>{rich(block.text)}</p>;
        case 'live':
            return <LiveDrawBlock />;
        case 'links':
            return (
                <ul className="pitch-links">
                    {block.items.map((item) => (
                        <li className="pitch-link-item" key={item.href}>
                            <a className="pitch-link" href={item.href} target="_blank" rel="noopener noreferrer">
                                <span className="pitch-link-label">{item.label}</span>
                                <span className="pitch-link-sub">{item.sub}</span>
                            </a>
                        </li>
                    ))}
                </ul>
            );
        default:
            return null;
    }
}

export default function PitchClient() {
    const deckRef = useRef(null);
    const slideRefs = useRef([]);
    const activeRef = useRef(0);
    const rafRef = useRef(0);
    const [active, setActive] = useState(0);
    const [ready, setReady] = useState(false);
    const total = SLIDES.length;

    // ------------------------------------------------------------------ moving through the deck
    const go = useCallback(
        (index) => {
            const next = Math.max(0, Math.min(total - 1, index));
            const slide = slideRefs.current[next];
            if (slide) slide.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
        [total],
    );

    // The active slide is whatever the container has scrolled to, so touch, trackpad, keyboard and
    // the buttons all report the same way. `rAF`-throttled because a scroll fires faster than React
    // should re-render.
    //
    // Which slide that is comes from the *nearest slide*, not from `scrollTop / clientHeight`: a
    // dense slide (the economy, the unit economics) is taller than the screen, so the divide stops
    // lining up with the slide index the moment one of them overflows — the counter would skip a
    // number and the dot rail would highlight the wrong dot. Comparing offsets is arithmetic on the
    // layout the browser has already done, and it is right for any mix of slide heights.
    const report = useCallback(() => {
        const deck = deckRef.current;
        if (!deck) return;
        const offsetOf = (index) => slideRefs.current[index]?.offsetTop ?? Number.POSITIVE_INFINITY;
        let index = 0;
        for (let slide = 1; slide < total; slide += 1) {
            if (Math.abs(offsetOf(slide) - deck.scrollTop) <= Math.abs(offsetOf(index) - deck.scrollTop)) index = slide;
        }
        if (index !== activeRef.current) {
            activeRef.current = index;
            setActive(index);
            // A deck is a link: `#7` in the address bar is a reload that lands on the same slide.
            try {
                window.history.replaceState(null, '', `#${index + 1}`);
            } catch {
                /* a hash is a nicety, not a requirement */
            }
        }
    }, [total]);

    const onScroll = useCallback(() => {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(report);
    }, [report]);

    useEffect(() => {
        setReady(true);
        // Land on the slide the hash names, if it names one — instantly, because a smooth scroll
        // across eleven slides reads as the page still loading.
        const wanted = Number.parseInt(String(window.location.hash).replace('#', ''), 10);
        if (Number.isFinite(wanted) && wanted >= 1 && wanted <= total) {
            const deck = deckRef.current;
            const slide = slideRefs.current[wanted - 1];
            if (deck && slide) {
                deck.scrollTop = slide.offsetTop;
                activeRef.current = wanted - 1;
                setActive(wanted - 1);
            }
        }
        return () => cancelAnimationFrame(rafRef.current);
    }, [total]);

    const toggleFullscreen = useCallback(() => {
        try {
            if (document.fullscreenElement) document.exitFullscreen();
            else document.documentElement.requestFullscreen();
        } catch {
            /* full screen is a nicety: Safari on a phone refuses it, and the deck still works */
        }
    }, []);

    // Keyboard, because a deck that cannot be presented from the keyboard is a document. Space is
    // left to a focused control — the buttons in the nav are reachable by tab, and stealing their
    // activation would make the deck unusable exactly for someone driving it from the keyboard.
    useEffect(() => {
        const onKeyDown = (event) => {
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            const target = event.target;
            const tag = (target && target.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable)) return;
            const key = event.key;
            const forward = key === 'ArrowRight' || key === 'ArrowDown' || key === 'PageDown' || key === ' ';
            const back = key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp';
            if (forward && key === ' ' && target && target.closest && target.closest('button, a')) return;
            if (forward) {
                event.preventDefault();
                go(activeRef.current + 1);
            } else if (back) {
                event.preventDefault();
                go(activeRef.current - 1);
            } else if (key === 'Home') {
                event.preventDefault();
                go(0);
            } else if (key === 'End') {
                event.preventDefault();
                go(total - 1);
            } else if (key === 'f' || key === 'F') {
                toggleFullscreen();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [go, total, toggleFullscreen]);

    // ------------------------------------------------------------------------ the wallet control
    // Every route in the game carries the same pill in the same corner, because My Portfolio is only
    // reachable through the menu hanging off it — `tools/check-wallet-menu.js` reads the route list
    // out of `app/` and fails a new page that omits it. The balance is a server read; the browser
    // contributes an address and nothing else.
    const [address, setAddress] = useState(null);
    const [balance, setBalance] = useState(null);
    const walletPill = useRef(null);
    const handleDisconnectRef = useRef(() => {});

    useEffect(() => setAddress(savedAddress()), []);

    useEffect(() => {
        if (!address) {
            setBalance(null);
            return undefined;
        }
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`/api/wallet/balance?address=${address}`, { cache: 'no-store' });
                const body = await res.json();
                if (!cancelled) setBalance(res.ok && Number.isFinite(Number(body?.amount)) ? Number(body.amount) : null);
            } catch {
                if (!cancelled) setBalance(null);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [address]);

    const handleDisconnect = () => {
        forgetWallet();
        setAddress(null);
    };
    handleDisconnectRef.current = handleDisconnect;

    // Attached by hand: this route mounts after hydration, so the module's own DOM scan runs before
    // the pill exists.
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
            {/* `/theme.css` is the root sheet, not `/css/theme.css`: the tokens every rule below reads
                live in it, and the wrong path 404s silently — the page still renders, with no colours
                at all, and every DOM assertion still passes. */}
            <link rel="stylesheet" href="/theme.css?v=8" />
            <link rel="stylesheet" href="/css/pitch.css?v=1" />
            {/* The header's wallet pill carries the same menu every other route's control has. */}
            <Script src="/wallet-source.js?v=3" strategy="afterInteractive" />
            <Script src="/wallet-menu.js?v=1" strategy="afterInteractive" />
        </>
    );

    return (
        <>
            {pageStyles}
            <div className="page pitch-page">
                <header className="header">
                    <div className="header-left">
                        <BackLink />
                        <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                                window.location.href = '/';
                            }}
                        >
                            <img src="assets/ui/exit cross.png" className="btn-icon-img" alt="" /> Kingdom Gate
                        </button>
                    </div>
                    <div className="header-title">PITCH DECK</div>
                    <div className="header-actions">
                        <span className="pitch-stamp">
                            v1 · {String(CHAIN.id)}
                        </span>
                        <button className="btn btn-ghost btn-sm" onClick={() => window.print()} type="button">
                            Save as PDF
                        </button>
                        {address && (
                            <button
                                className="btn btn-ghost btn-sm wallet-chip"
                                onClick={handleDisconnect}
                                title="Click to disconnect"
                                type="button"
                            >
                                <span className="wallet-chip-dot" aria-hidden="true" />
                                {shortAddress(address)}
                            </button>
                        )}
                        <div className="wallet-pill" ref={walletPill}>
                            <span>{address ? (balance === null ? '— DNG' : `${fmt(balance)} DNG`) : 'CONNECT'}</span>
                        </div>
                    </div>
                </header>

                <div className="pitch-stage">
                    <div className="pitch-progress" aria-hidden="true">
                        <span className="pitch-progress-fill" style={{ width: `${((active + 1) / total) * 100}%` }} />
                    </div>

                    <div
                        className={`pitch-deck ${ready ? 'is-ready' : ''}`}
                        ref={deckRef}
                        onScroll={onScroll}
                        tabIndex={-1}
                        aria-label="Dungeon Knights pitch deck"
                    >
                        {SLIDES.map((slide, index) => (
                            <section
                                className={`pitch-slide ${index === active ? 'is-live' : ''}`}
                                id={`s${index + 1}`}
                                key={slide.id}
                                data-slide={index + 1}
                                ref={(node) => {
                                    slideRefs.current[index] = node;
                                }}
                                aria-label={`Slide ${index + 1} of ${total}: ${slide.nav}`}
                            >
                                <div className="pitch-inner">
                                    {slide.blocks.map((block, blockIndex) => (
                                        <Block block={block} key={`${slide.id}-${blockIndex}`} />
                                    ))}
                                </div>
                                <footer className="pitch-slide-foot">
                                    <span className="pitch-slide-mark">{DECK.wordmark}</span>
                                    <span className="pitch-slide-index">
                                        {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')} · {slide.nav}
                                    </span>
                                </footer>
                            </section>
                        ))}
                    </div>

                    <nav className="pitch-nav" aria-label="Deck navigation">
                        <button
                            className="btn btn-ghost btn-sm pitch-nav-arrow"
                            onClick={() => go(active - 1)}
                            disabled={active === 0}
                            aria-label="Previous slide"
                            type="button"
                        >
                            ◀
                        </button>
                        <ol className="pitch-dots">
                            {SLIDES.map((slide, index) => (
                                <li className="pitch-dot-item" key={`dot-${slide.id}`}>
                                    <button
                                        className={`pitch-dot ${index === active ? 'is-on' : ''} ${
                                            index < active ? 'is-past' : ''
                                        }`}
                                        onClick={() => go(index)}
                                        aria-label={`Slide ${index + 1}: ${slide.nav}`}
                                        aria-current={index === active ? 'true' : undefined}
                                        title={`${index + 1}. ${slide.nav}`}
                                        type="button"
                                    >
                                        <span className="pitch-dot-label">{index + 1}</span>
                                    </button>
                                </li>
                            ))}
                        </ol>
                        <button
                            className="btn btn-ghost btn-sm pitch-nav-arrow"
                            onClick={() => go(active + 1)}
                            disabled={active === total - 1}
                            aria-label="Next slide"
                            type="button"
                        >
                            ▶
                        </button>
                        <span className="pitch-count">
                            {String(active + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
                        </span>
                        <span className="pitch-hint">
                            ← → to move · F full screen · {fmt(MODEL.budget)} $DNG a week
                        </span>
                        <a className="pitch-hint-link" href={LINKS.code} target="_blank" rel="noopener noreferrer">
                            Source
                        </a>
                    </nav>
                </div>
            </div>
        </>
    );
}
