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
 * These are the keys `public/wallet.js` uses on every other page. Writing them here
 * means connecting on /points also connects you on the Knight's Hall and Summoning
 * Chamber, instead of the site holding two different ideas of your wallet.
 */
const WALLET_CONNECTED_KEY = 'walletConnected';
const WALLET_ADDRESS_KEY = 'walletAddress';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function isAddress(value) {
    return typeof value === 'string' && ADDRESS_RE.test(value.trim());
}

export function shortAddress(address) {
    return isAddress(address) ? `${address.slice(0, 6)}…${address.slice(-4)}` : '';
}

// ------------------------------------------------------------------ wallet access
export function hasInjectedWallet() {
    return typeof window !== 'undefined' && !!window.ethereum;
}

/** The wallet this browser last used, if any. */
export function savedAddress() {
    if (typeof window === 'undefined') return null;
    const fromManager = window.walletManager?.userAddress;
    if (isAddress(fromManager)) return fromManager;
    const stored = window.localStorage.getItem(WALLET_ADDRESS_KEY);
    return isAddress(stored) ? stored : null;
}

export async function connectWallet() {
    if (!hasInjectedWallet()) {
        throw new Error('No Web3 wallet found. Install MetaMask to enter the vault.');
    }
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const address = accounts?.[0];
    if (!isAddress(address)) throw new Error('The wallet returned no account.');
    window.localStorage.setItem(WALLET_CONNECTED_KEY, 'true');
    window.localStorage.setItem(WALLET_ADDRESS_KEY, address);
    return address;
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
        throw error;
    }
    return payload;
}

/**
 * Sign in: ask for a challenge, have the wallet sign it, exchange it for a session.
 * Costs no gas. The token lasts 30 days, so this is not a per-visit prompt.
 */
export async function signIn(address) {
    if (!hasInjectedWallet()) {
        throw new Error('No Web3 wallet found. Install MetaMask to enter the vault.');
    }
    const challenge = await api(`/api/points/session?address=${encodeURIComponent(address)}`);
    const signature = await window.ethereum.request({
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
/** Remember a `?ref=` code until there is a signed-in wallet to attach it to. */
export function stashRef(code) {
    if (typeof window === 'undefined' || !isAddress(code)) return;
    window.localStorage.setItem(REF_KEY, code.trim());
}

export function pendingRef() {
    if (typeof window === 'undefined') return null;
    const value = window.localStorage.getItem(REF_KEY);
    return isAddress(value) ? value : null;
}

export function readRefFromUrl() {
    if (typeof window === 'undefined') return null;
    const value = new URLSearchParams(window.location.search).get('ref');
    return isAddress(value) ? value : null;
}

export function refLink(address) {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/points?ref=${address}`;
}

/** Attach the stashed code. The server ignores it if this wallet already has one. */
export async function claimRef(code) {
    const session = readSession();
    if (!session || !isAddress(code)) return null;
    const { state } = await api('/api/points/me', {
        method: 'POST',
        token: session.token,
        body: { ref: code },
    });
    window.localStorage.removeItem(REF_KEY);
    return state;
}

// ---------------------------------------------------------------------- the vault
export async function requestClear(level) {
    const session = readSession();
    if (!session) throw new Error('not signed in');
    return api('/api/points/vault', { method: 'POST', token: session.token, body: { action: 'clear', level } });
}

export async function requestShare() {
    const session = readSession();
    if (!session) throw new Error('not signed in');
    return api('/api/points/vault', { method: 'POST', token: session.token, body: { action: 'share' } });
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
