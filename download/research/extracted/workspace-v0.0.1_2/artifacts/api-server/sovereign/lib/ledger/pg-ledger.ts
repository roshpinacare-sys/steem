/**
 * lib/ledger/pg-ledger.ts — PgLedgerStore: PostgreSQL-backed PaymentProvider.
 *
 * PURPOSE
 * -------
 * Production-grade ledger persistence. Uses DbPool (lib/db/types.ts) so it
 * works identically with:
 *   • InMemoryPool   — tests / local dev (no external Postgres required)
 *   • pg.Pool        — production (swap in at DI / composition root)
 *
 * INVARIANTS (same as InMemoryLedger)
 * -----------------------------------
 * • All monetary values in μ¢ BigInt. Stored as TEXT in Postgres to avoid
 *   any precision loss (real BIGINT tops out at ~9e18; TEXT is unbounded).
 * • Every financial operation writes exactly two journal entries summing to 0.
 * • guardMint / guardWithdraw are the ONLY chokepoints for credit creation/destruction.
 * • Tenant isolation on every query — cross-tenant access throws LedgerError.
 * • Insufficient funds → throw LedgerError (fail-closed).
 * • Invalid input → throw LedgerError.
 *
 * MULTI-PROCESS NOTES
 * -------------------
 * InMemoryPool is single-process (JS single-threaded, no races).
 * Real pg.Pool in multi-process deployments: wrap mutations in a
 * transaction with SELECT … FOR UPDATE on affected account rows.
 * That SQL is left as comments below — InMemoryPool does not support FOR UPDATE.
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

// ─── Error type (shared with in-memory-ledger.ts) ─────────────────────────────

export class LedgerError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}

// ─── DDL ──────────────────────────────────────────────────────────────────────

const CREATE_ACCOUNTS_TABLE = `
  CREATE TABLE ledger_accounts (
    id          TEXT,
    tenant_id   TEXT,
    owner_id    TEXT,
    type        TEXT,
    name        TEXT,
    balance_text TEXT,
    created_at  TEXT
  )
`;

const CREATE_TRANSACTIONS_TABLE = `
  CREATE TABLE ledger_transactions (
    id               TEXT,
    tenant_id        TEXT,
    kind             TEXT,
    debit_account_id TEXT,
    credit_account_id TEXT,
    amount_text      TEXT,
    memo             TEXT,
    initiated_by     TEXT,
    created_at       TEXT
  )
`;

const CREATE_JOURNAL_ENTRIES_TABLE = `
  CREATE TABLE journal_entries (
    id             TEXT,
    tenant_id      TEXT,
    transaction_id TEXT,
    account_id     TEXT,
    type           TEXT,
    amount_text    TEXT,
    memo           TEXT,
    created_at     TEXT
  )
`;

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

function rowToJournalEntry(row: Record<string, unknown>): JournalEntry {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    transactionId: row.transaction_id as string,
    accountId: row.account_id as string,
    type: row.type as EntryType,
    amount: sToB(row.amount_text),
    memo: row.memo as string,
    createdAt: row.created_at as string,
  };
}

// ─── PgLedgerStore ────────────────────────────────────────────────────────────

/**
 * PgLedgerStore — implements PaymentProvider on top of a DbPool.
 *
 * Call init() once before first use to ensure tables exist.
 */
export class PgLedgerStore implements PaymentProvider {
  private readonly pool: DbPool;
  private initialised = false;

  constructor(pool: DbPool) {
    this.pool = pool;
  }

  // ── init ──────────────────────────────────────────────────────────────────

  /** Create tables if they do not already exist. Idempotent. */
  async init(): Promise<void> {
    if (this.initialised) return;
    const ddl = [
      CREATE_ACCOUNTS_TABLE,
      CREATE_TRANSACTIONS_TABLE,
      CREATE_JOURNAL_ENTRIES_TABLE,
    ];
    for (const sql of ddl) {
      try {
        await this.pool.query(sql);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("already exists")) throw err;
      }
    }
    this.initialised = true;
  }

  // ── Tenant isolation helpers ──────────────────────────────────────────────

  private async getAccountOrThrow(
    tenantId: string,
    accountId: string,
  ): Promise<Account> {
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT * FROM ledger_accounts WHERE id = $1 LIMIT 1",
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

  // ── Reserve account (lazy, per tenant) ────────────────────────────────────

  private async ensureReserve(tenantId: string): Promise<string> {
    const existing = await this.pool.query<Record<string, unknown>>(
      "SELECT id FROM ledger_accounts WHERE tenant_id = $1 AND owner_id = $2 AND type = $3 LIMIT 1",
      [tenantId, "system", "equity"],
    );
    if (existing.rows.length > 0) {
      return existing.rows[0].id as string;
    }

    const id = newId();
    await this.pool.query(
      `INSERT INTO ledger_accounts
         (id, tenant_id, owner_id, type, name, balance_text, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, tenantId, "system", "equity", "Platform Reserve", bToS(0n), now()],
    );
    return id;
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
      "UPDATE ledger_accounts SET balance_text = $1 WHERE id = $2",
      [bToS(await this.getBalance(debitAccountId) - amount), debitAccountId],
    );
    await this.pool.query(
      "UPDATE ledger_accounts SET balance_text = $1 WHERE id = $2",
      [bToS(await this.getBalance(creditAccountId) + amount), creditAccountId],
    );

    // Insert journal entries
    await this.pool.query(
      `INSERT INTO journal_entries
         (id, tenant_id, transaction_id, account_id, type, amount_text, memo, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [newId(), tenantId, txId, debitAccountId, "debit", bToS(amount), memo, ts],
    );
    await this.pool.query(
      `INSERT INTO journal_entries
         (id, tenant_id, transaction_id, account_id, type, amount_text, memo, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [newId(), tenantId, txId, creditAccountId, "credit", bToS(amount), memo, ts],
    );

    // Insert transaction record
    await this.pool.query(
      `INSERT INTO ledger_transactions
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

  private async getBalance(accountId: string): Promise<bigint> {
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT balance_text FROM ledger_accounts WHERE id = $1 LIMIT 1",
      [accountId],
    );
    if (result.rows.length === 0) return 0n;
    return sToB(result.rows[0].balance_text);
  }

  // ── PaymentProvider implementation ──────────────────────────────────────

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
      `INSERT INTO ledger_accounts
         (id, tenant_id, owner_id, type, name, balance_text, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, tenantId, ownerId, type, name, bToS(0n), ts],
    );

    return {
      id,
      tenantId,
      ownerId,
      type,
      name,
      balance: 0n,
      createdAt: ts,
    };
  }

  async getAccount(tenantId: string, accountId: string): Promise<Account> {
    guardNonEmpty(tenantId, "tenantId");
    guardNonEmpty(accountId, "accountId");
    const account = await this.getAccountOrThrow(tenantId, accountId);
    return { ...account, balance: account.balance };
  }

  async listAccounts(tenantId: string): Promise<Account[]> {
    guardNonEmpty(tenantId, "tenantId");
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT * FROM ledger_accounts WHERE tenant_id = $1",
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

    await this.getAccountOrThrow(tenantId, toAccountId);
    const reserveId = await this.ensureReserve(tenantId);

    return this.writeTransaction(
      tenantId,
      "mint",
      reserveId, // debit reserve
      toAccountId, // credit user
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
      fromAccountId, // debit user
      reserveId, // credit reserve
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
    const toAccount = await this.getAccountOrThrow(tenantId, toAccountId);

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
      `SELECT * FROM ledger_transactions
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
      "SELECT * FROM ledger_accounts WHERE tenant_id = $1 ORDER BY id ASC",
      [tenantId],
    );

    const accounts = result.rows.map(rowToAccount);

    let totalAssets = 0n;
    let totalLiabilities = 0n;

    // Single pass: build lines and accumulate totals.
    // The query already returns rows in id ASC order; no need to re-sort.
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
