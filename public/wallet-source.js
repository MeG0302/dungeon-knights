/**
 * Where a Web3 provider comes from — one place, for every page.
 *
 * The game, the mint, the vault, the Hall and the Points page all reach the chain through
 * `window.ethereum`. On a desktop with an extension installed that is fine; on a phone no
 * wallet injects anything into the page, so the site is unusable there. This file is the
 * seam that fixes it without touching any call site.
 *
 * **Privy is the login now, and it is a React provider.** `app/providers.js` wraps every
 * route — including the legacy bodies, which render inside the React tree — and
 * `app/privy-bridge.js` publishes the signed-in wallet as `window.privyBridge`. That is
 * where MetaMask, Coinbase, WalletConnect, Rainbow and email sign-in come from; this file
 * does not open a login of its own. It used to, through Privy's low-level `js-sdk-core`
 * and a hand-written email-code modal, and that whole path is gone: Privy document that
 * core library as unsupported for general use, and two Privy clients on one page is how a
 * site ends up with two ideas of who the player is.
 *
 * What is left is the piece the legacy pages actually need, and it resolves in this order:
 *
 *   1. **A signed-in Privy session** — the bridge is asked for its provider, and while that
 *      session is live it wins everywhere, including `window.ethereum`, so the roster, the
 *      dungeon and the vault cannot disagree about who is playing.
 *   2. **An injected extension** — when nobody is signed in through Privy, an extension is
 *      left exactly as it was and is never shadowed, including when it arrives late
 *      (`ethereum#initialized`).
 *   3. **Nothing** — `unavailableMessage()` says what to do about it, instead of pointing a
 *      phone at a browser extension it cannot install.
 *
 * **Dormant by default.** With no `PRIVY_APP_ID` on the server, `app/providers.js` renders
 * no provider, no bridge is ever published, and behaviour here is exactly what it was
 * before any of this existed: the extension, or the honest message. That is the guarantee
 * that lets the whole app ship with Privy switched off.
 *
 * Nothing secret reaches the browser. The App ID is public by design — it identifies the
 * app to Privy's hosted components — and it is passed to the provider from the server
 * layout rather than duplicated in a client config file.
 */

(function () {
    'use strict';

    // Kept so we can always tell our own provider apart from a real extension, injected
    // either before this file ran or after it.
    const NATIVE_AT_LOAD = (typeof window !== 'undefined' && window.ethereum) || null;
    const EMBEDDED_TYPES = ['privy', 'privy-v2'];

    const state = {
        shim: null,             // the provider we installed, if any
        provider: null,         // the Privy bridge's provider, while signed in
        address: null,
        kind: null,             // 'injected' | 'embedded'
        walletType: null,       // what the bridge says the wallet is
        chainMismatch: null,
        listeners: new Map(),
    };

    const log = (...args) => console.log('[wallet]', ...args);
    const warn = (...args) => console.warn('[wallet]', ...args);
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    /** The extension's provider. Never an object we installed ourselves. */
    function native() {
        const current = (typeof window !== 'undefined' && window.ethereum) || null;
        return current && current !== state.shim ? current : null;
    }

    /** The bridge, once its React effect has published it. */
    function bridge() {
        return (typeof window !== 'undefined' && window.privyBridge) || null;
    }

    function target() {
        const net = window.DUNGEON_CONFIG?.getNetworkConfig?.();
        return {
            chainId: net?.chainId || '0xb626',
            chainIdDecimal: net?.chainIdDecimal || 46630,
            name: net?.name || 'Robinhood Chain Testnet',
        };
    }

    /** Does the bridge consider the wallet one it created, rather than the player's own? */
    function isEmbeddedType(type) {
        return EMBEDDED_TYPES.includes(type);
    }

    /**
     * The bridge's provider, but only for a session that is actually signed in. A bridge
     * that is mounted but logged out returns null, exactly like a locked extension — that
     * distinction is what keeps a logged-out Privy user from shadowing their extension.
     */
    async function bridgeProvider() {
        const source = bridge();
        if (!source) return null;
        try {
            if (typeof source.isReady === 'function' && !source.isReady()) return null;
            if (!(typeof source.isAuthenticated === 'function' && source.isAuthenticated())) return null;
            const provider = await source.getProvider();
            if (!provider) return null;
            state.provider = provider;
            state.address = (typeof source.getAddress === 'function' && source.getAddress()) || state.address;
            state.walletType = (typeof source.getWalletType === 'function' && source.getWalletType()) || null;
            state.kind = isEmbeddedType(state.walletType) ? 'embedded' : 'injected';
            return provider;
        } catch (error) {
            warn('the Privy bridge could not hand over a provider:', error?.message || error);
            return null;
        }
    }

    /**
     * Wait for the bridge to mount. It is created in a React effect, so on the first paint
     * it does not exist yet — and a page whose scripts run a moment before the effect lands
     * must not conclude that there is no wallet.
     */
    function waitForBridge(ms) {
        if (bridge()) return Promise.resolve(bridge());
        if (ms <= 0) return Promise.resolve(null);
        return new Promise((resolve) => {
            let timer;
            const done = () => {
                clearTimeout(timer);
                window.removeEventListener('privyBridgeReady', done);
                resolve(bridge());
            };
            timer = setTimeout(done, ms);
            window.addEventListener('privyBridgeReady', done);
        });
    }

    // -------------------------------------------------------------- the provider
    function emit(event, payload) {
        for (const listener of state.listeners.get(event) || []) {
            try {
                listener(payload);
            } catch (error) {
                warn(`${event} listener threw:`, error?.message || error);
            }
        }
    }

    /**
     * The EIP-1193 provider this page will use, installed when a Privy session owns the
     * wallet so that `window.ethereum` and `window.DKWallet` cannot disagree. Every method
     * is forwarded to whoever currently holds the wallet.
     */
    function installShim() {
        const provider = {
            isDKEmbedded: true,
            isMetaMask: false,
            isConnected: () => !!state.address,

            async request({ method, params }) {
                switch (method) {
                    case 'eth_accounts': {
                        const live = await liveProvider();
                        if (live) {
                            try {
                                return await live.request({ method, params });
                            } catch (error) {
                                // Fall through to what the bridge last told us.
                                warn('eth_accounts forward failed:', error?.message || error);
                            }
                        }
                        return state.address ? [state.address] : [];
                    }

                    case 'eth_requestAccounts': {
                        // A wallet that is already there is the answer. Ask only when there is
                        // none: `connect()` opens Privy's login, and for a session that is
                        // signed in that is a call which changes nothing and makes Privy warn
                        // that the player is already logged in — once per click, which is
                        // exactly the noise a page asking for accounts on mount produces.
                        let live = await liveProvider();
                        if (!live) {
                            await connect();
                            live = await liveProvider();
                        }
                        // Whatever `connect()` returned, never forward to *this* provider: for
                        // an adopted Privy session it hands back the seam, so answering with it
                        // would re-enter this same case, forever.
                        if (!live || live === provider) throw new Error('No wallet was connected.');
                        return live.request({ method, params });
                    }

                    default: {
                        const live = await liveProvider();
                        if (!live) throw new Error('No wallet is connected.');
                        return live.request({ method, params });
                    }
                }
            },

            on(event, listener) {
                const list = state.listeners.get(event) || [];
                list.push(listener);
                state.listeners.set(event, list);
            },
            removeListener(event, listener) {
                const list = state.listeners.get(event) || [];
                state.listeners.set(event, list.filter((entry) => entry !== listener));
            },
            __emit: emit,
        };

        state.shim = provider;
        window.ethereum = provider;
        // Anything waiting for a late-injecting wallet can stop waiting.
        window.dispatchEvent(new CustomEvent('ethereum#initialized'));
        return provider;
    }

    /** Whoever holds the wallet right now, or null. */
    async function liveProvider() {
        if (state.provider) return state.provider;
        const signedIn = await bridgeProvider();
        return signedIn || native();
    }

    /**
     * Take over the page with a signed-in Privy session: adopt its provider, install the
     * shim so `window.ethereum` follows, and tell the listeners. The extension, if there is
     * one, is remembered nowhere on purpose — signing out hands it back.
     */
    async function adopt(provider) {
        if (!provider) return null;
        if (!state.shim) installShim();
        emit('accountsChanged', state.address ? [state.address] : []);
        emit('connect', { chainId: target().chainId });
        log('Privy wallet in use:', state.address, '(' + (state.walletType || 'unknown') + ')');

        // The chain is the game's choice, not the wallet's, and the bridge settles it. Say
        // so when the two still disagree, because otherwise the first transaction fails
        // with something unreadable.
        try {
            const real = await provider.request({ method: 'eth_chainId' });
            if (real && Number(real) !== Number(target().chainId)) {
                state.chainMismatch = real;
                warn(`wallet is on ${real}, but this game runs on ${target().name} `
                    + `(${target().chainIdDecimal} / ${target().chainId}). Enable it for the Privy app, `
                    + 'or transactions will fail.');
            } else {
                state.chainMismatch = null;
            }
        } catch {
            // A provider that cannot answer eth_chainId is not a reason to refuse.
        }

        return state.shim;
    }

    // ---------------------------------------------------------------- public API
    /**
     * The provider this page should use. A signed-in Privy session wins; otherwise an
     * extension that already exists; `waitMs` gives a bridge or a late-injecting extension
     * a moment to appear. Returns null when there is nothing to play with yet.
     */
    async function provider({ waitMs = 0 } = {}) {
        await waitForBridge(waitMs);

        const signedIn = await bridgeProvider();
        if (signedIn) return await adopt(signedIn);

        const deadline = Date.now() + waitMs;
        while (Date.now() < deadline) {
            if (native()) break;
            await sleep(100);
        }
        if (native()) {
            state.kind = 'injected';
            return native();
        }
        return null;
    }

    /** Ask the player to sign in, if this page has any way to. */
    async function connect() {
        const source = await waitForBridge(2500);

        if (source && typeof source.login === 'function') {
            // Privy's own modal is the login: MetaMask, Coinbase, WalletConnect, Rainbow
            // and email all live in there, and the session arrives asynchronously.
            try {
                await source.login();
            } catch (error) {
                warn('Privy login failed:', error?.message || error);
                throw error;
            }
            for (let attempt = 0; attempt < 40; attempt++) {
                const signedIn = await bridgeProvider();
                if (signedIn) return await adopt(signedIn);
                await sleep(150);
            }
            // A modal that was closed is not a failure. Only say something when Privy *did*
            // report a session and no provider came with it, which is the case worth chasing.
            if (typeof source.isAuthenticated === 'function' && source.isAuthenticated()) {
                warn('Privy is signed in but handed over no provider — the session may still be settling');
            } else {
                log('the login was closed without signing in');
            }
            return null;
        }

        const injected = native();
        if (injected) {
            state.kind = 'injected';
            return injected;
        }
        return null;
    }

    /** What this page can actually do, for the UI to render honestly. */
    async function capabilities() {
        const signedIn = await bridgeProvider();
        const injected = !!native();
        return {
            privy: !!bridge(),
            injected,
            connected: !!state.address,
            address: state.address,
            kind: state.kind,
            walletType: state.walletType,
            chainMismatch: state.chainMismatch,
            connectable: !!bridge() || injected,
        };
    }

    /** A phone cannot install a browser extension, so the advice has to differ. */
    function isMobile() {
        return /Android|iPhone|iPad|iPod/i.test((typeof navigator !== 'undefined' && navigator.userAgent) || '');
    }

    /** The message to show when there is no wallet at all. */
    function unavailableMessage() {
        const mobile = isMobile();
        if (mobile) {
            return 'This browser has no wallet in it. Reload the page to sign in with email, '
                + "or open the site inside MetaMask's built-in browser.";
        }
        return 'No Web3 wallet found. Reload the page to sign in with email, or install MetaMask.';
    }

    /** Sign out of Privy. The provider stays installed, so signing back in is one click. */
    async function disconnect() {
        const source = bridge();
        if (source && typeof source.logout === 'function' && typeof source.isAuthenticated === 'function'
            && source.isAuthenticated()) {
            try {
                await source.logout();
            } catch (error) {
                warn('sign-out failed:', error?.message || error);
            }
        }
        state.provider = null;
        state.address = null;
        state.walletType = null;
        state.chainMismatch = null;
        state.kind = native() ? 'injected' : null;
        if (!native()) {
            // Nothing holds the wallet now: hand the page back to "not connected" rather
            // than leaving the shim claiming an account it no longer has.
            state.shim = state.shim || null;
        }
        emit('accountsChanged', []);
    }

    window.DKWallet = {
        provider,
        connect,
        capabilities,
        unavailableMessage,
        isMobile,
        disconnect,
        /** The provider in use right now, for code that cannot wait. */
        current: () => state.shim || state.provider || native(),
        kind: () => state.kind,
        /** True when a Privy session is what the page is playing with. */
        signedInWithPrivy: () => !!state.provider,
    };

    // Pages do not have to ask. A returning player who is already signed in should be
    // signed in before they click anything, and a session that is restored silently is the
    // difference between a site and a wallet prompt.
    function start() {
        waitForBridge(2000)
            .then(() => bridgeProvider())
            .then((signedIn) => (signedIn ? adopt(signedIn) : null))
            .catch((error) => warn('could not restore the Privy session:', error?.message || error));
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
        else start();
    }

    log('wallet source ready —', NATIVE_AT_LOAD ? 'an extension was already here' : 'waiting for Privy or an extension');
})();
