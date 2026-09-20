/**
 * Where a Web3 provider comes from — one place, for every page.
 *
 * The game, the mint, the vault and the Hall all reach the chain through
 * `window.ethereum`. On a desktop with an extension installed that is fine; on a phone
 * no wallet injects anything into the page, so the site is simply unusable there. This
 * module is the seam that fixes it without touching any call site: an injected wallet
 * is left exactly as it was, and when the server is configured with an embedded-wallet
 * App ID this installs an EIP-1193 provider of its own, so every existing
 * `window.ethereum.request(...)` keeps working.
 *
 * **Dormant by default.** With no `PRIVY_APP_ID` on the server, `/api/wallet/config`
 * reports `embedded: null`, and nothing here does anything at all: no script is
 * downloaded, `window.ethereum` is untouched, and behaviour is exactly what it was
 * before this file existed. That is the guarantee that lets it ship before the App ID
 * does.
 *
 * Resolution order, and why:
 *
 *   1. **Injected** — an extension is already the user's wallet: no round trip, no
 *      modal, no third party in the middle. It always wins, including when it arrives
 *      late (`ethereum#initialized`), which is why nothing here overwrites a provider
 *      it did not install.
 *   2. **Embedded, restored silently** — on a phone with a previous session the player
 *      is signed back in on load with no UI, which is what makes the site feel like a
 *      site and not a wallet prompt.
 *   3. **Embedded, on demand** — the provider exists from the start but has no account,
 *      exactly like a locked extension; the first `eth_requestAccounts` runs the email
 *      sign-in and provisions the wallet.
 *   4. **Nothing** — `unavailableMessage()` says what to do about it, instead of
 *      pointing a phone at a browser extension it cannot install.
 *
 * The embedded wallet is the player's own and non-custodial, and it needs gas before it
 * can mint or claim. `capabilities()` reports its address so the UI can say that plainly
 * rather than letting a transaction fail with no explanation.
 *
 * Only the App ID and client ID reach the browser, and both are public by design — they
 * identify the app to Privy's hosted components, they are not credentials.
 */

(function () {
    'use strict';

    // Kept so we can always tell our own provider apart from a real extension, injected
    // either before this file ran or after it.
    const NATIVE_AT_LOAD = (typeof window !== 'undefined' && window.ethereum) || null;
    const DEFAULT_SDK_URL = 'https://esm.sh/@privy-io/js-sdk-core';

    const state = {
        shim: null,             // the provider we installed, if any
        embedded: null,         // the embedded wallet's own provider, once signed in
        address: null,
        kind: null,             // 'injected' | 'embedded'
        config: null,
        configPromise: null,
        sdk: null,
        privy: null,
        iframe: null,
        chainMismatch: null,
        restore: null,          // in-flight silent restore
        listeners: new Map(),
    };

    const log = (...args) => console.log('[wallet]', ...args);
    const warn = (...args) => console.warn('[wallet]', ...args);

    /** The extension's provider. Never an object we installed ourselves. */
    function native() {
        const current = (typeof window !== 'undefined' && window.ethereum) || null;
        return current && current !== state.shim ? current : null;
    }

    function target() {
        const net = window.DUNGEON_CONFIG?.getNetworkConfig?.();
        return {
            chainId: net?.chainId || '0xb626',
            chainIdDecimal: net?.chainIdDecimal || 46630,
            name: net?.name || 'Robinhood Chain Testnet',
        };
    }

    // --------------------------------------------------------------------- config
    /** Server-side wallet configuration. Fetched at most once per page, never twice. */
    function config() {
        if (state.config) return Promise.resolve(state.config);
        if (state.configPromise) return state.configPromise;
        state.configPromise = fetch('/api/wallet/config', { cache: 'no-store' })
            .then((res) => (res.ok ? res.json() : null))
            .then((cfg) => (state.config = cfg || { embedded: null }))
            .catch((error) => {
                // A page must never break because this route is missing or slow.
                warn('could not read /api/wallet/config:', error.message || error);
                return (state.config = { embedded: null });
            });
        return state.configPromise;
    }

    // ------------------------------------------------------------------ the SDK
    /**
     * Load the Privy core SDK. A page may pre-load it as `window.DKWalletSdk` — that is
     * how the test battery exercises this file with no network and no App ID, and how a
     * project that bundles the SDK would supply it.
     */
    async function loadSdk(url) {
        if (state.sdk) return state.sdk;
        if (window.DKWalletSdk) {
            state.sdk = window.DKWalletSdk;
            return state.sdk;
        }
        const module = await import(/* webpackIgnore: true */ url || DEFAULT_SDK_URL);
        const sdk = module?.default && module?.LocalStorage ? module : module?.default;
        if (!sdk?.default) throw new Error('the wallet SDK loaded, but not in a shape we recognise');
        log('SDK loaded from', url || DEFAULT_SDK_URL);
        state.sdk = sdk;
        return state.sdk;
    }

    async function privyFor(cfg) {
        if (state.privy) return state.privy;
        const sdk = await loadSdk(cfg.embedded.sdkUrl);
        const privy = new sdk.default({
            appId: cfg.embedded.appId,
            clientId: cfg.embedded.clientId || undefined,
            storage: new sdk.LocalStorage(),
        });
        await privy.initialize();
        state.privy = privy;
        mountSecureContext(privy);
        return privy;
    }

    /**
     * Privy keeps embedded-wallet key material in an iframe it calls the secure context.
     * Without it every signature call hangs, so it is mounted as soon as there is a
     * client — hidden, before anything is asked of it.
     */
    function mountSecureContext(privy) {
        if (state.iframe) return;
        const iframe = document.createElement('iframe');
        iframe.src = privy.embeddedWallet.getURL();
        iframe.style.display = 'none';
        iframe.setAttribute('aria-hidden', 'true');
        iframe.title = 'wallet';
        document.body.appendChild(iframe);
        privy.setMessagePoster(iframe.contentWindow);
        window.addEventListener('message', (event) => {
            if (event.source !== iframe.contentWindow) return;
            try {
                const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
                privy.embeddedWallet.onMessage(data);
            } catch (error) {
                warn('secure-context message ignored:', error.message || error);
            }
        });
        state.iframe = iframe;
    }

    // ------------------------------------------------------------------- login UI
    let stylesInstalled = false;

    /** The modal's own styles, kept here so the facade stays one file to reason about. */
    function ensureStyles() {
        if (stylesInstalled) return;
        stylesInstalled = true;
        const style = document.createElement('style');
        style.textContent = `
            .dkw-backdrop { position: fixed; inset: 0; z-index: 4000; display: flex;
                align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.72); }
            .dkw-modal { width: min(380px, 92vw); background: #16130f; border: 1px solid #4a3f2a;
                border-radius: 6px; padding: 22px; font-family: system-ui, sans-serif;
                box-shadow: 0 18px 50px rgba(0, 0, 0, 0.6); }
            .dkw-title { font-size: 15px; font-weight: 700; letter-spacing: 2px;
                text-transform: uppercase; color: #d4af37; margin-bottom: 12px; }
            .dkw-msg { font-size: 13px; line-height: 1.6; color: #cfc7b8; margin: 0 0 14px; }
            .dkw-input { width: 100%; box-sizing: border-box; padding: 11px 12px; font-size: 14px;
                color: #f3ede1; background: #0d0b09; border: 1px solid #4a3f2a; border-radius: 4px; }
            .dkw-input:focus { outline: none; border-color: #d4af37; }
            .dkw-row { display: flex; gap: 10px; margin-top: 16px; }
            .dkw-btn { flex: 1; padding: 11px 14px; font-size: 13px; font-weight: 600;
                letter-spacing: 1px; text-transform: uppercase; border-radius: 4px; cursor: pointer; }
            .dkw-ghost { color: #cfc7b8; background: transparent; border: 1px solid #4a3f2a; }
            .dkw-go { color: #16130f; background: #d4af37; border: 1px solid #d4af37; }
        `;
        document.head.appendChild(style);
    }

    function node(tag, props = {}, children = []) {
        const element = document.createElement(tag);
        for (const [key, value] of Object.entries(props)) {
            if (key === 'style') element.style = value;
            else if (key === 'onclick') element.onclick = value;
            else element[key] = value;
        }
        for (const child of children) element.appendChild(child);
        return element;
    }

    /**
     * One question, one text input. Deliberately small and self-contained: it is the only
     * piece of embedded-wallet UI, it never talks to the game, and it resolves to the
     * typed value or to null when dismissed.
     */
    function ask(message, { secret = false, placeholder = '' } = {}) {
        ensureStyles();
        return new Promise((resolve) => {
            const input = node('input', { className: 'dkw-input', placeholder });
            if (secret) {
                input.setAttribute('inputmode', 'numeric');
                input.setAttribute('maxlength', '6');
            } else {
                input.setAttribute('type', 'email');
            }
            const cancel = node('button', { className: 'dkw-btn dkw-ghost', textContent: 'Cancel' });
            const go = node('button', { className: 'dkw-btn dkw-go', textContent: 'Continue' });
            const modal = node('div', { className: 'dkw-modal' }, [
                node('div', { className: 'dkw-title', textContent: 'Dungeon Knights' }),
                node('p', { className: 'dkw-msg', textContent: message }),
                input,
                node('div', { className: 'dkw-row' }, [cancel, go]),
            ]);
            const backdrop = node('div', { className: 'dkw-backdrop' }, [modal]);

            const close = (value) => {
                backdrop.remove();
                if (typeof document.removeEventListener === 'function') document.removeEventListener('keydown', onKey);
                resolve(value);
            };
            const submit = () => {
                const value = (input.value || '').trim();
                if (value) close(value);
            };
            const onKey = (event) => {
                if (event.key === 'Escape') close(null);
                if (event.key === 'Enter') submit();
            };

            cancel.onclick = () => close(null);
            go.onclick = submit;
            document.addEventListener('keydown', onKey);
            document.body.appendChild(backdrop);
            if (input.focus) input.focus();
        });
    }

    /** Email-code sign-in. Returns the user, or null if it was dismissed. */
    async function signInWithEmail(privy) {
        const email = await ask('Sign in with your email — we will send you a 6-digit code.', {
            placeholder: 'you@example.com',
        });
        if (!email) return null;
        try {
            await privy.auth.email.sendCode(email);
        } catch (error) {
            throw new Error(`Could not send a code to ${email}: ${error.message || error}`);
        }
        const code = await ask(`Enter the code we sent to ${email}.`, { secret: true, placeholder: '000000' });
        if (!code) return null;
        const session = await privy.auth.email.loginWithCode(email, code);
        return session.user;
    }

    // -------------------------------------------------------------- the provider
    function emit(event, payload) {
        for (const listener of state.listeners.get(event) || []) {
            try {
                listener(payload);
            } catch (error) {
                warn(`${event} listener threw:`, error.message || error);
            }
        }
    }

    /**
     * The EIP-1193 provider this page will use, installed *before* sign-in so every
     * existing `window.ethereum` call site keeps working: with no account yet, it behaves
     * exactly like a locked extension.
     */
    function installShim() {
        const provider = {
            isDKEmbedded: true,
            isMetaMask: false,
            isConnected: () => !!state.address,

            async request({ method, params }) {
                switch (method) {
                    case 'eth_accounts':
                        return state.address ? [state.address] : [];

                    case 'eth_requestAccounts': {
                        if (state.address) return [state.address];
                        const connected = await connectEmbedded();
                        if (!connected) throw new Error('No wallet was connected.');
                        return [state.address];
                    }

                    case 'personal_sign': {
                        if (!state.address) await connectEmbedded();
                        if (!state.embedded) throw new Error('No wallet is connected to sign with.');
                        // EIP-1193 order is [data, address]; the app already sends it that way.
                        return state.embedded.request({ method, params: [params?.[0], state.address] });
                    }

                    case 'eth_chainId':
                        if (state.embedded) {
                            try {
                                return await state.embedded.request({ method, params });
                            } catch {
                                // Fall through to the chain this game runs on.
                            }
                        }
                        return target().chainId;

                    case 'wallet_switchEthereumChain':
                    case 'wallet_addEthereumChain': {
                        // An embedded wallet's networks are chosen in the app's dashboard.
                        // Forward it in case it is supported, and never let it break a
                        // connection that has already succeeded.
                        if (!state.embedded) return null;
                        try {
                            return await state.embedded.request({ method, params });
                        } catch (error) {
                            warn(`this wallet cannot switch networks from here (${error.message || error}); `
                                + `make sure ${target().name} (${target().chainIdDecimal}) is enabled for the app`);
                            return null;
                        }
                    }

                    default:
                        if (!state.embedded) throw new Error('No wallet is connected.');
                        return state.embedded.request({ method, params });
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
        state.kind = 'embedded';
        window.ethereum = provider;
        // Anything waiting for a late-injecting wallet can stop waiting.
        window.dispatchEvent(new CustomEvent('ethereum#initialized'));
        return provider;
    }

    /** Make sure the shim exists when this deployment has an embedded wallet to offer. */
    async function ensureEmbedded() {
        if (state.shim) return state.shim;
        if (native()) return null;                    // an extension already won
        const cfg = await config();
        if (!cfg?.embedded?.appId) return null;       // dormant
        installShim();
        return state.shim;
    }

    /** Attach an authenticated user's wallet to the shim. */
    async function attach(privy, user) {
        let wallet = state.sdk.getUserEmbeddedEthereumWallet(user);
        if (!wallet) {
            log('no wallet yet on this account — creating one');
            const created = await privy.embeddedWallet.create({});
            user = created.user;
            wallet = state.sdk.getUserEmbeddedEthereumWallet(user);
        }
        if (!wallet) throw new Error('the embedded wallet was not created');

        const { entropyId, entropyIdVerifier } = state.sdk.getEntropyDetailsFromUser(user);
        const provider = await privy.embeddedWallet.getEthereumProvider({ wallet, entropyId, entropyIdVerifier });
        state.embedded = provider;
        state.address = wallet.address;
        emit('accountsChanged', [wallet.address]);
        emit('connect', { chainId: target().chainId });

        // Our chain is an app choice, not a wallet one: say so when they disagree,
        // because otherwise the first transaction fails with something unreadable.
        try {
            const real = await provider.request({ method: 'eth_chainId' });
            if (real && Number(real) !== Number(target().chainId)) {
                state.chainMismatch = real;
                // The numbers an operator needs to add the network in the Privy dashboard,
                // spelled out rather than left as a puzzle.
                warn(`embedded wallet is on ${real}, but this game runs on ${target().name} `
                    + `(${target().chainIdDecimal} / ${target().chainId}). Enable it for the app, `
                    + 'or transactions will fail.');
            }
        } catch {
            // A provider that cannot answer eth_chainId is not a reason to refuse.
        }

        log('embedded wallet ready:', wallet.address);
        return state.shim;
    }

    /**
     * The signed-in user, or null if there is no session.
     *
     * `privy.user.get()` is **not** a null-returning getter: with nothing in storage it
     * throws `No tokens found in storage` rather than resolving to `{ user: null }`. Read
     * directly, that killed the first click on a phone — the sign-in UI was never reached
     * because the exception arrived one line earlier, and the whole point of this module
     * is that first click. So a session that cannot be read is treated as a session that
     * does not exist; anything a sign-in itself goes wrong with still throws, further in.
     */
    async function currentUser(privy) {
        try {
            const { user } = await privy.user.get();
            return user || null;
        } catch (error) {
            log('no session to restore:', error.message || error);
            return null;
        }
    }

    /** An authenticated session restored with no UI, or null. */
    function restore() {
        if (state.address) return Promise.resolve(state.shim);
        if (state.restore) return state.restore;
        state.restore = (async () => {
            const shim = await ensureEmbedded();
            if (!shim) return null;
            const privy = await privyFor(state.config);
            const user = await currentUser(privy);
            if (!user) return null;
            return attach(privy, user);
        })().catch((error) => {
            warn('could not restore the embedded wallet:', error.message || error);
            state.restore = null;                     // a later attempt may still work
            return null;
        });
        return state.restore;
    }

    /** Sign in with the embedded wallet, running the UI. Returns the shim, or null. */
    async function connectEmbedded() {
        if (state.address) return state.shim;
        const shim = await ensureEmbedded();
        if (!shim) return null;
        try {
            const privy = await privyFor(state.config);
            let user = await currentUser(privy);
            if (!user) user = await signInWithEmail(privy);
            if (!user) return null;
            return await attach(privy, user);
        } catch (error) {
            warn('embedded sign-in failed:', error.message || error);
            throw error;
        }
    }

    // ---------------------------------------------------------------- public API
    /**
     * The provider this page should use. `waitMs` gives an extension a moment to inject,
     * because a late injection is real and must not be shadowed by a sign-in prompt.
     * Returns null when the browser has nothing to offer — or has one, but nobody is
     * signed into it yet.
     */
    async function provider({ waitMs = 0 } = {}) {
        const deadline = Date.now() + waitMs;
        while (Date.now() < deadline) {
            if (native()) break;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (native()) {
            state.kind = 'injected';
            return native();
        }
        const restored = await restore();
        if (restored && state.address) return restored;
        // The shim may exist without an account yet: existent, but not a connected wallet.
        return null;
    }

    /** Ask the user to connect, if this browser has any way to. */
    async function connect() {
        const injected = native();
        if (injected) {
            state.kind = 'injected';
            return injected;
        }
        const shim = await connectEmbedded();
        return shim || null;
    }

    /** What this browser can actually do, for the UI to render honestly. */
    async function capabilities() {
        const cfg = await config();
        const injected = !!native();
        return {
            injected,
            embeddedAvailable: !!cfg?.embedded?.appId,
            connected: !!state.address,
            address: state.address,
            kind: state.kind,
            chainMismatch: state.chainMismatch,
            connectable: injected || !!cfg?.embedded?.appId,
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
            return 'No wallet is available in this browser. On a phone, open this site inside '
                + "MetaMask's built-in browser (or another wallet browser).";
        }
        return 'No Web3 wallet found. Install MetaMask or another browser wallet to continue.';
    }

    /** Sign out. The provider stays installed, so connecting again is one click. */
    async function disconnect() {
        if (state.kind !== 'embedded' || !state.privy) return;
        try {
            const user = await currentUser(state.privy);
            if (user) await state.privy.auth.logout({ userId: user.id });
        } catch (error) {
            warn('sign-out failed:', error.message || error);
        }
        state.address = null;
        state.embedded = null;
        state.chainMismatch = null;
        state.restore = null;
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
        current: () => state.shim || native(),
        kind: () => state.kind,
    };

    // Pages do not have to ask. Some connect straight through `window.ethereum` without
    // ever calling in here, and a returning player on a phone should be signed in before
    // they click anything rather than after. A dormant deployment stops at the config
    // check and never loads a byte.
    function start() {
        ensureEmbedded()
            .then((shim) => (shim ? restore() : null))
            .catch((error) => warn('could not prepare the embedded wallet:', error.message || error));
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
        else start();
    }

    log('wallet source ready — injected only until an embedded App ID is configured');
})();
