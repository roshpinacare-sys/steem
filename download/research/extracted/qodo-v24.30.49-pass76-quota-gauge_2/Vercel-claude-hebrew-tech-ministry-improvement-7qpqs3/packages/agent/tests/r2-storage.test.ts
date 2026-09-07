import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { R2Storage, FALLBACK_DIR } from "../src/services/r2-storage.js";
import { mkdirSync, rmSync, existsSync, symlinkSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

describe("R2Storage fallback containment", () => {
  beforeEach(() => {
    if (existsSync(FALLBACK_DIR)) rmSync(FALLBACK_DIR, { recursive: true, force: true });
    mkdirSync(FALLBACK_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(FALLBACK_DIR)) rmSync(FALLBACK_DIR, { recursive: true, force: true });
  });

  it("writes and reads a normal fallback file", async () => {
    const storage = new R2Storage({});
    const key = "containment-test/file.txt";
    await storage.putText(key, "hello fallback");
    const content = await storage.getText(key);
    expect(content).toBe("hello fallback");
  });

  it("throws when a symlink causes path escape", async () => {
    const outsideDir = mkdtempSync(join(tmpdir(), "qodo-outside-"));
    writeFileSync(join(outsideDir, "target.txt"), "leaked");

    const storage = new R2Storage({});
    const fallback = resolve(FALLBACK_DIR);
    mkdirSync(fallback, { recursive: true });

    // Create a symlink inside fallback that points outside.
    const linkPath = join(fallback, "escape");
    symlinkSync(outsideDir, linkPath, "dir");

    // fallbackPath sanitises key characters, but realpathSync detects the escape.
    const maliciousKey = "escape/target.txt";
    await expect(storage.putText(maliciousKey, "exfil")).rejects.toThrow(/escaped containment/);

    rmSync(outsideDir, { recursive: true, force: true });
  });
});
