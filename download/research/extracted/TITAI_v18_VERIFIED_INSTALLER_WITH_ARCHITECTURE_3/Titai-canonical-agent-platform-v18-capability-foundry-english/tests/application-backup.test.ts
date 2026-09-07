import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  createApplicationBackup,
  restoreApplicationBackup,
} from "@/lib/backup/application-backup";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = join(tmpdir(), `titai-app-backup-${process.pid}-${Date.now()}-${Math.random()}`);
  mkdirSync(root, { recursive: true });
  roots.push(root);
  const source = join(root, "source.sqlite");
  const backup = join(root, "backup.titai");
  const restored = join(root, "restored.sqlite");
  const db = new DatabaseSync(source);
  for (const table of [
    "users", "tenants", "workspaces", "workspace_memberships", "agents",
    "runs", "run_steps", "run_events", "approvals", "artifacts", "audit_log",
    "durable_jobs", "durable_receipts", "durable_outbox", "memories",
    "model_profiles", "verification_attestations",
  ]) {
    db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, value TEXT)`);
  }
  db.prepare("INSERT INTO users (id, value) VALUES (?, ?)").run("u1", "sentinel");
  db.close();
  return { root, source, backup, restored };
}

describe("application database backup", () => {
  it("encrypts, restores, and verifies a clean database copy", () => {
    const files = fixture();
    const created = createApplicationBackup({
      databasePath: files.source,
      outputPath: files.backup,
      passphrase: "correct horse battery staple",
      appVersion: "test",
      migrationFiles: ["0000.sql"],
      now: new Date("2026-07-10T12:00:00.000Z"),
    });
    expect(created.databaseBytes).toBeGreaterThan(0);
    expect(readFileSync(files.backup, "utf8")).not.toContain("sentinel");
    const restored = restoreApplicationBackup({
      backupPath: files.backup,
      targetPath: files.restored,
      passphrase: "correct horse battery staple",
    });
    expect(restored.databaseSha256).toBe(created.databaseSha256);
    const db = new DatabaseSync(files.restored, { readOnly: true });
    const row = db.prepare("SELECT value FROM users WHERE id = ?").get("u1") as { value: string };
    db.close();
    expect(row.value).toBe("sentinel");
  });

  it("rejects a wrong passphrase and a tampered envelope", () => {
    const files = fixture();
    createApplicationBackup({
      databasePath: files.source,
      outputPath: files.backup,
      passphrase: "correct horse battery staple",
      appVersion: "test",
      migrationFiles: [],
    });
    expect(() =>
      restoreApplicationBackup({
        backupPath: files.backup,
        targetPath: files.restored,
        passphrase: "incorrect passphrase",
      }),
    ).toThrow();
    const bytes = readFileSync(files.backup);
    bytes[bytes.length - 10] ^= 1;
    writeFileSync(files.backup, bytes);
    expect(() =>
      restoreApplicationBackup({
        backupPath: files.backup,
        targetPath: files.restored,
        passphrase: "correct horse battery staple",
      }),
    ).toThrow();
  });

  it("refuses to overwrite a target unless explicitly authorized", () => {
    const files = fixture();
    createApplicationBackup({
      databasePath: files.source,
      outputPath: files.backup,
      passphrase: "correct horse battery staple",
      appVersion: "test",
      migrationFiles: [],
    });
    writeFileSync(files.restored, "existing");
    expect(() =>
      restoreApplicationBackup({
        backupPath: files.backup,
        targetPath: files.restored,
        passphrase: "correct horse battery staple",
      }),
    ).toThrow("restore_target_exists");
  });
  it("restores the original target when an interruption occurs after displacement", () => {
    const files = fixture();
    createApplicationBackup({
      databasePath: files.source,
      outputPath: files.backup,
      passphrase: "correct horse battery staple",
      appVersion: "test",
      migrationFiles: [],
    });
    writeFileSync(files.restored, "original-target");
    expect(() =>
      restoreApplicationBackup({
        backupPath: files.backup,
        targetPath: files.restored,
        passphrase: "correct horse battery staple",
        overwrite: true,
        faultInjector(point) {
          if (point === "after_target_displaced") throw new Error("injected_restore_interruption");
        },
      }),
    ).toThrow("injected_restore_interruption");
    expect(readFileSync(files.restored, "utf8")).toBe("original-target");
  });

});
