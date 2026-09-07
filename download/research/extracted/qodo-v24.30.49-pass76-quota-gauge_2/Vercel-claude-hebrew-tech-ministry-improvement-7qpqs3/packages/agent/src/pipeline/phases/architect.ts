import { runArchitect } from "../../agents/architect.js";
import { runPhase } from "../../services/phase-runner.js";
import { assertNotHalted } from "../../services/kill-switch.js";
import { audit, runWithMutationRetry, saveCheckpoint } from "../helpers.js";
import type { PhaseContext } from "../context.js";

/** Architect — turn the objective into a typed, Zod-validated plan. */
export async function runArchitectPhase(ctx: PhaseContext): Promise<void> {
  const { s, env, deps, objective, owner, repo, prNumber, runId, runLog, gh, state, storage, telemetry } = ctx;

  assertNotHalted(env); // kill-switch: stop before committing LLM spend
  s.phase = "architect";
  s.plan = await runPhase(
    "architect",
    () => runWithMutationRetry(
      "architect",
      () => runArchitect(objective, state, telemetry, deps.skillId ?? env.QODO_SKILL_ID, owner, repo, storage, env.GITHUB_TOKEN, env),
      owner,
      repo,
      state,
      telemetry,
      gh,
      env,
    ),
    { telemetry, logger: runLog.child({ phase: "architect" }), timeoutMs: 180_000 },
  );
  await telemetry?.decision("architect", "plan-generated", {
    steps: s.plan!.steps.map((step) => ({ id: step.id, description: step.description, files: step.files })),
    risk: s.plan!.risk,
  });
  audit(runId, "architect-plan-generated", { steps: s.plan!.steps.length, risk: s.plan!.risk });
  await saveCheckpoint(owner, repo, prNumber, state, s);
}
