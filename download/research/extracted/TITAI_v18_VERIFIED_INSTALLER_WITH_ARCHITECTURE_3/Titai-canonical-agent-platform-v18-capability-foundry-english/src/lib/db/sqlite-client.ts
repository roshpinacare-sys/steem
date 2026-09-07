import BetterSqlite3 from "better-sqlite3";
import { DatabaseSync, type StatementSync } from "node:sqlite";

export type SQLiteDriverName = "better-sqlite3" | "node:sqlite";

export interface SQLiteRunResult {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}

export interface SQLiteStatement {
  run(...params: unknown[]): SQLiteRunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  raw(): SQLiteStatement;
}

export interface SQLiteTransactionFunction<T> {
  (...args: unknown[]): T;
  deferred(...args: unknown[]): T;
  immediate(...args: unknown[]): T;
  exclusive(...args: unknown[]): T;
}

export interface SQLiteClient {
  readonly driverName: SQLiteDriverName;
  prepare(sql: string): SQLiteStatement;
  exec(sql: string): unknown;
  pragma(source: string): unknown;
  transaction<T>(fn: (...args: unknown[]) => T): SQLiteTransactionFunction<T>;
  close(): void;
}

class NodeSQLiteStatement implements SQLiteStatement {
  constructor(
    private readonly statement: StatementSync,
    private readonly returnArrays = false,
  ) {}

  private configure(): void {
    this.statement.setReturnArrays(this.returnArrays);
    this.statement.setAllowBareNamedParameters(true);
  }

  run(...params: unknown[]): SQLiteRunResult {
    this.configure();
    const result = this.statement.run(...params as never[]) as {
      changes: number | bigint;
      lastInsertRowid: number | bigint;
    };
    return result;
  }

  get(...params: unknown[]): unknown {
    this.configure();
    return this.statement.get(...params as never[]);
  }

  all(...params: unknown[]): unknown[] {
    this.configure();
    return this.statement.all(...params as never[]) as unknown[];
  }

  raw(): SQLiteStatement {
    return new NodeSQLiteStatement(this.statement, true);
  }
}

class NodeSQLiteClient implements SQLiteClient {
  readonly driverName = "node:sqlite" as const;
  private transactionDepth = 0;
  private savepointCounter = 0;

  constructor(private readonly database: DatabaseSync) {}

  prepare(sql: string): SQLiteStatement {
    return new NodeSQLiteStatement(this.database.prepare(sql));
  }

  exec(sql: string): void {
    this.database.exec(sql);
  }

  pragma(source: string): unknown {
    const normalized = source.trim().replace(/^PRAGMA\s+/i, "");
    if (normalized.includes("=")) {
      this.database.exec(`PRAGMA ${normalized}`);
      return undefined;
    }
    return this.database.prepare(`PRAGMA ${normalized}`).all();
  }

  transaction<T>(fn: (...args: unknown[]) => T): SQLiteTransactionFunction<T> {
    const invoke = (behavior: "DEFERRED" | "IMMEDIATE" | "EXCLUSIVE", args: unknown[]): T => {
      if (this.transactionDepth > 0) {
        const savepoint = `titai_sp_${++this.savepointCounter}`;
        this.database.exec(`SAVEPOINT ${savepoint}`);
        this.transactionDepth += 1;
        try {
          const result = fn(...args);
          this.database.exec(`RELEASE SAVEPOINT ${savepoint}`);
          return result;
        } catch (error) {
          this.database.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          this.database.exec(`RELEASE SAVEPOINT ${savepoint}`);
          throw error;
        } finally {
          this.transactionDepth -= 1;
        }
      }

      this.database.exec(`BEGIN ${behavior}`);
      this.transactionDepth = 1;
      try {
        const result = fn(...args);
        this.database.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          this.database.exec("ROLLBACK");
        } catch {
          // The original error remains authoritative.
        }
        throw error;
      } finally {
        this.transactionDepth = 0;
      }
    };

    const transaction = ((...args: unknown[]) => invoke("DEFERRED", args)) as SQLiteTransactionFunction<T>;
    transaction.deferred = (...args: unknown[]) => invoke("DEFERRED", args);
    transaction.immediate = (...args: unknown[]) => invoke("IMMEDIATE", args);
    transaction.exclusive = (...args: unknown[]) => invoke("EXCLUSIVE", args);
    return transaction;
  }

  close(): void {
    this.database.close();
  }
}

class BetterSQLiteClient implements SQLiteClient {
  readonly driverName = "better-sqlite3" as const;

  constructor(private readonly database: BetterSqlite3.Database) {}

  prepare(sql: string): SQLiteStatement {
    return this.database.prepare(sql) as unknown as SQLiteStatement;
  }

  exec(sql: string): unknown {
    return this.database.exec(sql);
  }

  pragma(source: string): unknown {
    return this.database.pragma(source);
  }

  transaction<T>(fn: (...args: unknown[]) => T): SQLiteTransactionFunction<T> {
    return this.database.transaction(fn) as unknown as SQLiteTransactionFunction<T>;
  }

  close(): void {
    this.database.close();
  }
}

export interface OpenSQLiteOptions {
  readonly?: boolean;
  fileMustExist?: boolean;
  driver?: "auto" | SQLiteDriverName;
}

function requestedDriver(options?: OpenSQLiteOptions): "auto" | SQLiteDriverName {
  const configured = options?.driver ?? process.env.TITAI_SQLITE_DRIVER ?? "auto";
  if (configured !== "auto" && configured !== "better-sqlite3" && configured !== "node:sqlite") {
    throw new Error(`unsupported_sqlite_driver:${configured}`);
  }
  return configured;
}

export function openSQLite(path: string, options: OpenSQLiteOptions = {}): SQLiteClient {
  const driver = requestedDriver(options);
  const errors: string[] = [];

  if (driver === "auto" || driver === "better-sqlite3") {
    try {
      const database = new BetterSqlite3(path, {
        readonly: options.readonly,
        fileMustExist: options.fileMustExist,
      });
      return new BetterSQLiteClient(database);
    } catch (error) {
      errors.push(`better-sqlite3:${error instanceof Error ? error.message : String(error)}`);
      if (driver === "better-sqlite3") {
        throw new Error(`sqlite_driver_open_failed:${errors.join("|")}`);
      }
    }
  }

  try {
    const database = new DatabaseSync(path, {
      readOnly: options.readonly,
      open: options.fileMustExist ? true : undefined,
    });
    return new NodeSQLiteClient(database);
  } catch (error) {
    errors.push(`node:sqlite:${error instanceof Error ? error.message : String(error)}`);
    throw new Error(`sqlite_driver_open_failed:${errors.join("|")}`);
  }
}
