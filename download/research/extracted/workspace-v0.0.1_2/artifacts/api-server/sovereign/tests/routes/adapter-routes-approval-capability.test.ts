import "../_flush.mjs";
/**
 * tests/routes/adapter-routes-approval-capability.test.ts — v195
 *
 * approvalToken migration — substep 2:
 *
 * The /api/execution/:id/approve route must accept the capability token under
 * its canonical receipt-field name (`approvalCapabilityToken`) in addition to
 * the legacy `capabilityToken` alias. Verification (signature + tenant binding
 * + executionId binding + TTL + nonce-replay) runs BEFORE the planned→approved
 * transition (fail-closed).
 *
 * Covers:
 *   • HAPPY     /run returns both `capabilityToken` and `approvalCapabilityToken`
 *               (identical), and the receipt itself carries `approvalCapabilityToken`.
 *   • HAPPY     approve using only `approvalCapabilityToken` → 200, verified=true.
 *   • HAPPY     approve using only `capabilityToken` (legacy alias) → 200, verified=true.
 *   • EDGE      both fields supplied & identical → 200; differing → 401, no transition.
 *   • FAIL-CLOSED  invalid `approvalCapabilityToken` (wrong tenant) → 401, workflow planned.
 *   • FAIL-CLOSED  non-string `approvalCapabilityToken` → 401, workflow planned.
 *
 * Zero external dependencies.
 */

import { test, assert, eq } from "../_harness.mjs";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import { adapterRoutes, type Ctx } from "../../src/routes/adapter-routes.ts";
import { InMemoryNonceRegistry } from "../../lib/mcp-server/nonce-registry.ts";
import {
  encodeCapabilityToken,
  issueCapabilityToken,
} from "../../lib/mcp-server/capability-token.ts";

const signer = new HmacSigner("adapter-approval-cap-test-secret");

function makeStack() {
  const store = new InMemoryExecutionStore();
  const nonceRegistry = new InMemoryNonceRegistry();
  const routes = adapterRoutes(signer, store, undefined, { nonceRegistry });

  function call(method: string, path: string, ctx: Partial<Ctx>) {
    const route = routes.find((r) => {
      if (r.method !== method) return false;
      if (r.pattern === path) return true;
      const re = new RegExp("^" + r.pattern.replace(/:([a-zA-Z_]+)/g, "([^/]+)") + "$");
      return re.test(path);
    });
    if (!route) throw new Error(`No route: ${method} ${path}`);
    const params: Record<string, string> = {};
    const re = new RegExp("^" + route.pattern.replace(/:([a-zA-Z_]+)/g, "([^/]+)") + "$");
    const names = [...route.pattern.matchAll(/:([a-zA-Z_]+)/g)].map((m) => m[1]);
    const m = path.match(re);
    if (m) names.forEach((n, i) => (params[n] = m[i + 1]));
    return Promise.resolve(route.handler({
      tenantId: ctx.tenantId ?? "t-acap",
      body: ctx.body ?? {},
      params,
    }));
  }

  return { store, call };
}

function nonce() { return "n-" + Math.random().toString(36).slice(2); }

function approvalIntent(over: Record<string, unknown> = {}) {
  return {
    actorId: "agent:acap",
    toolId: "file.delete",
    resourceRef: "resource:doc",
    riskClass: "write_destructive",
    valueMicrounits: "0",
    privacyLevel: "internal",
    approvalPolicyRef: "pol:default",
    nonce: nonce(),
    expiry: "2099-01-01T00:00:00.000Z",
    provenance: "test",
    evidencePolicy: "ev:default",
    ...over,
  };
}

// ─── HAPPY: /run exposes canonical name on body and receipt ──────────────────

test("/run on approval_required exposes approvalCapabilityToken on body and receipt", async () => {
  const { call } = makeStack();
  const res = await call("POST", "/api/adapter/run", { tenantId: "t1", body: approvalIntent() });
  eq(res.status, 201);
  eq(res.body.decision, "approval_required");
  assert(typeof res.body.capabilityToken === "string", "legacy capabilityToken present");
  assert(typeof res.body.approvalCapabilityToken === "string", "canonical approvalCapabilityToken present");
  eq(res.body.approvalCapabilityToken, res.body.capabilityToken);
  // Receipt itself carries approvalCapabilityToken (this is the source of truth).
  assert(typeof res.body.receipt.approvalCapabilityToken === "string",
    "receipt.approvalCapabilityToken present");
});

// ─── HAPPY: approve accepts only approvalCapabilityToken ─────────────────────

test("approve with approvalCapabilityToken (only) → 200, capabilityVerified=true", async () => {
  const { call } = makeStack();
  const runRes = await call("POST", "/api/adapter/run", { tenantId: "t1", body: approvalIntent() });
  const id = runRes.body.receipt.approvalToken as string;
  const token = runRes.body.receipt.approvalCapabilityToken as string;

  const res = await call("POST", `/api/execution/${id}/approve`, {
    tenantId: "t1",
    body: { approvalCapabilityToken: token, actor: "reviewer", reason: "ok" },
  });
  eq(res.status, 200);
  eq(res.body.workflow.status, "running");
  eq(res.body.capabilityVerified, true);
});

// ─── HAPPY: approve accepts only legacy capabilityToken (backcompat) ─────────

test("approve with legacy capabilityToken (only) still works", async () => {
  const { call } = makeStack();
  const runRes = await call("POST", "/api/adapter/run", { tenantId: "t1", body: approvalIntent() });
  const id = runRes.body.receipt.approvalToken as string;
  const token = runRes.body.capabilityToken as string;

  const res = await call("POST", `/api/execution/${id}/approve`, {
    tenantId: "t1",
    body: { capabilityToken: token },
  });
  eq(res.status, 200);
  eq(res.body.capabilityVerified, true);
});

// ─── EDGE: both fields, identical → ok; differing → 401, planned untouched ───

test("both approvalCapabilityToken & capabilityToken — identical → 200", async () => {
  const { call } = makeStack();
  const runRes = await call("POST", "/api/adapter/run", { tenantId: "t1", body: approvalIntent() });
  const id = runRes.body.receipt.approvalToken as string;
  const token = runRes.body.receipt.approvalCapabilityToken as string;

  const res = await call("POST", `/api/execution/${id}/approve`, {
    tenantId: "t1",
    body: { approvalCapabilityToken: token, capabilityToken: token },
  });
  eq(res.status, 200);
  eq(res.body.capabilityVerified, true);
});

test("both fields supplied but differing → 401; workflow stays planned", async () => {
  const { call, store } = makeStack();
  const runRes = await call("POST", "/api/adapter/run", { tenantId: "t1", body: approvalIntent() });
  const id = runRes.body.receipt.approvalToken as string;
  const tokenA = runRes.body.receipt.approvalCapabilityToken as string;
  // Mint a second, structurally-valid token bound to the same execution but
  // with a fresh nonce — guaranteed to differ from tokenA byte-for-byte.
  const tokenB = encodeCapabilityToken(issueCapabilityToken(id, "t1", signer));
  assert(tokenA !== tokenB, "two issuances must differ (distinct nonces)");

  const res = await call("POST", `/api/execution/${id}/approve`, {
    tenantId: "t1",
    body: { approvalCapabilityToken: tokenA, capabilityToken: tokenB },
  });
  eq(res.status, 401);
  assert(/disagree|conflict/i.test(String(res.body.error)),
    `expected conflict error, got: ${res.body.error}`);
  const wf = await store.get(id, "t1");
  eq(wf!.status, "planned");
});

// ─── FAIL-CLOSED: wrong-tenant token under canonical name → 401, planned ─────

test("approvalCapabilityToken bound to wrong tenant → 401; workflow stays planned", async () => {
  const { call, store } = makeStack();
  const runRes = await call("POST", "/api/adapter/run", { tenantId: "t1", body: approvalIntent() });
  const id = runRes.body.receipt.approvalToken as string;
  const foreign = encodeCapabilityToken(issueCapabilityToken(id, "t-other", signer));

  const res = await call("POST", `/api/execution/${id}/approve`, {
    tenantId: "t1",
    body: { approvalCapabilityToken: foreign },
  });
  eq(res.status, 401);
  assert(/tenant/i.test(String(res.body.error)),
    `expected tenant binding error, got: ${res.body.error}`);
  const wf = await store.get(id, "t1");
  eq(wf!.status, "planned");
});

// ─── FAIL-CLOSED: non-string approvalCapabilityToken → 401, planned ──────────

test("non-string approvalCapabilityToken → 401; workflow stays planned", async () => {
  const { call, store } = makeStack();
  const runRes = await call("POST", "/api/adapter/run", { tenantId: "t1", body: approvalIntent() });
  const id = runRes.body.receipt.approvalToken as string;

  const res = await call("POST", `/api/execution/${id}/approve`, {
    tenantId: "t1",
    body: { approvalCapabilityToken: 12345 },
  });
  eq(res.status, 401);
  assert(/non-empty string|must be/i.test(String(res.body.error)),
    `expected type error, got: ${res.body.error}`);
  const wf = await store.get(id, "t1");
  eq(wf!.status, "planned");
});
