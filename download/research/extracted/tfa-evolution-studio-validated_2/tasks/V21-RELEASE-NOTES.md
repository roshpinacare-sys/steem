# TFA Evolution Studio v21.0.0 — Platform Maturity Pass

**Release Date:** 2026-06-25
**Version:** 21.0.0
**Previous Version:** 20.0.0
**Bump:** major (comprehensive platform maturity pass — five core pillars hardened)

This release is a targeted maturity pass across the five pillars identified in the v20 assessment:
durable execution, plugin ecosystem, sandbox isolation, governance, and reproducible release chain.
No new UI pages are added. Every change strengthens an existing subsystem.

---

## Five-pillar summary

| Pillar | V20 State | V21 State |
|--------|-----------|-----------|
| Durable execution | In-memory job state, no persistence | File-backed NDJSON store, idempotency keys, retry/recovery, checkpoints, graceful shutdown |
| Plugin ecosystem | Static registry, no manifests | Versioned PluginManifest, capability declarations, external registration, health checks, fail-closed on degraded |
| Sandbox runtime | Path constants only | Per-project sandbox dirs, ingest/extract boundary, assertProjectIsolation(), stale eviction |
| Governance | Audit + approval with no roles | RBAC with 5 roles / 11 permissions, risk levels, actorRole on every audit entry, approval TTL |
| Reproducible release chain | Version coherence only | Cross-field identity verifier, artifact provenance record, SHA-256 hashes in release record, version_coherence_verified hard gate |

---

## New files

| File | Purpose |
|------|---------|
| `src/lib/job-engine/durable-job-store.ts` | Append-then-compact NDJSON job persistence, idempotency, checkpoint, retry |
| `src/lib/compiler/plugin-contract.ts` | Plugin bundle validation, lifecycle invocation, capability enforcement |
| `src/lib/compiler/sandbox-runtime.ts` | Per-project sandbox isolation, ZIP ingest, artifact promotion, stale eviction |
| `src/lib/governance/rbac.ts` | Role/permission model, assertPermission(), risk classification, AccessDeniedError |
| `src/lib/release/release-verifier.ts` | Cross-field identity check, artifact hashing, provenance record writer |
| `src/lib/intelligence/portfolio-learning.ts` | Cross-project lesson capture, recipe promotion, platform pattern promotion, portfolio digest |

---

## Modified files

| File | Change |
|------|--------|
| `src/lib/types.ts` | `CompilerJob` + durability fields; `ApprovalRequest` + riskLevel/roles/TTL; `AuditEntry` + actorRole/outcome; `ReleaseRecord` + artifactHashes/zipFilename/platformVersion; `ReleaseIdentityReport`; `PluginManifest` + capabilities; `SandboxContext`; `RetryPolicy`; `JobCheckpoint` |
| `src/lib/compiler/adapter-registry.ts` | Versioned manifests, external adapter registration, health status cache, discovery priority sort |
| `src/lib/compiler/compiler-orchestrator.ts` | Full rewrite: durable store, idempotency, retry with backoff, checkpoint at each phase, cancellation tokens, graceful shutdown hooks |
| `src/lib/paths.ts` | `getSandboxesRoot()`, `getJobsDir()`, `getPortfolioDir()`, `getProvenanceDir()`, `assertWithinWorkspace()` |
| `src/lib/release/release-governor.ts` | `buildReleaseRecord()` includes per-artifact SHA-256 hashes and ZIP structural verification; `enforceEvidenceGovernance()` adds `version_coherence_verified` as a hard gate |
| `src/lib/governance/audit-trail.ts` | `actorRole`, `riskLevel`, `outcome` on every entry; `getAuditTrailByActor()`, `getAuditTrailByRisk()` |
| `src/lib/governance/approval-gate.ts` | `riskLevel`, `requesterRole`, `resolverRole`, `rationale`, `expiresAt`; `getExpiredApprovals()` |
| `src/lib/architecture/arch-store.ts` | Drift detection between snapshots; `ArchDriftRecord`; `getDriftHistory()`; `getHighChurnVersions()`; source-file import graph builder |
| `src/lib/intelligence/cross-project-engine.ts` | Evidence-backed confidence scoring (`confidenceFromSampleSize`); slow-build, volatile, high-pass-rate pattern detection; `getProjectContributions()` |
| `src/lib/execution/resource-pool.ts` | `drain()`, `resize()`, `tryAcquire()`; peak concurrency, throughput, avg-duration metrics; `drainWaiters` for graceful shutdown |
| `scripts/smoke-test.mjs` | Banner updated to V21; `step_v20_*` + `step_v21_*` checks added (14 new steps) |
| `package.json` | Version bumped to `21.0.0` |

---

## Non-negotiable gates

| Gate | Status |
|------|--------|
| package.json is the single version source | ✅ PLATFORM_VERSION derived from package.json |
| No hardcoded version literals in routes | ✅ All download/health routes import PLATFORM_VERSION |
| ZIP filename matches version | ✅ tfa-evolution-studio-v21.0.0.zip |
| ZIP root folder matches version | ✅ tfa-evolution-studio-v21.0.0/ |
| Health endpoint reads canonical version | ✅ imports PLATFORM_VERSION |
| Coherence check passes before ZIP | ✅ coherence:check ran clean |
| Smoke test passes | ✅ all static checks pass |
| version_coherence_verified is a hard release gate | ✅ enforceEvidenceGovernance includes it |
| Artifact SHA-256 hashes in release record | ✅ buildReleaseRecord includes artifactHashes |

---

## Version History

| Version | Summary |
|---------|---------|
| **21.0.0** | ← **current** — platform maturity pass: durable execution, plugin manifests, sandbox isolation, RBAC, reproducible release chain |
| 20.0.0 | Complete autonomous engineering platform — 30+ modules, full UI, all subsystems |
| 19.0.0 | Final release certification — lockfile realigned, stale metadata eliminated |
| 18.0.0 | Certification pass — 20 high-confidence defects fixed |
| 17.0.0 | Compiler E2E Certainty — 12-step evidence pipeline, adapter retry/timeout/fail-closed |
| 16.0.0 | Platform Compiler Layer — ZIP IR, pluggable adapters, recipe store, compiler UI |
| 15.0.0 | Release Truth & Coherence Sweep — single version authority, SHA-256 everywhere |
| 14.0.0 | Scale & Reliability Hardening — circuit breaker, resource pool, SLA tracker |

See [V20-RELEASE-NOTES.md](./V20-RELEASE-NOTES.md) for the previous release.
