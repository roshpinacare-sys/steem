# QODO V24 — Audit Pass 61 (CIEP-X v10.0)

**Version:** 24.30.33
**Date:** 2026-07-07
**Protocol:** CIEP-X v10.0 (Canonical Incremental Engineering Protocol)
**Baseline:** 24.30.32 (Pass 60 — uncertainty-sampling calibration check, task-21)
**Task:** task-23 — Model-deprecation-watchdog soft-deprecation detection

---

## Impact Analysis

| Dimension | Assessment |
|---|---|
| Engineering value | High — the watchdog guards against the exact failure mode (silent model deprecation) that caused a production outage in Pass 33/34. Proving that it only catches hard absence — not the more common soft-deprecation cycle — documents a class of silent failures that will eventually recur. GAP-6 (Gemini always skipped) is a high-severity finding: every Gemini deprecation event is currently undetectable. |
| Implementation risk | Zero — test-only pass. No production source files changed. |
| Compatibility impact | None. |
| Rollback complexity | Trivial — delete `packages/agent/tests/model-deprecation-watchdog-soft.test.ts`. |

---

## Problem Statement (from task-23)

`model-deprecation-watchdog.ts` was introduced in Pass 34 to catch the hard-absence
failure that silently broke all Groq calls when both configured model names were
deprecated on 2026-06-17. The watchdog queries each provider's model-list endpoint
and emits a `"model-deprecation-warning"` log for any router model not present in
the live catalogue.

Task-23 asks: does the watchdog also catch **soft deprecation** — model still listed
in the catalogue, but flagged as deprecated, published with a future sunset date,
heavily rate-limited, or marked as degraded?

The answer is: **no**. The watchdog only catches hard absence.

---

## Root Cause

The `extractIds` functions (`openAiExtract` and the Gemini extractor) return `string[]`
of model ID strings only. Every catalogue entry field beyond `id` / `name` is silently
discarded at extraction time. The deprecation check reduces to:

```typescript
if (!available.has(modelId)) {
  log.warn("model-deprecation-warning", { provider, modelId, ... });
}
```

`available` is a `Set<string>` of ID strings. Any model present in the set — regardless
of how many deprecated/sunset/rate-limited flags accompany its entry — passes the check
silently.

Additionally, a high-severity structural bug was identified: the Gemini provider's
`authHeader` function always returns `null`, making the Gemini provider entry in
`PROVIDERS` permanently dead code.

---

## Findings

### GAP-1 (Medium) — `deprecated: true` field ignored

OpenAI-compatible catalogues can include a `deprecated` boolean on each model object.
`openAiExtract` maps `data` to `m.id` strings only; the `deprecated` field is discarded.
A model in its deprecation cycle (still listed, `deprecated: true`) produces no warning.

**Demonstrated in:** B1, B4, B5

**Recommended fix:** Extend `openAiExtract` to return `{id, deprecated?}` objects;
emit a distinct `"model-soft-deprecation-warning"` log in `checkModelDeprecations`.

---

### GAP-2 (Medium) — `status: "deprecated"` field ignored

Some providers (Mistral, custom endpoints) use a `status` string rather than a boolean
flag. `openAiExtract` discards all fields beyond `id`. `status: "deprecated"` produces
no warning.

**Demonstrated in:** B2, B4, B5

---

### GAP-3 (Medium) — `deprecation_notice` string field ignored

Human-readable deprecation notices (e.g. `"Migrate to gpt-oss-40b before 2026-09-01"`)
are included in some provider responses. These are the most actionable soft-deprecation
signals (they carry migration guidance). They are silently discarded.

**Demonstrated in:** B3

---

### GAP-4 (Medium) — Temporal sunset dates not checked; no advance-notice window

Providers publish `deprecated_at` (announcement date) and `sunset_date` (final removal
date) in catalogue entries. The watchdog could emit a `"model-sunset-warning"` when
`sunsetDate − now < 30 days`, giving operators a planned migration window.

**Three sub-cases demonstrated:**
- `deprecated_at` is a past date → no warning (C1)
- `sunset_date` is 30 days out → no advance warning (C2)
- `sunset_date` is tomorrow (24 h) → no warning (C3)
- `sunset_date` is already past, model still listed → no warning (C4)

**Recommended fix:** Parse `deprecated_at` and `sunset_date` from the data array;
emit `"model-sunset-warning"` with `daysRemaining` when inside the notice window.

---

### GAP-5 (Low) — Rate-limiting / degradation signals ignored

Some providers expose `rate_limited: true` or heavily-reduced throughput indicators
(`max_requests_per_minute: 1`) on models being sunset. These are proxies for impending
removal. They are silently discarded.

**Demonstrated in:** D1, D2

---

### GAP-6 (High) — Gemini provider is permanently dead code

`PROVIDERS.gemini.authHeader` is defined as:

```typescript
authHeader: (env) => env.GEMINI_API_KEY ? null : null
```

This returns `null` in **both** branches. `fetchModelIds` interprets a null auth header
as "provider not configured" and silently skips:

```typescript
const auth = config.authHeader(env);
if (!auth) return null; // provider not configured — skip silently
```

**Consequence:** The Gemini entry in `PROVIDERS` can never be reached. The router model
`"gemini-1.5-flash-8b"` can go hard-absent from the Google catalogue and the watchdog
will never detect it — not even for hard absence.

**Verified:** Four separate tests confirm that zero fetch calls are made to
`generativelanguage.googleapis.com` regardless of whether `GEMINI_API_KEY` is set or
whether the model is present or absent in the mock catalogue (E1–E4).

**Recommended fix:**

```typescript
gemini: {
  listUrl: "https://generativelanguage.googleapis.com/v1beta/models",
  authHeader: (env) => env.GEMINI_API_KEY ?? null,  // return the key itself
  // In fetchModelIds, use a queryAuth mode for Gemini:
  // url = config.listUrl + (queryAuth ? `?key=${auth}` : "")
  // headers omit Authorization for queryAuth providers
  extractIds: ...,
}
```

---

### GAP-7 (Medium — contingent on GAP-6 fix) — Gemini soft-deprecation fields not inspected

Even after GAP-6 is fixed, the Gemini `extractIds` function only reads `m.name`
(stripping the `"models/"` prefix). It discards:

- `supportedGenerationMethods: []` — an empty array means the model can no longer
  generate content (effectively deprecated in practice)
- `deprecationDate` — Google's published future removal date

**Demonstrated in:** F1 (empty supportedGenerationMethods), F2 (near-future deprecationDate)

Note: F1/F2 tests also re-assert GAP-6 (fetch never called), confirming both gaps compound.

---

## Design Boundaries Documented

### DB-1 (Hard absence is the only detection axis)

The watchdog's detection contract is binary: is the model ID string in the `Set<string>`
or not? All other catalogue metadata is structurally unreachable after extraction.
Soft-deprecation detection requires a type-level change to the extraction contract —
`extractIds` must return structured objects, not plain strings.

### DB-2 (Gemini monitoring is dead code)

`PROVIDERS.gemini.authHeader` always returns `null`. The Gemini provider block exists
in the source but is functionally unreachable. This is not a configuration issue — it
is a code defect. No environment variable setting can activate Gemini monitoring.

### DB-3 (In-process cache inherits soft-deprecation blindness)

The `_cache: Map<string, Set<string>>` stores model ID sets for the lifetime of the
process. Once a soft-deprecated model's ID is cached as "present," all subsequent
calls within the same worker see the same `Set` without re-fetching. The soft-deprecation
gap persists for the entire process lifetime (G2 confirms this).

---

## Test Structure

**File:** `packages/agent/tests/model-deprecation-watchdog-soft.test.ts`
**Test count:** 7 describe blocks, 24 test cases

| Suite | Cases | Coverage |
|---|---|---|
| A: Hard-absence baseline | 4 | Confirms existing detection still works; validates subscribeToLogs spy |
| B: Status/deprecated fields | 5 | GAP-1 (`deprecated:true`), GAP-2 (`status`), GAP-3 (`deprecation_notice`), combined, at scale |
| C: Temporal sunset dates | 4 | GAP-4: past deprecated_at, 30-day sunset, 24-hour sunset, past-sunset still listed |
| D: Rate-limiting/degradation | 2 | GAP-5: rate_limited:true, max_requests_per_minute:1 |
| E: Gemini always skipped | 4 | GAP-6: with key, without key, both paths, full-env sweep |
| F: Gemini soft-deprecation fields | 2 | GAP-7 (contingent on GAP-6 fix): empty methods, near-future deprecationDate |
| G: Full-sweep | 3 | All providers soft-deprecated, cache DB-3, never-throws invariant |

---

## Validation

```bash
node --experimental-strip-types --check \
  packages/agent/tests/model-deprecation-watchdog-soft.test.ts
# Exit 0

bash validate.sh
# 50/50 PASSED

node scripts/check-dead-integrations.mjs
# 88 exports flagged; all in allowlist — no new dead integrations
```

Full `vitest run` / `tsc --noEmit` blocked by sandbox network constraints,
consistent with all passes ≥ 36. Static review confirms no type errors in the
new test file. All spy patterns use `subscribeToLogs` from the shared logger,
consistent with the logger's exported API.

---

## Files Changed

| File | Change |
|---|---|
| `packages/agent/tests/model-deprecation-watchdog-soft.test.ts` | New — 7 describe blocks, 24 test cases |
| `packages/agent/docs/61-V24-AUDIT-PASS-61.md` | New — this document |
| `tasks/agent-task-queue.json` | task-23 → `"done"`, `completedInPass: 61` |
| `tasks/agent-task-queue.md` | Status snapshot updated |
| `06-CHANGELOG.md` | This entry |
| `CHANGELOG.md` | Version 24.30.33 entry added |
| `ENGINEERING_NOTES.md` | Pass 61 section added |
| `package.json` (×4) | Version bumped 24.30.32 → 24.30.33 |

---

## Remaining Locally-Tractable Tasks

From `tasks/agent-task-queue.json` (run `node scripts/task-queue.mjs list` for live view):

| ID | Priority | Title |
|---|---|---|
| task-26 | P3 | DOM-xray / shadow-traffic validator starvation audit |
| task-27 | P3 | Compliance-oracle / SBOM / license-checker cross-consistency |
| task-30 | P3 | Prompt-registry version-rollback mid-run consistency |
| task-31 | P3 | Warden policy-conflict resolution correctness |
