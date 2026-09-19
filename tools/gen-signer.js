#!/usr/bin/env node
/**
 * Generate the backend signer keypair.
 *
 * Game V4 only pays runs signed by this key, so it is the one secret that stands
 * between a script and the treasury. Run this once:
 *
 *     node tools/gen-signer.js
 *
 * It prints an address and a private key. The address goes into the V4 constructor (or
 * `setTrustedSigner`); the private key goes into Vercel as `GAME_SIGNER_PRIVATE_KEY`.
 *
 * Nothing is written to disk and nothing is logged anywhere else — copy the key into
 * Vercel and keep it out of the repo, out of chat, and out of screenshots. If it ever
 * leaks, rotate it: `setTrustedSigner(newAddress)` on V4, then update the env var. The
 * old key stops working the moment the transaction confirms.
 */

const crypto = require('crypto');

let Wallet;
try {
    ({ Wallet } = require('ethers'));
} catch {
    console.error('ethers is not installed. Run `npm install` first.');
    process.exit(1);
}

const wallet = new Wallet(`0x${crypto.randomBytes(32).toString('hex')}`);

console.log('');
console.log('Backend run signer');
console.log('──────────────────────────────────────────────────────────────────');
console.log(`address      ${wallet.address}`);
console.log(`private key  ${wallet.privateKey}`);
console.log('──────────────────────────────────────────────────────────────────');
console.log('');
console.log('Next:');
console.log('  1. Paste the private key into Vercel → Settings → Environment Variables');
console.log('     as GAME_SIGNER_PRIVATE_KEY');
console.log('       (Secret type, Production and Preview — leave Development blank so');
console.log('        local runs keep using the legacy path until you decide otherwise)');
console.log('  2. Pass the address as the third constructor argument when you deploy');
console.log('     Game V4 in Remix (see docs/DEPLOY-GAME-V4.md)');
console.log('  3. Verify the two match:  node tools/check-v4.js 0x<v4 address>');
console.log('');
