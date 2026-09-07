# Phase 0 — Live-Mode Verification & Deferred Items

Phase 0 (the resume loop / ADR-005) is implemented and covered by offline
tests. This document tracks the parts that can only be exercised against real
credentials, plus items intentionally deferred out of the surgical Phase 0
release. Everything here is **live-mode**; none of it blocks the offline
build, and none of it belongs in the sandbox path.

## What is done (offline-verifiable)

- `TriggerQueue` adapter (`RedisTriggerQueue` + `InMemoryTriggerQueue`) with
  the LMOVE → processing / durable-ack / reaper reliability model.
- `--drain-trigger-queue` CLI mode + `drainTriggerQueue()` loop.
- `agent-pipeline.yml`: `issue_number → PR_NUMBER`, `task_id → TRIGGER_TASK_ID`,
  `trigger → TRIGGER_SOURCE`; generalized `dispatchWorkflow(inputs)`.
- `run-pipeline.ts` writes `qodo:trigger:ack:<taskId>` at first checkpoint.
- `drain-trigger-queue.yml` schedule workflow (every 2 min, single-consumer).
- Invariant #12, ADR-005 (accepted), `resume-loop.test.ts` (happy /
  crash-before-ack / crash-after-ack / poison, on both queue implementations).

Run offline: `npm run typecheck && npm test` (the resume-loop suite needs no
credentials).

## Live-mode checklist (needs real secrets)

Requires `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`,
`QODO_GITHUB_TOKEN` (dispatch scope), and the webhook receiver deployed.

1. **Resume round-trip (Phase 0 success metric).** On a paused PR, comment
   `/qodo proceed`. Within ~2 minutes the drain job should dispatch
   `agent-pipeline.yml` for that PR — resuming the **existing** PR (not opening
   a new one), with `PR_NUMBER` non-zero. Confirm `qodo:trigger:queue` drains
   to empty and `qodo:trigger:ack:<taskId>` appears.
2. **No duplicate under retry.** Re-run the drain while a run is mid-flight;
   the `acquireLock('pr-<n>')` guard + single-consumer concurrency group must
   prevent a second run for the same PR.
3. **IR9 — mentor-approval smoke.** Run one pipeline with
   `QODO_MENTOR_MODE=true`; pause at the mentor gate; approve via Mission
   Control or `/qodo approve`; verify the run resumes within one poll window
   and that mentor-key TTL expiry does not stall indefinitely. (The mentor
   loop is already wired end-to-end in code — see ADR/Invariants; this is the
   live confirmation that retires the risk.)
4. **Dead-letter drain.** Force a poison trigger (bad owner/repo) and confirm
   it lands in `qodo:trigger:dead` after the attempt cap rather than looping.

## Deferred (documented, not Phase 0)

- **Worker → adapter import.** `webhook-receiver.js` still LPUSHes via raw
  REST, but now writes the `TriggerTask` shape the consumer reads. Importing
  the compiled TS adapter into the Worker needs a Workers-safe Redis client;
  the payload contract is aligned, so this is a cleanup, not a correctness gap.
- **k8s/KEDA consumer** remains a Phase 4 named bet (ADR-005 D8): no message
  delivery to pods, missing TCP Redis creds. Not a Phase 0 consumer.
- **IR11 — task-citation reconciliation.** The task-48/50 → port mis-mappings
  live in the planning corpus (the handoff ZIP), not in repo source; recorded
  here so they are not re-introduced. task-49 ("should `agent-task-queue.json`
  move to GitHub Issues?") remains an open internal question.

## Phase 0 → Phase 1 gate

IR1–IR9 green + live checklist items 1–4 passed (or formally accepted) + the
`SECURITY-REVIEW.md` Phase 0 checklist addressed.
