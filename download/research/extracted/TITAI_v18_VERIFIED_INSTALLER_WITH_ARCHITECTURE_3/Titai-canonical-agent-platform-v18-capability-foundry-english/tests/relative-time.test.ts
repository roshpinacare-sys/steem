import { describe, it, expect } from "vitest";
import { formatRelativeTime } from "@/lib/utils";

describe("formatRelativeTime", () => {
  it("formats English past times", () => {
    const out = formatRelativeTime(Date.now() - 2 * 3600_000, "en");
    expect(out).toMatch(/2\s?hr?\.?\s?ago|2h ago/i);
  });

  it("accepts ISO strings (JSON dates)", () => {
    const iso = new Date(Date.now() - 60_000).toISOString();
    expect(formatRelativeTime(iso, "en")).toBeTruthy();
    expect(formatRelativeTime(iso, "en")).not.toBe("—");
  });

  it("returns em dash for null/garbage", () => {
    expect(formatRelativeTime(null)).toBe("—");
    expect(formatRelativeTime("not-a-date")).toBe("—");
  });
});
