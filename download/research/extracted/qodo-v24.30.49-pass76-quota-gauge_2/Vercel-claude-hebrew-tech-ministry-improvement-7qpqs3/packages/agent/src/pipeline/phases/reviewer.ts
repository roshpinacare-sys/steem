import { runReviewer } from "../../agents/reviewer.js";
import { runPhase } from "../../services/phase-runner.js";
import { assertNotHalted } from "../../services/kill-switch.js";
import { runWithMutationRetry, saveCheckpoint } from "../helpers.js";
import type { PhaseContext } from "../context.js";

/** Reviewer — post-merge LLM review with annotations on the check run. */
export async function runReviewerPhase(ctx: PhaseContext): Promise<void> {
  const { s, env, objective, owner, repo, prNumber, prSha, runLog, gh, state, storage, telemetry } = ctx;

  assertNotHalted(env); // kill-switch: stop before reviewer LLM call
  s.phase = "review";
  s.review = await runPhase(
    "reviewer",
    () => runWithMutationRetry(
      "reviewer",
      () => runReviewer(objective, s.patch!.diff, state, telemetry, owner, repo, env),
      owner,
      repo,
      state,
      telemetry,
      gh,
      env,
    ),
    { telemetry, logger: runLog.child({ phase: "reviewer" }), timeoutMs: 180_000 },
  );
  await storage.putText(`reviews/${prNumber}-${Date.now()}.json`, JSON.stringify(s.review));
  await saveCheckpoint(owner, repo, prNumber, state, s);
  await gh.checkRun(s.commitSha || prSha, "success", "Qodo V24 Review", s.review!.summary, s.review!.annotations);
}
