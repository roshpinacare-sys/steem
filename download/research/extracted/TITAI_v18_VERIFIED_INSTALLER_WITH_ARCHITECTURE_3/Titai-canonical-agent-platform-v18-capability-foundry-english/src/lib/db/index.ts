import "server-only";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { sql, inArray, and, eq, lte } from "drizzle-orm";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as schema from "./schema";
import { openSQLite, type SQLiteClient, type SQLiteDriverName } from "./sqlite-client";
import { applyCanonicalMigrations } from "./migrations";

/**
 * Single better-sqlite3 connection cached on globalThis so Next dev HMR and
 * multiple route modules share one handle (avoids duplicate connections and
 * orphaned run loops). WAL keeps readers non-blocking while the runner writes.
 */

type DbClient = BetterSQLite3Database<typeof schema> & {
  $client: SQLiteClient;
};

const globalForDb = globalThis as unknown as {
  __titaiDb?: DbClient;
  __titaiDbBooted?: boolean;
};

function resolveDbPath(): string {
  const raw = process.env.DATABASE_PATH ?? "./data/titai.db";
  if (raw === ":memory:") return raw;
  return resolve(process.cwd(), raw);
}

function createDb(): DbClient {
  const dbPath = resolveDbPath();
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const sqlite = openSQLite(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  const client = drizzle(sqlite as never, { schema }) as unknown as DbClient;
  client.$client = sqlite;

  // Run migrations if the migrations folder exists (it's bundled at build time).
  const migrationsFolder = resolve(process.cwd(), "drizzle");
  if (existsSync(migrationsFolder)) {
    try {
      applyCanonicalMigrations({ client: sqlite, migrationsFolder });
    } catch (err) {
      console.error("[titai] migration failed:", err);
      throw err;
    }
  }
  return client;
}

let localDb: DbClient | undefined;

/**
 * Open SQLite only on the first real database operation. Next.js imports route
 * modules while collecting build metadata; eager connection creation made a
 * source build depend on an already-built native binding even though no query
 * was being executed. Runtime access still fails closed if the binding or
 * database is unavailable.
 */
export function getDb(): DbClient {
  if (globalForDb.__titaiDb) return globalForDb.__titaiDb;
  if (localDb) return localDb;
  localDb = createDb();
  globalForDb.__titaiDb = localDb;
  return localDb;
}

export function getSQLiteDriverName(): SQLiteDriverName {
  return getDb().$client.driverName;
}

export const db: DbClient = new Proxy({} as DbClient, {
  get(_target, property) {
    const client = getDb();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
  set(_target, property, value) {
    return Reflect.set(getDb(), property, value, getDb());
  },
  has(_target, property) {
    return property in getDb();
  },
  ownKeys() {
    return Reflect.ownKeys(getDb());
  },
  getOwnPropertyDescriptor(_target, property) {
    const descriptor = Object.getOwnPropertyDescriptor(getDb(), property);
    return descriptor ? { ...descriptor, configurable: true } : undefined;
  },
});

const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Expire approvals that sat pending past their TTL. Their parked runs (if any
 * were in-memory they're gone anyway) become 'interrupted'. Safe to call often.
 */
export function expireStaleApprovals(now = new Date()): number {
  const stale = db
    .select({ id: schema.approvals.id, runId: schema.approvals.runId })
    .from(schema.approvals)
    .where(
      and(
        eq(schema.approvals.status, "pending"),
        lte(schema.approvals.expiresAt, now),
      ),
    )
    .all();
  if (stale.length === 0) return 0;
  db.$client.transaction(() => {
    db.update(schema.approvals)
      .set({ status: "expired", resolvedAt: now, revision: sql`${schema.approvals.revision} + 1` })
      .where(inArray(schema.approvals.id, stale.map((s) => s.id)))
      .run();
    for (const item of stale) {
      const durable = db
        .select({ id: schema.durableJobs.id, version: schema.durableJobs.version })
        .from(schema.durableJobs)
        .where(eq(schema.durableJobs.id, `durable:${item.runId}`))
        .get();
      db.update(schema.runs)
        .set({
          status: durable ? "failed" : "interrupted",
          error: "approval_expired",
          finishedAt: now,
        })
        .where(and(eq(schema.runs.id, item.runId), eq(schema.runs.status, "awaiting_approval")))
        .run();
      if (durable) {
        db.update(schema.durableJobs)
          .set({ status: "failed", error: "approval_expired", updatedAt: now, version: durable.version + 1 })
          .where(eq(schema.durableJobs.id, durable.id))
          .run();
      }
    }
  }).immediate();
  return stale.length;
}

/**
 * On boot, any run left mid-flight by a crashed/restarted process is orphaned
 * (its in-memory loop is gone). Mark such runs 'interrupted' so the UI is honest.
 */
export function recoverOnBoot(): void {
  if (globalForDb.__titaiDbBooted) return;
  globalForDb.__titaiDbBooted = true;
  try {
    const stuck = db
      .select({ id: schema.runs.id, status: schema.runs.status, runnerMode: schema.runs.runnerMode })
      .from(schema.runs)
      .where(inArray(schema.runs.status, ["running", "awaiting_approval"]))
      .all();
    const legacyIds: string[] = [];
    let durablePreserved = 0;
    for (const run of stuck) {
      const durable = db
        .select({ id: schema.durableJobs.id })
        .from(schema.durableJobs)
        .where(eq(schema.durableJobs.id, `durable:${run.id}`))
        .get();
      if (durable || String(run.runnerMode).startsWith("durable_")) {
        durablePreserved += 1;
      } else {
        legacyIds.push(run.id);
      }
    }
    if (legacyIds.length > 0) {
      db.update(schema.runs)
        .set({ status: "interrupted", finishedAt: new Date() })
        .where(inArray(schema.runs.id, legacyIds))
        .run();
      console.log(`[titai] recovered ${legacyIds.length} legacy interrupted run(s) on boot`);
    }
    if (durablePreserved > 0) {
      console.log(`[titai] preserved ${durablePreserved} durable run(s) for lease-based recovery`);
    }
    const expired = expireStaleApprovals();
    if (expired > 0) {
      console.log(`[titai] expired ${expired} stale approval(s) on boot`);
    }
  } catch {
    // table may not exist yet on very first boot — safe to ignore
  }
}

export { schema, sql };
