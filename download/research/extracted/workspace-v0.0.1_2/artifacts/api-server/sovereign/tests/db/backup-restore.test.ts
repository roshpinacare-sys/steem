import "../_flush.mjs";
/**
 * tests/db/backup-restore.test.ts — Backup/Restore drill.
 *
 * Purpose: verify that a full dump of all pg-stores, when loaded into a fresh
 * pool, preserves:
 *   • audit hash-chain links
 *   • audit cryptographic signatures
 *   • ledger balances + journal entries
 *   • escrow agreement state
 *   • track-record cache
 *
 * This is the "trust survives migration" invariant.
 */

import { test, assert, eq } from "../_harness.mjs";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import { dumpPgStores, loadPgStores } from "../../lib/db/backup-restore.ts";
import { PgAuditStore } from "../../lib/orchestrator/pg-audit.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { PgLedgerStore } from "../../lib/ledger/pg-ledger.ts";
import { PgEscrowStore } from "../../lib/escrow/pg-escrow-store.ts";
import { PgTrackRecordCache } from "../../lib/track-record/pg-track-record-cache.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAuditInput(overrides: Record<string, unknown> = {}) {
  const ts = new Date().toISOString();
  return {
    id: `audit-${Math.random().toString(36).slice(2)}`,
    tenantId: "tenant-alpha",
    actionId: `action-${Math.random().toString(36).slice(2)}`,
    actionType: "agent.task.run",
    source: "test-agent",
    outcome: "allowed" as const,
    occurredAt: ts,
    ...overrides,
  };
}

async function seedAuditChain(store: PgAuditStore): Promise<void> {
  await store.append(makeAuditInput({ actionType: "step.1", actionId: "a1" }));
  await store.append(makeAuditInput({ actionType: "step.2", actionId: "a2" }));
  await store.append(makeAuditInput({ actionType: "step.3", actionId: "a3" }));
}

async function seedLedger(store: PgLedgerStore): Promise<void> {
  const acc1 = await store.createAccount("tenant-alpha", "owner-1", "asset", "Wallet A");
  const acc2 = await store.createAccount("tenant-alpha", "owner-2", "asset", "Wallet B");
  await store.guardMint("tenant-alpha", acc1.id, 5000n, "mint-1", "system");
  await store.transfer("tenant-alpha", acc1.id, acc2.id, 2000n, "pay-b", "system");
}

async function seedEscrow(store: PgEscrowStore): Promise<void> {
  const agreement = {
    id: "esc-001",
    tenantId: "tenant-alpha",
    opportunityId: "opp-1",
    payerAccountId: "payer-1",
    workerAccountId: "worker-1",
    escrowAccountId: "escrow-1",
    amount: 3000n,
    state: "funded" as const,
    createdAt: new Date().toISOString(),
    fundAuditId: "audit-fund-1",
    fundedBy: "funder-1",
  };
  await store.put(agreement);
}

async function seedTrackRecord(store: PgTrackRecordCache): Promise<void> {
  await store.set("tenant-alpha", "identity-1", {
    tenantId: "tenant-alpha",
    identityId: "identity-1",
    settledAsWorker: 5,
    settledAsFunder: 3,
    refunded: 1,
    denied: 0,
    settledVolume: "15000",
    score: 87,
    explanation: ["consistent delivery", "fast settlement"],
    computedAt: new Date().toISOString(),
  });
}

async function initAll(pool: InMemoryPool, signer?: HmacSigner) {
  const audit = new PgAuditStore(pool, signer);
  const ledger = new PgLedgerStore(pool);
  const escrow = new PgEscrowStore(pool);
  const track = new PgTrackRecordCache(pool);
  await audit.init();
  await ledger.init();
  await escrow.init();
  await track.init();
  return { audit, ledger, escrow, track };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test("dump produces expected meta and table list", async () => {
  const pool = new InMemoryPool();
  const { audit } = await initAll(pool);
  await seedAuditChain(audit);

  const dump = await dumpPgStores(pool);
  eq(dump.meta.version, "tfa-backup-v1");
  assert(dump.meta.createdAt, "meta.createdAt should be present");
  assert(dump.meta.tables.includes("audit_records"), "should include audit_records");
  assert(dump.tables.audit_records.rows.length >= 3, "should have audit rows");
});

test("dump includes ledger, escrow, and track_record tables", async () => {
  const pool = new InMemoryPool();
  const { audit, ledger, escrow, track } = await initAll(pool);
  await seedAuditChain(audit);
  await seedLedger(ledger);
  await seedEscrow(escrow);
  await seedTrackRecord(track);

  const dump = await dumpPgStores(pool);
  assert(dump.meta.tables.includes("ledger_accounts"), "ledger_accounts");
  assert(dump.meta.tables.includes("ledger_transactions"), "ledger_transactions");
  assert(dump.meta.tables.includes("journal_entries"), "journal_entries");
  assert(dump.meta.tables.includes("escrow_agreements"), "escrow_agreements");
  assert(dump.meta.tables.includes("track_record_cache"), "track_record_cache");
});

test("load restores audit records with correct hash chain", async () => {
  const poolA = new InMemoryPool();
  const { audit: auditA } = await initAll(poolA);
  await seedAuditChain(auditA);

  const dump = await dumpPgStores(poolA);

  const poolB = new InMemoryPool();
  const { audit: auditB } = await initAll(poolB);
  await loadPgStores(poolB, dump);

  const chain = await auditB.getChain("tenant-alpha");
  eq(chain.length, 3, "chain should have 3 records after restore");

  // Verify prevHash links
  eq(chain[0].prevHash, "genesis");
  eq(chain[1].prevHash, chain[0].hash);
  eq(chain[2].prevHash, chain[1].hash);

  // Verify hashes recompute correctly
  const ok = await auditB.verifyChain("tenant-alpha");
  eq(ok, true, "verifyChain should pass after restore");
});

test("load restores audit signatures and they verify with same signer", async () => {
  const secret = "backup-restore-test-secret-key-32b!";
  const signer = new HmacSigner(secret);

  const poolA = new InMemoryPool();
  const { audit: auditA } = await initAll(poolA, signer);
  await seedAuditChain(auditA);

  const dump = await dumpPgStores(poolA);

  const poolB = new InMemoryPool();
  const { audit: auditB } = await initAll(poolB, signer);
  await loadPgStores(poolB, dump);

  const ok = await auditB.verifyChain("tenant-alpha");
  eq(ok, true, "signature verification should pass after restore with same signer");
});

test("load restores ledger accounts and balances", async () => {
  const poolA = new InMemoryPool();
  const { audit: auditA, ledger: ledgerA } = await initAll(poolA);
  await seedAuditChain(auditA);
  await seedLedger(ledgerA);

  const dump = await dumpPgStores(poolA);

  const poolB = new InMemoryPool();
  const { audit: auditB, ledger: ledgerB } = await initAll(poolB);
  await loadPgStores(poolB, dump);

  const accounts = await ledgerB.listAccounts("tenant-alpha");
  // 3 accounts: Wallet A, Wallet B, Platform Reserve
  eq(accounts.length, 3, "should restore 3 accounts");

  const walletA = accounts.find((a) => a.name === "Wallet A");
  const walletB = accounts.find((a) => a.name === "Wallet B");
  assert(walletA, "Wallet A should exist");
  assert(walletB, "Wallet B should exist");
  eq(walletA!.balance, 3000n, "Wallet A balance should be 5000 - 2000 = 3000");
  eq(walletB!.balance, 2000n, "Wallet B balance should be 2000");
});

test("load restores escrow agreement state", async () => {
  const poolA = new InMemoryPool();
  const { escrow: escrowA } = await initAll(poolA);
  await seedEscrow(escrowA);

  const dump = await dumpPgStores(poolA);

  const poolB = new InMemoryPool();
  const { escrow: escrowB } = await initAll(poolB);
  await loadPgStores(poolB, dump);

  const agreement = await escrowB.get("tenant-alpha", "esc-001");
  assert(agreement !== null, "escrow should exist after restore");
  eq(agreement!.state, "funded");
  eq(agreement!.amount, 3000n);
  eq(agreement!.fundAuditId, "audit-fund-1");
  eq(agreement!.fundedBy, "funder-1");
});

test("load restores track-record cache", async () => {
  const poolA = new InMemoryPool();
  const { track: trackA } = await initAll(poolA);
  await seedTrackRecord(trackA);

  const dump = await dumpPgStores(poolA);

  const poolB = new InMemoryPool();
  const { track: trackB } = await initAll(poolB);
  await loadPgStores(poolB, dump);

  const rec = await trackB.get("tenant-alpha", "identity-1");
  assert(rec !== null, "track record should exist after restore");
  eq(rec!.score, 87);
  eq(rec!.settledAsWorker, 5);
  eq(rec!.settledVolume, "15000");
});

test("restore into non-empty pool overwrites previous data", async () => {
  const poolA = new InMemoryPool();
  const { audit: auditA } = await initAll(poolA);
  await seedAuditChain(auditA);
  const dump = await dumpPgStores(poolA);

  const poolB = new InMemoryPool();
  const { audit: auditB } = await initAll(poolB);
  await auditB.append(makeAuditInput({ actionType: "old.1", actionId: "old1" }));

  // Before load: 1 record
  eq((await auditB.getChain("tenant-alpha")).length, 1);

  await loadPgStores(poolB, dump);

  // After load: 3 records (overwritten)
  eq((await auditB.getChain("tenant-alpha")).length, 3);
});

test("verifyChain fails when dump is tampered before restore", async () => {
  const secret = "tamper-test-secret-key-32bytes!!";
  const signer = new HmacSigner(secret);

  const poolA = new InMemoryPool();
  const { audit: auditA } = await initAll(poolA, signer);
  await seedAuditChain(auditA);

  const dump = await dumpPgStores(poolA);
  // Tamper a hash in the dump
  dump.tables.audit_records.rows[0].hash = "deadbeefcafebabe";

  const poolB = new InMemoryPool();
  const { audit: auditB } = await initAll(poolB, signer);
  await loadPgStores(poolB, dump);

  const ok = await auditB.verifyChain("tenant-alpha");
  eq(ok, false, "tampered chain should fail verification");
});

test("empty tables are included in dump with zero rows", async () => {
  const pool = new InMemoryPool();
  const { audit } = await initAll(pool);
  // No data inserted
  const dump = await dumpPgStores(pool);
  assert(dump.meta.tables.includes("audit_records"), "audit_records should be present");
  eq(dump.tables.audit_records.rows.length, 0, "audit_records should have 0 rows");
});

test("dump roundtrip: ledger transactions and journal entries match counts", async () => {
  const poolA = new InMemoryPool();
  const { ledger: ledgerA } = await initAll(poolA);
  await seedLedger(ledgerA);

  const dump = await dumpPgStores(poolA);

  const poolB = new InMemoryPool();
  const { ledger: ledgerB } = await initAll(poolB);
  await loadPgStores(poolB, dump);

  // 1 mint + 1 transfer = 2 transactions = 4 journal entries
  eq(dump.tables.ledger_transactions.rows.length, 2, "2 transactions");
  eq(dump.tables.journal_entries.rows.length, 4, "4 journal entries");

  const accounts = await ledgerB.listAccounts("tenant-alpha");
  const walletA = accounts.find((a) => a.name === "Wallet A");
  assert(walletA, "Wallet A should exist");
  const txs = await ledgerB.getTransactions("tenant-alpha", walletA!.id);
  eq(txs.length, 2, "Wallet A should have 2 transactions after restore (mint + transfer out)");
});
