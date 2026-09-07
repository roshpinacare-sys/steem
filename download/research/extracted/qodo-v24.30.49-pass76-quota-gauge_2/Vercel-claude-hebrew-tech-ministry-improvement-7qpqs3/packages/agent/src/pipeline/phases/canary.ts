import { deployPreview, routeTrafficToCanary, rollbackCanary, promoteToProduction } from "../../services/canary.js";
import { shadowTraffic } from "../../validators/shadow-traffic.js";
import { dryRunSkip } from "../../services/dry-run.js";
import { runGuarded, saveCheckpoint } from "../helpers.js";
import type { PhaseContext, PhaseOutcome } from "../context.js";

/** Canary — 5% edge traffic, shadow-validate, promote or roll back. */
export async function runCanaryPhase(ctx: PhaseContext): Promise<PhaseOutcome> {
  const { s, env, owner, repo, prNumber, prSha, runLog, gh, state, telemetry, reporter } = ctx;

  // Dry-run guard for runs resumed mid-pipeline: never deploy.
  if (dryRunSkip("canary-deploy", `commit ${s.commitSha ?? "unknown"}`)) {
    runLog.info("dry-run: halting before canary deploy");
    return "halt";
  }

  if (env.VERCEL_TOKEN) {
    s.phase = "canary";
    const preview = await deployPreview(s.commitSha!, env);
    s.canaryUrl = preview.url;
    await routeTrafficToCanary(preview.url, env);
    await saveCheckpoint(owner, repo, prNumber, state, s);

    const canaryShadow = await runGuarded("canary-shadow", () => shadowTraffic(preview.url, env.VERCEL_AUTOMATION_BYPASS_SECRET), telemetry);
    if (!canaryShadow.allowed) {
      await rollbackCanary(env);
      await gh.checkRun(s.commitSha || prSha, "failure", "Qodo V24 Canary", "Canary shadow validation failed", []);
      await reporter.report(s, { canaryUrl: preview.url, errorMsg: "Shadow validation failed — rolled back" });
      return "halt";
    }

    await promoteToProduction(s.commitSha!, env);
    await reporter.report(s, { canaryUrl: preview.url });
    await saveCheckpoint(owner, repo, prNumber, state, s);
  } else {
    runLog.info("Canary skipped (no Vercel credentials)");
    s.phase = "merge";
    await saveCheckpoint(owner, repo, prNumber, state, s);
  }
  return "continue";
}
