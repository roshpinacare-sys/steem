import "../_flush.mjs";
/**
 * tests/sovereignty/break-glass.test.ts — emergency break-glass ticket
 * (החסר הבא #1 in v191: `POST /api/sovereignty/break-glass`).
 *
 * Coverage:
 *   Unit  (issueBreakGlassTicket / verifyBreakGlassTicket — 7):
 *     • happy round-trip, signature binds tenant+scope+expiry
 *     • expiresAt = issuedAt + ttlMs
 *     • verify rejects expired ticket fail-closed
 *     • verify rejects tampered tenantId fail-closed
 *     • verify rejects wrong expectedTenantId fail-closed
 *     • issue rejects empty reason / scope / operator
 *     • issue rejects ttlMs outside [MIN, MAX]
 *   HTTP  (POST /api/sovereignty/break-glass — 6):
 *     • happy path with admin scope → 200 + signed ticket + audit
 *     • missing admin:break-glass scope → 403
 *     • missing x-tenant-id → 400
 *     • reason too short → 400
 *     • ttlMs above ceiling → 400
 *     • cross-path: bare x-tenant-id (trusted mode) gets superadmin → 200
 */

import { test, assert, eq } from "../_harness.mjs";
import {
  issueBreakGlassTicket,
  verifyBreakGlassTicket,
  BreakGlassError,
  BREAK_GLASS_DEFAULT_TTL_MS,
  BREAK_GLASS_MAX_TTL_MS,
  BREAK_GLASS_AUDIT_ACTION_TYPE,
} from "../../src/sovereignty/break-glass.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import type { Server } from "node:http";

// ─── Unit tests ──────────────────────────────────────────────────────────────

test("break-glass unit: issue/verify round-trip binds {tenant,scope,expiry,nonce}", () => {
  const signer = new HmacSigner("unit-secret-long-enough-32bytes!!!");
  const ticket = issueBreakGlassTicket(
    { tenantId: "t1", grantScope: "superadmin", operator: "op-alice", reason: "incident #42 prod outage" },
    signer,
  );
  eq(ticket.version, "tfa-break-glass-v1");
  eq(ticket.tenantId, "t1");
  eq(ticket.grantScope, "superadmin");
  assert(typeof ticket.signature === "string" && ticket.signature.length > 0, "signature populated");
  assert(typeof ticket.nonce === "string" && ticket.nonce.length >= 16, "nonce non-trivial");

  const ok = verifyBreakGlassTicket(ticket, signer);
  assert(ok.valid, "verify passes for fresh ticket");
});

test("break-glass unit: expiresAt = issuedAt + ttlMs (within 1ms)", () => {
  const signer = new HmacSigner("unit-secret-long-enough-32bytes!!!");
  const fixed = new Date("2026-01-01T00:00:00Z");
  const ticket = issueBreakGlassTicket(
    { tenantId: "t1", grantScope: "ledger:transfer", operator: "op", reason: "scheduled drill ten chars", ttlMs: 10_000, now: () => fixed },
    signer,
  );
  eq(ticket.issuedAt, fixed.toISOString());
  eq(ticket.expiresAt, new Date(fixed.getTime() + 10_000).toISOString());
});

test("break-glass unit: expired ticket → valid:false (fail-closed)", () => {
  const signer = new HmacSigner("unit-secret-long-enough-32bytes!!!");
  const issued = new Date("2026-01-01T00:00:00Z");
  const ticket = issueBreakGlassTicket(
    { tenantId: "t1", grantScope: "superadmin", operator: "op", reason: "incident drill ten", ttlMs: 1_000, now: () => issued },
    signer,
  );
  const after = new Date(issued.getTime() + 2_000);
  const res = verifyBreakGlassTicket(ticket, signer, { now: () => after });
  assert(!res.valid, "expired ticket rejected");
  if (!res.valid) assert(res.reason === "ticket expired", `reason: ${res.reason}`);
});

test("break-glass unit: tampered tenantId breaks signature → valid:false", () => {
  const signer = new HmacSigner("unit-secret-long-enough-32bytes!!!");
  const ticket = issueBreakGlassTicket(
    { tenantId: "t1", grantScope: "superadmin", operator: "op", reason: "incident drill ten" },
    signer,
  );
  const tampered = { ...ticket, tenantId: "t2" };
  const res = verifyBreakGlassTicket(tampered, signer);
  assert(!res.valid, "tampered ticket rejected");
});

test("break-glass unit: expectedTenantId mismatch → valid:false even with valid signature", () => {
  const signer = new HmacSigner("unit-secret-long-enough-32bytes!!!");
  const ticket = issueBreakGlassTicket(
    { tenantId: "t1", grantScope: "superadmin", operator: "op", reason: "incident drill ten" },
    signer,
  );
  const res = verifyBreakGlassTicket(ticket, signer, { expectedTenantId: "t2" });
  assert(!res.valid, "cross-tenant ticket rejected");
});

test("break-glass unit: empty reason/scope/operator throw BreakGlassError", () => {
  const signer = new HmacSigner("unit-secret-long-enough-32bytes!!!");
  for (const bad of [
    { tenantId: "t1", grantScope: "", operator: "op", reason: "incident drill ten" },
    { tenantId: "t1", grantScope: "x", operator: "", reason: "incident drill ten" },
    { tenantId: "t1", grantScope: "x", operator: "op", reason: "" },
    { tenantId: "", grantScope: "x", operator: "op", reason: "incident drill ten" },
  ]) {
    let threw = false;
    try { issueBreakGlassTicket(bad as any, signer); } catch (e) { threw = e instanceof BreakGlassError; }
    assert(threw, `expected BreakGlassError for ${JSON.stringify(bad)}`);
  }
});

test("break-glass unit: ttlMs outside [MIN, MAX] throws BreakGlassError", () => {
  const signer = new HmacSigner("unit-secret-long-enough-32bytes!!!");
  const base = { tenantId: "t1", grantScope: "superadmin", operator: "op", reason: "incident drill ten" };
  for (const ttlMs of [0, -1, BREAK_GLASS_MAX_TTL_MS + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
    let threw = false;
    try { issueBreakGlassTicket({ ...base, ttlMs }, signer); } catch (e) { threw = e instanceof BreakGlassError; }
    assert(threw, `expected BreakGlassError for ttlMs=${ttlMs}`);
  }
  // happy-bound: default still works
  const ok = issueBreakGlassTicket({ ...base, ttlMs: BREAK_GLASS_DEFAULT_TTL_MS }, signer);
  assert(ok.version === "tfa-break-glass-v1", "default ttl issues successfully");
});

// ─── HTTP route tests ────────────────────────────────────────────────────────

async function httpRequest(port: number, method: string, path: string, opts: {
  tenantId?: string; apiKey?: string; body?: unknown;
} = {}): Promise<{ status: number; body: any }> {
  const url = `http://127.0.0.1:${port}${path}`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.apiKey) headers["x-api-key"] = opts.apiKey;
  else if (opts.tenantId) headers["x-tenant-id"] = opts.tenantId;
  const res = await fetch(url, { method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

async function withServer(
  fn: (port: number, keys: { admin: string; user: string }, stack: ReturnType<typeof buildSovereignStack>) => Promise<void>,
): Promise<void> {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const admin = await stack.apiKeyService.create({ tenantId: "t1", name: "admin", scopes: ["admin:break-glass"] });
  const user = await stack.apiKeyService.create({ tenantId: "t1", name: "user", scopes: ["adapter:run"] });
  const server = startSovereignServer(0, stack, { requireIdempotencyKey: false }) as Server & { shutdown: () => Promise<void> };
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as any).port as number;
  try {
    await fn(port, { admin: admin.secret, user: user.secret }, stack);
  } finally {
    await server.shutdown();
  }
}

test("break-glass HTTP: happy path with admin:break-glass scope → 200 + audit record appended", async () => {
  await withServer(async (port, keys, stack) => {
    const beforeLen = stack.orchestrator.audit.getChain("t1").length;
    const res = await httpRequest(port, "POST", "/api/sovereignty/break-glass", {
      apiKey: keys.admin,
      body: { reason: "compromised admin key, rotating now", grantScope: "ledger:transfer", ttlMs: 30_000 },
    });
    eq(res.status, 200);
    eq(res.body.ok, true);
    eq(res.body.grantScope, "ledger:transfer");
    eq(res.body.tenantId, "t1");
    assert(typeof res.body.ticketId === "string" && res.body.ticketId.length > 0, "ticketId returned");
    assert(typeof res.body.encodedTicket === "string" && res.body.encodedTicket.length > 0, "encodedTicket returned");
    assert(typeof res.body.ticket?.signature === "string", "raw ticket signature returned");

    // Signature verifies under the live kernel signer.
    const v = verifyBreakGlassTicket(res.body.ticket, stack.signer, { expectedTenantId: "t1" });
    assert(v.valid, "issued ticket verifies");

    // Audit record exists, is signed, and chain remains intact.
    const chain = stack.orchestrator.audit.getChain("t1");
    eq(chain.length, beforeLen + 1);
    const last = chain[chain.length - 1];
    eq(last.actionType, BREAK_GLASS_AUDIT_ACTION_TYPE);
    eq(last.outcome, "allowed");
    eq(last.actionId, res.body.ticketId);
    assert(typeof last.signature === "string" && last.signature.length > 0, "audit record is signed");
    assert(stack.orchestrator.audit.verifyChain("t1"), "audit chain still intact after break-glass append");
  });
});

test("break-glass HTTP: missing admin:break-glass scope → 403, no audit append", async () => {
  await withServer(async (port, keys, stack) => {
    const beforeLen = stack.orchestrator.audit.getChain("t1").length;
    const res = await httpRequest(port, "POST", "/api/sovereignty/break-glass", {
      apiKey: keys.user,
      body: { reason: "trying to escalate", grantScope: "superadmin" },
    });
    eq(res.status, 403);
    eq(res.body.error, "missing admin:break-glass scope");
    eq(stack.orchestrator.audit.getChain("t1").length, beforeLen);
  });
});

test("break-glass HTTP: missing x-tenant-id → 400", async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/sovereignty/break-glass`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "incident drill exercise", grantScope: "superadmin" }),
    });
    eq(res.status, 400);
  });
});

test("break-glass HTTP: reason too short → 400", async () => {
  await withServer(async (port, keys) => {
    const res = await httpRequest(port, "POST", "/api/sovereignty/break-glass", {
      apiKey: keys.admin,
      body: { reason: "short", grantScope: "superadmin" },
    });
    eq(res.status, 400);
    assert(String(res.body.error).includes("reason"), `error mentions reason: ${res.body.error}`);
  });
});

test("break-glass HTTP: ttlMs above MAX → 400 (fail-closed)", async () => {
  await withServer(async (port, keys) => {
    const res = await httpRequest(port, "POST", "/api/sovereignty/break-glass", {
      apiKey: keys.admin,
      body: { reason: "rolling forward incident response", grantScope: "superadmin", ttlMs: BREAK_GLASS_MAX_TTL_MS + 1 },
    });
    eq(res.status, 400);
  });
});

test("break-glass HTTP: bare x-tenant-id (trusted mode) gets superadmin → 200", async () => {
  await withServer(async (port) => {
    const res = await httpRequest(port, "POST", "/api/sovereignty/break-glass", {
      tenantId: "t1",
      body: { reason: "trusted-mode dev convenience flow", grantScope: "superadmin" },
    });
    eq(res.status, 200);
    eq(res.body.ok, true);
  });
});
