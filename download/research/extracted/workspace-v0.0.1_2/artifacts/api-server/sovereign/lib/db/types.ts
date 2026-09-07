/**
 * lib/db/types.ts — pg.Pool-compatible interfaces.
 *
 * These types mirror the subset of the `pg` library API that TFA uses,
 * so that InMemoryDriver can substitute for a real PostgreSQL Pool
 * in tests and dev without requiring an external database.
 *
 * Only the methods TFA actually calls are modelled. The goal is not a
 * full pg shim but a Liskov-compatible swap.
 */

// ─── Result row ───────────────────────────────────────────────────────────────

export type Row = Record<string, unknown>;

export interface QueryResult<T extends Row = Row> {
  rows: T[];
  rowCount: number;
  /** Mirrors pg's fields array — names of the returned columns. */
  fields: Array<{ name: string }>;
  /** Mirrors pg's command tag, e.g. "SELECT", "INSERT 0 1". */
  command: string;
}

// ─── Query config (parameterized query) ──────────────────────────────────────

export interface QueryConfig {
  text: string;
  values?: unknown[];
}

// ─── Pool interface (subset of pg.Pool) ──────────────────────────────────────

export interface PoolClient {
  query<T extends Row = Row>(
    sql: string | QueryConfig,
    values?: unknown[]
  ): Promise<QueryResult<T>>;
  release(err?: Error): void;
}

export interface DbPool {
  query<T extends Row = Row>(
    sql: string | QueryConfig,
    values?: unknown[]
  ): Promise<QueryResult<T>>;
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
}

// ─── Table definition (for schema-first setup) ───────────────────────────────

export interface ColumnDef {
  name: string;
  type: "text" | "integer" | "bigint" | "boolean" | "jsonb" | "timestamptz" | "uuid";
  nullable?: boolean;
  primaryKey?: boolean;
  default?: unknown;
}

export interface TableDef {
  name: string;
  columns: ColumnDef[];
}

// ─── Transaction interface ────────────────────────────────────────────────────

/** A unit of work that can be committed or rolled back. */
export interface Transaction {
  query<T extends Row = Row>(
    sql: string | QueryConfig,
    values?: unknown[]
  ): Promise<QueryResult<T>>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}
