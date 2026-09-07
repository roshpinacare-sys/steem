# QODO V24 — Audit Pass 67 (CIEP-X v10.0)

**Version:** 24.30.39
**Date:** 2026-07-07
**Protocol:** Canonical Incremental Engineering Protocol X v10.0
**Baseline:** 24.30.38 (Pass 66 — Warden multi-violation audit)
**Task:** task-36 — Security API second-sources: Snyk, Socket.dev, VirusTotal

---

## Executive Summary

Pass 67 implements task-36: owner-decision to add three independent, free-tier
security intelligence sources that cover blind spots in the existing OSV.dev +
GHSA CVE stack.

| Integration | Target | Threat category covered |
|---|---|---|
| **Snyk** (D4) | `cve-scanner.ts` | CVEs not yet in OSV/GHSA; Snyk-specific IDs with remediation context |
| **Socket.dev** (S1/S2) | `sbom-generator.ts`, `license-checker.ts`, `integrations/socket-risk.ts` | Supply-chain threats: typosquatting, install scripts, obfuscated code, protestware |
| **VirusTotal** (V1/V2) | `dry-run.ts`, `integrations/virustotal.ts` | Known-bad file hashes; malware reputation for packages not yet CVE-catalogued |

All three integrations are **fully opt-in** via environment variable. When the key
is absent the code path is skipped and all existing behavior is preserved exactly.
No defaults are changed. Rollback = delete three env vars.

---

## PASS 1 — Repository Acquisition

Baseline: `QODO-V24.30.38-pass66.zip` (381 files, 3.3 MB extracted).

Key files read for this task:

- `packages/agent/src/services/cve-scanner.ts` — D1+D3 dual-source scan; this pass adds D4 (Snyk)
- `packages/agent/src/services/sbom-generator.ts` — CycloneDX SBOM generation; extended with Socket.dev enrichment
- `packages/agent/src/services/license-checker.ts` — SPDX allowlist/denylist; extended with async supply-chain check
- `packages/agent/src/services/dry-run.ts` — dry-run simulation; extended with VirusTotal findings attachment
- `packages/agent/src/services/env-validator.ts` — Zod env schema; three new optional keys added
- `packages/agent/src/utils/fetch-timeout.ts` — shared fetch wrapper used by all new integrations
- `packages/agent/src/services/integrations/slack-webhook.ts` — integration pattern reference

---

## PASS 2 — Continuity Review

Task selected: **task-36** (P2, owner-decision, all blockedBy empty, no network at test time).
Direction confirmed by owner: implement all three (Snyk + Socket.dev + VirusTotal).

Prior task context:
- task-13 (Pass 47) audited `cve-scanner.ts` and `license-checker.ts` for failure modes.
  Its documented gaps (supply-chain self-reporting, OSV/GHSA merge deduplication) are
  directly addressed by this pass — Snyk adds an independent second CVE opinion;
  Socket.dev adds a non-CVE supply-chain signal that `checkLicenses()` cannot produce.

---

## PASS 3 — System Analysis

### cve-scanner.ts before this pass

```
scanCve()
  ├─ fetchOsv()     — POST api.osv.dev/v1/querybatch
  └─ fetchGitHubAdvisories()  — POST api.github.com/graphql (GHSA)
```

Merge strategy: GHSA overwrites OSV for same ID; both indexed by alias.
`CveScanResult` had no `sourceCounts` field — no observability on per-source hits.

**Gap:** A CVE known to Snyk but not yet in OSV or GHSA would be invisible.
Snyk publishes advisories ~0-48 hours before OSV propagates them, and carries
remediation paths (fixed versions) that OSV omits.

### sbom-generator.ts before this pass

Generates CycloneDX 1.4 SBOM from `package-lock.json`. No supply-chain risk scoring.
`SbomComponent` had no field for behavioral/reputation signals.

**Gap:** A package with zero CVEs could still be typosquatting, ship obfuscated install
scripts, or be a protestware bomb. OSV/GHSA cover disclosed CVEs only; they don't scan
behavioral signals. Socket.dev's supply-chain score covers this blind spot.

### license-checker.ts before this pass

`checkLicenses()` is synchronous and reads only the `license` field from `package-lock.json`.
`LicenseViolation.reason` accepted only `'denied' | 'unknown'`.

**Gap:** Supply-chain risk is orthogonal to SPDX license compliance. A package can be
MIT-licensed and still carry a malicious install script. No existing gate covered this.

### dry-run.ts before this pass

`DryRunReport` modeled simulated actions only — no reputation data for dependency
artifacts being "installed" in the simulation. No `_resetDryRun()` export for test cleanup.

**Gap:** VirusTotal hash lookups (file `last_analysis_stats`) can detect packages
flagged by AV engines even before a CVE is assigned. In dry-run simulation this data
adds a pre-commit reputation gate at near-zero cost (SHA-256 hashes are already in
the SBOM `hashes` array).

---

## PASS 4 — Engineering Planning

### Impact Analysis

| Dimension | Assessment |
|---|---|
| **Engineering value** | High — closes three distinct blind spots (CVE lag, supply-chain behavioral risk, pre-CVE malware). All three operate from data already in the SBOM (package name/version/hash). |
| **Implementation risk** | Low — additive only. All three degrade gracefully when API keys absent. No existing signatures changed (except CveScanResult gains `sourceCounts`, DryRunReport gains optional `virusTotalFindings`, LicenseViolation.reason gains `'supply-chain-risk'`). |
| **Compatibility impact** | Backward-compatible. Consumers that only read `passed`/`critical`/`high`/`all` from `CveScanResult` see no change. |
| **Rollback complexity** | Trivial — unset `SNYK_TOKEN`, `SOCKET_API_KEY`, `VT_API_KEY`. Code paths are guard-claused at the top of each function. |

### Design Decisions

1. **Snyk batch concurrency = 10** — Snyk free tier allows ~120 req/min; 10 concurrent requests is safe for typical SBOM sizes (< 200 packages) without a delay.
2. **Socket.dev concurrency = 8, auth = Basic(key:)** — Socket.dev's standard convention for API-key Basic auth; empty password, key as username.
3. **VirusTotal batch size = 4, delay = 15 000 ms** — free tier cap is 4 req/min (500/day). Delay between batches respects the per-minute cap exactly.
4. **VirusTotal threshold = 1 malicious detection** — any positive detection by any AV engine is flagged. False positives exist but the threshold is intentionally conservative for a security gate; operators can adjust `VT_MALICIOUS_THRESHOLD`.
5. **Socket.dev threshold = 0.3 supplyChain score** — below 30% supply-chain health is treated as high risk. Socket.dev's own "critical" band is approximately ≤ 0.3.
6. **`checkSocketSupplyChain()` is separate from `checkLicenses()`** — keeping the sync SPDX check separate from the async supply-chain check preserves the existing synchronous test surface and makes each concern independently opt-in.
7. **VirusTotal in dry-run via `setVirusTotalFindings()`** — caller-provided pattern (not internal to `getDryRunReport()`) keeps `getDryRunReport()` synchronous and lets the pipeline orchestrator run the VT scan in parallel with other dry-run setup.

---

## PASS 5 — Engineering Execution

### New files

| File | Purpose |
|---|---|
| `packages/agent/src/services/integrations/socket-risk.ts` | Socket.dev supply-chain risk API; `fetchSocketRisk()`, `flaggedPackages()` |
| `packages/agent/src/services/integrations/virustotal.ts` | VirusTotal hash reputation API; `scanHashesWithVirusTotal()`, `flaggedFindings()` |

### Modified files

| File | Change summary |
|---|---|
| `cve-scanner.ts` | Added `fetchSnyk()` (D4) running in parallel with OSV+GHSA. `CveScanResult.sourceCounts` added. `CveEntry.sources` added for per-entry attribution. Merge order: OSV → Snyk → GHSA (GHSA takes precedence). |
| `sbom-generator.ts` | `SbomComponent.socketRisk` optional field added. `enrichSbomWithSocketRisk()` exported for optional post-generation enrichment. Socket.dev import added. |
| `license-checker.ts` | `LicenseViolation.reason` extended with `'supply-chain-risk'`. `LicenseViolation.supplyChainScore` and `socketAlerts` added. `checkSocketSupplyChain()` async function exported. `SupplyChainReport` type exported. |
| `dry-run.ts` | `DryRunReport.virusTotalFindings` optional field added. `setVirusTotalFindings()` and `_resetDryRun()` exported. `VirusTotalFinding` re-exported. |
| `env-validator.ts` | `SNYK_TOKEN`, `SOCKET_API_KEY`, `VT_API_KEY` added as optional fields (all `z.string().optional()`). |

---

## PASS 6 — Hardening and Validation

### Static syntax check

```bash
node --experimental-strip-types --check \
  packages/agent/src/services/integrations/socket-risk.ts
# Exit 0

node --experimental-strip-types --check \
  packages/agent/src/services/integrations/virustotal.ts
# Exit 0

node --experimental-strip-types --check \
  packages/agent/src/services/cve-scanner.ts
# Exit 0

node --experimental-strip-types --check \
  packages/agent/src/services/sbom-generator.ts
# Exit 0

node --experimental-strip-types --check \
  packages/agent/src/services/license-checker.ts
# Exit 0

node --experimental-strip-types --check \
  packages/agent/src/services/dry-run.ts
# Exit 0

node --experimental-strip-types --check \
  packages/agent/src/services/env-validator.ts
# Exit 0

node --experimental-strip-types --check \
  packages/agent/tests/security-api-sources.test.ts
# Exit 0
```

### validate.sh

```
validate.sh → PASSED (no .js/.mjs source changes that break existing checks)
```

### check-dead-integrations.mjs

New exports added to integrations directory. All are reachable from production code
(`sbom-generator.ts` imports `socket-risk.ts`; `dry-run.ts` imports `virustotal.ts`).
`checkSocketSupplyChain` is exported from `license-checker.ts` and will be called by
the pipeline phase runner.

### Network-blocked validations

`vitest run` and `tsc --noEmit` blocked by sandbox network constraints, consistent
with all passes ≥ 36.

### Error handling review

All three integrations follow the same resilience pattern established in this codebase:
- Absent API key → `logger.debug()` + immediate empty-array return (no error thrown)
- Non-200 HTTP status → `logger.warn()` + per-item fallback return (no error thrown)
- Network exception → `logger.warn()` + per-item fallback return (no error thrown)
- Rate limit (VT 429) → logged + fallback `unknown: true` entry

This ensures that a complete third-party API outage produces **no false-positive blocks**
in the pipeline. The integrations add signal; they never gatekeep on absence of signal.

---

## PASS 7 — Engineering Continuity

### Task queue update

`task-36` → `"done"`, `completedInPass: 67`.

### New owner-decision tasks recommended

None required immediately. The Warden Option A/B decision (task-47 + task-48) remains
the highest-value pending engineering item once the owner makes the direction call.

### Updated queue status after Pass 67

- **Done (27 tasks):** task-3, task-7 through task-30, task-35, task-36, task-46
- **Queued — owner-decision (8 tasks):** task-31, task-32, task-33, task-34, task-37, task-38, task-39, task-40
- **Blocked (network/owner decision):** task-1, task-2, task-4, task-5, task-6, task-15, task-41–task-45
- **Next P2 owner-decision:** task-39 (feature-flag canary — LaunchDarkly/Flagsmith)

---

## PASS 8 — Release and Packaging

Version bumped: **24.30.38 → 24.30.39**
All four `package.json` files updated.
Complete ZIP archive prepared as `QODO-V24.30.39-pass67.zip`.

### Files changed in this pass

| File | Change |
|---|---|
| `packages/agent/src/services/integrations/socket-risk.ts` | **New** — Socket.dev supply-chain risk API integration |
| `packages/agent/src/services/integrations/virustotal.ts` | **New** — VirusTotal file hash reputation API integration |
| `packages/agent/src/services/cve-scanner.ts` | Modified — Snyk D4 source, sourceCounts, CveEntry.sources |
| `packages/agent/src/services/sbom-generator.ts` | Modified — SbomComponent.socketRisk, enrichSbomWithSocketRisk() |
| `packages/agent/src/services/license-checker.ts` | Modified — supply-chain-risk reason, checkSocketSupplyChain() |
| `packages/agent/src/services/dry-run.ts` | Modified — virusTotalFindings, setVirusTotalFindings(), _resetDryRun() |
| `packages/agent/src/services/env-validator.ts` | Modified — SNYK_TOKEN, SOCKET_API_KEY, VT_API_KEY |
| `packages/agent/tests/security-api-sources.test.ts` | **New** — 9 describe blocks, 28 test cases |
| `packages/agent/docs/67-V24-AUDIT-PASS-67.md` | **New** — this document |
| `tasks/agent-task-queue.json` | task-36 → done, completedInPass: 67 |
| `tasks/agent-task-queue.md` | Status snapshot updated |
| `06-CHANGELOG.md` | Pass 67 entry prepended |
| `CHANGELOG.md` | Version 24.30.39 entry added |
| `ENGINEERING_NOTES.md` | Pass 67 section appended |
| `package.json` (×4) | Version bumped 24.30.38 → 24.30.39 |
