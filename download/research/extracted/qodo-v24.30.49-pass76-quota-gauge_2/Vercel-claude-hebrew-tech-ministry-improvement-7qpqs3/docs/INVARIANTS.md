# Qodo — System Invariants

> These are the load-bearing rules. Any change that violates one of these
> breaks the system — often silently, at runtime, in production.
>
> Before merging any PR: scan this list. If your change touches a rule below,
> prove it is still satisfied.

---

## 1. Phase State Machine Is Linear and Non-Skippable

```
idle → architect → coder → gate → commit → astdoc → canary → merge → postmerge → review → done
```

**Why it matters:** Redis checkpoint keys are keyed to phase names. Skipping a phase
leaves a gap the resume logic cannot bridge. A run resumed mid-pipeline will re-execute
from the wrong phase or crash.

**Rule:** Never reorder phases. Never skip a phase in the `runPipeline` switch. If a
phase becomes optional, gate it with a feature flag inside the phase, not by removing
it from the state machine.

---

## 2. All LLM Output Must Pass `.strict()` Zod Validation

**Why it matters:** Without `.strict()`, hallucinated extra keys pass silently into
downstream agents. The Coder's file list, the Architect's plan, and the Reviewer's
verdict all feed into code that commits to GitHub — garbage in, garbage committed.

**Rule:** Every `z.object({...})` schema in `schemas/*.ts` must call `.strict()`.
Never parse LLM responses with `JSON.parse` directly. Use `parseWithRetry` or
the `AIContractError` retry path through the Meta-Agent.

---

## 3. Redis Keys Must Use the `qodo:v24:` Namespace Consistently

**Why it matters:** Phase state, telemetry, locks, and Mentor Mode approvals are all
stored in Redis under `qodo:v24:*`. A partial rename (some keys at v24, some at a
different version) causes the state machine to create a fresh run instead of resuming,
losing all progress and potentially double-applying a patch.

**Rule:** All Redis key construction must use the `stateKey()` helper in `src/pipeline/run-pipeline.ts (formerly cli.ts)`.
Never hardcode a Redis key string outside of that helper. Bumping the version string
requires a single atomic `sed` across every key-constructing call, plus a migration
that drains the old namespace.

---

## 4. The 5-Gate Order Is Fixed

```
lockfile → blast-radius → DOM-xray → shadow-traffic → chaos-monkey
```

**Why it matters:** Chaos Monkey (gate 5) exercises null guards and step validity
on the already-gate-verified patch. If it runs before blast-radius, it may pass a
patch that would have been caught by blast-radius, producing a higher-risk commit.

**Rule:** Never reorder the gate array in `src/pipeline/run-pipeline.ts (formerly cli.ts)`. Adding a new gate: append it
after Chaos Monkey unless it is a fast syntactic check that can run before lockfile.

---

## 5. Privacy Obfuscation Check Order Is Fixed

```
obfuscateCode(patch) → sendToLLM → reconstituteCode(patch) → hasUnmappedTokens(patch)
```

**Why it matters:** `hasUnmappedTokens` detects any `VAR_N` tokens that survived
reconstitution (i.e., the LLM introduced a new token the mapping doesn't cover).
Running it before `reconstituteCode` always returns true; running it after but before
rejecting means unmapped tokens reach production code.

**Rule:** The check in `agents/coder.ts` must be: reconstitute → check → reject-and-retry
if any unmapped tokens remain. Never skip the check when `QODO_PRIVACY_MODE=strict`.

---

## 6. Target Files Must Never Be Cartographer-Summarized

**Why it matters:** The Cartographer summarizes large non-target files to save tokens.
If a target file (one the Coder will modify) gets summarized, the Coder receives a
~30-line summary instead of the real file, generating diffs against the wrong content.
The result is a patch that corrupts the target file.

**Rule:** `buildFileMap()` in `services/cartographer.ts` must always receive the full
`targetFiles` set from `plan.steps[].files`. Target files bypass summarization entirely.

---

## 7. Worker Auth Is Always Validated First

**Why it matters:** `worker/telemetry-proxy.js` is the public surface of the system.
Without auth validation, anyone with the Worker URL can trigger GitHub Actions runs,
read telemetry queues, and inject mission objectives.

**Rule:** Every non-OPTIONS, non-`/health`, non-`/session/issue` request in
`worker/telemetry-proxy.js` (the only Worker file — `worker/dispatch.js` was a
duplicate `/dispatch` implementation; CHANGES.md Pass 1 logged its removal, but
it was still physically present until Pass 3 actually deleted it) must
validate a signed session token (`verifySessionToken`, HMAC'd with
`env.QODO_DISPATCH_SECRET`) before any other processing. `env.QODO_DISPATCH_SECRET`
itself is compared directly only inside `POST /session/issue` (Pass 43 T1) —
never in a `VITE_*` build var, and never sent by the browser on every request.
Never read from `process.env` in Workers — use `env.*` (the Workers bindings
object).

---

## 8. Lock Heartbeat Must Continue While a Phase Is Running

**Why it matters:** `SemanticDagLock` acquires a Redis lock keyed to (concept, repo).
If the lock TTL expires before the phase completes, a second concurrent run can acquire
the same lock and generate a conflicting patch for the same concept.

**Rule:** Any caller of `SemanticDagLock.acquire()` must run the `renewLock` heartbeat
(already wired in `semantic-dag.ts`) for the duration of the phase. Never acquire a
lock and then `await` a long operation without heartbeating.

---

## 9. Hive Sharing and Privacy Mode Are Mutually Exclusive

**Why it matters:** In strict privacy mode, local identifiers are obfuscated to
`VAR_N` before leaving the perimeter. Uploading an obfuscated patch to the public Hive
poisons the cross-repo reference pool with meaningless tokens.

**Rule:** `getHiveShareMode()` must return `"off"` whenever
`QODO_PRIVACY_MODE === "strict"`. This is enforced in `semantic-cache.ts`.
Never set both `QODO_PRIVACY_MODE=strict` and `QODO_HIVE_SHARE=public`.

---

## 10. Canary Rollback Is Mandatory on Any Validation Failure

**Why it matters:** The canary phase routes 5% of production traffic to the preview
deployment. A silent failure (no rollback, partial error swallowed) leaves 5% of users
on a broken build indefinitely.

**Rule:** Every `deployPreview / routeTrafficToCanary` call in `services/canary.ts`
must be followed by validation. Any non-OK result must call `rollbackCanary()` before
returning. Never promote without validation. Never swallow canary errors.

---

## 11. Prompt Mutations Require Human Promotion

The meta-agent (`agents/meta-agent.ts`) and prompt registry
(`services/prompt-registry.ts`) may generate and A/B-test prompt mutations,
and may auto-ROLLBACK a regressing variant — but promoting a mutated prompt
to the durable default is a human decision. No code path may auto-promote a
self-generated prompt without an explicit operator action (the Darwin
engine's evolution output is a *pull request*, never a direct write, for the
same reason). Recommended by audit pass 10; adopted as a formal invariant in
the 2026-07 restoration.

## 12. The Resume Trigger Queue Has Exactly One Consumer

`qodo:trigger:queue` (ADR-003) is the canonical list onto which
`webhook-receiver.js` pushes pipeline triggers (`/qodo proceed`, PR events,
check-suite failures). It is drained by **one** consumer at a time — the
GitHub Actions `schedule:` drain job running
`cli.js --drain-trigger-queue` (ADR-005). The Cloudflare Worker must never
drain it: `runPipeline` transitively needs Node `fs`, which a Workers isolate
cannot provide, and the Worker is a dispatch-only boundary (Invariant #7).

Reliability contract (do not weaken):

- **Atomic hand-off.** `pop()` does `LMOVE qodo:trigger:queue
  qodo:trigger:processing` — a plain `BRPOP` is destructive/at-most-once and
  would silently drop a trigger if the consumer crashed before dispatching.
- **Durable ack.** The resumed run writes `qodo:trigger:ack:<taskId>` at its
  first checkpoint (`run-pipeline.ts`, gated on `TRIGGER_TASK_ID`).
- **Reaper reconciliation.** Each drain tick reconciles
  `qodo:trigger:processing` against the ack keys: acked → completed (removed);
  stale + un-acked → requeued with `attempts + 1`; `attempts` past the cap →
  `qodo:trigger:dead`. This yields no loss on crash-before-ack, no duplicate
  run on crash-after-ack, and dead-lettering of poison messages.
- **Single-consumer.** The drain workflow's `concurrency` group guarantees one
  active drainer per tick; `acquireLock('pr-<n>')` in `runPipeline` is the
  authoritative dedup — even a duplicate dispatch cannot produce two concurrent
  runs for the same PR.

**Timing contract (do not violate).** The reaper's stale window
(`QODO_TRIGGER_STALE_MS`, default 30 min) must stay **larger** than the
worst-case time from `workflow_dispatch` to the resumed run's first checkpoint
— GitHub Actions queue latency + runner boot + `npm ci`/build + `loadState`.
If it is smaller, the reaper requeues a run that is merely slow to *start*,
producing a duplicate dispatch (harmless to correctness thanks to
`acquireLock`, but wasteful). The reaper is best-effort delivery; the lock is
the correctness guarantee. Tunables: `QODO_TRIGGER_STALE_MS`,
`QODO_TRIGGER_MAX_ATTEMPTS`, `QODO_TRIGGER_MAX_BATCH`, `QODO_TRIGGER_REAP_ONLY`.

Adopted with the Phase 0 resume-loop release (2026-07); see `docs/adr/005`.

## Boundary Map (30-second version)

```
┌───────────────────────────────────────────────────────┐
│  BROWSER (Mission Control UI)                         │
│  Reads: telemetry events (via Worker proxy)           │
│  Writes: dispatch objectives, approve/reject (Mentor) │
└───────────────────────────┬───────────────────────────┘
                            │ HTTPS + X-Qodo-Session
┌───────────────────────────▼───────────────────────────┐
│  CLOUDFLARE WORKER (telemetry-proxy.js)               │
│  Owns: auth boundary, Redis reads, GH dispatch        │
│  Does NOT: run agent logic, mutate state              │
└───────────────────────────┬───────────────────────────┘
                            │ GitHub Actions trigger
┌───────────────────────────▼───────────────────────────┐
│  AGENT (packages/agent — src/pipeline/run-pipeline.ts (formerly cli.ts))                      │
│  Owns: pipeline state machine, all business logic     │
│  Reads: GitHub repo via GitHubClient                  │
│  Writes: Redis checkpoints, R2 artifacts, GitHub PRs  │
└───────────────────────────────────────────────────────┘
```

**Boundary rules:**
- The browser never calls GitHub or Redis directly.
- The Worker never executes agent logic.
- The agent never reads browser state.
- Replacing any layer (e.g., swap Redis for Postgres) requires changes only within
  that layer's files: `services/redis-state.ts` for the agent state store,
  `worker/telemetry-proxy.js` for the proxy. (The vestigial `ports/`
  interface layer was removed — see `docs/adr/001-delete-ports-layer.md`;
  `src/pipeline/context.ts` is the injection seam.)
