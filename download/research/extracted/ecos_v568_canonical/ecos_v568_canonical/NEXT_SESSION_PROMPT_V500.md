# NEXT_SESSION_PROMPT_V500.md — Start of V501

## State at V500 (milestone)
- Version 500.0.0. New: `governanceTick500` — the learning beat: runs the unified V499 cycle
  (propose-only) + feeds the V462 engine so the operator learns across beats. Endpoints
  /api/v1/diamond/governance-tick, /heartbeat-trends. NOT a third heartbeat (no timer).
- Diamond arc complete: V453 operator · V462 foresight · V463/495/496 self-awareness · V497 cleanup ·
  V498 debt-vision · V499 unified cycle · V500 learning beat.
- Sacred intact; node --check clean; tests/v500.test.js green.
- KNOWN pre-existing broken suite: `inclusionProof.test.js` (fails on clean base too) — fix or quarantine.

## ⚠️ Pre-flight (do FIRST)
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v500.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
POST /api/v1/diamond/governance-tick       # one learning beat (propose mode)
```
- Sacred immutable; lib mirrors src/lib; suffix ids; R3/R6 no new npm deps; no nesting / no *-patch.js.
- Heartbeats already exist (454/465) — do NOT add another; connect/reuse.

## High-leverage next (V501 — pick ONE)
1. **Wire the existing heartbeat (465) to call governanceTick500** each beat (consolidating: makes the
   real scheduler drive the learning beat). Verify 465's existing behavior + endpoints still pass.
2. **Flatten meshDispatcher (×10)** — incremental, per the recorded method (union module → repoint server
   requires one at a time → thin re-export). The real chain retirement; highest cleanup leverage.
3. **Fix or quarantine `inclusionProof.test.js`.**
4. **Surface the Diamond to users (chat):** an endpoint/where the sovereign assistant explains current
   posture + proposals in plain language, so users see the system protecting them.

## Packaging
`ecos_v501_canonical.zip`, root `ecos_v501_canonical/`.
