import { domXray } from "../../validators/dom-xray.js";
import { shadowTraffic } from "../../validators/shadow-traffic.js";
import { resolveIncident } from "../../services/incident-resolver.js";
import { runSreFeedbackLoop } from "../../services/sre-feedback.js";
import { publishAsyncTask, resolveQStashConfig } from "../../services/integrations/qstash-async.js";
import { runGuarded, saveCheckpoint } from "../helpers.js";
import type { PhaseContext, PhaseOutcome } from "../context.js";

/** Post-merge validation + SRE feedback loop (auto-revert on regression). */
export async function runPostmergePhase(ctx: PhaseContext): Promise<PhaseOutcome> {
  const { s, env, objective, owner, repo, prNumber, prSha, runId, runLog, gh, state, telemetry } = ctx;

  s.phase = "postmerge";
  const targetUrl = env.VERCEL_PRODUCTION_URL || env.VERCEL_PREVIEW_URL || "";
  const dom = await runGuarded("dom", () => domXray(targetUrl, env.VERCEL_AUTOMATION_BYPASS_SECRET), telemetry);
  const shadow = await runGuarded("shadow", () => shadowTraffic(targetUrl, env.VERCEL_AUTOMATION_BYPASS_SECRET), telemetry);
  await saveCheckpoint(owner, repo, prNumber, state, s);

  if (!dom.allowed || !shadow.allowed) {
    const errorLog = JSON.stringify({ dom, shadow }, null, 2);
    await resolveIncident(
      gh,
      { prNumber, errorLog, objective, commitSha: s.commitSha },
      owner,
      repo,
      env.GITHUB_TOKEN,
      telemetry,
    );
    await gh.comment(prNumber, "🚨 Ghost Commit failed post-merge validation. Incident response playbook executed: safe revert, issue opened, fix dispatched.");
    await gh.checkRun(s.commitSha || prSha, "failure", "Qodo V24 Ghost Commit", "Post-merge validation failed", []);
    return "halt";
  }

  if (env.NODE_ENV === "test") {
    await telemetry?.decision("sre-feedback", "skipped-test-env", {});
  } else {
    // Pass 19: offload the blocking 10-min SRE sleep to QStash when configured.
    // If QStash is not configured, fall back to inline synchronous execution.
    const qstashCfg = resolveQStashConfig();
    const callbackBase = process.env.QODO_BASE_URL ?? "";
    if (qstashCfg && callbackBase) {
      const published = await publishAsyncTask(
        {
          type: "sre_feedback",
          agentId: runId,
          payload: {
            prNumber,
            objective,
            commitSha: s.commitSha ?? "",
            owner,
            repo,
          },
          callbackUrl: `${callbackBase}/api/qstash/callback`,
          delaySeconds: 600, // 10-minute post-merge warmup
        },
        qstashCfg,
        telemetry,
      );
      if (published.published) {
        runLog.info("SRE feedback loop offloaded to QStash", { messageId: published.messageId });
      } else {
        // QStash publish failed — run synchronously as fallback
        const feedback = await runSreFeedbackLoop(gh, {
          prNumber, objective, commitSha: s.commitSha, owner, repo, githubToken: env.GITHUB_TOKEN,
        }, telemetry, env);
        if (feedback.reverted) {
          await gh.comment(prNumber, `🛰️ SRE feedback loop reverted production regression: ${feedback.reason}`);
          await gh.checkRun(s.commitSha || prSha, "failure", "Qodo V24 SRE Feedback", feedback.reason || "Regression detected", []);
          return "halt";
        }
      }
    } else {
      const feedback = await runSreFeedbackLoop(gh, {
        prNumber, objective, commitSha: s.commitSha, owner, repo, githubToken: env.GITHUB_TOKEN,
      }, telemetry, env);
      if (feedback.reverted) {
        await gh.comment(prNumber, `🛰️ SRE feedback loop reverted production regression: ${feedback.reason}`);
        await gh.checkRun(s.commitSha || prSha, "failure", "Qodo V24 SRE Feedback", feedback.reason || "Regression detected", []);
        return "halt";
      }
    }
  }
  return "continue";
}
