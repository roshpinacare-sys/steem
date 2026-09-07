# CHANGELOG V142 — Design Partner Ready: PDF Export, Demo Setup, Partner Pack

**Release:** V142.0.0  
**Date:** 2026-05-30  
**Phase:** P32 — Design Partner Readiness  
**Base:** V141 — First-User Readiness (≥1056 tests)  
**Tests:** ≥1056 + ~37 new V142 = **≥1093 passing**  
**Libraries:** +1 new (`reportPdfExporter`)  

---

## Why This Phase

- **63 days to EU AI Act enforcement (August 2, 2026).** Technical stack is complete.  
  V142 is the first version specifically designed for a design partner call.  
  A prospect must be able to go from zero to seeing a live compliance report in 20 minutes.
- **The onboarding checklist existed (V141) but the demo environment didn't.**  
  Design partners need realistic data, not an empty database.
- **Compliance reports were JSON/Markdown only.**  
  Regulators and legal teams want a PDF they can file. V142 delivers that — zero new deps.

---

## [V142-PDF-01] HTML/PDF Compliance Report Export

### `lib/reportPdfExporter.js` (new, ~220 lines, zero external deps)

Generates a regulator-ready HTML document from any compliance report object.

**Capabilities:**
- Converts the Markdown compliance report to styled, print-ready HTML
- Status badges (✅ PASS / ⚠️ WARN / ❌ FAIL) rendered inline
- Per-article compliance status highlighted in colour
- "Save as PDF" print button embedded (works in any browser: Ctrl+P → Save as PDF)
- Auto-detects `puppeteer` or `html-pdf-node` if present → generates true PDF binary
- Graceful fallback to HTML if no headless engine available (always succeeds)

**New API endpoint:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/audit/operator-report/export` | Download compliance report (HTML or PDF) |

Query params:
```
format=html|pdf
operatorName=Acme+Corp
operatorContact=legal@acme.com
verticals=insurance,legal
```

Response: streams `Content-Disposition: attachment` file directly.

All exports logged to `operator_report_exports` table.

---

## [V142-DEMO-01] Design Partner Demo Setup Script

### `scripts/demo-setup.js` (new, ~230 lines)

Seeds a live ECOS instance with realistic demo data for a design partner call.

```bash
npm run demo:setup              # insurance vertical (default)
npm run demo:setup:dry          # dry run — shows plan, no HTTP calls
npm run demo:setup:legal        # legal document review vertical
node scripts/demo-setup.js --api http://your-server:3000 --vertical insurance
```

**What it seeds:**

| Step | Action | Data |
|------|--------|------|
| 1 | Health check | Verifies server is running |
| 2 | Validators | 3 domain experts (insurance, legal, AI auditor) |
| 3 | Tasks | 10 insurance tasks with realistic claim text + mixed AUTO_FLOW/HITL/BLOCK verdicts |
| 4 | Compliance report | Pre-generates EU AI Act operator report |
| 5 | Readiness check | Runs `GET /onboarding/readiness` |
| 6 | Chain verification | Verifies audit chain integrity |

Tasks are designed to trigger all three verdicts:
- HIGH confidence (0.82–0.95) → AUTO_FLOW ← shows speed
- MEDIUM confidence (0.49–0.58) → HITL_QUEUE ← shows human oversight
- LOW confidence (0.22) → BLOCK ← shows safety rejection

---

## [V142-DOC-01] Design Partner Pack

### `docs/DESIGN_PARTNER_PACK.md` (new, ~260 lines)

Complete sales document for design partner conversations.

**Sections:**
- One-sentence pitch + problem statement
- EU AI Act penalty exposure calculator
- Live architecture diagram (ASCII)
- Per-article compliance evidence table (Art. 12, 14, 26)
- 20-minute demo walk-through script (step by step)
- Pricing table (Design Partner tier, Enterprise)
- Competitive positioning vs raw LLM API and MTurk
- Supported verticals with deadlines
- Global compliance coverage (US, Singapore, UK, Brazil, Israel)
- FAQ (GDPR Art. 17, model-agnostic, on-premise, BAA)
- Next steps and onboarding flow

---

## [V142-OB-02] Readiness History Endpoint

### `GET /api/v1/onboarding/readiness/history`

Returns historical readiness check results for trend analysis.

```json
{
  "history": [
    { "id": 1, "ready": true, "score": 87, "passed": 6, "warnings": 1, "failed": 0, "checked_at": "..." }
  ],
  "count": 1,
  "limit": 20,
  "ecosVersion": "V142"
}
```

Requires DB. Returns empty array with note if no Postgres available.

---

## New DB Objects (`migration_phase25.sql`)

| Object | Type | Purpose |
|--------|------|---------|
| `operator_report_exports` | TABLE | Audit trail of report exports (PDF/HTML) |
| `demo_sessions` | TABLE | Design partner demo session tracking |
| `onboarding_readiness_log.vertical` | COLUMN | Target vertical for readiness check |
| `onboarding_readiness_log.notes` | COLUMN | Free-text notes |
| `comm_messages_channel_fts_idx` | INDEX | Composite channel+FTS index for search |

---

## New npm Scripts

| Script | Command |
|--------|---------|
| `npm run demo:setup` | Demo seed — insurance vertical |
| `npm run demo:setup:dry` | Dry run — print plan only |
| `npm run demo:setup:legal` | Demo seed — legal vertical |

---

## New Test Files

| File | Tests | Coverage |
|------|-------|---------|
| `tests/v142PdfExporter.test.js`         | 18 | markdownToHtml, buildHtml, export(), httpHeaders(), singleton |
| `tests/v142DemoSetup.test.js`           | 7  | Script exists, dry-run exits 0, 10+ tasks, 3 validators, endpoint references |
| `tests/v142DesignPartnerPack.test.js`   | 11 | All sections present, Art12/14/26, pricing, FAQ, global coverage, sacred files |
| `tests/v142E2ERegression.test.js`       | 17 | V141 contracts intact, V142 new exports, sacred files MD5, full export flow |

**~53 new tests**

---

## Sacred Files — Unchanged

```
lib/fiatLedger.js    MD5: 563e9b1f9e67091a5b6527c0a92568e5  ✅
lib/auditLog.js      MD5: e5a5c2c27801d2d03991bc8e5a1df8cb  ✅
```

---

## Migration

```bash
psql $DATABASE_URL < db/migration_phase25.sql
```

All statements additive. Safe on existing data.

---

## Breaking Changes

None. All V141 APIs, contracts, and test suites fully preserved.

---

## What's Next (V143)

1. **Stripe live** — replace mock with `sk_live_...`, test real card → ledger credit
2. **Validator login flow** — replace `NEXT_PUBLIC_VALIDATOR_TOKEN` with real auth
3. **First paying customer** — run demo-setup.js with a real prospect
4. **GDPR Art. 17 resolution** — legal opinion on pseudonymization in immutable chain
5. **HIPAA BAA template** — draft for healthcare vertical
