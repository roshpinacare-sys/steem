# ADR-005: `TriggerQueue` adapter and the resume-loop consumer

**Status:** accepted (2026-07)

## Context

`webhook-receiver.js` pushes pipeline triggers (`/qodo proceed`, PR events,
check-suite failures) onto `qodo:trigger:queue` (ADR-003). Until Phase 0
**nothing drained that queue** — the resume loop was open: a `/qodo proceed`
comment enqueued a trigger that no consumer ever read. Separately,
`agent-pipeline.yml` declared an `issue_number` input but never mapped it to
`PR_NUMBER`, so any resume dispatch reached `run-pipeline.ts` with
`prNumber = 0` and opened a *new* PR instead of resuming the existing one.

The `RedisState.brpop`/`rpop`/`lpush` primitives already exist; the consumer
needed wiring, not new infrastructure. Following ADR-001 (narrow interfaces at
the point of consumption, no top-level `ports/` layer), the seam is a small
`TriggerQueue` adapter used only where the queue is produced and consumed.

## Decision

1. **`TriggerQueue` adapter** (`packages/agent/src/services/trigger-queue.ts`)
   with two implementations: `RedisTriggerQueue` (wraps `RedisState`, works
   against any Redis-compatible store) and `InMemoryTriggerQueue` (tests /
   local dev). The adapter depends on a narrow `RedisListOps` slice, not the
   whole `RedisState`.

2. **The consumer runs in GitHub Actions, not the Worker.** A `schedule:`
   drain workflow (`.github/workflows/drain-trigger-queue.yml`, every 2 min)
   runs `cli.js --drain-trigger-queue`. `runPipeline` transitively needs Node
   `fs`, unavailable in a Workers isolate, and the Worker is a dispatch-only
   boundary (INVARIANTS #7). The drain loop lives in
   `packages/agent/src/pipeline/drain-trigger-queue.ts`; it pops a task and
   dispatches the agent-pipeline workflow (it does **not** run the pipeline
   in-process — the dispatched run does).

3. **Reliability model** (Invariant #12): `pop()` atomically `LMOVE`s
   queue → processing; the resumed run writes `qodo:trigger:ack:<taskId>` at
   its first checkpoint; a reaper reconciles the processing list against the
   ack keys each tick — acked → completed, stale + un-acked → requeued with
   `attempts + 1`, over the cap → `qodo:trigger:dead`. No loss on
   crash-before-ack; no duplicate on crash-after-ack; poison → dead-letter.

4. **`issue_number` → `PR_NUMBER`.** `agent-pipeline.yml` maps the resume PR
   number (and `task_id` → `TRIGGER_TASK_ID`, `trigger` → `TRIGGER_SOURCE`) so
   a resume targets the existing PR and can write its ack key.

5. **`dispatchWorkflow` generalized** to take an `inputs` object (a bare
   string is still accepted as `{ objective }`), so resume dispatches can pass
   `pr_number` / `task_id` / `trigger`.

## Alternatives considered

- **Cloudflare Worker `scheduled()` consumer** (original ADR-005 draft):
  rejected — `runPipeline` needs `fs`; the Worker is a dispatch boundary.
- **Abstract all of `RedisState` / `GitHubClient` behind generic ports:**
  rejected — large blast radius, contradicts ADR-001; the queue is the single
  highest-leverage seam.
- **Plain `BRPOP` consumer:** rejected — destructive/at-most-once; a crash
  before dispatch silently drops the trigger.
- **A message-queue SDK (SQS/AMQP/BullMQ):** rejected — new dependency and
  deployment artifact; Redis lists are sufficient and already used.

## Consequences

- The resume loop closes: `/qodo proceed` dispatches the paused PR's workflow
  within ~2 minutes, resuming the correct PR, with no message loss under
  normal operation and no duplicate runs.
- The consumer is testable offline against `InMemoryTriggerQueue`
  (`packages/agent/tests/resume-loop.test.ts`) with no Upstash account.
- `PhaseContext`, `PipelineDeps`, and existing `RedisState` call sites are
  untouched — minimal blast radius.
- Switching Redis vendors is an env change; the adapter uses the existing
  `RedisState` command channel.

## Deferred (documented, not Phase 0)

- **Worker → adapter import.** `webhook-receiver.js` still pushes via a raw
  REST `LPUSH`, but now writes the `TriggerTask` shape the adapter reads.
  Importing the compiled adapter into the Worker needs a Workers-safe Redis
  client; the payload contract is what matters and is aligned. See
  `docs/PHASE-0-LIVE-MODE.md`.
- **IR9 live mentor-approval smoke test** requires real credentials — a
  live-mode verification, tracked in `docs/PHASE-0-LIVE-MODE.md`.

## Related

- `docs/adr/001-delete-ports-layer.md` — narrow interfaces at consumption points.
- `docs/adr/003-canonical-trigger-queue.md` — `qodo:trigger:queue` is canonical.
- `docs/INVARIANTS.md` #12 — single-consumer reliability contract.
