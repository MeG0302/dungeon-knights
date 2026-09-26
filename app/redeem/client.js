'use client';

/**
 * The knights' wheel — `/redeem`.
 *
 * Three reels of knight PFPs, a thousand points a spin, and a gift card one time in three. Four
 * decisions hold this page together, and each of them is a rule rather than a preference:
 *
 *   - **The server draws, the reels show.** The outcome arrives with the spin's answer and the page
 *     animates to *that* — never the other way round. A wheel that decided its own result could
 *     hand out a card the server never authorised, and could be edited by anyone with devtools.
 *   - **Two prices are printed and neither is typed here.** The cost and the odds come out of
 *     `lib/points-config.js`, the same table the server charges and draws from, so a page that says
 *     "1 in 3" while the server plays 1-in-6 is not a thing that can ship quietly.
 *   - **A spin cannot be double-charged.** The browser makes up a spin id per spin and sends it;
 *     a retry with the same id is answered from the wallet's own record. That is why the page can
 *     afford to be generous with its own network handling — it re-sends the same id, never a new one.
 *   - **Every refusal says what it is.** Too few points, a card out of stock, a spin already
 *     running: three different sentences, and none of them is "something went wrong" — the player
 *     is being told why they were not charged.
 *
 * The reels are the decoration on all of that, with one exception that is not decoration at all:
 * **which tiles the three columns land on** is the rule the game pays by, and it lives in
 * `lib/points-redeem-reels.js` — a pure module, so the harness can hold "a loss is never three of a
 * kind" over every seed instead of reading this file as text. Everything here is the frame around
 * it: `STRIP` is the symbol list twice, so the roll loops without a seam, and the settle is one
 * transform to the index of the tile that was drawn.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Script from 'next/script';
import BackLink from '../back-link';
import {
    connectWallet,
    fetchRedeem,
    isAddress,
    readSession,
    requestSpin,
    savedAddress,
    shortAddress,
    signIn,
} from '../../lib/points-client';
import {
    IDLE,
    STRIP,
    indexOf,
    landedKeys,
    threeOfAKind,
} from '../../lib/points-redeem-reels';
import {
    REDEEM_HOWTO,
    REDEEM_OUTCOMES,
    REDEEM_PRIZES,
    REDEEM_SPIN_COST,
    redeemOdds,
} from '../../lib/points-config';

/** The odds and the price, printed from the table the server uses — never typed into the copy. */
const ODDS = redeemOdds();
const COST = REDEEM_SPIN_COST.toLocaleString('en-US');

/** How long the reels roll before the first one stops, and how far apart the three stops are. */
const ROLL_MS = 1500;
const STOP_GAP_MS = 240;

/** `**bold**` in the outcome lines, the way every other surface in this project reads them. */
function rich(text) {
    const parts = String(text || '').split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, index) => (part.startsWith('**') && part.endsWith('**')
        ? <strong key={index}>{part.slice(2, -2)}</strong>
        : <span key={index}>{part}</span>));
}

/** The same sentence for a speech bubble, which takes HTML rather than markers. */
function plain(text) {
    return String(text || '').replace(/\*\*/g, '');
}

function newSpinId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return `spin_${crypto.randomUUID()}`;
    return `spin_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function when(at) {
    const ms = Number(at);
    if (!ms) return '';
    const minutes = Math.round((Date.now() - ms) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * One tile in a reel: a knight's face and the tier it belongs to.
 *
 * Every symbol on every reel is one of the five portraits — a win is the same face three times, and
 * nothing on the strip spells out which card is at stake. The card is named under the reels, where
 * it can be a sentence, and on the code plate.
 */
function Tile({ tile }) {
    return (
        <div className="redeem-tile" data-tile={tile.key}>
            <img src={tile.pfp} alt="" loading="lazy" draggable="false" />
            <span className="redeem-tile-label">{tile.label}</span>
        </div>
    );
}

/**
 * One reel.
 *
 * `landed` is the key of the tile this reel stopped on, or null while it is rolling. The strip is
 * `LIST` twice and the settle is `translateY(-index × --redeem-tile-size)`, so the rolled strip and
 * the settled strip are the same element — the animation stops and the transform that was always
 * there takes over.
 */
function Reel({ landed, rolling, idle }) {
    const landedIndex = landed ? indexOf(landed) : -1;
    const settled = landedIndex >= 0;
    const index = settled ? landedIndex : (rolling ? -1 : indexOf(idle));
    return (
        <div className={`redeem-reel${rolling ? ' is-rolling' : ''}${settled ? ' is-set' : ''}`}>
            <div
                className="redeem-strip"
                // One transform, three states: at rest it holds the column's own face, while
                // rolling it is `null` so the keyframes own the property, and once landed it is
                // the tile the server drew. `index < 0` is the rolling case and the only one.
                style={index >= 0 ? { transform: `translateY(calc(${-index} * var(--redeem-tile-size)))` } : undefined}
            >
                {STRIP.map((tile, i) => <Tile key={`${tile.key}-${i}`} tile={tile} />)}
            </div>
        </div>
    );
}

export default function RedeemClient() {
    const [phase, setPhase] = useState('boot');
    const [address, setAddress] = useState(null);
    const [view, setView] = useState(null);
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    const [rolling, setRolling] = useState(false);
    const [landed, setLanded] = useState([null, null, null]);
    const [result, setResult] = useState(null);

    const walletPill = useRef(null);
    const stopTimers = useRef([]);

    const connected = phase === 'ready' && Boolean(view?.address);
    const points = view?.points ?? 0;
    const affordable = points >= REDEEM_SPIN_COST;
    const stock = useMemo(() => {
        const out = {};
        for (const prize of view?.prizes || []) out[prize.key] = prize.left;
        return out;
    }, [view]);
    const stocked = REDEEM_PRIZES.every((prize) => (stock[prize] ?? 0) > 0);
    const canSpin = connected && !busy && affordable && stocked;

    const load = useCallback(async () => {
        const state = await fetchRedeem();
        setView(state);
        return state;
    }, []);

    // ----------------------------------------------------------------------------- boot
    useEffect(() => {
        let alive = true;
        (async () => {
            const session = readSession();
            if (session) {
                try {
                    const state = await fetchRedeem();
                    if (!alive) return;
                    setAddress(state.address);
                    setView(state);
                    setPhase('ready');
                    return;
                } catch (e) {
                    if (e.status === 401) {
                        // Expired, or signed with a secret that has since changed — one more
                        // signature is all it takes, and the wheel says so rather than spinning.
                        setPhase('anon');
                        setAddress(savedAddress());
                        return;
                    }
                    if (alive) setError(e.message);
                }
            }
            if (!alive) return;
            setAddress(savedAddress());
            setPhase('anon');
        })();
        return () => { alive = false; };
    }, []);

    // The header's wallet pill gets the menu every other page's control has, attached by hand
    // because this route renders after hydration and a script that scanned the DOM would find
    // nothing to attach to.
    useEffect(() => {
        const pill = walletPill.current;
        if (!pill || typeof window === 'undefined') return undefined;
        let cancelled = false;
        const attach = () => {
            if (cancelled || !window.WalletMenu) return false;
            window.WalletMenu.attach(pill, { onDisconnect: () => { setView(null); setPhase('anon'); } });
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
    }, [phase]);

    useEffect(() => () => { stopTimers.current.forEach(clearTimeout); }, []);

    // ------------------------------------------------------------------- connect, then spin
    const finishSignIn = useCallback(async (wallet) => {
        await signIn(wallet);
        const state = await load();
        setAddress(state.address);
        setPhase('ready');
        return state;
    }, [load]);

    const handleConnect = async () => {
        if (busy) return;
        setBusy('connect');
        setError(null);
        try {
            const wallet = await connectWallet();
            // Nothing came back: the Privy login is still open, or it was closed. Both are visible
            // to the player — they are looking at the modal — so there is nothing to announce.
            if (!wallet) return;
            await finishSignIn(wallet);
        } catch (e) {
            if (e?.code === 4001 || /rejected/i.test(e?.message || '')) {
                setNotice('Signature declined. Connect again when you are ready to spin.');
            } else {
                setError(e?.message || 'Could not finish signing in.');
            }
        } finally {
            setBusy(null);
        }
    };

    // A Privy sign-in that lands after the click is what finishes the job, exactly as it does on
    // the Points page — the click's own path returns `null` while the conversation is still open.
    useEffect(() => {
        const onSignedIn = async (event) => {
            const detail = event?.detail || {};
            if (!detail.authenticated || !isAddress(detail.address)) return;
            if (busy === 'connect') return;
            if (connected && view?.address?.toLowerCase() === detail.address.toLowerCase()) return;
            try {
                await finishSignIn(detail.address);
            } catch (e) {
                if (e?.code === 4001 || /rejected/i.test(e?.message || '')) {
                    setNotice('Signature declined. Connect again when you are ready to spin.');
                } else {
                    setError(e?.message || 'Could not finish signing in.');
                }
            }
        };
        window.addEventListener('privyAuthChanged', onSignedIn);
        return () => window.removeEventListener('privyAuthChanged', onSignedIn);
    }, [busy, connected, view?.address, finishSignIn]);

    const reveal = useCallback((outcome, payload) => {
        stopTimers.current.forEach(clearTimeout);
        const keys = landedKeys(outcome, payload);
        keys.forEach((key, index) => {
            stopTimers.current.push(setTimeout(() => {
                setLanded((prev) => {
                    const next = prev.slice();
                    next[index] = key;
                    return next;
                });
                if (index === keys.length - 1) {
                    setRolling(false);
                    setResult({
                        outcome,
                        prize: payload?.prize || null,
                        code: payload?.code || null,
                    });
                    const line = REDEEM_OUTCOMES[outcome]?.line || '';
                    if (typeof window !== 'undefined' && window.Arya) {
                        window.Arya.say(outcome === 'tryAgain' ? 'redeem_lose' : 'redeem_win', {
                            message: plain(line),
                        });
                    }
                }
            }, ROLL_MS + index * STOP_GAP_MS));
        });
    }, []);

    const handleSpin = async () => {
        if (busy || !canSpin) return;
        setBusy('spin');
        setError(null);
        setNotice(null);
        setResult(null);
        setLanded([null, null, null]);
        setRolling(true);

        // One id per press of the button, and the *same* id if this request has to be repeated —
        // which is what makes a lost response cost a retry rather than a second thousand points.
        const spinId = newSpinId();
        try {
            const payload = await requestSpin(spinId);
            reveal(payload.outcome, payload);
            if (payload.state) setView(payload.state);
        } catch (e) {
            // A refusal is not a failure: the reels stop, nothing was charged, and the sentence
            // says which of the three things it was.
            setRolling(false);
            setLanded([null, null, null]);
            const code = e.payload?.error || e.code;
            if (e.status === 409 || code === 'busy') {
                setNotice('A spin is already running for this wallet — give it a second.');
            } else if (code === 'not_enough_points') {
                setError(`A spin costs ${COST} points and you have ${Number(e.payload?.points || points).toLocaleString('en-US')}. Clear the vault floors and come back.`);
            } else if (code === 'out_of_stock') {
                setError('One of the cards has run out of codes, so the wheel is closed until it is topped up. Nothing was charged.');
            } else if (e.status === 401) {
                setPhase('anon');
                setError('Your session expired. Connect again to spin.');
            } else {
                setError(e.message || 'The wheel did not answer.');
            }
            if (e.payload?.state) setView(e.payload.state);
        } finally {
            setBusy(null);
        }
    };

    const spins = view?.spins || [];
    const won = spins.filter((row) => row.code).length;
    // The machine's state, derived from the tiles that landed rather than from the answer that
    // caused them — see `threeOfAKind`.
    const trio = threeOfAKind(landed);
    const tryAgain = result?.outcome === 'tryAgain';

    const shell = (
        <>
            <link rel="stylesheet" href="/theme.css?v=8" />
            <link rel="stylesheet" href="/css/redeem.css?v=2" />
            <link rel="stylesheet" href="/css/arya.css?v=3" />
            <Script src="/arya.js?v=5" strategy="afterInteractive" />
            <Script src="/wallet-menu.js?v=1" strategy="afterInteractive" />
            <Script src="/wallet-source.js?v=3" strategy="afterInteractive" />
        </>
    );

    return (
        <>
            {shell}
            <div className="redeem-page">
                <header className="redeem-head">
                    <BackLink />
                    <div className="redeem-head-titles">
                        <h1 className="redeem-title">Redeem</h1>
                        <p className="redeem-sub">The knights&rsquo; wheel — spend points, win a gift card.</p>
                    </div>
                    <div className="redeem-wallet">
                        <div className="wallet-pill" ref={walletPill} id="redeemWallet">
                            {connected ? (
                                <>
                                    <span className="redeem-balance">{points.toLocaleString('en-US')} PTS</span>
                                    <span className="redeem-who">{shortAddress(view?.address || address || '')}</span>
                                </>
                            ) : (
                                <button className="btn btn-primary btn-sm" onClick={handleConnect} disabled={busy === 'connect'}>
                                    {busy === 'connect' ? 'Connecting…' : 'Connect wallet'}
                                </button>
                            )}
                        </div>
                    </div>
                </header>

                {error && (
                    <div className="redeem-banner is-error" role="alert">
                        <span>{error}</span>
                        <button className="redeem-banner-x" onClick={() => setError(null)} aria-label="Dismiss">✕</button>
                    </div>
                )}
                {notice && (
                    <div className="redeem-banner is-notice" role="status">
                        <span>{notice}</span>
                        <button className="redeem-banner-x" onClick={() => setNotice(null)} aria-label="Dismiss">✕</button>
                    </div>
                )}

                <main className="redeem-main">
                    <section className="redeem-stage">
                        <p className="redeem-odds">{ODDS.line}</p>

                        {/* The cabinet. The payline is a sibling of the reels rather than
                            something each reel draws, because it is a claim about all three at
                            once — a lit line means the three columns match, and it is lit only
                            when the tiles that landed say so. */}
                        <div className={`redeem-machine${rolling ? ' is-rolling' : ''}${trio ? ' is-win' : ''}${!trio && tryAgain ? ' is-lose' : ''}`}>
                            <span className="redeem-payline" aria-hidden="true" />
                            <div className="redeem-reels" aria-hidden={rolling}>
                                {[0, 1, 2].map((index) => (
                                    <Reel
                                        key={index}
                                        landed={landed[index]}
                                        rolling={rolling && !landed[index]}
                                        idle={IDLE[index]}
                                    />
                                ))}
                            </div>
                        </div>

                        {/* The result, in words as well as pictures — a screen reader player gets the
                            outcome, and so does anyone whose browser did not animate the reels. */}
                        <p className={`redeem-result is-${result ? result.outcome : 'idle'}`} role="status">
                            {result
                                ? rich(REDEEM_OUTCOMES[result.outcome]?.line || '')
                                : (connected ? `Press spin to send the reels — ${COST} points.` : 'Connect a wallet to spin.')}
                        </p>

                        {result?.code && (
                            <p className="redeem-won">
                                <span className="redeem-won-label">Your code</span>
                                <code className="redeem-code">{result.code}</code>
                            </p>
                        )}

                        <div className="redeem-actions">
                            <button className="btn btn-primary btn-lg redeem-spin" onClick={handleSpin} disabled={!canSpin}>
                                {busy === 'spin' ? 'Spinning…' : `Spin · ${COST} points`}
                            </button>
                            <span className="redeem-balance-line">
                                {connected
                                    ? `You have ${points.toLocaleString('en-US')} points`
                                    : 'Sign in to spin'}
                            </span>
                        </div>

                        <p className="redeem-stock">
                            {REDEEM_PRIZES.map((prize) => (
                                <span key={prize} className={`redeem-stock-item${(stock[prize] ?? 0) > 0 ? '' : ' is-out'}`}>
                                    {REDEEM_OUTCOMES[prize].short}: {(stock[prize] ?? 0).toLocaleString('en-US')} left
                                </span>
                            ))}
                            {!stocked && <span className="redeem-stock-item is-out">Closed until the cards are topped up</span>}
                        </p>
                    </section>

                    <section className="redeem-panel">
                        <h2 className="redeem-panel-title">
                            Your spins
                            <span className="redeem-panel-count">
                                {view?.spinCount ? `${view.spinCount} played · ${won} card${won === 1 ? '' : 's'}` : 'none yet'}
                            </span>
                        </h2>
                        {spins.length === 0 ? (
                            <p className="redeem-empty">
                                {connected
                                    ? 'Nothing yet. Every spin you play is listed here, with the code if it won one.'
                                    : 'Sign in with your wallet and your spins appear here.'}
                            </p>
                        ) : (
                            <ul className="redeem-codes">
                                {spins.map((row) => (
                                    <li key={row.id || `${row.at}-${row.outcome}`} className={`redeem-code-row is-${row.outcome}`}>
                                        <span className="redeem-code-when">{when(row.at)}</span>
                                        <span className="redeem-code-what">
                                            {row.code ? REDEEM_OUTCOMES[row.outcome]?.name : REDEEM_OUTCOMES.tryAgain.name}
                                        </span>
                                        {row.code
                                            ? <code className="redeem-code">{row.code}</code>
                                            : <span className="redeem-code-none">no card</span>}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>

                    <section className="redeem-panel redeem-howto-panel">
                        <h2 className="redeem-panel-title">How to redeem a code</h2>
                        <ul className="redeem-howto">
                            {REDEEM_HOWTO.map((row) => (
                                <li key={row.what} className="redeem-howto-row">
                                    <span className="redeem-howto-what">{row.what}</span>
                                    <span className="redeem-howto-how">{row.how}</span>
                                </li>
                            ))}
                        </ul>
                        <p className="redeem-note">
                            Cards are bought in the region they are redeemable in — if a code will not
                            apply, ask in Discord before buying a replacement.
                        </p>
                    </section>
                </main>
            </div>
        </>
    );
}
