import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { SQLiteClient } from "./sqlite-client";

export interface MigrationRecord {
  name: string;
  hash: string;
  appliedAt: number;
}

export interface MigrationResult {
  applied: MigrationRecord[];
  alreadyApplied: MigrationRecord[];
  bootstrapped: MigrationRecord[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function migrationFiles(folder: string): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort((a, b) => a.localeCompare(b));
}

function ensureMigrationTable(client: SQLiteClient): void {
  client.exec(`
    CREATE TABLE IF NOT EXISTS titai_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      hash TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
}

function priorDrizzleHashes(client: SQLiteClient): Set<string> {
  const table = client
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'")
    .get() as { name?: string } | undefined;
  if (!table) return new Set();
  const rows = client.prepare("SELECT hash FROM __drizzle_migrations").all() as Array<{ hash: string }>;
  return new Set(rows.map((row) => row.hash));
}

function trackedMigrations(client: SQLiteClient): Map<string, MigrationRecord> {
  const rows = client
    .prepare("SELECT name, hash, applied_at AS appliedAt FROM titai_migrations ORDER BY name")
    .all() as MigrationRecord[];
  return new Map(rows.map((row) => [row.name, row]));
}

function stripForeignKeyPragmas(sql: string): { sql: string; controlsForeignKeys: boolean } {
  const controlsForeignKeys = /PRAGMA\s+foreign_keys\s*=\s*(?:OFF|ON)\s*;/i.test(sql);
  return {
    controlsForeignKeys,
    sql: sql.replace(/PRAGMA\s+foreign_keys\s*=\s*(?:OFF|ON)\s*;/gi, ""),
  };
}

function insertRecord(client: SQLiteClient, record: MigrationRecord): void {
  client
    .prepare("INSERT INTO titai_migrations(name, hash, applied_at) VALUES (?, ?, ?)")
    .run(record.name, record.hash, record.appliedAt);
}

export function applyCanonicalMigrations(options: {
  client: SQLiteClient;
  migrationsFolder?: string;
  now?: () => number;
}): MigrationResult {
  const folder = resolve(options.migrationsFolder ?? join(process.cwd(), "drizzle"));
  const names = migrationFiles(folder);
  const result: MigrationResult = { applied: [], alreadyApplied: [], bootstrapped: [] };
  if (names.length === 0) return result;

  ensureMigrationTable(options.client);
  const legacyHashes = priorDrizzleHashes(options.client);
  let tracked = trackedMigrations(options.client);
  const now = options.now ?? Date.now;

  for (const name of names) {
    const source = readFileSync(join(folder, name), "utf8");
    const hash = sha256(source);
    const existing = tracked.get(name);
    if (existing) {
      if (existing.hash !== hash) {
        throw new Error(`migration_hash_drift:${name}`);
      }
      result.alreadyApplied.push(existing);
      continue;
    }

    const record = { name: basename(name), hash, appliedAt: now() };
    if (legacyHashes.has(hash)) {
      const adopt = options.client.transaction(() => insertRecord(options.client, record));
      adopt.immediate();
      result.bootstrapped.push(record);
      tracked.set(name, record);
      continue;
    }

    const prepared = stripForeignKeyPragmas(source);
    if (prepared.controlsForeignKeys) options.client.pragma("foreign_keys = OFF");
    try {
      const apply = options.client.transaction(() => {
        options.client.exec(prepared.sql);
        insertRecord(options.client, record);
      });
      apply.immediate();
    } finally {
      if (prepared.controlsForeignKeys) options.client.pragma("foreign_keys = ON");
    }
    result.applied.push(record);
    tracked.set(name, record);
  }

  return result;
}
