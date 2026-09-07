import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("operator interface accessibility contracts", () => {
  it("labels the control-plane and readiness regions", () => {
    const control = read("src/components/operations/control-room.tsx");
    expect(control).toContain('aria-label="Operational signal plane"');
    expect(control).toContain('aria-labelledby="pilot-readiness-title"');
    expect(control).toContain("Unknown release evidence is treated as a blocker");
  });

  it("provides non-color status words for every pilot gate", () => {
    const control = read("src/components/operations/control-room.tsx");
    for (const word of ["PASS", "BLOCK", "WARN", "UNKNOWN"]) expect(control).toContain(word);
  });

  it("defines reduced-motion and narrow-width behavior", () => {
    const css = read("src/app/globals.css");
    expect(css).toMatch(/prefers-reduced-motion/);
    expect(css).toContain("@media (max-width: 640px)");
  });

  it("keeps run control evidence in a named region", () => {
    const dossier = read("src/components/runs/run-dossier.tsx");
    expect(dossier).toContain('aria-labelledby="run-dossier-title"');
    expect(dossier).toContain('role="list"');
  });
});
