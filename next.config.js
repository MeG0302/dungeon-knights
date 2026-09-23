const webpack = require('webpack');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The server advertises its framework by default. Nothing needs that, and a response header naming
  // the stack is the first thing a scanner reads to pick which known bug to try.
  poweredByHeader: false,

  // The five headers the site was missing. Every one of them is inert on this codebase rather than a
  // guess: there is no `<base>`, `<object>` or `<embed>` anywhere in the pages, nothing frames the
  // game (it is a canvas, not an embed), and the only third-party scripts load their content into
  // the page rather than the page into anything. HSTS was already sent by Vercel on the custom
  // domain; it is repeated here so it also rides on the `*.vercel.app` hostnames, which is where
  // anybody poking at the deployment will be.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // A browser must never guess a content type. Without this, a file the server calls
          // `text/plain` is sniffed into HTML and executed as a page.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // A wallet address in a path or query is normal here (the portfolio reads one), and the
          // default `no-referrer-when-downgrade` would hand the full URL, address and all, to any
          // site a player clicks through to.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Clickjacking. A framed password screen or a framed wallet prompt is the attack this
          // closes; nothing on the site is meant to be embedded.
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
          },
          // Nothing here asks for the camera, the microphone or the location, so anything that
          // tries does not get to ask the player on our behalf.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
    ];
  },

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
