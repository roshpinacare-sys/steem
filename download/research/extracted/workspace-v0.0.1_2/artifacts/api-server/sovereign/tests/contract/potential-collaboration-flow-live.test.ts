import "../_flush.mjs";
/**
 * tests/contract/potential-collaboration-flow-live.test.ts  (v162)
 *
 * Hand-written STATEFUL contract verification for the Potential Engine +
 * Collaboration flow. Deliberately NOT named `*.contract.test.ts` so
 * auto-generated coverage tooling does not count it in COVERAGE_REPORT.json.
 *
 * Covered operations (spec path → method → declared status, required fields):
 *   POST /potential/profile                             (potentialProfile)          → 200, [ok, data]
 *   POST /potential/personality                         (potentialPersonalityMap)   → 200, [ok, data]
 *   GET  /potential/personality/:userId                 (getPotentialPersonality)   → 200, [ok, data]
 *   POST /potential/success-path                        (computeSuccessPath)        → 200, [ok, data]
 *   GET  /potential/success-path/:userId/:opportunityId (getSuccessPath)            → 200, [ok, data]
 *   POST /potential/collaboration                       (findCollaborators)         → 200, [ok, data]
 *   GET  /potential/collaboration/:userId               (getCachedCollaborators)    → 200, [ok, data]
 *
 * Flows exercised:
 *   A. PERSONALITY FLOW: POST profile → POST personality → GET personality
 *   B. SUCCESS-PATH FLOW: create opportunity → POST success-path → GET success-path
 *   C. COLLABORATION FLOW: POST collaboration (2 candidates) → GET cached collaboration
 *   D. COLLABORATION+ESCROW FLOW: POST collaboration with escrowBudget + ledger accounts
 *      (per-match escrow opened via bridge; validates escrowId or escrowDenied present)
 *
 * Fail-closed:
 *   - POST /potential/profile without userId → 400
 *   - GET /potential/personality/:userId (unknown) → 404
 *   - POST /potential/success-path without targetOpportunityId → 400
 *   - GET /potential/success-path/:userId/:opportunityId (unknown) → 404
 *   - GET /potential/collaboration/:userId (never computed) → 404
 *   - POST /potential/collaboration without userProfile → 400
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _seq = 0;
function uid(tag = "u"): string {
  return `${tag}-pot-${++_seq}-${Math.random().toString(36).slice(2, 7)}`;
}

async function call(
  base: string,
  method: string,
  path: string,
  tenantId: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(base + "/api" + path, {
    method,
    headers: { "x-tenant-id": tenantId, "content-type": "application/json" },
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

function sampleProfile(userId: string, tenantId: string, scores: number[] = [80, 70, 60]) {
  return {
    userId,
    tenantId,
    strengths: [
      { category: "analytical", score: scores[0] ?? 80 },
      { category: "communication", score: scores[1] ?? 70 },
      { category: "leadership", score: scores[2] ?? 60 },
    ],
  };
}

// ─── FLOW A: personality ─────────────────────────────────────────────────────

test("contract potential-flow [A-1]: POST /potential/profile → 200 [ok, data]", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = uid("t");
  const userId = uid("u");
  try {
    const { status, body } = await call(base, "POST", "/potential/profile", tenant, {
      userId,
      knowledgeSignals: [{ category: "analytical", signal: "high", weight: 1 }],
      analyticsSignals: [],
    });
    eq(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assertRequiredFields(body, ["ok", "data"], "potentialProfile");
    assert(body.ok === true, "ok must be true");
    assert(body.data !== null && typeof body.data === "object", "data must be an object");
  } finally { server.close(); }
});

test("contract potential-flow [A-2]: POST /potential/personality → 200 [ok, data]", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = uid("t");
  const userId = uid("u");
  try {
    const { status, body } = await call(base, "POST", "/potential/personality", tenant, {
      userId,
      knowledgeSignals: [{ category: "analytical", signal: "high", weight: 1 }],
      analyticsSignals: [],
    });
    eq(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assertRequiredFields(body, ["ok", "data"], "potentialPersonalityMap");
    assert(body.ok === true, "ok must be true");
  } finally { server.close(); }
});

test("contract potential-flow [A-3]: GET /potential/personality/:userId after save → 200 [ok, data]", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = uid("t");
  const userId = uid("u");
  try {
    // First save via POST
    const post = await call(base, "POST", "/potential/personality", tenant, {
      userId,
      knowledgeSignals: [],
      analyticsSignals: [],
    });
    eq(post.status, 200, `POST /potential/personality: ${JSON.stringify(post.body)}`);

    // Then retrieve via GET
    const { status, body } = await call(base, "GET", `/potential/personality/${userId}`, tenant);
    eq(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assertRequiredFields(body, ["ok", "data"], "getPotentialPersonality");
    assert(body.data.userId === userId, "data.userId must match");
  } finally { server.close(); }
});

// ─── FLOW A fail-closed ───────────────────────────────────────────────────────

test("contract potential-flow [A-fail-1]: POST /potential/profile without userId → 400", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  try {
    const { status } = await call(base, "POST", "/potential/profile", uid("t"), {});
    eq(status, 400, "missing userId must return 400");
  } finally { server.close(); }
});

test("contract potential-flow [A-fail-2]: GET /potential/personality/:userId unknown → 404", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  try {
    const { status } = await call(base, "GET", "/potential/personality/never-exists-xyz", uid("t"));
    eq(status, 404, "unknown userId must return 404");
  } finally { server.close(); }
});

// ─── FLOW B: success-path ─────────────────────────────────────────────────────

test("contract potential-flow [B-1]: POST /potential/success-path → 200 [ok, data]", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = uid("t");
  const userId = uid("u");
  const oppId = uid("opp");
  try {
    // Create an opportunity in the catalog (no listing fee)
    const oppRes = await call(base, "POST", "/marketplace/opportunities", tenant, {
      id: oppId,
      title: "Analytical Lead",
      description: "Requires strong analytical skills",
      requiredStrengths: [{ category: "analytical", minScore: 75 }],
    });
    eq(oppRes.status, 201, `createOpportunity failed: ${JSON.stringify(oppRes.body)}`);

    const profile = sampleProfile(userId, tenant);
    const { status, body } = await call(base, "POST", "/potential/success-path", tenant, {
      userId,
      profile,
      targetOpportunityId: oppId,
    });
    eq(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assertRequiredFields(body, ["ok", "data"], "computeSuccessPath");
    assert(body.ok === true, "ok must be true");
    assert(body.data !== null && typeof body.data === "object", "data must be an object");
  } finally { server.close(); }
});

test("contract potential-flow [B-2]: GET /potential/success-path/:userId/:opportunityId after compute → 200 [ok, data]", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = uid("t");
  const userId = uid("u");
  const oppId = uid("opp");
  try {
    // Create opportunity
    const oppRes = await call(base, "POST", "/marketplace/opportunities", tenant, {
      id: oppId,
      title: "Data Engineer",
      requiredStrengths: [{ category: "analytical", minScore: 50 }],
    });
    eq(oppRes.status, 201, `createOpportunity: ${JSON.stringify(oppRes.body)}`);

    // Compute success-path (auto-saves)
    const profile = sampleProfile(userId, tenant);
    const post = await call(base, "POST", "/potential/success-path", tenant, {
      userId,
      profile,
      targetOpportunityId: oppId,
    });
    eq(post.status, 200, `POST /potential/success-path: ${JSON.stringify(post.body)}`);

    // GET the saved path
    const { status, body } = await call(base, "GET", `/potential/success-path/${userId}/${oppId}`, tenant);
    eq(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assertRequiredFields(body, ["ok", "data"], "getSuccessPath");
    assert(body.data.userId === userId, "data.userId must match");
    assert(body.data.targetOpportunityId === oppId, "data.targetOpportunityId must match");
  } finally { server.close(); }
});

// ─── FLOW B fail-closed ───────────────────────────────────────────────────────

test("contract potential-flow [B-fail-1]: POST /potential/success-path without targetOpportunityId → 400", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  try {
    const { status } = await call(base, "POST", "/potential/success-path", uid("t"), {
      userId: uid("u"),
      profile: sampleProfile("x", "t"),
    });
    eq(status, 400, "missing targetOpportunityId must return 400");
  } finally { server.close(); }
});

test("contract potential-flow [B-fail-2]: GET /potential/success-path unknown → 404", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  try {
    const { status } = await call(base, "GET", "/potential/success-path/no-user/no-opp", uid("t"));
    eq(status, 404, "unknown path must return 404");
  } finally { server.close(); }
});

// ─── FLOW C: collaboration ────────────────────────────────────────────────────

test("contract potential-flow [C-1]: POST /potential/collaboration → 200 [ok, data]", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = uid("t");
  const userA = uid("u");
  const userB = uid("u");
  const userC = uid("u");
  try {
    const { status, body } = await call(base, "POST", "/potential/collaboration", tenant, {
      userId: userA,
      userProfile: sampleProfile(userA, tenant, [90, 50, 40]),
      candidates: [
        { userId: userB, profile: sampleProfile(userB, tenant, [40, 90, 60]) },
        { userId: userC, profile: sampleProfile(userC, tenant, [50, 50, 90]) },
      ],
      minCompatibility: 0,
    });
    eq(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assertRequiredFields(body, ["ok", "data"], "findCollaborators");
    assert(body.ok === true, "ok must be true");
    assert(Array.isArray(body.data), "data must be an array");
  } finally { server.close(); }
});

test("contract potential-flow [C-2]: GET /potential/collaboration/:userId after compute → 200 [ok, data]", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = uid("t");
  const userA = uid("u");
  const userB = uid("u");
  try {
    // POST collaboration (auto-saves cache)
    const post = await call(base, "POST", "/potential/collaboration", tenant, {
      userId: userA,
      userProfile: sampleProfile(userA, tenant, [90, 50, 40]),
      candidates: [{ userId: userB, profile: sampleProfile(userB, tenant, [40, 90, 60]) }],
      minCompatibility: 0,
    });
    eq(post.status, 200, `POST /potential/collaboration: ${JSON.stringify(post.body)}`);

    // Wait briefly for async save (fire-and-forget)
    await new Promise((r) => setTimeout(r, 50));

    const { status, body } = await call(base, "GET", `/potential/collaboration/${userA}`, tenant);
    eq(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assertRequiredFields(body, ["ok", "data"], "getCachedCollaborators");
    assert(Array.isArray(body.data), "data must be an array");
  } finally { server.close(); }
});

// ─── FLOW C fail-closed ───────────────────────────────────────────────────────

test("contract potential-flow [C-fail-1]: POST /potential/collaboration without userProfile → 400", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  try {
    const { status } = await call(base, "POST", "/potential/collaboration", uid("t"), {
      userId: uid("u"),
      candidates: [],
    });
    eq(status, 400, "missing userProfile must return 400");
  } finally { server.close(); }
});

test("contract potential-flow [C-fail-2]: GET /potential/collaboration/:userId never computed → 404", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  try {
    const { status } = await call(base, "GET", `/potential/collaboration/${uid("u")}`, uid("t"));
    eq(status, 404, "no cache must return 404");
  } finally { server.close(); }
});

// ─── FLOW D: collaboration + escrow (bridge) ──────────────────────────────────

test("contract potential-flow [D-1]: POST /potential/collaboration + escrowBudget → match has escrowId or escrowDenied", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = uid("t");
  const userA = uid("u");
  const userB = uid("u");
  const oppId = uid("opp");
  try {
    // Create ledger accounts for both users
    const acctA = await call(base, "POST", "/ledger/accounts", tenant, {
      ownerId: userA, type: "asset", name: "Payer",
    });
    eq(acctA.status, 201, `createAccount A: ${JSON.stringify(acctA.body)}`);
    const acctB = await call(base, "POST", "/ledger/accounts", tenant, {
      ownerId: userB, type: "asset", name: "Worker",
    });
    eq(acctB.status, 201, `createAccount B: ${JSON.stringify(acctB.body)}`);
    const payerAccountId = acctA.body.account.id;
    const workerAccountId = acctB.body.account.id;

    // Mint budget to payer
    const mint = await call(base, "POST", "/ledger/mint", tenant, {
      toAccountId: payerAccountId, amount: "5000000", memo: "seed", initiatedBy: userA,
    });
    eq(mint.status, 200, `mint: ${JSON.stringify(mint.body)}`);

    // Create opportunity
    const oppRes = await call(base, "POST", "/marketplace/opportunities", tenant, {
      id: oppId, title: "Collab Opp", requiredStrengths: [],
    });
    eq(oppRes.status, 201, `createOpportunity: ${JSON.stringify(oppRes.body)}`);

    // POST collaboration with escrow bridge
    const { status, body } = await call(base, "POST", "/potential/collaboration", tenant, {
      userId: userA,
      userProfile: sampleProfile(userA, tenant, [90, 50, 40]),
      candidates: [{ userId: userB, profile: sampleProfile(userB, tenant, [40, 90, 60]) }],
      minCompatibility: 0,
      opportunityId: oppId,
      payerAccountId,
      escrowBudget: "100000",
      accountsByUserId: { [userB]: workerAccountId },
    });
    eq(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, "ok must be true");
    assert(Array.isArray(body.data), "data must be an array");
    // Each match must have either escrowId (success) or escrowDenied/escrowSkipped (fail-closed)
    for (const m of body.data as any[]) {
      const hasEscrow = m.escrowId !== undefined || m.escrowDenied !== undefined || m.escrowSkipped !== undefined;
      assert(hasEscrow, `match must have escrowId, escrowDenied, or escrowSkipped: ${JSON.stringify(m)}`);
    }
  } finally { server.close(); }
});
