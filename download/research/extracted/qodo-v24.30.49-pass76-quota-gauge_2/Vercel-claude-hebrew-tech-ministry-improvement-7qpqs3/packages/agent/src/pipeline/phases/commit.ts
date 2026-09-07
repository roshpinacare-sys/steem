import { assertNotHalted } from "../../services/kill-switch.js";
import { dryRunSkip, getDryRunReport } from "../../services/dry-run.js";
import { audit, saveCheckpoint } from "../helpers.js";
import type { PhaseContext, PhaseOutcome } from "../context.js";

/** Ghost Commit — commit the patch (plus infra patches) to the PR branch. */
export async function runCommitPhase(ctx: PhaseContext): Promise<PhaseOutcome> {
  const { s, env, objective, owner, repo, prNumber, prSha, runId, runLog, gh, state, telemetry } = ctx;

  assertNotHalted(env); // kill-switch: final stop before any git write

  // Dry-run: the Ghost Commit is the pipeline's first destructive write.
  // Halt here with a simulation report instead of touching the branch.
  if (dryRunSkip("ghost-commit", `PR #${prNumber}`)) {
    const report = getDryRunReport();
    runLog.info("dry-run: halting before Ghost Commit", { summary: report.summary });
    await telemetry?.decision("dry-run", "halted-before-commit", {
      simulatedActions: report.simulatedActions.length,
    });
    await gh.comment(prNumber, `🧪 Dry-run: pipeline halted before Ghost Commit.\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\``);
    return "halt";
  }

  s.phase = "commit";
  const commitFiles = [
    ...s.patch!.files as { path: string; content: string }[],
    ...(s.infraPatch || []),
  ];
  const lastCommit = await gh.commitViaGitDB(prNumber, commitFiles, `qodo(v24): ${objective}`, s.prefetch || {});
  if (lastCommit.drift) {
    await telemetry?.decision("necromancer", "drift-detected", lastCommit.drift as unknown as Record<string, unknown>);
    audit(runId, "drift-detected", { drift: lastCommit.drift });
    await gh.comment(prNumber, `🛑 Qodo V24 halted: drift detected before commit.\n\`\`\`json\n${JSON.stringify(lastCommit.drift, null, 2)}\n\`\`\``);
    await gh.checkRun(prSha, "failure", "Qodo V24 Drift", JSON.stringify(lastCommit.drift, null, 2), []);
    return "halt";
  }
  s.commitSha = lastCommit.commitSha;
  audit(runId, "commit-created", { commitSha: lastCommit.commitSha, prNumber, fileCount: commitFiles.length });
  await saveCheckpoint(owner, repo, prNumber, state, s);
  return "continue";
}
