import "../_flush.mjs";
import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const port: number = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;
const H = (t: string) => ({ "content-type": "application/json", "x-tenant-id": t });
const post = (p: string, body: any, t = "tenant-1") => fetch(base + p, { method: "POST", headers: H(t), body: JSON.stringify(body) });
const get = (p: string, t = "tenant-1") => fetch(base + p, { headers: H(t) });

test("LIVE: tenant isolation — missing x-tenant-id → 400", async () => {
  const r = await fetch(base + "/api/ledger/solvency");
  eq(r.status, 400);
});
test("LIVE: create accounts + mint + transfer + balance (sovereign money over HTTP)", async () => {
  const a = await (await post("/api/ledger/accounts", { ownerId: "u1", type: "asset", name: "Alice" })).json();
  const b = await (await post("/api/ledger/accounts", { ownerId: "u2", type: "asset", name: "Bob" })).json();
  const idA = a.account.id, idB = b.account.id;
  assert(idA && idB, "accounts created");
  const mint = await post("/api/ledger/mint", { toAccountId: idA, amount: "1000000", memo: "seed" });
  eq(mint.status, 200);
  const tr = await post("/api/ledger/transfer", { fromAccountId: idA, toAccountId: idB, amount: "250000", memo: "pay" });
  eq(tr.status, 200);
  const balB = await (await get("/api/ledger/accounts/" + idB)).json();
  assert(JSON.stringify(balB.account).includes("250000"), "Bob received 250000 μ¢");
});
test("LIVE: invalid amount → 400 (fail-closed input)", async () => {
  const acc = await (await post("/api/ledger/accounts", { ownerId: "u3", type: "asset", name: "C" })).json();
  const r = await post("/api/ledger/mint", { toAccountId: acc.account.id, amount: "1.5" });
  eq(r.status, 400);
});
test("LIVE: tenant-2 cannot see tenant-1 account (isolation enforced)", async () => {
  const acc = await (await post("/api/ledger/accounts", { ownerId: "x", type: "asset", name: "Secret" }, "tenant-1")).json();
  const r = await get("/api/ledger/accounts/" + acc.account.id, "tenant-2");
  eq(r.status, 404);
});
test("LIVE: solvency proof over HTTP", async () => {
  const r = await get("/api/ledger/solvency");
  eq(r.status, 200);
});

import { test as _t } from "../_harness.mjs";
_t("cleanup: close server", () => { server.close(); });

// ── V15: governance-as-data enforced over HTTP ──
import { test as gt, eq as geq } from "../_harness.mjs";
const server2 = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const port2: number = (server2.address() as any).port;
const base2 = `http://127.0.0.1:${port2}`;
const H2 = (t = "gov-tenant") => ({ "content-type": "application/json", "x-tenant-id": t });
const post2 = (p: string, b: any) => fetch(base2 + p, { method: "POST", headers: H2(), body: JSON.stringify(b) });
gt("V15 LIVE: JSON spending-cap policy blocks over-limit mint (403), allows under", async () => {
  const acc = await (await post2("/api/ledger/accounts", { ownerId: "g", type: "asset", name: "G" })).json();
  const id = acc.account.id;
  const under = await post2("/api/ledger/mint", { toAccountId: id, amount: "50000000", memo: "ok" });   // 500 USD < cap
  geq(under.status, 200);
  const over = await post2("/api/ledger/mint", { toAccountId: id, amount: "200000000", memo: "too big" }); // 2000 USD > cap
  geq(over.status, 403);
  const body = await over.json();
  geq(String(body.error).includes("spending cap"), true);
  server2.close();
});
