import { describe, it, expect } from "vitest";
import { isPathAllowed, guardPaths } from "../src/utils/path-guard.js";

describe("path-guard", () => {
  it("blocks ../ traversal", () => {
    expect(isPathAllowed("../secret.ts")).toBe(false);
    expect(isPathAllowed("src/../../secret.ts")).toBe(false);
  });

  it("blocks .github/workflows/", () => {
    expect(isPathAllowed(".github/workflows/ci.yml")).toBe(false);
  });

  it("allows normal source paths", () => {
    expect(isPathAllowed("src/index.ts")).toBe(true);
    expect(isPathAllowed("packages/agent/src/cli.ts")).toBe(true);
  });

  it("blocks absolute paths", () => {
    expect(isPathAllowed("/etc/passwd")).toBe(false);
  });

  it("guardPaths returns blocked list", () => {
    const { allowed, blocked } = guardPaths([
      { path: "src/index.ts" },
      { path: ".github/workflows/ci.yml" },
      { path: "../secret.ts" },
    ]);
    expect(allowed).toBe(false);
    expect(blocked).toEqual([".github/workflows/ci.yml", "../secret.ts"]);
  });
});
