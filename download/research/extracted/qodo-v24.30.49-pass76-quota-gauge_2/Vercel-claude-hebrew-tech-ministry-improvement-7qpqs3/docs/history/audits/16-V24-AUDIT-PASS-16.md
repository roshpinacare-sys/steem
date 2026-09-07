# Qodo V24 CIEP-X Pass 16 Audit Report

**Version:** 24.16.0 → 24.17.0  
**Date:** 2026-07-06  
**Scope:** Incremental engineering pass over the Qodo V24 monorepo.  
**Baseline cumulative bugs fixed (passes 1–15):** 37  
**New bugs identified and fixed in Pass 16:** 4  
**New cumulative total:** 41

---

## 1. Files Audited This Pass

Files reviewed in depth that were not audited in passes 1–15:

- `packages/agent/src/cli.ts`
- `packages/agent/src/services/ui-synthesizer.ts`
- `packages/agent/src/services/edge-test-offload.ts`
- `packages/agent/src/services/edge-prefetch-channel.ts`
- `packages/agent/src/services/edge-test-channel.ts`
- `packages/agent/src/validators/path-guard-scoped.ts`
- `packages/agent/src/validators/env-validator.ts`
- `packages/agent/src/services/semantic-cache.ts`
- `packages/agent/src/services/health-check.ts`
- `packages/agent/src/services/pr-reporter.ts`
- `packages/agent/src/services/r2-storage.ts`
- `packages/agent/src/services/logger.ts`
- `apps/mission-control/src/App.tsx`
- `worker/telemetry-proxy.js`
- `worker/ast-fragment-worker.js`
- `bootstrap.mjs`

---

## 2. Findings

### Bug 17-A — Redis channel mismatch breaks peer-assisted prefetch

| Field | Value |
|-------|-------|
| Severity | Medium |
| Type | Correctness / Integration |
| Affected | `packages/agent/src/services/edge-prefetch-channel.ts`, `worker/telemetry-proxy.js` |
| Root cause | `REDIS_CHANNEL` in the CLI client was `"qodo:prefetch:req"` while the Cloudflare Worker SSE endpoint polled `"qodo:prefetch:signals"`. |
| Impact | WebRTC SDP offers never reached Mission Control; prefetch always fell back to GitHub API. |
| Fix | Aligned `REDIS_CHANNEL` to `"qodo:prefetch:signals"`. |
| Test | `packages/agent/tests/edge-prefetch-channel.test.ts` |

### Bug 17-B — WebContainer stdout stream not awaited before result submission

| Field | Value |
|-------|-------|
| Severity | Medium |
| Type | Correctness / Reliability |
| Affected | `apps/mission-control/src/App.tsx` |
| Root cause | `executeEdgeTest` called `proc.output.pipeTo(...)` without awaiting the returned promise; it then awaited `proc.exit` and immediately used the captured `output` buffer. |
| Impact | Race between stream completion and process exit could submit empty or truncated test logs. |
| Fix | Captured the stream promise and awaited it after `proc.exit`. |
| Test | `packages/agent/tests/app-edge-test.test.ts` (static source regression) |

### Bug 17-C — UI synthesizer targets non-existent `apps/web` directory

| Field | Value |
|-------|-------|
| Severity | Low |
| Type | Correctness |
| Affected | `packages/agent/src/agents/ui-synthesizer.ts` |
| Root cause | `componentPath` hardcoded `apps/web/components/api-*.tsx`. |
| Impact | Generated React components would be written to a path that does not exist in this monorepo, breaking downstream builds or creating orphaned directories. |
| Fix | Changed target to `apps/mission-control/src/components/api-*.tsx`. |
| Test | `packages/agent/tests/ui-synthesizer.test.ts` |

### Bug 17-D — Path-guard env overrides ignored when config file exists

| Field | Value |
|-------|-------|
| Severity | Low |
| Type | Maintainability / Configuration |
| Affected | `packages/agent/src/validators/path-guard-scoped.ts` |
| Root cause | The function returned file config early and never evaluated `ALLOWED_PATHS` / `BLOCKED_PATHS` env overrides. |
| Impact | Operational env overrides silently failed to apply, contrary to the documented intent. |
| Fix | Layered defaults → file config → env overrides so env variables take final precedence. |
| Test | `packages/agent/tests/path-guard-scoped.test.ts` |

---

## 3. Risk Assessment

| Risk | Rating | Mitigation |
|------|--------|------------|
| Prefetch signaling regression | Low | Channel name now matches worker; regression test asserts parity. |
| Edge test output loss | Low | Stream promise is awaited; regression test verifies source pattern. |
| UI component path regression | Low | Single, deterministic path change with unit test. |
| Path-guard override regression | Low | Env-override precedence covered by unit test. |

---

## 4. Files Changed

```
packages/agent/src/services/edge-prefetch-channel.ts
packages/agent/src/agents/ui-synthesizer.ts
packages/agent/src/validators/path-guard-scoped.ts
apps/mission-control/src/App.tsx
packages/agent/tests/edge-prefetch-channel.test.ts
packages/agent/tests/ui-synthesizer.test.ts
packages/agent/tests/path-guard-scoped.test.ts
packages/agent/tests/app-edge-test.test.ts
package.json
packages/agent/package.json
apps/mission-control/package.json
06-CHANGELOG.md
16-V24-AUDIT-PASS-16.md
```

---

## 5. Validation

`validate.sh` executed after all changes:

```
PASSED: 49
FAILED: 0
```

All syntax, JSON/YAML, pipeline, file-count, and vitest-coverage checks pass.

---

## 6. Sign-Off

| Item | Status |
|------|--------|
| Bugs identified | 4 |
| Bugs fixed | 4 |
| Regression tests added | 4 |
| Validation | PASS |
| Version bumped | 24.17.0 |
| Audit document | Present |
