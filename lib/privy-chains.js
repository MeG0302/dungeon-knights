import { defineChain } from 'viem';

/**
 * The chains this game can be played on, in the shape Privy's provider wants them.
 *
 * These numbers are the same ones `/api/wallet/config` publishes and `public/config.js`
 * hands to the legacy scripts, and they have to stay that way: the chain the provider
 * calls home and the chain the contracts live on are the same fact, and a second copy that
 * drifts is a wallet that connects happily and then cannot transact.
 *
 * `defineChain` is used rather than a plain object because Privy builds its transports
 * from these (rpcUrls, currency, explorer) and viem's own validation is the cheapest way
 * to be sure the shape is the one every consumer expects.
 */
export const robinhoodTestnet = defineChain({
    id: 46630,
    name: 'Robinhood Chain Testnet',
    nativeCurrency: { name: 'Ethereum', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
        default: { http: ['https://rpc.testnet.chain.robinhood.com'] },
    },
    blockExplorers: {
        default: {
            name: 'Robinhood Explorer',
            url: 'https://explorer.testnet.chain.robinhood.com',
        },
    },
    testnet: true,
});

export const robinhoodMainnet = defineChain({
    id: 4663,
    name: 'Robinhood Chain',
    nativeCurrency: { name: 'Ethereum', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
        default: { http: ['https://rpc.mainnet.chain.robinhood.com'] },
    },
    blockExplorers: {
        default: {
            name: 'Robinhood Explorer',
            url: 'https://robinhoodchain.blockscout.com',
        },
    },
});

/** The chain the game runs on today. `public/config.js` switches with `USE_MAINNET`. */
export const DEFAULT_CHAIN = robinhoodTestnet;

/** Everything Privy may switch a wallet to without a second thought. */
export const SUPPORTED_CHAINS = [robinhoodTestnet, robinhoodMainnet];

/**
 * The parameters `wallet_addEthereumChain` needs, for a wallet that has never heard of
 * Robinhood Chain. Taken from the chain object rather than typed out again.
 */
export function addChainParams(chain = DEFAULT_CHAIN) {
    return [{
        chainId: `0x${chain.id.toString(16)}`,
        chainName: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: [chain.rpcUrls.default.http[0]],
        blockExplorerUrls: [chain.blockExplorers.default.url],
    }];
}
