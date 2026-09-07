import "../_flush.mjs";
/**
 * tests/ledger/drizzle-transition.test.ts — Transition / Migration test suite.
 */

import { test, assert, eq } from "../_harness.mjs";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import { DrizzlePaymentProvider, LedgerError } from "../../lib/ledger/drizzle-payment-provider.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import type { PaymentProvider, Account, LedgerTransaction } from "../../lib/ledger/types.ts";

// Helper to migrate a tenant's state from InMemoryLedger to DrizzlePaymentProvider
async function migrateTenant(
  src: InMemoryLedger,
  dest: DrizzlePaymentProvider,
  tenantId: string,
  pool: InMemoryPool
) {
  // Extract accounts from InMemoryLedger using public listAccounts
  const accounts = await src.listAccounts(tenantId);

  // Write accounts directly into target DB pool to preserve original IDs and details
  for (const acc of accounts) {
    await pool.query(
      `INSERT INTO tfa_ledger_accounts 
         (id, tenant_id, owner_id, type, name, balance_text, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [acc.id, acc.tenantId, acc.ownerId, acc.type, acc.name, acc.balance.toString(), acc.createdAt]
    );
  }

  // To migrate transactions, we need to list them for all migrated accounts.
  // We keep a set of transaction IDs to avoid duplicates.
  const seenTxIds = new Set<string>();
  for (const acc of accounts) {
    const txs = await src.getTransactions(tenantId, acc.id);
    for (const tx of txs) {
      if (seenTxIds.has(tx.id)) continue;
      seenTxIds.add(tx.id);

      // Verify tenantId safety during migration
      if (tx.tenantId !== tenantId) {
        throw new LedgerError("Tenant isolation violation during migration", "TENANT_VIOLATION");
      }

      await pool.query(
        `INSERT INTO tfa_ledger_transactions
           (id, tenant_id, kind, debit_account_id, credit_account_id, amount_text, memo, initiated_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          tx.id,
          tx.tenantId,
          tx.kind,
          tx.debitAccountId,
          tx.creditAccountId,
          tx.amount.toString(),
          tx.memo,
          tx.initiatedBy,
          tx.createdAt,
        ]
      );
    }
  }
}

// --- 1. Normal transition test ---
test("drizzle-transition: normal transition from InMemoryLedger preserves state & BigInt exactness", async () => {
  const src = new InMemoryLedger();
  const pool = new InMemoryPool();
  const dest = await DrizzlePaymentProvider.create(pool);

  const tenantId = "tenant-prod-1";

  // Setup state on InMemoryLedger
  const alice = await src.createAccount(tenantId, "alice-uid", "asset", "Alice Wallet");
  const bob = await src.createAccount(tenantId, "bob-uid", "asset", "Bob Wallet");

  // Perform some BigInt transactions
  const amountMint = 500000000000n; // Large BigInt μ¢
  const amountTransfer = 150000000000n;

  await src.guardMint(tenantId, alice.id, amountMint, "seed wallet", "admin");
  await src.transfer(tenantId, alice.id, bob.id, amountTransfer, "payment", "alice");

  // Validate pre-migration state on source
  const srcAlice = await src.getAccount(tenantId, alice.id);
  const srcBob = await src.getAccount(tenantId, bob.id);
  eq(srcAlice.balance, amountMint - amountTransfer, "src Alice balance correct");
  eq(srcBob.balance, amountTransfer, "src Bob balance correct");

  // Perform migration
  await migrateTenant(src, dest, tenantId, pool);

  // Validate migrated state on destination
  const destAlice = await dest.getAccount(tenantId, alice.id);
  const destBob = await dest.getAccount(tenantId, bob.id);

  eq(destAlice.balance, amountMint - amountTransfer, "migrated Alice balance matches exactly (BigInt)");
  eq(destBob.balance, amountTransfer, "migrated Bob balance matches exactly (BigInt)");

  // Validate transaction history on destination
  const destAliceTxs = await dest.getTransactions(tenantId, alice.id);
  eq(destAliceTxs.length, 2, "Alice has two transactions on destination");
  
  const mintTx = destAliceTxs.find((t) => t.kind === "mint");
  assert(mintTx !== undefined, "mint transaction exists");
  eq(mintTx!.amount, amountMint, "mint amount matches exactly");

  const transferTx = destAliceTxs.find((t) => t.kind === "transfer");
  assert(transferTx !== undefined, "transfer transaction exists");
  eq(transferTx!.amount, amountTransfer, "transfer amount matches exactly");
});

// --- 2. Edge case: tenant isolation and empty states ---
test("drizzle-transition: tenant isolation is strictly maintained during migration", async () => {
  const src = new InMemoryLedger();
  const pool = new InMemoryPool();
  const dest = await DrizzlePaymentProvider.create(pool);

  const tenant1 = "tenant-1";
  const tenant2 = "tenant-2";

  // Create accounts in both tenants on src
  const t1User = await src.createAccount(tenant1, "t1-user", "asset", "T1 Wallet");
  const t2User = await src.createAccount(tenant2, "t2-user", "asset", "T2 Wallet");

  await src.guardMint(tenant1, t1User.id, 1000n, "mint t1", "admin");
  await src.guardMint(tenant2, t2User.id, 2000n, "mint t2", "admin");

  // Migrate ONLY tenant-1
  await migrateTenant(src, dest, tenant1, pool);

  // dest must have tenant-1's account
  const destT1User = await dest.getAccount(tenant1, t1User.id);
  eq(destT1User.balance, 1000n, "tenant-1 state successfully migrated");

  // dest must NOT have tenant-2's account (should throw ACCOUNT_NOT_FOUND)
  let threw = false;
  try {
    await dest.getAccount(tenant2, t2User.id);
  } catch (e: any) {
    threw = true;
    eq(e.code, "ACCOUNT_NOT_FOUND", "tenant-2 account is not in dest yet");
  }
  assert(threw, "tenant-2 account lookup should fail before migration");

  // Cross-tenant lookup must fail (tenant isolation violation)
  let violationThrew = false;
  try {
    await dest.getAccount(tenant2, t1User.id); // looking up t1User with tenant2 ID
  } catch (e: any) {
    violationThrew = true;
    eq(e.code, "TENANT_VIOLATION", "tenant isolation violation thrown");
  }
  assert(violationThrew, "cross-tenant account lookup throws TENANT_VIOLATION");
});

// --- 3. Error Case: database pool error / invalid inputs ---
test("drizzle-transition: database pool error and invalid inputs are handled safely", async () => {
  const src = new InMemoryLedger();
  const badPool = {
    query: async () => {
      throw new Error("Database connection lost");
    },
    connect: async () => {
      throw new Error("Database connection lost");
    },
    end: async () => {},
  } as any;

  const dest = new DrizzlePaymentProvider(badPool);
  // Do not call dest.init() since badPool will throw

  const tenantId = "tenant-err";
  const alice = await src.createAccount(tenantId, "alice-err", "asset", "Alice");

  let migrationThrew = false;
  try {
    await migrateTenant(src, dest, tenantId, badPool);
  } catch (e: any) {
    migrationThrew = true;
    assert(e.message.includes("Database connection lost"), "correct error thrown on DB pool failure");
  }
  assert(migrationThrew, "migration fails gracefully when pool throws");

  // Verify invalid inputs throw on destination
  const pool = new InMemoryPool();
  const goodDest = await DrizzlePaymentProvider.create(pool);
  const acc = await goodDest.createAccount(tenantId, "user-ok", "asset", "Wallet");

  let invalidAmtThrew = false;
  try {
    await goodDest.guardMint(tenantId, acc.id, -100n, "negative", "system");
  } catch (e: any) {
    invalidAmtThrew = true;
    eq(e.code, "INVALID_AMOUNT", "negative amount mint throws LedgerError");
  }
  assert(invalidAmtThrew, "negative mint amount is rejected");
});
