import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createOfflineUpdate, applyOfflineUpdate, rollbackOfflineUpdate } from "../src/lib/sovereignty/offline-update";
import { generateSovereignSigningIdentity } from "../src/lib/sovereignty/key-hierarchy";
import { openSQLite } from "../src/lib/db/sqlite-client";
import { applyCanonicalMigrations } from "../src/lib/db/migrations";

const root = process.cwd();
const evidenceDir = resolve(root, "docs/canonical/evidence/v16/update-rehearsal");
mkdirSync(evidenceDir, { recursive: true });
const target = mkdtempSync(join(tmpdir(), "titai-v16-update-target-"));
const targetDrizzle = join(target, "drizzle");
mkdirSync(targetDrizzle, { recursive: true });
const databasePath = join(target, "data", "titai.db");
mkdirSync(join(target, "data"), { recursive: true });

try {
  writeFileSync(join(target, ".titai-version"), "2.0.0-canonical-v15-sovereignty\n");
  for (const name of readdirSync(resolve(root, "drizzle")).filter((name) => /^000[0-8]_.+\.sql$/.test(name)).sort()) {
    copyFileSync(resolve(root, "drizzle", name), join(targetDrizzle, name));
  }
  let sqlite = openSQLite(databasePath, { driver: "node:sqlite" });
  const before = applyCanonicalMigrations({ client: sqlite, migrationsFolder: targetDrizzle });
  sqlite.exec("CREATE TABLE IF NOT EXISTS v16_rehearsal_sentinel(id TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO v16_rehearsal_sentinel(id,value) VALUES ('sentinel','preserved');");
  sqlite.close();

  const migrationName = "0009_v16_operational_sovereignty.sql";
  const migrationBytes = readFileSync(resolve(root, "drizzle", migrationName));
  const signer = generateSovereignSigningIdentity(new Date("2026-07-11T15:00:00.000Z"));
  const update = createOfflineUpdate({
    fromVersion: "2.0.0-canonical-v15-sovereignty",
    toVersion: "2.1.0-canonical-v16-operational-sovereignty",
    files: [{ path: `drizzle/${migrationName}`, bytes: migrationBytes }],
    migrationFiles: [`drizzle/${migrationName}`],
    validationCommands: ["db:migrate", "v16:update:validate"],
    releaseEvidenceHashes: [],
    signer,
    now: new Date("2026-07-11T15:01:00.000Z"),
  });
  const applied = applyOfflineUpdate({
    update,
    publicKeyPem: signer.publicKeyPem,
    expectedKeyId: signer.keyId,
    targetDir: target,
    now: new Date("2026-07-11T15:02:00.000Z"),
    validate: (dir) => {
      const db = openSQLite(join(dir, "data", "titai.db"), { driver: "node:sqlite" });
      try {
        const migrationResult = applyCanonicalMigrations({ client: db, migrationsFolder: join(dir, "drizzle") });
        if (!migrationResult.applied.some((item) => item.name === migrationName)) throw new Error("v16_migration_not_applied");
        const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sovereign_nodes'").get() as { name?: string } | undefined;
        if (!table?.name) throw new Error("v16_schema_missing");
        const sentinel = db.prepare("SELECT value FROM v16_rehearsal_sentinel WHERE id='sentinel'").get() as { value?: string } | undefined;
        if (sentinel?.value !== "preserved") throw new Error("v15_data_not_preserved");
      } finally { db.close(); }
    },
  });

  sqlite = openSQLite(databasePath, { driver: "node:sqlite" });
  const afterTable = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sovereign_nodes'").get() as { name?: string } | undefined;
  const afterMigrations = sqlite.prepare("SELECT name FROM titai_migrations ORDER BY name").all() as Array<{ name: string }>;
  sqlite.close();
  if (!afterTable?.name) throw new Error("post_update_schema_missing");

  rollbackOfflineUpdate(applied);
  sqlite = openSQLite(databasePath, { driver: "node:sqlite" });
  const rolledBackTable = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sovereign_nodes'").get() as { name?: string } | undefined;
  const sentinel = sqlite.prepare("SELECT value FROM v16_rehearsal_sentinel WHERE id='sentinel'").get() as { value?: string } | undefined;
  sqlite.close();
  if (rolledBackTable?.name) throw new Error("rollback_schema_not_restored");
  if (sentinel?.value !== "preserved") throw new Error("rollback_data_not_restored");

  const evidence = {
    format: "titai-v16-offline-update-migration-rehearsal",
    version: 1,
    previousVersion: "2.0.0-canonical-v15-sovereignty",
    targetVersion: "2.1.0-canonical-v16-operational-sovereignty",
    beforeMigrations: before.applied.length + before.bootstrapped.length + before.alreadyApplied.length,
    postUpdateMigrations: afterMigrations.map((item) => item.name),
    migrationApplied: true,
    previousDataPreserved: true,
    rollbackRestoredPreviousSchema: true,
    rollbackRestoredPreviousData: true,
    signedUpdateKeyId: signer.keyId,
    updateId: update.payload.updateId,
  };
  writeFileSync(join(evidenceDir, "result.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence));
} finally {
  rmSync(target, { recursive: true, force: true });
}
