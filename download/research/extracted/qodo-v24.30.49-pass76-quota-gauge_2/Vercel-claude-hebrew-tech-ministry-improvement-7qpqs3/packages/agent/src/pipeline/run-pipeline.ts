/**
 * runPipeline — the orchestrator.
 *
 * Formerly a single ~830-line function in cli.ts. The linear, resumable
 * phase state machine is preserved VERBATIM: each guard tests the two phase
 * names that may be current when the block should run (previous-phase
 * fall-through + same-phase resume after a checkpointed crash), exactly as
 * before. Phase bodies live in ./phases/*; only the module boundaries moved.
 *
 *   idle → (preflight_hold) → architect → coder → gate → commit → astdoc
 *        → canary → merge → postmerge → review → done
 */
import { GitHubClient } from "../services/github-client.js";
import { RedisState } from "../services/redis-state.js";
import { R2Storage } from "../services/r2-storage.js";
import { Telemetry } from "../services/telemetry.js";
import { PrReporter } from "../services/pr-reporter.js";
import { costTracker } from "../services/ai-router.js";
import { log } from "../services/logger.js";
import { initAxiomShipper } from "../services/axiom-shipper.js";
import { validateAndCoerce } from "../services/env-validator.js";
import { runHealthChecks } from "../services/health-check.js";
import { assertNotHalted, PipelineHaltedError } from "../services/kill-switch.js";
import { verifyAndAuditSacredFiles } from "../services/sacred-file-integrity.js";
import { checkModelDeprecations } from "../services/model-deprecation-watchdog.js";
import { runSupervisor } from "../agents/supervisor.js";
import { recordRationale } from "../services/rationale-bank.js";
import { openLedger } from "../services/cost-ledger.js";
import { classifyTrustCategory, recordOutcome, loadTrustLedger, canAutoMerge } from "../services/trust-ledger.js";
import { classifyRiskTier, recordPreflightOutcome } from "../services/preflight-estimator.js";
import { TRIGGER_ACK_PREFIX, ACK_TTL_SEC } from "../services/trigger-queue.js";
import { loadPolicy, type QodoPolicy } from "../services/policy.js";
import { emitReceipt, stashLoadedPolicy } from "./receipt-emitter.js";
import { initBudget, budgetStatus } from "../services/budget-governor.js";
import { initDryRun, isDryRun } from "../services/dry-run.js";
import {
  audit,
  loadOrCreateState,
  splitRepo,
  waitForMentorApproval,
  WORKSPACE_ROOT,
} from "./helpers.js";
import type { PhaseContext, PipelineDeps } from "./context.js";
import { runPreflightPhase } from "./phases/preflight.js";
import { runArchitectPhase } from "./phases/architect.js";
import { runPrefetchPhase } from "./phases/prefetch.js";
import { runCoderPhase } from "./phases/coder.js";
import { runGatePhase } from "./phases/gate.js";
import { runCommitPhase } from "./phases/commit.js";
import { runAstdocPhase } from "./phases/astdoc.js";
import { runCanaryPhase } from "./phases/canary.js";
import { runMergePhase } from "./phases/merge.js";
import { runPostmergePhase } from "./phases/postmerge.js";
import { runReviewerPhase } from "./phases/reviewer.js";
import { finalizeRun } from "./finalize.js";

export type { PipelineDeps } from "./context.js";

export async function runPipeline(deps: PipelineDeps = {}) {
  // ── Environment validation & health checks ─────────────────────────────
  const env = validateAndCoerce();
  // Boot Axiom log shipper early so all subsequent log lines are shipped.
  initAxiomShipper(env.AXIOM_TOKEN ?? "", env.AXIOM_DATASET ?? "");
  // Sovereign local mode (--eval / simulator) has no external services to
  // reach, so skip the network pre-flight and the model-catalogue watchdog:
  // the run must be provably offline and deterministic.
  const sovereignLocal = env.QODO_LLM_SIM === "true";
  if (!sovereignLocal) {
    await runHealthChecks(env);
  }

  // ── Kill-switch check (Pass 34) ────────────────────────────────────────
  // assertNotHalted() is a single, dependency-free env check. It must run
  // before any I/O so a QODO_HALT=true setting stops the pipeline immediately
  // even when Redis, every provider, and all integrations are unavailable.
  assertNotHalted(env);

  // ── Model-deprecation watchdog (Pass 34) ───────────────────────────────
  // Warns (but does not block) if any configured model is absent from its
  // provider's live catalogue, so deprecations are caught before they fail.
  if (!sovereignLocal) {
    void checkModelDeprecations(env).catch(() => {/* non-fatal */});
  }

  // ── Integration startup config logging (Pass 19, updated Pass 26/34) ───
  // Use the typed env object (not raw process.env) so all checks are driven
  // by the Zod-validated, coerced environment.
  {
    const integrationStatus: Record<string, boolean> = {
      "github-issues":        !!(env.GITHUB_TOKEN),
      "slack-webhook":        !!(env.SLACK_WEBHOOK_URL),
      "sentry-gate":          !!(env.SENTRY_AUTH_TOKEN && env.SENTRY_ORG && env.SENTRY_PROJECT),
      "qstash-async":         !!(env.QSTASH_TOKEN && env.QSTASH_CURRENT_SIGNING_KEY),
      "github-actions-flaky": !!(env.GITHUB_TOKEN),
      "git-blame-risk":       !!(env.GITHUB_TOKEN),
      "ticket-enrichment":    !!(env.LINEAR_API_KEY || (env.JIRA_BASE_URL && env.JIRA_TOKEN)),
      "codecov-intelligence": !!(env.CODECOV_TOKEN),
    };
    log.info("integration config status", { integrations: integrationStatus });
  }

  const objective = deps.objective ?? env.OBJECTIVE ?? "No objective supplied";
  const [owner, repo] = deps.owner && deps.repo ? [deps.owner, deps.repo] : splitRepo(undefined, env.REPO);
  let prNumber = deps.prNumber ?? Number(env.PR_NUMBER || 0);
  const prSha = deps.prSha ?? env.PR_SHA ?? "";
  let runId = `pr-${prNumber}-${Date.now()}`;

  const runLog = log.child({ runId });
  runLog.info("mission start", { objective, owner, repo });
  const gh = deps.gh ?? new GitHubClient(env.GITHUB_TOKEN, owner, repo);

  if (!prNumber) {
    prNumber = await gh.createBranchAndPR(objective);
    runId = `pr-${prNumber}-${Date.now()}`;
    runLog.info("created draft PR", { prNumber });
  }

  const state = deps.state ?? new RedisState(env);
  const storage = deps.storage ?? new R2Storage(env);
  const telemetry = new Telemetry(runId, state);
  const reporter = new PrReporter(gh, state, prNumber, owner, repo, telemetry, env.QODO_COST_ALERT_USD_CENTS);

  const lock = await state.acquireLock(`pr-${prNumber}`);
  if (!lock) {
    runLog.warn("another agent holds the lock; exiting");
    return;
  }

  // Reset cost tracker so each run starts with a clean slate.
  costTracker.reset();

  audit(runId, "run-started", { objective, owner, repo, prNumber });

  // ── Sacred-file integrity check (Pass 36) ──────────────────────────────
  // Read-only, dependency-light drift check on the repo's highest
  // blast-radius files (phase state machine, path-guard, audit/kill-switch
  // primitives, AI-contract schemas). Never blocks the run — an unbaselined
  // or drifted file is recorded in the audit chain so it's visible in review
  // rather than silently missed, matching this codebase's own audit history
  // of "written, never wired" defects. See HARD-TASKS-BACKLOG.md item #14.
  verifyAndAuditSacredFiles(WORKSPACE_ROOT, runId);

  // ── Per-repo policy (.qodo/policy.yml) ──────────────────────────────────
  // Read from the repo's trunk (never the PR head) so a pull request cannot
  // edit its own guardrails. Applied BEFORE the supervisor + any LLM call so
  // autonomy overrides and the budget cap are in force from the first token.
  const loadedPolicy = await loadPolicy(gh, "heads/main");
  const policy: QodoPolicy = loadedPolicy.policy;
  // Retain the raw policy identity (source + sha256) for the run's receipt.
  stashLoadedPolicy(loadedPolicy);
  await telemetry.decision("policy", "loaded", {
    source: loadedPolicy.source,
    autonomy: policy.autonomy,
    maxUsdCents: policy.budget?.maxUsdCents ?? null,
    ...(loadedPolicy.error ? { invalid: loadedPolicy.error } : {}),
  });
  audit(runId, "policy-applied", {
    source: loadedPolicy.source,
    autonomy: policy.autonomy,
    maxUsdCents: policy.budget?.maxUsdCents ?? null,
  });
  // Arm the hard spend cap (0/absent → disabled; today's behavior).
  initBudget(policy.budget?.maxUsdCents);
  // Apply the autonomy floor. Env stays the operator's global setting; policy
  // can only ADD restriction (mentor/dry-run), never remove it.
  if (policy.autonomy === "mentor" && env.QODO_MENTOR_MODE !== "true") {
    runLog.warn("policy: forcing MENTOR_MODE (.qodo/policy.yml autonomy: mentor)");
    process.env.QODO_MENTOR_MODE = "true";
    env.QODO_MENTOR_MODE = "true";
  } else if (policy.autonomy === "dry-run" && !isDryRun()) {
    runLog.warn("policy: forcing DRY-RUN (.qodo/policy.yml autonomy: dry-run) — no commit/deploy/merge");
    initDryRun(["--dry-run"]);
  }

  // I1: Supervisor routing decision — classify objective before any LLM call.
  const supervisorDecision = await runSupervisor(
    {
      objective,
      mentorModeEnabled: env.QODO_MENTOR_MODE === "true",
    },
    state,
    telemetry,
  );
  // Record rationale for this routing decision (J4)
  await recordRationale(
    {
      runId,
      owner,
      repo,
      agent: "supervisor",
      decisionPoint: "pipeline-routing",
      reasoning: supervisorDecision.rationale,
      context: {
        variant: supervisorDecision.variant,
        complexity: supervisorDecision.complexity,
        skipHeavyValidators: supervisorDecision.skipHeavyValidators,
      },
    },
    state,
    storage,
    telemetry,
  );
  // Force Mentor Mode when supervisor mandates it (security / architecture objectives)
  if (supervisorDecision.forceMentorMode && env.QODO_MENTOR_MODE !== "true") {
    runLog.warn("supervisor: forcing MENTOR_MODE for high-risk objective", {
      complexity: supervisorDecision.complexity,
    });
    process.env.QODO_MENTOR_MODE = "true";
  }

  const pipelineStart = Date.now();

  // P1: Open per-objective cost ledger for this run.
  const ledgerCategory = classifyTrustCategory(objective, supervisorDecision.complexity);
  await openLedger(runId, owner, repo, objective, ledgerCategory, state, telemetry).catch((e: unknown) =>
    log.error("ledger-write-failed", { op: "openLedger", runId, err: e instanceof Error ? e.message : String(e) }),
  );

  // ── Approval policy (.qodo/policy.yml `approval`) ───────────────────────
  // Refines the human-approval gate for `autonomy: full`. `mentor`/`dry-run`
  // autonomy already decide the gate, so approval only applies under `full`.
  // This is where the trust ledger finally drives behavior: `trust` mode
  // consults the run's category bond and auto-proceeds when it is bonded.
  if (policy.autonomy === "full" && policy.approval) {
    if (policy.approval === "manual") {
      process.env.QODO_MENTOR_MODE = "true";
      env.QODO_MENTOR_MODE = "true";
      audit(runId, "approval-manual", { category: ledgerCategory });
    } else if (policy.approval === "auto") {
      // Owner pre-approval from the trunk — sovereign and explicit. Record it
      // (and any safety escalation it overrides) so the choice is auditable.
      if (env.QODO_MENTOR_MODE === "true" || supervisorDecision.forceMentorMode) {
        audit(runId, "approval-auto-override", { category: ledgerCategory, supervisorWanted: supervisorDecision.forceMentorMode });
      }
      process.env.QODO_MENTOR_MODE = "false";
      env.QODO_MENTOR_MODE = "false";
    } else if (policy.approval === "trust") {
      const ledger = await loadTrustLedger(owner, repo, state);
      const bond = ledger.bonds.find((b) => b.category === ledgerCategory);
      const trusted = canAutoMerge(bond);
      process.env.QODO_MENTOR_MODE = trusted ? "false" : "true";
      env.QODO_MENTOR_MODE = trusted ? "false" : "true";
      runLog.info("approval: trust mode", { category: ledgerCategory, bond: bond?.score ?? "none", trusted });
      audit(runId, "approval-trust", { category: ledgerCategory, bond: bond?.score ?? null, trusted });
    }
    await telemetry.decision("policy", "approval-applied", {
      mode: policy.approval,
      mentorMode: env.QODO_MENTOR_MODE === "true",
    });
  }

  // Lock heartbeat — renew every 5 minutes to survive long-running phases.
  // Declared as `let` so it can be started only after we know the run is not
  // already complete, and cleared reliably in every exit path.
  const LOCK_RENEW_INTERVAL_MS = 5 * 60 * 1000;
  let lockHeartbeat: ReturnType<typeof setInterval> | null = null;

  // Verifiable Autonomy Receipt: one emit point in `finally` covers every
  // exit — success ("done"), any clean phase/budget halt ("halted", the
  // default), and the fatal path ("failed").
  let receiptOutcome: "done" | "halted" | "failed" = "halted";
  let receiptCtx: PhaseContext | null = null;

  try {
    const s = await loadOrCreateState(state, owner, repo, runId, objective, prNumber, prSha);

    if (s.phase === "done") {
      runLog.info("run already complete; exiting");
      return;
    }

    // ADR-005 durable ack: if this run was started by the resume-loop drain
    // job, record the ack key it polls so the reaper marks the trigger
    // completed instead of requeuing it. This is the run's "first checkpoint" —
    // state is loaded and the run is committed to proceeding. Best-effort:
    // never let a telemetry/ack write abort the pipeline.
    if (env.TRIGGER_TASK_ID) {
      const ackKey = `${TRIGGER_ACK_PREFIX}${env.TRIGGER_TASK_ID}`;
      await state.setJSONWithTTL(ackKey, { runId, prNumber, at: Date.now() }, ACK_TTL_SEC).catch(() => {});
      audit(runId, "trigger-ack", { taskId: env.TRIGGER_TASK_ID, prNumber, source: env.TRIGGER_SOURCE });
    }

    lockHeartbeat = setInterval(async () => {
      const renewed = await state.renewLock(`pr-${prNumber}`).catch(() => false);
      if (!renewed) {
        runLog.warn("lock renewal failed — another agent may have taken over");
      }
    }, LOCK_RENEW_INTERVAL_MS);

    // Post initial anchor comment on the PR
    await reporter.report(s);

    const ctx: PhaseContext = {
      s,
      env,
      deps,
      objective,
      owner,
      repo,
      prNumber,
      prSha,
      runId,
      runLog,
      gh,
      state,
      storage,
      telemetry,
      reporter,
      supervisorDecision,
      ledgerCategory,
      policy,
      targetFiles: new Set<string>(),
      generatedPatch: false,
    };
    receiptCtx = ctx;

    // Budget guard: halt cleanly before the next costly/destructive phase when
    // the per-repo spend cap (.qodo/policy.yml budget.maxUsdCents) is reached.
    // Returns true (and the caller must `return`) once the cap is hit — state
    // is already checkpointed by the prior phase, so this is a clean stop.
    const budgetHalt = async (): Promise<boolean> => {
      const b = budgetStatus();
      if (!b.exceeded) return false;
      runLog.warn("budget cap reached — halting before further spend", { ...b });
      await telemetry.decision("budget", "cap-exceeded", { ...b });
      audit(runId, "budget-halt", { ...b });
      await gh.comment(
        prNumber,
        `⛔ **Budget cap reached** — halted before further work.\n\n` +
          `Estimated spend **$${(b.spentCents / 100).toFixed(2)}** reached the cap ` +
          `**$${(b.capCents / 100).toFixed(2)}** set in \`.qodo/policy.yml\`. ` +
          `Raise \`budget.maxUsdCents\` (on the default branch) and re-run to continue.`,
      ).catch(() => {});
      return true;
    };

    // Preflight estimate (may pause the run for human confirmation)
    if (await runPreflightPhase(ctx) === "halt") return;

    // Architect
    if (s.phase === "idle" || s.phase === "architect") {
      await runArchitectPhase(ctx);
    }

    // Predictive prefetch with edge sharding for massive files
    ctx.targetFiles = new Set(s.plan!.steps.flatMap((step) => step.files));
    if (s.phase === "architect" || s.phase === "coder") {
      await runPrefetchPhase(ctx);
    }

    // Coder
    if (s.phase === "architect" || s.phase === "coder") {
      if (await budgetHalt()) return;
      await runCoderPhase(ctx);
    }

    // Gate
    if (s.phase === "coder" || s.phase === "gate") {
      if (await runGatePhase(ctx) === "halt") return;
    }

    // Mentor gate (optional, only when QODO_MENTOR_MODE=true)
    if (s.phase === "gate") {
      await waitForMentorApproval(state, owner, repo, prNumber, env, telemetry, runId);
    }

    // Commit
    if (s.phase === "gate" || s.phase === "commit") {
      if (await budgetHalt()) return;
      if (await runCommitPhase(ctx) === "halt") return;
    }

    // AST auto-documentation
    if (s.phase === "commit" || s.phase === "astdoc") {
      await runAstdocPhase(ctx);
    }

    // Canary
    if (s.phase === "astdoc" || s.phase === "canary") {
      if (await budgetHalt()) return;
      if (await runCanaryPhase(ctx) === "halt") return;
    }

    // Merge
    if (s.phase === "canary" || s.phase === "merge") {
      if (await budgetHalt()) return;
      if (await runMergePhase(ctx) === "halt") return;
    }

    // Post-merge validation
    if (s.phase === "merge" || s.phase === "postmerge") {
      if (await runPostmergePhase(ctx) === "halt") return;
    }

    // Reviewer
    if (s.phase === "postmerge" || s.phase === "review") {
      await runReviewerPhase(ctx);
    }

    await finalizeRun(ctx, pipelineStart);
    receiptOutcome = "done";
  } catch (err: unknown) {
    receiptOutcome = "failed";
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof PipelineHaltedError) {
      audit(runId, "kill-switch-halted", { reason: env.QODO_HALT_REASON || msg });
    }
    runLog.error("fatal pipeline error", { error: msg });
    await telemetry.decision("run", "fatal-error", { error: msg });
    audit(runId, "run-fatal-error", { error: msg });
    await reporter.fatal(msg).catch((e: unknown) =>
      log.error("ledger-write-failed", { op: "reporter.fatal", runId, err: e instanceof Error ? e.message : String(e) }),
    );
    // V1: Record a trust-ledger failure if the pipeline did not complete.
    await recordOutcome(owner, repo, ledgerCategory, false, 0, state, telemetry).catch((e: unknown) =>
      log.error("ledger-write-failed", { op: "recordOutcome", runId, outcome: "failure", err: e instanceof Error ? e.message : String(e) }),
    );
    // Pass 22 — Record preflight failure outcome too.
    await recordPreflightOutcome(
      classifyRiskTier(objective), 0, false, state, telemetry,
    ).catch(() => {});
    throw err;
  } finally {
    if (receiptCtx) await emitReceipt(receiptCtx, receiptOutcome, pipelineStart);
    if (lockHeartbeat) clearInterval(lockHeartbeat);
    await state.releaseLock(`pr-${prNumber}`);
  }
}
