/**
 * CLI entry point — argument parsing + mode dispatch.
 *
 * The pipeline orchestration lives in ./pipeline/run-pipeline.ts (phase
 * handlers under ./pipeline/phases/); this file only selects a mode:
 *
 *   (default)                    → runPipeline (Architect → … → Review)
 *   --janitor-mode               → repo hygiene findings + PRs
 *   --evolve                     → Darwin engine prompt-mutation pass
 *   --compliance-mode            → compliance scan + remediation PRs
 *   --support-ticket-discovery   → enqueue objectives from support tickets
 *   --dry-run                    → pipeline halts before any destructive op
 */
// MUST be first: redirects the --eval audit log to a temp workspace before
// pipeline/helpers.ts freezes WORKSPACE_ROOT (see the module's own comment).
import "./services/local/eval-workspace.js";
import "dotenv/config";
import { GitHubClient } from "./services/github-client.js";
import { RedisState } from "./services/redis-state.js";
import { R2Storage } from "./services/r2-storage.js";
import { Telemetry } from "./services/telemetry.js";
import { throttledBatch } from "./utils/rate-limiter.js";
import { runComplianceScan, openCompliancePRs } from "./agents/compliance-oracle.js";
import { runJanitor, createJanitorPR } from "./agents/janitor.js";
import { runDarwinEngine } from "./agents/darwin-engine.js";
import { log } from "./services/logger.js";
import { validateAndCoerce } from "./services/env-validator.js";
import { initDryRun } from "./services/dry-run.js";
import { resolveSupportTicketConfig, discoverTicketObjectives } from "./services/support-ticket-bridge.js";
import { readFileSync } from "node:fs";
import { splitRepo } from "./pipeline/helpers.js";
import { runPipeline } from "./pipeline/run-pipeline.js";
import { RedisTriggerQueue, StoreTriggerQueue, type TriggerTask, type TriggerQueue } from "./services/trigger-queue.js";
import { FileDurableStore } from "./services/sovereign-store.js";
import { GitRefQueue, CliGitRunner, githubRemote, cleanupDir, DEFAULT_QUEUE_REF } from "./services/git-ref-store.js";
import { drainTriggerQueue } from "./pipeline/drain-trigger-queue.js";
import { resolve } from "node:path";
import { loadPolicyFromDisk, describePolicy, loadPolicy } from "./services/policy.js";
import { runDoctor } from "./services/doctor.js";
import { createLocalDeps } from "./services/local/in-memory-adapters.js";
import { buildEvalReport } from "./services/eval-report.js";
import { WORKSPACE_ROOT } from "./pipeline/helpers.js";
import { appendAuditEntry } from "./services/audit-log.js";
import { resolveRelayLineage } from "./pipeline/relay-lineage.js";
import { runRehearsal } from "./services/rehearsal.js";
import { stashRehearsalEnvelope } from "./pipeline/receipt-emitter.js";
import { verifyReceipt, type AutonomyReceipt } from "./services/receipt.js";

// Re-exported so tests and embedders keep their existing import path.
export { runPipeline } from "./pipeline/run-pipeline.js";
export type { PipelineDeps } from "./pipeline/context.js";

async function runJanitorMode() {
  const [owner, repo] = splitRepo();
  const env = validateAndCoerce();
  const gh = new GitHubClient(env.GITHUB_TOKEN, owner, repo);
  const state = new RedisState(env);
  const runId = `janitor-${Date.now()}`;
  const telemetry = new Telemetry(runId, state);
  const shas = await gh.getPRShas(0);
  const files = shas ? await gh.listFilesAtRef(shas.head) : [];
  const contents = await throttledBatch(files, 5, 200, async (path) => {
    const content = await gh.getFileAtRef(path, shas?.head || "HEAD");
    return { path, content: content || "" };
  });
  const findings = await runJanitor(gh, owner, repo, contents, telemetry);
  for (const finding of findings) {
    await createJanitorPR(gh, owner, repo, finding, telemetry);
  }
  log.info(`janitor mode complete`, { findings: findings.length });
}

async function runEvolveMode() {
  const [owner, repo] = splitRepo();
  const env = validateAndCoerce();
  const gh = new GitHubClient(env.GITHUB_TOKEN, owner, repo);
  const state = new RedisState(env);
  const runId = `evolve-${Date.now()}`;
  const telemetry = new Telemetry(runId, state);
  await runDarwinEngine(gh, owner, repo, state, telemetry);
}

async function runComplianceMode() {
  const [owner, repo] = splitRepo();
  const env = validateAndCoerce();
  const gh = new GitHubClient(env.GITHUB_TOKEN, owner, repo);
  const state = new RedisState(env);
  const storage = new R2Storage(env);
  const runId = `compliance-${Date.now()}`;
  const telemetry = new Telemetry(runId, state);

  log.info("compliance oracle starting", { owner, repo });
  const findings = await runComplianceScan(gh, telemetry);

  if (findings.length === 0) {
    log.info("compliance oracle: no findings — repo is compliant ✅");
    return;
  }

  log.info(`compliance oracle: ${findings.length} finding(s); opening PRs…`);
  await openCompliancePRs(gh, storage, findings, telemetry);
}

/** T1/T2: Discover support-ticket objectives and push them to the mission queue. */
export async function runSupportTicketDiscovery(): Promise<void> {
  const env = validateAndCoerce();
  const state = new RedisState(env);
  const runId = `support-discovery-${Date.now()}`;
  const telemetry = new Telemetry(runId, state);

  const cfg = resolveSupportTicketConfig();
  if (!cfg) {
    log.info("support-ticket-discovery: no config; skipping");
    return;
  }

  const objectives = await discoverTicketObjectives(cfg, state, telemetry);
  if (!objectives.length) {
    log.info("support-ticket-discovery: no new objectives");
    return;
  }

  const { enqueueMission } = await import("./services/mission-priority.js");
  for (const o of objectives) {
    await enqueueMission(
      {
        id: `ticket:${o.ticketId}`,
        objective: o.objective,
        complexity: "medium",
        urgency: o.priorityBoost >= 1.5 ? "critical" : o.priorityBoost >= 1.2 ? "high" : "medium",
        impact: o.affectedUserCount > 1 ? "high" : "medium",
        enqueuedAt: new Date().toISOString(),
      },
      state,
    );
  }

  log.info("support-ticket-discovery: enqueued objectives", { count: objectives.length });
}

/** Parse a positive integer env var, falling back when unset/blank/NaN. */
function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * ADR-005 resume-loop consumer. Drains the trigger queue, dispatching the
 * agent-pipeline workflow for each queued trigger (resuming the correct PR),
 * with the processing-list + durable-ack + reaper reliability model.
 *
 * SOVEREIGN by default: the queue is backed by the filesystem
 * (`FileDurableStore`, zero external services). Upstash Redis is used ONLY when
 * `UPSTASH_REDIS_REST_URL`/`_TOKEN` are present — an optional adapter, never a
 * requirement. Deliberately does NOT call `validateAndCoerce()`, so a fork/CI
 * without secrets drains cleanly (empty queue → exit 0) instead of crashing on
 * missing env. Without a `GITHUB_TOKEN` there is nothing to dispatch to, so the
 * run falls back to reap-only (reconcile the queue, dispatch nothing).
 */
export async function runDrainTriggerQueue(): Promise<void> {
  const hasRedis = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
  const githubToken = process.env.GITHUB_TOKEN || "";
  // Opt-in Git-ref durability (sovereign Step 2): the queue survives between the
  // ephemeral drain ticks by living in a Git ref, with no external service.
  // `1`/`true` selects the default ref; any other value is used verbatim.
  const gitRefRaw = process.env.QODO_QUEUE_GIT_REF;
  const gitRef = gitRefRaw ? (gitRefRaw === "1" || gitRefRaw === "true" ? DEFAULT_QUEUE_REF : gitRefRaw) : undefined;
  const remote = gitRef ? githubRemote(process.env.REPO || "", githubToken) : null;

  let queue: TriggerQueue;
  let substrate: string;
  let gitQueue: GitRefQueue | null = null;
  let gitDir: string | null = null;
  if (hasRedis) {
    queue = new RedisTriggerQueue(new RedisState());
    substrate = "redis";
  } else if (gitRef && remote) {
    gitDir = resolve(process.env.QODO_QUEUE_DIR || ".qodo/queue-worktree");
    const runner = new CliGitRunner({ dir: gitDir, remoteUrl: remote.remoteUrl, authHeader: remote.authHeader });
    gitQueue = new GitRefQueue(gitDir, gitRef, runner);
    queue = new StoreTriggerQueue(gitQueue.store);
    substrate = `git:${gitRef}`;
  } else {
    const dir = resolve(process.env.QODO_QUEUE_DIR || ".qodo/trigger-queue");
    queue = new StoreTriggerQueue(new FileDurableStore(dir));
    substrate = `file:${dir}`;
  }

  const runId = `drain-${Date.now()}`;
  // Telemetry over a degrading RedisState — a no-op sink when Redis is absent,
  // real telemetry when it is present. It never makes Redis a requirement.
  const telemetry = new Telemetry(runId, new RedisState());

  // Dispatch a queued trigger by firing the agent-pipeline workflow with the
  // PR number + task id, so the resumed run targets the existing PR and writes
  // its ack key. Uses the GitHub REST API with the job's GITHUB_TOKEN.
  async function dispatch(task: TriggerTask): Promise<void> {
    const ref = task.defaultBranch || "main";
    const r = await fetch(
      `https://api.github.com/repos/${task.owner}/${task.repo}/actions/workflows/agent-pipeline.yml/dispatches`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          ref,
          inputs: {
            objective: task.objective || `Resume PR #${task.prNumber ?? ""}`,
            issue_number: String(task.prNumber ?? ""),
            task_id: task.taskId,
            trigger: task.trigger,
            dry_run: "false",
          },
        }),
      },
    );
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`workflow_dispatch failed ${r.status}: ${text.slice(0, 200)}`);
    }
  }

  // Reap-only when explicitly requested OR when there's no token to dispatch
  // with — reconciliation is always safe and needs no credentials.
  const reapOnly = process.env.QODO_TRIGGER_REAP_ONLY === "true" || !githubToken;
  if (!githubToken && process.env.QODO_TRIGGER_REAP_ONLY !== "true") {
    log.info("drain-trigger-queue: no GITHUB_TOKEN; running reap-only (reconcile, no dispatch)", { substrate });
  }
  const summary = await drainTriggerQueue({
    queue,
    // In reap-only mode, never dispatch — just reconcile the processing list.
    dispatch: reapOnly ? async () => { throw new Error("reap-only: dispatch disabled"); } : dispatch,
    emit: (event, data) => {
      void telemetry.decision("trigger", event, data);
    },
    staleMs: intEnv("QODO_TRIGGER_STALE_MS", 15 * 60 * 1000),
    maxAttempts: intEnv("QODO_TRIGGER_MAX_ATTEMPTS", 3),
    // reap-only: process zero new tasks (the reap pass already ran first).
    maxBatch: reapOnly ? 0 : intEnv("QODO_TRIGGER_MAX_BATCH", 25),
  });

  // Queue-depth snapshot so backlog and dead-letter accumulation are visible
  // in the job log and telemetry — a poison backlog must never be silent.
  const depth = await queue.depth();
  void telemetry.decision("trigger", "trigger.depth", { ...depth });
  if (depth.dead > 0) {
    log.warn("drain-trigger-queue: dead-letter backlog present — inspect the dead-letter list", {
      dead: depth.dead,
      queued: depth.queued,
      processing: depth.processing,
    });
    void telemetry.decision("trigger", "trigger.dead_letter.present", { dead: depth.dead });
  }

  // Persist the queue state back to the Git ref (Step 2). Best-effort: a push
  // conflict or transient Git error never fails the drain — the next tick
  // reconciles, and any already-fired dispatch is idempotent behind the run
  // lock. Only the git substrate has anything to persist.
  let persisted: string | undefined;
  if (gitQueue) {
    try {
      persisted = gitQueue.persist(`drain: ${summary.dispatched} dispatched, ${summary.completed} completed, ${summary.requeued} requeued, ${summary.dead} dead`);
      if (persisted === "conflict") {
        log.warn("drain-trigger-queue: git-ref moved during drain; skipping persist (next tick reconciles)");
        void telemetry.decision("trigger", "trigger.persist.conflict", {});
      }
    } catch (err) {
      log.warn("drain-trigger-queue: git-ref persist failed (best-effort)", { error: err instanceof Error ? err.message : String(err) });
      persisted = "error";
    } finally {
      if (gitDir) cleanupDir(gitDir);
    }
  }

  log.info("drain-trigger-queue complete", { ...summary, ...depth, reapOnly, substrate, ...(persisted ? { persisted } : {}) });
}

/**
 * `--eval` — the sovereign premium evaluation mode. Runs the ENTIRE real
 * delivery pipeline (Architect → Coder → 5-gate → Commit → Canary → Merge →
 * Review) fully in-process: a deterministic local LLM simulator, in-memory
 * Redis/R2/GitHub, an isolated hash-chained audit log. No network, no vendor
 * API, no credentials — governed by the owner's own `.qodo/policy.yml`. Prints
 * a single-screen evaluation report proving the system is functional at its
 * maximum practical capability. For private owner evaluation only.
 */
export async function runEvalMode(argv: string[] = process.argv): Promise<number> {
  const owner = process.env.QODO_EVAL_OWNER || "acme";
  const repo = process.env.QODO_EVAL_REPO || "widget";
  const objArg = argv.find((a) => a.startsWith("--objective="));
  const objective =
    (objArg ? objArg.slice("--objective=".length) : "") ||
    process.env.QODO_EVAL_OBJECTIVE ||
    process.env.OBJECTIVE ||
    "Add an input-validating utility with unit tests";

  // Sovereign intelligence: deterministic offline simulator (unless the owner
  // opted into a local Ollama server, which stays fully on-device too).
  process.env.QODO_LLM_SIM = process.env.OLLAMA_BASE_URL ? "false" : "true";
  const llmPath: "simulation" | "ollama" = process.env.OLLAMA_BASE_URL ? "ollama" : "simulation";

  // Placeholder values so env validation passes; none are ever dialled — the
  // in-memory adapters replace every service they name.
  process.env.GITHUB_TOKEN ||= "eval-local-token-placeholder";
  process.env.UPSTASH_REDIS_REST_URL ||= "https://eval.local";
  process.env.UPSTASH_REDIS_REST_TOKEN ||= "eval-local-token-placeholder";
  process.env.REPO ||= `${owner}/${repo}`;
  process.env.OBJECTIVE = objective;

  const deps = createLocalDeps(owner, repo, process.cwd());
  // Pre-approve the mentor gate so a policy of `autonomy: mentor` / `approval:
  // manual` demonstrates the loop end-to-end instead of blocking a headless,
  // non-interactive evaluation. The approval is recorded in the audit chain.
  await deps.state.setJSON(`qodo:v24:mentor:${owner}:${repo}:1`, { status: "approved", reason: "eval: owner pre-approval" });

  log.info("eval: starting sovereign premium run", { owner, repo, objective, llmPath });
  const start = Date.now();
  let outcome: "success" | "halted" | "error" = "success";
  let error: string | undefined;
  try {
    await runPipeline({ owner, repo, objective, prNumber: 1, prSha: "eval-sha", ...deps });
  } catch (e: unknown) {
    outcome = "error";
    error = e instanceof Error ? e.message : String(e);
    log.warn("eval: pipeline ended with an error", { error });
  }

  // Distinguish a clean completion from a deliberate halt (dry-run / budget /
  // gate) by whether the success bookkeeping recorded a trust bond.
  if (outcome !== "error") {
    const ledger = await deps.state.getJSON(`qodo:v24:trust-ledger:${owner}:${repo}`);
    outcome = ledger ? "success" : "halted";
  }

  const policy = await loadPolicy(deps.gh, "heads/main");
  const report = await buildEvalReport({
    objective, owner, repo, llmPath,
    durationMs: Date.now() - start,
    outcome, error,
    state: deps.state, gh: deps.gh, policy,
    workspaceRoot: WORKSPACE_ROOT,
  });
  console.log(report); // eslint-disable-line no-console
  return outcome === "error" ? 1 : 0;
}

const USAGE = `qodo — self-healing AI agent for autonomous software delivery

Usage: node packages/agent/dist/cli.js [mode] [flags]

Modes (default: run the delivery pipeline)
  (no flag)                   Architect → Coder → 5-gate validator → Ghost
                              Commit → Canary → Merge → SRE watch → Review
  --janitor-mode              Repo hygiene findings, opened as PRs
  --evolve                    Darwin engine prompt-mutation pass (opens a PR)
  --compliance-mode           Compliance scan + remediation PRs
  --support-ticket-discovery  Enqueue objectives from support tickets
  --drain-trigger-queue       Drain the resume queue: dispatch pipeline runs
                              for /qodo proceed and webhook triggers (ADR-005)

Flags
  --dry-run                   Run plan/code/gate, then halt before the first
                              destructive operation (commit, deploy, merge)
                              and post a simulation report. Also: DRY_RUN=true
  --policy                    Show this repo's effective control surface from
                              the local .qodo/policy.yml (budget, autonomy,
                              approval). No configuration required.
  --doctor                    One-shot readiness check: configuration present?
                              policy valid? what will the next run do? Local,
                              no network. Exits non-zero if not ready.
  --eval [--objective=…]      Sovereign premium evaluation: run the WHOLE
                              pipeline fully in-process — deterministic local
                              LLM, in-memory services, isolated audit log — and
                              print an evaluation report. No network, no keys,
                              governed by your .qodo/policy.yml. (Owner-only.)
  --rehearse                  $0 pre-flight before the real run: simulate the
                              whole mission in-process first and bind the
                              rehearsal envelope hash into the run's receipt.
                              Also: QODO_REHEARSE=true. Add
                              QODO_REHEARSE_ENFORCE=true to halt when the
                              rehearsal gate stays closed.
  --receipt-verify <file>     Verify a Verifiable Autonomy Receipt offline
                              [--audit <ndjson>] [--key <hmac-key>]. Exits
                              non-zero when any check fails. See docs/RECEIPTS.md.
  --help, -h                  Show this help (no configuration required)
  --version                   Show the agent version

Configuration
  Required env: GITHUB_TOKEN, GROQ_API_KEY (or another provider key),
  UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, REPO, OBJECTIVE.
  Full reference: .env.example · Guided setup: node bootstrap.mjs
  Check your configuration without running anything: node bootstrap.mjs --verify
`;

function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Help and version must work with zero configuration — before env validation.
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(USAGE); // eslint-disable-line no-console
    process.exit(0);
  }
  if (process.argv.includes("--version")) {
    console.log(packageVersion()); // eslint-disable-line no-console
    process.exit(0);
  }
  // --policy: local-first control-surface inspector. Reads the working tree's
  // .qodo/policy.yml, needs zero credentials, and exits non-zero if the file
  // is present but invalid — so an owner can verify their sovereign controls
  // (and CI can lint them) before a real run.
  if (process.argv.includes("--policy")) {
    const loaded = loadPolicyFromDisk();
    console.log(describePolicy(loaded)); // eslint-disable-line no-console
    process.exit(loaded.error ? 1 : 0);
  }
  // --doctor: one-shot readiness — "am I set up, what's in control, what will
  // the next run do?" Local presence checks only (no network, no secret
  // values printed). Exit non-zero when a required setting is missing or the
  // policy is invalid, so it doubles as a pre-run gate in scripts/CI.
  if (process.argv.includes("--doctor")) {
    const report = runDoctor();
    console.log(report.text); // eslint-disable-line no-console
    process.exit(report.ready ? 0 : 1);
  }
  // --receipt-verify: offline verification of a Verifiable Autonomy Receipt.
  // Zero configuration, zero network — anyone holding the receipt (and
  // optionally the audit log + signing key) can check it.
  if (process.argv.includes("--receipt-verify")) {
    const idx = process.argv.indexOf("--receipt-verify");
    const receiptPath = process.argv[idx + 1];
    if (!receiptPath || receiptPath.startsWith("--")) {
      console.error("usage: --receipt-verify <receipt.json> [--audit <.audit-log.ndjson>] [--key <hmac-key>]"); // eslint-disable-line no-console
      process.exit(1);
    }
    const auditIdx = process.argv.indexOf("--audit");
    const keyIdx = process.argv.indexOf("--key");
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as AutonomyReceipt;
    const auditNdjson = auditIdx > -1 ? readFileSync(process.argv[auditIdx + 1], "utf8") : undefined;
    const key = keyIdx > -1 ? process.argv[keyIdx + 1] : process.env.QODO_RECEIPT_KEY;
    verifyReceipt(receipt, { key: key || undefined, auditNdjson })
      .then((r) => {
        for (const c of r.checks) {
          console.log(`  ${c.ok ? "✓" : "✕"} ${c.name.padEnd(18)} ${c.detail}`); // eslint-disable-line no-console
        }
        console.log(r.valid ? "\nRECEIPT VALID ✓" : "\nRECEIPT INVALID ✕"); // eslint-disable-line no-console
        process.exit(r.valid ? 0 : 1);
      })
      .catch((err) => {
        log.error("receipt-verify error", { error: err instanceof Error ? err.message : String(err) });
        process.exit(1);
      });
  } else
  // --drain-trigger-queue: the ADR-005 resume-loop consumer. Sovereign by
  // default (filesystem-backed queue, zero external services), so it must run
  // BEFORE the strict env validation below — a fork without Upstash/GROQ
  // secrets should drain cleanly, not crash on missing env.
  if (process.argv.includes("--drain-trigger-queue")) {
    runDrainTriggerQueue().catch((err) => {
      log.error("drain-trigger-queue error", { error: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    });
  } else
  // --eval: sovereign premium evaluation. Sets its own (sim + placeholder) env
  // and runs the whole pipeline in-process, so it must short-circuit before the
  // normal env validation / dry-run arming below.
  if (process.argv.includes("--eval")) {
    runEvalMode()
      .then((code) => process.exit(code))
      .catch((err) => {
        log.error("eval error", { error: err instanceof Error ? err.message : String(err) });
        process.exit(1);
      });
  } else {
  validateAndCoerce();
  // Arm dry-run mode before any pipeline work: with --dry-run (or
  // DRY_RUN=true) the run halts before the first destructive operation
  // (Ghost Commit / canary deploy / merge) and emits a simulation report.
  initDryRun(process.argv);
  if (process.argv.includes("--janitor-mode")) {
    runJanitorMode().catch((err) => {
      log.error("janitor error", { error: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    });
  } else if (process.argv.includes("--support-ticket-discovery")) {
    runSupportTicketDiscovery().catch((err) => {
      log.error("support-ticket-discovery error", { error: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    });
  } else if (process.argv.includes("--evolve")) {
    runEvolveMode().catch((err) => {
      log.error("evolve error", { error: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    });
  } else if (process.argv.includes("--compliance-mode")) {
    runComplianceMode().catch((err) => {
      log.error("compliance oracle unhandled error", { error: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    });
  } else {
    runDeliveryWithOptionalRehearsal().catch((err) => {
      log.error("unhandled pipeline error", { error: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    });
  }
  }
}

/**
 * Default delivery run, optionally preceded by the $0 rehearsal
 * (`--rehearse` / QODO_REHEARSE=true): the whole pipeline runs in-process on
 * the deterministic simulator first, and its envelope hash is bound into the
 * run's Verifiable Autonomy Receipt. With QODO_REHEARSE_ENFORCE=true a
 * rehearsal whose gate stayed CLOSED halts the real run before any spend.
 */
async function runDeliveryWithOptionalRehearsal(): Promise<void> {
  const wantRehearsal = process.argv.includes("--rehearse") || process.env.QODO_REHEARSE === "true";
  if (wantRehearsal) {
    const env = validateAndCoerce();
    const [owner, repo] = (env.REPO ?? "unknown/unknown").split("/");
    const objective = env.OBJECTIVE ?? "No objective supplied";
    try {
      const envelope = await runRehearsal(owner, repo, objective);
      stashRehearsalEnvelope(envelope);
      // task-56: rehearsal-completed/-blocked can be the TRUE first entry
      // of this run's chain (they fire before runPipeline()'s own
      // audit("run-started") call below) — must use the same relay
      // genesis run-pipeline.ts will use, or a --rehearse run would start
      // its chain from the wrong seed.
      const { genesis } = resolveRelayLineage(WORKSPACE_ROOT);
      appendAuditEntry(WORKSPACE_ROOT, "rehearsal-completed", "qodo-agent", {
        envelopeSha256: envelope.envelopeSha256,
        gateOpen: envelope.gateOpen,
        phases: envelope.phasesWalked.length,
      }, genesis);
      if (!envelope.gateOpen && process.env.QODO_REHEARSE_ENFORCE === "true") {
        appendAuditEntry(WORKSPACE_ROOT, "rehearsal-blocked", "qodo-agent", {
          envelopeSha256: envelope.envelopeSha256,
        }, genesis);
        log.error("rehearsal gate CLOSED and QODO_REHEARSE_ENFORCE=true — real run halted before any spend");
        process.exit(2);
      }
    } catch (e: unknown) {
      // Evidence, not a new failure mode: a broken rehearsal never blocks the
      // real run unless enforcement was explicitly requested.
      log.warn("rehearsal failed — continuing to the real run", { error: e instanceof Error ? e.message : String(e) });
    }
  }
  await runPipeline();
}
