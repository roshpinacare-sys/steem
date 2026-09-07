/**
 * lib/ledger/drizzle-payment-provider.ts — DrizzlePaymentProvider.
 *
 * PURPOSE
 * -------
 * Production-grade PaymentProvider backed by a DbPool-compatible driver.
 * Designed for use with Drizzle + PostgreSQL: in production, adapt a real
 * Drizzle `db.$client` (pg.Pool) directly as the DbPool.
 *
 * WHY THIS EXISTS ALONGSIDE PgLedgerStore
 * ----------------------------------------
 * • Uses `CREATE TABLE IF NOT EXISTS` — truly idempotent DDL, no try/catch.
 * • Exposes a `static async create(pool)` factory for clean composition root injection.
 * • Provides a `DrizzleDbLike` interface so callers can adapt a real Drizzle db
 *   without importing drizzle-orm inside the zero-dependency sovereign folder.
 * • Intended as the composition root's production PaymentProvider.
 *
 * USAGE (production, inside api-server which has drizzle-orm installed)
 * ----------------------------------------------------------------------
 * ```ts
 * import { drizzle } from "drizzle-orm/node-postgres";
 * import { Pool } from "pg";
 * import { DrizzlePaymentProvider } from "./sovereign/lib/ledger/index.ts";
 * import { buildSovereignStack } from "./sovereign/src/composition.ts";
 *
 * const pgPool = new Pool({ connectionString: process.env.DATABASE_URL });
 * const provider = await DrizzlePaymentProvider.create(pgPool);
 * const stack = buildSovereignStack(defaultPolicies(), { provider });
 * ```
 *
 * USAGE (tests — zero external deps)
 * ------------------------------------
 * ```ts
 * import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
 * import { DrizzlePaymentProvider } from "../../lib/ledger/drizzle-payment-provider.ts";
 * const provider = await DrizzlePaymentProvider.create(new InMemoryPool());
 * ```
 *
 * INVARIANTS (same as InMemoryLedger)
 * ------------------------------------
 * • All monetary values in μ¢ BigInt. Stored as TEXT to avoid precision loss.
 * • Every financial operation writes exactly two journal entries summing to 0.
 * • guardMint / guardWithdraw are the ONLY chokepoints for credit creation/destruction.
 * • Tenant isolation on every query — cross-tenant access throws LedgerError.
 * • Insufficient funds → throw LedgerError (fail-closed, never silent underflow).
 * • Invalid input → throw LedgerError.
 */

import { createHash, randomBytes } from "node:crypto";
import type { DbPool } from "../db/types.ts";
import type {
  Account,
  AccountType,
  EntryType,
  JournalEntry,
  LedgerTransaction,
  MicroCents,
  PaymentProvider,
  SolvencyProof,
  TransactionKind,
} from "./types.ts";

// ─── Error (mirrors InMemoryLedger / PgLedgerStore) ──────────────────────────

export class LedgerError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}

// ─── DrizzleDbLike adapter interface ─────────────────────────────────────────

/**
 * A minimal adapter interface so callers with a real Drizzle db can plug in
 * without importing drizzle-orm inside the zero-dep sovereign folder.
 *
 * Production example — adapt a Drizzle db.$client (pg.Pool):
 *
 * ```ts
 * const drizzleDb = drizzle(pgPool, { schema });
 * const provider = await DrizzlePaymentProvider.create(drizzleDb.$client);
 * ```
 *
 * The $client is a pg.Pool, which already implements DbPool.
 */
export type DrizzleDbLike = DbPool;

// ─── DDL (IF NOT EXISTS — truly idempotent) ───────────────────────────────────

const DDL = [
  `CREATE TABLE IF NOT EXISTS tfa_ledger_accounts (
    id           TEXT NOT NULL,
    tenant_id    TEXT NOT NULL,
    owner_id     TEXT NOT NULL,
    type         TEXT NOT NULL,
    name         TEXT NOT NULL,
    balance_text TEXT NOT NULL,
    created_at   TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tfa_ledger_transactions (
    id                TEXT NOT NULL,
    tenant_id         TEXT NOT NULL,
    kind              TEXT NOT NULL,
    debit_account_id  TEXT NOT NULL,
    credit_account_id TEXT NOT NULL,
    amount_text       TEXT NOT NULL,
    memo              TEXT NOT NULL,
    initiated_by      TEXT NOT NULL,
    created_at        TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tfa_journal_entries (
    id             TEXT NOT NULL,
    tenant_id      TEXT NOT NULL,
    transaction_id TEXT NOT NULL,
    account_id     TEXT NOT NULL,
    type           TEXT NOT NULL,
    amount_text    TEXT NOT NULL,
    memo           TEXT NOT NULL,
    created_at     TEXT NOT NULL
  )`,
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function newId(): string {
  return randomBytes(16).toString("hex");
}

function now(): string {
  return new Date().toISOString();
}

function guardPositive(amount: MicroCents, label = "amount"): void {
  if (typeof amount !== "bigint") {
    throw new LedgerError(
      `${label} must be BigInt μ¢, got ${typeof amount}`,
      "INVALID_TYPE",
    );
  }
  if (amount <= 0n) {
    throw new LedgerError(
      `${label} must be positive μ¢, got ${amount}`,
      "INVALID_AMOUNT",
    );
  }
}

function guardNonEmpty(value: string, label: string): void {
  if (!value || !value.trim()) {
    throw new LedgerError(`${label} must not be empty`, "MISSING_FIELD");
  }
}

function bToS(v: bigint): string {
  return v.toString();
}

function sToB(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string") return BigInt(v);
  return 0n;
}

// ─── Row mappers ──────────────────────────────────────────────────────────────

function rowToAccount(row: Record<string, unknown>): Account {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    ownerId: row.owner_id as string,
    type: row.type as AccountType,
    name: row.name as string,
    balance: sToB(row.balance_text),
    createdAt: row.created_at as string,
  };
}

function rowToTransaction(row: Record<string, unknown>): LedgerTransaction {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    kind: row.kind as TransactionKind,
    debitAccountId: row.debit_account_id as string,
    creditAccountId: row.credit_account_id as string,
    amount: sToB(row.amount_text),
    memo: row.memo as string,
    initiatedBy: row.initiated_by as string,
    createdAt: row.created_at as string,
  };
}

// ─── DrizzlePaymentProvider ───────────────────────────────────────────────────

/**
 * DrizzlePaymentProvider — production PaymentProvider over DbPool / Drizzle.
 *
 * Call `DrizzlePaymentProvider.create(pool)` — it runs init() and returns a
 * ready provider. Do not call `new DrizzlePaymentProvider(pool)` directly
 * unless you intend to call `init()` yourself.
 */
export class DrizzlePaymentProvider implements PaymentProvider {
  private readonly pool: DrizzleDbLike;
  private initialised = false;

  constructor(pool: DrizzleDbLike) {
    this.pool = pool;
  }

  /**
   * Factory: create and initialise a DrizzlePaymentProvider in one call.
   * Idempotent — safe to call on every server start.
   */
  static async create(pool: DrizzleDbLike): Promise<DrizzlePaymentProvider> {
    const p = new DrizzlePaymentProvider(pool);
    await p.init();
    return p;
  }

  // ── DDL (idempotent) ──────────────────────────────────────────────────────

  /** Create tables if they do not already exist. Idempotent — safe to call multiple times. */
  async init(): Promise<void> {
    if (this.initialised) return;
    for (const sql of DDL) {
      await this.pool.query(sql);
    }
    this.initialised = true;
  }

  // ── Tenant isolation ──────────────────────────────────────────────────────

  private async getAccountOrThrow(
    tenantId: string,
    accountId: string,
  ): Promise<Account> {
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT * FROM tfa_ledger_accounts WHERE id = $1 LIMIT 1",
      [accountId],
    );
    if (result.rows.length === 0) {
      throw new LedgerError(
        `Account not found: ${accountId}`,
        "ACCOUNT_NOT_FOUND",
      );
    }
    const acc = rowToAccount(result.rows[0]);
    if (acc.tenantId !== tenantId) {
      throw new LedgerError(
        `Tenant isolation violation: account ${acc.id} belongs to tenant ${acc.tenantId}, not ${tenantId}`,
        "TENANT_VIOLATION",
      );
    }
    return acc;
  }

  // ── Reserve account (lazy, per tenant) ───────────────────────────────────

  private async ensureReserve(tenantId: string): Promise<string> {
    const existing = await this.pool.query<Record<string, unknown>>(
      "SELECT id FROM tfa_ledger_accounts WHERE tenant_id = $1 AND owner_id = $2 AND type = $3 LIMIT 1",
      [tenantId, "system", "equity"],
    );
    if (existing.rows.length > 0) {
      return existing.rows[0].id as string;
    }
    const id = newId();
    await this.pool.query(
      `INSERT INTO tfa_ledger_accounts
         (id, tenant_id, owner_id, type, name, balance_text, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, tenantId, "system", "equity", "Platform Reserve", bToS(0n), now()],
    );
    return id;
  }

  // ── Balance helper ────────────────────────────────────────────────────────

  private async getBalance(accountId: string): Promise<bigint> {
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT balance_text FROM tfa_ledger_accounts WHERE id = $1 LIMIT 1",
      [accountId],
    );
    if (result.rows.length === 0) return 0n;
    return sToB(result.rows[0].balance_text);
  }

  // ── Double-entry writer ───────────────────────────────────────────────────

  private async writeTransaction(
    tenantId: string,
    kind: TransactionKind,
    debitAccountId: string,
    creditAccountId: string,
    amount: MicroCents,
    memo: string,
    initiatedBy: string,
  ): Promise<LedgerTransaction> {
    const txId = newId();
    const ts = now();

    // Update balances
    await this.pool.query(
      "UPDATE tfa_ledger_accounts SET balance_text = $1 WHERE id = $2",
      [bToS((await this.getBalance(debitAccountId)) - amount), debitAccountId],
    );
    await this.pool.query(
      "UPDATE tfa_ledger_accounts SET balance_text = $1 WHERE id = $2",
      [bToS((await this.getBalance(creditAccountId)) + amount), creditAccountId],
    );

    // Write journal entries (double-entry)
    await this.pool.query(
      `INSERT INTO tfa_journal_entries
         (id, tenant_id, transaction_id, account_id, type, amount_text, memo, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [newId(), tenantId, txId, debitAccountId, "debit", bToS(amount), memo, ts],
    );
    await this.pool.query(
      `INSERT INTO tfa_journal_entries
         (id, tenant_id, transaction_id, account_id, type, amount_text, memo, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [newId(), tenantId, txId, creditAccountId, "credit", bToS(amount), memo, ts],
    );

    // Write transaction record
    await this.pool.query(
      `INSERT INTO tfa_ledger_transactions
         (id, tenant_id, kind, debit_account_id, credit_account_id, amount_text, memo, initiated_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [txId, tenantId, kind, debitAccountId, creditAccountId, bToS(amount), memo, initiatedBy, ts],
    );

    return {
      id: txId,
      tenantId,
      kind,
      debitAccountId,
      creditAccountId,
      amount,
      memo,
      initiatedBy,
      createdAt: ts,
    };
  }

  // ── PaymentProvider implementation ────────────────────────────────────────

  async createAccount(
    tenantId: string,
    ownerId: string,
    type: AccountType,
    name: string,
  ): Promise<Account> {
    guardNonEmpty(tenantId, "tenantId");
    guardNonEmpty(ownerId, "ownerId");
    guardNonEmpty(name, "name");

    const id = newId();
    const ts = now();
    await this.pool.query(
      `INSERT INTO tfa_ledger_accounts
         (id, tenant_id, owner_id, type, name, balance_text, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, tenantId, ownerId, type, name, bToS(0n), ts],
    );
    return { id, tenantId, ownerId, type, name, balance: 0n, createdAt: ts };
  }

  async getAccount(tenantId: string, accountId: string): Promise<Account> {
    guardNonEmpty(tenantId, "tenantId");
    guardNonEmpty(accountId, "accountId");
    return this.getAccountOrThrow(tenantId, accountId);
  }

  async listAccounts(tenantId: string): Promise<Account[]> {
    guardNonEmpty(tenantId, "tenantId");
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT * FROM tfa_ledger_accounts WHERE tenant_id = $1",
      [tenantId],
    );
    return result.rows.map(rowToAccount);
  }

  async guardMint(
    tenantId: string,
    toAccountId: string,
    amount: MicroCents,
    memo: string,
    initiatedBy: string,
  ): Promise<LedgerTransaction> {
    guardNonEmpty(tenantId, "tenantId");
    guardNonEmpty(toAccountId, "toAccountId");
    guardPositive(amount, "amount");
    guardNonEmpty(memo, "memo");
    guardNonEmpty(initiatedBy, "initiatedBy");

    // Verify account exists and belongs to tenant before touching reserve
    await this.getAccountOrThrow(tenantId, toAccountId);
    const reserveId = await this.ensureReserve(tenantId);

    return this.writeTransaction(
      tenantId,
      "mint",
      reserveId,    // debit reserve (reserve gives out credits)
      toAccountId,  // credit user account
      amount,
      memo,
      initiatedBy,
    );
  }

  async guardWithdraw(
    tenantId: string,
    fromAccountId: string,
    amount: MicroCents,
    memo: string,
    initiatedBy: string,
  ): Promise<LedgerTransaction> {
    guardNonEmpty(tenantId, "tenantId");
    guardNonEmpty(fromAccountId, "fromAccountId");
    guardPositive(amount, "amount");
    guardNonEmpty(memo, "memo");
    guardNonEmpty(initiatedBy, "initiatedBy");

    const fromAccount = await this.getAccountOrThrow(tenantId, fromAccountId);

    // Fail-closed: insufficient funds
    if (fromAccount.balance < amount) {
      throw new LedgerError(
        `Insufficient funds: account ${fromAccountId} has ${fromAccount.balance} μ¢, requested ${amount} μ¢`,
        "INSUFFICIENT_FUNDS",
      );
    }

    const reserveId = await this.ensureReserve(tenantId);

    return this.writeTransaction(
      tenantId,
      "withdraw",
      fromAccountId, // debit user account
      reserveId,     // credit reserve
      amount,
      memo,
      initiatedBy,
    );
  }

  async transfer(
    tenantId: string,
    fromAccountId: string,
    toAccountId: string,
    amount: MicroCents,
    memo: string,
    initiatedBy: string,
  ): Promise<LedgerTransaction> {
    guardNonEmpty(tenantId, "tenantId");
    guardNonEmpty(fromAccountId, "fromAccountId");
    guardNonEmpty(toAccountId, "toAccountId");
    guardPositive(amount, "amount");
    guardNonEmpty(memo, "memo");
    guardNonEmpty(initiatedBy, "initiatedBy");

    if (fromAccountId === toAccountId) {
      throw new LedgerError(
        "Cannot transfer to the same account",
        "SELF_TRANSFER",
      );
    }

    const fromAccount = await this.getAccountOrThrow(tenantId, fromAccountId);
    // Also verifies toAccount tenant isolation
    await this.getAccountOrThrow(tenantId, toAccountId);

    if (fromAccount.balance < amount) {
      throw new LedgerError(
        `Insufficient funds: account ${fromAccountId} has ${fromAccount.balance} μ¢, requested ${amount} μ¢`,
        "INSUFFICIENT_FUNDS",
      );
    }

    return this.writeTransaction(
      tenantId,
      "transfer",
      fromAccountId,
      toAccountId,
      amount,
      memo,
      initiatedBy,
    );
  }

  async getTransactions(
    tenantId: string,
    accountId: string,
  ): Promise<LedgerTransaction[]> {
    guardNonEmpty(tenantId, "tenantId");
    guardNonEmpty(accountId, "accountId");

    // Verify tenant isolation
    await this.getAccountOrThrow(tenantId, accountId);

    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM tfa_ledger_transactions
       WHERE tenant_id = $1
         AND (debit_account_id = $2 OR credit_account_id = $2)
       ORDER BY created_at ASC`,
      [tenantId, accountId],
    );
    return result.rows.map(rowToTransaction);
  }

  async proofOfSolvency(tenantId: string): Promise<SolvencyProof> {
    guardNonEmpty(tenantId, "tenantId");

    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT * FROM tfa_ledger_accounts WHERE tenant_id = $1 ORDER BY id ASC",
      [tenantId],
    );

    const accounts = result.rows.map(rowToAccount);

    let totalAssets = 0n;
    let totalLiabilities = 0n;

    // Single pass: build lines and accumulate totals.
    // The query already returns rows in id ASC order; no need to copy + re-sort.
    const balanceLines: string[] = [];
    for (const acc of accounts) {
      balanceLines.push(`${acc.id}:${acc.type}:${acc.balance}`);
      if (acc.type === "asset") totalAssets += acc.balance;
      else if (acc.type === "liability") totalLiabilities += acc.balance;
    }

    const netEquity = totalAssets - totalLiabilities;
    const isSolvent = netEquity >= 0n;

    const balanceHash = createHash("sha256")
      .update(balanceLines.join("\n"))
      .digest("hex");

    return {
      tenantId,
      generatedAt: now(),
      totalAssets,
      totalLiabilities,
      netEquity,
      accountCount: accounts.length,
      balanceHash,
      isSolvent,
    };
  }
}
