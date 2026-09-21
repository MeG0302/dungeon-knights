const webpack = require('webpack');

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // Privy imports its Solana/Farcaster connectors dynamically, and only when a project has
    // enabled them. This game is EVM-only, so those optional packages are not installed —
    // without this the build fails trying to resolve a dependency nothing will ever call.
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
