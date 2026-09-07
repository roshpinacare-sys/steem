# ECOS V271 — Canonical Server Wiring + Consolidated Registry + Health Dashboard

**Date:** 2026-06-01  
**Baseline:** ECOS V270 canonical  
**Target:** ECOS V271 canonical

---

## Executive Summary

V271 closes three outstanding gaps left open by V270:

1. **Canonical server wiring** — V263-V270 patch files are now live in `ecos-api-server.js` via a guarded IIFE `_wireV271CanonicalPatchChain271()`. Each patch is wired using its actual export shape (apply-style or stateful), with graceful fallback.

2. **Consolidated provider registry** — `consolidatedProviderRegistry271.js` (mirrored under both `src/lib/` and `lib/`) is the single source of truth for all 22 DI provider contracts defined across V263-V268. It provides runtime contract validation, safe stub generation, and a `/api/v271/providers/registry` endpoint that shows live validation status.

3. **Unified health dashboard** — Three new endpoints expose aggregated `getPerf268()` telemetry from all 22 V268 modules (`/api/v271/health/unified`), a lightweight status check (`/api/v271/health/summary`), and a V271 admin summary (`/api/v271/admin/summary`).

4. **Bloom audit × InjectionFirewall cross-reference bridge** — Two endpoints (`/api/v271/audit/bloom-firewall-check`, `/api/v271/audit/bloom-firewall-stats`) allow callers to check an input against both the AuditBloom268 filter and InjectionFirewall268 simultaneously. The postgres persistence adapter (`postgresAuditBloomAdapter271`) is mounted on the live AuditBloom268 instance at startup.

5. **PostgreSQL persistence foundation** — `db/migration_phase46.sql` adds 12 tables and 8 indexes for the V263-V269 module families that previously used in-memory state.

---

## New Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v271/providers/registry` | All 22 DI contracts + live validation status |
| GET | `/api/v271/providers/contracts` | Contract definitions (required/optional methods) |
| POST | `/api/v271/providers/validate` | Validate an ad-hoc deps map |
| GET | `/api/v271/health/unified` | All modules getPerf268() + server uptime |
| GET | `/api/v271/health/summary` | Lightweight status check |
| GET | `/api/v271/admin/summary` | V271 feature summary |
| POST | `/api/v271/audit/bloom-firewall-check` | Cross-reference input vs Bloom + Firewall |
| GET | `/api/v271/audit/bloom-firewall-stats` | Cross-reference statistics |

---

## Files Added or Changed

| File | Purpose |
|------|---------|
| `ecos-api-server.js` | Adds V271 IIFEs (patch chain, registry, health, bloom-firewall bridge) |
| `db/migration_phase46.sql` | 12-table persistence foundation for V263-V269 modules |
| `db/creditReserveRepo.js` | PostgreSQL-backed credit reserve repository |
| `db/reputationRepo.js` | PostgreSQL-backed reputation events repository |
| `src/lib/postgresAuditBloomAdapter271.js` | PostgreSQL adapter for AuditBloom268 state |
| `lib/postgresAuditBloomAdapter271.js` | Mirror (R3) |
| `src/lib/consolidatedProviderRegistry271.js` | 22 DI contract definitions + runtime validation |
| `lib/consolidatedProviderRegistry271.js` | Mirror (R3) |
| `tests/v271.test.cjs` | Structural regression tests |
| `.agent-identity.json` | Version updated to 271.0.0 |
| `package.json` | Version 271.0.0, `test:v271` script added |
| `AI_PROTOCOL_V271.md` | V271 protocol and rules |
| `NEXT_SESSION_PROMPT_V271.md` | V272 session brief |
| `CHANGELOG_V271.md` (this file) | Release notes |

---

## Rules Compliance

| Rule | Status |
|------|--------|
| R1 — Sacred files (fiatLedger, auditLog) untouched | ✅ |
| R2 — V254-V270 test compatibility preserved | ✅ |
| R3 — New versioned modules mirrored in src/lib AND lib | ✅ |
| R4 — All patch registrations fail gracefully | ✅ |
| R5 — Version stamps aligned (package.json, .agent-identity.json, MANIFEST.json) | ✅ |
| R6 — Zero new npm dependencies | ✅ |
| R7 — All new JS files pass node --check | ✅ |

---

## Next Recommended Work (V272)

- Inject `CreditReserveRepo` and `ReputationRepo` into `CreditReserve268` and `ReputationLedger268` factories to activate PostgreSQL-backed persistence.
- Extend `migration_phase46.sql` with partition-by-date on `reputation_events` for high-volume deployments.
- Wire `consolidatedProviderRegistry271` into the V270 summary route so `/api/v270/summary` includes live DI health.
