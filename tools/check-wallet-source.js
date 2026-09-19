#!/usr/bin/env node
/**
 * Does the wallet facade behave — without an App ID, and with one?
 *
 *     node tools/check-wallet-source.js
 *
 * `public/wallet-source.js` decides where every page's Web3 provider comes from. Two
 * things about it have to be true and neither is visible from reading it:
 *
 *   - **Dormant means dormant.** With no embedded App ID on the server, nothing may be
 *     loaded, nothing may be replaced, and `window.ethereum` must be exactly what it was.
 *   - **The embedded path has to be right on the day it is switched on**, and it cannot
 *     be tried out until there is a real App ID. So the Privy SDK is faked here — to the
 *     shape Privy documents — and the facade is driven through the whole lifecycle:
 *     restore, sign-in, signing, cancel, chain mismatch, sign-out.
 *
 * The file is loaded from disk into a stub DOM, so this tests the shipped artefact and
 * not a copy of it. What it cannot prove is Privy's own behaviour against the real
 * service; that needs a live App ID in a real browser.
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
    const document = {
        body,
        head,
        readyState: 'complete',
        createElement: element,
        addEventListener() {},
        removeEventListener() {},
    };
    const window = {
        document,
        navigator: { userAgent },
        dispatchEvent(event) {
            dispatched.push(event.type);
            return true;
        },
        addEventListener() {},
        removeEventListener() {},
    };
    class CustomEvent {
        constructor(type, init) {
            this.type = type;
            this.detail = init?.detail;
        }
    }
    return { window, document, body, head, dispatched, CustomEvent };
}

/** Whole-token class match — `dkw-go` is one class among several on those buttons. */
function findByClass(root, className) {
    if (String(root.className || '').split(/\s+/).includes(className)) return root;
    for (const child of root.children || []) {
        const found = findByClass(child, className);
        if (found) return found;
    }
    return null;
}

/** Let pending microtasks and timers in the sandbox run. */
const settle = async (times = 6) => {
    for (let i = 0; i < times; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

// ------------------------------------------------------- a fake Privy, per docs
function fakeSdk({ config, user = null }) {
    const calls = [];
    const state = { allowCreate: true };

    class FakePrivy {
        constructor(options) {
            calls.push(['construct', options]);
            this.options = options;
            this.user = { get: async () => ({ user }) };
            this.embeddedWallet = {
                getURL: () => 'https://auth.privy.io/embed/secure-context',
                onMessage: () => {},
                create: async () => {
                    calls.push(['create']);
                    const created = { id: 'did:privy:1', wallet: { address: '0xAbC0000000000000000000000000000000000001' } };
                    user = created;
                    return { user: created };
                },
                getEthereumProvider: async (args) => {
                    calls.push(['getEthereumProvider', args]);
                    return {
                        async request({ method }) {
                            calls.push(['embedded.request', method]);
                            if (method === 'eth_chainId') return config.embeddedChain || '0xb626';
                            if (method === 'personal_sign') return '0xsigned';
                            return null;
                        },
                    };
                },
            };
            this.auth = {
                email: {
                    sendCode: async (email) => calls.push(['sendCode', email]),
                    loginWithCode: async (email, code) => {
                        calls.push(['loginWithCode', email, code]);
                        // The session now exists; the next user.get() must show it.
                        user = sessionUser;
                        return { user: sessionUser };
                    },
                },
                logout: async (args) => calls.push(['logout', args]),
            };
        }
        async initialize() {
            calls.push(['initialize']);
        }
        setMessagePoster() {}
    }

    const wallet = { address: '0xAbC0000000000000000000000000000000000001' };
    const sessionUser = { id: 'did:privy:1', wallet };
    user = user === null && config.hasSession === false ? null : user || sessionUser;

    const sdk = {
        default: FakePrivy,
        LocalStorage: class LocalStorage {},
        getUserEmbeddedEthereumWallet: (u) => u?.wallet || null,
        getEntropyDetailsFromUser: () => ({ entropyId: 'entropy', entropyIdVerifier: 'verifier' }),
    };
    return { sdk, calls, state };
}

/** An extension: the shape wallet.js and everything else already expects. */
function fakeExtension() {
    return {
        isMetaMask: true,
        async request({ method }) {
            if (method === 'eth_accounts') return ['0xEXT0000000000000000000000000000000000001'];
            if (method === 'eth_requestAccounts') return ['0xEXT0000000000000000000000000000000000001'];
            if (method === 'eth_chainId') return '0xb626';
            return null;
        },
        on() {},
    };
}

/** Load the shipped facade into a fresh sandbox. */
function load({ userAgent, embedded, injected = null, sdk = null, captureWarnings = false }) {
    const warnings = [];
    const dom = makeDom(userAgent);
    const win = dom.window;
    if (injected) win.ethereum = injected;
    if (sdk) win.DKWalletSdk = sdk.sdk;
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

    let configRequested = 0;
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
        fetch: async () => {
            configRequested += 1;
            return { ok: true, json: async () => ({ chain: null, embedded: embedded || null }) };
        },
    };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(SOURCE, sandbox, { filename: 'public/wallet-source.js' });
    return { ...dom, sandbox, warnings, configCount: () => configRequested };
}

(async () => {
    console.log('');
    console.log('Wallet source — dormant, and ready for the day it is switched on');

    // ------------------------------------------------------------------ dormant
    console.log('');
    console.log('No embedded App ID configured (today)');

    const off = load({ embedded: null });
    const offProvider = await off.window.DKWallet.provider({ waitMs: 0 });
    const offCaps = await off.window.DKWallet.capabilities();
    rec('no provider is offered', offProvider === null, String(offProvider));
    rec('window.ethereum is left alone', off.window.ethereum === undefined,
        off.window.ethereum ? 'was replaced' : 'untouched');
    rec('nothing is connectable', offCaps.connectable === false, JSON.stringify(offCaps));
    rec('no secure-context iframe is mounted', findByClass(off.body, 'dkw-backdrop') === null
        && off.body.children.every((c) => c.tagName !== 'IFRAME'), `${off.body.children.length} body children`);

    const phone = load({ embedded: null, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });
    rec('a phone is told to use a wallet browser',
        /built-in browser/.test(phone.window.DKWallet.unavailableMessage()),
        phone.window.DKWallet.unavailableMessage());
    rec('a phone is recognised as one, so no download link is offered',
        phone.window.DKWallet.isMobile() === true, String(phone.window.DKWallet.isMobile()));
    rec('a desktop is not',
        off.window.DKWallet.isMobile() === false, String(off.window.DKWallet.isMobile()));
    rec('a desktop is told to install one',
        /Install MetaMask/.test(off.window.DKWallet.unavailableMessage()),
        off.window.DKWallet.unavailableMessage());

    // ------------------------------------------- a page that never asks us anything
    console.log('');
    console.log('A configured deployment where the page never calls in (the Points route)');

    const sdkIdle = fakeSdk({ config: {} });
    const idle = load({ embedded: { appId: 'app-id' }, sdk: sdkIdle });
    await settle(10);
    const idleCaps = await idle.window.DKWallet.capabilities();
    rec('the provider appears on its own', !!idle.window.ethereum && idle.window.ethereum.isDKEmbedded === true,
        idle.window.ethereum ? 'shim installed' : 'nothing installed');
    rec('a returning session is restored before the first click', idleCaps.connected === true,
        String(idleCaps.address));

    const sdkIdleAnon = fakeSdk({ config: { hasSession: false } });
    const idleAnon = load({ embedded: { appId: 'app-id' }, sdk: sdkIdleAnon });
    await settle(10);
    const idleAnonCaps = await idleAnon.window.DKWallet.capabilities();
    rec('an anonymous visitor gets no account, only the provider',
        idleAnonCaps.connected === false && !!idleAnon.window.ethereum, JSON.stringify(idleAnonCaps.connected));
    rec('and is not asked to sign in until they choose to',
        findByClass(idleAnon.body, 'dkw-backdrop') === null, 'no modal');

    // ------------------------------------------------------ injected wallet wins
    console.log('');
    console.log('An extension is present, and an App ID is configured too');

    const sdkInjected = fakeSdk({ config: {} });
    const ext = load({ embedded: { appId: 'app-id', clientId: 'client-id' }, injected: fakeExtension(), sdk: sdkInjected });
    const extProvider = await ext.window.DKWallet.provider({ waitMs: 0 });
    rec('the extension is used', extProvider === ext.window.ethereum, 'provider is the injected one');
    rec('it is reported as injected', ext.window.DKWallet.kind() === 'injected', String(ext.window.DKWallet.kind()));
    rec('the wallet SDK is never loaded', sdkInjected.calls.length === 0, `${sdkInjected.calls.length} SDK calls`);

    // --------------------------------------------------------- silent restore
    console.log('');
    console.log('A phone with a previous session');

    const sdkSession = fakeSdk({ config: {} });
    const restored = load({ embedded: { appId: 'app-id' }, sdk: sdkSession, userAgent: 'Mozilla/5.0 (iPhone)' });
    const restoredProvider = await restored.window.DKWallet.provider({ waitMs: 0 });
    const restoredCaps = await restored.window.DKWallet.capabilities();
    rec('a provider is offered', !!restoredProvider, restoredProvider ? 'shim' : 'null');
    rec('it is reported as embedded', restoredCaps.kind === 'embedded', String(restoredCaps.kind));
    rec('the account is known without any UI', restoredCaps.address === '0xAbC0000000000000000000000000000000000001',
        String(restoredCaps.address));
    rec('a prompt was not shown', findByClass(restored.body, 'dkw-backdrop') === null, 'no modal');
    rec('the secure context is mounted',
        restored.body.children.some((c) => c.tagName === 'IFRAME'), 'iframe in body');
    rec('late listeners are told a wallet appeared',
        restored.dispatched.includes('ethereum#initialized'), restored.dispatched.join(', ') || 'none');

    const accounts = await restored.window.ethereum.request({ method: 'eth_accounts' });
    rec('eth_accounts reports the embedded account', accounts[0] === restoredCaps.address, JSON.stringify(accounts));

    const signature = await restored.window.ethereum.request({
        method: 'personal_sign', params: ['0xdeadbeef', '0xIgnoredSentByCaller'],
    });
    const signCall = sdkSession.calls.find((c) => c[0] === 'embedded.request' && c[1] === 'personal_sign');
    rec('personal_sign reaches the wallet', signature === '0xsigned', String(signature));
    rec('and only once', sdkSession.calls.filter((c) => c[0] === 'embedded.request' && c[1] === 'personal_sign').length === 1,
        `sign call recorded: ${!!signCall}`);

    // --------------------------------------------------- sign-in on demand
    console.log('');
    console.log('A phone with no session — the email sign-in');

    const sdkFresh = fakeSdk({ config: { hasSession: false } });
    const fresh = load({ embedded: { appId: 'app-id' }, sdk: sdkFresh, userAgent: 'Mozilla/5.0 (iPhone)' });
    const freshProvider = await fresh.window.DKWallet.provider({ waitMs: 0 });
    rec('no provider until someone signs in', freshProvider === null, String(freshProvider));
    rec('but the provider exists, like a locked extension', !!fresh.window.ethereum && fresh.window.ethereum.isDKEmbedded,
        'shim installed');

    const locked = await fresh.window.ethereum.request({ method: 'eth_accounts' });
    rec('eth_accounts is empty', locked.length === 0, JSON.stringify(locked));

    const pending = fresh.window.ethereum.request({ method: 'eth_requestAccounts' });
    await settle();
    const emailModal = findByClass(fresh.body, 'dkw-backdrop');
    rec('sign-in asks for an email', !!emailModal, emailModal ? 'modal shown' : 'no modal');
    const emailInput = emailModal && findByClass(emailModal, 'dkw-input');
    if (emailInput) emailInput.value = 'knight@example.com';
    const emailGo = emailModal && findByClass(emailModal, 'dkw-go');
    if (emailGo) emailGo.onclick();
    await settle();

    const codeModal = findByClass(fresh.body, 'dkw-backdrop');
    const codeInput = codeModal && findByClass(codeModal, 'dkw-input');
    rec('then for the code it sent', !!codeInput, codeInput ? 'code step shown' : 'no second step');
    if (codeInput) codeInput.value = '123456';
    const codeGo = codeModal && findByClass(codeModal, 'dkw-go');
    if (codeGo) codeGo.onclick();

    const granted = await pending;
    const freshCaps = await fresh.window.DKWallet.capabilities();
    rec('the code signs the player in', granted?.[0] === '0xAbC0000000000000000000000000000000000001', JSON.stringify(granted));
    rec('the address is remembered', freshCaps.address === granted?.[0] && freshCaps.connected === true,
        String(freshCaps.address));
    rec('a session was created, not just read',
        sdkFresh.calls.some((c) => c[0] === 'loginWithCode'), sdkFresh.calls.map((c) => c[0]).join(', '));

    // ------------------------------------------------------------------ cancel
    console.log('');
    console.log('Dismissing the sign-in');

    const sdkCancel = fakeSdk({ config: { hasSession: false } });
    const cancelled = load({ embedded: { appId: 'app-id' }, sdk: sdkCancel });
    await cancelled.window.DKWallet.provider({ waitMs: 0 });   // installs the provider
    const cancelledPending = cancelled.window.ethereum.request({ method: 'eth_requestAccounts' })
        .then(() => 'resolved')
        .catch((error) => error.message);
    await settle();
    const cancelModal = findByClass(cancelled.body, 'dkw-backdrop');
    const cancelBtn = cancelModal && findByClass(cancelModal, 'dkw-ghost');
    if (cancelBtn) cancelBtn.onclick();
    const cancelledOutcome = await cancelledPending;
    const cancelledCaps = await cancelled.window.DKWallet.capabilities();
    rec('cancelling does not connect anyone', cancelledCaps.connected === false, `outcome: ${cancelledOutcome}`);
    rec('cancelling does not remove the wallet', !!cancelled.window.ethereum, 'shim still installed');

    // ----------------------------------------------------------- chain mismatch
    console.log('');
    console.log('An embedded wallet on the wrong chain');

    const sdkChain = fakeSdk({ config: { embeddedChain: '0x1' } });
    const wrongChain = load({ embedded: { appId: 'app-id' }, sdk: sdkChain, captureWarnings: true });
    await wrongChain.window.DKWallet.provider({ waitMs: 0 });
    const chainCaps = await wrongChain.window.DKWallet.capabilities();
    rec('the mismatch is detected, not hidden', chainCaps.chainMismatch === '0x1', String(chainCaps.chainMismatch));
    const warned = wrongChain.warnings.join(' ');
    rec('and reported, naming the chain to enable',
        /0x1/.test(warned) && /46630/.test(warned), warned.slice(0, 120) || 'nothing warned');
    rec('switching networks never breaks the connection',
        (await wrongChain.window.ethereum.request({ method: 'wallet_switchEthereumChain' })) === null, 'returned null');

    // --------------------------------------------------------------- sign-out
    console.log('');
    console.log('Signing out');

    const sdkOut = fakeSdk({ config: {} });
    const out = load({ embedded: { appId: 'app-id' }, sdk: sdkOut });
    await out.window.DKWallet.provider({ waitMs: 0 });
    await out.window.DKWallet.disconnect();
    const outCaps = await out.window.DKWallet.capabilities();
    rec('the session is ended at the provider',
        sdkOut.calls.some((c) => c[0] === 'logout'), sdkOut.calls.map((c) => c[0]).join(', '));
    rec('the account is cleared', outCaps.address === null && outCaps.connected === false, JSON.stringify(outCaps));
    rec('the wallet stays available to reconnect', !!out.window.ethereum && out.window.ethereum.isDKEmbedded,
        'shim still installed');
    rec('sign-out is one request, not two',
        (await out.window.ethereum.request({ method: 'eth_accounts' })).length === 0, 'eth_accounts is empty');

    console.log('');
    const failed = results.filter((r) => !r.pass);
    console.log(`${results.length - failed.length}/${results.length} checks passed`);
    for (const f of failed) console.log(`  FAILED: ${f.label}`);
    console.log('');
    process.exit(failed.length ? 1 : 0);
})().catch((error) => {
    console.error('Harness failed:', error);
    process.exit(1);
});
