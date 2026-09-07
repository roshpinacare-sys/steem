import "../_flush.mjs";
/**
 * tests/integration/collaboration-escrow-loop.test.ts — V75: the FULL coordination-economy loop,
 * live over HTTP: a collaboration recommendation auto-opens a funded-ready escrow per match.
 * Proves: matches returned with escrowId · escrow agreement exists in "created" state · μ¢ budget
 * recorded · per-match fail-closed (partner without account → escrowSkipped, not a crash) ·
 * no budget → plain matches (backward compatible).
 */
import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const port: number = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;
const T = "loop-tenant";
const H = { "content-type": "application/json", "x-tenant-id": T };
const post = (p: string, b: any) => fetch(base + p, { method: "POST", headers: H, body: JSON.stringify(b) });
const get = (p: string) => fetch(base + p, { headers: H });

function profile(userId: string, strengths: Array<{ category: string; score: number }>) {
  return { userId, tenantId: T, strengths: strengths.map(s => ({ ...s, confidence: 0.8, evidence: [] })), analyzedAt: new Date().toISOString() };
}

test("LOOP: collaboration match auto-opens escrow (recommendation → guarded money)", async () => {
  // ledger accounts for payer + partner
  const payer = await (await post("/api/ledger/accounts", { ownerId: "alice", type: "asset", name: "Alice" })).json();
  const partner = await (await post("/api/ledger/accounts", { ownerId: "bob", type: "asset", name: "Bob" })).json();
  const seed = await post("/api/ledger/mint", { toAccountId: payer.account.id, amount: "1000000", memo: "seed" });
  eq(seed.status, 200);

  const res = await post("/api/potential/collaboration", {
    userId: "alice",
    userProfile: profile("alice", [{ category: "creativity", score: 90 }]),
    candidates: [{ userId: "bob", profile: profile("bob", [{ category: "leadership", score: 88 }]) }],
    minCompatibility: 0,
    opportunityId: "opp-loop-1",
    escrowBudget: "250000",
    payerAccountId: payer.account.id,
    accountsByUserId: { bob: partner.account.id },
  });
  eq(res.status, 200);
  const body = await res.json();
  assert(Array.isArray(body.data) && body.data.length > 0, "matches returned");
  const m = body.data.find((x: any) => x.userB === "bob") || body.data[0];
  assert(m.escrowId, "match carries an escrowId (the loop closed)");

  // the escrow agreement is real and tenant-scoped
  const esc = await (await get("/api/escrow/" + m.escrowId)).json();
  const ag = esc.data ?? esc.agreement ?? esc;
  eq(String(ag.amount), "250000", "budget recorded in μ¢");
  eq(ag.state, "created", "escrow waiting for funding");
});

test("LOOP fail-closed per match: partner without ledger account → escrowSkipped, no crash", async () => {
  const payer = await (await post("/api/ledger/accounts", { ownerId: "carol", type: "asset", name: "C" })).json();
  const res = await post("/api/potential/collaboration", {
    userId: "carol",
    userProfile: profile("carol", [{ category: "focus", score: 80 }]),
    candidates: [{ userId: "dave", profile: profile("dave", [{ category: "collaboration", score: 85 }]) }],
    minCompatibility: 0,
    opportunityId: "opp-loop-2",
    escrowBudget: "100000",
    payerAccountId: payer.account.id,
    accountsByUserId: {}, // dave has no account
  });
  eq(res.status, 200);
  const body = await res.json();
  const m = body.data[0];
  eq(m.escrowId, null);
  assert(m.escrowSkipped, "skip reason reported");
});

test("LOOP backward compatible: no escrowBudget → plain matches, no escrow fields", async () => {
  const res = await post("/api/potential/collaboration", {
    userId: "eve",
    userProfile: profile("eve", [{ category: "creativity", score: 70 }]),
    candidates: [{ userId: "frank", profile: profile("frank", [{ category: "leadership", score: 75 }]) }],
    minCompatibility: 0,
  });
  eq(res.status, 200);
  const body = await res.json();
  assert(Array.isArray(body.data), "matches array");
  assert(body.data[0].escrowId === undefined, "no escrow fields without budget");
});

test("LOOP validation: bad escrowBudget → 400", async () => {
  const res = await post("/api/potential/collaboration", {
    userId: "g", userProfile: profile("g", []), candidates: [],
    opportunityId: "o", escrowBudget: "1.5", payerAccountId: "acc-x",
  });
  eq(res.status, 400);
});

import { test as _t } from "../_harness.mjs";
_t("cleanup", () => { server.close(); });
