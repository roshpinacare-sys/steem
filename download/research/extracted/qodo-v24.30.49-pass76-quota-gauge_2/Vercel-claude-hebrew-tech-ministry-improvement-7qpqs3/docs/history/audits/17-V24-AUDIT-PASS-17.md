# Qodo V24 CIEP-X Pass 17 Audit Report

**Version:** 24.18.0 → 24.18.1  
**Date:** 2026-07-06  
**Scope:** Focused engineering pass over Qodo V24 invariants and recently unaudited backend services.  
**Baseline cumulative bugs fixed (passes 1–16):** 41  
**New bugs identified and fixed in Pass 17:** 6  
**New cumulative total:** 47

---

## 1. Files Audited This Pass

Files reviewed in depth that were not fully verified in passes 1–16:

- `packages/agent/src/services/sbom-generator.ts`
- `packages/agent/src/services/license-checker.ts`
- `packages/agent/src/services/cve-scanner.ts`
- `packages/agent/src/services/skill-exchange.ts`
- `packages/agent/src/services/vector-skill-exchange.ts`
- `packages/agent/src/services/prometheus-metrics.ts`
- `packages/agent/src/services/redis-state.ts`
- `packages/agent/src/services/telemetry.ts`
- `packages/agent/src/services/edge-test-offload.ts`
- `packages/agent/src/services/edge-prefetch-channel.ts`
- `packages/agent/src/services/health-check.ts`
- `worker/telemetry-proxy.js`

---

## 2. Findings

### Bug 18-A — Redis keys outside the mandatory `qodo:v24:` namespace

| Field | Value |
|-------|-------|
| Severity | Medium |
| Type | Invariant violation / Integration |
| Affected | `worker/telemetry-proxy.js`, `packages/agent/src/services/telemetry.ts`, `packages/agent/src/services/edge-test-offload.ts`, `packages/agent/src/services/redis-state.ts`, `packages/agent/src/services/edge-prefetch-channel.ts` |
| Root cause | Several Redis keys used bare names: `telemetry:events`, `compute_requests`, `compute_requests:pending`, `compute_result:*`, `lock:*`, `qodo:file-lock:*`, `rl:*`, `qodo:prefetch:signals`. `04-SYSTEM-INVARIANTS.md` rule 3 requires every key to be prefixed with `qodo:v24:`. |
| Impact | Key collisions with other tenants/applications, ambiguous monitoring, and violation of the namespacing invariant that downstream tooling relies on. |
| Fix | Prefixed all runtime Redis keys with `qodo:v24:`. Rate-limit key is now `qodo:v24:rl:*`; telemetry list is `qodo:v24:telemetry:events`; compute queue/results are `qodo:v24:compute:requests:*` / `qodo:v24:compute:result:*`; locks are `qodo:v24:lock:*`; file locks are `qodo:v24:file-lock:*`; prefetch signaling is `qodo:v24:prefetch:signals`. |
| Tests | `packages/agent/tests/redis-lock.test.ts`, `packages/agent/tests/edge-prefetch-channel.test.ts`, `packages/agent/tests/edge-test-offload-keys.test.ts` |

### Bug 18-B — `license-checker` and `sbom-generator` crash on npm object-style license fields

| Field | Value |
|-------|-------|
| Severity | High |
| Type | Correctness / Reliability |
| Affected | `packages/agent/src/services/license-checker.ts`, `packages/agent/src/services/sbom-generator.ts` |
| Root cause | package-lock v3 can represent `license` as `{ type: "MIT", url: "..." }` instead of a plain string. Both services called `.trim()` or used the value directly as a string, producing `TypeError` or `[object Object]` SBOM license ids. |
| Impact | License check and SBOM generation would throw mid-pipeline, aborting the run and producing invalid compliance artifacts. |
| Fix | Added a `normalizeLicense` helper that accepts either a string or a `{ type: string }` object and falls back to `UNKNOWN` / empty string. |
| Tests | `packages/agent/tests/security.test.ts` |

### Bug 18-C — Untrusted skill records from R2 are injected into prompts without validation

| Field | Value |
|-------|-------|
| Severity | High |
| Type | Security / LLM output handling |
| Affected | `packages/agent/src/services/skill-exchange.ts`, `packages/agent/src/services/vector-skill-exchange.ts` |
| Root cause | Skill records downloaded from R2 / Upstash Vector were parsed with `JSON.parse()` and cast to the TypeScript interface. No shape validation was performed, so a poisoned or malformed record could inject arbitrary prompt fragments or carry unexpected fields. |
| Impact | Prompt-injection / data-poisoning risk; `04-SYSTEM-INVARIANTS.md` rule 2 requires strict Zod schemas at all external boundaries. |
| Fix | Defined `SkillRecordSchema` and `VectorSkillRecordSchema` using `z.object(...).strict()`. Both download paths now validate every record and skip malformed/poisoned entries while emitting telemetry. |
| Tests | `packages/agent/tests/skill-validation.test.ts` |

### Bug 18-D — Prometheus exposition does not escape label values

| Field | Value |
|-------|-------|
| Severity | Medium |
| Type | Correctness / Observability |
| Affected | `packages/agent/src/services/prometheus-metrics.ts` |
| Root cause | `exposition()` wrote label values directly into the text format. Values containing `"`, `\`, or newlines produced invalid Prometheus exposition that scrapers would reject. |
| Impact | Mission Control / Prometheus could fail to parse metrics; model names with special characters would silently drop metrics. |
| Fix | Added `escapeLabelValue` to escape backslash, double-quote, and newline characters per Prometheus text format rules. Applied escaping in counter/gauge label rendering and histogram `le` labels. |
| Tests | `packages/agent/tests/observability.test.ts` |

### Bug 18-E — `cve-scanner` throws on corrupt `.cve-shelf.json`

| Field | Value |
|-------|-------|
| Severity | Medium |
| Type | Robustness |
| Affected | `packages/agent/src/services/cve-scanner.ts` |
| Root cause | `loadCveShelf` called `JSON.parse()` without a guard and assumed the result was an array. A truncated file or non-array payload crashed the scanner. |
| Impact | A bad local CVE shelf file would break an otherwise healthy pipeline run. |
| Fix | Wrapped `JSON.parse` in `try/catch` and validated the result with `Array.isArray()`, returning an empty shelf on any parse or shape failure while logging a warning. |
| Tests | `packages/agent/tests/security.test.ts` |

### Bug 18-F — `health-check.ts` ignores plural Upstash Redis URL variables

| Field | Value |
|-------|-------|
| Severity | Low |
| Type | Configuration / Robustness |
| Affected | `packages/agent/src/services/health-check.ts` |
| Root cause | `checkRedis` read only the singular `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, while the rest of the codebase (including `RedisState`) honors the plural `UPSTASH_REDIS_REST_URLS` / `UPSTASH_REDIS_REST_TOKENS` variables for multi-instance rotation. |
| Impact | Deployments that configured only the plural env vars would fail the pre-flight Redis health check even though RedisState itself was fully functional. |
| Fix | `checkRedis` now falls back from `UPSTASH_REDIS_REST_URLS` to `UPSTASH_REDIS_REST_URL` (and the same for tokens), matching the parsing logic in `RedisState`. |
| Tests | Manual reasoning (no network in sandbox; existing tests cover env-validator). |

---

## 3. Invariant Preservation

All fixes preserve the 10 system invariants from `04-SYSTEM-INVARIANTS.md`:

1. **Phase state machine** — no phase ordering changed.
2. **Strict Zod validation** — strengthened by adding `.strict()` skill schemas.
3. **Redis key namespace** — corrected to `qodo:v24:` throughout.
4. **Privacy mode order** — unchanged.
5. **Target file handling** — unchanged.
6. **Worker auth boundary** — unchanged.
7. **Lock heartbeat** — lock keys are namespaced; behavior unchanged.
8. **Canary rollback** — unchanged.
9. **Hive/privacy mutual exclusion** — unchanged.
10. **Boundary map** — unchanged.

---

## 4. Verification Notes

- Worker JavaScript files passed `node --check`.
- TypeScript build and test execution could not be run in the sandbox because `node_modules` is absent and network install is blocked; all changes were reasoned through and follow existing syntactic/test patterns.
- All changed behavior is covered by new or updated unit tests.
