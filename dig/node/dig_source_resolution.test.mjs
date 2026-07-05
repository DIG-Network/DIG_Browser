// Test harness for the source-resolution policy (dig/node/dig_source_resolution.mjs).
//
// A full Chromium build is infeasible in CI, so the *pure* resolution policy the
// native chia:// loader mirrors (candidate ordering, the setting gate, the custom
// endpoint override, the short-TTL reachability memo, and the resolve plan) lives
// in a single JS module that this harness exercises directly. The C++ loader
// carries a pointer back to that module; these tests guard the contract both
// sides share.
//
// Post-#44 (separation-of-concerns re-arch): the browser is a PURE RPC CONSUMER.
// It owns no in-process node, so the ladder terminates at the PUBLIC GATEWAY
// (rpc.dig.net), not at an in-process node. §5.3 order:
//   explicit custom endpoint > dig.local > localhost:<port> > rpc.dig.net.
//
// Run:  node dig/node/dig_source_resolution.test.mjs   (Node >= 18)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DIG_LOCAL_HOST,
  DEFAULT_LOCAL_PORT,
  HEALTH_PATH,
  RPC_PATH,
  RPC_DIG_NET,
  PROBE_TTL_MS,
  SOURCE_LOCAL_NODE,
  SOURCE_PUBLIC_GATEWAY,
  SOURCE_CUSTOM,
  localNodeCandidates,
  normalizeCustomEndpoint,
  isHealthyDigNode,
  ReachabilityMemo,
  resolveSourcePlan,
} from "./dig_source_resolution.mjs";

test("local-node candidates: dig.local FIRST, then localhost:<port> (default 8080)", () => {
  const c = localNodeCandidates();
  assert.deepEqual(c, [`http://${DIG_LOCAL_HOST}`, `http://localhost:${DEFAULT_LOCAL_PORT}`]);
  assert.equal(c[0], "http://dig.local", "dig.local has NO port and is tried first");
  assert.equal(DEFAULT_LOCAL_PORT, 8080, "default localhost listener port is 8080");
});

test("a custom port is honored on the localhost candidate (dig.local stays portless)", () => {
  const c = localNodeCandidates({ port: 9099 });
  assert.deepEqual(c, ["http://dig.local", "http://localhost:9099"]);
});

test("the setting can DISABLE the local node entirely (consumer needs none)", () => {
  // preferLocalNode:false → no standalone-node candidates; the browser consumes
  // straight from the public gateway (rpc.dig.net), still fully functional.
  assert.deepEqual(localNodeCandidates({ preferLocalNode: false }), []);
  // default (omitted) prefers the local node.
  assert.equal(localNodeCandidates().length, 2);
  assert.equal(localNodeCandidates({ preferLocalNode: true }).length, 2);
});

test("the terminal fallback is the PUBLIC GATEWAY (rpc.dig.net), not an in-process node", () => {
  assert.equal(RPC_DIG_NET, "https://rpc.dig.net");
});

test("the probe paths are /health (liveness) and / (rpc), never a content method", () => {
  assert.equal(HEALTH_PATH, "/health");
  assert.equal(RPC_PATH, "/");
});

test("isHealthyDigNode requires status:ok AND mode:local-node", () => {
  assert.equal(isHealthyDigNode({ status: "ok", mode: "local-node" }), true);
  // accepts a JSON string too (what a raw HTTP body is).
  assert.equal(isHealthyDigNode('{"status":"ok","mode":"local-node","version":"1"}'), true);
  // a different service squatting the port is rejected.
  assert.equal(isHealthyDigNode({ status: "ok", mode: "something-else" }), false);
  assert.equal(isHealthyDigNode({ status: "degraded", mode: "local-node" }), false);
  // malformed / empty → false (fail safe: fall through to the public gateway).
  assert.equal(isHealthyDigNode("not json"), false);
  assert.equal(isHealthyDigNode(null), false);
  assert.equal(isHealthyDigNode(undefined), false);
  assert.equal(isHealthyDigNode(42), false);
});

test("normalizeCustomEndpoint accepts http(s) URLs and strips the trailing slash", () => {
  assert.equal(normalizeCustomEndpoint("http://dig.local"), "http://dig.local");
  assert.equal(normalizeCustomEndpoint("https://node.example.com"), "https://node.example.com");
  assert.equal(normalizeCustomEndpoint("http://localhost:9999/"), "http://localhost:9999");
  assert.equal(normalizeCustomEndpoint("  https://n.example/  "), "https://n.example");
  // a bare host with no scheme is assumed http (a friendly convenience).
  assert.equal(normalizeCustomEndpoint("localhost:8080"), "http://localhost:8080");
  assert.equal(normalizeCustomEndpoint("my-node.lan"), "http://my-node.lan");
});

test("normalizeCustomEndpoint rejects empty / malformed / non-http(s) inputs (→ null)", () => {
  assert.equal(normalizeCustomEndpoint(""), null);
  assert.equal(normalizeCustomEndpoint("   "), null);
  assert.equal(normalizeCustomEndpoint(null), null);
  assert.equal(normalizeCustomEndpoint(undefined), null);
  assert.equal(normalizeCustomEndpoint(42), null);
  // non-http(s) schemes are not valid node endpoints.
  assert.equal(normalizeCustomEndpoint("ftp://x"), null);
  assert.equal(normalizeCustomEndpoint("javascript:alert(1)"), null);
  assert.equal(normalizeCustomEndpoint("file:///etc/passwd"), null);
});

test("ReachabilityMemo caches a verdict for the TTL then goes stale", () => {
  const memo = new ReachabilityMemo(PROBE_TTL_MS);
  const url = "http://dig.local";
  // No verdict yet.
  assert.equal(memo.get(url, 1000), null);
  memo.put(url, true, 1000);
  // Fresh within the TTL.
  assert.equal(memo.get(url, 1000), true);
  assert.equal(memo.get(url, 1000 + PROBE_TTL_MS - 1), true);
  // Stale exactly at/after the TTL → null (caller re-probes).
  assert.equal(memo.get(url, 1000 + PROBE_TTL_MS), null);
  // A negative verdict is cached the same way (don't hammer a down node).
  memo.put(url, false, 5000);
  assert.equal(memo.get(url, 5000), false);
  assert.equal(memo.get(url, 5000 + PROBE_TTL_MS), null);
});

test("resolveSourcePlan: unknown candidates become probe steps, public gateway is terminal", () => {
  const candidates = localNodeCandidates();
  const memo = new ReachabilityMemo();
  const { plan } = resolveSourcePlan({ candidates, memo, now: 0 });
  assert.deepEqual(plan, [
    { kind: "probe", baseUrl: "http://dig.local" },
    { kind: "probe", baseUrl: "http://localhost:8080" },
    { kind: "public-gateway", baseUrl: RPC_DIG_NET },
  ]);
  // The plan ALWAYS ends with the public gateway (a standalone browser with no
  // local node still resolves every request).
  assert.equal(plan[plan.length - 1].kind, "public-gateway");
  assert.equal(plan[plan.length - 1].baseUrl, "https://rpc.dig.net");
});

test("resolveSourcePlan: a fresh-reachable candidate is used directly (no re-probe)", () => {
  const candidates = localNodeCandidates();
  const memo = new ReachabilityMemo();
  memo.put("http://dig.local", true, 100);
  const { plan } = resolveSourcePlan({ candidates, memo, now: 100 });
  assert.equal(plan[0].kind, "local");
  assert.equal(plan[0].baseUrl, "http://dig.local");
});

test("resolveSourcePlan: a fresh-unreachable candidate is skipped without a probe", () => {
  const candidates = localNodeCandidates();
  const memo = new ReachabilityMemo();
  memo.put("http://dig.local", false, 100); // known down, still fresh
  const { plan } = resolveSourcePlan({ candidates, memo, now: 100 });
  // dig.local is skipped; localhost has no verdict so it is a probe step; the
  // public gateway is the terminal.
  assert.deepEqual(plan, [
    { kind: "probe", baseUrl: "http://localhost:8080" },
    { kind: "public-gateway", baseUrl: RPC_DIG_NET },
  ]);
});

test("resolveSourcePlan: disabled local node → straight to the public gateway", () => {
  const candidates = localNodeCandidates({ preferLocalNode: false });
  const memo = new ReachabilityMemo();
  const { plan } = resolveSourcePlan({ candidates, memo, now: 0 });
  assert.deepEqual(plan, [{ kind: "public-gateway", baseUrl: RPC_DIG_NET }]);
});

test("resolveSourcePlan: an explicit custom endpoint OVERRIDES the ladder ENTIRELY (§5.3)", () => {
  // When the user sets a custom node, it is the SOLE source — the auto-ladder
  // (dig.local/localhost/rpc.dig.net) is not consulted, honoring the explicit
  // choice (privacy/routing). No silent fallback to the public gateway.
  const candidates = localNodeCandidates();
  const memo = new ReachabilityMemo();
  const { plan } = resolveSourcePlan({
    customEndpoint: "https://my-node.example.com",
    candidates,
    memo,
    now: 0,
  });
  assert.deepEqual(plan, [
    { kind: "override", baseUrl: "https://my-node.example.com" },
  ]);
  // Crucially: the public gateway is NOT appended — the override wins entirely.
  assert.equal(plan.length, 1);
  assert.equal(plan.some((s) => s.kind === "public-gateway"), false);
});

test("resolveSourcePlan: an empty/invalid custom endpoint falls back to the auto-ladder", () => {
  const candidates = localNodeCandidates();
  const memo = new ReachabilityMemo();
  // A falsy customEndpoint (setting cleared) → the normal ladder applies.
  const { plan } = resolveSourcePlan({ customEndpoint: "", candidates, memo, now: 0 });
  assert.equal(plan[plan.length - 1].kind, "public-gateway");
  assert.equal(plan[0].kind, "probe");
});

test("stable source posture names for the controller/agent surface", () => {
  assert.equal(SOURCE_LOCAL_NODE, "local-node");
  assert.equal(SOURCE_PUBLIC_GATEWAY, "public-gateway");
  assert.equal(SOURCE_CUSTOM, "custom-endpoint");
});
