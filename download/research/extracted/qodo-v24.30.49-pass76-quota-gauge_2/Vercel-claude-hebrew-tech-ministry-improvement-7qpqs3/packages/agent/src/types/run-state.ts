import type { Plan } from "../agents/architect.js";
import type { Patch } from "../agents/coder.js";
import type { Review } from "../agents/reviewer.js";

export type Phase = "idle" | "preflight_hold" | "architect" | "coder" | "gate" | "commit" | "astdoc" | "canary" | "merge" | "postmerge" | "review" | "done";

export interface GateResult {
  allowed: boolean;
  [key: string]: unknown;
}

export interface RunState {
  runId: string;
  objective: string;
  prNumber: number;
  prSha: string;
  owner: string;
  repo: string;
  phase: Phase;
  plan?: Plan;
  prefetch?: Record<string, string>;
  fileMap?: Record<string, string>;
  patch?: Patch;
  gate?: {
    lockCheck: GateResult;
    blast: GateResult;
    dom: GateResult;
    shadow: GateResult;
    chaos: GateResult;
    test: GateResult;
    // R1: API contract diffing result
    contractGuard?: { passed: boolean; breakingChanges: unknown[]; additiveChanges: unknown[] };
  };
  review?: Review;
  commitSha?: string;
  preMergeMainSha?: string;
  canaryUrl?: string;
  error?: string;
  infraPatch?: { path: string; content: string }[];
  startedAt: string;
  updatedAt: string;
}
