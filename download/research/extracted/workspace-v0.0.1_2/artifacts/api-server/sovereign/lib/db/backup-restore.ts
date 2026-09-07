/**
 * lib/db/backup-restore.ts — Backup / Restore drill for pg-stores.
 *
 * PURPOSE
 * -------
 * Dump all known TFA pg-store tables to a portable JSON snapshot,
 * and restore them into a fresh pool while preserving:
 *   • audit hash-chain integrity
 *   • audit cryptographic signatures
 *   • ledger balances and journal entries
 *   • escrow agreement state
 *   • track-record cache
 *
 * INVARIANTS
 * ----------
 * • Dump is JSON-safe (all BigInt values are already TEXT in pg).
 * • Load wipes existing table rows before insert (idempotent restore).
 * • Table order respects internal foreign-key dependencies.
 *
 * Zero external dependencies — node:fs only for CLI scripts.
 */

import type { DbPool, Row } from "./types.ts";

// ─── Known TFA tables (insert order: parents before children) ──────────────

const TABLES_INSERT_ORDER = [
  "audit_records",
  "ledger_accounts",
  "track_record_cache",
  "escrow_agreements",
  "ledger_transactions",
  "journal_entries",
];

const TABLES_DELETE_ORDER = [...TABLES_INSERT_ORDER].reverse();

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TableDump {
  columns: string[];
  rows: Row[];
}

export interface BackupDump {
  meta: {
    version: string;
    createdAt: string;
    tables: string[];
  };
  tables: Record<string, TableDump>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

async function tableExists(pool: DbPool, name: string): Promise<boolean> {
  try {
    const result = await pool.query(`SELECT * FROM ${name} LIMIT 0`);
    return result.command === "SELECT";
  } catch {
    return false;
  }
}

/** Build a single INSERT SQL from column names. */
function buildInsertSql(table: string, cols: string[]): string {
  const colList = cols.join(", ");
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  return `INSERT INTO ${table} (${colList}) VALUES (${placeholders})`;
}

// ─── dumpPgStores ────────────────────────────────────────────────────────────

/**
 * Snapshot every known TFA table from the given pool.
 * Returns a JSON-serializable BackupDump.
 *
 * Tables that do not yet exist are silently omitted.
 */
export async function dumpPgStores(pool: DbPool): Promise<BackupDump> {
  const tables: Record<string, TableDump> = {};
  const presentTables: string[] = [];

  for (const name of TABLES_INSERT_ORDER) {
    if (!(await tableExists(pool, name))) continue;
    const result = await pool.query<Row>(`SELECT * FROM ${name}`);
    if (result.rows.length === 0) {
      presentTables.push(name);
      tables[name] = { columns: result.fields.map((f) => f.name), rows: [] };
      continue;
    }
    const columns = result.fields.map((f) => f.name);
    const rows: Row[] = result.rows.map((row) => {
      const out: Row = {};
      for (const col of columns) {
        out[col] = row[col] ?? null;
      }
      return out;
    });
    presentTables.push(name);
    tables[name] = { columns, rows };
  }

  return {
    meta: {
      version: "tfa-backup-v1",
      createdAt: nowIso(),
      tables: presentTables,
    },
    tables,
  };
}

// ─── loadPgStores ────────────────────────────────────────────────────────────

/**
 * Restore a BackupDump into the given pool.
 *
 * Algorithm:
 *   1. For each known table: DELETE all existing rows.
 *   2. For each table in insert-order: INSERT dumped rows verbatim.
 *
 * The caller must ensure tables exist (call init() on each store first).
 * Missing tables in the dump are skipped.
 */
export async function loadPgStores(pool: DbPool, dump: BackupDump): Promise<void> {
  // Step 1: wipe existing rows in reverse dependency order
  for (const name of TABLES_DELETE_ORDER) {
    if (!dump.tables[name]) continue;
    if (!(await tableExists(pool, name))) continue;
    await pool.query(`DELETE FROM ${name}`);
  }

  // Step 2: insert dumped rows in dependency order
  for (const name of TABLES_INSERT_ORDER) {
    const td = dump.tables[name];
    if (!td || td.rows.length === 0) continue;
    if (!(await tableExists(pool, name))) continue;

    const sql = buildInsertSql(name, td.columns);
    for (const row of td.rows) {
      const values = td.columns.map((col) => row[col] ?? null);
      await pool.query(sql, values);
    }
  }
}
