# DIG Browser — normative spec

DIG Browser is an ungoogled-chromium fork that is a **pure RPC consumer** of DIG Network content. It
resolves `chia://` / `dig://` addresses by reading ciphertext + inclusion proofs from an **external**
DIG node over RPC, then **verifies and decrypts client-side, trustlessly**. It is NOT a node: it runs
no P2P networking, serves no content to peers, and manages no on-disk content cache. This document is
the authoritative contract an independent reimplementation (or a reviewer) can hold the fork to; it
agrees with the superproject `SYSTEM.md` ("Roles — serving vs consuming") and the docs.dig.net
protocol pages, and cross-references CLAUDE.md §5.3 (client→node connection order) and §5.1 (store
format).

> **Grandfathered build/release (§3.6a).** The fork keeps its own patch-based build (ungoogled-
> chromium + `patches/` + the DIG assets in `dig/`) and its own `master` release flow; it is exempt
> from the ecosystem's standard CI pipeline. DIG-specific policy that can be unit-tested without a
> Chromium build lives as ES modules under `dig/` (each with a `.test.mjs`); the native C++ that wires
> it into Chromium lives in `patches/ungoogled-chromium/**`, and every native mirror carries a pointer
> back to the `dig/` module that is the single source of truth for the policy.

## 1. Scope

DIG Browser MUST:

- resolve `chia://` and `dig://` requests through an EXTERNAL DIG node's read RPC (§3), following the
  §5.3 node-resolution ladder (§4);
- verify every retrieved resource's Merkle inclusion proof against the on-chain-anchored root and
  decrypt it client-side, **fail-closed**, using the shared `digstore` `dig_client` read-crypto wasm —
  the SAME artifact the hub, extension, and SDK use byte-for-byte (§5);
- inject a `window.chia` wallet provider (CHIP-0002) backed by the in-browser wallet (§6);
- surface per-resource proof provenance (Shields, §7) and a page-posture control surface
  (`dig://control`, §8);
- expose a discoverable, persisted **custom node endpoint** setting (§4.3).

DIG Browser MUST NOT:

- run an in-process/embedded DIG node, any P2P networking, provider records, or content serving;
- keep a user-managed on-disk content cache or expose cache-configuration chrome (no
  `chrome://settings/dig` cache section, no cache cap/usage/clear UI, no `DigCacheHandler` Mojo);
- reimplement the read-crypto in native code — there is exactly ONE trustless read-crypto
  implementation (the shared wasm).

The trust model is unconditional: **the source is never trusted.** Whichever node serves the bytes,
the browser independently verifies + decrypts them; a proof failure or decrypt failure yields an error
page, never partial/unverified content.

## 2. Addressing

- **`chia://<store>/<path>`** and **`dig://<store>/<path>`** resolve DIG store content. The store
  component is the on-chain store id (or a name that resolves to one); the path selects a resource
  within the store's current (anchored) root.
- Root pinning: the current root for a store is the on-chain-anchored root; the browser obtains it via
  the node's `dig.getAnchoredRoot` and pins reads to it, so served content that does not match the
  anchored root is rejected.
- `dig://` also addresses the browser's own built-in surfaces (`dig://control`, `dig://shields`, new
  tab) served locally from `dig/`; those are UI, not network content, and bypass §3–§5.

## 3. Read RPC (consumer → external node)

The browser is a JSON-RPC client of a DIG node's read interface. Against the chosen node base URL
(§4) it uses:

- `GET /health` — a cheap, side-effect-free liveness probe. A healthy DIG node answers
  `{ "status": "ok", "mode": "local-node" }`; any other/malformed body means "not a usable DIG node".
- `POST /` — the JSON-RPC read methods: `dig.getContent` (blind ciphertext + inclusion proof for a
  resource), `dig.getAnchoredRoot` (the on-chain root for root-pinning), `dig.getProof`, and related
  read methods. The browser sends only blind retrieval keys / addresses; it never sends URNs or keys.

The browser performs NO write/spend RPC on the read path. Wallet-signed actions go through the
`window.chia` provider (§6), not the content loader.

## 4. Node-resolution ladder (§5.3)

For each `chia://`/`dig://` request the browser selects a node endpoint in this fixed order, using the
first that responds healthy (`dig/node/dig_source_resolution.mjs` is the single source of truth; the
native `chrome/browser/dig/dig_url_loader_factory.cc` mirrors it in C++):

1. **Explicit custom endpoint** — the user-configured node/RPC URL (§4.3), when set. Overrides the
   ladder entirely.
2. **`http://dig.local`** — the installed local DIG node (the dig-installer maps `dig.local` to the
   node's privileged loopback listener). Preferred: local, offline-capable, contributes to the
   network.
3. **`http://localhost:<port>`** — the local DIG node's always-on loopback listener (default port
   `8080`) when `dig.local` is not resolvable.
4. **`https://rpc.dig.net`** — the public gateway. FINAL fallback only, when no local node is
   reachable.

Resolution rules:

- The browser **never** hard-codes `rpc.dig.net` as the primary endpoint; it is the safety net.
- Reachability is cached per base URL with a short TTL (`PROBE_TTL_MS`, 5 s) so a page's many
  subresources do not each re-probe (`ReachabilityMemo`); a `/health` probe gates promotion of a
  candidate to "use".
- The ladder ALWAYS terminates at a reachable source (`rpc.dig.net` if nothing local answers), so a
  standalone browser with no local node still resolves every request.
- A node-class transport (mTLS) is NOT required of the browser: it is a browser/plain-HTTPS read
  client (it cannot present a DIG-identity client cert), so it uses the public read tier of
  `rpc.dig.net` and the local node's loopback listener. (Contrast §5.3's node-class-client mTLS rule,
  which governs the CLI/SDK, not the browser.)

### 4.3 Custom node setting

The browser ships a first-class, discoverable, persisted setting to override the node endpoint (a
custom dig-node base URL / RPC URL). When set it takes precedence over the auto-ladder (§4 step 1).
Absent an override the 2→3→4 order is mandatory.

## 5. Trustless read-crypto (single source)

After bytes are retrieved from the chosen node, the browser ALWAYS, in-process:

1. verifies the resource's **Merkle inclusion proof** against the pinned on-chain-anchored root;
2. derives the resource key from the URN and **decrypts** the ciphertext;
3. reassembles chunks and serves the plaintext to the renderer only if every step succeeds —
   otherwise it fails closed with an error page.

This is implemented by the shared `digstore` `dig_client` read-crypto **wasm** — the byte-identical
artifact (same SHA-256) the hub (`apps/web/lib/dig-client`), the `dig-chrome-extension`, and
`@dignetwork/dig-sdk` consume. There is exactly ONE trustless read-crypto implementation in the
ecosystem; the browser MUST NOT carry a second (native C++) copy. Client-side decryption is
load-bearing (it powers Shields, §7) and is never delegated to the node.

## 6. Wallet — injected `window.chia`

The browser injects a `window.chia` provider (built from `@dignetwork/chia-provider`, bundled by
`dig/provider/build-provider.mjs`) exposing the CHIP-0002 method set (parity with the hub's shared
`WALLET_METHODS`): `chip0002_{connect,chainId,getPublicKeys,getAssetCoins,getAssetBalance,
signCoinSpends,signMessage}`, `chia_{getAddress,signMessageByAddress,takeOffer,createOffer,getNfts}`.
Requests are answered by the in-browser wallet over a loopback bridge behind a per-origin consent
gate; the wallet holds the keys and signs — dapps and the content loader never see key material.

## 7. Shields — per-resource proof provenance

`dig://shields` presents a per-capsule **inclusion-proof ledger**: for each resource the current page
loaded over `chia://`/`dig://`, the ledger records the store/root it verified against and the
proof/decrypt outcome (`dig/shields/dig_ledger.mjs` is the pure model). Shields is a transparency
surface over the trustless read model (§5); it reads the loader's verification results and never
weakens them.

## 8. Control — `dig://control`

`dig://control` is the full-page Control Pane (opened from a dedicated toolbar button;
`dig/control/dig_control.mjs` is the posture policy). It surfaces the browser's DIG posture (active
source, wallet/connection state, links). The browser MAY link out to the external node's own control
surface (`dig://control` content served by the node) but is NOT the node's configuration UI — node
configuration lives with the node.

## 9. Conformance

- **Single read-crypto:** the `dig_client` wasm the browser loads MUST be the byte-identical artifact
  (same SHA-256) used by the hub, extension, and SDK; a divergent copy is a conformance failure.
- **Ladder parity:** `dig/node/dig_source_resolution.mjs` and its native C++ mirror MUST implement the
  identical ordering, host/port, probe path, and TTL; any change is made in both, in one unit of work.
- **No node surface:** the shipped browser exposes no node/P2P/cache configuration chrome (§1).
- **Cross-doc agreement:** this spec MUST agree with `SYSTEM.md` (Roles — serving vs consuming) and the
  docs.dig.net protocol pages; a change to the resolution ladder, the read model, or the wallet method
  set updates all three in the same unit of work.

## 10. Transition (#41/#44)

The fork is mid-migration to the pure-RPC-consumer contract above (super-repo #44, per the #41
separation-of-concerns ruling). The remaining code deltas from the previous "browser runs an
in-process node" architecture are:

- **Remove the in-process node** (the `dig-runtime` cdylib loaded at PostBrowserStart) and make the
  terminal fallback of the §4 ladder `rpc.dig.net` instead of an in-process node. This ships gated on
  the dig-installer reliably delivering a local dig-node (#40) AND a buildable release (#26).
- **Single-source the read-crypto** — drop the native C++ `net::dig` DigURLLoader read-crypto copy in
  favor of the shared wasm (§5).
- **Remove the `chrome://settings/dig` cache section** + the `DigCacheHandler` Mojo + the "My Node"
  cache card (§1).
- **Add the custom-node setting** (§4.3).

Until the in-process node is removed, `dig/node/dig_source_resolution.mjs` still lists an `in-process`
terminal step; the target terminal step is `rpc.dig.net`. This section is removed once the migration
lands.
