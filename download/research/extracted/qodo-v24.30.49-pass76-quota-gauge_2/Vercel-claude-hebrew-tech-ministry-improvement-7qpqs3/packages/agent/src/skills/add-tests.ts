import type { Skill } from "./types.js";

export const addTestsSkill: Skill = {
  id: "add-tests",
  label: "Add Tests",
  systemPromptModifier: `This mission is ADD TESTS. Generate comprehensive test coverage for the existing code. Do not change production behavior unless strictly necessary to make it testable. Cover happy paths, edge cases, and error cases. Use the project's existing test framework and conventions.`,
};
