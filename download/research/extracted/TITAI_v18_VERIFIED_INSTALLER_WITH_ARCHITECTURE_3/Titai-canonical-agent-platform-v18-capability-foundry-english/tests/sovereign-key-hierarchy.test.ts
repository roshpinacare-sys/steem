import { describe, expect, it } from "vitest";
import {
  deriveSovereignKey,
  generateRootRecoveryKey,
  generateSovereignSigningIdentity,
  signCanonicalPayload,
  verifyCanonicalPayload,
} from "@/lib/sovereignty/key-hierarchy";

describe("sovereign key hierarchy", () => {
  it("derives context-bound separated keys", () => {
    const root = generateRootRecoveryKey();
    const backup = deriveSovereignKey({ rootKey: root, purpose: "backup", context: "tenant-a" });
    const data = deriveSovereignKey({ rootKey: root, purpose: "data_encryption", context: "tenant-a" });
    const otherTenant = deriveSovereignKey({ rootKey: root, purpose: "backup", context: "tenant-b" });
    expect(backup.keyBase64).not.toBe(data.keyBase64);
    expect(backup.keyBase64).not.toBe(otherTenant.keyBase64);
    expect(backup.keyId).not.toBe(data.keyId);
  });

  it("signs and rejects tampered payloads", () => {
    const identity = generateSovereignSigningIdentity(new Date("2026-07-11T00:00:00Z"));
    const envelope = signCanonicalPayload({ payload: { task: "local" }, identity, now: new Date("2026-07-11T00:00:00Z") });
    expect(verifyCanonicalPayload({ envelope, publicKeyPem: identity.publicKeyPem, expectedKeyId: identity.keyId })).toBe(true);
    const tampered = structuredClone(envelope);
    tampered.payload = { task: "remote" };
    expect(verifyCanonicalPayload({ envelope: tampered, publicKeyPem: identity.publicKeyPem })).toBe(false);
  });
});
