export type { Skill } from "./types.js";
export { refactorSkill } from "./refactor.js";
export { addTestsSkill } from "./add-tests.js";
export { fixBugSkill } from "./fix-bug.js";

import { refactorSkill } from "./refactor.js";
import { addTestsSkill } from "./add-tests.js";
import { fixBugSkill } from "./fix-bug.js";
import type { Skill } from "./types.js";

const SKILLS: Skill[] = [refactorSkill, addTestsSkill, fixBugSkill];

export function getSkillById(id?: string): Skill | undefined {
  return SKILLS.find((s) => s.id === id);
}
