import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret, maskSecret } from "@/lib/crypto";

describe("crypto", () => {
  it("round-trips a secret", () => {
    const sealed = encryptSecret("sk-test-abcd1234");
    expect(sealed.ciphertext).toBeTruthy();
    expect(sealed.iv).toBeTruthy();
    expect(sealed.tag).toBeTruthy();
    expect(decryptSecret(sealed)).toBe("sk-test-abcd1234");
  });

  it("fails GCM auth on a tampered tag", () => {
    const sealed = encryptSecret("secret");
    const tampered = { ...sealed, tag: Buffer.from("0".repeat(16)).toString("base64") };
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("masks to last 4", () => {
    expect(maskSecret("sk-proj-xyz9")).toBe("••••xyz9");
  });
});
