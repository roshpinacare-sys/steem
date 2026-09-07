import type { Skill } from "./types.js";

export const refactorSkill: Skill = {
  id: "refactor",
  label: "Refactor",
  systemPromptModifier: `This mission is a REFACTOR. Preserve observable behavior. Favor small, focused changes; extract functions; remove duplication; improve naming; keep tests green. Do not add new features.`,
};
