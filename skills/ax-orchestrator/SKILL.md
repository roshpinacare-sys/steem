---
name: ax-orchestrator
description: "Use when declaring, gating, or running declarative agent tasks in SAOS (the הכרזה plane) — writing ax.saos/v1alpha1 manifests, applying Task/Workspace/Model resources, budgeting agent loops (maxSteps/maxMs), suspending/resuming mid-run with exact checkpoints, or diagnosing RunnerLost zombies. Enforces the strict manifest gate (exact apiVersion, protojson unknown-field rejection, RFC1123 names, multi-doc refusal, undeclared-ref refusal) and the honest terminal law (Succeeded only on action:finish; budget exhaustion = Failed + BudgetExhausted=True)."
license: Apache-2.0
metadata:
  adapted-from: "google/ax — declarative agentic orchestration runtime (kubectl-shaped semantics: YAML manifests ax.io/v1alpha1 Task/Workspace/Model, apply/get/describe/suspend/resume/delete)"
  saos-adoption: "v113 · הכרזה (AX) — docs/AX-ADOPTION.md (rebuild-v113 wave, restored from the recovery-v110 spec)"
  code-level: "src/lib/saos/ax.ts — gateManifest (zod strict) + axReconcile (single runner) + runTaskLoop (budget law, blocked-JSON analyst, repair step) + axSuspend/axResume/axDelete + axZombieSweep"
---

# AX Orchestrator (SAOS adaptation)

The הכרזה plane turns "run an agent" into **declaring a resource**: you write a manifest, the gate either accepts it with the force of law or refuses it with named reasons, and a single runner reconciles reality toward the declaration. Nothing runs that was not first declared and gated.

## The manifest gate (protojson discipline)

A manifest is YAML or JSON, **one document only** (multi-doc is refused — declare resources one at a time). Every level is strict: an **undeclared field is refused at every level**, exactly like protojson rejects unknown fields.

```yaml
apiVersion: ax.saos/v1alpha1   # exact string — no translation
kind: Task                      # Task | Workspace | Model
metadata:
  name: my-task                 # RFC1123-style: [a-z0-9]([-a-z0-9]*[a-z0-9])?, ≤63 chars
spec:
  goal: "..."                   # required for Task, ≤2000 chars
  maxSteps: 8                   # optional, ≤12 (gate cap)
  maxMs: 120000                 # optional, ≤300000 (gate cap)
  workspaceRef: saos-repo       # optional — must match a declared Workspace
  modelRef: zai-default         # optional — must match a declared Model
```

Gate laws, each enforced in `gateManifest()`:
1. **Exact apiVersion** — `ax.saos/v1alpha1` precisely; near-misses are refusals, not suggestions.
2. **Unknown fields refused at every level** (zod `.strict()`) — a typo must never silently become a default.
3. **Name law** — RFC1123-style port (lowercase alphanumerics + `-`, starts/ends alphanumeric, ≤63).
4. **Undeclared refs refused** — `workspaceRef`/`modelRef` must name an existing registry entry.
5. **Budget caps at the gate** — `maxSteps ≤ 12`, `maxMs ≤ 300000` (defaults 8 / 120000).
6. **Duplicate Task name refused (422)** — apply is deterministic; it does not silently mutate a live task.
7. **Workspace root must be inside the repo tree** and exist on disk (house law 8: no hand on a foreign tree).

## The single runner (reconcile)

One task runs at a time (2-core house law). Others stay `Pending` in FIFO order. Reconcile runs on every API GET and after every state change: zombie sweep → continue any `Running` task (resume case) → claim the oldest `Pending`.

## The budget law + honest terminals

Budget is enforced **before every step**, never after: `stepsUsed < maxSteps` and `msUsed < maxMs` or the loop does not open the next step.

Terminal states (v110 loop-discipline law: error/exhaustion are never success):
- `Succeeded` — **only** when the analyst replied `action:"finish"` (reason `TaskFinished`).
- `Failed` + condition `BudgetExhausted=True` — budget ran out (never dressed as Succeeded).
- `Failed` reason `TaskAborted` — analyst declared the goal impossible.
- `Failed` reason `RunnerInvalidOutput` — two consecutive unparseable outputs (one budgeted repair step is granted between them).
- `Failed` reason `RunnerError` — hard step failure (SDK error / 75s timeout), journaled.
- `RunnerLost` — the runner died: a `Running` task with no step written for >10min is swept honestly.

The analyst is **blocked-JSON**: system prompt orders exactly `{"action":"work"|"finish"|"abort","summary":string,"findings"?:string[]}`, max_tokens 4000, 75s step timeout, a machine-state JSON extractor (markdown-fence tolerant, first-`{`-to-last-`}` scan, truncation rescue), and every step journaled to AxStep with real usage tokens when the SDK exposes them — honest 0 when absent, never estimated.

## Suspend / resume (exact continuation)

`suspend` → `Suspended` + checkpoint `{stepsUsed, msUsed, historyDigest}` (condition `Ready=False TaskSuspended`). `resume` → `Running` with **the same counters**; the loop re-reads fresh state before every step, so continuation is exact — no double-counting, no restart. `delete` → `Terminating`; the runner performs teardown (steps deleted, then the row) — no orphan rows. Deleting a `Running` task is refused: suspend first.

## API usage

- `GET /api/saos/ax` — reconcile + describe all tasks (conditions, budgets, step journals) + registries + example manifests. Public read.
- `POST /api/saos/ax` (owner-gated, 64KB body cap, 4s rate-limit, oplog per POST):
  - `{action:"apply", manifest:"<yaml|json>"}`
  - `{action:"suspend"|"resume"|"delete", name:"<name>"}`

Gate refusals return `422` with `{ok:false, error, refusals:[...]}` — every reason named in Hebrew, nothing guessed.

## Provenance & boundaries

Adapted from **google/ax** (Apache-2.0). Stolen: manifest-gate semantics, single-runner reconcile, budget law, suspend/checkpoint/resume, zombie sweep. **Refused** (cloud/gated, would be green-lies here): the K8s control plane (refused honestly on this box), the isolated substrate, redis state, GCR runner. SAOS runs the semantics on its own 2-core body: SQLite + Prisma + zod + the house LLM engine.
