import matter from "gray-matter";
import { z } from "zod";

/**
 * SKILL.md format (adapted from V4/ECOS + Anthropic Agent Skills). YAML
 * frontmatter with a required name + description, followed by a markdown body
 * of instructions. Skills are injected into an agent's system prompt.
 */

export const skillFrontmatterSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
  })
  .passthrough();

export interface ParsedSkill {
  frontmatter: z.infer<typeof skillFrontmatterSchema>;
  body: string;
  raw: string;
}

export class SkillParseError extends Error {}

export function parseSkillMd(raw: string): ParsedSkill {
  let parsed;
  try {
    parsed = matter(raw);
  } catch {
    throw new SkillParseError("Could not parse SKILL.md frontmatter");
  }
  const result = skillFrontmatterSchema.safeParse(parsed.data);
  if (!result.success) {
    throw new SkillParseError("Name and description are required");
  }
  return {
    frontmatter: result.data,
    body: parsed.content.trim(),
    raw,
  };
}

/** Build a SKILL.md string from parts (used by the editor's raw view). */
export function buildSkillMd(
  frontmatter: Record<string, unknown>,
  body: string,
): string {
  return matter.stringify(body.trim() + "\n", frontmatter);
}

export interface InjectableSkill {
  name: string;
  description: string;
  body: string;
}

/**
 * Compose the final system prompt: the agent's base prompt plus a "# Skills"
 * section describing each attached skill. Deterministic ordering by name.
 */
export function composeSystemPrompt(
  basePrompt: string,
  skills: InjectableSkill[],
): string {
  const base = basePrompt.trim();
  if (skills.length === 0) return base;

  const ordered = [...skills].sort((a, b) => a.name.localeCompare(b.name));
  const sections = ordered
    .map(
      (s) =>
        `## ${s.name}\n${s.description}\n\n${s.body}`.trim(),
    )
    .join("\n\n");

  return `${base}\n\n# Skills\nYou have the following skills available. Apply a skill when its description matches the task at hand.\n\n${sections}`;
}
