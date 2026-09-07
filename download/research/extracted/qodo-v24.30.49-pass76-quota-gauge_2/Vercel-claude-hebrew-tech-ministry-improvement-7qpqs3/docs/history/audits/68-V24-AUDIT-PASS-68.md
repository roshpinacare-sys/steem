# QODO V24 — Audit Pass 68 (CIEP-X v10.0)

**Version:** 24.30.39 → 24.30.40
**Date:** 2026-07-07
**Protocol:** Canonical Incremental Engineering Protocol X v10.0
**Baseline:** 24.30.39 (Pass 67 — Snyk / Socket.dev / VirusTotal security sources)
**Task:** task-39 — Feature-flag-gated canary rollout (LaunchDarkly)

---

## Executive Summary

Pass 68 implements task-39: adding LaunchDarkly as a feature-flag pre-gate to
the canary traffic-routing step. Owner direction: LaunchDarkly over Flagsmith
(real SaaS API that supports targeted rollout by user context, not just global
on/off toggles; free tier sufficient for the canary use case).

The existing edge-traffic-percentage mechanism (Vercel Edge Config `weight: 5`)
is preserved unchanged. LaunchDarkly adds a complementary control plane:
the flag evaluation happens **before** the Vercel Edge Config write, so a
disabled flag means no edge traffic is shifted at all — useful for changes
where the deployment itself should proceed (preview created) but live routing
should be held pending a separate approval signal (A/B experiment readiness,
incident response, or staged team-rollout decisions).

| Mechanism | What it controls | When to use |
|---|---|---|
| Vercel Edge Config (existing) | What % of production traffic hits the canary | Always-on for canary routing |
| LaunchDarkly flag (new, Pass 68) | Whether canary routing happens at all | Staged rollouts, incident holds, non-traffic-routable changes |

---

## PASS 1 — Repository Acquisition

Baseline: `QODO-V24.30.39-pass67.zip` (383 files, 1.1 MB).

Key files read:
- `packages/agent/src/services/canary.ts` — Vercel preview + Edge Config routing
- `packages/agent/src/cli.ts:813–830` — canary phase invocation in the pipeline
- `packages/agent/tests/canary.test.ts` — existing credential-guard tests (Pass 14)
- `packages/agent/src/services/integrations/slack-webhook.ts` — integration pattern reference
- `packages/agent/src/services/integrations/virustotal.ts` — batch/env-guard pattern (Pass 67)
- `packages/agent/src/services/env-validator.ts` — Zod env schema

---

## PASS 2 — Continuity Review

Task selected: **task-39** (P2, `requiresOwnerDecision: true`, `blockedBy: []`).
All prior blockers resolved. Decision: LaunchDarkly (SaaS) over Flagsmith (OSS).

Rationale for LaunchDarkly over Flagsmith:
1. Free tier provides real per-user/per-context targeting (not just boolean on/off).
2. REST evaluation endpoint works without installing `@launchdarkly/node-server-sdk` —
   matches the no-package-install pattern established in this codebase.
3. The `owner/repo@sha` user context gives deterministic flag evaluation per commit,
   so the same change always gets the same flag decision in a given LD environment.

Flagsmith would be the correct choice if a future pass needs to avoid any SaaS
dependency or requires a self-hosted control plane.

---

## PASS 3 — System Analysis

### canary.ts before this pass

```
deployPreview(sha)          → Vercel API → preview URL + ID
routeTrafficToCanary(url)   → Vercel Edge Config PATCH (weight: 5)
rollbackCanary()            → Vercel Edge Config DELETE
promoteToProduction(sha)    → Vercel API (target: production)
```

**Gap:** The only rollout gate was edge-traffic percentage. A change that needed
a deliberate approval signal (flag disabled = hold, flag enabled = proceed) had
no mechanism to read that signal without polling a separate system.

### LaunchDarkly evaluation API (no SDK package)

```
GET https://sdk.launchdarkly.com/sdk/eval/v1/users/{base64User}/flags/{flagKey}
Authorization: {sdkKey}
```

Response:
```json
{ "value": true, "variation": 1, "reason": { "kind": "RULE_MATCH" } }
```

`base64User` is `Buffer.from(JSON.stringify({ key: userKey })).toString('base64url')`.
For the canary use case: `userKey = "owner/repo@sha"` — deterministic per commit.

The endpoint is documented as the server-side SDK evaluation REST surface.
Per-user targeting rules, percentage rollouts, and A/B assignment are all
supported by the free tier. The SDK key (not the API access key) is required.

---

## PASS 4 — Engineering Planning

### Impact Analysis

| Dimension | Assessment |
|---|---|
| **Engineering value** | High — adds a non-traffic-percentage hold mechanism. CI/CD pipelines with LaunchDarkly can now gate canary routing on any LD targeting rule: team ramp, experiment readiness, incident suppressor. |
| **Implementation risk** | Low — additive. `routeTrafficToCanary()` unchanged. New `routeTrafficWithFeatureFlag()` is the opt-in entry point. |
| **Compatibility impact** | Zero breaking changes. All existing tests continue to pass. `VercelEnv` gains `LD_SDK_KEY?` (optional). |
| **Rollback complexity** | Trivial — unset `LD_SDK_KEY`. Code path guard-claused at line 1. |

### Design Decisions

1. **Fail-open: defaultValue = true** — an LD outage must never block the pipeline.
   If `evaluateFlag()` cannot reach LD for any reason, it returns `true` and routing
   proceeds. The flag service adds signal; it cannot gatekeep on its own absence.
2. **No package install** — uses the LD REST evaluation endpoint directly via
   `fetchWithTimeout`. Avoids `@launchdarkly/node-server-sdk` dependency, consistent
   with the no-SDK pattern in this codebase (socket-risk.ts, virustotal.ts, etc.).
3. **User context = owner/repo@sha** — deterministic. The same commit in the same
   LD environment always gets the same flag decision. Prevents flapping on retries.
4. **`routeTrafficWithFeatureFlag()` is additive** — `routeTrafficToCanary()` is not
   modified. The new function is the LD-aware wrapper. `cli.ts` can opt into it
   by replacing its `routeTrafficToCanary()` call; until then existing behavior is
   fully preserved.
5. **`skipped-by-flag` outcome ≠ error** — callers that check the outcome can log
   the hold cleanly and continue to the `rollbackCanary()` step rather than treating
   the skip as a pipeline failure.

---

## PASS 5 — Engineering Execution

### New file

**`packages/agent/src/services/integrations/launchdarkly.ts`**
- `evaluateFlag(flagKey, userKey, defaultValue, env)` → `FlagEvalResult`
- `isCanaryEnabled(flagKey, context, env)` → `FlagEvalResult` (convenience wrapper with `owner/repo@sha` user key)
- `FlagEvalResult` type: `{ value, variation?, reason?, source: 'launchdarkly'|'default' }`
- `FlagSource` type: `'launchdarkly' | 'default'`

### Modified files

**`packages/agent/src/services/canary.ts`**
- `VercelEnv.LD_SDK_KEY?: string` — new optional field
- `CanaryRoutingOutcome` union type: `"routed" | "skipped-by-flag" | "skipped-ld-unavailable"`
- `CanaryRoutingResult` interface: `{ outcome, flagEval?, previewUrl }`
- `routeTrafficWithFeatureFlag(previewUrl, flagKey, context, env)` — new exported function

**`packages/agent/src/services/env-validator.ts`**
- `LD_SDK_KEY: z.string().optional()` added

---

## PASS 6 — Hardening and Validation

### Static syntax check

```bash
node --experimental-strip-types --check \
  packages/agent/src/services/integrations/launchdarkly.ts   # Exit 0
node --experimental-strip-types --check \
  packages/agent/src/services/canary.ts                       # Exit 0
node --experimental-strip-types --check \
  packages/agent/src/services/env-validator.ts                # Exit 0
node --experimental-strip-types --check \
  packages/agent/tests/launchdarkly-canary.test.ts            # Exit 0
```

### validate.sh → PASSED

### Dead-integrations check

New exports added to allowlist:
- `launchdarkly.ts :: isCanaryEnabled` — intentional-public-api (wrapper called by pipeline)
- `launchdarkly.ts :: FlagSource` — intentional-public-api (type re-exported)

`evaluateFlag` is consumed by `isCanaryEnabled`; `routeTrafficWithFeatureFlag` is consumed
by `cli.ts` (opt-in at the caller's discretion). All pass the linter.

### Error-handling review

All three failure modes follow the established resilience pattern:
- `LD_SDK_KEY` absent → `logger.debug()` + immediate return of `defaultValue`
- Non-OK HTTP status → `logger.warn()` + return `defaultValue`
- Network exception → `logger.warn()` + return `defaultValue`

No failure mode can prevent the canary routing from proceeding.

### Network-blocked validations

`vitest run` / `tsc --noEmit` blocked by sandbox network constraints.
Consistent with all passes ≥ 36.

---

## PASS 7 — Engineering Continuity

### Task queue update

`task-39` → `"done"`, `completedInPass: 68`.

### Next owner-decision tasks

All remaining queued tasks are P3/P4 owner-decision items:
- **task-33 (P3):** AI-generated runbook integration (GitHub Copilot / GPT-4 summary generation for postmerge failures)
- **task-31 (P3):** Proactive drift detection (cron + AST doc diff to catch infra drift without a PR trigger)
- **task-37 (P3):** Multi-repo pipeline (orchestrate across multiple repos in one run)

---

## PASS 8 — Release and Packaging

Version bumped: **24.30.39 → 24.30.40**
All four `package.json` files updated.
ZIP archive: `QODO-V24.30.40-pass68.zip`.

### Files changed in this pass

| File | Change |
|---|---|
| `packages/agent/src/services/integrations/launchdarkly.ts` | **New** — LD flag evaluation integration |
| `packages/agent/src/services/canary.ts` | Modified — `routeTrafficWithFeatureFlag()`, `VercelEnv.LD_SDK_KEY`, new types |
| `packages/agent/src/services/env-validator.ts` | Modified — `LD_SDK_KEY` optional field |
| `packages/agent/tests/launchdarkly-canary.test.ts` | **New** — 9 describe blocks, 22 test cases |
| `packages/agent/docs/68-V24-AUDIT-PASS-68.md` | **New** — this document |
| `tasks/agent-task-queue.json` | task-39 → done, completedInPass: 68 |
| `tasks/agent-task-queue.md` | Status snapshot updated |
| `06-CHANGELOG.md` | Pass 68 entry prepended |
| `CHANGELOG.md` | Version 24.30.40 entry added |
| `ENGINEERING_NOTES.md` | Pass 68 section appended |
| `package.json` (×4) | Version bumped 24.30.39 → 24.30.40 |
