import { NextResponse } from 'next/server';

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
 * Only what is public leaves here. The App ID and client ID identify the app to Privy's
 * hosted components; they are not credentials and they ship in every dapp's bundle.
 *
 * **This route is no longer what switches the wallet on.** The provider is configured from
 * `PRIVY_APP_ID` in `app/layout.js` and `app/privy-bridge.js` is what the pages read, so
 * nothing on the site fetches this any more. It stays because it is the honest,
 * machine-readable answer to "which Privy app, and which chain, is this deployment on" —
 * useful to an operator or a check — and because it still answers `embedded: null` with the
 * App ID missing, which is exactly what dormancy looks like from outside.
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
            }
            : null,
    });
}
