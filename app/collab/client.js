'use client';

/**
 * `/collab` — the terms of a collaboration, and the tab a partner's community registers in.
 *
 * The page is read in the order a partner reads it: what we offer, what the prizes actually do, what
 * we ask of them, and only then the form. That is why the giveaways are at the bottom rather than at
 * the top — a registration button that arrives before the reason to press it is a button somebody
 * presses for the wrong reason.
 *
 * Five decisions are worth spelling out:
 *
 *   - **The giveaway list is the server's, not this file's.** The projects come down as a prop,
 *     read out of the store by `page.js`: the pinned ones, plus every request the owner approved. A
 *     project therefore appears on this tab by being approved, not by being pasted into a constant —
 *     which is also why the list cannot be a build-time one, and why the page is dynamic.
 *   - **It types no numbers.** Every figure on the page — capsule odds, supply, hash power, the
 *     raffle, open prices and the reward table — is imported from `lib/collab-content.js`, which
 *     reads it out of the modules the reward contracts were deployed from. A partnership page is
 *     exactly where a number gets copied once and then quietly stops being true.
 *   - **The store is the answer, not the browser.** Whether a wallet is registered is asked of
 *     `/api/collab` on every load. A page that trusted `localStorage` would tell somebody who cleared
 *     their data that they were never in, and would tell the next person on a shared device that they
 *     are.
 *   - **No running total is printed**, here or anywhere else — the same rule the landing page and the
 *     Genesis waitlist follow. The store keeps the counts for the export; the page shows a wallet its
 *     own state and nothing about anybody else's.
 *   - **An entry is proven, not typed.** The address comes from a connected wallet and is signed for
 *     through the Points Program's own session before the route will file it, so nobody can enter a
 *     wallet they do not hold. That is the difference between this tab and the waitlist form.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import BackLink from '../back-link';
import CollabSubmission from './submission';
import {
    COLLAB_STEPS,
    CONTACT,
    HERO,
    NFT_USE,
    OFFERS,
    PARTNER_TERMS,
    PROJECTS_EMPTY,
} from '../../lib/collab-content';
// The wallet module, and the one way in: connect, sign, then act. Shared with the submission section
// below, which needs exactly the same proof for exactly the same reason.
import { ensureSession, tokenIfSigned, walletModule } from '../../lib/collab-session';

/** One project's registration state, filed by slug so a tab switch cannot show the wrong one. */
const EMPTY_STATE = { registered: false, position: null };

/**
 * What a project's chip shows before it has a picture.
 *
 * A project is on the tab the moment it is approved, and its picture is uploaded afterwards, so
 * "no picture yet" is a state the tab has to have an answer for. The alternative — falling back to
 * a stock image or to ours — would put a face on somebody else's giveaway.
 */
function initialOf(name) {
    const letter = String(name || '').trim().charAt(0).toUpperCase();
    return letter || '?';
}

export default function CollabClient({ projects = [] }) {
    const walletPill = useRef(null);
    /** Set while the click's own path is mid-flight, so the Privy event does not start it twice. */
    const pending = useRef(false);

    const [address, setAddress] = useState(null);
    const [signed, setSigned] = useState(false);
    const [active, setActive] = useState(projects[0]?.slug || null);
    const [bySlug, setBySlug] = useState({});
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);

    const state = bySlug[active] || EMPTY_STATE;

    /** What `GET /api/collab` says about one project, for the wallet signed in right now. */
    const read = useCallback(async (slug) => {
        if (!slug) return null;
        const token = await tokenIfSigned();
        const res = await fetch(`/api/collab?project=${encodeURIComponent(slug)}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            cache: 'no-store',
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) return null;
        setBySlug((prev) => ({
            ...prev,
            [slug]: { registered: body.registered === true, position: body.position ?? null },
        }));
        return body;
    }, []);

    // Who is here, and does the store know them. The session is read rather than assumed: an address
    // in storage with no token is a wallet that connected once and never signed, which is exactly the
    // case the register button has to handle.
    useEffect(() => {
        let live = true;
        (async () => {
            const mod = await walletModule();
            if (!live) return;
            const session = mod.readSession();
            const who = session?.address || mod.savedAddress();
            setAddress(who || null);
            setSigned(!!session);
            if (projects[0]) await read(projects[0].slug);
        })().catch(() => {});
        return () => { live = false; };
        // `projects` is the server's list and is read once at mount; a new list means a new render
        // from the server, which re-runs this and re-reads the entry state with it.
    }, [read, projects]);

    // The header's wallet pill gets the menu every other route's control has, attached by hand
    // because this route renders after hydration and a script that scans the DOM finds nothing.
    useEffect(() => {
        const pill = walletPill.current;
        if (!pill || typeof window === 'undefined') return undefined;
        let cancelled = false;
        const attach = () => {
            if (cancelled || !window.WalletMenu) return false;
            window.WalletMenu.attach(pill, {
                onDisconnect: () => {
                    walletModule().then((mod) => mod.forgetWallet()).catch(() => {});
                    setAddress(null);
                    setSigned(false);
                    setBySlug({});
                },
            });
            return true;
        };
        if (!attach()) {
            let tries = 0;
            const timer = setInterval(() => {
                if (attach() || tries++ > 40) clearInterval(timer);
            }, 100);
            return () => { cancelled = true; clearInterval(timer); };
        }
        return () => { cancelled = true; };
    }, []);

    /** `POST /api/collab` with the signed session. The token is the entry's only credential. */
    const file = useCallback(async (slug, token) => {
        const res = await fetch('/api/collab', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ project: slug, source: 'collab' }),
        });
        const body = await res.json().catch(() => null);
        return { res, body };
    }, []);

    /**
     * Sign, then register. Signing is what makes the entry the wallet's rather than a typed address;
     * a session that has expired is replaced rather than reported, because a second signature is a
     * smaller ask than "something went wrong".
     */
    const complete = useCallback(async (who, slug) => {
        const session = await ensureSession({ address: who, onStep: setBusy });
        // Nothing came back: the Privy login is still open, or it was closed.
        if (!session) return false;
        setSigned(true);

        setBusy('register');
        let { res, body } = await file(slug, session.token);
        if (res.status === 401) {
            // The session went under us — expired, or signed with a secret a redeploy replaced. One
            // more signature is the whole fix, and it is cheaper than an error the visitor cannot act on.
            const again = await ensureSession({ address: who, force: true, onStep: setBusy });
            if (!again) return false;
            ({ res, body } = await file(slug, again.token));
        }
        if (!res.ok) {
            if (body?.code === 'signed-out') setSigned(false);
            throw new Error(body?.error || 'That registration did not go through. Try again in a moment.');
        }

        setBySlug((prev) => ({
            ...prev,
            [slug]: { registered: true, position: body?.position ?? null },
        }));
        setNotice(
            body?.alreadyRegistered
                ? 'This wallet was already registered for that giveaway — you are in.'
                : 'Wallet registered. You are in the running for that giveaway.'
        );
    }, [file]);

    const register = useCallback(async (slug = active) => {
        if (busy || !slug) return;
        setError(null);
        setNotice(null);
        try {
            let who = address;
            if (!who) {
                setBusy('connect');
                pending.current = true;
                const mod = await walletModule();
                who = await mod.connectWallet();
                // Nothing came back: the Privy login is still open, or it was closed. The event
                // below picks the flow up if it completes; both states are visible on screen.
                if (!who) return;
                setAddress(who);
            }
            await complete(who, slug);
        } catch (e) {
            if (e?.code === 4001 || /rejected|denied/i.test(e?.message || '')) {
                setNotice('Signature declined. Press register again when you are ready.');
            } else {
                setError(e?.message || 'The registration could not be completed.');
            }
        } finally {
            pending.current = false;
            setBusy(null);
        }
    }, [active, address, busy, complete]);

    // A Privy sign-in that lands *after* the click is what finishes the job — the click's own path
    // returns nothing while the conversation is still open. Only for a flow this page started:
    // `pending` is the difference between finishing a registration and registering somebody who
    // merely arrived signed in.
    useEffect(() => {
        const onAuthChanged = async (event) => {
            const detail = event?.detail || {};
            if (!detail.authenticated || !detail.address || !pending.current || !active) return;
            setAddress(detail.address);
            try {
                await complete(detail.address, active);
            } catch (e) {
                setError(e?.message || 'The registration could not be completed.');
            } finally {
                pending.current = false;
                setBusy(null);
            }
        };
        window.addEventListener('privyAuthChanged', onAuthChanged);
        return () => window.removeEventListener('privyAuthChanged', onAuthChanged);
    }, [active, complete]);

    const handleTab = (slug) => {
        if (slug === active || busy) return;
        setActive(slug);
        setError(null);
        setNotice(null);
        if (!bySlug[slug]) read(slug).catch(() => {});
    };

    const label = (() => {
        if (busy === 'connect') return 'Connecting…';
        if (busy === 'sign') return 'Waiting for signature…';
        if (busy === 'register') return 'Registering…';
        if (state.registered) return 'Registered ✓';
        if (!address) return 'Connect wallet & register';
        if (!signed) return 'Sign in & register';
        return 'Register this wallet';
    })();

    const project = projects.find((entry) => entry.slug === active) || projects[0] || null;

    return (
        <>
            <link rel="stylesheet" href="/theme.css?v=9" />
            <link rel="stylesheet" href="/css/collab.css?v=4" />
            {/* The wallets this page can connect: it is a React route, so it has to pull the source
                in itself — and the menu module, which turns the header pill into the menu every
                other route has. */}
            <Script src="/wallet-menu.js?v=1" strategy="afterInteractive" />
            <Script src="/wallet-source.js?v=3" strategy="afterInteractive" />

            <div className="collab-page">
                <header className="collab-head">
                    <BackLink />
                    <div className="collab-head-titles">
                        <h1 className="collab-title">Collab</h1>
                        <p className="collab-sub">Giveaways with projects we like — and the terms we run them on.</p>
                    </div>
                    <div className="collab-wallet">
                        <div className="wallet-pill" ref={walletPill} id="collabWallet">
                            <span>{address ? 'CONNECTED' : 'CONNECT'}</span>
                        </div>
                    </div>
                </header>

                {error && (
                    <div className="collab-banner is-error" role="alert">
                        <span>{error}</span>
                        <button className="collab-banner-x" onClick={() => setError(null)} aria-label="Dismiss" type="button">✕</button>
                    </div>
                )}
                {notice && (
                    <div className="collab-banner is-notice" role="status">
                        <span>{notice}</span>
                        <button className="collab-banner-x" onClick={() => setNotice(null)} aria-label="Dismiss" type="button">✕</button>
                    </div>
                )}

                <main className="collab-main">
                    <section className="collab-hero">
                        <p className="collab-kicker">{HERO.kicker}</p>
                        <h2 className="collab-headline">{HERO.title}</h2>
                        <p className="collab-lead">{HERO.lead}</p>
                        <p className="collab-hero-sub">{HERO.sub}</p>
                        <a className="collab-jump" href="#projects">See the live giveaways ↓</a>
                    </section>

                    <section className="collab-section" id="offer">
                        <div className="collab-section-head">
                            <p className="collab-eyebrow">The offer</p>
                            <h2 className="collab-section-title">What we offer your community</h2>
                            <p className="collab-section-sub">
                                Two prizes, and a collaboration can be built from either or both.
                            </p>
                        </div>
                        <div className="collab-offers">
                            {OFFERS.map((offer) => (
                                <article className="collab-offer" key={offer.key}>
                                    <div className="collab-offer-head">
                                        <h3 className="collab-offer-title">{offer.title}</h3>
                                        <span className="collab-offer-tag">{offer.tag}</span>
                                    </div>
                                    <p className="collab-offer-summary">{offer.summary}</p>
                                    <ul className="collab-list">
                                        {offer.points.map((point) => (
                                            <li className="collab-list-item" key={point}>{point}</li>
                                        ))}
                                    </ul>
                                    <p className="collab-fine">{offer.fine}</p>
                                </article>
                            ))}
                        </div>
                    </section>

                    <section className="collab-section" id="use">
                        <div className="collab-section-head">
                            <p className="collab-eyebrow">The prizes</p>
                            <h2 className="collab-section-title">What these NFTs are used for</h2>
                            <p className="collab-section-sub">
                                Every figure below is the number the reward contracts were deployed with.
                            </p>
                        </div>
                        <div className="collab-uses">
                            {NFT_USE.map((use) => (
                                <article className="collab-use" key={use.key}>
                                    <h3 className="collab-use-title">{use.title}</h3>
                                    <p className="collab-use-lede">{use.lede}</p>
                                    <dl className="collab-points">
                                        {use.points.map((point) => (
                                            <div className="collab-point" key={point.label}>
                                                <dt className="collab-point-label">{point.label}</dt>
                                                <dd className="collab-point-text">{point.text}</dd>
                                            </div>
                                        ))}
                                    </dl>
                                </article>
                            ))}
                        </div>
                    </section>

                    <section className="collab-section" id="terms">
                        <div className="collab-section-head">
                            <p className="collab-eyebrow">Your side</p>
                            <h2 className="collab-section-title">{PARTNER_TERMS.title}</h2>
                            <p className="collab-section-sub">{PARTNER_TERMS.sub}</p>
                        </div>
                        <div className="collab-terms">
                            {PARTNER_TERMS.items.map((item) => (
                                <div className="collab-term" key={item.title}>
                                    <h3 className="collab-term-title">{item.title}</h3>
                                    <p className="collab-term-text">{item.text}</p>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="collab-section" id="how">
                        <div className="collab-section-head">
                            <p className="collab-eyebrow">End to end</p>
                            <h2 className="collab-section-title">How a collab runs</h2>
                        </div>
                        <ol className="collab-steps">
                            {COLLAB_STEPS.map((step, index) => (
                                <li className="collab-step" key={step.title}>
                                    <span className="collab-step-n" aria-hidden="true">{index + 1}</span>
                                    <span className="collab-step-body">
                                        <span className="collab-step-title">{step.title}</span>
                                        <span className="collab-step-text">{step.text}</span>
                                    </span>
                                </li>
                            ))}
                        </ol>
                    </section>

                    <section className="collab-section collab-projects" id="projects">
                        <div className="collab-section-head">
                            <p className="collab-eyebrow">Register</p>
                            <h2 className="collab-section-title">Collab giveaways</h2>
                            <p className="collab-section-sub">
                                Connect a wallet and register for the giveaway you want to enter. One wallet,
                                one entry per project.
                            </p>
                        </div>

                        <div className="collab-tabs" role="tablist" aria-label="Collab giveaway projects">
                            {projects.map((entry) => (
                                <button
                                    key={entry.slug}
                                    type="button"
                                    role="tab"
                                    aria-selected={entry.slug === active}
                                    className={`collab-tab${entry.slug === active ? ' is-active' : ''}`}
                                    onClick={() => handleTab(entry.slug)}
                                >
                                    {entry.avatar ? (
                                        <img className="collab-tab-pfp" src={entry.avatar} alt="" width={28} height={28} />
                                    ) : (
                                        <span className="collab-tab-initials" aria-hidden="true">{initialOf(entry.name)}</span>
                                    )}
                                    <span className="collab-tab-text">
                                        <span className="collab-tab-name">{entry.name}</span>
                                        <span className="collab-tab-handle">@{entry.handle}</span>
                                    </span>
                                </button>
                            ))}
                        </div>

                        {!projects.length && (
                            <p className="collab-projects-empty">{PROJECTS_EMPTY}</p>
                        )}

                        {project && (
                            <article className={`collab-project${state.registered ? ' is-registered' : ''}`}>
                                <div className="collab-project-head">
                                    {project.avatar ? (
                                        <img className="collab-project-pfp" src={project.avatar} alt={`${project.name} on X`} width={72} height={72} />
                                    ) : (
                                        <span className="collab-project-initials" aria-hidden="true">{initialOf(project.name)}</span>
                                    )}
                                    <div className="collab-project-meta">
                                        <h3 className="collab-project-name">{project.name}</h3>
                                        <a className="collab-project-handle" href={project.url} target="_blank" rel="noopener noreferrer">
                                            @{project.handle}
                                        </a>
                                        <p className="collab-project-prize">{project.prize}</p>
                                    </div>
                                    <span className={`collab-status${state.registered ? ' is-in' : ''}`}>
                                        {state.registered ? 'Registered' : project.status === 'open' ? 'Open' : 'Closed'}
                                    </span>
                                </div>
                                <p className="collab-project-blurb">{project.blurb}</p>
                                <div className="collab-register">
                                    <button
                                        type="button"
                                        className="btn btn-primary btn-md collab-register-btn"
                                        onClick={() => register(project.slug)}
                                        disabled={!!busy || state.registered}
                                    >
                                        {label}
                                    </button>
                                    <p className="collab-register-note">
                                        {state.registered
                                            ? 'This wallet is on the entry list. Prizes are drawn from these wallets and announced on X.'
                                            : 'You will be asked to sign once — no gas, no transaction. Signing is what puts the wallet on the entry list, so nobody can enter an address they do not hold.'}
                                    </p>
                                </div>
                            </article>
                        )}
                    </section>

                    {/* The request form sits above the contact block on purpose: it is the way in, and
                        the DM and the Discord invite are what to use when the form cannot say it. */}
                    <CollabSubmission address={address} signed={signed} onAddress={setAddress} />

                    <section className="collab-section collab-contact" id="contact">
                        <h2 className="collab-section-title">Want your project here?</h2>
                        <p className="collab-contact-copy">
                            The form above is the fastest way — send the giveaway details, the prize, the number and
                            your preferred dates from the account you post with. We add the project tab, you post the
                            collab, and we share it. If anything about it needs a conversation first, reach us here.
                        </p>
                        <div className="collab-contact-links">
                            <a className="collab-link" href={CONTACT.x} target="_blank" rel="noopener noreferrer">
                                DM @{CONTACT.handle} on X
                            </a>
                            <a className="collab-link" href={CONTACT.discord} target="_blank" rel="noopener noreferrer">
                                Open a ticket in Discord
                            </a>
                        </div>
                    </section>
                </main>
            </div>
        </>
    );
}
