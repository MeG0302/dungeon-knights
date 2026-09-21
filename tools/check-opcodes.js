#!/usr/bin/env node
/**
 * Does the target chain actually run the opcodes this project compiles to?
 *
 *     node tools/check-opcodes.js
 *
 * This is a deploy gate, not a curiosity, and it exists because the answer was not obvious.
 * The contracts compile with `evmVersion = cancun` (`foundry.toml`, `tools/check-contracts.js`),
 * which emits `PUSH0`, `MCOPY` and transient storage. The chain is Arbitrum Nitro
 * (`nitro/v3.12.0-rc.2`), and Nitro's opcode support does not follow mainnet's — the standard
 * advice for it is to compile for `paris`, and under paris the OpenZeppelin v5 contracts this
 * project uses **will not compile at all** (`Bytes.sol` uses `MCOPY`, and `ERC721` reaches it
 * through `Strings`). So one of the two had to give, and guessing which one is how a deployed
 * contract ends up reverting with no useful error.
 *
 * Two independent pieces of evidence, because either alone can mislead:
 *
 *   1. **What the chain is already running.** The bytecode of the live DNG token, the live
 *      knight NFT and Game V3 is disassembled *properly* — walking PUSH immediates — and
 *      checked for post-Paris opcodes. A byte scan is not enough: `0x5e` and `0x5f` occur
 *      constantly inside push data, and a naive scan reports `MCOPY` in bytecode that has
 *      never executed one.
 *   2. **What the EVM does with it now.** `eth_call` with a state override whose `code` *is*
 *      `PUSH0`/`MCOPY`. If the opcode were unknown, the call fails with `invalid opcode`,
 *      which is a live statement about the interpreter rather than about code that happens to
 *      be sitting in state.
 *
 * A fork can be introduced or removed by a chain upgrade, so the answer is worth re-measuring
 * rather than remembering. Exit code is 0 only when the answer is "yes, and here is why".
 */

const RPC = process.env.GAME_RPC_URL || 'https://rpc.testnet.chain.robinhood.com';

/** Contracts already deployed on this chain, used as evidence of what it executes. */
const DEPLOYED = [
  ['DNG token', process.env.DNG_TOKEN_ADDRESS || '0x3D94e56E0d967633830f6d9E42CE43A64FFfD6Ca'],
  ['Knight NFT', process.env.KNIGHT_NFT_ADDRESS || '0x27Cfbb763188a50Fe1C0fFfBe2552b1945eE1B2D'],
  ['Game V3', process.env.GAME_CONTRACT_V3 || '0xD8de9385Db7DfE925882E76849B6e067e47236e5'],
];

/** The opcodes that arrived with Paris' successors, and what they would cost us. */
const NEW_OPCODES = [
  { code: 0x5f, name: 'PUSH0', fork: 'Shanghai', runtime: '0x5f00' },
  { code: 0x5e, name: 'MCOPY', fork: 'Cancun', runtime: '0x6000600060005e00' },
  { code: 0x5c, name: 'TLOAD', fork: 'Cancun', runtime: '0x60005c00' },
  { code: 0x5d, name: 'TSTORE', fork: 'Cancun', runtime: '0x600060005d00' },
];

let failures = 0;

function check(label, pass, detail) {
  const mark = pass ? 'ok  ' : 'FAIL';
  if (!pass) failures += 1;
  console.log(`  ${mark}  ${label}${detail ? `  — ${detail}` : ''}`);
}

async function rpc(method, params = []) {
  const response = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await response.json();
  return { result: body.result, error: body.error };
}

/**
 * Every opcode that would actually execute, from the deployed bytecode.
 *
 * The walk matters: after a `PUSHn` the next `n` bytes are data, and skipping them is the
 * difference between "this contract uses MCOPY" and "this contract contains the byte 0x5e".
 */
function disassemble(code) {
  const hex = code.slice(2);
  const seen = new Set();
  for (let i = 0; i < hex.length; i += 2) {
    const op = parseInt(hex.slice(i, i + 2), 16);
    seen.add(op);
    if (op >= 0x60 && op <= 0x7f) i += 2 * (op - 0x5f);
  }
  return seen;
}

async function main() {
  console.log('');
  console.log(`Opcode support — ${RPC}`);
  console.log('');

  const client = (await rpc('web3_clientVersion')).result;
  console.log(`  client  ${client}`);
  console.log('');

  // ------------------------------------------------------- evidence one: live bytecode
  let sawMcopy = false;
  let sawPush0 = false;
  console.log('  already running on this chain');
  for (const [label, address] of DEPLOYED) {
    const { result: code } = await rpc('eth_getCode', [address, 'latest']);
    if (!code || code === '0x') {
      console.log(`        ${label.padEnd(14)} no code at ${address}`);
      continue;
    }
    const seen = disassemble(code);
    const marks = NEW_OPCODES.filter((op) => seen.has(op.code)).map((op) => op.name);
    if (seen.has(0x5e)) sawMcopy = true;
    if (seen.has(0x5f)) sawPush0 = true;
    console.log(
      `        ${label.padEnd(14)} ${String((code.length - 2) / 2).padStart(6)} bytes  ${
        marks.length ? marks.join(', ') : 'pre-Shanghai only'
      }`,
    );
  }
  console.log('');
  check(
    'the chain is already executing Cancun opcodes',
    sawMcopy,
    sawMcopy
      ? 'MCOPY is present in the bytecode of deployed contracts'
      : 'no deployed contract runs MCOPY — Cancun support is unproven',
  );
  check('PUSH0 is present in deployed bytecode', sawPush0, sawPush0 ? 'Shanghai at least' : 'not seen');

  // -------------------------------------------------------- evidence two: live probing
  console.log('');
  console.log('  live probe (eth_call with a code override, no transaction)');
  const probes = new Map();
  for (const op of NEW_OPCODES) {
    const { result, error } = await rpc('eth_call', [
      {
        from: '0x0000000000000000000000000000000000000001',
        to: '0x0000000000000000000000000000000000000002',
        data: '0x',
      },
      'latest',
      { '0x0000000000000000000000000000000000000002': { code: op.runtime } },
    ]);
    const unsupported = Boolean(error);
    probes.set(op.name, !unsupported);
    console.log(
      `        ${op.name.padEnd(8)} ${op.fork.padEnd(9)} ${
        unsupported ? `REJECTED — ${String(error.message).slice(0, 70)}` : 'accepted'
      }`,
    );
  }

  const anyProbeWorked = [...probes.values()].some(Boolean);
  if (!anyProbeWorked) {
    // A node that refuses state overrides tells us nothing about its EVM; say so rather than
    // reading an empty result as a rejection.
    console.log('');
    console.log('  info  this RPC does not support code overrides, so the EVM could not be asked directly');
  }
  if (probes.get('MCOPY')) {
    check('the EVM accepts MCOPY today', true, 'measured, not assumed');
  } else if (anyProbeWorked) {
    check('the EVM accepts MCOPY today', false, 'the probe rejected it — the chain is pre-Cancun');
  } else {
    console.log('  info  falling back to the bytecode evidence above');
  }

  console.log('');
  if (failures) {
    console.log(`  ${failures} failure(s) — do not deploy cancun bytecode here`);
    process.exit(1);
  }
  console.log('  cancun bytecode is safe on this chain');
  console.log('  `evmVersion = cancun` in foundry.toml is correct for this network');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
