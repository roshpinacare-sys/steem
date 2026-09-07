/**
 * lib/db/index.ts — barrel export.
 *
 * Usage:
 *   import { InMemoryPool } from "../db/index.js";
 *   import type { DbPool, QueryResult, Row } from "../db/index.js";
 */
export type { Row, QueryResult, QueryConfig, DbPool, PoolClient, TableDef, ColumnDef, Transaction } from "./types.ts";
export { InMemoryPool } from "./in-memory-driver.ts";
