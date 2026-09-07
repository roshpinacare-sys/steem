# ECOS V127 — Changelog
**Release Name:** Global First  
**Date:** 2026-05-30  
**Base:** V126 — Live Integration (~1104 tests, 58 libs, 20 pages)  
**Tests:** ~1104 (V126) + ~28 new V127 = **~1132 passing**  
**Libraries:** 58 → **59** (new: globalComplianceMap.js)

---

## Strategic Shift — V127

**V126 and earlier were EU-centric.** V127 is the first version designed for
a global market from the ground up.

The audit chain, HITL gate, and confidence calibrator map onto EVERY major
regulatory framework — not just EU AI Act. V127 makes this explicit in
code, docs, API, and sales positioning.

Relevant markets (all mapped in V127):
- **North America:** NIST AI RMF, HIPAA, CCPA/CPRA, SEC model risk, EO 14110
- **Europe:** EU AI Act, GDPR, UK AI White Paper
- **Asia-Pacific:** MAS FEAT (Singapore), METI 2.0 (Japan), AU AI Ethics, India DPDP
- **Latin America:** LGPD (Brazil), Brazil AI Bill
- **Middle East:** UAE AI Strategy 2031, Israel PPA

---

## What's New

### [V127-G01] Global Compliance Map (`lib/globalComplianceMap.js`)

New library covering 15+ jurisdictions across 5 regions.

```javascript
const { getFrameworks, getJurisdiction, getApplicable, getSummaryStats } = require('./lib/globalComplianceMap');

// Get all frameworks relevant to an insurance company in US + EU + Singapore
const applicable = getApplicable(['us-federal', 'us-state', 'eu', 'singapore'], 'insurance');
// → { frameworks[], highPriority[], opportunities[] }
```

**New API endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/compliance/global-map` | Full matrix — all jurisdictions + frameworks |
| GET | `/api/v1/compliance/region/:id` | Single jurisdiction details |
| GET | `/api/v1/compliance/applicable` | Applicable frameworks for customer's setup |
| GET | `/api/v1/compliance/nist-report` | NIST AI RMF alignment report |
| GET | `/api/v1/compliance/hipaa-report` | HIPAA audit controls report |
| GET | `/api/v1/compliance/privacy-report` | Privacy compliance report (jurisdiction param) |

---

### [V127-G02] Documentation — `docs/GLOBAL_COMPLIANCE.md`

Comprehensive global compliance reference replacing EU-only focus.
Covers all regions, all frameworks, gaps, next steps, and region-specific
sales pitches.

---

### [V127-OPS01] Environment Config Audit (`scripts/check-env.js`)

```bash
node scripts/check-env.js           # check all vars, report status
node scripts/check-env.js --strict  # exit 1 if required vars missing (for CI)
npm run check:env                   # alias
```

Covers all 30 env vars: core, database, Stripe, confidence thresholds,
MMR/chain params, rate limits, validator config.

Validates:
- Stripe key format (`sk_live_...` / `sk_test_...`)
- Webhook secret format (`whsec_...`)
- JWT secret not default dev value in production
- JWT secret length ≥ 32 chars in production

---

### [V127-OPS02] Health Endpoint v2

`GET /api/v1/health` now returns expanded operational status:

```json
{
  "status": "ok",
  "version": "V127",
  "ecosystem": "V127 — Global First",
  "mmr": {
    "leafCount": 4821,
    "lastCheckpointAt": "2026-05-30T14:22:00.000Z",
    "checkpointInterval": 50,
    "compactionStats": { "threshold": 500, "archiveCount": 9, "lastCompactAt": "..." }
  },
  "chain": { "intact": true, "headHash": "...", "tailHash": "..." },
  "payments": {
    "stripeConfigured": false,
    "availableRails": ["manual", "bank"]
  },
  "compliance": {
    "jurisdictionsCovered": 12,
    "frameworksMapped": 26
  }
}
```

---

### [V127-STR01] Stripe Live Readiness

`lib/stripeProvider.js` now:
- Logs a startup warning if `STRIPE_API_KEY` is missing in production
- Validates key format on init (`sk_live_...` or `sk_test_...`)
- Separates live vs test mode in all responses (`mode: 'live' | 'test' | 'mock'`)
- Exposes `isConfigured()` and `getMode()` for health endpoint
- Documents exact steps to go live in `README.md` (STR-01 instructions)

---

### [V127-DX01] SDK README Update

`sdk/README.md` now documents all V125 + V126 + V127 methods with examples:
- Complete method list with types
- getNonce / resolveApproval with nonce field
- compactMMR, backfillAuditEntries, getCheckpointSchedule
- getCompactionLog
- compliance methods (getGlobalMap, getApplicable)

---

### [V127-DX02] OpenAPI v127

`docs/openapi.json` updated with all V125/V126/V127 endpoints.
New tags: `compliance` (global map, applicable, reports).

---

## Tests Added

| File | Tests | Coverage |
|------|-------|---------|
| `tests/v127GlobalCompliance.test.js` | 12 | getFrameworks filter by region/vertical, getApplicable returns highPriority, getSummaryStats totals, getJurisdiction returns known+null |
| `tests/v127CheckEnv.test.js`         | 6  | script runs, reports missing required, validates Stripe key format, validates JWT secret |
| `tests/v127HealthV2.test.js`         | 10 | includes mmr.leafCount, includes chain.intact, includes payments.stripeConfigured, includes compliance.jurisdictionsCovered |

---

## Sacred Files — Unchanged

```
lib/fiatLedger.js    MD5: 563e9b1f9e67091a5b6527c0a92568e5  ✅
lib/auditLog.js      MD5: e5a5c2c27801d2d03991bc8e5a1df8cb  ✅
```

---

## Migration from V126

No new DB tables. No migration scripts needed.

New env vars (all optional with defaults):
- None (check-env.js documents existing vars; no new required vars)

---

## What's Next (V128)

1. **First paying customer** — Stripe live + hosted demo + validator onboarding
2. **Validator login flow** — replace `NEXT_PUBLIC_VALIDATOR_TOKEN` with real auth
3. **GDPR Art. 17 resolution** — legal opinion on pseudonymization in immutable chain
4. **HIPAA BAA template** — if entering healthcare vertical
5. **Israel Innovation Authority** — apply for R&D grant (OPPORTUNITY from V127 gap analysis)
