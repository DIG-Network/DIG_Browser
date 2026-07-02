// Test harness for the injected window.chia provider (dig/provider/dig_provider.js).
//
// A full Chromium build is infeasible in CI for a provider-surface change, so this
// loads the GENERATED IIFE provider source directly under a synthetic `window`
// and asserts the full shared-package surface an agent/dapp relies on.
//
// dig_provider.js is BUNDLED from @dignetwork/chia-provider's buildProvider() by
// build-provider.mjs (entry: dig_provider.entry.mjs), wrapped with the browser's
// NATIVE window.__digWalletRpc transport. This harness EXECUTES that exact
// generated file so the test can never drift from what build.py embeds into the
// renderer. Regenerate the provider (npm run build) before running this if the
// entry or the package changed.
//
// It asserts:
//   - identity: isDIG, isGoby, version, info{transport:native,edition:browser,scheme:chia}
//   - the static method catalogue (window.chia.methods, all namespaced, no dups)
//   - request({method:'chip0002_getMethods'|'getMethods'}) answered locally (no bridge)
//   - the shared error codes (USER_REJECTED/UNAUTHORIZED/UNSUPPORTED_METHOD/DISCONNECTED)
//   - transport error mapping: unreachable→4900, 401→4100, 202→4001+pending
//   - Goby parity: isConnected() callable, direct methods, transfer→chia_send remap,
//     requestAccounts/accounts, walletSwitchChain mainnet-only, the 202→200 retry loop
//
// Run:  node --test dig/provider/dig_provider.test.mjs
// (Node >= 18; uses the built-in `node:test` runner + `node:assert`.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const providerSrc = readFileSync(join(here, 'dig_provider.js'), 'utf8');

// The provider runs in a separate vm realm, so arrays/objects it returns have a
// different Array/Object prototype and `deepStrictEqual` (which checks the
// prototype) would reject them. Compare structurally by value instead.
function sameJson(a, b) {
  assert.equal(JSON.stringify(a), JSON.stringify(b));
}

// Load the provider IIFE into a sandbox with a synthetic window. `bridge`, when
// provided, becomes window.__digWalletRpc (the native Mojo pipe stand-in). The
// bundled package uses setTimeout for connect's backoff, JSON, Date, Promise —
// all provided here so the realm mirrors a real renderer main world.
function loadProvider(bridge) {
  const events = [];
  const sandbox = {
    window: {
      dispatchEvent(ev) { events.push(ev.type); },
    },
    Event: class { constructor(type) { this.type = type; } },
    setTimeout,
    clearTimeout,
    Date,
    Promise,
    JSON,
    console,
  };
  if (bridge) sandbox.window.__digWalletRpc = bridge;
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(providerSrc, sandbox, { filename: 'dig_provider.js' });
  return { chia: sandbox.window.chia, events };
}

// A native-bridge stand-in that records the JSON requests it received and answers
// per method with canned data. Mirrors window.__digWalletRpc.request(json, cb).
function spyBridge() {
  const reqs = [];
  const bridge = {
    request(reqJson, cb) {
      const parsed = JSON.parse(reqJson);
      reqs.push(parsed);
      if (parsed.method === 'chia_getAddress') { cb(JSON.stringify({ status: 200, body: { data: { address: 'xch1testaddr' } } })); return; }
      if (parsed.method === 'chia_send') { cb(JSON.stringify({ status: 200, body: { data: { id: '0xspend' } } })); return; }
      if (parsed.method === 'chip0002_connect') { cb(JSON.stringify({ status: 200, body: { data: { connected: true } } })); return; }
      cb(JSON.stringify({ status: 200, body: { data: {} } }));
    },
  };
  return { reqs, bridge };
}

test('provider exposes a stable identity: isDIG + isGoby + version + info', () => {
  const { chia } = loadProvider();
  assert.equal(chia.isDIG, true);
  assert.equal(chia.isGoby, true, 'browser provider must advertise isGoby for Goby dApps');
  assert.equal(typeof chia.version, 'string');
  assert.ok(chia.version.length > 0, 'version is a non-empty string');
  assert.ok(chia.info && typeof chia.info === 'object', 'info object present');
  assert.equal(chia.info.isDIG, true);
  assert.equal(chia.info.edition, 'browser');
  assert.equal(chia.info.transport, 'native');
  assert.equal(chia.info.scheme, 'chia');
});

test('provider exposes a static method catalogue (window.chia.methods)', () => {
  const { chia } = loadProvider();
  assert.ok(Array.isArray(chia.methods), 'methods is an array');
  // CHIP-0002 core + chia_* surface must be present and namespaced.
  assert.ok(chia.methods.includes('chip0002_connect'));
  assert.ok(chia.methods.includes('chip0002_getPublicKeys'));
  assert.ok(chia.methods.includes('chip0002_signCoinSpends'));
  assert.ok(chia.methods.includes('chia_getAddress'));
  assert.ok(chia.methods.includes('chia_createOffer'));
  // every entry is namespaced (an agent can branch on the prefix).
  for (const m of chia.methods) {
    assert.match(m, /^(chip0002_|chia_)/, `${m} is namespaced`);
  }
  // no duplicates.
  assert.equal(new Set(chia.methods).size, chia.methods.length);
});

test('chip0002_getMethods is answered locally (no bridge call) and returns the catalogue', async () => {
  let bridgeCalls = 0;
  const bridge = {
    request() { bridgeCalls += 1; /* never resolves: must not be reached */ },
  };
  const { chia } = loadProvider(bridge);
  const res = await chia.request({ method: 'chip0002_getMethods' });
  sameJson(res, chia.methods);
  // The bare form resolves to the same introspection answer.
  const res2 = await chia.request({ method: 'getMethods' });
  sameJson(res2, chia.methods);
  assert.equal(bridgeCalls, 0, 'introspection must not hit the native bridge');
});

test('errorCodes catalogue is exported and uses the shared package codes', () => {
  const { chia } = loadProvider();
  assert.ok(chia.errorCodes && typeof chia.errorCodes === 'object');
  assert.equal(chia.errorCodes.USER_REJECTED, 4001);
  assert.equal(chia.errorCodes.UNAUTHORIZED, 4100);
  assert.equal(chia.errorCodes.UNSUPPORTED_METHOD, 4200);
  // Shared-package name is DISCONNECTED (was WALLET_UNREACHABLE in the old fork).
  assert.equal(chia.errorCodes.DISCONNECTED, 4900);
});

test('an unreachable bridge throws DISCONNECTED (4900), not the ad-hoc -1', async () => {
  // No bridge installed at all → bridgeCall resolves null → package maps to 4900.
  const { chia } = loadProvider();
  await assert.rejects(
    () => chia.request({ method: 'getPublicKeys' }),
    (e) => { assert.equal(e.code, 4900); return true; });
});

test('a 401 from the wallet maps to UNAUTHORIZED (4100)', async () => {
  const bridge = {
    request(_req, cb) {
      cb(JSON.stringify({ status: 401, body: { error: 'origin not approved' } }));
    },
  };
  const { chia } = loadProvider(bridge);
  await assert.rejects(
    () => chia.request({ method: 'getPublicKeys' }),
    (e) => { assert.equal(e.code, 4100); return true; });
});

test('a pending (202) surfaces USER_REJECTED-class pending code (4001)', async () => {
  const bridge = {
    request(_req, cb) { cb(JSON.stringify({ status: 202, body: {} })); },
  };
  const { chia } = loadProvider(bridge);
  // rpc() (not connect()'s retry loop) throws the pending error with code 4001.
  await assert.rejects(
    () => chia.request({ method: 'getPublicKeys' }),
    (e) => { assert.equal(e.code, 4001); assert.equal(e.pending, true); return true; });
});

test('a successful call returns body.data and isConnected() flips true on connect', async () => {
  const bridge = {
    request(req, cb) {
      const parsed = JSON.parse(req);
      if (parsed.method === 'chip0002_connect') {
        cb(JSON.stringify({ status: 200, body: { data: { connected: true } } }));
      } else {
        cb(JSON.stringify({ status: 200, body: { data: ['pk1', 'pk2'] } }));
      }
    },
  };
  const { chia } = loadProvider(bridge);
  const keys = await chia.request({ method: 'getPublicKeys' });
  sameJson(keys, ['pk1', 'pk2']);
  // isConnected() is a CALLABLE (Goby convention), not a boolean property.
  assert.equal(typeof chia.isConnected, 'function');
  assert.equal(chia.isConnected(), false);
  await chia.connect();
  assert.equal(chia.isConnected(), true);
  assert.equal(chia.chainId, 'mainnet'); // DIG is Chia mainnet
});

// ─── Goby / CHIP-0002 / Sage-WC2 compatibility (shared-package parity) ──────────
// These pin the surface the browser gained by consuming @dignetwork/chia-provider:
// identity flags, Goby-legacy DIRECT methods on the object, alias routing, the
// account helpers, mainnet-only chain switch, and isConnected() as a callable.

test('Goby-legacy direct methods exist on the provider object', () => {
  const { bridge } = spyBridge();
  const { chia } = loadProvider(bridge);
  for (const m of [
    'connect', 'getPublicKeys', 'filterUnlockedCoins', 'getAssetCoins', 'getAssetBalance',
    'signCoinSpends', 'signMessage', 'signMessageByAddress', 'transfer', 'sendTransaction',
    'createOffer', 'takeOffer', 'cancelOffer', 'getNFTs', 'getNFTInfo', 'walletSwitchChain',
    'walletWatchAsset', 'requestAccounts', 'accounts',
  ]) {
    assert.equal(typeof chia[m], 'function', `${m} is a direct method`);
  }
});

test('request({method:"transfer"}) routes to chia_send with to→address remap', async () => {
  const { reqs, bridge } = spyBridge();
  const { chia } = loadProvider(bridge);
  await chia.request({ method: 'transfer', params: { to: 'xch1dest', amount: 7, fee: 1 } });
  const sent = reqs.find((r) => r.method === 'chia_send');
  assert.ok(sent, 'transfer must reach the native bridge as chia_send');
  sameJson(sent.params, { amount: 7, fee: 1, address: 'xch1dest' });
});

test('the direct transfer() method routes identically to request', async () => {
  const { reqs, bridge } = spyBridge();
  const { chia } = loadProvider(bridge);
  await chia.transfer({ to: 'xch1dest2', amount: 3 });
  const sent = reqs.find((r) => r.method === 'chia_send');
  assert.ok(sent);
  sameJson(sent.params, { amount: 3, address: 'xch1dest2' });
});

test('request({method:"getPublicKeys"}) routes to chip0002_getPublicKeys', async () => {
  const { reqs, bridge } = spyBridge();
  const { chia } = loadProvider(bridge);
  await chia.request({ method: 'getPublicKeys' });
  assert.ok(reqs.some((r) => r.method === 'chip0002_getPublicKeys'));
});

test('requestAccounts() connects then returns the address list + caches selectedAddress', async () => {
  const { bridge } = spyBridge();
  const { chia } = loadProvider(bridge);
  const accts = await chia.requestAccounts();
  sameJson(accts, ['xch1testaddr']);
  assert.equal(chia.isConnected(), true);
  assert.equal(chia.selectedAddress, 'xch1testaddr');
});

test('accounts() rejects 4900 when not connected, returns addresses once connected', async () => {
  const { bridge } = spyBridge();
  const { chia } = loadProvider(bridge);
  await assert.rejects(() => chia.accounts(), (e) => { assert.equal(e.code, 4900); return true; });
  await chia.connect();
  sameJson(await chia.accounts(), ['xch1testaddr']);
});

test('walletSwitchChain accepts mainnet locally and rejects other chains as unsupported', async () => {
  const { reqs, bridge } = spyBridge();
  const { chia } = loadProvider(bridge);
  assert.equal(await chia.walletSwitchChain({ chainId: 'mainnet' }), null);
  assert.equal(reqs.length, 0, 'mainnet switch is answered locally, no bridge call');
  await assert.rejects(
    () => chia.walletSwitchChain({ chainId: 'testnet11' }),
    (e) => { assert.equal(e.code, 4200); return true; });
});

test('connect() polls through 202 pending-approval responses then resolves', async () => {
  // The package's connect() backoff calls setTimeout(res, 1200). Patch the sandbox
  // to fire on the next macrotask so the retry loop advances fast + deterministically.
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, _ms, ...args) => realSetTimeout(fn, 0, ...args);
  try {
    let attempt = 0;
    const bridge = {
      request(_req, cb) {
        attempt++;
        if (attempt < 3) { cb(JSON.stringify({ status: 202, body: {} })); return; } // pending, retry
        cb(JSON.stringify({ status: 200, body: { data: { approved: true } } }));
      },
    };
    const { chia } = loadProvider(bridge);
    const r = await chia.connect();
    sameJson(r, { approved: true });
    assert.equal(attempt, 3, 'should have retried twice before approval');
    assert.equal(chia.isConnected(), true);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

test('on/off accept the connect event and a throwing listener is isolated', async () => {
  const { bridge } = spyBridge();
  const { chia } = loadProvider(bridge);
  const seen = [];
  const handler = (d) => seen.push(d);
  chia.on('connect', handler);
  chia.on('connect', () => { throw new Error('listener blew up'); });
  await chia.connect();
  assert.equal(seen.length, 1, 'the good listener fired despite the throwing one');
  chia.off('connect', handler);
  await chia.connect();
  assert.equal(seen.length, 1, 'removed listener must not fire again');
});
