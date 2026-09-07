/**
 * Regression tests for skill-exchange.ts and vector-skill-exchange.ts
 * Focus: untrusted skill records from R2 / Upstash Vector are validated with
 * Zod .strict() schemas before they can be injected into prompts.
 */
import { describe, it, expect, vi } from "vitest";
import { SkillRecordSchema, downloadGlobalSkills } from "../src/services/skill-exchange.js";
import { VectorSkillRecordSchema, findProvenPatterns } from "../src/services/vector-skill-exchange.js";
import type { R2Storage } from "../src/services/r2-storage.js";

function makeFakeStorage(overrides: Record<string, string>): R2Storage {
  return {
    getText: async (key: string) => overrides[key] ?? null,
    putText: async () => {},
  } as unknown as R2Storage;
}

describe("skill-exchange — strict schema validation (Bug 18-C regression)", () => {
  it("rejects a record with an extra property because of .strict()", () => {
    const bad = { id: "s1", name: "x", pattern: "y", promptFragment: "z", extra: 1 };
    expect(() => SkillRecordSchema.parse(bad)).toThrow();
  });

  it("accepts a minimal valid record", () => {
    const good = { id: "s1", name: "x", pattern: "y", promptFragment: "z" };
    expect(SkillRecordSchema.parse(good)).toEqual(good);
  });

  it("skips malformed records and loads only valid ones", async () => {
    const storage = makeFakeStorage({
      "hive/skills/index.json": JSON.stringify(["good", "bad", "missing"]),
      "hive/skills/good.skill.json": JSON.stringify({
        id: "good",
        name: "Good skill",
        pattern: "fix bug",
        promptFragment: "do thing",
      }),
      "hive/skills/bad.skill.json": JSON.stringify({
        id: "bad",
        // missing required fields
      }),
    });

    const skills = await downloadGlobalSkills(storage);
    expect(skills).toHaveLength(1);
    expect(skills[0].id).toBe("good");
    expect(skills[0].promptFragment).toContain("UNTRUSTED_DATA");
  });
});

describe("vector-skill-exchange — strict schema validation (Bug 18-C regression)", () => {
  it("rejects a record with an extra property because of .strict()", () => {
    const bad = { id: "v1", name: "x", pattern: "y", promptFragment: "z", extra: 1 };
    expect(() => VectorSkillRecordSchema.parse(bad)).toThrow();
  });

  it("accepts a minimal valid record", () => {
    const good = { id: "v1", name: "x", pattern: "y", promptFragment: "z" };
    expect(VectorSkillRecordSchema.parse(good)).toEqual(good);
  });
});
