import "../_flush.mjs";
/**
 * tests/contract/webhooks-flow-live.test.ts  (v162)
 *
 * Hand-written STATEFUL contract verification for the Webhooks API.
 * Deliberately NOT named `*.contract.test.ts` so auto-generated coverage
 * tooling does not count it in COVERAGE_REPORT.json.
 *
 * Covered operations (route → method → declared status, required fields):
 *   POST   /webhooks          (registerWebhook)   → 201, [ok, registration]
 *   GET    /webhooks          (listWebhooks)       → 200, [ok, registrations]
 *   DELETE /webhooks/:id      (deleteWebhook)      → 200, [ok, deleted]
 *
 * Flows exercised:
 *   A. REGISTER → LIST → DELETE lifecycle (single registration).
 *   B. MULTI-EVENT: register for multiple events, list shows all.
 *   C. ISOLATION: registrations from tenant A are not visible to tenant B.
 *   D. DISPATCH TRIGGER: register a webhook, trigger a settlement event (create→fund→release),
 *      confirm the route still returns 200 (dispatch is async best-effort).
 *
 * Fail-closed:
 *   - POST /webhooks without url → 400
 *   - POST /webhooks without events → 400
 *   - DELETE /webhooks/:id unknown id → 404
 *   - DELETE /webhooks/:id cross-tenant → 404
 *   - GET /webhooks returns empty array for tenant with no registrations
 *   - POST /webhooks without x-tenant-id → 400
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _seq = 0;
function uid(tag = "w"): string {
  return `${tag}-wh-${++_seq}-${Math.random().toString(36).slice(2, 7)}`;
}

async function call(
  base: string,
  method: string,
  path: string,
  tenantId: string | null,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (tenantId) headers["x-tenant-id"] = tenantId;
  const res = await fetch(base + "/api" + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { parsed = { _raw: text }; }
  return { status: res.status, body: parsed };
}

function assertRequiredFields(obj: any, fields: string[], label: string): void {
  for (const f of fields) {
    assert(f in obj, `[${label}] missing required field "${f}" in: ${JSON.stringify(obj)}`);
  }
}

// ─── FLOW A: register → list → delete ────────────────────────────────────────

test("contract webhooks-flow [A-1]: POST /webhooks → 201 [ok, registration]", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = uid("t");
  try {
    const { status, body } = await call(base, "POST", "/webhooks", tenant, {
      url: "https://example.com/hook",
      events: ["settlement.released"],
    });
    eq(status, 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
    assertRequiredFields(body, ["ok", "registration"], "registerWebhook");
    assert(body.ok === true, "ok must be true");
    assertRequiredFields(body.registration, ["id", "tenantId", "url", "events", "createdAt", "active"], "registration fields");
    eq(body.registration.url, "https://example.com/hook", "url must match");
    assert(Array.isArray(body.registration.events), "events must be array");
    // Secret must NOT be echoed back
    assert(!("secret" in body.registration), "secret must not be echoed back");
  } finally { server.close(); }
});

test("contract webhooks-flow [A-2]: GET /webhooks → 200 [ok, registrations]", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = uid("t");
  try {
    // Register one first
    await call(base, "POST", "/webhooks", tenant, {
      url: "https://example.com/hook",
      events: ["settlement.released", "passport.issued"],
    });

    const { status, body } = await call(base, "GET", "/webhooks", tenant);
    eq(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assertRequiredFields(body, ["ok", "registrations"], "listWebhooks");
    assert(Array.isArray(body.registrations), "registrations must be array");
    assert(body.registrations.length >= 1, "must have at least one registration");
    // Verify each registration has required fields and no secret
    for (const reg of body.registrations) {
      assertRequiredFields(reg, ["id", "tenantId", "url", "events", "createdAt", "active"], "registration item");
      assert(!("secret" in reg), "secret must not be present in list");
    }
  } finally { server.close(); }
});

test("contract webhooks-flow [A-3]: DELETE /webhooks/:id → 200 [ok, deleted]", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = uid("t");
  try {
    const created = await call(base, "POST", "/webhooks", tenant, {
      url: "https://example.com/hook-to-delete",
      events: ["settlement.disputed"],
    });
    eq(created.status, 201, `createWebhook: ${JSON.stringify(created.body)}`);
    const id = created.body.registration.id;

    const { status, body } = await call(base, "DELETE", `/webhooks/${id}`, tenant);
    eq(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assertRequiredFields(body, ["ok", "deleted"], "deleteWebhook");
    eq(body.deleted, true, "deleted must be true");

    // After delete, list should not contain this id
    const list = await call(base, "GET", "/webhooks", tenant);
    const stillExists = (list.body.registrations || []).some((r: any) => r.id === id);
    assert(!stillExists, "deleted webhook must not appear in list");
  } finally { server.close(); }
});

// ─── FLOW B: multi-event ─────────────────────────────────────────────────────

test("contract webhooks-flow [B-1]: register multi-event webhook, list shows all events", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = uid("t");
  const events = ["settlement.released", "settlement.disputed", "passport.issued"];
  try {
    const created = await call(base, "POST", "/webhooks", tenant, {
      url: "https://example.com/multi",
      events,
    });
    eq(created.status, 201, `createWebhook: ${JSON.stringify(created.body)}`);
    eq(created.body.registration.events.length, 3, "must have 3 events");

    const list = await call(base, "GET", "/webhooks", tenant);
    const found = (list.body.registrations || []).find((r: any) => r.id === created.body.registration.id);
    assert(found, "registered webhook must appear in list");
    eq(found.events.length, 3, "listed webhook must retain all events");
  } finally { server.close(); }
});

// ─── FLOW C: tenant isolation ─────────────────────────────────────────────────

test("contract webhooks-flow [C-1]: registrations are isolated by tenant", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenantA = uid("t");
  const tenantB = uid("t");
  try {
    const created = await call(base, "POST", "/webhooks", tenantA, {
      url: "https://example.com/hook-a",
      events: ["settlement.released"],
    });
    eq(created.status, 201);
    const idA = created.body.registration.id;

    // tenant B must not see tenant A's registration
    const listB = await call(base, "GET", "/webhooks", tenantB);
    eq(listB.status, 200);
    const seenInB = (listB.body.registrations || []).some((r: any) => r.id === idA);
    assert(!seenInB, "tenant B must not see tenant A's webhook registrations");

    // tenant B cannot delete tenant A's registration
    const del = await call(base, "DELETE", `/webhooks/${idA}`, tenantB);
    eq(del.status, 404, "cross-tenant delete must return 404");
  } finally { server.close(); }
});

// ─── FLOW D: dispatch trigger (settlement event triggers webhook dispatch) ────

test("contract webhooks-flow [D-1]: settlement release with webhook registered → route still 200 (dispatch best-effort)", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = uid("t");
  try {
    // Register a webhook for settlement.released (no real HTTP server behind it — delivery will fail, but that's ok)
    await call(base, "POST", "/webhooks", tenant, {
      url: "https://127.0.0.1:0/unreachable",
      events: ["settlement.released"],
    });

    // Create ledger accounts and fund payer
    const a = await call(base, "POST", "/ledger/accounts", tenant, { ownerId: "payer-d", type: "asset", name: "P" });
    const b = await call(base, "POST", "/ledger/accounts", tenant, { ownerId: "worker-d", type: "asset", name: "W" });
    await call(base, "POST", "/ledger/mint", tenant, { toAccountId: a.body.account.id, amount: "1000000", memo: "seed", initiatedBy: "test" });

    const created = await call(base, "POST", "/settlement", tenant, {
      opportunityId: uid("opp"), payerAccountId: a.body.account.id, workerAccountId: b.body.account.id,
      totalAmount: "100000", settledBy: "auth",
    });
    eq(created.status, 201);
    const id = created.body.agreement.id;

    await call(base, "POST", `/settlement/${id}/fund`, tenant, { initiatedBy: "auth" });

    // This triggers settlement.released event → dispatch to webhook (will fail to deliver, but must not crash the route)
    const { status, body } = await call(base, "POST", `/settlement/${id}/release`, tenant, { initiatedBy: "auth" });
    eq(status, 200, `release must succeed despite webhook dispatch failure: ${JSON.stringify(body)}`);
    eq(body.agreement.state, "released");
  } finally { server.close(); }
});

// ─── Fail-closed ─────────────────────────────────────────────────────────────

test("contract webhooks-flow [fail-1]: POST /webhooks without url → 400", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  try {
    const { status } = await call(base, "POST", "/webhooks", uid("t"), {
      events: ["settlement.released"],
    });
    eq(status, 400, "missing url must return 400");
  } finally { server.close(); }
});

test("contract webhooks-flow [fail-2]: POST /webhooks without events → 400", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  try {
    const { status } = await call(base, "POST", "/webhooks", uid("t"), {
      url: "https://example.com/hook",
      events: [],
    });
    eq(status, 400, "empty events must return 400");
  } finally { server.close(); }
});

test("contract webhooks-flow [fail-3]: DELETE /webhooks/:id unknown → 404", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  try {
    const { status } = await call(base, "DELETE", "/webhooks/no-such-id-xyz", uid("t"));
    eq(status, 404, "unknown id must return 404");
  } finally { server.close(); }
});

test("contract webhooks-flow [fail-4]: GET /webhooks returns empty array for tenant with no registrations", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  try {
    const { status, body } = await call(base, "GET", "/webhooks", uid("t-fresh"));
    eq(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(Array.isArray(body.registrations), "registrations must be array");
    eq(body.registrations.length, 0, "fresh tenant must have empty registrations");
  } finally { server.close(); }
});

test("contract webhooks-flow [fail-5]: POST /webhooks without x-tenant-id → 400", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  try {
    const { status } = await call(base, "POST", "/webhooks", null, {
      url: "https://example.com/hook",
      events: ["settlement.released"],
    });
    eq(status, 400, "missing tenant header must return 400");
  } finally { server.close(); }
});
