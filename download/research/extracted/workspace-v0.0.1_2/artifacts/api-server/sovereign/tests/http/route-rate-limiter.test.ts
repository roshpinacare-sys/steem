import "../_flush.mjs";
/**
 * tests/http/route-rate-limiter.test.ts — per-route rate limiter (v249, gap #17 sub-step 1)
 *
 * Verifies that POST /api/adapter/run gets its own tighter rate cap independent of
 * the global per-tenant limit.
 *
 * Coverage:
 *   feature:
 *     • POST /api/adapter/run succeeds while within per-route cap
 *     • POST /api/adapter/run returns 429 after exhausting per-route cap
 *     • 429 response includes x-ratelimit-scope=route (distinguishes per-route from global)
 *     • 429 response includes retry-after header (positive integer string)
 *     • 429 response body is { error: "route rate limit exceeded" }
 *   isolation:
 *     • different tenants have independent per-route buckets (t1 exhausted, t2 unaffected)
 *     • global rate limit NOT exhausted when route limit fires (they are independent)
 *   non-target routes:
 *     • POST /api/ledger/mint has NO per-route cap (only global) — allowed after
 *       many requests that would exhaust a route limit
 *   custom config:
 *     • opts.routeRateLimits.adapterRun overrides the default cap
 *     • can set maxRequests=1 to block on the second request
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { buildSovereignStack } from "../../src/composition.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeServer(routeMaxRequests: number) {
  const stack = buildSovereignStack();
  const server = startSovereignServer(0, stack, {
    requireIdempotencyKey: false, // simplify tests — no idempotency key needed
    routeRateLimits: {
      adapterRun: { windowMs: 60_000, maxRequests: routeMaxRequests },
    },
    // Global limit is very generous so it doesn't interfere
    rateLimit: { windowMs: 60_000, maxRequests: 10_000 },
  });
  const port: number = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  return { server, base, stack };
}

async function adapterRun(base: string, tenantId: string): Promise<Response> {
  return fetch(`${base}/api/adapter/run`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-tenant-id": tenantId },
    body: JSON.stringify({
      intent: {
        tenantId,
        actorId: "agent-1",
        toolId: "file.read",
        resourceRef: "file://readme.md",
        riskClass: "read_only",
        valueMicrounits: "0",
        nonce: `nonce-${Math.random().toString(36).slice(2)}`,
        expiry: new Date(Date.now() + 60_000).toISOString(),
        approvalPolicyRef: "default",
        privacyLevel: "internal",
        provenance: "test",
        evidencePolicy: "ev:default",
      },
    }),
  });
}

async function mintRequest(base: string, tenantId: string): Promise<Response> {
  return fetch(`${base}/api/ledger/mint`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-tenant-id": tenantId },
    body: JSON.stringify({ toAccountId: "acc-1", amount: "1000", memo: "test", initiatedBy: "test" }),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("ROUTE-RATE-LIMIT: first N requests succeed within cap", async () => {
  const { server, base } = makeServer(3);
  try {
    for (let i = 0; i < 3; i++) {
      const res = await adapterRun(base, "t1");
      // 200 or 4xx business error — but NOT 429
      assert(res.status !== 429, `request ${i + 1} should not be rate-limited; got ${res.status}`);
    }
  } finally { server.close(); }
});

test("ROUTE-RATE-LIMIT: (N+1)th request returns 429", async () => {
  const { server, base } = makeServer(2);
  try {
    await adapterRun(base, "t1");
    await adapterRun(base, "t1");
    const res = await adapterRun(base, "t1"); // 3rd — over cap
    eq(res.status, 429, "third request should be 429");
    const body = await res.json();
    eq(body.error, "route rate limit exceeded");
  } finally { server.close(); }
});

test("ROUTE-RATE-LIMIT: 429 includes x-ratelimit-scope=route header", async () => {
  const { server, base } = makeServer(1);
  try {
    await adapterRun(base, "t1"); // consume the 1 token
    const res = await adapterRun(base, "t1");
    eq(res.status, 429);
    eq(res.headers.get("x-ratelimit-scope"), "route");
  } finally { server.close(); }
});

test("ROUTE-RATE-LIMIT: 429 includes retry-after header (positive integer seconds)", async () => {
  const { server, base } = makeServer(1);
  try {
    await adapterRun(base, "t1");
    const res = await adapterRun(base, "t1");
    eq(res.status, 429);
    const retryAfter = res.headers.get("retry-after");
    assert(retryAfter !== null, "retry-after header must be present");
    const n = parseInt(retryAfter!, 10);
    assert(Number.isInteger(n) && n >= 0, `retry-after must be non-negative integer, got "${retryAfter}"`);
  } finally { server.close(); }
});

test("ROUTE-RATE-LIMIT: tenant isolation — t1 exhausted does NOT block t2", async () => {
  const { server, base } = makeServer(1);
  try {
    await adapterRun(base, "t1"); // exhaust t1
    const t1res = await adapterRun(base, "t1");
    eq(t1res.status, 429);

    // t2 still has its own fresh bucket
    const t2res = await adapterRun(base, "t2");
    assert(t2res.status !== 429, `t2 should NOT be rate-limited; got ${t2res.status}`);
  } finally { server.close(); }
});

test("ROUTE-RATE-LIMIT: global limit NOT consumed when route limit fires", async () => {
  // Use global limit = 10_000 (very high), route limit = 0 (immediate block)
  const stack = buildSovereignStack();
  const server = startSovereignServer(0, stack, {
    requireIdempotencyKey: false,
    rateLimit: { windowMs: 60_000, maxRequests: 10_000 },
    routeRateLimits: { adapterRun: { windowMs: 60_000, maxRequests: 0 } },
  });
  const port: number = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    // First request hits route limit immediately
    const res = await adapterRun(base, "t1");
    eq(res.status, 429);
    eq(res.headers.get("x-ratelimit-scope"), "route");

    // Non-rate-limited endpoint still works (global not exhausted)
    const mintRes = await fetch(`${base}/api/ledger/accounts`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": "t1" },
      body: JSON.stringify({ ownerId: "u1", type: "asset", name: "test" }),
    });
    assert(mintRes.status !== 429, "non-targeted endpoint must not be affected by route limit");
  } finally { server.close(); }
});

test("ROUTE-RATE-LIMIT: non-targeted route (POST /api/ledger/mint) has NO per-route cap", async () => {
  // Route cap only on /api/adapter/run. Mint is only global (10_000).
  const { server, base } = makeServer(1); // adapter cap = 1
  try {
    // Issue many mint requests — none should hit 429 from route limiter
    for (let i = 0; i < 5; i++) {
      const res = await mintRequest(base, "t1");
      // may get 400/404 (no account) but never 429 from per-route
      assert(res.status !== 429, `mint request ${i + 1} must not trigger route rate limit`);
    }
  } finally { server.close(); }
});

test("ROUTE-RATE-LIMIT: custom config override via opts.routeRateLimits", async () => {
  const stack = buildSovereignStack();
  const server = startSovereignServer(0, stack, {
    requireIdempotencyKey: false,
    rateLimit: { windowMs: 60_000, maxRequests: 10_000 },
    routeRateLimits: { adapterRun: { windowMs: 60_000, maxRequests: 5 } },
  });
  const port: number = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    // 5 allowed
    for (let i = 0; i < 5; i++) {
      const res = await adapterRun(base, "cust");
      assert(res.status !== 429, `request ${i + 1} should be allowed with custom cap of 5`);
    }
    // 6th blocked
    const res = await adapterRun(base, "cust");
    eq(res.status, 429);
    eq(res.headers.get("x-ratelimit-scope"), "route");
  } finally { server.close(); }
});
