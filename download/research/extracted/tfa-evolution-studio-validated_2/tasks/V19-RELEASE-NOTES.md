# TFA Evolution Studio v19.0.0 — Final Release Certification

**Release Date:** 2026-06-24
**Version:** 19.0.0
**Previous Version:** 18.0.0
**Bump:** major (release truth & reproducibility certification — no new features)

This release is a final certification pass of the v18 platform.
No agents, features, or architectural changes were added. Every change eliminates
a mismatch between source of truth, lockfile metadata, runtime metadata, smoke
tests, and release artifacts.

---

## Certification phases

| Phase | Result |
|-------|--------|
| Phase 1 — Single release authority | passed — package.json is the one version source |
| Phase 2 — Lockfile reproducibility | passed — package-lock.json version realigned from 17.0.0 drift to 19.0.0 |
| Phase 3 — Smoke test cleanup | passed — stale V17/V15 labels removed; checks prove current release identity |
| Phase 4 — Release artifact consistency | passed — ZIP filename, root folder, and runtime all match 19.0.0 |
| Phase 5 — Final coherence audit | passed — no stale current-release metadata remains |
| Phase 6 — Certification gate | passed — one version, one identity, one truth, one ZIP |

---

## Defects fixed (V19 certification)

1. **Lockfile version drift (critical)**: `package-lock.json` declared `"version": "17.0.0"` in both its root
   field and the `""` packages entry — two releases behind `package.json`. This caused
   `npm ci` to install dependencies with a mismatched lockfile identity. Both fields now
   read `19.0.0`.

2. **Smoke test banner stale**: `smoke-test.mjs` printed `"TFA Evolution Studio V15 — Smoke Test"`
   at runtime and had `// TFA Evolution Studio — V17 Canonical Smoke Test` in the file header.
   Both now correctly identify V19.

3. **V15 "current" label stale**: `step_v15_release_notes()` in the smoke test labelled the V15
   notes check as "current release documentation incomplete". V15 has been historical since V16.
   Label corrected to "historical release documentation".

4. **V18-RELEASE-NOTES.md absent**: The v18 release script produced a versioned release-notes file
   but it was never written to the ZIP artifact. Now present as a historical record.

5. **README V17 references**: README body text described V17 features, the API table hardcoded
   `X-TFA-Version: 17.0.0`, the smoke-test section referenced `V17-RELEASE-NOTES.md`, and the
   version history pointed to V17 links. All updated to current.

6. **Sidebar version label stale**: `Sidebar.tsx` did not exist in the release ZIP, causing all
   sidebar smoke-test checks to fail with "not found". Restored with v19 version label and all
   required nav routes.

---

## Non-negotiable gates

| Gate | Status |
|------|--------|
| package.json is the single version source | ✅ PLATFORM_VERSION derived from package.json |
| No hardcoded version literals in routes | ✅ Download routes import PLATFORM_VERSION |
| ZIP filename matches version | ✅ tfa-evolution-studio-v19.0.0.zip |
| ZIP root folder matches version | ✅ tfa-evolution-studio-v19.0.0/ |
| Health endpoint reads canonical version | ✅ imports PLATFORM_VERSION |
| Lockfile version matches package version | ✅ package-lock.json version = 19.0.0 |
| Coherence check passes before ZIP | ✅ coherence:check ran clean |
| Smoke test passes | ✅ static checks pass against this artifact |

---

## Version History

| Version | Summary |
|---------|---------|
| **19.0.0** | ← **current** — final release certification, lockfile realigned, stale metadata eliminated |
| 18.0.0 | Certification pass — 20 high-confidence defects fixed, 0 features added |
| 17.0.0 | Compiler E2E Certainty: 12-step evidence pipeline, adapter retry/timeout/fail-closed |
| 16.0.0 | Platform Compiler Layer — ZIP IR, pluggable adapters, recipe store, compiler UI |
| 15.0.0 | Release Truth & Coherence Sweep — single version authority, SHA-256 everywhere |
| 14.0.0 | Scale & Reliability Hardening — circuit breaker, resource pool, SLA tracker |
| 13.0.0 | Engineering Hardening — reality engine fail-hard, 19 evidence nodes |
| 12.0.0 | System Coherence + Autonomy Upgrade |
| 11.0.0 | Release Integrity + Version Gate Patch |
| 10.0.0 | Integration Hub, Automation Engine, Learning Loop, Observability, Governance |

See [V19-RELEASE-NOTES.md](./V19-RELEASE-NOTES.md) for this release.
See [V18-RELEASE-NOTES.md](./V18-RELEASE-NOTES.md) for the v18 changelog.
