'use client';

/**
 * `/collab/review` — the owner's half of the collab requests.
 *
 * The page a project's request lands on after it is sent: every request in the store, oldest first,
 * with the two decisions there are. It is the browser twin of `tools/collab-requests.js`, and the CLI
 * keeps the two jobs the browser should not have — taking a row out of the store, and reading requests
 * from an environment the page cannot see.
 *
 * Four decisions are worth spelling out:
 *
 *   - **The wallet is the credential, and the server is the judge.** Nothing here decides whether
 *     anybody is an owner: the page signs, sends the token, and renders whatever
 *     `/api/collab/review` answers — rows for an owner, a 401 for nobody signed in, a 403 with the
 *     number of configured owners for anybody else. `lib/collab-owners.js` is **not imported here**:
 *     the list of who may decide lives on the server, and a bundle that carried it would be a bundle
 *     to read.
 *   - **The list is read once, then kept.** Every verb answers with the row it changed and the new
 *     counts, so a decision replaces one row instead of re-reading the store — and the page the owner
 *     is looking at never flickers back to a loading state under their hand.
 *   - **A picture is a link, never the bytes.** The store holds an upload as a `data:` URL; the API
 *     hands back `photoUrl` instead, which is `null` until the project has uploaded one and `null` for
 *     a row that is not approved — the same rule the picture route itself follows. That is what keeps
 *     a list of requests from being megabytes of base64.
 *   - **The note is the project's to read.** It is optional, it is shown to them on `/collab`, and it
 *     is the only field a decision writes. Approve or reject and nothing else: no editing somebody's
 *     prize, no deleting their row, no second way to change a status.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import BackLink from '../../back-link';
import { REVIEW } from '../../../lib/collab-content';
import { ensureSession, tokenIfSigned, walletModule } from '../../../lib/collab-session';

/** The states a request can be in, in the order the page lists them. */
const STATES = ['pending', 'approved', 'rejected'];

/** `0x7a5e…c0de`, which is how a wallet is shown to the person holding it. */
function shortWallet(address) {
    const text = String(address || '');
    return text.length > 12 ? `${text.slice(0, 6)}…${text.slice(-4)}` : (text || '—');
}

/** `2026-09-28T06:31:11.204Z` → `2026-09-28 06:31`, which is what a person reads. */
function when(value) {
    const text = String(value || '');
    return /^\d{4}-\d{2}-\d{2}T/.test(text) ? `${text.slice(0, 10)} ${text.slice(11, 16)}` : (text || '—');
}

/** What the status pill says, in the sheet's own vocabulary. */
function statusClass(status) {
    if (status === 'approved') return 'collab-status is-approved';
    if (status === 'rejected') return 'collab-status is-rejected';
    return 'collab-status is-pending';
}

export default function CollabReviewClient() {
    const walletPill = useRef(null);

    const [address, setAddress] = useState(null);
    /** `loading` → `signed-out` | `not-owner` | `ready` | `error`; nothing renders the list before it. */
    const [view, setView] = useState('loading');
    const [rows, setRows] = useState([]);
    const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0 });
    const [owners, setOwners] = useState(null);
    const [storage, setStorage] = useState(null);
    /** Empty until the first read settles it: the tab the owner lands on is the one with work in it. */
    const [filter, setFilter] = useState('');
    const [notes, setNotes] = useState({});
    const [busy, setBusy] = useState(null);
    const [step, setStep] = useState(null);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);

    /**
     * Read the list. A 401 and a 403 are states, not failures, and each says what to do about it.
     *
     * Called with no token for the refresh button, which is why it falls back to whatever this
     * browser already holds rather than sending an unauthenticated read that would answer 401 and
     * sign the owner out of their own page.
     */
    const read = useCallback(async (token = null) => {
        const credential = token || await tokenIfSigned();
        const res = await fetch('/api/collab/review', {
            headers: credential ? { Authorization: `Bearer ${credential}` } : {},
            cache: 'no-store',
        });
        const body = await res.json().catch(() => null);
        if (res.status === 401) {
            setView('signed-out');
            return null;
        }
        if (res.status === 403) {
            setOwners(Number(body?.owners) || 0);
            setView('not-owner');
            return null;
        }
        if (!res.ok) {
            setError(body?.error || 'The requests could not be read.');
            setView('error');
            return null;
        }
        setRows(Array.isArray(body?.requests) ? body.requests : []);
        setCounts(body?.counts || { pending: 0, approved: 0, rejected: 0 });
        setOwners(Number(body?.owners) || 0);
        setStorage(body?.storage || null);
        // The first read picks the tab: whatever is waiting, or everything if nothing is. Once the
        // owner has chosen, this leaves their choice alone.
        setFilter((prev) => prev || (body?.counts?.pending ? 'pending' : 'all'));
        setView('ready');
        return body;
    }, []);

    // Who is here, and are they allowed. The session is read rather than assumed: an address in
    // storage with no token is a wallet that connected once and never signed, which is exactly the
    // state the page has to explain.
    useEffect(() => {
        let live = true;
        (async () => {
            const mod = await walletModule();
            if (!live) return;
            const session = mod.readSession();
            const who = session?.address || mod.savedAddress();
            setAddress(who || null);
            if (!session?.token) {
                setView('signed-out');
                return;
            }
            await read(session.token);
        })().catch(() => { if (live) setView('signed-out'); });
        return () => { live = false; };
    }, [read]);

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
                    setRows([]);
                    setView('signed-out');
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

    /** Connect, sign, and read. The one way in, the same as everywhere else on this page. */
    const connect = useCallback(async () => {
        if (step) return;
        setError(null);
        setNotice(null);
        try {
            const session = await ensureSession({ address, onStep: setStep });
            // Nothing came back: the Privy login is still open, or it was closed.
            if (!session?.token) return;
            setAddress(session.address);
            await read(session.token);
        } catch (e) {
            if (e?.code === 4001 || /rejected|denied/i.test(e?.message || '')) {
                setNotice('Signature declined. Press connect again when you are ready.');
            } else {
                setError(e?.message || 'The wallet could not be connected.');
            }
        } finally {
            setStep(null);
        }
    }, [address, read, step]);

    /**
     * Approve or reject one request.
     *
     * A 401 is re-signed once rather than reported, the same way the registration flow does it: the
     * session can go under us — expired, or signed with a secret a redeploy replaced — and one more
     * signature is cheaper than an error the owner cannot act on.
     */
    const decide = useCallback(async (wallet, status) => {
        if (busy) return;
        setError(null);
        setNotice(null);
        setBusy(wallet);
        try {
            const session = await ensureSession({ address, onStep: setStep });
            if (!session?.token) return;
            setAddress(session.address);

            const send = (token) => fetch('/api/collab/review', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ wallet, status, note: notes[wallet] || null }),
            });

            let res = await send(session.token);
            if (res.status === 401) {
                const again = await ensureSession({ address: session.address, force: true, onStep: setStep });
                if (!again?.token) return;
                res = await send(again.token);
            }

            const body = await res.json().catch(() => null);
            if (res.status === 403) {
                setOwners(Number(body?.owners) || 0);
                setView('not-owner');
                return;
            }
            if (!res.ok) throw new Error(body?.error || 'That decision did not go through.');

            setRows((prev) => prev.map((row) => (row.wallet === wallet ? body.request : row)));
            setCounts((prev) => body.counts || prev);
            setNotes((prev) => ({ ...prev, [wallet]: '' }));
            setNotice(status === 'approved' ? REVIEW.approvedHint(body?.request?.name) : REVIEW.rejectedHint);
        } catch (e) {
            setError(e?.message || 'That decision could not be saved.');
        } finally {
            setBusy(null);
            setStep(null);
        }
    }, [address, busy, notes]);

    const active = filter || 'all';
    const shown = active === 'all' ? rows : rows.filter((row) => row.status === active);

    const signedIn = view === 'ready' || view === 'not-owner' || view === 'error';

    return (
        <>
            <link rel="stylesheet" href="/theme.css?v=9" />
            <link rel="stylesheet" href="/css/collab.css?v=5" />
            {/* The wallets this page can connect, and the menu module that turns the header pill
                into the menu every other route has. */}
            <Script src="/wallet-menu.js?v=1" strategy="afterInteractive" />
            <Script src="/wallet-source.js?v=3" strategy="afterInteractive" />

            <div className="collab-page">
                <header className="collab-head">
                    <BackLink />
                    <div className="collab-head-titles">
                        <h1 className="collab-title">Collab review</h1>
                        <p className="collab-sub">The other half of the collab form — every request, and the two decisions there are.</p>
                    </div>
                    <div className="collab-wallet">
                        <div className="wallet-pill" ref={walletPill} id="collabReviewWallet">
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

                {/* The same scroll box `/collab` uses, and for the same reason — see `.collab-scroll`
                    in the sheet. A list of requests is as long as the requests are. */}
                <div className="collab-scroll">
                    <main className="collab-main">
                        <section className="collab-section">
                            <div className="collab-section-head">
                                <p className="collab-eyebrow">{REVIEW.eyebrow}</p>
                                <h2 className="collab-section-title">{REVIEW.title}</h2>
                                <p className="collab-section-sub">{REVIEW.sub}</p>
                            </div>

                            <div className="collab-panel">
                                {view === 'loading' && <p className="collab-submit-intro">Reading the request list…</p>}

                                {view === 'signed-out' && (
                                    <div className="collab-state">
                                        <h3 className="collab-state-title">{REVIEW.needsWalletTitle}</h3>
                                        <p className="collab-state-copy">{REVIEW.needsWallet}</p>
                                        <div className="collab-actions">
                                            <button type="button" className="btn btn-primary btn-md" onClick={connect} disabled={!!step}>
                                                {step === 'connect' ? 'Connecting…' : step === 'sign' ? 'Waiting for signature…' : 'Connect owner wallet'}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {view === 'not-owner' && (
                                    <div className="collab-state">
                                        <h3 className="collab-state-title">{REVIEW.notOwnerTitle}</h3>
                                        <p className="collab-state-copy">{REVIEW.notOwner}</p>
                                        <dl className="collab-summary">
                                            <div className="collab-summary-row">
                                                <dt>Signed in as</dt>
                                                <dd>{shortWallet(address)}</dd>
                                            </div>
                                            <div className="collab-summary-row">
                                                <dt>Owner list</dt>
                                                <dd>{REVIEW.ownerList(owners)}</dd>
                                            </div>
                                        </dl>
                                        <div className="collab-actions">
                                            <button type="button" className="btn btn-ghost btn-md" onClick={connect} disabled={!!step}>
                                                {REVIEW.reconnect}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {view === 'error' && (
                                    <div className="collab-state">
                                        <h3 className="collab-state-title">{REVIEW.errorTitle}</h3>
                                        <p className="collab-state-copy">{REVIEW.errorBody}</p>
                                        <div className="collab-actions">
                                            <button type="button" className="btn btn-ghost btn-md" onClick={connect} disabled={!!step}>
                                                {REVIEW.reconnect}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {view === 'ready' && (
                                    <>
                                        <div className="collab-review-bar">
                                            <div className="collab-review-stats">
                                                {STATES.map((status) => (
                                                    <button
                                                        key={status}
                                                        type="button"
                                                        className={`collab-review-stat${active === status ? ' is-active' : ''}`}
                                                        onClick={() => setFilter(status)}
                                                        aria-pressed={active === status}
                                                    >
                                                        <span className="collab-review-stat-n">{counts[status]}</span>
                                                        <span className="collab-review-stat-label">{status}</span>
                                                    </button>
                                                ))}
                                                <button
                                                    type="button"
                                                    className={`collab-review-stat${active === 'all' ? ' is-active' : ''}`}
                                                    onClick={() => setFilter('all')}
                                                    aria-pressed={active === 'all'}
                                                >
                                                    <span className="collab-review-stat-n">{rows.length}</span>
                                                    <span className="collab-review-stat-label">all</span>
                                                </button>
                                            </div>
                                            <button
                                                type="button"
                                                className="btn btn-ghost btn-sm"
                                                onClick={() => read()}
                                                disabled={!!busy || !!step}
                                            >
                                                {REVIEW.refresh}
                                            </button>
                                        </div>

                                        <p className="collab-review-you">
                                            Signed in as {shortWallet(address)} — {REVIEW.ownerList(owners)}.
                                            {storage ? ` Reading ${storage}.` : ''}
                                        </p>

                                        {!rows.length && (
                                            <div className="collab-state">
                                                <p className="collab-state-copy">{REVIEW.empty}</p>
                                            </div>
                                        )}

                                        {!!rows.length && !shown.length && (
                                            <div className="collab-state">
                                                <p className="collab-state-copy">{REVIEW.noneOfThatState}</p>
                                            </div>
                                        )}

                                        <div className="collab-review-list">
                                            {shown.map((row) => (
                                                <article
                                                    key={row.wallet}
                                                    className={`collab-review-row${row.status === 'approved' ? ' is-approved' : row.status === 'rejected' ? ' is-rejected' : ' is-pending'}`}
                                                >
                                                    <div className="collab-review-head">
                                                        {row.photoUrl ? (
                                                            <img className="collab-review-thumb" src={row.photoUrl} alt="" width={56} height={56} loading="lazy" />
                                                        ) : (
                                                            <span className="collab-review-thumb-empty" aria-hidden="true">
                                                                {String(row.name || '?').trim().charAt(0).toUpperCase() || '?'}
                                                            </span>
                                                        )}
                                                        <div className="collab-review-who">
                                                            <h3 className="collab-review-name">{row.name}</h3>
                                                            <a
                                                                className="collab-review-handle"
                                                                href={`https://x.com/${row.handle}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                            >
                                                                @{row.handle}
                                                            </a>
                                                        </div>
                                                        <span className={statusClass(row.status)}>{row.status}</span>
                                                    </div>

                                                    <dl className="collab-summary">
                                                        <div className="collab-summary-row">
                                                            <dt>Giveaway</dt>
                                                            <dd>{row.prize}</dd>
                                                        </div>
                                                        {row.dates && (
                                                            <div className="collab-summary-row">
                                                                <dt>Dates</dt>
                                                                <dd>{row.dates}</dd>
                                                            </div>
                                                        )}
                                                        {row.note && (
                                                            <div className="collab-summary-row">
                                                                <dt>Their note</dt>
                                                                <dd>{row.note}</dd>
                                                            </div>
                                                        )}
                                                        <div className="collab-summary-row">
                                                            <dt>Wallet</dt>
                                                            <dd>{shortWallet(row.wallet)}</dd>
                                                        </div>
                                                        <div className="collab-summary-row">
                                                            <dt>Sent</dt>
                                                            <dd>
                                                                {when(row.at)}
                                                                {row.revisions > 1 ? ` · ${row.revisions} revisions` : ''}
                                                                {row.slug ? ` · slug ${row.slug}` : ''}
                                                            </dd>
                                                        </div>
                                                        <div className="collab-summary-row">
                                                            <dt>Picture</dt>
                                                            <dd>
                                                                {row.hasPhoto
                                                                    ? `${Math.round((row.photoBytes || 0) / 1024)} KB${row.photoUrl ? `, uploaded ${when(row.photoAt)}` : ' — kept, but only an approved project’s picture is served'}`
                                                                    : 'none yet'}
                                                            </dd>
                                                        </div>
                                                        {row.decidedAt && (
                                                            <div className="collab-summary-row">
                                                                <dt>Decided</dt>
                                                                <dd>{when(row.decidedAt)}{row.decidedNote ? ` — ${row.decidedNote}` : ''}</dd>
                                                            </div>
                                                        )}
                                                    </dl>

                                                    {row.status === 'pending' ? (
                                                        <div className="collab-actions">
                                                            <input
                                                                className="collab-review-note"
                                                                type="text"
                                                                maxLength={REVIEW.noteLimit}
                                                                placeholder={REVIEW.notePlaceholder}
                                                                aria-label={`Note for ${row.name}`}
                                                                value={notes[row.wallet] || ''}
                                                                onChange={(event) => setNotes((prev) => ({ ...prev, [row.wallet]: event.target.value }))}
                                                                disabled={!!busy}
                                                            />
                                                            <button
                                                                type="button"
                                                                className="btn btn-primary btn-md"
                                                                onClick={() => decide(row.wallet, 'approved')}
                                                                disabled={!!busy}
                                                            >
                                                                {busy === row.wallet ? REVIEW.deciding : REVIEW.approve}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="btn btn-ghost btn-md collab-danger"
                                                                onClick={() => decide(row.wallet, 'rejected')}
                                                                disabled={!!busy}
                                                            >
                                                                {REVIEW.reject}
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <p className="collab-review-hint">
                                                            {row.status === 'approved' ? REVIEW.approvedRow : REVIEW.rejectedRow}
                                                        </p>
                                                    )}
                                                </article>
                                            ))}
                                        </div>
                                    </>
                                )}

                                {signedIn && (
                                    <p className="collab-register-note">{REVIEW.footnote}</p>
                                )}
                            </div>
                        </section>
                    </main>
                </div>
            </div>
        </>
    );
}
