import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { DurableWorkflowEngine, InjectedCrashError } from "@/lib/durable/engine";
import { MemoryDurableStore } from "@/lib/durable/memory-store";
import { DurablePauseError, type DurableWorkflow, type FaultPoint } from "@/lib/durable/types";
import { createDurableApprovalWait, expireDurableApprovalWait, resolveDurableApprovalWait } from "@/lib/durable/approval-continuation";

interface ScenarioResult {
  id: string;
  boundary: string;
  status: "pass" | "block";
  duplicateSideEffects: number | null;
  lostWork: boolean | null;
  recovery: string;
  operatorVisibility: string;
  finalState: string;
  durationMs: number;
  limitation?: string;
}

async function crashResume(point: FaultPoint): Promise<{ duplicate: number; final: string }> {
  const store = new MemoryDurableStore();
  let sideEffects = 0;
  const workflow: DurableWorkflow<{ value: string }, { artifact: unknown }> = {
    name: `v13_${point}`,
    steps: [
      { id: "prepare", operation: "prepare", kind: "idempotent", async run() { return { ready: true }; } },
      {
        id: "artifact", operation: "artifact.write", kind: "side_effect",
        idempotencyInput: ({ jobId }) => ({ jobId, content: "pilot" }),
        async run() { sideEffects += 1; return { id: "artifact-v13" }; },
      },
    ],
    buildResult(outputs) { return { artifact: outputs.artifact }; },
  };
  const engine = new DurableWorkflowEngine(store, workflow);
  const t0 = new Date("2026-07-11T00:00:00.000Z");
  await engine.createJob({ id: `job-${point}`, tenantId: "tenant-a", workspaceId: "workspace-a", payload: { value: "pilot" }, now: t0 });
  let injected = false;
  try {
    await engine.run(`job-${point}`, {
      workerId: "worker-a", leaseMs: 100, now: () => t0,
      faultInjector(context) {
        if (!injected && context.point === point) { injected = true; throw new InjectedCrashError(point); }
      },
    });
  } catch (error) {
    if (!(error instanceof InjectedCrashError)) throw error;
  }
  const second = await engine.run(`job-${point}`, {
    workerId: "worker-b", leaseMs: 100, now: () => new Date(t0.getTime() + 101),
  });
  return { duplicate: sideEffects, final: second.status };
}

async function unknownOutcome(): Promise<{ duplicate: number; final: string }> {
  const store = new MemoryDurableStore();
  let sideEffects = 0;
  const workflow: DurableWorkflow<{}, unknown> = {
    name: "v13_unknown_outcome",
    steps: [{
      id: "external_write", operation: "external.write", kind: "side_effect",
      async run() { sideEffects += 1; throw new InjectedCrashError("inside_external_call_after_effect"); },
    }],
    buildResult(outputs) { return outputs; },
  };
  const engine = new DurableWorkflowEngine(store, workflow);
  const t0 = new Date("2026-07-11T00:00:00.000Z");
  await engine.createJob({ id: "unknown-job", payload: {}, now: t0 });
  try { await engine.run("unknown-job", { workerId: "a", leaseMs: 100, now: () => t0 }); } catch {}
  const second = await engine.run("unknown-job", { workerId: "b", leaseMs: 100, now: () => new Date(t0.getTime() + 101) });
  return { duplicate: sideEffects, final: second.status };
}

async function approvalRestart(): Promise<{ duplicate: number; final: string }> {
  const store = new MemoryDurableStore();
  let approved = false;
  let sideEffects = 0;
  const workflow: DurableWorkflow<{}, unknown> = {
    name: "v13_approval_restart",
    steps: [
      { id: "approval", operation: "approval.wait", kind: "idempotent", async run() { if (!approved) throw new DurablePauseError("approval", 1_000); return true; } },
      { id: "write", operation: "artifact.write", kind: "side_effect", async run() { sideEffects += 1; return "ok"; } },
    ],
    buildResult(outputs) { return outputs; },
  };
  const engine = new DurableWorkflowEngine(store, workflow);
  const t0 = new Date("2026-07-11T00:00:00.000Z");
  await engine.createJob({ id: "approval-job", payload: {}, now: t0 });
  const first = await engine.run("approval-job", { workerId: "pre", now: () => t0 });
  if (first.status !== "waiting") throw new Error("approval_did_not_pause");
  approved = true;
  const second = await engine.run("approval-job", { workerId: "post", now: () => new Date(t0.getTime() + 1001) });
  return { duplicate: sideEffects, final: second.status };
}

const results: ScenarioResult[] = [];
async function run(id: string, boundary: string, fn: () => Promise<{ duplicate: number; final: string }>, expectedFinal: string, expectedEffects: number, visibility: string) {
  const started = performance.now();
  try {
    const outcome = await fn();
    const passed = outcome.final === expectedFinal && outcome.duplicate === expectedEffects;
    results.push({ id, boundary, status: passed ? "pass" : "block", duplicateSideEffects: outcome.duplicate, lostWork: false, recovery: passed ? "automatic" : "unexpected", operatorVisibility: visibility, finalState: outcome.final, durationMs: Math.round(performance.now() - started) });
  } catch (error) {
    results.push({ id, boundary, status: "block", duplicateSideEffects: null, lostWork: null, recovery: "failed", operatorVisibility: visibility, finalState: "error", durationMs: Math.round(performance.now() - started), limitation: error instanceof Error ? error.message : String(error) });
  }
}

await run("FI-01", "process termination after lease", () => crashResume("after_claim"), "completed", 1, "lease expiry and worker takeover");
await run("FI-02", "termination before step", () => crashResume("before_step"), "completed", 1, "checkpoint remains unchanged");
await run("FI-03", "termination after receipt persisted", () => crashResume("after_receipt_started"), "needs_reconciliation", 0, "ambiguous receipt is visible");
await run("FI-04", "termination after side effect and completed receipt", () => crashResume("after_side_effect"), "completed", 1, "completed receipt prevents replay");
await run("FI-05", "termination after checkpoint", () => crashResume("after_checkpoint"), "completed", 1, "next checkpoint resumes");
await run("FI-06", "termination before final commit", () => crashResume("before_complete"), "completed", 1, "committed checkpoints allow finalization");
await run("FI-07", "unknown result after external effect", unknownOutcome, "needs_reconciliation", 1, "explicit reconciliation state");
await run("FI-08", "approval wait and application restart", approvalRestart, "completed", 1, "persistent continuation contract");

const wait = createDurableApprovalWait({ id: "approval", jobId: "job", runId: "run", stepId: "step", toolCallId: "tool", requestedBy: "agent", expiresAt: "2026-07-11T00:05:00Z", requestedAt: "2026-07-11T00:00:00Z" });
let staleRejected = false;
try { resolveDurableApprovalWait(wait, { decision: "approved", actorId: "operator", expectedRevision: 9, now: new Date("2026-07-11T00:01:00Z") }); } catch { staleRejected = true; }
results.push({ id: "FI-09", boundary: "stale browser approval", status: staleRejected ? "pass" : "block", duplicateSideEffects: 0, lostWork: false, recovery: "refresh required", operatorVisibility: "revision conflict", finalState: staleRejected ? "rejected" : "incorrectly accepted", durationMs: 0 });
const expired = expireDurableApprovalWait(wait, new Date("2026-07-11T00:06:00Z"));
results.push({ id: "FI-10", boundary: "approval expiry", status: expired.status === "expired" ? "pass" : "block", duplicateSideEffects: 0, lostWork: false, recovery: "new authority required", operatorVisibility: "expired terminal state", finalState: expired.status, durationMs: 0 });

const blocked = [
  ["FI-11", "database lock across native SQLite processes", "Requires isolated native CI lane."],
  ["FI-12", "outbox delay and duplicate publisher delivery", "Transactional outbox exists; multi-process delivery proof requires native CI."],
  ["FI-13", "model timeout during live provider call", "Pilot excludes remote live providers until restart-safe model intents exist."],
  ["FI-14", "malformed live model output", "Simulation schema tests exist; live provider E2E is unsupported by pilot."],
  ["FI-15", "network loss during provider call", "Remote provider operation is outside frozen pilot scope."],
  ["FI-16", "filesystem write denial", "Needs disposable OS-level fault lane."],
  ["FI-17", "disk full during artifact write", "Needs disposable filesystem quota lane."],
  ["FI-18", "backup interruption", "Needs child-process termination around real application database backup."],
  ["FI-19", "restore interruption", "Needs clean disposable target and process termination."],
  ["FI-20", "multi-process stale worker commit", "Fencing is unit-tested; real SQLite process race remains CI-only."],
  ["FI-21", "tenant switch through browser", "Backend property tests pass; browser E2E remains CI-only."],
  ["FI-22", "verifier evidence mismatch against final ZIP", "Executed only after final archive hash exists."],
  ["FI-23", "browser offline transition", "Requires Playwright validation lane."],
  ["FI-24", "accessibility failure state", "Requires browser accessibility lane."],
  ["FI-25", "production restart with pending approval", "Pure and route-level continuation is implemented; native process proof remains CI-only."],
] as const;
for (const [id, boundary, limitation] of blocked) results.push({ id, boundary, status: "block", duplicateSideEffects: null, lostWork: null, recovery: "environment or scope blocked", operatorVisibility: "pilot readiness blocker", finalState: "unproven", durationMs: 0, limitation });

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scope: "Deterministic source-level failure matrix. It proves portable durability properties and explicitly blocks native, browser, remote-provider, and OS fault claims that were not executed.",
  summary: { total: results.length, passed: results.filter((r) => r.status === "pass").length, blocked: results.filter((r) => r.status === "block").length },
  results,
};
const out = path.join(process.cwd(), "docs/canonical/evidence/v13");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "pilot-failure-matrix.json"), JSON.stringify(report, null, 2) + "\n");
fs.writeFileSync(path.join(out, "pilot-failure-matrix.md"), [
  "# v13 Pilot Failure-Injection Matrix", "", report.scope, "",
  `Result: **${report.summary.passed}/${report.summary.total} source-level scenarios passed; ${report.summary.blocked} remain blocking or out of scope.**`, "",
  "| ID | Boundary | Status | Side effects | Final state | Limitation |", "|---|---|---|---:|---|---|",
  ...results.map((r) => `| ${r.id} | ${r.boundary} | ${r.status.toUpperCase()} | ${r.duplicateSideEffects ?? "unknown"} | ${r.finalState} | ${r.limitation ?? "-"} |`), "",
].join("\n"));
console.log(`v13 pilot failure matrix: ${report.summary.passed}/${report.summary.total} passed; ${report.summary.blocked} blocked.`);
if (results.slice(0, 10).some((r) => r.status !== "pass")) process.exit(1);
