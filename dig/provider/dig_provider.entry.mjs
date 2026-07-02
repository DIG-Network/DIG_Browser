// Bundling ENTRY for the DIG Browser injected `window.chia` provider.
//
// This file is NOT shipped as-is. build-provider.mjs bundles it (esbuild, IIFE,
// no imports) into dig/provider/dig_provider.js — the self-contained script
// build.py embeds verbatim into the renderer (kDigProviderJs) and injects into
// every page's MAIN world at document start.
//
// The provider SURFACE (isDIG/isGoby, request(), connect(), the Goby-legacy
// direct methods, alias routing, requestAccounts/accounts, walletSwitchChain,
// the shared error codes, the 202-pending retry) comes ENTIRELY from the shared
// package @dignetwork/chia-provider's buildProvider(). The DIG Browser and the
// dig-chrome-extension therefore expose the IDENTICAL window.chia — one contract,
// two consumers, no drift. This file adds only the browser's NATIVE transport and
// its browser-edition identity override.
//
// Transport: the browser reaches its in-process Chia wallet through a frame-scoped
// Mojo pipe installed by the renderer as window.__digWalletRpc.request(jsonString,
// callback), where the callback receives the wallet's JSON envelope string
// {"status":<u16>,"body":<json>} — or "" when the bridge is absent/unreachable.
// There is no fetch, no loopback HTTP, nothing for the page CSP to block, so the
// wallet is reachable on ANY dapp. The browser process supplies the calling
// frame's UNSPOOFABLE committed origin to the wallet's per-origin approval gate.

import { buildProvider } from '@dignetwork/chia-provider';

(function () {
  if (window.chia) return; // never clobber an already-present provider

  // The provider's own version. build.py replaces the {{VERSION}} token with the
  // real browser build before embedding this file into the renderer. If the token
  // is left unreplaced (running the raw/generated source, e.g. under the tests) it
  // falls back to a literal so callers always read a string, never `undefined`.
  var PROVIDER_VERSION = "{{VERSION}}";
  if (PROVIDER_VERSION === "{{" + "VERSION}}") PROVIDER_VERSION = "0.0.0-dev";

  // The transport hook the shared package calls once per RPC. It MUST resolve to a
  // {status, body} envelope, or a nullish value meaning "unreachable" (the package
  // then maps null → DISCONNECTED 4900 and a 202 → a pending error connect() polls
  // on). NEVER reject here for unreachability — resolve null so the package's
  // error mapping owns the error taxonomy uniformly across both consumers.
  function bridgeCall(method, params) {
    return new Promise(function (resolve) {
      var b = window.__digWalletRpc;
      if (!b || typeof b.request !== "function") { resolve(null); return; }
      var reqJson = JSON.stringify({ method: method, params: params || {} });
      try {
        b.request(reqJson, function (resp) {
          if (!resp) { resolve(null); return; } // "" / undefined → unreachable
          var env;
          try { env = JSON.parse(resp); } catch (_) { env = null; }
          if (!env) { resolve(null); return; } // malformed → unreachable
          resolve({ status: env.status, body: env.body });
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  // Build the shared provider surface over the native transport.
  var provider = buildProvider({ bridgeCall: bridgeCall, version: PROVIDER_VERSION });

  // Override the self-describing identity for the BROWSER edition. buildProvider()
  // defaults `info` to the extension's capability object (transport:walletconnect,
  // edition:extension); the native browser brokers in-process, so report that plus
  // the user-facing scheme it registers. (SYSTEM.md canonical: scheme "chia".)
  provider.info = {
    isDIG: true,
    transport: "native",
    edition: "browser",
    scheme: "chia",
    providerVersion: provider.info.providerVersion,
    version: PROVIDER_VERSION,
  };

  window.chia = provider;
  window.dispatchEvent(new Event("chia#initialized"));
})();
