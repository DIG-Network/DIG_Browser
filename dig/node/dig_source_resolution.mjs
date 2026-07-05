// DIG Browser source-resolution policy (the CONSUMER side of the serve/consume
// split, SYSTEM.md → "Roles — serving vs consuming").
//
// Post-#44 the browser is a PURE RPC CONSUMER: it runs NO in-process node. Its
// chia:// read path resolves an EXTERNAL dig-node's read RPC, IN ORDER (§5.3):
//   1. an explicit user-configured CUSTOM endpoint if set — it overrides the
//      whole ladder (the user deliberately chose it, so it is used exclusively);
//   2. else a LOCAL standalone dig-node if reachable — preferred because it is
//      local/offline-capable and contributes to the network. Addressed
//      http://dig.local FIRST (the dig-installer maps it to the 127.0.0.2:80
//      loopback listener), then http://localhost:<port> (default 8080 — the
//      dig-node's always-on localhost listener);
//   3. else the PUBLIC GATEWAY https://rpc.dig.net — the final fallback, so a
//      standalone browser with no local node still resolves every request.
//
// The source is NEVER trusted: whichever node serves the bytes, the browser
// ALWAYS verifies the Merkle inclusion proof against the on-chain root and
// decrypts client-side, fail-closed (that happens in the loader via the shared
// dig_client read-crypto, not here).
//
// This module is the SINGLE SOURCE OF TRUTH for the *pure* resolution policy —
// the candidate ordering, the setting gate, the custom-endpoint override, and
// the short-TTL reachability memo. The native loader
// (chrome/browser/dig/dig_url_loader_factory.cc, added by
// windows-dig-browser-ux.patch) mirrors this exact logic in C++ (it cannot
// import JS). Keeping the policy here lets it be unit-tested with no Chromium
// build; the C++ side carries a pointer back to this file. Any change to the
// ordering / port / host / probe-path / TTL / override precedence must be made
// in BOTH places.
//
// Run:  node dig/node/dig_source_resolution.test.mjs   (Node >= 18)

// The dig-node's canonical local addresses, in preference order. dig.local has
// NO port (it is the privileged :80 listener the installer points at); the
// localhost listener uses the configurable port (default 8080).
export const DIG_LOCAL_HOST = "dig.local";
export const DEFAULT_LOCAL_PORT = 8080;

// The public gateway — the FINAL fallback of the ladder (the safety net when no
// local node is reachable). NEVER the primary endpoint (§5.3): a local node is
// always preferred. Browsers reach it over the plain-HTTPS public read tier (a
// browser cannot present a DIG-identity client cert, so it does not use the
// node-class mTLS path).
export const RPC_DIG_NET = "https://rpc.dig.net";

// The dig-node serves the JSON-RPC read methods at POST "/" and a cheap liveness
// probe at GET "/health" (server.rs). We probe /health, never a content method,
// so a failed probe is fast and side-effect free.
export const HEALTH_PATH = "/health";
export const RPC_PATH = "/";

// How long a reachability verdict (reachable OR not) is trusted before we
// re-probe. Short enough that starting/stopping the node is noticed within a
// few seconds; long enough that a page's many subresources never each re-probe
// a down node (which would stall every load). Milliseconds.
export const PROBE_TTL_MS = 5000;

// Where the browser-served pages read the source resolver verdict from. Stable
// names so an agent / the controller UI can read the active source posture.
export const SOURCE_LOCAL_NODE = "local-node"; // a standalone dig-node served it
export const SOURCE_PUBLIC_GATEWAY = "public-gateway"; // rpc.dig.net served it
export const SOURCE_CUSTOM = "custom-endpoint"; // the user's custom node served it

/**
 * Build the ordered list of local standalone dig-node base URLs to try.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.preferLocalNode=true] the user setting; when false the
 *   browser skips the standalone node entirely and consumes straight from the
 *   public gateway (rpc.dig.net) — always fully functional, a consumer needs no
 *   local node.
 * @param {number} [opts.port=DEFAULT_LOCAL_PORT] the localhost listener port.
 * @returns {string[]} base URLs WITHOUT a trailing slash, in preference order.
 *   Empty when the setting disables the local node.
 */
export function localNodeCandidates(opts = {}) {
  const preferLocalNode = opts.preferLocalNode !== false; // default true
  if (!preferLocalNode) return [];
  const port = Number.isInteger(opts.port) && opts.port > 0
    ? opts.port
    : DEFAULT_LOCAL_PORT;
  // dig.local (bare, no port) first — it is the friendly, installer-provisioned
  // name; then the always-on localhost listener on the configured port.
  return [`http://${DIG_LOCAL_HOST}`, `http://localhost:${port}`];
}

/**
 * Normalize a user-entered custom node endpoint into a base URL, or null if it
 * is empty/malformed. This is the §5.3 "explicitly-configured node" — a
 * discoverable, persisted setting that OVERRIDES the auto-ladder entirely.
 *
 * Accepts an http(s) URL, or a bare host[:port] (assumed http for the friendly
 * local case). Rejects non-http(s) schemes. Strips any trailing slash(es) so the
 * result composes with HEALTH_PATH / RPC_PATH exactly like the ladder candidates.
 *
 * @param {string} url the raw setting value.
 * @returns {string|null} a base URL WITHOUT a trailing slash, or null.
 */
export function normalizeCustomEndpoint(url) {
  if (typeof url !== "string") return null;
  let s = url.trim();
  if (!s) return null;
  // A bare host (no scheme) is a friendly convenience → assume http.
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) {
    s = `http://${s}`;
  }
  let parsed;
  try {
    parsed = new URL(s);
  } catch (_) {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  if (!parsed.host) return null;
  // Reconstruct base (scheme + host[:port]) + any path, minus trailing slashes.
  let base = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  base = base.replace(/\/+$/, "");
  return base;
}

/**
 * Is a dig-node /health response body a live dig-node? The probe must confirm
 * it is actually a dig-node (not some other service squatting the port), so we
 * require status:"ok" AND mode:"local-node" (server.rs health()). Defensive:
 * accepts a parsed object or a JSON string; anything malformed → false.
 *
 * @param {object|string} body the /health response.
 * @returns {boolean}
 */
export function isHealthyDigNode(body) {
  let v = body;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch (_) { return false; }
  }
  if (!v || typeof v !== "object") return false;
  return v.status === "ok" && v.mode === "local-node";
}

/**
 * A tiny short-TTL reachability memo. Caches, per base URL, the last probe
 * verdict + when it was taken, so the loader probes a given local node at most
 * once per PROBE_TTL_MS rather than on every subresource. PURE state container
 * (the caller injects the clock + the actual probe), so it is deterministic to
 * test. The C++ loader keeps the equivalent map keyed by base URL.
 */
export class ReachabilityMemo {
  /** @param {number} [ttlMs=PROBE_TTL_MS] */
  constructor(ttlMs = PROBE_TTL_MS) {
    this._ttl = ttlMs;
    this._memo = new Map(); // baseUrl -> { reachable: boolean, at: number }
  }

  /**
   * Return the cached verdict for `baseUrl` if it is still fresh at `now`,
   * else null (caller should re-probe).
   * @param {string} baseUrl
   * @param {number} now milliseconds (injected clock).
   * @returns {boolean|null}
   */
  get(baseUrl, now) {
    const e = this._memo.get(baseUrl);
    if (!e) return null;
    if (now - e.at >= this._ttl) return null; // stale
    return e.reachable;
  }

  /**
   * Record a fresh verdict.
   * @param {string} baseUrl
   * @param {boolean} reachable
   * @param {number} now milliseconds (injected clock).
   */
  put(baseUrl, reachable, now) {
    this._memo.set(baseUrl, { reachable: !!reachable, at: now });
  }
}

/**
 * Decide which source to read a chia:// request from, honoring the custom
 * endpoint override, the setting, and the reachability memo. This is the
 * ordering decision ONLY — it returns the chosen plan; the caller performs the
 * actual fetch + (always) the client-side verify/decrypt.
 *
 * Resolution order (§5.3):
 *   1. If `customEndpoint` is set → it is the SOLE step (kind 'override'). The
 *      auto-ladder is not consulted and the public gateway is NOT appended —
 *      the explicit choice wins entirely.
 *   2. Else each local-node candidate that the memo says is reachable (fresh) —
 *      in order. Candidates with no fresh verdict are returned as 'probe' steps
 *      so the caller probes /health, records the verdict, and continues.
 *   3. The public gateway (rpc.dig.net) is the terminal 'public-gateway' step —
 *      always appended (never skipped), so the plan always ends at a reachable
 *      source.
 *
 * @param {object} args
 * @param {string} [args.customEndpoint] the normalized custom endpoint base URL
 *   (from {@link normalizeCustomEndpoint}), or falsy when unset.
 * @param {string[]} args.candidates from {@link localNodeCandidates}.
 * @param {ReachabilityMemo} args.memo
 * @param {number} args.now injected clock (ms).
 * @returns {{plan: Array<{kind:'override'|'local'|'probe'|'public-gateway',
 *   baseUrl:string}>}}
 *   An ordered plan. The caller walks it: a 'probe' step means GET /health on
 *   baseUrl, and on success treat it as 'local'; 'override' and 'public-gateway'
 *   are POSTed to directly. The plan ends with 'public-gateway' (unless an
 *   override replaced the whole ladder).
 */
export function resolveSourcePlan(args) {
  const { customEndpoint, candidates, memo, now } = args;
  // An explicit custom endpoint overrides the entire ladder (§5.3).
  if (customEndpoint) {
    return { plan: [{ kind: "override", baseUrl: customEndpoint }] };
  }
  const plan = [];
  for (const baseUrl of candidates || []) {
    const verdict = memo ? memo.get(baseUrl, now) : null;
    if (verdict === true) {
      plan.push({ kind: "local", baseUrl });
    } else if (verdict === false) {
      // Known-unreachable + still fresh → skip without a probe.
      continue;
    } else {
      // No fresh verdict → the caller should probe this candidate.
      plan.push({ kind: "probe", baseUrl });
    }
  }
  // The public gateway is the terminal, always-present fallback.
  plan.push({ kind: "public-gateway", baseUrl: RPC_DIG_NET });
  return { plan };
}
