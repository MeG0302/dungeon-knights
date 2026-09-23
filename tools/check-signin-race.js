#!/usr/bin/env node
/**
 * Can a sign-in finish when the wallet arrives a moment after the page asks for it?
 *
 *     node tools/check-signin-race.js
 *
 * `signIn()` is what turns "the wallet is here" into a session — it asks the server for a
 * challenge and has the wallet sign it. The wallet, though, does not arrive on the page's
 * schedule: `window.DKWallet` is published by a React effect, and the Privy session behind it is
 * adopted a moment later, so the seam exists for a while before it holds anything. A sign-in
 * asked in that gap used to report the one thing that was not true — "no wallet found… install
 * MetaMask", in front of a wallet that was already signed in — which is what a player saw on
 * the Points page while their Privy session sat there perfectly valid.
 *
 * `lib/points-client.js` is driven here against a stubbed window rather than a stubbed copy of
 * itself: the module is imported as shipped, and the only fakes are the browser globals it reads.
 * The three states that matter are covered — a wallet that arrives late, a wallet that never
 * arrives (which must still be refused, or the wait would have turned a real "no wallet" into a
 * hang), and a wallet that is already there (which must not be waited on at all).
 */

const results = [];
function rec(label, pass, detail) {
    results.push({ label, pass });
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

const ADDRESS = '0x1111111111111111111111111111111111111111';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A window, with just the storage and stubs this module touches. */
function makeWindow() {
    const store = new Map();
    return {
        store,
        ethereum: undefined,
        DKWallet: undefined,
        localStorage: {
            getItem: (key) => (store.has(key) ? store.get(key) : null),
            setItem: (key, value) => store.set(key, String(value)),
            removeItem: (key) => store.delete(key),
        },
    };
}

/** A wallet, as EIP-1193: it answers accounts, and it signs when asked. */
function makeProvider(log) {
    return {
        async request({ method }) {
            log.push(method);
            if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [ADDRESS];
            if (method === 'personal_sign') return '0xsigned';
            if (method === 'eth_chainId') return '0xb626';
            return null;
        },
    };
}

/**
 * The seam, to the contract `public/wallet-source.js` publishes.
 *
 * `arrivesAfter` is the whole point: the object exists immediately and the wallet inside it
 * shows up later. `arrives: false` is the other half of that contract — `provider({ waitMs })`
 * waits for the bridge for as long as it was given and then reports that there is nothing,
 * which is what keeps the guard from turning a real "no wallet" into a hang.
 */
function makeSeam(log, { arrivesAfter = 0, arrives = true, install = null } = {}) {
    const state = { provider: null, adopted: 0, asked: 0 };

    async function produce(waitMs = 0) {
        state.asked += 1;
        if (state.provider) return state.provider;
        if (!arrives) {
            await sleep(Math.min(waitMs, 1500));
            return null;
        }
        if (arrivesAfter) await sleep(arrivesAfter);
        state.provider = makeProvider(log);
        state.adopted += 1;
        install?.(state.provider);             // the seam installs itself as window.ethereum
        return state.provider;
    }

    return {
        state,
        provider: ({ waitMs } = {}) => produce(waitMs),
        // What the page reads for a provider: whatever the seam holds right now.
        current: () => state.provider,
        capabilities: async () => ({ privy: true, injected: false, connected: !!state.provider }),
        connect: async () => produce(),
    };
}

/** The two API calls a sign-in makes, answered the way the server answers them. */
function stubFetch() {
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
        calls.push({ url: String(url), method: options.method || 'GET' });
        if (String(url).includes('/api/points/session?address=')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    address: ADDRESS,
                    issuedAt: 1,
                    message: `Dungeon Knights — proof of ownership\nWallet: ${ADDRESS}\nIssued: 1\nNonce: deadbeef`,
                }),
            };
        }
        return {
            ok: true,
            status: 200,
            json: async () => ({
                token: 'token.value',
                expiresAt: 4_000_000_000,
                state: { address: ADDRESS, points: 0 },
            }),
        };
    };
    return calls;
}

(async () => {
    console.log('');
    console.log('Signing in when the wallet is a moment behind the session that announced it');

    const win = makeWindow();
    globalThis.window = win;
    const fetches = stubFetch();
    // Imported after the window exists, because the module reads globals rather than taking them.
    const { signIn, readSession } = await import('../lib/points-client.js');

    // ------------------------------------------- a wallet that arrives after the ask
    console.log('');
    console.log('A Privy session that is adopted while the sign-in is asking');

    const log = [];
    win.DKWallet = makeSeam(log, {
        arrivesAfter: 120,
        install: (provider) => { win.ethereum = provider; },
    });
    const started = await signIn(ADDRESS).then(() => 'resolved', (error) => error.message);
    rec('a sign-in waits for the wallet instead of refusing', started === 'resolved', String(started));
    rec('and the challenge is what the wallet signed', log.includes('personal_sign'),
        JSON.stringify(log));
    rec('the session is the one the server issued', readSession()?.token === 'token.value',
        JSON.stringify(readSession()));
    rec('the challenge was asked for the address the wallet gave',
        fetches.some((call) => call.url.includes(`?address=${ADDRESS}`)),
        String(fetches.length) + ' API call(s)');
    rec('the seam was asked to produce the wallet, not assumed to hold one',
        win.DKWallet.state.asked === 1, `${win.DKWallet.state.asked} ask(s)`);

    // ------------------------------------------------ a wallet that never arrives
    console.log('');
    console.log('Nothing to sign with — no extension, and no session behind the seam');

    const empty = makeWindow();
    globalThis.window = empty;
    const emptyLog = [];
    empty.DKWallet = makeSeam(emptyLog, { arrives: false });
    const emptyStart = Date.now();
    const refused = await signIn(ADDRESS).then(() => 'resolved', (error) => error.message);
    const waited = Date.now() - emptyStart;
    rec('a sign-in with no wallet is still refused', /No wallet found/.test(refused), String(refused));
    rec('it names what this browser can actually do', /Privy/.test(refused), String(refused));
    rec('and it does not claim to have signed anything', !emptyLog.includes('personal_sign'),
        JSON.stringify(emptyLog));
    rec('the wait is bounded rather than endless', waited < 4000, `${waited} ms`);

    // -------------------------------------------------- a wallet that is already there
    console.log('');
    console.log('A wallet the seam already holds');

    const ready = makeWindow();
    globalThis.window = ready;
    const readyLog = [];
    const readySeam = makeSeam(readyLog, { arrivesAfter: 1, install: (provider) => { ready.ethereum = provider; } });
    await readySeam.provider();                 // the page's start-up has already adopted it
    ready.DKWallet = readySeam;
    const asksBefore = readySeam.state.asked;
    const readyStart = Date.now();
    const readyResult = await signIn(ADDRESS).then(() => 'resolved', (error) => error.message);
    const readyMs = Date.now() - readyStart;
    rec('a wallet that is here is signed with, immediately', readyResult === 'resolved', String(readyResult));
    rec('and the seam is not asked to produce one again', readySeam.state.asked === asksBefore,
        `${readySeam.state.asked} ask(s), was ${asksBefore}`);
    rec('so nothing is spent waiting on it', readyMs < 150, `${readyMs} ms`);

    console.log('');
    const failed = results.filter((r) => !r.pass);
    console.log(`${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length) {
        console.log('');
        for (const f of failed) console.log(`  FAILED: ${f.label}`);
        process.exitCode = 1;
    }
})();
