#!/usr/bin/env node
/**
 * Does the wallet seam behave — logged out, signed in through Privy, or with an extension?
 *
 *     node tools/check-wallet-source.js
 *
 * `public/wallet-source.js` decides where every page's Web3 provider comes from, and it has
 * three jobs that no page can see happen:
 *
 *   - **Prefer a signed-in Privy session.** When the bridge in `app/privy-bridge.js` reports
 *     an authenticated wallet, that wallet must win everywhere — including `window.ethereum`
 *     — so the roster, the dungeon and the vault cannot disagree about who is playing.
 *   - **Never shadow an extension.** A logged-out bridge, or no bridge at all (a deployment
 *     with no App ID), must leave an injected wallet exactly as it was.
 *   - **Be honest when there is nothing.** No provider means no provider, and the message has
 *     to fit the device rather than pointing a phone at an extension it cannot install.
 *
 * The bridge is faked to the contract `app/privy-bridge.js` publishes, and the seam is driven
 * through the whole lifecycle: dormant, extension, embedded session, external session,
 * logged-out bridge, a bridge that mounts late, sign-out and a chain mismatch.
 *
 * The file is loaded from disk into a stub DOM, so this drives the shipped artefact and not a
 * copy of it. What it cannot prove is Privy's own behaviour against the real service; that
 * needs the live App ID in a real browser.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'wallet-source.js'), 'utf8');

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

// ------------------------------------------------------------------- a small DOM
function element(tag) {
    const el = {
        tagName: String(tag).toUpperCase(),
        children: [],
        style: {},
        className: '',
        textContent: '',
        value: '',
        parent: null,
        attributes: {},
        handlers: {},
        setAttribute(name, value) {
            this.attributes[name] = String(value);
        },
        getAttribute(name) {
            return this.attributes[name];
        },
        appendChild(child) {
            child.parent = this;
            this.children.push(child);
            return child;
        },
        remove() {
            if (!this.parent) return;
            this.parent.children = this.parent.children.filter((c) => c !== this);
            this.parent = null;
        },
        focus() {
            this.focused = true;
        },
        addEventListener() {},
        removeEventListener() {},
    };
    return el;
}

function makeDom(userAgent = 'Mozilla/5.0 (Macintosh)') {
    const body = element('body');
    const head = element('head');
    const dispatched = [];
    const listeners = new Map();
    const document = {
        body,
        head,
        readyState: 'complete',
        createElement: element,
        addEventListener(type, fn) {
            const list = listeners.get(type) || [];
            list.push(fn);
            listeners.set(type, list);
        },
        removeEventListener(type, fn) {
            listeners.set(type, (listeners.get(type) || []).filter((entry) => entry !== fn));
        },
    };
    const window = {
        document,
        navigator: { userAgent },
        dispatchEvent(event) {
            dispatched.push(event.type);
            // The seam waits on `privyBridgeReady`, so these have to actually fire.
            for (const fn of listeners.get(event.type) || []) {
                try {
                    fn(event);
                } catch {
                    // a listener throwing is not this helper's problem
                }
            }
            return true;
        },
        addEventListener(type, fn) {
            const list = listeners.get(type) || [];
            list.push(fn);
            listeners.set(type, list);
        },
        removeEventListener(type, fn) {
            listeners.set(type, (listeners.get(type) || []).filter((entry) => entry !== fn));
        },
    };
    class CustomEvent {
        constructor(type, init) {
            this.type = type;
            this.detail = init?.detail;
        }
    }
    return { window, document, body, head, dispatched, CustomEvent };
}

/** An extension: the shape wallet.js and everything else already expects. */
function fakeExtension() {
    const calls = [];
    return {
        isMetaMask: true,
        calls,
        async request({ method }) {
            calls.push(method);
            if (method === 'eth_accounts') return ['0xEXT0000000000000000000000000000000000001'];
            if (method === 'eth_requestAccounts') return ['0xEXT0000000000000000000000000000000000001'];
            if (method === 'eth_chainId') return '0xb626';
            return null;
        },
        on() {},
    };
}

const EMBEDDED_ADDRESS = '0xAbC0000000000000000000000000000000000001';
const EXTERNAL_ADDRESS = '0xDDd0000000000000000000000000000000000002';

/**
 * A bridge, to the contract `app/privy-bridge.js` publishes — including the fact that
 * `login()` is asynchronous and the session arrives through React afterwards, which is why
 * the seam polls for the provider rather than assuming it is there on the next line.
 */
function fakeBridge({ authenticated = true, walletType = 'privy', address = EMBEDDED_ADDRESS, chainId = '0xb626' } = {}) {
    const calls = [];
    let session = authenticated;
    const provider = {
        async request({ method }) {
            calls.push(['provider.request', method]);
            switch (method) {
                case 'eth_accounts':
                    return session ? [address] : [];
                case 'eth_chainId':
                    return chainId;
                case 'personal_sign':
                    return '0xsigned';
                default:
                    return null;
            }
        },
    };
    return {
        calls,
        provider,
        isReady: () => true,
        isAuthenticated: () => session,
        getAddress: () => (session ? address : null),
        getWalletType: () => (session ? walletType : null),
        getProvider: async () => {
            calls.push(['getProvider']);
            return session ? provider : null;
        },
        login: async () => {
            calls.push(['login']);
            session = true;
        },
        logout: async () => {
            calls.push(['logout']);
            session = false;
        },
        /** For the harness: pretend the React session changed under us. */
        setSession: (next) => { session = next; },
    };
}

/** Load the shipped seam into a fresh sandbox. */
function load({ userAgent, injected = null, bridge = null, captureWarnings = false } = {}) {
    const warnings = [];
    const dom = makeDom(userAgent);
    const win = dom.window;
    if (injected) win.ethereum = injected;
    if (bridge) win.privyBridge = bridge;
    win.DUNGEON_CONFIG = {
        getNetworkConfig: () => ({
            chainId: '0xb626',
            chainIdDecimal: 46630,
            name: 'Robinhood Chain Testnet',
            rpc: 'https://rpc.testnet.chain.robinhood.com',
            explorer: 'https://explorer.testnet.chain.robinhood.com',
            currency: { name: 'Ethereum', symbol: 'ETH', decimals: 18 },
        }),
    };

    const sandbox = {
        window: win,
        document: dom.document,
        navigator: win.navigator,
        console: captureWarnings
            ? { ...console, warn: (...args) => warnings.push(args.join(' ')) }
            : console,
        setTimeout,
        clearTimeout,
        CustomEvent: dom.CustomEvent,
        fetch: async () => ({ ok: true, json: async () => ({ chain: null, embedded: null }) }),
    };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(SOURCE, sandbox, { filename: 'public/wallet-source.js' });
    return { ...dom, sandbox, warnings, window: win };
}

/** Let pending microtasks and timers in the sandbox run. */
const settle = async (times = 6) => {
    for (let i = 0; i < times; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

(async () => {
    console.log('');
    console.log('Wallet source — a signed-in Privy session wins, an extension is never shadowed');

    // ------------------------------------------------------------------ dormant
    console.log('');
    console.log('No Privy app configured, no extension (a fresh checkout)');

    const off = load({ captureWarnings: true });
    const offProvider = await off.window.DKWallet.provider({ waitMs: 0 });
    const offCaps = await off.window.DKWallet.capabilities();
    rec('no provider is offered', offProvider === null, String(offProvider));
    rec('window.ethereum is left alone', off.window.ethereum === undefined,
        String(off.window.ethereum));
    rec('nothing is connectable', offCaps.connectable === false, JSON.stringify(offCaps));
    rec('no Privy bridge is claimed', offCaps.privy === false, JSON.stringify(offCaps.privy));
    rec('connecting returns nothing rather than inventing a wallet',
        (await off.window.DKWallet.connect()) === null);
    rec('nothing is added to the page', off.body.children.length === 0,
        `${off.body.children.length} node(s)`);

    const phone = load({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });
    rec('a phone is told about the wallet browser, and can sign in',
        /built-in browser/.test(phone.window.DKWallet.unavailableMessage())
        && /email/.test(phone.window.DKWallet.unavailableMessage()),
        phone.window.DKWallet.unavailableMessage());
    rec('a phone is recognised as one, so no download link is offered',
        phone.window.DKWallet.isMobile() === true, String(phone.window.DKWallet.isMobile()));
    rec('a desktop is not', off.window.DKWallet.isMobile() === false,
        String(off.window.DKWallet.isMobile()));
    rec('a desktop is told to install one',
        /install MetaMask/i.test(off.window.DKWallet.unavailableMessage()),
        off.window.DKWallet.unavailableMessage());

    // -------------------------------------------------------------- extension only
    console.log('');
    console.log('An extension, and no Privy session');

    const extension = fakeExtension();
    const ext = load({ injected: extension });
    const extProvider = await ext.window.DKWallet.provider({ waitMs: 0 });
    rec('the extension is the provider', extProvider === extension, String(extProvider));
    rec('it is reported as injected', ext.window.DKWallet.kind() === 'injected',
        String(ext.window.DKWallet.kind()));
    rec('the extension is not replaced on window.ethereum', ext.window.ethereum === extension,
        String(ext.window.ethereum));
    const extConnect = await ext.window.DKWallet.connect();
    rec('connecting hands back the extension', extConnect === extension, String(extConnect));
    rec('it never asks Privy to log anyone in', !extension.calls.includes('login'));

    // ------------------------------------------- a signed-in session owns the wallet
    console.log('');
    console.log('Signed in through Privy — an embedded wallet');

    const embeddedBridge = fakeBridge({ walletType: 'privy' });
    const session = load({ bridge: embeddedBridge, injected: fakeExtension() });
    const sessionProvider = await session.window.DKWallet.provider({ waitMs: 0 });
    const sessionCaps = await session.window.DKWallet.capabilities();
    rec('the seam (not the extension) is the provider', sessionProvider === session.window.ethereum,
        sessionProvider === session.window.ethereum ? 'window.ethereum is the seam' : 'mismatch');
    rec('window.ethereum now follows the Privy session',
        session.window.ethereum !== undefined && session.window.ethereum.isDKEmbedded === true,
        'seam installed');
    rec('an embedded wallet is reported as embedded', sessionCaps.kind === 'embedded',
        String(sessionCaps.kind));
    rec('the address comes from the bridge', sessionCaps.address === EMBEDDED_ADDRESS,
        String(sessionCaps.address));
    rec('the wallet type is reported', sessionCaps.walletType === 'privy',
        String(sessionCaps.walletType));
    rec('it is connectable and connected', sessionCaps.connectable === true && sessionCaps.connected === true,
        JSON.stringify(sessionCaps));
    const forwardedAccounts = await session.window.ethereum.request({ method: 'eth_accounts' });
    rec('accounts are forwarded to the bridge provider',
        Array.isArray(forwardedAccounts) && forwardedAccounts[0] === EMBEDDED_ADDRESS,
        JSON.stringify(forwardedAccounts));
    const signed = await session.window.ethereum.request({ method: 'personal_sign', params: ['0x0', EMBEDDED_ADDRESS] });
    rec('signing goes through the bridge provider', signed === '0xsigned', String(signed));

    const externalBridge = fakeBridge({ walletType: 'wallet_connect', address: EXTERNAL_ADDRESS });
    const external = load({ bridge: externalBridge });
    const externalProvider = await external.window.DKWallet.provider({ waitMs: 0 });
    const externalCaps = await external.window.DKWallet.capabilities();
    rec('a wallet the player already owns is reported as injected', externalCaps.kind === 'injected',
        String(externalCaps.kind));
    rec('its address is the bridge address', externalCaps.address === EXTERNAL_ADDRESS,
        String(externalCaps.address));
    rec('a WalletConnect session still gets the seam',
        externalProvider === external.window.ethereum, 'seam installed');

    // ------------------------------------- a logged-out bridge must not shadow anything
    console.log('');
    console.log('A bridge that is mounted but logged out');

    const signedOutBridge = fakeBridge({ authenticated: false });
    const extension2 = fakeExtension();
    const signedOut = load({ bridge: signedOutBridge, injected: extension2 });
    const signedOutProvider = await signedOut.window.DKWallet.provider({ waitMs: 0 });
    const signedOutCaps = await signedOut.window.DKWallet.capabilities();
    rec('the extension is used, not the logged-out session', signedOutProvider === extension2,
        String(signedOutProvider));
    rec('window.ethereum is still the extension', signedOut.window.ethereum === extension2,
        String(signedOut.window.ethereum));
    rec('nothing is reported as connected', signedOutCaps.connected === false,
        JSON.stringify(signedOutCaps));
    rec('but the login is offered', signedOutCaps.connectable === true, JSON.stringify(signedOutCaps));
    rec('the bridge is reported as present', signedOutCaps.privy === true, String(signedOutCaps.privy));

    const loginOnly = fakeBridge({ authenticated: false });
    const anon = load({ bridge: loginOnly });
    rec('with no extension and no session there is no provider',
        (await anon.window.DKWallet.provider({ waitMs: 0 })) === null);
    const connected = await anon.window.DKWallet.connect();
    rec('connecting opens Privy\'s login', loginOnly.calls.some((c) => c[0] === 'login'),
        JSON.stringify(loginOnly.calls.filter((c) => c[0] === 'login')));
    rec('and then hands back a usable provider', connected === anon.window.ethereum,
        connected === anon.window.ethereum ? 'seam installed after login' : String(connected));
    const afterLogin = await anon.window.DKWallet.capabilities();
    rec('the session is what the page now plays with', afterLogin.connected === true
        && afterLogin.address === EMBEDDED_ADDRESS, JSON.stringify(afterLogin));

    // A login that is opened and then closed is not a failure, and must not be reported as
    // one: the player changed their mind, and the seam has nothing to complain about.
    const abandoned = fakeBridge({ authenticated: false });
    const closed = load({ bridge: abandoned, captureWarnings: true });
    abandoned.login = async () => { abandoned.calls.push(['login']); };
    const nothing = await closed.window.DKWallet.connect();
    rec('closing the login returns nothing', nothing === null, String(nothing));
    rec('and is not reported as a failure',
        !closed.warnings.some((w) => /settling/.test(w)),
        JSON.stringify(closed.warnings.slice(-2)));

    // ------------------------------------------------- a bridge that arrives late
    console.log('');
    console.log('A bridge that mounts after the page scripts (the React effect lands late)');

    const late = load({ injected: null });
    const lateBridge = fakeBridge();
    setTimeout(() => {
        late.window.privyBridge = lateBridge;
        late.window.dispatchEvent(new late.CustomEvent('privyBridgeReady'));
    }, 120);
    const lateProvider = await late.window.DKWallet.provider({ waitMs: 900 });
    rec('a late bridge is still found', lateProvider === late.window.ethereum,
        lateProvider === late.window.ethereum ? 'seam installed' : String(lateProvider));
    rec('and it is the session that is adopted',
        (await late.window.DKWallet.capabilities()).address === EMBEDDED_ADDRESS);

    // ----------------------------------------------------------- sign-out, chain
    console.log('');
    console.log('Signing out, and a wallet on the wrong chain');

    const goodbye = fakeBridge();
    const leaving = load({ bridge: goodbye });
    await leaving.window.DKWallet.provider({ waitMs: 0 });
    await leaving.window.DKWallet.disconnect();
    rec('sign-out goes through Privy', goodbye.calls.some((c) => c[0] === 'logout'),
        JSON.stringify(goodbye.calls.filter((c) => c[0] === 'logout')));
    const afterSignOut = await leaving.window.DKWallet.capabilities();
    rec('nothing is connected afterwards', afterSignOut.connected === false
        && afterSignOut.address === null, JSON.stringify(afterSignOut));
    rec('listeners are told the account went away',
        leaving.dispatched.includes('ethereum#initialized'));

    const wrongChain = fakeBridge({ chainId: '0x1' });
    const mismatched = load({ bridge: wrongChain, captureWarnings: true });
    await mismatched.window.DKWallet.provider({ waitMs: 0 });
    const mismatchedCaps = await mismatched.window.DKWallet.capabilities();
    rec('a wallet on another chain is reported, not hidden',
        mismatchedCaps.chainMismatch === '0x1', String(mismatchedCaps.chainMismatch));
    rec('and the warning names the chain to enable',
        mismatched.warnings.some((w) => /Robinhood Chain Testnet \(46630/.test(w)),
        mismatched.warnings.slice(-1)[0] || '(no warning)');

    const rightChain = fakeBridge();
    const settledOk = load({ bridge: rightChain, captureWarnings: true });
    await settledOk.window.DKWallet.provider({ waitMs: 0 });
    rec('the right chain is not reported as a mismatch',
        (await settledOk.window.DKWallet.capabilities()).chainMismatch === null,
        JSON.stringify((await settledOk.window.DKWallet.capabilities()).chainMismatch));

    // --------------------------------------------------------------------- report
    console.log('');
    const failed = results.filter((r) => !r.pass);
    console.log(`${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length) {
        console.log('');
        for (const f of failed) console.log(`  FAILED: ${f.label}`);
        process.exitCode = 1;
    }

    await settle(2);
})();
