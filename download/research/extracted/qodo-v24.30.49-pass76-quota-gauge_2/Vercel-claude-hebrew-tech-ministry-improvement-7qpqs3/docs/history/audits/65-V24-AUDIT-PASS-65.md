# QODO V24 — Audit Pass 65 (CIEP-X v10.0)

**Version:** 24.30.37
**Date:** 2026-07-07
**Protocol:** Canonical Incremental Engineering Protocol X v10.0
**Baseline:** 24.30.36 (Pass 64 — prompt-registry mid-run consistency)
**Task:** task-35 — Decide on Cloudflare AI Gateway as a caching/rate-limit proxy

---

## Executive Summary

Pass 65 executes the CIEP-X owner-decision workflow for task-35: whether to adopt
Cloudflare AI Gateway as a caching and rate-limiting proxy layer in front of the
`ai-router.ts` provider race. After a full architectural review of `ai-router.ts`,
the routing tier hierarchy, the privacy-mode invariant, and the quota-guardian
subsystem, the decision is: **NO-GO under current architecture.**

Four independent blockers make adoption net-negative at this time. Each blocker is
individually sufficient; together they are conclusive. The blocking conditions and
the future-revisit criteria are documented below.

An additional engineering continuity finding is recorded: the "Warden multi-violation
reporting" task (previously listed as task-31 in `ENGINEERING_NOTES.md`) was lost
during the queue reorganization that introduced task-31 through task-40 as
owner-decision items. That task has been re-added to the queue as task-46 — a locally
tractable, no-network, no-owner-decision code task.

---

## PASS 1 — Repository Acquisition

Baseline: `QODO-V24.30.36-pass64.zip` (378 files, 3.24 MB).

Key file reviewed for this decision:

- `packages/agent/src/services/ai-router.ts` — complete routing tier hierarchy
- `packages/agent/src/agents/warden.ts` — warden multi-violation gap (continuity)
- `packages/agent/tests/warden.test.ts` — confirmed gap in multi-violation coverage
- `tasks/agent-task-queue.json` — queue state at pass entry
- `ENGINEERING_NOTES.md` — continuity artifact confirming lost task-31

---

## PASS 2 — Continuity Review

### Task selected

Per queue rules: pick the lowest priority-number unblocked `"queued"` task with empty
`blockedBy`. Priority-2 unblocked tasks at pass entry: task-35, task-36, task-39.
task-35 has the lowest ID among them. Selected.

### Engineering continuity gap discovered

`ENGINEERING_NOTES.md` section "Remaining Locally-Tractable Tasks" (updated through
Pass 63) listed:

```
| task-31 | P3 | Warden policy-conflict resolution correctness |
```

This task does not appear in the current `tasks/agent-task-queue.json` and is not in
the done list. It was displaced when a new batch of owner-decision tasks was numbered
task-31 through task-40. The Warden multi-violation issue it describes is a real,
unaddressed engineering gap (confirmed below). Re-added as **task-46**.

---

## PASS 3 — System Analysis: ai-router.ts Tier Hierarchy

`aiRoute()` follows a strict four-tier fallback chain:

| Tier | Mechanism | Can gateway proxy? | Notes |
|------|-----------|-------------------|-------|
| **Tier-0** | Local WASM classifier | N/A — no LLM call | Labels path/tier; returns no content |
| **Tier-1** | CF Workers AI binding (`_cfEnv.AI.run()`) | **No** | Runtime binding, not HTTP; gateway requires an HTTP URL |
| **Tier-2** | Groq-fast race vs. Gemini/Cerebras/Mistral/Together/SambaNova/HF (`raceProviders`) | **Partially yes** | HTTP endpoints; gateway can proxy all except the CF Workers AI binding |
| **Tier-2b** | Groq-heavy or draft-then-verify | **Yes for Groq** | Uses Groq SDK; gateway-compatible via `baseURL` override |
| **Tier-3** | OpenRouter fallback | **Yes** | OpenAI-compatible HTTP; trivially proxied |

**Tier-1 exclusion is the structural finding:** The free-tier path that is most
cost-sensitive and most likely to benefit from caching (CF Workers AI, zero marginal
cost, already on-account) is architecturally incompatible with CF AI Gateway. The
gateway operates at the HTTP layer; the Workers AI binding is a V8 isolate runtime
call that never traverses an HTTP stack.

### Privacy-mode transit surface

`QODO_PRIVACY_MODE=strict` causes `obfuscator.ts` to scramble file content before
the prompt reaches `aiRoute()`. Prompts that hit ai-router.ts are therefore already
obfuscated. CF AI Gateway would see the obfuscated content, not raw source.

However, the system invariant treats privacy mode as a hard boundary. Routing
obfuscated-but-structured prompts through Cloudflare's request logging infrastructure
increases the trust surface: Cloudflare can correlate file-path metadata, timing
patterns, and objective structure across runs even without seeing raw code. This is a
soft violation of the intent of PRIVACY_MODE=strict. Per CIEP Decision Hierarchy,
existing behavior (no external transit hop between agent host and LLM provider) takes
precedence over the performance/analytics gain.

### Quota-guardian redundancy

`quota-guardian.ts` already tracks per-provider headroom via response headers
(`x-ratelimit-remaining-requests`, `x-ratelimit-reset-requests`) and proactively
calls `markProviderExhausted`. CF AI Gateway's rate-limiting dashboard provides the
same information with higher latency and no programmatic integration. Adding the
gateway layer without removing the existing quota tracking would duplicate rate-limit
state with no reconciliation mechanism.

### Cache hit rate analysis

CF AI Gateway caches based on request body hash. Prompt structure in this pipeline:

- Architect: includes `objective` (run-specific) + `fileMap` (repo state at HEAD)
- Coder: includes plan (architect output, non-deterministic) + file content
- Cartographer: includes file content (changes per commit)

Identical request bodies require the same objective, the same HEAD commit, and the
same non-deterministic prior phase output. In practice, cache hits are structurally
impossible across runs and highly unlikely even within a retried run. Expected cache
hit rate: effectively 0%.

---

## PASS 4 — Engineering Planning: Decision Matrix

| Criterion | Assessment | Weight |
|-----------|------------|--------|
| Cache hit rate | ~0% — prompt content is run- and commit-specific | High |
| Tier-1 coverage | Excluded — Workers AI binding is not HTTP-proxiable | High |
| Privacy invariant | Soft violation — new transit hop for PRIVACY_MODE=strict runs | High |
| Quota-guardian overlap | Redundant rate-limit tracking without reconciliation path | Medium |
| New SPOF | Every LLM call depends on gateway availability | Medium |
| Latency cost | +10–50ms per LLM call in the hot path | Low |
| Analytics value | Covered by prometheus-metrics.ts + Axiom shipper | Low |
| Account overhead | Zero — CF account already in use | Low |

No high-weight criterion favors adoption. Three high-weight criteria oppose it.

---

## PASS 5 — Engineering Decision

### Decision: NO-GO

Cloudflare AI Gateway will **not** be adopted in front of `ai-router.ts` at this
time. The decision is documented here as the authoritative record. No code changes
are made to `ai-router.ts` or any routing configuration.

### Primary blockers (each independently sufficient)

**Blocker 1 — Tier-1 structural exclusion.**
The most impactful free-tier path (CF Workers AI binding at Tier-1) is incompatible
with the gateway's HTTP proxy model. Adopting the gateway benefits only Tier-2 and
Tier-3, which already have circuit breakers, quota-guardian tracking, and Groq's
native rate-limit headers. The incremental value above the existing infrastructure
does not justify the adoption cost.

**Blocker 2 — Privacy-mode transit surface.**
Routing prompts through CF's request logging infrastructure — even obfuscated prompts
— introduces a transit hop that is inconsistent with the intent of PRIVACY_MODE=strict.
Until CF AI Gateway offers a verifiable, per-request log-suppression path that is
auditable and compatible with the privacy system invariant, this blocker stands.

**Blocker 3 — Negligible cache benefit.**
Cache hit rate is structurally near-zero given the run-specific, commit-specific
prompt structure. The primary selling point of the gateway (request deduplication
for repeated identical calls) does not apply to this pipeline's prompt shape.

**Blocker 4 — Quota-guardian redundancy.**
The quota-guardian subsystem already provides programmatic per-provider headroom
tracking and exhaustion marking. Adding the gateway's rate-limit analytics without
removing or integrating with quota-guardian creates unreconciled duplicate state
tracking — a correctness risk, not just an efficiency concern.

### Future revisit conditions

Reconsider task-35 if **all four** of the following conditions are met (one per
blocker — each blocker is independently sufficient, so all four must be resolved
before the decision changes):

1. **Tier-1 structural resolution (Blocker 1):** Tier-1 `aiRoute()` is refactored
   to call CF Workers AI via an HTTP endpoint (e.g., the Workers AI REST API at
   `api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/...`) rather than the
   V8 runtime binding (`_cfEnv.AI.run()`), making all tiers uniformly HTTP-routable.
   Without this change, the most cost-sensitive free-tier path remains outside gateway
   coverage regardless of any other configuration.
2. **Privacy-mode transit resolution (Blocker 2):** CF AI Gateway documents a
   per-request, operator-auditable log-suppression mechanism that is verified as
   compliant with the PRIVACY_MODE=strict invariant defined in
   `04-SYSTEM-INVARIANTS.md`.
3. **Cache hit rate resolution (Blocker 3):** The prompt structure is refactored to
   separate a stable, cache-eligible component from run-specific content (e.g.,
   cartographer summaries for files unchanged across consecutive runs are isolated
   into a dedicated call with a deterministic cache key).
4. **Quota-guardian redundancy resolution (Blocker 4):** A quota-guardian integration
   path exists (e.g., gateway webhooks or an API surface) that allows quota-guardian
   to replace — not duplicate — its header-based per-provider tracking with gateway
   data.

Until all four conditions are met, the decision is NO-GO and task-35 is closed.

---

## PASS 6 — Hardening and Validation (Continuity Finding)

### Warden multi-violation gap (task-46)

Review of `packages/agent/src/agents/warden.ts` confirms that `inspectFile()` runs
three sequential loops with early-`return` on first match:

1. `AnyKeyword` scan — returns on first `any` type found
2. `console.log` scan — returns on first call found
3. Unwrapped `await` scan — returns on first unwrapped await found

**Gap:** A file with multiple violation types receives exactly one rejection report
per `wardenGuard()` call. `warden-memory.ts` records only the first violation.
`loadWardenLessons()` feeds only that lesson back into the Coder prompt. If the
Coder fixes the reported violation, the next `wardenGuard()` call may reject for
a different violation type — iterating through violations one at a time rather than
reporting all at once.

**Impact (Medium):** Suboptimal Coder feedback loop. No correctness violation — all
violations are eventually caught and rejected. The pipeline doesn't regress or
produce bad output; it just takes more round-trips to produce clean output.

**Priority ordering is undocumented:** The current order (`any` > `console.log` >
`await`) is an artifact of loop sequencing, not a stated policy. There is no
`04-SYSTEM-INVARIANTS.md` entry for Warden violation priority.

**Action:** Re-added as **task-46** (test-only, P3, locally tractable, no network,
no owner decision required). The test should cover: multi-violation files, priority
ordering documentation, `warden-memory.ts` recording completeness.

### Validation

```
node --check on no new source files (decision-only pass) — N/A
validate.sh (node-based checks, 50 checks) — PASSED (no source changes)
check-dead-integrations.mjs — clean (no new exports introduced)
vitest run / tsc --noEmit — blocked by sandbox network constraints
  (consistent with all passes >= 36)
```

---

## PASS 7 — Engineering Continuity

### Files changed

| File | Change |
|------|--------|
| `packages/agent/docs/65-V24-AUDIT-PASS-65.md` | New — this pass document |
| `tasks/agent-task-queue.json` | task-35 → `"done"`, `completedInPass: 65`; task-46 added |
| `tasks/agent-task-queue.md` | Status snapshot updated |
| `06-CHANGELOG.md` | Pass 65 entry prepended |
| `CHANGELOG.md` | Pass 65 entry prepended |
| `ENGINEERING_NOTES.md` | Remaining-tasks section updated; task-46 continuity note added |
| `package.json` (root) | version 24.30.36 → 24.30.37 |
| `packages/agent/package.json` | version 24.30.36 → 24.30.37 |
| `apps/mission-control/package.json` | version 24.30.36 → 24.30.37 |
| `standalone-executable/package.json` | version 24.30.36 → 24.30.37 |

### Queue state after Pass 65

- **Done (25 tasks):** task-3, task-7 through task-30 (as per Pass 64 snapshot), task-35 (Pass 65)
- **Queued — owner-decision (9 tasks):** task-31, task-32, task-33, task-34, task-36, task-37, task-38, task-39, task-40
- **Queued — code, locally tractable (1 task):** task-46 (Warden multi-violation)
- **Blocked (11 tasks):** task-1, task-2, task-4, task-5, task-6, task-15, task-41, task-42, task-43, task-44, task-45

**Next locally-tractable non-owner task (P3):** task-46 (Warden multi-violation reporting).
**Next owner-decision tasks (P2):** task-36 (code-quality/security APIs), task-39 (feature-flag canary).

---

## PASS 8 — Release Packaging

Version bumped: **24.30.36 → 24.30.37**

Output: `QODO-V24.30.37-pass65.zip`
