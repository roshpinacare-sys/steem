> **⚠️ HISTORICAL DOCUMENT — CONTAINS UNVERIFIED OR FALSE CLAIMS.**
> Written before this tree was ever compiled or tested (the generating
> environment had no network; every "PASS" was a static claim). The first
> real verification is `docs/history/BASELINE-VERIFICATION.md`. Kept for
> provenance only — do not cite as current.

# QODO-V24 — FILE MANIFEST

סך כל הקבצים באריזה: **47,970 קבצים** (נכללים מסמכי root, workspaces, תלויות, קבצי בדיקה וקונפיגורציה).

---

## A. תיעוד מנוקד (Root Documents)

| # | קובץ | תיאור |
|---|------|-------|
| A01 | `00-INDEX.md` | מפתח תוכן |
| A02 | `01-REQUIREMENTS.md` | מסמך דרישות Requirement3.md |
| A03 | `02-README.md` | README ראשי |
| A04 | `03-ARCHITECTURE.md` | ארכיטקטורה |
| A05 | `04-SYSTEM_INVARIANTS.md` | חוקי זהב |
| A06 | `05-RUNBOOK.md` | runbook תפעולי |
| A07 | `06-CHANGELOG.md` | changelog מלא |
| A08 | `07-MANIFEST.md` | מפתח קבצים זה |
| A09 | `08-VALIDATION.md` | דו"ח בדיקות |
| A10 | `09-GAP-ANALYSIS.md` | ניתוח כיסוי דרישות |
| A11 | `10-V24-AUDIT-AND-FIXES.md` | audit pass 10 |
| A12 | `11-V24-OBSERVABILITY-FIX.md` | audit pass 11 |
| A13 | `12-V24-AUDIT-PASS-12.md` | audit pass 12 |
| A14 | `13-V24-AUDIT-PASS-13.md` | audit pass 13 |
| A15 | `14-V24-AUDIT-PASS-14.md` | audit pass 14 |
| A16 | `15-V24-AUDIT-PASS-15.md` | audit pass 15 |

---

## B. הגדרות פרויקט (Project Configuration)

| # | קובץ | תיאור |
|---|------|-------|
| B01 | `package.json` | root workspace configuration |
| B02 | `package-lock.json` | root lockfile |
| B03 | `tsconfig.json` | root TypeScript config (מfinal1.0) |
| B04 | `knip.json` | dead-code checker config |
| B05 | `.env.example` | annotated environment variable reference |
| B06 | `.gitignore` | git ignore rules |
| B07 | `docker-compose.yml` | local docker stack |
| B08 | `Dockerfile` | multi-stage production image |
| B09 | `bootstrap.mjs` | one-time repo setup wizard |

---

## C. משימות CI/CD ו-Kubernetes

| # | קובץ | תיאור |
|---|------|-------|
| C01 | `.github/workflows/agent-pipeline.yml` | GitHub Actions pipeline |
| C02 | `k8s/qodo-job-template.yaml` | Kubernetes Job template |
| C03 | `k8s/qodo-scaledjob.yaml` | KEDA ScaledJob |

---

## D. CLI ו-Bootstrap

| # | קובץ | תיאור |
|---|------|-------|
| D01 | `bin/create-qodo.mjs` | `npx create-qodo` scaffold |
| D02 | `packages/agent/bin/swarm-dispatch.mjs` | swarm dispatch script |
| D03 | `packages/agent/src/cli.ts` | פקודת ה-CLI הראשית |

---

## E. ליבת Agent — Agents

| # | קובץ | תיאור |
|---|------|-------|
| E01 | `packages/agent/src/agents/architect.ts` | תכנון ארכיטקטורה |
| E02 | `packages/agent/src/agents/coder.ts` | כתיבת קוד |
| E03 | `packages/agent/src/agents/compliance-oracle.ts` | compliance |
| E04 | `packages/agent/src/agents/context-enricher.ts` | העשרת context |
| E05 | `packages/agent/src/agents/darwin-engine.ts` | evolution engine |
| E06 | `packages/agent/src/agents/infra-oracle.ts` | infra |
| E07 | `packages/agent/src/agents/janitor.ts` | ניקוי |
| E08 | `packages/agent/src/agents/meta-agent.ts` | meta coordination |
| E09 | `packages/agent/src/agents/reviewer.ts` | code review |
| E10 | `packages/agent/src/agents/style-aligner.ts` | style alignment |
| E11 | `packages/agent/src/agents/ui-synthesizer.ts` | UI synthesis |
| E12 | `packages/agent/src/agents/warden.ts` | gatekeeper סופי |

---

## F. שירותים (Services)

| # | קובץ | תיאור |
|---|------|-------|
| F01 | `packages/agent/src/services/ai-router.ts` | AI provider routing + streaming |
| F02 | `packages/agent/src/services/ast-doc.ts` | AST documentation |
| F03 | `packages/agent/src/services/axiom-shipper.ts` | Axiom observability logs |
| F04 | `packages/agent/src/services/canary.ts` | canary deployment |
| F05 | `packages/agent/src/services/cartographer.ts` | מפת קבצים אינקרמנטלית |
| F06 | `packages/agent/src/services/circuit-breaker.ts` | circuit breaker |
| F07 | `packages/agent/src/services/cost-tracker.ts` | מעקב עלויות |
| F08 | `packages/agent/src/services/edge-fragment.ts` | edge fragments |
| F09 | `packages/agent/src/services/edge-prefetch-channel.ts` | prefetch |
| F10 | `packages/agent/src/services/edge-test-channel.ts` | edge test channel |
| F11 | `packages/agent/src/services/edge-test-offload.ts` | edge test offload |
| F12 | `packages/agent/src/services/env-validator.ts` | validation env vars |
| F13 | `packages/agent/src/services/github-client.ts` | GitHub API client |
| F14 | `packages/agent/src/services/health-check.ts` | pre-flight checks |
| F15 | `packages/agent/src/services/incident-resolver.ts` | incident resolution |
| F16 | `packages/agent/src/services/logger.ts` | structured logger |
| F17 | `packages/agent/src/services/obfuscator.ts` | privacy obfuscation |
| F18 | `packages/agent/src/services/op-tier.ts` | operation tiering |
| F19 | `packages/agent/src/services/phase-runner.ts` | pipeline phase wrapper |
| F20 | `packages/agent/src/services/pr-reporter.ts` | PR anchor comments |
| F21 | `packages/agent/src/services/r2-storage.ts` | Cloudflare R2 storage |
| F22 | `packages/agent/src/services/redis-state.ts` | Redis state/locks |
| F23 | `packages/agent/src/services/retry.ts` | smart retry logic |
| F24 | `packages/agent/src/services/semantic-cache.ts` | semantic cache |
| F25 | `packages/agent/src/services/semantic-dag.ts` | semantic DAG |
| F26 | `packages/agent/src/services/skill-exchange.ts` | skill registry exchange |
| F27 | `packages/agent/src/services/sre-feedback.ts` | SRE feedback |
| F28 | `packages/agent/src/services/telemetry.ts` | telemetry events |
| F29 | `packages/agent/src/services/vector-skill-exchange.ts` | vector skill search |
| F30 | `packages/agent/src/services/warden-memory.ts` | warden rejection memory |

---

## G. Validators (5-Gate Security)

| # | קובץ | תיאור |
|---|------|-------|
| G01 | `packages/agent/src/validators/blast-radius.ts` | impact radius |
| G02 | `packages/agent/src/validators/chaos-monkey.ts` | chaos tests |
| G03 | `packages/agent/src/validators/dom-xray.ts` | DOM analysis |
| G04 | `packages/agent/src/validators/lockfile-guardian.ts` | lockfile validation |
| G05 | `packages/agent/src/validators/secret-guard.ts` | secret scanning |
| G06 | `packages/agent/src/validators/shadow-traffic.ts` | shadow traffic |

---

## H. Schemas, Ports, Types, Utils

| # | קובץ | תיאור |
|---|------|-------|
| H01 | `packages/agent/src/schemas/architect-schema.ts` | architect Zod schema |
| H02 | `packages/agent/src/schemas/coder-schema.ts` | coder Zod schema |
| H03 | `packages/agent/src/schemas/index.ts` | schema barrel |
| H04 | `packages/agent/src/schemas/reviewer-schema.ts` | reviewer Zod schema |
| H05 | `packages/agent/src/ports/IBlobStore.ts` | blob store port |
| H06 | `packages/agent/src/ports/IStateStore.ts` | state store port |
| H07 | `packages/agent/src/ports/IVersionControl.ts` | VCS port |
| H08 | `packages/agent/src/ports/index.ts` | ports barrel |
| H09 | `packages/agent/src/types/run-state.ts` | run state types |
| H10 | `packages/agent/src/utils/env-schema.ts` | env schema |
| H11 | `packages/agent/src/utils/path-guard.ts` | permission path guard |
| H12 | `packages/agent/src/utils/rate-limiter.ts` | rate limiting |
| H13 | `packages/agent/src/utils/schema-validator.ts` | schema validation |
| H14 | `packages/agent/src/ambient.d.ts` | ambient types |

---

## I. Skills Registry

| # | קובץ | תיאור |
|---|------|-------|
| I01 | `packages/agent/src/skills/index.ts` | skill exports |
| I02 | `packages/agent/src/skills/add-tests.ts` | add tests skill |
| I03 | `packages/agent/src/skills/fix-bug.ts` | fix bug skill |
| I04 | `packages/agent/src/skills/refactor.ts` | refactor skill |
| I05 | `packages/agent/src/skills/types.ts` | skill types |

---

## J. בדיקות (Tests)

| # | קובץ | תיאור |
|---|------|-------|
| J01 | `packages/agent/tests/axiom-shipper.test.ts` | Axiom shipper |
| J02 | `packages/agent/tests/circuit-breaker.test.ts` | circuit breaker |
| J03 | `packages/agent/tests/cost-alert.test.ts` | cost alert banner |
| J04 | `packages/agent/tests/cost-tracker.test.ts` | cost tracking |
| J05 | `packages/agent/tests/e2e/local-simulator.test.ts` | local dev mode |
| J06 | `packages/agent/tests/env-validator.test.ts` | env validation |
| J07 | `packages/agent/tests/logger.test.ts` | structured logger |
| J08 | `packages/agent/tests/obfuscator.test.ts` | privacy obfuscation |
| J09 | `packages/agent/tests/path-guard.test.ts` | permission guard |
| J10 | `packages/agent/tests/redis-lock.test.ts` | Redis locks |
| J11 | `packages/agent/tests/retry.test.ts` | retry logic |
| J12 | `packages/agent/tests/warden.test.ts` | warden gate |
| J13 | `packages/agent/tests/semantic-cache-drift.test.ts` | hive drift regression (Pass 29) |
| J14 | `packages/agent/tests/incident-resolver.test.ts` | incident workflow dispatch regression (Pass 29) |

---

## K. Mission Control Dashboard

| # | קובץ | תיאור |
|---|------|-------|
| K01 | `apps/mission-control/index.html` | HTML entry |
| K02 | `apps/mission-control/package.json` | UI package config |
| K03 | `apps/mission-control/package-lock.json` | UI lockfile |
| K04 | `apps/mission-control/tsconfig.json` | UI tsconfig |
| K05 | `apps/mission-control/vite.config.ts` | Vite config |
| K06 | `apps/mission-control/src/main.tsx` | React entry |
| K07 | `apps/mission-control/src/App.tsx` | main app |
| K08 | `apps/mission-control/src/vite-env.d.ts` | Vite env types |
| K09 | `apps/mission-control/src/context/TelemetryContext.tsx` | shared telemetry poller |
| K10 | `apps/mission-control/src/hooks/useTelemetry.ts` | telemetry hook |
| K11 | `apps/mission-control/src/utils/styles.ts` | design tokens |
| K12 | `apps/mission-control/src/components/ApprovalGate.tsx` | mentor approval |
| K13 | `apps/mission-control/src/components/CodeStream.tsx` | live/snapshot code stream |
| K14 | `apps/mission-control/src/components/CommandPalette.tsx` | ⌘K dispatcher |
| K15 | `apps/mission-control/src/components/DecisionTimeline.tsx` | phase timeline |
| K16 | `apps/mission-control/src/components/ErrorBoundary.tsx` | error boundary |
| K17 | `apps/mission-control/src/components/FailureRecoveryPanel.tsx` | recovery panel |
| K18 | `apps/mission-control/src/components/LiveStream.tsx` | SSE log panel |
| K19 | `apps/mission-control/src/components/NeuralCore.tsx` | Three.js graph |
| K20 | `apps/mission-control/src/components/RunHistory.tsx` | run history table |
| K21 | `apps/mission-control/src/components/UIKit.tsx` | UI primitives |

---

## L. Edge Workers

| # | קובץ | תיאור |
|---|------|-------|
| L01 | `worker/ast-fragment-worker.js` | AST fragment worker |
| L02 | `worker/telemetry-proxy.js` | telemetry + dispatch + SSE proxy |

---

*מספרי הקטגוריות A-L מאפשרים ספירה מחודשת וגישה מהירה לכל קובץ.*
