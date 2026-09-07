import { describe, expect, it } from "vitest";
import { compileSafeRegex, isSafeRegex } from "@/lib/security/safe-regex";

describe("safe policy regex", () => {
  it("accepts bounded ordinary patterns", () => {
    expect(isSafeRegex("^prod-[a-z0-9-]{1,40}$")).toBe(true);
    expect(compileSafeRegex("^https://example\\.com/")?.test("https://example.com/a")).toBe(true);
  });

  it("rejects high-risk constructs", () => {
    expect(isSafeRegex("(a+)+$")).toBe(false);
    expect(isSafeRegex("(.*)*")).toBe(false);
    expect(isSafeRegex("(a)\\1")).toBe(false);
    expect(isSafeRegex("(?=secret)secret")).toBe(false);
    expect(isSafeRegex(".*foo.*bar.*")).toBe(false);
  });

  it("rejects malformed and oversized patterns", () => {
    expect(isSafeRegex("[")).toBe(false);
    expect(isSafeRegex("a".repeat(161))).toBe(false);
  });
});
