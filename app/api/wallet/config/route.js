import { NextResponse } from 'next/server';

/**
 * The embedded-wallet SDK, pinned.
 *
 * Pinned deliberately: this URL used to be unversioned (`…/js-sdk-core`), which means the
 * CDN quietly serves whatever is latest and a facade verified against 0.76.1 could wake up
 * facing a different API. The calls `public/wallet-source.js` makes were checked against
 * this release's own type declarations — `new Privy({ appId, clientId?, storage })` with
 * `new LocalStorage()`, `initialize()`, `setMessagePoster()`, `embeddedWallet.getURL()` /
 * `onMessage()` / `create()` / `getEthereumProvider({ wallet, entropyId, entropyIdVerifier })`,
 * `auth.email.sendCode(email)` and `loginWithCode(email, code)` (which returns an
 * `AuthenticatedUser`, so `.user` is the user), `user.get()` → `{ user }`, `auth.logout()`,
 * and the module-level `getUserEmbeddedEthereumWallet` / `getEntropyDetailsFromUser`.
 * Move this number only after checking the new release's declarations the same way.
 */
const DEFAULT_SDK_URL = 'https://esm.sh/@privy-io/js-sdk-core@0.76.1';

// Reads server-side environment only; nothing here may be cached or prerendered, or a
// deployment would bake in whichever value happened to exist at build time.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Where the game runs. Sent so the browser never keeps a second copy of the truth. */
const CHAIN = {
    chainId: '0xb626',
    chainIdDecimal: 46630,
    name: 'Robinhood Chain Testnet',
    rpc: 'https://rpc.testnet.chain.robinhood.com',
    explorer: 'https://explorer.testnet.chain.robinhood.com',
    currency: { name: 'Ethereum', symbol: 'ETH', decimals: 18 },
};

/**
 * GET — the wallet configuration the browser is allowed to know.
 *
 * Only what is public leaves here. The embedded-wallet App ID and client ID identify
 * the app to Privy's own hosted UI; they are not credentials and they ship in every
 * dapp's bundle. No secret is read, and `embedded: null` — which is the state today —
 * is what keeps the whole embedded path dormant.
 */
export async function GET() {
    const appId = (process.env.PRIVY_APP_ID || '').trim();
    const clientId = (process.env.PRIVY_CLIENT_ID || '').trim();
    return NextResponse.json({
        chain: CHAIN,
        embedded: appId
            ? {
                appId,
                clientId: clientId || null,
                // Overridable so a deployment can move the pin once it has tested the new
                // release, or self-host the bundle instead of using a CDN.
                sdkUrl: (process.env.PRIVY_SDK_URL || '').trim() || DEFAULT_SDK_URL,
            }
            : null,
    });
}
