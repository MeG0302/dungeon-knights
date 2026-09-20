const webpack = require('webpack');

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // Privy dynamically (and optionally) imports its Farcaster Solana connector.
    // This app only uses EVM wallets, so skip bundling that optional dependency.
    config.plugins.push(
      new webpack.IgnorePlugin({ resourceRegExp: /^@farcaster\/mini-app-solana$/ })
    );
    return config;
  },
  async redirects() {
    return [
      { source: '/landing.html', destination: '/', permanent: true },
      { source: '/landing', destination: '/', permanent: true },
      { source: '/menu.html', destination: '/menu', permanent: true },
      { source: '/mint.html', destination: '/mint', permanent: true },
      { source: '/dungeon-select.html', destination: '/dungeons', permanent: true },
      { source: '/dungeon-select', destination: '/dungeons', permanent: true },
      { source: '/index.html', destination: '/game', permanent: true },
    ];
  },
};

module.exports = nextConfig;
