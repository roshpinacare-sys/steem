import "../_flush.mjs";
/**
 * tests/routes/pqc-admin-routes.test.ts — PQC admin route tests.
 *
 * Coverage:
 *   Happy path:
 *     • POST /api/admin/pqc/install with scope returns 200 { ok, package }
 *   Fail-closed:
 *     • Missing x-tenant-id → 400
 *     • Missing admin:pqc-install scope → 403
 *   Install failure:
 *     • Installer returns success=false → 503 { ok: false, error }
 */

import { test, assert, eq } from "../_harness.mjs";
import { pqcAdminRoutes } from "../../src/routes/pqc-admin-routes.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";

function makeStack() {
  return buildSovereignStack(undefined, { provider: new InMemoryLedger() });
}

function makeCtx(body: any, tenantId: string, scopes?: string[]) {
  return { tenantId, body, params: {}, query: {}, headers: {}, scopes };
}

const stack = makeStack();

// ─── Happy path ──────────────────────────────────────────────────────────────

test("POST /api/admin/pqc/install — success with mock installer", async () => {
  const routes = pqcAdminRoutes(stack, {
    installer: async () => ({ success: true, package: "@open-quantum-safe/liboqs" }),
  });
  const route = routes.find((r) => r.pattern === "/api/admin/pqc/install")!;
  const res = await route.handler(makeCtx({}, "tenant-pqc-1", ["admin:pqc-install"]));
  eq(res.status, 200);
  const body = res.body as any;
  eq(body.ok, true);
  eq(body.package, "@open-quantum-safe/liboqs");
});

// ─── Fail-closed ─────────────────────────────────────────────────────────────

test("POST /api/admin/pqc/install — missing tenantId → 400", async () => {
  const routes = pqcAdminRoutes(stack, {
    installer: async () => ({ success: true, package: "fake" }),
  });
  const route = routes.find((r) => r.pattern === "/api/admin/pqc/install")!;
  const res = await route.handler(makeCtx({}, "", ["admin:pqc-install"]));
  eq(res.status, 400);
  eq((res.body as any).error, "x-tenant-id header required");
});

test("POST /api/admin/pqc/install — missing scope → 403", async () => {
  const routes = pqcAdminRoutes(stack, {
    installer: async () => ({ success: true, package: "fake" }),
  });
  const route = routes.find((r) => r.pattern === "/api/admin/pqc/install")!;
  const res = await route.handler(makeCtx({}, "tenant-pqc-2", []));
  eq(res.status, 403);
  assert((res.body as any).error?.includes("scope"), "error should mention scope");
});

// ─── Install failure ─────────────────────────────────────────────────────────

test("POST /api/admin/pqc/install — installer failure → 503", async () => {
  const routes = pqcAdminRoutes(stack, {
    installer: async () => ({ success: false, error: "npm install failed: network unreachable" }),
  });
  const route = routes.find((r) => r.pattern === "/api/admin/pqc/install")!;
  const res = await route.handler(makeCtx({}, "tenant-pqc-3", ["admin:pqc-install"]));
  eq(res.status, 503);
  const body = res.body as any;
  eq(body.ok, false);
  assert(body.error.includes("network unreachable"), "error should contain installer message");
});

// ─── Installer throws ────────────────────────────────────────────────────────

test("POST /api/admin/pqc/install — installer throws → 503", async () => {
  const routes = pqcAdminRoutes(stack, {
    installer: async () => {
      throw new Error("spawn ENOMEM");
    },
  });
  const route = routes.find((r) => r.pattern === "/api/admin/pqc/install")!;
  const res = await route.handler(makeCtx({}, "tenant-pqc-4", ["admin:pqc-install"]));
  eq(res.status, 503);
  const body = res.body as any;
  assert(body.error.includes("ENOMEM"), "error should contain thrown message");
});
