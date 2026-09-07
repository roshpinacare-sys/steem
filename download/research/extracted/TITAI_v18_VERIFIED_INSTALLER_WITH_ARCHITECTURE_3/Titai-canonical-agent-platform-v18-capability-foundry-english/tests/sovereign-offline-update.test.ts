import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateSovereignSigningIdentity } from "@/lib/sovereignty/key-hierarchy";
import { applyOfflineUpdate, createOfflineUpdate, rollbackOfflineUpdate, verifyOfflineUpdate } from "@/lib/sovereignty/offline-update";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "titai-update-test-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("signed sovereign offline update", () => {
  it("dry-runs, applies, validates, and rolls back", () => {
    const target = tempDir();
    writeFileSync(join(target, ".titai-version"), "1.0.0\n");
    writeFileSync(join(target, "app.txt"), "old");
    const signer = generateSovereignSigningIdentity();
    const update = createOfflineUpdate({
      fromVersion: "1.0.0",
      toVersion: "1.1.0",
      files: [{ path: "app.txt", bytes: "new" }, { path: "docs/change.txt", bytes: "offline update" }],
      validationCommands: ["npm test"],
      signer,
    });
    const plan = verifyOfflineUpdate({ update, publicKeyPem: signer.publicKeyPem, expectedKeyId: signer.keyId, targetDir: target });
    expect(plan.compatible).toBe(true);
    const applied = applyOfflineUpdate({
      update,
      publicKeyPem: signer.publicKeyPem,
      expectedKeyId: signer.keyId,
      targetDir: target,
      validate: (dir) => expect(readFileSync(join(dir, "app.txt"), "utf8")).toBe("new"),
    });
    expect(readFileSync(join(target, ".titai-version"), "utf8").trim()).toBe("1.1.0");
    rollbackOfflineUpdate(applied);
    expect(readFileSync(join(target, ".titai-version"), "utf8").trim()).toBe("1.0.0");
    expect(readFileSync(join(target, "app.txt"), "utf8")).toBe("old");
  });

  it("rejects downgrade and restores previous state after injected failure", () => {
    const target = tempDir();
    writeFileSync(join(target, ".titai-version"), "2.0.0\n");
    writeFileSync(join(target, "app.txt"), "stable");
    const signer = generateSovereignSigningIdentity();
    expect(() => createOfflineUpdate({ fromVersion: "2.0.0", toVersion: "1.0.0", files: [], signer })).toThrow("update_downgrade_or_equal_rejected");
    const update = createOfflineUpdate({ fromVersion: "2.0.0", toVersion: "2.1.0", files: [{ path: "app.txt", bytes: "broken" }], signer });
    expect(() => applyOfflineUpdate({ update, publicKeyPem: signer.publicKeyPem, targetDir: target, faultInjector: (point) => { if (point === "after_writes") throw new Error("injected"); } })).toThrow("injected");
    expect(readFileSync(join(target, "app.txt"), "utf8")).toBe("stable");
    expect(readFileSync(join(target, ".titai-version"), "utf8").trim()).toBe("2.0.0");
  });
});
