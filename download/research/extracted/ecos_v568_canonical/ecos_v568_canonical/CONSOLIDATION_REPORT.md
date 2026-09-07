# ECOS — Final Consolidation Report

**Generated:** 2026-05-28
**Canonical base:** V100 (milestone release)
**Status:** Frozen research baseline

---

## Decision Summary

This package consolidates the ECOS development line (V34 → V101).
After auditing every late-stage build, **V100 was selected as the
canonical base** because it is the most complete build that still
honors every protocol invariant.

### Build comparison (late stage)

| Build | Tests | Frontend | fiatLedger MD5 | Verdict |
|-------|-------|----------|----------------|---------|
| **V100** | **275** | 12 pages | `563e9b1f` (sacred ✓) | **CANONICAL** |
| V101 | 42 | partial | — | broken partial build |
| V101_final (×4) | 232 | none | `88dc24e9` (violated ✗) | diverged, non-compliant |

### Why not V101_final?

The `V101_final` branch — despite the name — is a **regression**:

1. **Sacred-file violation.** It rewrote `lib/fiatLedger.js`, changing
   its MD5 from the protocol invariant `563e9b1f9e67091a5b6527c0a92568e5`
   (held since V38) to `88dc24e92a2bfc2ce15b126f9a53f20a`. The
   never-modify rule on `fiatLedger.js` and `auditLog.js` was the single
   hardest constraint of the entire project.
2. **Frontend dropped.** The entire `apps/web` Next.js application
   (12 pages) is absent.
3. **Test regression.** 232 tests vs the canonical 275.

Its only net-new contribution was three experimental libraries
(`analyticsEngine`, `slaTracker`, `taskEscalation`). These are
**preserved** under `reference/v101-experimental-libs/` for future
adoption, but are intentionally **not wired in**, so the canonical
baseline stays clean and the sacred hashes stay intact.

---

## What's in this package

- **Engine:** `ecos-api-server.js` — 34+ routed endpoints
- **Tests:** 275 tests across 28 files
- **Libraries:** 20 modules in `lib/`
- **Frontend:** 12 pages in `apps/web/src/app/`
- **CLI:** `ecos-cli.js` — full command suite (status, deposit, submit,
  list, approve/reject, balance, metrics, verify, calibrate, watch,
  patches, mission, search, batch, export, leaderboard, health)
- **Monitor:** `monitor/index.js` — background daemon + status API (:3099)
- **Persistence:** `db/` — Postgres repos + schema + migrations
- **Gates / Middleware:** confidence gate, apiKeyAuth, idempotency,
  validatorAuth, voidInterlock
- **Docs:** `docs/openapi.json` — OpenAPI 3.0 spec
- **Infra:** `Dockerfile`, `Dockerfile.monitor`, `docker-compose.yml`,
  `.github/workflows/test.yml` (CI with sacred-file guard)
- **Reference:** `reference/v101-experimental-libs/` (unwired)

---

## Protocol Invariants (never change)

| File | MD5 | Held since |
|------|-----|-----------|
| `lib/fiatLedger.js` | `563e9b1f9e67091a5b6527c0a92568e5` | V38 |
| `lib/auditLog.js` | `e5a5c2c27801d2d03991bc8e5a1df8cb` | V38 |

Economic model: **40% platform / 40% validator / 20% insurance** (HITL);
**80% platform / 20% insurance** (AUTO_FLOW).
Confidence gate: AUTO ≥ 0.70, HITL ≥ 0.50.
All money is BigInt microcents (1 USD = 10,000 μ¢) — never floating point.

---

## Version lineage (high level)

- **V34–V73:** core engine, confidence gate, HITL queue, BigInt ledger,
  SHA-256 audit chain, calibrator (Platt scaling), validator JWT auth.
- **V74–V82:** stats/metrics endpoints, Prometheus gauges, dashboard
  uptime, chat intents (HELP/METRICS/LEDGER), /head endpoint. (133 tests)
- **V83:** CLI (11 cmds) + Monitor service + OpenAPI spec. (146)
- **V84:** real Ollama logprob confidence, WebSocket ValidatorHub,
  GitHub CI, Admin dashboard. (150)
- **V85–V96:** quickstart flywheel, royalties wiring, chain explorer,
  VALIDATOR_IDLE alert, rate limiting, semantic patch search,
  pagination groundwork. (→222)
- **V97:** WS JWT auth, Docker stack, mission event log, pagination. (232)
- **V98:** landing redesign, webhook notifications, auto-calibrator
  fitting, CLI TUI watch. (239)
- **V99:** event-log persistence + replay, validator reputation engine,
  mission full-text search, batch task API, audit export, smart
  validator routing. (262)
- **V100 (MILESTONE):** self-refinement agent, detailed health check,
  strategy page, production config validation, full CLI, production
  README. **(275 tests — this build.)**
- **V101 / V101_final:** diverged branch — see decision above. Not used.

---

## Running the baseline

```bash
npm install
npm test          # expect 275 passing
node ecos-cli.js --help
node scripts/dev-quickstart.js   # full economic-loop demo
docker-compose up -d             # Postgres + API + Monitor
```
