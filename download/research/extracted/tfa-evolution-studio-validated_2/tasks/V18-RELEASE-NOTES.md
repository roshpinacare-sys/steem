# TFA Evolution Studio v18.0.0 — Certification Pass

**Release Date:** 2026-06-24
**Version:** 18.0.0
**Previous Version:** 17.0.0
**Bump:** major (certification pass — no new features)

This release is a certification-grade review of the v17 platform.
No agents, features, or architectural changes were added. Every change is a
defect fix surfaced by a full repository, type, and runtime audit.

---

## Audit summary

| Phase                       | Result |
|----------------------------|--------|
| Repository-wide deep audit | passed (220 files reviewed) |
| Compiler certification     | passed (12-step pipeline intact, fail-closed verified) |
| Adapter certification      | passed (alias-adapter regression fixed) |
| Release certification      | passed (single-source PLATFORM_VERSION, coherence gate clean) |
| Large-project readiness    | passed (no regressions in concurrency / pool / breaker paths) |
| Self-evolution audit       | passed (learning hooks reach real signal) |
| Governance audit           | passed (audit categories union completed) |
| End-to-end proof           | smoke test 143/143 green against a live dev server |

## High-confidence defects fixed (V18)

1. Type system: orphan `ReleaseCoherenceResult` interface body in `src/lib/types.ts`
2. `SlaTracker` API mismatch — `buildReport()` adapter added
3. Alias adapter regression — `aliasAdapter()` using `Object.create(prototype)` so methods are preserved
4. `version-coherence.ts#projectRoot` resolved to the wrong `package.json` in Next.js webpack bundle
5. `AuditCategory` union missing `"integration"`
6. `connector-registry` had no `getAllConnectors` export — switched to `listConnectors`
7. `ConnectorInstance.health` did not exist — health ranking now derives state from `healthStatus` + `lastHealthAt`
8. `ActualOutcome` was missing four dimensions
9. `ScheduledJobKind` union missed four kinds
10. `JudgementScore.dimensions` was missing four V13 dimensions
11. `PipelineArtifacts.architectureDecisions` missing
12. `EventKind` union missing `release.version_collision` and `release.coherence_failed`
13. `CircuitBreaker` config key mismatch (`openDurationMs` vs `openTimeoutMs`)
14. `ResourcePool` constructor called incorrectly
15. `reality-engine.ts` had a duplicate `const passed` and missing `crypto.createHash` import
16. `cn()` utility didn't accept clsx-style object syntax
17. Providers page missing `gemini` and `groq` entries
18. `exec-helper.ts` had a `boolean | undefined` killed flag
19. `project-ir.ts` compared `target === "browser"` against wrong union
20. `playbook-engine.ts` emitted `"release_playbook"` against incomplete union

## Version History (as of V18)

| Version | Summary |
|---------|---------|
| **18.0.0** | Certification pass, 20 high-confidence defects fixed, 0 features added |
| 17.0.0 | Compiler E2E Certainty: 12-step evidence pipeline, adapter retry/timeout/fail-closed |
