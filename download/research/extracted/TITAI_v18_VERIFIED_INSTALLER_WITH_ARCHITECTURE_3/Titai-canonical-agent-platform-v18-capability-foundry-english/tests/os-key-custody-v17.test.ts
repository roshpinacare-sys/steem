import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { VerifiedExternalOsKeyCustody } from "@/lib/sovereignty/os-key-custody";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("verified external OS key custody", () => {
  it("executes only a hash-pinned helper for an allowed purpose", () => {
    const dir = mkdtempSync(join(tmpdir(), "titai-custody-")); dirs.push(dir);
    const helper = join(dir, "helper.mjs");
    writeFileSync(helper, `#!/usr/bin/env node\nlet data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>{const r=JSON.parse(data);process.stdout.write(JSON.stringify({ok:true,backendId:'test-backend',attestation:{operation:r.operation,purpose:r.purpose}}));});\n`);
    chmodSync(helper, 0o755);
    const hash = createHash("sha256").update(readFileSync(helper)).digest("hex");
    const custody = new VerifiedExternalOsKeyCustody({ helperPath: helper, helperSha256: hash, platform: process.platform, backendId: "test-backend", purposes: ["backup_encryption"] });
    const response = custody.execute({ operation: "attest", keyId: "key-1", purpose: "backup_encryption", scope: { tenantId: "tenant-a" } });
    expect(response.attestation).toMatchObject({ operation: "attest", purpose: "backup_encryption" });
    expect(() => custody.execute({ operation: "attest", keyId: "key-1", purpose: "update_signing", scope: { tenantId: "tenant-a" } })).toThrow("custody_purpose_denied");
  });

  it("rejects a helper whose bytes differ from the approved hash", () => {
    const dir = mkdtempSync(join(tmpdir(), "titai-custody-")); dirs.push(dir);
    const helper = join(dir, "helper.mjs"); writeFileSync(helper, "#!/usr/bin/env node\n"); chmodSync(helper, 0o755);
    expect(() => new VerifiedExternalOsKeyCustody({ helperPath: helper, helperSha256: "0".repeat(64), platform: process.platform, backendId: "test", purposes: ["backup_encryption"] })).toThrow("custody_helper_hash_mismatch");
  });
});
