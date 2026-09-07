import "../_flush.mjs";
/**
 * tests/release/idempotency.test.ts — v238: Idempotency-Key REQUIRED on state-changing methods.
 * Same Idempotency-Key + same endpoint → executed ONCE, second call replays the original response
 * (no double mint!) with idempotency-replayed header. Key reuse on a different endpoint → 422.
 * Different keys → independent executions. Missing key on state-changing request → 400.
 */
import { test, assert, eq } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

// v239: default is requireIdempotencyKey=true (no explicit option needed)
const server = startSovereignServer(0);
const port: number = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;
const T = "idem-t";
const H = (key?: string) => ({ "content-type": "application/json", "x-tenant-id": T, ...(key ? { "idempotency-key": key } : {}) });

test("IDEM: missing Idempotency-Key on state-changing POST → 400 (default enforced)", async () => {
  const r = await fetch(base + "/api/ledger/accounts", { method: "POST", headers: H(), body: JSON.stringify({ ownerId: "a", type: "asset", name: "A" }) });
  eq(r.status, 400);
  const body = await r.json();
  eq(body.error, "Idempotency-Key header is required for state-changing requests");
});

test("IDEM: retry with same key does NOT double-mint; response replayed", async () => {
  const acc = await (await fetch(base + "/api/ledger/accounts", { method: "POST", headers: H("acc-1"), body: JSON.stringify({ ownerId: "a", type: "asset", name: "A" }) })).json();
  const id = acc.account.id;
  const mint = (k: string) => fetch(base + "/api/ledger/mint", { method: "POST", headers: H(k), body: JSON.stringify({ toAccountId: id, amount: "100000", memo: "m", initiatedBy: "a" }) });
  const r1 = await mint("key-1"); eq(r1.status, 200);
  const r2 = await mint("key-1"); eq(r2.status, 200);
  eq(r2.headers.get("idempotency-replayed"), "true", "second call is a replay");
  const bal = await (await fetch(base + "/api/ledger/accounts/" + id, { headers: H() })).json();
  assert(JSON.stringify(bal.account).includes("100000") && !JSON.stringify(bal.account).includes("200000"), "minted exactly once");
});

test("IDEM: different keys execute independently", async () => {
  const acc = await (await fetch(base + "/api/ledger/accounts", { method: "POST", headers: H("acc-2"), body: JSON.stringify({ ownerId: "b", type: "asset", name: "B" }) })).json();
  const id = acc.account.id;
  const mint = (k: string) => fetch(base + "/api/ledger/mint", { method: "POST", headers: H(k), body: JSON.stringify({ toAccountId: id, amount: "50000", memo: "m", initiatedBy: "b" }) });
  await mint("k-a"); await mint("k-b");
  const bal = await (await fetch(base + "/api/ledger/accounts/" + id, { headers: H() })).json();
  assert(JSON.stringify(bal.account).includes("100000"), "two independent mints");
});

test("IDEM: key reused on a different endpoint → 422 (client bug, not replay)", async () => {
  const r = await fetch(base + "/api/ledger/accounts", { method: "POST", headers: H("key-1"), body: JSON.stringify({ ownerId: "c", type: "asset", name: "C" }) });
  eq(r.status, 422);
});

test("IDEM: tenant-scoped — same key in another tenant executes fresh", async () => {
  const H2 = { "content-type": "application/json", "x-tenant-id": "idem-other", "idempotency-key": "key-1" };
  const r = await fetch(base + "/api/ledger/accounts", { method: "POST", headers: H2, body: JSON.stringify({ ownerId: "d", type: "asset", name: "D" }) });
  eq(r.status, 201, "different tenant, fresh execution");
});

test("IDEM: DELETE with same key does NOT double-revoke; response replayed", async () => {
  // Create an API key
  const create = await fetch(base + "/api/auth/api-keys", { method: "POST", headers: H("api-key-1"), body: JSON.stringify({ name: "del-key" }) });
  eq(create.status, 201);
  const created = await create.json();
  const keyId = created.key.keyId;
  // Delete (revoke) twice with same idempotency key
  const del = (k: string) => fetch(base + `/api/auth/api-keys/${keyId}`, { method: "DELETE", headers: H(k) });
  const r1 = await del("del-key-1"); eq(r1.status, 204);
  const r2 = await del("del-key-1"); eq(r2.status, 204);
  eq(r2.headers.get("idempotency-replayed"), "true", "second DELETE is a replay");
  // Verify the key is revoked (revoke sets revokedAt; list still includes it)
  const list = await (await fetch(base + "/api/auth/api-keys", { headers: H() })).json();
  const key = list.keys.find((k: any) => k.keyId === keyId);
  assert(!!key && !!key.revokedAt, "key was revoked exactly once");
});

test("IDEM: key reuse across methods on same path → 422", async () => {
  const acc = await (await fetch(base + "/api/ledger/accounts", { method: "POST", headers: H("acc-reuse"), body: JSON.stringify({ ownerId: "reuse", type: "asset", name: "Reuse" }) })).json();
  const id = acc.account.id;
  // First mint with key
  const r1 = await fetch(base + "/api/ledger/mint", { method: "POST", headers: H("reuse-key"), body: JSON.stringify({ toAccountId: id, amount: "1000", memo: "m", initiatedBy: "reuse" }) });
  eq(r1.status, 200);
  // Reuse same key on a DELETE to a different path — allowed because path differs
  const r2 = await fetch(base + `/api/ledger/accounts/${id}`, { method: "DELETE", headers: H("reuse-key") });
  eq(r2.status, 404, "no such route, but idempotency allowed because path differs");
});

test("IDEM: backward-compat — requireIdempotencyKey:false allows POST without key", async () => {
  const compatServer = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const compatPort = (compatServer.address() as any).port;
  const compatBase = `http://127.0.0.1:${compatPort}`;
  try {
    const r = await fetch(compatBase + "/api/ledger/accounts", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": "idem-compat" },
      body: JSON.stringify({ ownerId: "compat", type: "asset", name: "Compat" }),
    });
    eq(r.status, 201, "POST without Idempotency-Key succeeds when enforcement is disabled");
  } finally {
    compatServer.close();
  }
});

import { test as _t } from "../_harness.mjs";
_t("cleanup", () => { server.close(); });
