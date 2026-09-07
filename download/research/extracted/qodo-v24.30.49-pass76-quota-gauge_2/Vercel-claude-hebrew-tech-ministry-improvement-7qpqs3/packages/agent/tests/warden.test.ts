import { describe, it, expect } from "vitest";
import { inspectFile, wardenGuard, WardenRejectionError } from "../src/agents/warden.js";
import type { CoderOutput } from "../src/schemas/coder-schema.js";

describe("warden", () => {
  it("blocks console.log", () => {
    const code = `export function run() { console.log("bad"); }`;
    const reason = inspectFile("run.ts", code);
    expect(reason).toContain("console.log");
  });

  it("blocks explicit any", () => {
    const code = `export function run(x: any) { return x; }`;
    const reason = inspectFile("run.ts", code);
    expect(reason).toContain("any");
  });

  it("blocks unwrapped await", () => {
    const code = `export async function run() { const x = await fetch("/"); return x; }`;
    const reason = inspectFile("run.ts", code);
    expect(reason).toContain("await");
  });

  it("allows await inside try/catch", () => {
    const code = `export async function run() { try { return await fetch("/"); } catch { return null; } }`;
    expect(inspectFile("run.ts", code)).toBeNull();
  });

  it("throws WardenRejectionError via guard", async () => {
    const patch: CoderOutput = {
      diff: "",
      files: [{ path: "run.ts", content: `console.log("x");` }],
    };
    await expect(wardenGuard(patch)).rejects.toThrow(WardenRejectionError);
  });
});
