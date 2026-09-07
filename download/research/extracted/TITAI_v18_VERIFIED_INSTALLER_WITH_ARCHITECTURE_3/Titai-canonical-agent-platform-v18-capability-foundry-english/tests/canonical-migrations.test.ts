import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openSQLite } from "@/lib/db/sqlite-client";
import { applyCanonicalMigrations } from "@/lib/db/migrations";

const paths: string[] = [];
afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("canonical migration runner", () => {
  it("applies every repository migration and records immutable hashes", () => {
    const client = openSQLite(":memory:", { driver: "node:sqlite" });
    try {
      const first = applyCanonicalMigrations({ client });
      expect(first.applied.map((row) => row.name)).toEqual([
        "0000_wonderful_lord_tyger.sql",
        "0001_v10_hardening.sql",
        "0002_v10_governed_memory.sql",
        "0003_v11_model_registry.sql",
        "0004_v11_run_evidence.sql",
        "0005_v11_tool_idempotency.sql",
        "0006_v12_fencing_and_verification.sql",
        "0007_v13_pilot_scope.sql",
        "0008_v14_runtime_alignment.sql",
        "0009_v16_operational_sovereignty.sql",
        "0010_v18_capability_foundry.sql",
      ]);
      const tables = client
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as Array<{ name: string }>;
      const names = new Set(tables.map((row) => row.name));
      expect(names).toContain("durable_outbox");
      expect(names).toContain("verification_attestations");
      expect(names).toContain("workspace_memberships");
      expect(names).toContain("capability_candidates");
      expect(names).toContain("compiled_missions");
      const runColumns = client.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
      expect(runColumns.map((column) => column.name)).toContain("tenant_id");
      const second = applyCanonicalMigrations({ client });
      expect(second.applied).toHaveLength(0);
      expect(second.alreadyApplied).toHaveLength(11);
    } finally {
      client.close();
    }
  });

  it("rejects an edited migration after it was applied", () => {
    const folder = mkdtempSync(join(tmpdir(), "titai-migrations-"));
    paths.push(folder);
    const source = join(process.cwd(), "drizzle", "0000_wonderful_lord_tyger.sql");
    const copy = join(folder, "0000_wonderful_lord_tyger.sql");
    writeFileSync(copy, readFileSync(source));
    const client = openSQLite(":memory:", { driver: "node:sqlite" });
    try {
      applyCanonicalMigrations({ client, migrationsFolder: folder });
      writeFileSync(copy, `${readFileSync(copy, "utf8")}\n-- drift\n`);
      expect(() => applyCanonicalMigrations({ client, migrationsFolder: folder })).toThrow(
        "migration_hash_drift:0000_wonderful_lord_tyger.sql",
      );
    } finally {
      client.close();
    }
  });
});
