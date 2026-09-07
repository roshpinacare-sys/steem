# ECOS Changelog — V114

**Version:** 114.0.0  
**Date:** 2026-05-29  
**Previous:** V113 (113.0.0)  
**Build:** ecos_v114_canonical.zip

## Summary

V114 closes the P10 production-hardening targets left after V113 and adds the new Compliance Proxy product surface. The release keeps the sacred files untouched while making the P9 endpoints safer and better documented.

| Track | Status | Deliverables |
|---|---:|---|
| Track A — P10 hardening | Complete | Rate limits for memory compaction, EU AI Act report, and snapshot listing; OpenAPI coverage; snapshot list API; EU AI Act text export via `?format=pdf`. |
| Track B — Compliance Proxy | Complete | `lib/complianceProxy.js`, `/api/v1/proxy/complete`, `/api/v1/proxy/stats`, `/api/v1/proxy/config`, web `/proxy` page, tests, and docs. |
| Track C — Versioning | Complete | `package.json` 114.0.0, OpenAPI 114.0.0, README updates, context updates, and V114 changelog. |

## New API surface

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/proxy/complete` | Execute an AI completion through confidence gating, HITL escalation, and `PROXY_CALL` audit logging. |
| `GET` | `/api/v1/proxy/stats` | Return in-memory proxy usage counters. |
| `GET` | `/api/v1/proxy/config` | Return proxy policy and API-key mode. |
| `GET` | `/api/v1/snapshot/list` | Return available snapshots from state and file sources. |
| `GET` | `/api/v1/audit/eu-ai-act-report?format=pdf` | Return a downloadable text compliance artifact. |

## Security and operations

The proxy should be protected in production with `ECOS_PROXY_API_KEY`. Completion traffic is limited to 60 requests per IP per minute, while hardening endpoints retain tighter P10 limits.

## Sacred file status

| File | Status | MD5 |
|---|---|---|
| `lib/fiatLedger.js` | Unchanged | `563e9b1f9e67091a5b6527c0a92568e5` |
| `lib/auditLog.js` | Unchanged | `e5a5c2c27801d2d03991bc8e5a1df8cb` |
