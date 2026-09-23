'use client';

/**
 * The $DNG economy, as a page.
 *
 * The token maths lives in `lib/reward-config.js` and is asserted by
 * `tools/check-token-math.js`; the vault and the Summoning Chamber each show the slice of it
 * they spend. This page is the whole thing in one place, and it exists because the plan's
 * numbers were otherwise only readable in `WHITEPAPER.md` — which is a document a player has
 * to be told to go and find.
 *
 * Two rules it follows, both of which are project rules rather than preferences:
 *
 *   - **Nothing here is typed in.** Every figure is computed from the same module the
 *     contracts are deployed from, so a page that disagrees with the contract is not a
 *     possible state. `check-token-math` fails if the model moves under a document; this page
 *     moves with the model instead.
 *   - **The uncertain parts say so.** Participation is not known, so the scale is described
 *     as a formula with one worked scenario rather than as a forecast, and the funding gap is
 *     stated as a number rather than implied away.
 *
 * The one control on the page is that scenario, and it is a deliberate exception to the rule
 * that this project does not let players drag numbers: the thing being demonstrated is a
 * *published formula* (`scale = min(1, budget ÷ last week's burn)`) whose behaviour at 1× is
 * exactly the published table. The old "if the weekly pool were" slider went away because the
 * pool was unknowable, not because sliders are banned.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Script from 'next/script';
import { SITE_NAME } from '../../lib/site';
import { forgetWallet, savedAddress, shortAddress } from '../../lib/points-client';
import {
    CAPSULES_PER_WEEK,
    GENESIS_SUPPLY,
    HASH_POWER_BANDS,
    HASH_POWER_MAX,
    HASH_POWER_MIN,
    KNIGHTS_REFERENCE_SIZE,
} from '../../lib/staking-config';
import {
    KNIGHT_TIERS,
    RARITY,
    dailyCapacity,
    expectedClearsPerDay,
    expectedRewardPerDay,
} from '../../lib/knights';
import {
    DISTRIBUTION,
    DNG_DECIMALS,
    DNG_SUPPLY,
    GENESIS_DAILY_CAPACITY,
    GENESIS_DAILY_RUNS,
    GENESIS_REWARD_PER_CLEAR,
    MIN_WEEKS,
    REFERENCE_GENESIS_ACTIVE,
    REFERENCE_KNIGHTS_ACTIVE,
    REWARD_VAULT_DNG,
    STAKING_SHARE_OF_DUNGEON,
    SUMMON_PRICE_DNG,
    capsuleBreakEvenMinted,
    capsuleOpenPrice,
    epochScale,
    fundingPerYearDng,
    horizonDays,
    lineBps,
    lineBudgets,
    lineShares,
    referenceBurnPerDay,
    referenceLines,
    weeklyBudgetDng,
    worstCaseBurnPerDay,
} from '../../lib/reward-config';

/**
 * The four lines, in the order `RewardVault`'s constructor takes them, with what each pays
 * spelled out. The `pays` strings are the contract's behaviour, not marketing: a line that
 * cannot describe its own payout is a line that has not been designed.
 */
const LINES = [
    {
        key: 'genesisDungeon',
        label: 'Genesis · dungeon',
        collection: 'genesis',
        pays: (v) => `${GENESIS_REWARD_PER_CLEAR} DNG a clear, ${GENESIS_DAILY_RUNS} runs a day — flat, whatever the hash power`,
    },
    {
        key: 'genesisStaking',
        label: 'Genesis · staking',
        collection: 'genesis',
        pays: () => `the weekly raffle pool, split by ticket share — ${pct(STAKING_SHARE_OF_DUNGEON)} of dungeon income`,
    },
    {
        key: 'knightsDungeon',
        label: 'Knights · dungeon',
        collection: 'knights',
        pays: () => `${KNIGHT_TIERS.map((t) => RARITY[t].dungeonReward).join(' / ')} DNG by tier`,
    },
    {
        key: 'knightsStaking',
        label: 'Knights · staking',
        collection: 'knights',
        pays: () => `yield only, no raffle tickets — ${pct(STAKING_SHARE_OF_DUNGEON)} of dungeon income`,
    },
];

// ------------------------------------------------------------------ formatting
function fmt(value, decimals = 0) {
    if (!Number.isFinite(value)) return '—';
    return Number(value).toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
}

function pct(fraction, decimals = 0) {
    if (!Number.isFinite(fraction)) return '—';
    return `${(fraction * 100).toFixed(decimals)}%`;
}

function compact(value) {
    if (!Number.isFinite(value)) return '—';
    const abs = Math.abs(value);
    if (abs >= 1e9) return `${(value / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
    if (abs >= 1e6) return `${(value / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
    if (abs >= 1e3) return `${(value / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}k`;
    return fmt(value, 0);
}

function years(days) {
    if (!Number.isFinite(days) || days <= 0) return '—';
    if (days < 1) return `${(days * 24).toFixed(1)} hours`;
    if (days < 90) return `${fmt(days, days < 10 ? 1 : 0)} days`;
    return `${(days / 365.25).toFixed(1)} years`;
}

// ---------------------------------------------------------------------- the page
export default function TokenomicsClient() {
    const model = useMemo(() => {
        const shares = lineShares();
        const budgets = lineBudgets();
        const lines = referenceLines();
        const budget = weeklyBudgetDng();
        return {
            shares,
            budgets,
            lines,
            budget,
            bps: lineBps(),
            burn: referenceBurnPerDay(),
            worstBurn: worstCaseBurnPerDay(),
            worstDays: horizonDays(REWARD_VAULT_DNG, worstCaseBurnPerDay()),
            worstScale: epochScale(worstCaseBurnPerDay(), budget),
            horizon: horizonDays(REWARD_VAULT_DNG),
            funding: fundingPerYearDng(),
            expectedKnightsPerDay: expectedRewardPerDay(),
            expectedKnightsClears: expectedClearsPerDay(),
            breakEven: capsuleBreakEvenMinted(),
        };
    }, []);

    // The scenario multiple: how many times the reference population turns up. It starts at
    // 1 because that is the one position the published table is a *quote* rather than a
    // demonstration, and the page says so.
    const [multiple, setMultiple] = useState(1);
    const scenario = useMemo(() => {
        const burn = model.burn * multiple;
        const scale = epochScale(burn, model.budget);
        return { burn, scale, overspend: Math.max(0, burn - model.budget) };
    }, [multiple, model]);

    const slots = KNIGHT_TIERS.length;
    // Bands carry `lo`/`hi`, not a single `hashPower` — taking a floor off a field that does
    // not exist renders "NaN HP at the bottom" rather than failing, which is exactly what
    // happened here first time round.
    const hashPowerFloor = Math.min(...HASH_POWER_BANDS.map((b) => b.lo));

    // ------------------------------------------------------------------ the wallet control
    // Every route in the site puts the same pill in the same corner, and the menu it carries is
    // the only way to reach My Portfolio. This page used the pill's class for a supply readout
    // instead, which is a label wearing a control's clothes — the menu would have hung off it and
    // offered to "Connect Wallet" over a number about the token. The pill is now a wallet and the
    // supply sits beside it as the label it always was.
    const [address, setAddress] = useState(null);
    const [balance, setBalance] = useState(null);
    const walletPill = useRef(null);
    const handleDisconnectRef = useRef(() => {});

    useEffect(() => setAddress(savedAddress()), []);

    // The balance is a server read, the same `/api/wallet/balance` the Portfolio page uses: this
    // page loads no chain library, and the browser contributes an address and nothing else. A
    // failed read stays `null` and renders an em dash, never a zero it did not read.
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
        return () => { cancelled = true; };
    }, [address]);

    const handleDisconnect = () => {
        forgetWallet();
        setAddress(null);
    };
    handleDisconnectRef.current = handleDisconnect;

    // Attached by hand: this route mounts after hydration, so a module scanning the DOM at load
    // would run before the pill exists.
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

    // The same two the vault loads, and for the same reason: `theme.css` is what defines every
    // `--accent-gold` this page uses, and it lives at the root, not in `css/`. The first build
    // of this page asked for `/css/theme.css`, which 404s — so it rendered with no variables at
    // all and every DOM assertion still passed, because a missing stylesheet throws nothing.
    // The battery now fetches each href and checks that a themed colour really applies.
    const pageStyles = (
        <>
            {/* Versioned like every other sheet in the site: an unversioned `/theme.css` is a CSS
                change that never reaches a returning player. */}
            <link rel="stylesheet" href="/theme.css?v=7" />
            <link rel="stylesheet" href="/css/tokenomics.css?v=2" />
            {/* The header's wallet pill carries the same menu every other route's control has.
                No ethers: the balance on this page is a server read. */}
            <Script src="/wallet-source.js?v=3" strategy="afterInteractive" />
            <Script src="/wallet-menu.js?v=1" strategy="afterInteractive" />
        </>
    );

    return (
        <>
            {pageStyles}
            <div className="page tk-page">

                <header className="header">
                    <button className="btn btn-ghost btn-sm" onClick={() => { window.location.href = '/'; }}>
                        <img src="assets/ui/exit cross.png" className="btn-icon-img" alt="" /> Kingdom Gate
                    </button>
                    <div className="header-title">$DNG ECONOMY</div>
                    <div className="header-actions">
                        <span className="tk-num tk-supply">SUPPLY · {compact(DNG_SUPPLY)} DNG</span>
                        {address && (
                            <button className="btn btn-ghost btn-sm wallet-chip" onClick={handleDisconnect} title="Click to disconnect">
                                <span className="wallet-chip-dot" aria-hidden="true" />
                                {shortAddress(address)}
                            </button>
                        )}
                        {/* The pill is the wallet control: the chip beside it says who, this says
                            what, and the menu off it opens My Portfolio. Connecting is the menu's
                            own first item, exactly as it is on every legacy page — the pill
                            deliberately carries no click of its own, because the menu already
                            owns that click and two meanings for it is worse than one. */}
                        <div className="wallet-pill" ref={walletPill}>
                            <span>
                                {address
                                    ? (balance === null ? '— DNG' : `${fmt(balance)} DNG`)
                                    : 'CONNECT'}
                            </span>
                        </div>
                    </div>
                </header>

                <main className="tk-main">

                    {/* ------------------------------------------------------------- hero */}
                    <section className="tk-hero">
                        <div className="tk-hero-mark" aria-hidden="true">
                            <span className="tk-coin">$DNG</span>
                        </div>
                        <div className="tk-hero-body">
                            <h1 className="tk-h1">{fmt(DNG_SUPPLY)} $DNG, one mint, no emission</h1>
                            <p className="tk-lede">
                                A single fixed supply of {fmt(DNG_SUPPLY)} tokens on {DNG_DECIMALS} decimals. Nothing
                                can mint more; the game's rewards are paid out of one bucket that is funded before it
                                pays, and the mechanism that keeps that true is a <strong>weekly budget with a scale</strong> —
                                not a promise that a clear is worth a fixed number forever.
                            </p>
                            <div className="tk-hero-chips">
                                <span className="tk-chip">No team allocation</span>
                                <span className="tk-chip">No emission</span>
                                <span className="tk-chip">Two collections, one vault</span>
                                <span className="tk-chip is-quiet">Testnet — nothing below is live yet</span>
                            </div>
                        </div>
                    </section>

                    {/* ----------------------------------------------------- distribution */}
                    <section className="tk-section">
                        <div className="tk-section-head">
                            <h2 className="tk-h2">Where the supply goes</h2>
                            <p className="tk-section-sub">
                                Custody is part of the promise. A bucket with no holder and no schedule is a bucket
                                that will move without warning, so each one names where it sits.
                            </p>
                        </div>

                        <div className="tk-dist-bar" role="img" aria-label={DISTRIBUTION.map((b) => `${b.name} ${b.pct}%`).join(', ')}>
                            {DISTRIBUTION.filter((b) => b.pct > 0).map((bucket) => (
                                <span
                                    key={bucket.key}
                                    className="tk-dist-seg"
                                    data-bucket={bucket.key}
                                    style={{ width: `${bucket.pct}%` }}
                                >
                                    {bucket.pct >= 8 && <span className="tk-dist-seg-label">{bucket.pct}%</span>}
                                </span>
                            ))}
                        </div>

                        <div className="tk-dist-grid">
                            {DISTRIBUTION.map((bucket) => (
                                <div className="tk-dist-card" key={bucket.key} data-bucket={bucket.key}>
                                    <div className="tk-dist-head">
                                        <span className="tk-dist-dot" aria-hidden="true" />
                                        <span className="tk-dist-name">{bucket.name}</span>
                                        <span className="tk-dist-pct tk-num">{bucket.pct}%</span>
                                    </div>
                                    <div className="tk-dist-amount tk-num">
                                        {bucket.pct === 0 ? '—' : `${compact((DNG_SUPPLY * bucket.pct) / 100)} DNG`}
                                    </div>
                                    <div className="tk-dist-custody">{bucket.custody}</div>
                                </div>
                            ))}
                        </div>

                        <div className="tk-note is-warn">
                            <strong>Two consequences worth saying out loud.</strong> There is <em>no team bucket at
                            all</em>, so the {DISTRIBUTION.find((b) => b.key === 'treasury')?.pct}% treasury is the only
                            money that funds operations and development. And marketing is not cliffed or vested, so it
                            is the one bucket that can reach the market from day one — which is why its spend cadence has
                            to be disclosed rather than a lock pointed at.
                        </div>
                    </section>

                    {/* ------------------------------------------------------- the vault */}
                    <section className="tk-section">
                        <div className="tk-section-head">
                            <h2 className="tk-h2">One vault, one budget, four lines</h2>
                            <p className="tk-section-sub">
                                The reward vault is the only bucket that gets spent. It releases{' '}
                                <strong>{fmt(model.budget)} DNG a week</strong> ({fmt(model.burn)} a day), and that
                                number is partitioned into four lines <em>by share</em> — which is what makes Genesis's
                                cut permanent: the uncapped Knights collection cannot dilute it by growing.
                            </p>
                        </div>

                        <div className="tk-budget">
                            <div className="tk-budget-main">
                                <span className="tk-budget-value tk-num">{fmt(model.budget)}</span>
                                <span className="tk-budget-unit">DNG released each week</span>
                            </div>
                            <div className="tk-budget-side">
                                <div className="tk-budget-fact">
                                    <span className="tk-budget-fact-label">Vault held</span>
                                    <span className="tk-num">{fmt(REWARD_VAULT_DNG)}</span>
                                </div>
                                <div className="tk-budget-fact">
                                    <span className="tk-budget-fact-label">On-chain shares</span>
                                    <span className="tk-num">{model.bps.join(' / ')}</span>
                                </div>
                                <div className="tk-budget-fact">
                                    <span className="tk-budget-fact-label">Budget cap</span>
                                    <span className="tk-num">balance ÷ {MIN_WEEKS} weeks</span>
                                </div>
                            </div>
                        </div>

                        <div className="tk-lines">
                            {LINES.map((line) => {
                                const share = model.shares[line.key];
                                const budget = model.budgets[line.key];
                                return (
                                    <div className="tk-line" key={line.key} data-collection={line.collection}>
                                        <div className="tk-line-top">
                                            <span className="tk-line-label">{line.label}</span>
                                            <span className="tk-line-numbers">
                                                <span className="tk-num tk-line-share">{pct(share, 2)}</span>
                                                <span className="tk-num tk-line-dng">{fmt(budget)} / week</span>
                                            </span>
                                        </div>
                                        <div className="tk-line-bar" aria-hidden="true">
                                            <span className="tk-line-fill" style={{ width: `${share * 100}%` }} />
                                        </div>
                                        <div className="tk-line-pays">
                                            {line.pays()} · <span className="tk-num">{compact(model.lines[line.key])} DNG a day at the reference</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="tk-note">
                            <strong>Why these four shares and not round numbers.</strong> They are
                            <em> derived</em>, not chosen: each is that line's spend at the reference population
                            divided by the total, and each staking line is {pct(STAKING_SHARE_OF_DUNGEON)} of its
                            collection's dungeon line by construction. The vault's constructor takes the same numbers
                            as basis points ({model.bps.join(' / ')}) and <strong>reverts unless they sum to
                            10,000</strong>, so the partition on this page is the partition on chain.
                        </div>
                    </section>

                    {/* ------------------------------------------------------- the scale */}
                    <section className="tk-section">
                        <div className="tk-section-head">
                            <h2 className="tk-h2">What happens when more knights turn up</h2>
                            <p className="tk-section-sub">
                                This is the part most economies get wrong, so it is worth being exact. The table below is
                                paid at <strong>scale 1.00</strong> to a published reference population — about{' '}
                                {pct(REFERENCE_GENESIS_ACTIVE / GENESIS_SUPPLY)} of the Genesis collection and{' '}
                                {pct(REFERENCE_KNIGHTS_ACTIVE / KNIGHTS_REFERENCE_SIZE)} of the reference Knights population playing daily. Above
                                that, one scale moves <em>every</em> number down together, so the ratios survive at
                                whatever level is fundable.
                            </p>
                        </div>

                        <div className="tk-formula" aria-label="The scale formula">
                            <code>epochScale = min( 1, weeklyBudget ÷ lastWeekBurn )</code>
                        </div>

                        <div className="tk-scenario" data-scenario={multiple === 1 ? 'reference' : 'above'}>
                            <div className="tk-scenario-head">
                                <label className="tk-scenario-label" htmlFor="tk-multiple">
                                    If participation were
                                </label>
                                <span className="tk-scenario-value tk-num">
                                    {multiple.toFixed(multiple < 10 ? 1 : 0)}× the reference
                                </span>
                            </div>
                            <input
                                id="tk-multiple"
                                className="tk-range"
                                type="range"
                                min="1"
                                max="20"
                                step="0.5"
                                value={multiple}
                                onChange={(event) => setMultiple(Number(event.target.value))}
                                aria-label="Participation as a multiple of the reference population"
                                aria-valuetext={`${multiple} times the reference population`}
                            />
                            <div className="tk-scenario-ticks" aria-hidden="true">
                                {[1, 5, 10, 15, 20].map((tick) => (
                                    <span key={tick} className="tk-num">{tick}×</span>
                                ))}
                            </div>

                            <div className="tk-scenario-out">
                                <div className="tk-scenario-cell">
                                    <span className="tk-scenario-cell-label">Demand this week</span>
                                    <span className="tk-num">{compact(scenario.burn)} DNG</span>
                                    <span className="tk-scenario-cell-sub">what the table would pay out</span>
                                </div>
                                <div className="tk-scenario-cell is-key">
                                    <span className="tk-scenario-cell-label">Scale</span>
                                    <span className="tk-num is-gold">×{scenario.scale.toFixed(2)}</span>
                                    <span className="tk-scenario-cell-sub">
                                        {scenario.scale >= 1 ? 'the full table is payable' : 'every reward moves down together'}
                                    </span>
                                </div>
                                <div className="tk-scenario-cell">
                                    <span className="tk-scenario-cell-label">A Genesis clear pays</span>
                                    <span className="tk-num">{fmt(GENESIS_REWARD_PER_CLEAR * scenario.scale, scenario.scale < 1 ? 1 : 0)} DNG</span>
                                    <span className="tk-scenario-cell-sub">instead of {GENESIS_REWARD_PER_CLEAR}</span>
                                </div>
                                <div className="tk-scenario-cell">
                                    <span className="tk-scenario-cell-label">A Legendary clear pays</span>
                                    <span className="tk-num">{fmt(RARITY.LEGENDARY.dungeonReward * scenario.scale, scenario.scale < 1 ? 1 : 0)} DNG</span>
                                    <span className="tk-scenario-cell-sub">instead of {RARITY.LEGENDARY.dungeonReward}</span>
                                </div>
                            </div>

                            <svg className="tk-curve" viewBox="0 0 300 80" role="img"
                                aria-label={`Scale as participation rises: ${scenario.scale.toFixed(2)} at ${multiple} times the reference`}>
                                <line className="tk-curve-axis" x1="0" y1="72" x2="300" y2="72" />
                                <polyline
                                    className="tk-curve-line"
                                    points={Array.from({ length: 61 }, (_, i) => {
                                        const m = 1 + (i * 19) / 60;
                                        const s = Math.min(1, 1 / m);
                                        return `${(i * 5).toFixed(1)},${(72 - s * 64).toFixed(1)}`;
                                    }).join(' ')}
                                />
                                <line
                                    className="tk-curve-mark"
                                    x1={((multiple - 1) / 19) * 300}
                                    y1="0"
                                    x2={((multiple - 1) / 19) * 300}
                                    y2="72"
                                />
                                <circle
                                    className="tk-curve-dot"
                                    cx={((multiple - 1) / 19) * 300}
                                    cy={72 - scenario.scale * 64}
                                    r="3.5"
                                />
                            </svg>

                            <p className="tk-scenario-fine">
                                {multiple === 1
                                    ? 'At the reference the table is a quote, not a demonstration: every number on this page is what a clear actually pays.'
                                    : 'A scenario, not a forecast. The formula is published; this shows what it does, and what it does is protect the vault rather than the expectation.'}
                                {' '}Under-spending is the other half: when fewer knights play, the lines simply go
                                unspent and the vault lengthens its own runway.
                            </p>
                        </div>

                        <div className="tk-limit-grid">
                            <div className="tk-limit">
                                <span className="tk-limit-label">At the reference</span>
                                <span className="tk-limit-value tk-num">{years(model.horizon)}</span>
                                <span className="tk-limit-sub">
                                    of runway from {compact(REWARD_VAULT_DNG)} held, at {fmt(model.burn)} DNG a day
                                </span>
                            </div>
                            <div className="tk-limit">
                                <span className="tk-limit-label">If everyone played and staked</span>
                                <span className="tk-limit-value tk-num">{fmt(model.worstDays, 0)} days</span>
                                <span className="tk-limit-sub">
                                    scale falls to ×{model.worstScale.toFixed(2)} — the vault shrinks its own payouts
                                    instead of running dry
                                </span>
                            </div>
                            <div className="tk-limit">
                                <span className="tk-limit-label">Holding the table forever</span>
                                <span className="tk-limit-value tk-num">{compact(model.funding)} DNG / year</span>
                                <span className="tk-limit-sub">
                                    what has to reach the vault for scale 1.00 to be permanent
                                </span>
                            </div>
                        </div>
                    </section>

                    {/* --------------------------------------------------- reward tables */}
                    <section className="tk-section">
                        <div className="tk-section-head">
                            <h2 className="tk-h2">The table, at scale 1.00</h2>
                            <p className="tk-section-sub">
                                Two collections with different jobs. Genesis is a fixed{' '}
                                {fmt(GENESIS_SUPPLY)}-knight collection that pays the <em>same</em> per clear whatever
                                its hash power — its rarity proxy moves its passive income instead. Knights scale with
                                tier, and their number is uncapped.
                            </p>
                        </div>

                        <div className="tk-table-grid">

                            <div className="tk-table-card" data-collection="genesis">
                                <div className="tk-table-head">
                                    <span className="tk-table-title">Genesis Knights</span>
                                    <span className="tk-table-tag tk-num">{fmt(GENESIS_SUPPLY)} fixed</span>
                                </div>
                                <div className="tk-table-hero">
                                    <span className="tk-table-hero-value tk-num">{GENESIS_REWARD_PER_CLEAR}</span>
                                    <span className="tk-table-hero-unit">DNG per clear, flat</span>
                                </div>
                                <dl className="tk-facts">
                                    <div><dt>Runs a day</dt><dd className="tk-num">{GENESIS_DAILY_RUNS}</dd></div>
                                    <div><dt>Ceiling a day</dt><dd className="tk-num">{fmt(GENESIS_DAILY_CAPACITY)} DNG</dd></div>
                                    <div><dt>Hash power</dt><dd className="tk-num">{HASH_POWER_MIN} – {fmt(HASH_POWER_MAX)}</dd></div>
                                    <div><dt>Can stake</dt><dd>Yes — raffle tickets + yield</dd></div>
                                    <div><dt>Can enter the raffle</dt><dd>Yes, and only Genesis can</dd></div>
                                    <div><dt>Minted by</dt><dd>OpenSea, in ETH — no in-app mint</dd></div>
                                </dl>
                                <div className="tk-band-strip" aria-hidden="true">
                                    {HASH_POWER_BANDS.map((band) => (
                                        <span
                                            key={band.key}
                                            className="tk-band"
                                            style={{ flexGrow: band.count }}
                                            title={`${band.name} · ${band.count} knights · ${band.lo}–${band.hi} HP`}
                                        />
                                    ))}
                                </div>
                                <p className="tk-table-fine">
                                    {HASH_POWER_BANDS.length} published bands, {fmt(HASH_POWER_BANDS.reduce((s, b) => s + b.count, 0))}{' '}
                                    knights, {hashPowerFloor} HP at the bottom. Hash power decides staking yield and
                                    raffle odds — never the dungeon payout.
                                </p>
                            </div>

                            <div className="tk-table-card" data-collection="knights">
                                <div className="tk-table-head">
                                    <span className="tk-table-title">Knights</span>
                                    <span className="tk-table-tag tk-num">no supply limit</span>
                                </div>
                                <div className="tk-table-scroll">
                                    <table className="tk-tier-table">
                                        <caption className="tk-sr-only">
                                            Knight tiers: drop rate, reward per clear, daily runs, ceiling and hash power
                                        </caption>
                                        <thead>
                                            <tr>
                                                <th scope="col">Tier</th>
                                                <th scope="col">Drop</th>
                                                <th scope="col">Per clear</th>
                                                <th scope="col">Runs</th>
                                                <th scope="col">A day</th>
                                                <th scope="col">HP</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {KNIGHT_TIERS.map((key) => {
                                                const tier = RARITY[key];
                                                return (
                                                    <tr key={key} data-tier={key}>
                                                        <th scope="row">
                                                            <span className="tk-tier-dot" style={{ background: tier.color }} aria-hidden="true" />
                                                            {tier.name}
                                                        </th>
                                                        <td className="tk-num">{pct(tier.dropRate, tier.dropRate < 0.05 ? 1 : 0)}</td>
                                                        <td className="tk-num is-strong">{tier.dungeonReward}</td>
                                                        <td className="tk-num">{tier.dailyRuns}</td>
                                                        <td className="tk-num">{fmt(dailyCapacity(key))}</td>
                                                        <td className="tk-num">{tier.hashPower}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                                <dl className="tk-facts">
                                    <div>
                                        <dt>Expected earnings</dt>
                                        <dd className="tk-num">
                                            {fmt(model.expectedKnightsPerDay, 1)} DNG a day, {fmt(model.expectedKnightsClears, 2)} clears
                                        </dd>
                                    </div>
                                    <div>
                                        <dt>A summon costs</dt>
                                        <dd className="tk-num">{SUMMON_PRICE_DNG} DNG</dd>
                                    </div>
                                    <div>
                                        <dt>Hash power</dt>
                                        <dd className="tk-num">
                                            {KNIGHT_TIERS.map((t) => RARITY[t].hashPower).join(' / ')}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt>Can enter the raffle</dt>
                                        <dd>No — Genesis only. Knights earn yield only</dd>
                                    </div>
                                </dl>
                                <p className="tk-table-fine">
                                    Hash power is <strong>capacity ÷ 4</strong>, so every tier stakes at exactly{' '}
                                    {pct(STAKING_SHARE_OF_DUNGEON)} of its own dungeon income. A table of round numbers
                                    (5 / 8 / 15 / 40 / 100) was drafted first and made a Legendary staker earn
                                    &ldquo;2.1× its dungeon income and a Common 0.7×&rdquo; — the ratio has to be
                                    derived from the tier's own capacity or it is just a second, quieter reward table.
                                </p>
                            </div>
                        </div>

                        <div className="tk-note">
                            <strong>{slots} tiers, {slots} on-chain reward slots.</strong> Every reward contract declares
                            the same tier count, so a sixth tier is not a balance change — it is a knight that reverts on
                            every claim. That is why the old Mythic tier and its capsule were removed rather than
                            re-priced.
                        </div>
                    </section>

                    {/* ------------------------------------------------------- capsules */}
                    <section className="tk-section">
                        <div className="tk-section-head">
                            <h2 className="tk-h2">The only way a Knight enters circulation</h2>
                            <p className="tk-section-sub">
                                <strong>{CAPSULES_PER_WEEK}</strong> capsules are awarded each week by the raffle, to
                                staked Genesis Knights. They are never sold. Opening one burns it and reveals a Knight at
                                the drop rates above — and the price rises with the collection, because a flat fee cannot
                                price a growing one.
                            </p>
                        </div>

                        <div className="tk-capsule">
                            <img className="tk-capsule-art" src="assets/images/capsule.png" alt="" />
                            <div className="tk-capsule-body">
                                <div className="tk-capsule-price">
                                    <div className="tk-capsule-price-now">
                                        <span className="tk-num is-gold">{fmt(capsuleOpenPrice(0))}</span>
                                        <span className="tk-capsule-price-unit">DNG at zero Knights</span>
                                    </div>
                                    <span className="tk-capsule-arrow" aria-hidden="true">&#10230;</span>
                                    <div className="tk-capsule-price-now">
                                        <span className="tk-num is-gold">{fmt(capsuleOpenPrice(KNIGHTS_REFERENCE_SIZE))}</span>
                                        <span className="tk-capsule-price-unit">DNG at {fmt(KNIGHTS_REFERENCE_SIZE)}</span>
                                    </div>
                                </div>

                                <div className="tk-capsule-track" role="img"
                                    aria-label={`The open price climbs from ${capsuleOpenPrice(0)} DNG to ${capsuleOpenPrice(KNIGHTS_REFERENCE_SIZE)} DNG, covering both Knights reward lines from about ${fmt(model.breakEven)} Knights`}>
                                    <span className="tk-capsule-fill" />
                                    <span
                                        className="tk-capsule-marker"
                                        style={{ left: `${(model.breakEven / KNIGHTS_REFERENCE_SIZE) * 100}%` }}
                                    />
                                </div>
                                <div className="tk-capsule-scale">
                                    <span>0 Knights</span>
                                    <span className="tk-num">break-even ~{compact(model.breakEven)}</span>
                                    <span className="tk-num">{compact(KNIGHTS_REFERENCE_SIZE)} Knights</span>
                                </div>

                                <p className="tk-capsule-fine">
                                    The marker is the crossover: from about <strong>{fmt(model.breakEven)} Knights</strong>{' '}
                                    the {CAPSULES_PER_WEEK} weekly opens alone cover <em>both</em> Knights lines
                                    ({fmt((model.lines.knightsDungeon + model.lines.knightsStaking) * 7)} DNG a week at the
                                    reference). Below it, the faucet is subsidised — which is the honest thing to state,
                                    because a capsule faucet that funds itself from day one would mean the Knights lines
                                    are nearly empty.
                                </p>
                                <p className="tk-capsule-fine">
                                    The ramp is measured against {fmt(KNIGHTS_REFERENCE_SIZE)} Knights, and it is{' '}
                                    <strong>flat above that</strong>: the collection has no supply limit, so the ten-thousandth
                                    knight and the hundred-thousandth cost the same {fmt(capsuleOpenPrice(KNIGHTS_REFERENCE_SIZE))} DNG
                                    to reveal while each earns less than the one before.
                                </p>
                            </div>
                        </div>
                    </section>

                    {/* --------------------------------------------------------- honesty */}
                    <section className="tk-section">
                        <div className="tk-section-head">
                            <h2 className="tk-h2">What is not true yet</h2>
                            <p className="tk-section-sub">
                                Every number above is derived and machine-checked. None of it is on chain. Stating the
                                gap is part of the design, not a disclaimer bolted on afterwards.
                            </p>
                        </div>
                        <ul className="tk-truth">
                            <li>
                                <strong>The vault is not funded.</strong> {compact(REWARD_VAULT_DNG)} DNG is the plan's
                                allocation; the deployed reward contract holds a fraction of that. The model does not care
                                — the budget is capped at <em>balance ÷ {MIN_WEEKS} weeks</em>, so an under-funded vault
                                pays less rather than paying what it does not have.
                            </li>
                            <li>
                                <strong>Nothing can be claimed for real.</strong> The Phase 2 contracts are not deployed,
                                so the vault and the Summoning Chamber both run their labelled preview state.
                            </li>
                            <li>
                                <strong>Participation is unknown.</strong> The reference population is a published
                                assumption, not a measurement. It is shown by name ({fmt(REFERENCE_GENESIS_ACTIVE)}{' '}
                                Genesis, {fmt(REFERENCE_KNIGHTS_ACTIVE)} Knights) precisely so it can be argued with.
                            </li>
                            <li>
                                <strong>The Genesis mint price is undecided.</strong> It happens on OpenSea in ETH, and
                                ETH proceeds converted into the vault are the realistic source of the{' '}
                                {compact(model.funding)} DNG a year that scale 1.00 needs permanently.
                            </li>
                            <li>
                                <strong>Points are a closed loop.</strong> The Points Program pays no $DNG and has no
                                conversion path. That is safe only while it stays that way.
                            </li>
                        </ul>
                    </section>

                    <footer className="tk-footer">
                        <p>
                            Every figure on this page is computed from the same module the contracts are deployed from,
                            and `tools/check-token-math.js` fails the build if the documents drift from it. See{' '}
                            <strong>tokenomics.md</strong> for the derivation and <strong>WHITEPAPER.md</strong> for the
                            argument.
                        </p>
                        <div className="tk-footer-actions">
                            <button className="btn btn-secondary btn-md" onClick={() => { window.location.href = '/staking'; }}>
                                Staking Vault
                            </button>
                            <button className="btn btn-secondary btn-md" onClick={() => { window.location.href = '/mint'; }}>
                                Summoning Chamber
                            </button>
                            <button className="btn btn-primary btn-md" onClick={() => { window.location.href = '/'; }}>
                                Back to {SITE_NAME}
                            </button>
                        </div>
                    </footer>
                </main>
            </div>
        </>
    );
}
