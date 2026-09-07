import "../_flush.mjs";
/**
 * tests/routes/adapter-routes-capability.test.ts — v190
 *
 * approvalToken → capabilityToken migration on the HTTP adapter routes.
 *
 * Covers the four required arms:
 *   • HAPPY  POST /api/adapter/run on an approval_required intent returns
 *            both `approvalToken` (legacy) and `capabilityToken` (hardened),
 *            with `capabilityTokenExpiry` matching the encoded payload, and
 *            POST /api/execution/:id/approve accepts the token → 200.
 *   • EDGE   capabilityTtlMs is honoured; capabilityVerified flag echoed.
 *   • FAIL-CLOSED — replay (same nonce twice) → 401.
 *   • FAIL-CLOSED — tampered / wrong-tenant / non-string / garbage tokens → 401,
 *                   workflow stays "planned" (never advanced).
 *
 * Backward-compatible: approving without a capabilityToken still works
 * (legacy contract preserved). That arm is also covered.
 *
 * Zero external dependencies.
 */

import { test, assert, eq } from "../_harness.mjs";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import { adapterRoutes, type Ctx } from "../../src/routes/adapter-routes.ts";
import { InMemoryNonceRegistry } from "../../lib/mcp-server/nonce-registry.ts";
import {
  decodeCapabilityToken,
  encodeCapabilityToken,
  issueCapabilityToken,
} from "../../lib/mcp-server/capability-token.ts";

const signer = new HmacSigner("adapter-cap-test-secret");

function makeStack(opts: { capabilityTtlMs?: number } = {}) {
  const store = new InMemoryExecutionStore();
  const nonceRegistry = new InMemoryNonceRegistry();
  const routes = adapterRoutes(signer, store, undefined, {
    capabilityTtlMs: opts.capabilityTtlMs,
    nonceRegistry,
  });

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
      tenantId: ctx.tenantId ?? "t-cap",
      body: ctx.body ?? {},
      params,
    }));
  }

  return { store, nonceRegistry, call };
}

function nonce() { return "n-" + Math.random().toString(36).slice(2); }

function approvalIntent(over: Record<string, unknown> = {}) {
  return {
    actorId: "agent:cap",
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

// ─── HAPPY: run returns capabilityToken bound to executionId+tenant ──────────

test("run on approval_required returns capabilityToken + expiry, decodable & bound", async () => {
  const { call } = makeStack();
  const res = await call("POST", "/api/adapter/run", {
    tenantId: "t1",
    body: approvalIntent(),
  });
  eq(res.status, 201);
  eq(res.body.decision, "approval_required");
  assert(typeof res.body.receipt.approvalToken === "string", "approvalToken present (legacy)");
  assert(typeof res.body.capabilityToken === "string", "capabilityToken present");
  assert(typeof res.body.capabilityTokenExpiry === "string", "capabilityTokenExpiry present");

  const decoded = decodeCapabilityToken(res.body.capabilityToken);
  assert(decoded !== null, "capabilityToken decodes");
  eq(decoded!.executionId, res.body.receipt.approvalToken);
  eq(decoded!.tenantId, "t1");
  eq(decoded!.expiresAt, res.body.capabilityTokenExpiry);
  eq(decoded!.version, "tfa-cap-v1");
});

// ─── HAPPY: approve with valid capabilityToken → 200, capabilityVerified=true ─

test("approve with valid capabilityToken advances workflow & echoes capabilityVerified", async () => {
  const { call } = makeStack();
  const runRes = await call("POST", "/api/adapter/run", {
    tenantId: "t1",
    body: approvalIntent(),
  });
  const id = runRes.body.receipt.approvalToken as string;
  const token = runRes.body.capabilityToken as string;

  const approveRes = await call("POST", `/api/execution/${id}/approve`, {
    tenantId: "t1",
    body: { capabilityToken: token, actor: "reviewer", reason: "ok" },
  });
  eq(approveRes.status, 200);
  eq(approveRes.body.ok, true);
  eq(approveRes.body.workflow.status, "running");
  eq(approveRes.body.capabilityVerified, true);
});

// ─── EDGE: capabilityTtlMs is honoured ───────────────────────────────────────

test("capabilityTtlMs option controls expiry window", async () => {
  const { call } = makeStack({ capabilityTtlMs: 60_000 });
  const before = Date.now();
  const res = await call("POST", "/api/adapter/run", {
    tenantId: "t1",
    body: approvalIntent(),
  });
  const expiryMs = Date.parse(res.body.capabilityTokenExpiry);
  const after = Date.now();
  assert(expiryMs >= before + 59_000 && expiryMs <= after + 61_000,
    `expiry ~60s from issuance, got ${expiryMs - before}ms`);
});

// ─── BACKWARD-COMPAT: approve without capabilityToken still works ────────────

test("approve without capabilityToken still works (legacy path) → capabilityVerified=false", async () => {
  const { call } = makeStack();
  const runRes = await call("POST", "/api/adapter/run", {
    tenantId: "t1",
    body: approvalIntent(),
  });
  const id = runRes.body.receipt.approvalToken as string;

  const approveRes = await call("POST", `/api/execution/${id}/approve`, {
    tenantId: "t1",
    body: { actor: "human" },
  });
  eq(approveRes.status, 200);
  eq(approveRes.body.workflow.status, "running");
  eq(approveRes.body.capabilityVerified, false);
});

// ─── FAIL-CLOSED: replay (same nonce twice) → 401, workflow not advanced ─────

test("capabilityToken replay → 401 (nonce single-use); workflow stays planned", async () => {
  const { call, store } = makeStack();
  const r1 = await call("POST", "/api/adapter/run", {
    tenantId: "t1", body: approvalIntent(),
  });
  const id1 = r1.body.receipt.approvalToken as string;
  const token = r1.body.capabilityToken as string;

  // First approve succeeds → "running"
  const ok1 = await call("POST", `/api/execution/${id1}/approve`, {
    tenantId: "t1", body: { capabilityToken: token },
  });
  eq(ok1.status, 200);

  // Now open a second workflow and try to reuse the *first* token's nonce
  // by re-encoding a token bound to the new id but with the consumed nonce.
  // Easier: just attempt to reuse the same token against a fresh workflow —
  // verification will fail on binding (wrong id). To isolate replay, issue
  // a fresh token for id1 (already running) — this exercises the
  // "wrong status" path AFTER nonce check; we instead reuse the original
  // token against id1: it fails at the "planned" guard regardless, so
  // construct a tighter replay test below using a fresh workflow + token
  // that *does* match id+tenant but whose nonce we manually pre-consume.

  const r2 = await call("POST", "/api/adapter/run", {
    tenantId: "t1", body: approvalIntent(),
  });
  const id2 = r2.body.receipt.approvalToken as string;
  const token2 = r2.body.capabilityToken as string;

  // First use succeeds.
  const okA = await call("POST", `/api/execution/${id2}/approve`, {
    tenantId: "t1", body: { capabilityToken: token2 },
  });
  eq(okA.status, 200);

  // Second use of the SAME token (after workflow already approved): the
  // capability layer must reject with 401 due to nonce replay BEFORE the
  // status guard runs. We can detect this by the 401 error message.
  const replay = await call("POST", `/api/execution/${id2}/approve`, {
    tenantId: "t1", body: { capabilityToken: token2 },
  });
  eq(replay.status, 401);
  assert(/replay|already been used/i.test(String(replay.body.error)),
    `expected replay error, got: ${replay.body.error}`);
  const wf2 = await store.get(id2, "t1");
  // Status was already "running" from okA — replay must not regress it.
  eq(wf2!.status, "running");
});

// ─── FAIL-CLOSED: wrong tenant binding → 401, workflow stays planned ─────────

test("capabilityToken bound to wrong tenant → 401; workflow stays planned", async () => {
  const { call, store } = makeStack();
  const runRes = await call("POST", "/api/adapter/run", {
    tenantId: "t1", body: approvalIntent(),
  });
  const id = runRes.body.receipt.approvalToken as string;

  // Forge a token bound to a different tenant.
  const foreign = encodeCapabilityToken(
    issueCapabilityToken(id, "t-other", signer),
  );
  const res = await call("POST", `/api/execution/${id}/approve`, {
    tenantId: "t1", body: { capabilityToken: foreign },
  });
  eq(res.status, 401);
  assert(/tenant/i.test(String(res.body.error)),
    `expected tenant-binding error, got: ${res.body.error}`);
  const wf = await store.get(id, "t1");
  eq(wf!.status, "planned");
});

// ─── FAIL-CLOSED: tampered signature → 401 ───────────────────────────────────

test("tampered capabilityToken → 401; workflow stays planned", async () => {
  const { call, store } = makeStack();
  const runRes = await call("POST", "/api/adapter/run", {
    tenantId: "t1", body: approvalIntent(),
  });
  const id = runRes.body.receipt.approvalToken as string;

  const decoded = decodeCapabilityToken(runRes.body.capabilityToken as string)!;
  const tampered = encodeCapabilityToken({ ...decoded, signature: "deadbeef" });
  const res = await call("POST", `/api/execution/${id}/approve`, {
    tenantId: "t1", body: { capabilityToken: tampered },
  });
  eq(res.status, 401);
  const wf = await store.get(id, "t1");
  eq(wf!.status, "planned");
});

// ─── FAIL-CLOSED: malformed token inputs → 401 ───────────────────────────────

test("non-string / empty / garbage capabilityToken → 401", async () => {
  const { call } = makeStack();
  const runRes = await call("POST", "/api/adapter/run", {
    tenantId: "t1", body: approvalIntent(),
  });
  const id = runRes.body.receipt.approvalToken as string;

  const cases: unknown[] = ["", 123, true, {}, "not-base64-json"];
  for (const bad of cases) {
    const res = await call("POST", `/api/execution/${id}/approve`, {
      tenantId: "t1", body: { capabilityToken: bad },
    });
    eq(res.status, 401);
  }
});
