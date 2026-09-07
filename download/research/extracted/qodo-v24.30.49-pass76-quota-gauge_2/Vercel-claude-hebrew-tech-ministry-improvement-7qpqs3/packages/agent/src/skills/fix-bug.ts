import type { Skill } from "./types.js";

export const fixBugSkill: Skill = {
  id: "fix-bug",
  label: "Fix Bug",
  systemPromptModifier: `This mission is FIX BUG. Identify the root cause of the reported issue. Make the minimal change that fixes the bug without introducing new behavior or side effects. Add or update a regression test if possible.`,
};
