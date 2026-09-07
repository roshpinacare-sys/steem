# NEXT_SESSION_PROMPT_V501.md — Start of V502

## State at V501
- Version 501.0.0. New: `heartbeatGovernanceState501` — the existing heartbeat465 now beats on REAL
  state from the V499 unified cycle (was a constant healthScore=70 placeholder). Endpoints
  /api/v1/diamond/heartbeat/governance-state|start|stop|status. No new scheduler.
- Diamond arc: V453 operator · V462 foresight · V463/495/496 self-awareness · V497 cleanup ·
  V498 debt-vision · V499 unified cycle · V500 learning beat · V501 real heartbeat blood.
- Sacred intact; node --check clean; tests/v501.test.js green.
- KNOWN pre-existing broken suite: `inclusionProof.test.js` (fails on clean base too) — fix or quarantine.

## ⚠️ Pre-flight (do FIRST)
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v501.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
GET /api/v1/diamond/heartbeat/governance-state   # real healthScore (not 70)
```
- Sacred immutable; lib mirrors src/lib; suffix ids; R3/R6 no new npm deps; no nesting / no *-patch.js.

## High-leverage next (V502 — pick ONE)
1. **Surface the Diamond to USERS (chat):** an endpoint where the sovereign assistant explains current
   posture + why, in plain language, so users SEE the system protecting them. Connects V499 cognition → chat (V414/415).
2. **Flatten meshDispatcher (×10)** — incremental per the recorded method (union module → repoint server
   requires one at a time → thin re-export). The real chain retirement.
3. **Fix or quarantine `inclusionProof.test.js`.**
4. **Retire the V465 placeholder provider:** point the original /heartbeat/start at governanceSystemState501 too,
   so there is ONE real heartbeat (consolidate the two).

## Packaging
`ecos_v502_canonical.zip`, root `ecos_v502_canonical/`.
