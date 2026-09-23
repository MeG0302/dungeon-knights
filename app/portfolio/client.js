'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import {
    connectWallet, fetchMe, forgetWallet, onAccountsChanged, readSession, savedAddress, shortAddress,
    walletCapabilities,
} from '../../lib/points-client';
import { describeEarn } from '../../lib/points-history';
import { GENESIS_PFP, RARITY, knightPfp } from '../../lib/knights';
import { DEFAULT_CHAIN } from '../../lib/privy-chains';

/**
 * My Portfolio — one wallet, read from the chain, in four sections.
 *
 * WHY THIS PAGE EXISTS
 * --------------------
 * The answer to "what do I actually own?" was spread across four screens: DNG in the header pill
 * of whichever page you were on, knights in the Hall, Genesis and staking reward on the vault, and
 * points on the Points page — and none of them could tell you the total. The header's wallet menu
 * links here for that reason.
 *
 * WHAT IT READS, AND WHAT IT REFUSES TO
 * -------------------------------------
 * Every number on this page comes from a source that already exists and is already honest:
 *
 *   `/api/staking/holdings?collection=knights`  the knights you own, and what you have staked
 *   `/api/staking/holdings?collection=genesis`  the same, plus the collection's published supply
 *   `/api/wallet/balance`                       how much $DNG the wallet holds
 *   `/api/points/me`                            points, rank, today's entries, referrals
 *   `/api/game/history?address=`                what you have been paid, and when
 *
 * All five are server reads, and that is deliberate: the browser contributes the wallet's
 * *address* and nothing else. The first version asked the wallet's own provider for the balance —
 * one `eth_call`, the obvious thing — and produced a page whose four other sections showed real
 * chain data while its headline said "the wallet is not available in this browser", which is the
 * normal state of a browser with a saved address and no extension. The page therefore loads no
 * chain library at all.
 *
 * There is no second implementation of any of it, and no arithmetic that invents a number: the
 * lifetime total is the chain's events, the balance is `balanceOf`, and the pool share is the
 * pool's own view. Which is why each section fails on its own. A node that is down must not turn
 * "you own 47 knights" into "you own none", so a failed read says it failed and the rest of the
 * page stays up.
 *
 * It is read-only on purpose. Every section ends by linking to the page that owns its action —
 * claiming, staking and summoning all involve transactions, and one write path is enough to audit.
 */

const ASSETS = '/assets/points/';
const RARITY_ORDER = ['legendary', 'epic', 'rare', 'uncommon', 'common'];

const fmtInt = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US') : '—');
const fmtDng = (n) => {
    const value = Number(n);
    if (!Number.isFinite(value)) return '—';
    return value.toLocaleString('en-US', { maximumFractionDigits: value < 100 ? 2 : 0 });
};

const shortWhen = (value) => {
    const ms = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value);
    if (!Number.isFinite(ms)) return '—';
    const minutes = Math.round((Date.now() - ms) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
    return `${Math.round(minutes / 1440)}d ago`;
};

/** The empty read: `phase` is what the section renders from, `data` is what it shows. */
const blank = { phase: 'idle', data: null, error: null };

async function readJson(url, options) {
    const res = await fetch(url, { cache: 'no-store', ...(options || {}) });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error || body?.reason || `Request failed (${res.status})`);
    return body;
}

export default function PortfolioClient() {
    const [address, setAddress] = useState(null);
    const [busy, setBusy] = useState(null);
    const [readAt, setReadAt] = useState(null);

    const [dng, setDng] = useState({ phase: 'idle', value: null, symbol: 'DNG', error: null });
    const [knights, setKnights] = useState(blank);
    const [genesis, setGenesis] = useState(blank);
    const [points, setPoints] = useState(blank);
    const [history, setHistory] = useState(blank);

    const walletPill = useRef(null);
    const handleDisconnectRef = useRef(() => {});

    // ------------------------------------------------------------------ the wallet
    //
    // The saved address is instant, but it is not the whole answer — and for the players this page
    // was opened up for it is not the answer at all. Someone who signs in with an email address on
    // the Points page has a wallet in the *seam* and nothing in localStorage, so reading the saved
    // key alone showed them "Connect a wallet" on a page about the wallet they were already using.
    //
    // So: the seam first (it is the authority everywhere else, and its own rule refuses to hand back
    // a wallet that would move the player off one they already use), the saved key second, and both
    // `privyAuthChanged` and `privyBridgeReady` re-ask — a sign-in that lands while this page is
    // open arrives through one of them.
    useEffect(() => {
        let alive = true;

        const read = async () => {
            try {
                const caps = await walletCapabilities();
                if (!alive) return;
                const who = caps?.address || savedAddress() || null;
                if (who) setAddress(who);
            } catch {
                // A wallet source that cannot answer is the saved key's problem to cover.
                if (alive) setAddress(savedAddress());
            }
        };

        setAddress(savedAddress());
        read();
        window.addEventListener('privyAuthChanged', read);
        window.addEventListener('privyBridgeReady', read);
        const offAccounts = onAccountsChanged((next) => setAddress(next));

        return () => {
            alive = false;
            window.removeEventListener('privyAuthChanged', read);
            window.removeEventListener('privyBridgeReady', read);
            offAccounts();
        };
    }, []);

    const load = useCallback(async (who) => {
        if (!who) return;
        setBusy('loading');
        setReadAt(null);

        const holdings = (collection) => readJson(
            `/api/staking/holdings?address=${encodeURIComponent(who)}&collection=${collection}`,
        );

        // Every section settles on its own, so one failure cannot blank the page. `Promise.allSettled`
        // is the point here rather than a convenience: the five reads are independent facts about one
        // wallet, and the page should show the four that worked.
        const [knightsRead, genesisRead, balanceRead, historyRead] = await Promise.allSettled([
            holdings('knights'),
            holdings('genesis'),
            readJson(`/api/wallet/balance?address=${encodeURIComponent(who)}`),
            readJson(`/api/game/history?address=${encodeURIComponent(who)}`),
        ]);

        const settle = (result, setter) => {
            if (result.status === 'rejected') {
                setter({ phase: 'error', data: null, error: result.reason?.message || 'The read failed.' });
                return null;
            }
            const body = result.value;
            if (body?.ok === false) {
                setter({ phase: 'error', data: null, error: body.reason || 'The chain could not be read just now.' });
                return null;
            }
            setter({ phase: 'ready', data: body, error: null });
            return body;
        };

        const knightBody = settle(knightsRead, setKnights);
        settle(genesisRead, setGenesis);
        settle(historyRead, setHistory);

        // The balance reports its own failure, like every other section.
        if (balanceRead.status === 'rejected' || balanceRead.value?.ok !== true) {
            setDng({
                phase: 'error',
                value: null,
                symbol: 'DNG',
                error: balanceRead.status === 'rejected'
                    ? (balanceRead.reason?.message || 'The balance could not be read.')
                    : (balanceRead.value?.reason || 'The balance could not be read.'),
            });
        } else {
            setDng({ phase: 'ready', value: balanceRead.value.amount, symbol: balanceRead.value.symbol, error: null });
        }

        // Points are a server session, not a wallet: a player who has never signed into the Points
        // Program is not an error, and the section says which of the two it is. `fetchMe` is the
        // shared helper, so a 401 here means exactly what it means on the Points page.
        //
        // The session's address is checked against the wallet on screen, and that guard is the
        // point of this branch rather than a nicety. A session is 30 days long and a wallet can
        // change in that time — connect a second wallet, or open this page after switching in the
        // extension — and `/api/points/me` answers for whoever *signed*, not for whoever is
        // connected now. Without this, one wallet's points would be printed under another wallet's
        // knights, which is the same lie the holdings route goes out of its way to refuse.
        const session = readSession();
        if (!session) {
            setPoints({ phase: 'anon', data: null, error: null });
        } else if (String(session.address).toLowerCase() !== String(who).toLowerCase()) {
            setPoints({ phase: 'other', data: null, error: null, sessionAddress: session.address });
        } else {
            try {
                setPoints({ phase: 'ready', data: await fetchMe(), error: null });
            } catch (error) {
                const notSignedIn = error?.status === 401;
                setPoints({ phase: notSignedIn ? 'anon' : 'error', data: null, error: notSignedIn ? null : error.message });
            }
        }

        void knightBody;
        setReadAt(new Date());
        setBusy(null);
    }, []);

    useEffect(() => {
        if (address) load(address);
    }, [address, load]);

    const handleDisconnect = () => {
        forgetWallet();
        setAddress(null);
        setDng({ phase: 'idle', value: null, symbol: 'DNG', error: null });
        setKnights(blank);
        setGenesis(blank);
        setPoints(blank);
        setHistory(blank);
        setReadAt(null);
        if (window.Arya?.hide) window.Arya.hide();
    };
    handleDisconnectRef.current = handleDisconnect;

    const handleConnect = async () => {
        setBusy('connect');
        try {
            // Null means nothing was connected — the Privy login was closed, or it is still
            // open. A sign-in that lands later arrives through the bridge, so there is
            // nothing to report here.
            const who = await connectWallet();
            if (who) setAddress(who);
        } catch {
            // The menu shows the reason for a failed connect; here the page has room to say it too.
            setBusy(null);
        } finally {
            setBusy(null);
        }
    };

    // The header's wallet menu, attached to the pill this route renders.
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
            return () => { cancelled = true; clearInterval(timer); };
        }
        return () => { cancelled = true; };
    }, []);

    // ------------------------------------------------------------------- what it shows
    // The chain label comes from the same definition the provider and the add-chain request use,
    // so a deployment that moves to mainnet moves this line with it.
    const chain = readAt ? DEFAULT_CHAIN.name : null;
    const knightList = knights.data?.knights || [];
    const genesisList = genesis.data?.knights || [];
    const stake = genesis.data?.stake || null;

    const byTier = RARITY_ORDER.reduce((acc, tier) => {
        acc[tier] = knightList.filter((k) => k.rarity === tier).length;
        return acc;
    }, {});

    const ownedHashPower = genesisList.reduce((sum, k) => sum + (Number(k.hashPower) || 0), 0);
    const stakedCount = {
        knights: knights.data?.stake?.staked?.length || 0,
        genesis: genesis.data?.stake?.staked?.length || 0,
    };
    const claimable = (side) => side?.stake?.claim?.payable ?? side?.stake?.claim?.settled ?? null;
    const claimableTotal = [knights.data, genesis.data]
        .map((side) => claimable(side))
        .filter((value) => typeof value === 'number')
        .reduce((sum, value) => sum + value, 0);

    const supply = genesis.data?.supply || null;

    // The points log, newest first as the server hands it over. `recentTotal` counts what is held
    // rather than what was shown, so the header cannot claim twelve events when there are forty.
    const recentLog = points.phase === 'ready' ? points.data?.recent || [] : [];
    const recentTotal = points.phase === 'ready'
        ? (points.data?.recentTotal ?? recentLog.length)
        : 0;

    // ------------------------------------------------------------------------ render
    const pageStyles = (
        <>
            <link rel="stylesheet" href="/theme.css?v=6" />
            <link rel="stylesheet" href="/css/portfolio.css?v=2" />
            {/* No ethers: every figure on this page is read by the server, so the page itself never
                calls the chain. `wallet-source.js` is still here for the wallet's own session and
                the menu, which is what connects and disconnects. */}
            <Script src="/wallet-source.js?v=3" strategy="afterInteractive" />
            <Script src="/wallet-menu.js?v=1" strategy="afterInteractive" />
        </>
    );

    if (!address) {
        return (
            <>
                {pageStyles}
                <div className="page portfolio-page">
                    <Header pillRef={walletPill} address={null} onDisconnect={handleDisconnect} balance={null} />
                    <main className="pf-main">
                        <section className="pf-empty">
                            {/* The 2K chest is 1.9 MB and this box is 96px, so it is served as a
                                192px WebP generated from it — same picture, 11 KB, alpha kept. */}
                            <img src="/assets/hall/portfolio-chest.webp" alt="" className="pf-empty-art" width={96} height={82} />
                            <h1 className="pf-empty-title">Your Portfolio</h1>
                            <p className="pf-empty-text">
                                Connect a wallet and this page reads it: your $DNG balance, every knight you own
                                on both collections, what is staked and what you have been paid, your Genesis
                                hash power and your Points Program standing. Nothing here is stored about you —
                                it is read from the chain and the game&rsquo;s API each time you open it.
                            </p>
                            <button className="btn btn-primary btn-md" onClick={handleConnect} disabled={busy === 'connect'}>
                                <img src="/assets/ui/sword.png" className="btn-icon-img" alt="" />
                                {busy === 'connect' ? 'Connecting…' : 'Connect Wallet'}
                            </button>
                        </section>
                    </main>
                </div>
            </>
        );
    }

    return (
        <>
            {pageStyles}
            <div className="page portfolio-page">
                <Header
                    pillRef={walletPill}
                    address={address}
                    onDisconnect={handleDisconnect}
                    balance={dng.phase === 'ready' ? `${fmtDng(dng.value)} ${dng.symbol || 'DNG'}` : null}
                />

                <main className="pf-main">
                    {/* Identity strip — whose wallet this is, on which chain, and when it was read. */}
                    <section className="pf-identity">
                        <div className="pf-identity-who">
                            <span className="pf-address" title={address}>{shortAddress(address)}</span>
                            <button
                                type="button"
                                className="pf-copy"
                                onClick={() => navigator.clipboard?.writeText(address)}
                                title="Copy the full address"
                            >
                                Copy
                            </button>
                        </div>
                        {/* The chain, the read time and the refresh control are developer furniture:
                            they name a testnet and a timestamp to a player who came here for their
                            points. Blurred and inert rather than deleted, so the page does not
                            change shape when the mainnet names replace them. */}
                        <div className="pf-identity-meta pf-blur" aria-hidden="true">
                            <span>{chain}</span>
                            <span className="pf-dot-sep">·</span>
                            <span>{readAt ? `read ${readAt.toLocaleTimeString()}` : busy === 'loading' ? 'reading…' : 'not read yet'}</span>
                            <button type="button" className="pf-refresh" onClick={() => load(address)} disabled={busy === 'loading'}>
                                {busy === 'loading' ? 'Reading…' : 'Refresh'}
                            </button>
                        </div>
                    </section>

                    <div className="pf-grid">
                        {/* -------------------------------------------------- $DNG */}
                        {/* Blurred with a label, rather than hidden: the panel is real and its numbers
                            are real, they are just not live yet, and a player should be able to see
                            what is coming rather than an empty box. `aria-hidden` on the body means a
                            screen reader is told the same thing the eye is — the notice, not figures
                            nobody is meant to read yet. */}
                        <section className="pf-card pf-soon">
                            <h2 className="pf-card-title">
                                <img src="/assets/ui/shield.png" alt="" className="pf-card-icon" /> $DNG
                                <span className="pf-soon-chip">Coming soon</span>
                            </h2>
                            <div className="pf-soon-body" aria-hidden="true">
                            <div className="pf-hero">
                                <span className="pf-hero-value">
                                    {dng.phase === 'ready' ? fmtDng(dng.value) : '—'}
                                </span>
                                <span className="pf-hero-label">{dng.symbol || 'DNG'} in this wallet</span>
                            </div>
                            {dng.phase === 'error' && <p className="pf-warn">{dng.error}</p>}

                            <dl className="pf-rows">
                                <Row label="Staked knights" value={knights.phase === 'ready' ? fmtInt(stakedCount.knights) : '—'} />
                                <Row label="Staked Genesis" value={genesis.phase === 'ready' ? fmtInt(stakedCount.genesis) : '—'} />
                                <Row
                                    label="Claimable now"
                                    value={knights.phase === 'ready' || genesis.phase === 'ready'
                                        ? `${fmtDng(claimableTotal)} DNG`
                                        : '—'}
                                    hint="from both staking pools"
                                />
                                <Row
                                    label="Lifetime claimed"
                                    value={history.phase === 'ready' ? `${fmtDng(history.data?.totals?.claimed)} DNG` : history.phase === 'error' ? 'unreadable' : '—'}
                                    hint={history.phase === 'ready' ? `${fmtInt(history.data?.totals?.claims)} claim(s) · ${fmtInt(history.data?.totals?.runs)} run(s)` : null}
                                />
                            </dl>
                            {history.phase === 'error' && <p className="pf-warn">{history.error}</p>}
                            <div className="pf-actions">
                                <a className="pf-link" href="/staking">Open the Staking Vault</a>
                                <a className="pf-link" href="/game">Enter a dungeon</a>
                            </div>
                            </div>
                            <p className="pf-soon-note">
                                Your $DNG balance, what is staked and what is claimable will read here when
                                this panel opens.
                            </p>
                        </section>

                        {/* ---------------------------------------------- Knights */}
                        <section className="pf-card">
                            <h2 className="pf-card-title">
                                <img src="/assets/ui/sword.png" alt="" className="pf-card-icon" /> Knights
                                <span className="pf-card-count">{knights.phase === 'ready' ? fmtInt(knights.data?.balance) : '—'}</span>
                            </h2>
                            {knights.phase === 'error' ? (
                                <p className="pf-warn">{knights.error}</p>
                            ) : (
                                <>
                                    <div className="pf-tier-strip">
                                        {RARITY_ORDER.map((tier) => (
                                            <div className="pf-tier" key={tier}>
                                                <img
                                                    src={knightPfp(tier)}
                                                    alt=""
                                                    className="pf-tier-art"
                                                    style={{ borderColor: RARITY[tier.toUpperCase()].color }}
                                                />
                                                <span className="pf-tier-name" style={{ color: RARITY[tier.toUpperCase()].color }}>
                                                    {RARITY[tier.toUpperCase()].name}
                                                </span>
                                                <span className="pf-tier-count">{fmtInt(byTier[tier])}</span>
                                            </div>
                                        ))}
                                    </div>
                                    {/* A wallet with no knights says so in the count above it. The two
                                        notes that used to sit here advertised a price and an
                                        incomplete read; the price is not this page's to print. */}
                                    {knights.data && !knights.data.complete && (
                                        <p className="pf-note">{knights.data.note}</p>
                                    )}
                                </>
                            )}
                            {/* Blurred with the rest of the gated half: both of these lead into the
                                game, which on the public host is behind the password. A button that
                                bounces a stranger to a password screen is worse than one that is
                                visibly not for them yet. */}
                            <div className="pf-actions pf-blur" aria-hidden="true">
                                <a className="pf-link" href="/mint">Summoning Chamber</a>
                                <a className="pf-link" href="/menu">Knight&rsquo;s Hall</a>
                            </div>
                        </section>

                        {/* ---------------------------------------------- Genesis */}
                        <section className="pf-card pf-soon">
                            <h2 className="pf-card-title">
                                <img src={GENESIS_PFP} alt="" className="pf-card-icon pf-card-icon-round" /> Genesis
                                <span className="pf-card-count">{genesis.phase === 'ready' ? fmtInt(genesis.data?.balance) : '—'}</span>
                                <span className="pf-soon-chip">Coming soon</span>
                            </h2>
                            <div className="pf-soon-body" aria-hidden="true">
                            {genesis.phase === 'error' ? (
                                <p className="pf-warn">{genesis.error}</p>
                            ) : (
                                <>
                                    <dl className="pf-rows">
                                        <Row
                                            label="Hash power owned"
                                            value={genesisList.length ? fmtInt(ownedHashPower) : genesis.phase === 'ready' ? '0' : '—'}
                                            hint={genesisList.length ? 'summed from the collection' : null}
                                        />
                                        <Row
                                            label="Tickets this week"
                                            value={stake?.tickets?.mine != null ? fmtInt(stake.tickets.mine) : stake ? '—' : '—'}
                                            hint={stake?.tickets?.poolTotal != null ? `pool total ${fmtInt(stake.tickets.poolTotal)}` : null}
                                        />
                                        <Row label="Stakers in the pool" value={stake?.tickets?.stakerCount != null ? fmtInt(stake.tickets.stakerCount) : '—'} />
                                    </dl>
                                    {stake?.tickets?.poolReason && <p className="pf-note">{stake.tickets.poolReason}</p>}
                                </>
                            )}
                            {supply?.ok && (
                                <div className="pf-supply">
                                    <div className="pf-supply-head">
                                        <span className="pf-supply-label">Supply minted</span>
                                        <span className="pf-supply-numbers">{fmtInt(supply.minted)} / {fmtInt(supply.max)}</span>
                                    </div>
                                    <div className="pf-supply-track">
                                        <div className="pf-supply-fill" style={{ width: `${supply.max ? (supply.minted / supply.max) * 100 : 0}%` }} />
                                    </div>
                                    {/* The contract's own band table, not a second copy of it: the
                                        names, the ranges and the counts all come back from the
                                        collection, so this list cannot disagree with what minted. */}
                                    <ul className="pf-bands">
                                        {(supply.bands || []).map((band) => (
                                            <li key={band.name}>
                                                <span className="pf-band-name">{band.name}</span>
                                                <span className="pf-band-range">{band.lo}–{band.hi} hp</span>
                                                <span className="pf-band-left">{fmtInt(band.remaining)} left</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {genesis.phase === 'ready' && !genesisList.length && !stake?.staked?.length && (
                                <p className="pf-note">
                                    This wallet holds no Genesis knights. The collection is capped at 1,024 and
                                    mints on OpenSea, not here.
                                </p>
                            )}
                            <div className="pf-actions">
                                <a className="pf-link" href="/staking">Genesis in the vault</a>
                            </div>
                            </div>
                            <p className="pf-soon-note">
                                Genesis hash power, this week&rsquo;s raffle tickets and the pool will read here
                                when this panel opens.
                            </p>
                        </section>

                        {/* ----------------------------------------------- Points */}
                        <section className="pf-card">
                            <h2 className="pf-card-title">
                                <img src={`${ASSETS}Gold_coin_badge_with_PTS_2K_20260919011438-autocrop-hair.png`} alt="" className="pf-card-icon" /> Points
                            </h2>
                            {points.phase === 'anon' && (
                                <>
                                    <p className="pf-note">
                                        Not signed in to the Points Program for this browser. Points are tied to a
                                        wallet rather than a browser, so signing in once makes them appear here.
                                    </p>
                                    <div className="pf-actions">
                                        <a className="pf-link" href="/points">Open the Points Program</a>
                                    </div>
                                </>
                            )}
                            {points.phase === 'other' && (
                                <>
                                    <p className="pf-note">
                                        This browser is signed in to the Points Program as a different
                                        wallet ({shortAddress(points.sessionAddress)}), so its points are not
                                        shown here. Sign in again from the Points page with this wallet to have
                                        them appear.
                                    </p>
                                    <div className="pf-actions">
                                        <a className="pf-link" href="/points">Open the Points Program</a>
                                    </div>
                                </>
                            )}
                            {points.phase === 'error' && <p className="pf-warn">{points.error}</p>}
                            {points.phase === 'ready' && points.data && (
                                <>
                                    <div className="pf-hero">
                                        <span className="pf-hero-value">{fmtInt(points.data.points)}</span>
                                        <span className="pf-hero-label">
                                            points
                                            {points.data.rank ? ` · rank #${fmtInt(points.data.rank)} of ${fmtInt(points.data.players)}` : ''}
                                        </span>
                                    </div>
                                    <dl className="pf-rows">
                                        <Row
                                            label="Vault entries today"
                                            value={`${(points.data.clearedToday || []).length} / 3`}
                                            hint={points.data.entryComplete ? 'cleared' : `${points.data.entryTotalToday ?? 0} so far`}
                                        />
                                        <Row label="Lifetime entries" value={fmtInt(points.data.entries)} />
                                        <Row
                                            label="Referrals"
                                            value={fmtInt((points.data.referrals || []).length)}
                                            hint={`${fmtInt(points.data.referralEarned)} points earned`}
                                        />
                                    </dl>
                                    <div className="pf-actions">
                                        <a className="pf-link" href="/points">Open the Points Program</a>
                                    </div>
                                </>
                            )}
                        </section>

                        {/* --------------------------------------------- Activity */}
                        {/* Points, not dungeon runs. What this panel used to list — runs and their $DNG
                            claims — happens in the vault and in the game, both of which are behind the
                            password on this host; a public page that reads it is a page whose main
                            panel is empty for everybody who is not signed in on the other host.
                            Points activity is what a Points player came here for, and it comes from
                            the server's own log of what it paid, so a row and the balance above it
                            are the same events. */}
                        <section className="pf-card pf-card-wide">
                            <h2 className="pf-card-title">
                                <img src="/assets/ui/castle.png" alt="" className="pf-card-icon" /> Recent activity
                                {recentTotal > 0 && (
                                    <span className="pf-card-count">{fmtInt(recentTotal)} events</span>
                                )}
                            </h2>
                            {points.phase === 'error' && <p className="pf-warn">{points.error}</p>}
                            {points.phase === 'other' && (
                                <p className="pf-note">
                                    Points activity belongs to the wallet this browser is signed in with
                                    ({shortAddress(points.sessionAddress)}), so it is not shown under this one.
                                </p>
                            )}
                            {points.phase === 'anon' && (
                                <p className="pf-note">
                                    Sign in on the Points Program, and every point you earn is listed here.
                                </p>
                            )}
                            {points.phase === 'ready' && (recentLog.length === 0 ? (
                                <p className="pf-note">
                                    {points.data?.points > 0
                                        ? 'Nothing logged yet — history starts with your next points. What was earned before this panel existed is not itemised.'
                                        : 'No points yet. Clear a vault entry on the Points Program and it appears here.'}
                                </p>
                            ) : (
                                <ul className="pf-activity pf-activity-points">
                                    {recentLog.map((entry) => (
                                        <li key={`${entry.at}-${entry.reason}`}>
                                            <span className="pf-act-when">{shortWhen(entry.at)}</span>
                                            <span className="pf-act-what">{describeEarn(entry.reason)}</span>
                                            <span className="pf-act-reward">+{fmtInt(entry.points)} PTS</span>
                                        </li>
                                    ))}
                                </ul>
                            ))}
                            {points.phase !== 'ready' && points.phase !== 'error' && points.phase !== 'anon'
                                && points.phase !== 'other' && <p className="pf-note">Reading your points…</p>}
                        </section>
                    </div>

                    <p className="pf-footnote">
                        Every figure on this page is read from Robinhood Chain and the game&rsquo;s own API each
                        time it loads. Nothing is cached against your wallet, and nothing here can move a token.
                    </p>
                </main>
            </div>
        </>
    );
}

/**
 * The header the rest of the site has: the way back, the title, the wallet and the menu.
 *
 * Same contract as the vault and the Points page — the address chip disconnects, and the pill
 * carries the menu — because a header that behaves differently on one route is a header a player
 * has to learn twice.
 *
 * The two controls say different things on purpose. The chip is *who* is connected; the pill is
 * the figure the page is about, which is where the vault puts its weekly pool and the Points page
 * its standing. Printing the address in both was the first version, and it read as a stutter —
 * the same six characters twice in one row, with nothing to tell them apart.
 */
function Header({ pillRef, address, onDisconnect, balance }) {
    return (
        <header className="header">
            <button className="btn btn-ghost btn-sm" onClick={() => { window.location.href = '/'; }}>
                <img src="assets/ui/exit cross.png" className="btn-icon-img" alt="" /> Kingdom Gate
            </button>
            <div className="header-title">MY PORTFOLIO</div>
            <div className="header-actions">
                {address && (
                    <button className="btn btn-ghost btn-sm wallet-chip" onClick={onDisconnect} title="Click to disconnect">
                        <span className="wallet-chip-dot" aria-hidden="true" />
                        {shortAddress(address)}
                    </button>
                )}
                <div className="wallet-pill" ref={pillRef}>
                    <span>{address ? (balance || '—') : 'CONNECT'}</span>
                </div>
            </div>
        </header>
    );
}

function Row({ label, value, hint }) {
    return (
        <div className="pf-row">
            <dt>{label}</dt>
            <dd>
                {value}
                {hint ? <span className="pf-row-hint">{hint}</span> : null}
            </dd>
        </div>
    );
}
