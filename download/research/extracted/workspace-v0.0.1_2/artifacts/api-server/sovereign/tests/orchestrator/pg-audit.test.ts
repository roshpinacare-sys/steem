import "../_flush.mjs";
/**
 * tests/orchestrator/pg-audit.test.ts — PgAuditStore full test suite.
 *
 * Uses InMemoryPool so no external Postgres is needed.
 * Every test gets a fresh pool (isolated table state).
 *
 * Coverage:
 *   Lifecycle
 *     • init() creates the audit_records table
 *     • init() is idempotent (second call does not throw)
 *
 *   append — happy path
 *     • first record gets prevHash "genesis" and seq 0
 *     • second record prevHash links to first record's hash
 *     • third record prevHash links to second record's hash
 *     • returned record matches what is persisted (getRecord roundtrip)
 *     • reason field is optional (undefined → stored as null, returned as undefined)
 *
 *   append — fail-closed
 *     • missing tenantId throws AuditError MISSING_TENANT
 *     • missing actionId throws AuditError MISSING_ACTION
 *
 *   getChain
 *     • returns records in seq ASC order
 *     • returns [] for unknown tenant
 *     • tenant isolation: getChain(A) never returns records belonging to B
 *
 *   verifyChain
 *     • returns true for empty chain
 *     • returns true for intact chain (single record)
 *     • returns true for intact chain (multiple records)
 *     • returns false when a hash field is tampered (UPDATE hash)
 *     • returns false when a data field is tampered (UPDATE action_type)
 *     • returns false when prevHash is tampered
 *     • tenant isolation: tampering B's chain does not affect A's verifyChain
 *
 *   getRecord
 *     • returns the correct record by id
 *     • returns null for unknown id
 *     • tenantId on returned record matches original
 *
 *   Multi-tenant
 *     • two tenants accumulate independent chains
 *     • each chain's seq starts at 0
 */

import { test, assert, eq } from "../_harness.mjs";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import { PgAuditStore } from "../../lib/orchestrator/pg-audit.ts";
import { AuditError } from "../../lib/orchestrator/audit.ts";

// ─── Helper: fresh store per test ────────────────────────────────────────────

async function makeStore(): Promise<PgAuditStore> {
  const pool = new InMemoryPool();
  const store = new PgAuditStore(pool);
  await store.init();
  return store;
}

let _seq = 0;
function makeInput(overrides: Record<string, unknown> = {}) {
  _seq++;
  return {
    id: `audit-${_seq}`,
    tenantId: "tenant-alpha",
    actionId: `action-${_seq}`,
    actionType: "agent.task.run",
    source: "test-agent",
    outcome: "allowed" as const,
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

test("init() creates the audit_records table", async () => {
  const pool = new InMemoryPool();
  const store = new PgAuditStore(pool);
  await store.init();
  // After init, we can query the table without error
  const result = await pool.query("SELECT * FROM audit_records");
  eq(result.rows.length, 0);
});

test("init() is idempotent (second call does not throw)", async () => {
  const pool = new InMemoryPool();
  const store = new PgAuditStore(pool);
  await store.init();
  await store.init(); // must not throw
  assert(true, "second init did not throw");
});

// ─── append — happy path ──────────────────────────────────────────────────────

test("first record gets prevHash 'genesis' and seq 0", async () => {
  const store = await makeStore();
  const rec = await store.append(makeInput());
  eq(rec.prevHash, "genesis");
  // seq is internal; verify via getChain
  const chain = await store.getChain("tenant-alpha");
  eq(chain.length, 1);
  eq(chain[0].prevHash, "genesis");
});

test("second record prevHash links to first record's hash", async () => {
  const store = await makeStore();
  const first = await store.append(makeInput());
  const second = await store.append(makeInput());
  eq(second.prevHash, first.hash);
});

test("third record prevHash links to second record's hash", async () => {
  const store = await makeStore();
  await store.append(makeInput());
  const second = await store.append(makeInput());
  const third = await store.append(makeInput());
  eq(third.prevHash, second.hash);
});

test("returned record matches getRecord roundtrip", async () => {
  const store = await makeStore();
  const rec = await store.append(makeInput({ actionType: "billing.charge" }));
  const fetched = await store.getRecord(rec.id);
  assert(fetched !== null, "getRecord should return the record");
  eq(fetched!.id, rec.id);
  eq(fetched!.hash, rec.hash);
  eq(fetched!.prevHash, rec.prevHash);
  eq(fetched!.actionType, "billing.charge");
  eq(fetched!.tenantId, "tenant-alpha");
});

test("reason field is optional (undefined → stored as null → returned as undefined)", async () => {
  const store = await makeStore();
  const withoutReason = await store.append(makeInput({ outcome: "allowed" }));
  assert(withoutReason.reason === undefined, "reason should be undefined when not provided");

  const withReason = await store.append(
    makeInput({ outcome: "denied", reason: "rate limit exceeded" }),
  );
  eq(withReason.reason, "rate limit exceeded");
});

// ─── append — fail-closed ─────────────────────────────────────────────────────

test("missing tenantId throws AuditError MISSING_TENANT", async () => {
  const store = await makeStore();
  let thrown: unknown;
  try {
    await store.append(makeInput({ tenantId: "" }));
  } catch (e) {
    thrown = e;
  }
  assert(thrown instanceof AuditError, "should throw AuditError");
  eq((thrown as AuditError).code, "MISSING_TENANT");
});

test("missing actionId throws AuditError MISSING_ACTION", async () => {
  const store = await makeStore();
  let thrown: unknown;
  try {
    await store.append(makeInput({ actionId: "" }));
  } catch (e) {
    thrown = e;
  }
  assert(thrown instanceof AuditError, "should throw AuditError");
  eq((thrown as AuditError).code, "MISSING_ACTION");
});

// ─── getChain ─────────────────────────────────────────────────────────────────

test("getChain returns records in insertion order (seq ASC)", async () => {
  const store = await makeStore();
  const r1 = await store.append(makeInput({ actionType: "step.1" }));
  const r2 = await store.append(makeInput({ actionType: "step.2" }));
  const r3 = await store.append(makeInput({ actionType: "step.3" }));
  const chain = await store.getChain("tenant-alpha");
  eq(chain.length, 3);
  eq(chain[0].id, r1.id);
  eq(chain[1].id, r2.id);
  eq(chain[2].id, r3.id);
});

test("getChain returns [] for unknown tenant", async () => {
  const store = await makeStore();
  const chain = await store.getChain("no-such-tenant");
  eq(chain.length, 0);
});

test("tenant isolation: getChain(A) never returns records belonging to B", async () => {
  const store = await makeStore();
  await store.append(makeInput({ tenantId: "tenant-A" }));
  await store.append(makeInput({ tenantId: "tenant-A" }));
  await store.append(makeInput({ tenantId: "tenant-B" }));

  const chainA = await store.getChain("tenant-A");
  const chainB = await store.getChain("tenant-B");

  eq(chainA.length, 2);
  eq(chainB.length, 1);
  for (const rec of chainA) eq(rec.tenantId, "tenant-A");
  for (const rec of chainB) eq(rec.tenantId, "tenant-B");
});

// ─── verifyChain ──────────────────────────────────────────────────────────────

test("verifyChain returns true for empty chain", async () => {
  const store = await makeStore();
  const ok = await store.verifyChain("no-such-tenant");
  eq(ok, true);
});

test("verifyChain returns true for intact chain (single record)", async () => {
  const store = await makeStore();
  await store.append(makeInput());
  const ok = await store.verifyChain("tenant-alpha");
  eq(ok, true);
});

test("verifyChain returns true for intact chain (multiple records)", async () => {
  const store = await makeStore();
  await store.append(makeInput());
  await store.append(makeInput());
  await store.append(makeInput());
  const ok = await store.verifyChain("tenant-alpha");
  eq(ok, true);
});

test("verifyChain returns false when hash field is tampered", async () => {
  const pool = new InMemoryPool();
  const store = new PgAuditStore(pool);
  await store.init();

  await store.append({ id: "r1", tenantId: "t1", actionId: "a1", actionType: "x", source: "s", outcome: "allowed", occurredAt: new Date().toISOString() });

  // Tamper the stored hash directly
  await pool.query(
    "UPDATE audit_records SET hash = $1 WHERE id = $2",
    ["deadbeef", "r1"],
  );

  const ok = await store.verifyChain("t1");
  eq(ok, false);
});

test("verifyChain returns false when a data field (action_type) is tampered", async () => {
  const pool = new InMemoryPool();
  const store = new PgAuditStore(pool);
  await store.init();

  await store.append({ id: "r2", tenantId: "t1", actionId: "a2", actionType: "original.type", source: "s", outcome: "allowed", occurredAt: new Date().toISOString() });

  // Tamper the action_type — hash will no longer match
  await pool.query(
    "UPDATE audit_records SET action_type = $1 WHERE id = $2",
    ["tampered.type", "r2"],
  );

  const ok = await store.verifyChain("t1");
  eq(ok, false);
});

test("verifyChain returns false when prevHash is tampered", async () => {
  const pool = new InMemoryPool();
  const store = new PgAuditStore(pool);
  await store.init();

  await store.append({ id: "r3", tenantId: "t1", actionId: "a3", actionType: "t", source: "s", outcome: "allowed", occurredAt: new Date().toISOString() });
  await store.append({ id: "r4", tenantId: "t1", actionId: "a4", actionType: "t", source: "s", outcome: "allowed", occurredAt: new Date().toISOString() });

  // Tamper prevHash of second record
  await pool.query(
    "UPDATE audit_records SET prev_hash = $1 WHERE id = $2",
    ["aaaaaaaaaaaaaaaa", "r4"],
  );

  const ok = await store.verifyChain("t1");
  eq(ok, false);
});

test("tenant isolation: tampering B's chain does not affect A's verifyChain", async () => {
  const pool = new InMemoryPool();
  const store = new PgAuditStore(pool);
  await store.init();

  await store.append({ id: "a1", tenantId: "tenantA", actionId: "aa1", actionType: "x", source: "s", outcome: "allowed", occurredAt: new Date().toISOString() });
  await store.append({ id: "b1", tenantId: "tenantB", actionId: "ab1", actionType: "x", source: "s", outcome: "allowed", occurredAt: new Date().toISOString() });

  // Tamper tenantB's hash
  await pool.query(
    "UPDATE audit_records SET hash = $1 WHERE id = $2",
    ["corrupted", "b1"],
  );

  const okA = await store.verifyChain("tenantA");
  const okB = await store.verifyChain("tenantB");

  eq(okA, true);   // A is intact
  eq(okB, false);  // B is corrupted
});

// ─── getRecord ────────────────────────────────────────────────────────────────

test("getRecord returns the correct record by id", async () => {
  const store = await makeStore();
  const rec = await store.append(makeInput({ source: "agent-007" }));
  const fetched = await store.getRecord(rec.id);
  assert(fetched !== null, "should find the record");
  eq(fetched!.source, "agent-007");
  eq(fetched!.id, rec.id);
});

test("getRecord returns null for unknown id", async () => {
  const store = await makeStore();
  const result = await store.getRecord("no-such-id");
  eq(result, null);
});

test("getRecord: tenantId on returned record matches original", async () => {
  const store = await makeStore();
  const rec = await store.append(makeInput({ tenantId: "specific-tenant" }));
  const fetched = await store.getRecord(rec.id);
  eq(fetched!.tenantId, "specific-tenant");
});

// ─── Multi-tenant ─────────────────────────────────────────────────────────────

test("two tenants accumulate independent chains with correct prevHash links", async () => {
  const store = await makeStore();
  const aR1 = await store.append(makeInput({ tenantId: "tenA", actionType: "a.1" }));
  const bR1 = await store.append(makeInput({ tenantId: "tenB", actionType: "b.1" }));
  const aR2 = await store.append(makeInput({ tenantId: "tenA", actionType: "a.2" }));
  const bR2 = await store.append(makeInput({ tenantId: "tenB", actionType: "b.2" }));

  // Each tenant's second record's prevHash must link to their own first record
  eq(aR1.prevHash, "genesis");
  eq(bR1.prevHash, "genesis");
  eq(aR2.prevHash, aR1.hash);
  eq(bR2.prevHash, bR1.hash);

  // Both chains intact
  eq(await store.verifyChain("tenA"), true);
  eq(await store.verifyChain("tenB"), true);
});

test("each tenant chain's seq starts at 0 (first record seq=0)", async () => {
  const pool = new InMemoryPool();
  const store = new PgAuditStore(pool);
  await store.init();

  await store.append({ id: "x1", tenantId: "T1", actionId: "a", actionType: "t", source: "s", outcome: "allowed", occurredAt: new Date().toISOString() });
  await store.append({ id: "x2", tenantId: "T2", actionId: "b", actionType: "t", source: "s", outcome: "allowed", occurredAt: new Date().toISOString() });

  // Verify seq via raw pool query
  const t1rows = await pool.query<Record<string, unknown>>(
    "SELECT * FROM audit_records WHERE tenant_id = $1 ORDER BY seq ASC",
    ["T1"],
  );
  const t2rows = await pool.query<Record<string, unknown>>(
    "SELECT * FROM audit_records WHERE tenant_id = $1 ORDER BY seq ASC",
    ["T2"],
  );

  eq(t1rows.rows[0].seq, 0);
  eq(t2rows.rows[0].seq, 0);

  // Add second record to T1 and verify seq=1
  await store.append({ id: "x3", tenantId: "T1", actionId: "c", actionType: "t", source: "s", outcome: "allowed", occurredAt: new Date().toISOString() });
  const t1after = await pool.query<Record<string, unknown>>(
    "SELECT * FROM audit_records WHERE tenant_id = $1 ORDER BY seq ASC",
    ["T1"],
  );
  eq(t1after.rows[1].seq, 1);
});
