import { describe, it, expect } from "vitest";
import {
  parseSkillMd,
  composeSystemPrompt,
  buildSkillMd,
  SkillParseError,
} from "@/lib/engine/skills";

describe("parseSkillMd", () => {
  it("parses valid frontmatter + body", () => {
    const raw = `---\nname: Concise Writer\ndescription: Writes tersely\n---\nUse short sentences.`;
    const parsed = parseSkillMd(raw);
    expect(parsed.frontmatter.name).toBe("Concise Writer");
    expect(parsed.frontmatter.description).toBe("Writes tersely");
    expect(parsed.body).toBe("Use short sentences.");
  });

  it("throws when name or description missing", () => {
    expect(() => parseSkillMd(`---\nname: X\n---\nbody`)).toThrow(SkillParseError);
    expect(() => parseSkillMd(`no frontmatter at all`)).toThrow(SkillParseError);
  });

  it("round-trips through buildSkillMd", () => {
    const md = buildSkillMd(
      { name: "A", description: "B" },
      "Instructions here",
    );
    const parsed = parseSkillMd(md);
    expect(parsed.frontmatter.name).toBe("A");
    expect(parsed.body).toBe("Instructions here");
  });
});

describe("composeSystemPrompt", () => {
  it("returns base prompt unchanged when no skills", () => {
    expect(composeSystemPrompt("Base.", [])).toBe("Base.");
  });

  it("injects skills deterministically by name", () => {
    const out = composeSystemPrompt("Base.", [
      { name: "Zeta", description: "z", body: "zbody" },
      { name: "Alpha", description: "a", body: "abody" },
    ]);
    expect(out).toContain("# Skills");
    // Alpha appears before Zeta regardless of input order
    expect(out.indexOf("## Alpha")).toBeLessThan(out.indexOf("## Zeta"));
    expect(out).toContain("abody");
    expect(out).toContain("zbody");
  });
});
