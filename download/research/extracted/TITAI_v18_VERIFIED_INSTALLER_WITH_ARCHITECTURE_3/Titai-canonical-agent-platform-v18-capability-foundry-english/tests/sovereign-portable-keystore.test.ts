import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PortableEncryptedKeystore } from "@/lib/sovereignty/portable-keystore";

const dirs: string[] = [];
function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "titai-keystore-"));
  dirs.push(dir);
  return join(dir, "keystore.json");
}
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("portable encrypted key custody", () => {
  it("separates purposes and never writes private material in plaintext", () => {
    const path = tempPath();
    const store = PortableEncryptedKeystore.create({ path, passphrase: "correct horse battery staple", installationId: "install-a" });
    const handoff = store.createSigningKey({ purpose: "handoff_signing", actor: "admin", scope: { tenantId: "tenant-a" } });
    store.createSigningKey({ purpose: "update_signing", actor: "admin" });
    const raw = readFileSync(path, "utf8");
    expect(raw).not.toContain("PRIVATE KEY");
    expect(raw).not.toContain("tenant-a");
    expect(() => store.readKey({ keyId: handoff.keyId, purpose: "update_signing", actor: "admin", scope: { tenantId: "tenant-a" } })).toThrow("custody_key_purpose_mismatch");
  });

  it("rotates, retires, revokes, and survives encrypted reopen", () => {
    const path = tempPath();
    const passphrase = "correct horse battery staple";
    const store = PortableEncryptedKeystore.create({ path, passphrase });
    const first = store.createSymmetricKey({ purpose: "backup_encryption", actor: "admin" });
    const second = store.createSymmetricKey({ purpose: "backup_encryption", actor: "admin" });
    expect(second.version).toBe(2);
    expect(() => store.readKey({ keyId: first.keyId, purpose: "backup_encryption", actor: "admin" })).toThrow("custody_key_not_active");
    store.revoke({ keyId: second.keyId, actor: "admin", reason: "test compromise" });
    const reopened = PortableEncryptedKeystore.open({ path, passphrase });
    expect(() => reopened.readKey({ keyId: second.keyId, purpose: "backup_encryption", actor: "admin" })).toThrow("custody_key_revoked");
    expect(reopened.auditLog().some((entry) => entry.action === "revoke")).toBe(true);
  });

  it("rejects wrong passwords and cross-workspace key use", () => {
    const path = tempPath();
    const store = PortableEncryptedKeystore.create({ path, passphrase: "correct horse battery staple" });
    const key = store.createSymmetricKey({ purpose: "workspace_encryption", actor: "admin", scope: { tenantId: "tenant-a", workspaceId: "workspace-a" } });
    expect(() => PortableEncryptedKeystore.open({ path, passphrase: "incorrect password value" })).toThrow("keystore_decryption_failed");
    expect(() => store.readKey({ keyId: key.keyId, purpose: "workspace_encryption", actor: "admin", scope: { tenantId: "tenant-a", workspaceId: "workspace-b" } })).toThrow("custody_key_scope_mismatch");
  });
});
