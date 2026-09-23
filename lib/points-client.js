/**
 * Browser side of the Points Program: wallet connection, the signature session, and
 * thin wrappers over the API routes.
 *
 * Kept out of the page component so the rules (what is cached, what is re-fetched, how
 * a 401 is handled) live in one place. Nothing here decides how many points anything is
 * worth — the server does that; this module only asks.
 */

const TOKEN_KEY = 'dk_points_session';
const REF_KEY = 'dk_points_ref';

/**
 * What to say when there really is nothing to connect with. It names Privy first, because a
 * browser without an extension is the normal case now — on a phone it is the only case — and
 * naming only the extension told those players to install something they cannot.
 */
const NO_WALLET_MESSAGE = 'No wallet found. Reload the page and continue with Privy, or install MetaMask to enter the vault.';

/**
 * These are the keys `public/wallet.js` uses on every other page. Writing them here
 * means connecting on /points also connects you on the Knight's Hall and Summoning
 * Chamber, instead of the site holding two different ideas of your wallet.
 */
const WALLET_CONNECTED_KEY = 'walletConnected';
const WALLET_ADDRESS_KEY = 'walletAddress';

import { refTokenFromInput } from './points-config.js';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function isAddress(value) {
    return typeof value === 'string' && ADDRESS_RE.test(value.trim());
}

export function shortAddress(address) {
    return isAddress(address) ? `${address.slice(0, 6)}…${address.slice(-4)}` : '';
}

// ------------------------------------------------------------------ wallet access
/**
 * Is there an extension in this browser?
 *
 * Note what this does *not* answer: whether the player can play. Since Privy arrived, an
 * extension is one of two ways in, and the other one — an email address, made into an
 * embedded wallet — needs none. Use `walletCapabilities` to decide what to render; this is
 * only for the places that specifically mean "an injected provider is present".
 */
export function hasInjectedWallet() {
    return typeof window !== 'undefined' && !!window.ethereum;
}

/**
 * The provider the page is actually playing with.
 *
 * `/wallet-source.js` is the one thing that knows both ways in, so it is asked first; the
 * bare `window.ethereum` is the fallback for a page that loaded before it — or for a build
 * with Privy switched off, where `window.ethereum` is all there has ever been.
 */
function activeProvider() {
    if (typeof window === 'undefined') return null;
    return window.DKWallet?.current?.() || window.ethereum || null;
}

/**
 * Wait a moment for a wallet source to exist at all.
 *
 * Both halves are late arrivals: `/wallet-source.js` is loaded `afterInteractive`, and the
 * Privy bridge is a React component that publishes itself once mounted (and re-publishes if
 * it remounts). A click in those first seconds would otherwise be answered as "no wallet in
 * this browser" — the one answer that is false, since the wallet source is what makes the
 * button say "Continue with Privy" in the first place. Nothing is decided until this returns.
 */
async function waitForSource(ms = 2500) {
    if (typeof window === 'undefined') return;
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        if (window.DKWallet || window.ethereum) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}

/**
 * What this browser can do, for a page that has to say something honest about it:
 *
 *   `injected`    — an extension is here and can be asked directly.
 *   `privy`       — the bridge is published, so the player can sign in with an email
 *                   address (or any wallet Privy lists) and be given a wallet.
 *   `connectable` — one of the two, which is the only thing a connect button needs.
 *
 * The bridge answers this itself when it can; the raw extension check is the fallback, and
 * it is deliberately synchronous in that case so the first paint is not waiting on anything.
 */
export async function walletCapabilities() {
    const injected = hasInjectedWallet();
    if (typeof window === 'undefined') return { injected: false, privy: false, connectable: false };

    if (window.DKWallet?.capabilities) {
        try {
            const caps = await window.DKWallet.capabilities();
            return { ...caps, connectable: !!caps.connectable };
        } catch {
            // The bridge is there but could not answer. Fall through to what we can see.
        }
    }
    return { injected, privy: false, connectable: injected, address: null, kind: injected ? 'injected' : null };
}

/** The wallet this browser last used, if any. */
export function savedAddress() {
    if (typeof window === 'undefined') return null;
    const fromManager = window.walletManager?.userAddress;
    if (isAddress(fromManager)) return fromManager;
    const stored = window.localStorage.getItem(WALLET_ADDRESS_KEY);
    return isAddress(stored) ? stored : null;
}

/** Ask a provider for an account and remember it, the way every page here stores a wallet. */
async function takeAccount(provider) {
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    const address = accounts?.[0];
    if (!isAddress(address)) throw new Error('The wallet returned no account.');
    window.localStorage.setItem(WALLET_CONNECTED_KEY, 'true');
    window.localStorage.setItem(WALLET_ADDRESS_KEY, address);
    return address;
}

/**
 * Connect a wallet, whichever way this browser has.
 *
 * An extension is asked directly, as it always was. With no extension the page is not shut:
 * if Privy is published, its modal takes an email address (or any wallet it lists) and hands
 * back an embedded wallet, which is the only way this works on a phone. That modal is
 * asynchronous and player-driven — it resolves when they finish signing in, and a closed
 * modal resolves to nothing, which is a decision rather than a failure.
 *
 * The thrown message is the one the panel shows, so it says what the player can actually do
 * on this device rather than naming only the extension they do not have.
 *
 * **`null` is a real answer.** A Privy login is a conversation — an email address, a code
 * from the inbox — and it can outlast any wait this function is willing to do, so waiting
 * runs out while the player is still typing and the honest report is "nothing yet", not a
 * failure. Callers treat null as nothing-happened; the sign-in itself lands later, and the
 * pages that can finish it listen for it.
 */
export async function connectWallet() {
    await waitForSource();

    if (!hasInjectedWallet() && window.DKWallet?.connect) {
        const caps = await walletCapabilities();
        const provider = await window.DKWallet.connect();
        if (provider) return await takeAccount(provider);
        if (caps.privy) return null;
        throw new Error(NO_WALLET_MESSAGE);
    }

    const provider = activeProvider();
    if (!provider) {
        throw new Error(NO_WALLET_MESSAGE);
    }
    return await takeAccount(provider);
}

export function forgetWallet() {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(WALLET_CONNECTED_KEY);
    window.localStorage.removeItem(WALLET_ADDRESS_KEY);
    window.localStorage.removeItem(TOKEN_KEY);
    if (window.walletManager) {
        window.walletManager.userAddress = null;
        window.walletManager.isConnected = false;
    }
    // An embedded wallet is a real session on the provider's side, not just a
    // localStorage flag: clearing the flag alone would sign the player straight back in
    // on the next click. A no-op for an injected wallet.
    if (window.DKWallet && window.DKWallet.disconnect) {
        window.DKWallet.disconnect().catch(() => {});
    }
}

/** Tell the page when the player switches account in their wallet. Returns an unsubscribe. */
export function onAccountsChanged(handler) {
    if (!hasInjectedWallet() || !window.ethereum.on) return () => {};
    const listener = (accounts) => handler(accounts?.[0] || null);
    window.ethereum.on('accountsChanged', listener);
    return () => window.ethereum.removeListener?.('accountsChanged', listener);
}

// --------------------------------------------------------------------- the session
export function readSession() {
    if (typeof window === 'undefined') return null;
    try {
        const raw = JSON.parse(window.localStorage.getItem(TOKEN_KEY) || 'null');
        return raw?.token && isAddress(raw.address) ? raw : null;
    } catch {
        return null;
    }
}

function writeSession(address, token, expiresAt) {
    window.localStorage.setItem(TOKEN_KEY, JSON.stringify({ address, token, expiresAt }));
}

export function clearSession() {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(TOKEN_KEY);
}

async function api(path, { method = 'GET', body, token } = {}) {
    const res = await fetch(path, {
        method,
        headers: {
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
    });
    let payload = null;
    try {
        payload = await res.json();
    } catch {
        payload = null;
    }
    if (!res.ok) {
        const error = new Error(payload?.error || `Request failed (${res.status})`);
        error.status = res.status;
        // The server's codes are a contract the page switches on — `x-required` opens the bind
        // card, `pending` is a normal answer, `throttled` has a countdown. Carrying them on the
        // error keeps pages from matching on prose.
        error.code = payload?.code || null;
        error.retryInSeconds = payload?.retryInSeconds || null;
        error.payload = payload || null;
        throw error;
    }
    return payload;
}

/**
 * Sign in: ask for a challenge, have the wallet sign it, exchange it for a session.
 * Costs no gas. The token lasts 30 days, so this is not a per-visit prompt.
 */
export async function signIn(address) {
    // Not `hasInjectedWallet`: an embedded wallet is installed as the page's provider the
    // moment Privy hands one over, and a player who signed in with an email address has to
    // be able to sign the challenge with it.
    const provider = activeProvider();
    if (!provider) {
        throw new Error(NO_WALLET_MESSAGE);
    }
    const challenge = await api(`/api/points/session?address=${encodeURIComponent(address)}`);
    const signature = await provider.request({
        method: 'personal_sign',
        params: [challenge.message, address],
    });
    const started = await api('/api/points/session', {
        method: 'POST',
        body: { message: challenge.message, signature },
    });
    writeSession(address, started.token, started.expiresAt);
    return started;
}

/** Current server state. Throws with `status: 401` when the session is gone. */
export async function fetchMe() {
    const session = readSession();
    if (!session) {
        const error = new Error('not signed in');
        error.status = 401;
        throw error;
    }
    return (await api('/api/points/me', { token: session.token })).state;
}

// ------------------------------------------------------------------- the referral
/**
 * A `?ref=` may carry either form — a five-character code, or an address in links that were
 * published before codes existed — and `refTokenFromInput` is the one place that decides. It also
 * unwraps a whole pasted invite link, which is what the share sheet hands a phone.
 */

/** Remember a `?ref=` token until there is a signed-in wallet to attach it to. */
export function stashRef(code) {
    if (typeof window === 'undefined') return;
    const ref = refTokenFromInput(code);
    if (!ref) return;
    window.localStorage.setItem(REF_KEY, ref);
}

export function pendingRef() {
    if (typeof window === 'undefined') return null;
    return refTokenFromInput(window.localStorage.getItem(REF_KEY) || '');
}

export function readRefFromUrl() {
    if (typeof window === 'undefined') return null;
    return refTokenFromInput(new URLSearchParams(window.location.search).get('ref') || '');
}

/**
 * The invite link for a token — a code, or an address for a wallet that has no code yet.
 * Built on `location.origin` rather than the canonical site URL so a link copied in a preview or on
 * a test host lands back where the player is; the *posted* text uses the server's URL (see `state.share`).
 */
export function refLink(token) {
    if (typeof window === 'undefined') return '';
    const ref = refTokenFromInput(token);
    return ref ? `${window.location.origin}/points?ref=${ref}` : `${window.location.origin}/points`;
}

/** Attach the stashed token. The server ignores it if this wallet already has one. */
export async function claimRef(code) {
    const session = readSession();
    const ref = refTokenFromInput(code);
    if (!session || !ref) return null;
    const { state } = await api('/api/points/me', {
        method: 'POST',
        token: session.token,
        body: { ref },
    });
    window.localStorage.removeItem(REF_KEY);
    return state;
}

/**
 * Attach a referrer a player typed in themselves — the path for a wallet that played first and met
 * an inviter afterwards.
 *
 * Unlike the link path, a refusal here has to reach the player with a reason, so it is thrown (with
 * the server's `code` on the error, like every other refusal in this module) rather than swallowed.
 */
export async function attachRef(input) {
    const session = readSession();
    if (!session) throw new Error('not signed in');
    const { state } = await api('/api/points/me', {
        method: 'POST',
        token: session.token,
        body: { attachRef: input },
    });
    return state;
}

// ---------------------------------------------------------------------- the vault
export async function requestClear(level) {
    const session = readSession();
    if (!session) throw new Error('not signed in');
    return api('/api/points/vault', { method: 'POST', token: session.token, body: { action: 'clear', level } });
}

/**
 * Share on X. `url` is the link to the post the player made — the doubling is paid once X is asked
 * about that link and answers that the **bound handle** wrote it. There is no way to claim the
 * bonus by tapping the button; a request without a link is refused by the server.
 */
export async function requestShare(url) {
    const session = readSession();
    if (!session) throw new Error('not signed in');
    return api('/api/points/vault', { method: 'POST', token: session.token, body: { action: 'share', url } });
}

// ------------------------------------------------------------------- earning on X
/**
 * Bind the X account that earns.
 *
 * `accessToken` is a Privy access token, sent whenever Privy is mounted. With it the server proves
 * the link against Privy and records the real account id; without it the binding is provisional and
 * keyed on the handle. Either way the binding is required before anything pays.
 */
export async function requestBindX(identity, accessToken = null) {
    const session = readSession();
    if (!session) throw new Error('not signed in');
    return api('/api/points/x', {
        method: 'POST',
        token: session.token,
        body: { action: 'bind', identity, accessToken },
    });
}

/**
 * Whether this deployment can *prove* an X binding (it has a Privy app id to check a token
 * against), and what this wallet has bound. Used by the page to decide whether offering
 * "Prove with Privy" is honest or an empty button.
 */
export async function fetchXStatus() {
    const session = readSession();
    if (!session) return null;
    return api('/api/points/x', { token: session.token });
}

// There is no `requestUnbindX`, and that is deliberate rather than an omission: a binding is not a
// thing a wallet can hand back. The route still answers an `unbind` action with the refusal (see
// `lib/points-program.js`), so an older bundle gets a sentence instead of a 404 — but nothing here
// offers one.

/** File the link to a post for a task (`campaign` or `share`). */
export async function requestTask(task, url) {
    const session = readSession();
    if (!session) throw new Error('not signed in');
    return api('/api/points/task', { method: 'POST', token: session.token, body: { action: 'submit', task, url } });
}

/**
 * Claim a one-time task (`follow`) — or ask after one that is already waiting.
 *
 * There is no link to hand over: the server decides what a claim means. A task with a verifier is
 * paid when the check passes, one without goes into a review window, and either way it refuses a
 * wallet with no bound X account. The same call does both jobs because the answers cannot disagree
 * that way — a claim inside its window replies with the window, and one whose window has closed is
 * settled on the way in and replies with the credit.
 */
export async function requestOneTimeClaim(taskId) {
    const session = readSession();
    if (!session) throw new Error('not signed in');
    return api('/api/points/task', { method: 'POST', token: session.token, body: { action: 'claim', task: taskId } });
}

/** Ask X again about a submission it has not indexed yet. */
export async function requestTaskCheck(task) {
    const session = readSession();
    if (!session) throw new Error('not signed in');
    return api('/api/points/task', { method: 'POST', token: session.token, body: { action: 'check', task } });
}

export async function fetchLeaderboard(limit = 25) {
    const session = readSession();
    const query = `?limit=${limit}`;
    const res = await fetch(`/api/points/leaderboard${query}`, {
        headers: session ? { Authorization: `Bearer ${session.token}` } : {},
        cache: 'no-store',
    });
    if (!res.ok) throw new Error('Could not load the leaderboard.');
    return res.json();
}
