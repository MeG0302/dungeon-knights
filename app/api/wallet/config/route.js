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
                // Overridable so a deployment can pin an exact SDK version (which it
                // should, once tested) or self-host the bundle instead of using a CDN.
                sdkUrl: (process.env.PRIVY_SDK_URL || '').trim() || 'https://esm.sh/@privy-io/js-sdk-core',
            }
            : null,
    });
}
