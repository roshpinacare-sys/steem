import { assertNotHalted } from "../../services/kill-switch.js";
import { dryRunSkip } from "../../services/dry-run.js";
import { saveCheckpoint } from "../helpers.js";
import type { PhaseContext, PhaseOutcome } from "../context.js";

/** Merge — mark the PR ready and merge it. */
export async function runMergePhase(ctx: PhaseContext): Promise<PhaseOutcome> {
  const { s, env, owner, repo, prNumber, runLog, gh, state } = ctx;

  assertNotHalted(env); // kill-switch: stop before irreversible merge

  // Dry-run guard for runs resumed mid-pipeline: never merge.
  if (dryRunSkip("merge-pr", `PR #${prNumber}`)) {
    runLog.info("dry-run: halting before merge");
    return "halt";
  }
  s.phase = "merge";
  const preMerge = await gh.getPRShas(prNumber);
  s.preMergeMainSha = preMerge?.base;
  await gh.markPRReady(prNumber);
  await gh.mergePR(prNumber);
  await saveCheckpoint(owner, repo, prNumber, state, s);
  return "continue";
}
