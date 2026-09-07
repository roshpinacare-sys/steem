import { describe, expect, it } from "vitest";
import {
  assertSafeEgressUrl,
  isPrivateOrSpecialAddress,
  parseEgressUrl,
} from "@/lib/security/egress";

describe("egress policy", () => {
  it("blocks loopback, private, link-local, and metadata targets", () => {
    for (const value of [
      "http://127.0.0.1",
      "http://10.0.0.4",
      "http://169.254.169.254/latest/meta-data",
      "http://localhost:3000",
      "https://metadata.google.internal",
    ]) {
      expect(() => parseEgressUrl(value, { allowHttp: true })).toThrow();
    }
  });

  it("recognizes common private address ranges", () => {
    expect(isPrivateOrSpecialAddress("192.168.1.3")).toBe(true);
    expect(isPrivateOrSpecialAddress("172.31.4.2")).toBe(true);
    expect(isPrivateOrSpecialAddress("8.8.8.8")).toBe(false);
    expect(isPrivateOrSpecialAddress("::1")).toBe(true);
  });

  it("allows explicit local access for the local-model adapter", () => {
    expect(
      parseEgressUrl("http://localhost:11434/v1", {
        allowHttp: true,
        allowPrivate: true,
      }).hostname,
    ).toBe("localhost");
  });

  it("rejects DNS names that resolve to private addresses", async () => {
    await expect(
      assertSafeEgressUrl("https://example.test", {
        lookupHost: async () => [{ address: "10.1.2.3", family: 4 }],
      }),
    ).rejects.toThrow(/private/i);
  });

  it("accepts DNS names only when every resolved address is public", async () => {
    const url = await assertSafeEgressUrl("https://example.test/path", {
      lookupHost: async () => [{ address: "93.184.216.34", family: 4 }],
    });
    expect(url.pathname).toBe("/path");
  });
});
