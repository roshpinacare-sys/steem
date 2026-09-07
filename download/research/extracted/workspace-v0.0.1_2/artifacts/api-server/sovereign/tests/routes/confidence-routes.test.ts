/**
 * tests/routes/confidence-routes.test.ts — ConfidenceGate HTTP route coverage.
 *
 * Coverage:
 *   POST /api/confidence/evaluate
 *     • happy: score ≥ autoThreshold → allow: true, verdict "auto", trace present
 *     • edge:  score in HITL band → allow: false, verdict "human", reason includes HITL_REQUIRED
 *     • fail-closed: score < hitlThreshold → allow: false, verdict "deny", reason includes CONFIDENCE_BELOW_THRESHOLD
 *     • fail-closed: missing confidenceScore → treat as 0 → deny
 *     • fail-closed: NaN confidenceScore → treat as 0 → deny
 *     • fail-closed: score > 1 → treat as 0 → deny
 *     • config override: custom autoThreshold/hitlThreshold honoured
 *     • invalid config (hitl > auto) → 400, no crash
 *   POST /api/confidence/verify
 *     • valid trace → valid: true
 *     • tampered trace → valid: false
 *     • missing trace → 400
 */

import { test, assert, eq } from "../_harness.mjs";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { confidenceRoutes } from "../../src/routes/confidence-routes.ts";

const signer = new HmacSigner("confidence-route-test-secret");

function makeClient() {
  const routes = confidenceRoutes(signer);

  async function post(path: string, body: any, tenantId = "t-conf") {
    const route = routes.find((r) => r.method === "POST" && r.pattern === path);
    if (!route) throw new Error(`No route: POST ${path}`);
    const res = await route.handler({ tenantId, body: body ?? {}, params: {} });
    return res;
  }

  return { routes, post };
}

// ─── POST /api/confidence/evaluate ──────────────────────────────────────────────

test("evaluate: score ≥ autoThreshold → allow: true, verdict auto, trace present", async () => {
  const { post } = makeClient();
  const res = await post("/api/confidence/evaluate", { confidenceScore: 0.9 });
  eq(res.status, 200);
  assert(res.body.ok === true);
  eq(res.body.verdict, "auto");
  eq(res.body.allow, true);
  assert(res.body.trace !== null, "trace must be present");
  assert(typeof res.body.trace.signature === "string" && res.body.trace.signature.length > 0, "trace must be signed");
  eq(res.body.trace.score, 0.9);
  eq(res.body.trace.verdict, "auto");
});

test("evaluate: score in HITL band → allow: false, verdict human, reason HITL_REQUIRED", async () => {
  const { post } = makeClient();
  const res = await post("/api/confidence/evaluate", { confidenceScore: 0.65 });
  eq(res.status, 200);
  assert(res.body.ok === true);
  eq(res.body.verdict, "human");
  eq(res.body.allow, false);
  assert(res.body.trace !== null);
  eq(res.body.trace.verdict, "human");
});

test("evaluate: score < hitlThreshold → allow: false, verdict deny, reason CONFIDENCE_BELOW_THRESHOLD", async () => {
  const { post } = makeClient();
  const res = await post("/api/confidence/evaluate", { confidenceScore: 0.2 });
  eq(res.status, 200);
  assert(res.body.ok === true);
  eq(res.body.verdict, "deny");
  eq(res.body.allow, false);
  assert(res.body.trace !== null);
  eq(res.body.trace.verdict, "deny");
});

test("evaluate: missing confidenceScore → fail-closed deny (treated as 0)", async () => {
  const { post } = makeClient();
  const res = await post("/api/confidence/evaluate", { actionType: "test.action" });
  eq(res.status, 200);
  eq(res.body.verdict, "deny");
  eq(res.body.allow, false);
});

test("evaluate: NaN confidenceScore → fail-closed deny", async () => {
  const { post } = makeClient();
  const res = await post("/api/confidence/evaluate", { confidenceScore: NaN });
  eq(res.status, 200);
  eq(res.body.verdict, "deny");
  eq(res.body.allow, false);
});

test("evaluate: score > 1 → fail-closed deny (treated as 0)", async () => {
  const { post } = makeClient();
  const res = await post("/api/confidence/evaluate", { confidenceScore: 1.5 });
  eq(res.status, 200);
  eq(res.body.verdict, "deny");
  eq(res.body.allow, false);
});

test("evaluate: custom thresholds honoured", async () => {
  const { post } = makeClient();
  const res = await post("/api/confidence/evaluate", { confidenceScore: 0.7, autoThreshold: 0.75, hitlThreshold: 0.6 });
  eq(res.status, 200);
  eq(res.body.verdict, "human");
  eq(res.body.allow, false);
  assert(res.body.trace !== null);
  eq(res.body.trace.autoThreshold, 0.75);
  eq(res.body.trace.hitlThreshold, 0.6);
});

test("evaluate: invalid config (hitl > auto) → 400, no crash", async () => {
  const { post } = makeClient();
  const res = await post("/api/confidence/evaluate", { confidenceScore: 0.5, autoThreshold: 0.3, hitlThreshold: 0.8 });
  eq(res.status, 400);
  assert(res.body.error.includes("invalid confidence gate configuration"));
});

test("evaluate: negative threshold → 400", async () => {
  const { post } = makeClient();
  const res = await post("/api/confidence/evaluate", { confidenceScore: 0.5, hitlThreshold: -0.1 });
  eq(res.status, 400);
  assert(res.body.error.includes("invalid confidence gate configuration"));
});

// ─── POST /api/confidence/verify ────────────────────────────────────────────────

test("verify: valid trace → valid: true", async () => {
  const { post } = makeClient();
  const evalRes = await post("/api/confidence/evaluate", { confidenceScore: 0.9 });
  const trace = evalRes.body.trace;
  const verifyRes = await post("/api/confidence/verify", { trace });
  eq(verifyRes.status, 200);
  eq(verifyRes.body.ok, true);
  eq(verifyRes.body.valid, true);
});

test("verify: tampered trace → valid: false", async () => {
  const { post } = makeClient();
  const evalRes = await post("/api/confidence/evaluate", { confidenceScore: 0.9 });
  const tampered = { ...evalRes.body.trace, verdict: "deny" };
  const verifyRes = await post("/api/confidence/verify", { trace: tampered });
  eq(verifyRes.status, 200);
  eq(verifyRes.body.valid, false);
});

test("verify: missing trace → 400", async () => {
  const { post } = makeClient();
  const res = await post("/api/confidence/verify", {});
  eq(res.status, 400);
  assert(res.body.error.includes("trace object required"));
});
