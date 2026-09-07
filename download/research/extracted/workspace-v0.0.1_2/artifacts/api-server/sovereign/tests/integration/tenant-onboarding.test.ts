import "../_flush.mjs";
/**
 * tests/integration/tenant-onboarding.test.ts — POST /api/tenants
 *
 * Coverage:
 *   • happy path: onboard a new tenant → root person + first account + policies.
 *   • idempotency: second call for same tenant returns 200 (not 201) and same entities.
 *   • edge case: invalid accountType → 400.
 *   • failure case: missing x-tenant-id → 400 (tenant isolation).
 *   • tenant isolation: tenant-A onboarded state is invisible to tenant-B.
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const port: number = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;
const H = (t: string) => ({ "content-type": "application/json", "x-tenant-id": t });
const post = (p: string, body: any, t = "onboard-t1") =>
  fetch(base + p, { method: "POST", headers: H(t), body: JSON.stringify(body) });
const get = (p: string, t = "onboard-t1") => fetch(base + p, { headers: H(t) });

test("TENANT ONBOARDING: missing x-tenant-id → 400", async () => {
  const r = await fetch(base + "/api/tenants", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  eq(r.status, 400);
});

test("TENANT ONBOARDING: happy path — creates root person, account, and policies", async () => {
  const r = await post("/api/tenants", { rootPersonName: "Admin", accountName: "Primary", accountType: "asset" });
  eq(r.status, 201);
  const body = await r.json();
  eq(body.ok, true);
  eq(body.tenantId, "onboard-t1");
  eq(body.created, true);

  const rp = body.rootPerson;
  assert(rp, "rootPerson returned");
  eq(rp.id, "human-root:onboard-t1");
  eq(rp.type, "human");
  eq(rp.tenantId, "onboard-t1");
  eq(rp.parentId, null);

  const acct = body.account;
  assert(acct, "account returned");
  eq(acct.ownerId, "human-root:onboard-t1");
  eq(acct.type, "asset");
  eq(acct.name, "Primary");
  eq(acct.balance, "0");

  assert(Array.isArray(body.policies) && body.policies.length > 0, "policies returned");
});

test("TENANT ONBOARDING: idempotency — second call returns 200 with same entities", async () => {
  const r = await post("/api/tenants", {});
  eq(r.status, 200);
  const body = await r.json();
  eq(body.ok, true);
  eq(body.created, false);
  eq(body.tenantId, "onboard-t1");
  eq(body.rootPerson.id, "human-root:onboard-t1");
  eq(body.account.ownerId, "human-root:onboard-t1");
});

test("TENANT ONBOARDING: invalid accountType → 400", async () => {
  const r = await post("/api/tenants", { accountType: "bogus" }, "onboard-t-invalid");
  eq(r.status, 400);
});

test("TENANT ONBOARDING: tenant isolation — tenant-B cannot see tenant-A account", async () => {
  const rA = await post("/api/tenants", { accountName: "Secret" }, "onboard-t-A");
  eq(rA.status, 201);
  const bodyA = await rA.json();
  const secretId = bodyA.account.id;

  const rB = await get("/api/ledger/accounts/" + secretId, "onboard-t-B");
  eq(rB.status, 404);
});

import { test as _t } from "../_harness.mjs";
_t("TENANT ONBOARDING: cleanup", () => { server.close(); });
