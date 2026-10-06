// הצהרת טיפוסים למנוע הגילוי (console/acid-engine.js) — UMD איזומורפי:
// בדפדפן הוא window.AcidEngine, ב-bun (הלב הענני) — ייבוא ישיר.
// המקור הקנוני חי בריפו הריבוני (console/) ומפורסם ל-Console של Pages.
declare module "*/acid-engine.js" {
  export const ENGINE_VERSION: string;
  export const PRIMITIVES: string[];
  export const LIMITS: {
    MOD: number;
    MAX_STACK: number;
    MAX_MEMORY: number;
    MAX_STEPS: number;
    MAX_PROGRAM_LENGTH: number;
  };
  export interface AcidProgram {
    instructions: [string, number][];
    constants: number[];
  }
  export interface AcidTask {
    spec: string;
    en: string;
    inputLen: number;
    hard?: boolean;
    searchNote?: string;
  }
  export const TASKS: Record<string, AcidTask>;
  export const taskIds: string[];
  export function discoverSync(opts: {
    taskId: string;
    seed: number;
    generations: number;
    population: number;
  }): {
    found: boolean;
    taskId: string;
    seed: number;
    generations: number;
    population: number;
    evals: number;
    bestScore?: number;
    hash?: string;
    program?: AcidProgram;
    history?: { gen: number; evals: number; best: number }[];
  };
  export function verifyFull(
    program: AcidProgram,
    taskId: string,
    seed: number,
  ): {
    taskId: string;
    seed: number;
    hash: string;
    verified: boolean;
    passedCount: number;
    tests: { id: string; name: string; pass: boolean; detail: string }[];
  };
  export function selfTest(): {
    pass: number;
    total: number;
    version: string;
    checks: { name: string; pass: boolean; detail?: string }[];
  };
  export function proofBundle(discovery: {
    taskId: string;
    seed: number;
    generations: number;
    population: number;
    hash: string;
  }): { ev: string; t: string; s: number; g: number; p: number; h: string };
}
