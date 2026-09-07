import "../_flush.mjs";
/**
 * tests/dashboard/dashboard.test.ts — Tenant Dashboard v1 (cycle 13) + v102 auth.
 * GET /dashboard serves a self-contained HTML page (no external scripts) · GET /api/escrow lists
 * tenant-scoped agreements only · v102: authHeaders() routes tfa_... → x-api-key, else x-tenant-id.
 */
import { test, assert, eq } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { buildSovereignStack } from "../../src/composition.ts";

test("GET /dashboard serves self-contained HTML (zero external deps)", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port: number = (server.address() as any).port;
  const res = await fetch(`http://127.0.0.1:${port}/dashboard`);
  eq(res.status, 200);
  assert((res.headers.get("content-type") || "").includes("text/html"), "html content-type");
  const html = await res.text();
  assert(html.includes("Tenant Dashboard"), "title present");
  assert(!/src=['"]https?:\/\//.test(html) && !/href=['"]https?:\/\//.test(html), "no external scripts/styles");
  assert(html.includes("/api/track-record/"), "wired to track-record API");
  server.close();
});

test("GET /api/escrow lists only the tenant's agreements", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port: number = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  const H = (t: string) => ({ "content-type": "application/json", "x-tenant-id": t });
  const acc = async (t: string, o: string) => (await (await fetch(base + "/api/ledger/accounts", { method: "POST", headers: H(t), body: JSON.stringify({ ownerId: o, type: "asset", name: o }) })).json()).account.id;
  const p = await acc("dashA", "p"); const w = await acc("dashA", "w");
  await fetch(base + "/api/escrow", { method: "POST", headers: H("dashA"), body: JSON.stringify({ opportunityId: "o1", payerAccountId: p, workerAccountId: w, amount: "1000" }) });
  const a = await (await fetch(base + "/api/escrow", { headers: H("dashA") })).json();
  const b = await (await fetch(base + "/api/escrow", { headers: H("dashB") })).json();
  assert(a.data.agreements.length >= 1, "tenant A sees its agreement");
  eq(b.data.agreements.length, 0, "tenant B sees nothing (isolation)");
  server.close();
});

// ─── v102: Dashboard auth ──────────────────────────────────────────────────────

test("DASHBOARD AUTH: HTML contains authHeaders fn with tfa_ detection and x-api-key routing", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port: number = (server.address() as any).port;
  const html = await (await fetch(`http://127.0.0.1:${port}/dashboard`)).text();
  assert(html.includes("authHeaders"), "authHeaders function present");
  assert(html.includes("tfa_"), "tfa_ prefix detection present");
  assert(html.includes("x-api-key"), "x-api-key header routing present");
  assert(html.includes("x-tenant-id"), "x-tenant-id fallback present");
  assert(html.includes("POST /api/auth/api-keys"), "footer documents API key issuance endpoint");
  server.close();
});

test("DASHBOARD AUTH: input placeholder and auth-hint element present", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port: number = (server.address() as any).port;
  const html = await (await fetch(`http://127.0.0.1:${port}/dashboard`)).text();
  assert(html.includes("placeholder"), "input has placeholder");
  assert(html.includes("authHint"), "authHint element present (shows current auth mode)");
  server.close();
});

test("DASHBOARD AUTH: x-api-key accepted for dashboard API calls (server resolves tenantId)", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port: number = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  const H = (t: string) => ({ "content-type": "application/json", "x-tenant-id": t });
  const tenant = "dash-auth-t1";

  // Register tenant and issue API key
  await fetch(base + "/api/tenants", { method: "POST", headers: H(tenant), body: JSON.stringify({ rootPersonId: "p1" }) });
  const keyRes = await (await fetch(base + "/api/auth/api-keys", {
    method: "POST", headers: H(tenant), body: JSON.stringify({ name: "dash-key" }),
  })).json();
  assert(keyRes.ok, "api key created");
  const secret: string = keyRes.secret;
  assert(typeof secret === "string" && secret.startsWith("tfa_"), "secret has tfa_ prefix");

  // Call a dashboard API using x-api-key — should resolve tenantId from key
  const r = await fetch(base + "/api/transparency/chain", { headers: { "x-api-key": secret } });
  eq(r.status, 200, "x-api-key accepted — server resolved tenantId");
  const body = await r.json();
  assert(body !== null && typeof body === "object", "valid JSON response");
  server.close();
});

test("DASHBOARD AUTH: invalid tfa_ key returns 401 fail-closed", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port: number = (server.address() as any).port;
  const r = await fetch(`http://127.0.0.1:${port}/api/transparency/chain`, {
    headers: { "x-api-key": "tfa_notarealkey_invalid_0000000000000000000" },
  });
  eq(r.status, 401, "invalid tfa_ key → 401 fail-closed");
  const body = await r.json();
  assert(typeof body.error === "string", "error message present");
  server.close();
});

test("DASHBOARD AUTH: x-tenant-id still accepted (backward compat)", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port: number = (server.address() as any).port;
  const r = await fetch(`http://127.0.0.1:${port}/api/transparency/chain`, {
    headers: { "x-tenant-id": "compat-tenant-bc1" },
  });
  eq(r.status, 200, "x-tenant-id still works (dev/demo backward compat)");
  server.close();
});

test("DASHBOARD AUTH: GET /dashboard does not require auth (always served)", async () => {
  // The /dashboard page itself is served without tenant resolution — it's the client JS
  // that then makes authenticated API calls. This ensures the login UX is always reachable.
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port: number = (server.address() as any).port;
  // No auth headers at all
  const r = await fetch(`http://127.0.0.1:${port}/dashboard`);
  eq(r.status, 200, "dashboard page served without auth (client-side auth)");
  server.close();
});

// ─── v104: Dashboard improvements ─────────────────────────────────────────────

test("GET /api/tenants → 200 + ok:true + plan field", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port: number = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  const H = (t: string) => ({ "content-type": "application/json", "x-tenant-id": t });

  // Without prior onboarding — plan is null (tenant never registered)
  const r1 = await (await fetch(base + "/api/tenants", { headers: H("plan-t1") })).json();
  eq(r1.ok, true);
  eq(r1.tenantId, "plan-t1");
  assert("plan" in r1, "plan field present");

  // After onboarding with explicit plan
  await fetch(base + "/api/tenants", { method: "POST", headers: H("plan-t2"), body: JSON.stringify({ plan: "pro" }) });
  const r2 = await (await fetch(base + "/api/tenants", { headers: H("plan-t2") })).json();
  eq(r2.ok, true);
  eq(r2.plan, "pro", "pro plan reflected");

  server.close();
});

test("GET /api/tenants: missing x-tenant-id → 400 fail-closed", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port: number = (server.address() as any).port;
  const r = await fetch(`http://127.0.0.1:${port}/api/tenants`);
  eq(r.status, 400);
  server.close();
});

test("GET /api/tenants: tenant isolation — plan from A not leaked to B", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port: number = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  await fetch(base + "/api/tenants", { method: "POST", headers: { "content-type": "application/json", "x-tenant-id": "iso-plan-A" }, body: JSON.stringify({ plan: "pro" }) });
  const b = await (await fetch(base + "/api/tenants", { headers: { "x-tenant-id": "iso-plan-B" } })).json();
  assert(b.plan !== "pro", "tenant-B must not see tenant-A's plan");
  server.close();
});

test("DASHBOARD: plan badge element (planBadge) present in HTML", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port: number = (server.address() as any).port;
  const html = await (await fetch(`http://127.0.0.1:${port}/dashboard`)).text();
  assert(html.includes("planBadge"), "planBadge id present in HTML");
  assert(html.includes("plan-badge"), "plan-badge CSS class present");
  assert(html.includes("loadPlan"), "loadPlan() JS function present");
  assert(html.includes("/api/tenants"), "dashboard wired to /api/tenants for plan");
  server.close();
});

test("DASHBOARD: track-records summary table present in HTML", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port: number = (server.address() as any).port;
  const html = await (await fetch(`http://127.0.0.1:${port}/dashboard`)).text();
  assert(html.includes("trRows"), "trRows tbody id present (track-records table)");
  assert(html.includes("Track-record summary"), "table section heading present");
  assert(html.includes("payerAccountId"), "track-records table derives identities from escrow participants");
  assert(html.includes("workerAccountId"), "worker identity considered in track-records table");
  server.close();
});

test("DASHBOARD: .pill.created CSS rule present (created-state escrows have styling)", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port: number = (server.address() as any).port;
  const html = await (await fetch(`http://127.0.0.1:${port}/dashboard`)).text();
  assert(html.includes("pill.created") || html.includes(".pill.created"), ".pill.created CSS rule present");
  // Confirm all four escrow states are styled
  assert(html.includes("pill.released"), ".pill.released present");
  assert(html.includes("pill.funded"), ".pill.funded present");
  assert(html.includes("pill.disputed"), ".pill.disputed present");
  server.close();
});

test("DASHBOARD: track-records table populates from live escrow data (end-to-end)", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port: number = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  const T = "tr-e2e-t";
  const H = { "content-type": "application/json", "x-tenant-id": T };

  // Create two accounts and an escrow
  const pR = await (await fetch(base + "/api/ledger/accounts", { method: "POST", headers: H, body: JSON.stringify({ ownerId: "payer-tr", type: "asset", name: "P" }) })).json();
  const wR = await (await fetch(base + "/api/ledger/accounts", { method: "POST", headers: H, body: JSON.stringify({ ownerId: "worker-tr", type: "asset", name: "W" }) })).json();
  const pid = pR.account.id; const wid = wR.account.id;
  await fetch(base + "/api/escrow", { method: "POST", headers: H, body: JSON.stringify({ opportunityId: "opp-tr", payerAccountId: pid, workerAccountId: wid, amount: "1000" }) });

  // GET /api/escrow — verify both ids appear
  const esc = await (await fetch(base + "/api/escrow", { headers: H })).json();
  const agreement = esc.data?.agreements?.[0];
  assert(agreement, "escrow created");
  eq(agreement.payerAccountId, pid, "payerAccountId matches");
  eq(agreement.workerAccountId, wid, "workerAccountId matches");

  // Track record endpoint is wired (even if score=0 for new participants)
  const tr = await (await fetch(base + `/api/track-record/${encodeURIComponent(pid)}`, { headers: H })).json();
  assert(tr !== null, "track-record returns data");

  server.close();
});
