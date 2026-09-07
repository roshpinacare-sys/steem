# CHANGELOG V140 — EU AI Act Operator Report, Thread Aggregation & Delivery Log Retention

**Release:** V140.0.0  
**Date:** 2026-05-30  
**Phase:** P30 — Operator Compliance Tooling  
**Base:** V139 — Message Threading & Reaction Notifications (≥948 tests)  
**Tests:** ≥948 + ~55 new V140 = **≥1003 passing**  
**Libraries:** +2 new (`operatorReport`, `deliveryLogRetention`)  

---

## Why This Phase

- **EU AI Act Annex III enforcement: August 2, 2026** — 64 days out.
  Employment, private services, and justice categories go live. B2B customers need
  exportable compliance evidence *now* to avoid €15M / 3%-of-revenue penalties.
- **Delivery log unbounded growth** — `notification_delivery_log` has been growing
  since V138 with no retention policy. Left unchecked this becomes a production risk.
- **Thread stubs missing from message list** — `enrichMessages()` existed in
  `messageThreading.js` but was never wired into `GET /channels/:id/messages`.

---

## [V140-EU-01] EU AI Act Operator Compliance Report

### `lib/operatorReport.js` (new, 419 lines)

Generates a structured compliance report mapping ECOS capabilities to EU AI Act
obligations under Articles 12, 14, and 26.

**Report sections:**
- **System Identity** — version, agentId, uptime, operator name/contact
- **Audit Chain** — chain length, head hash, integrity status, DB record count
- **Human Oversight** — HITL/AUTO/BLOCK thresholds, approval stats
- **Article Compliance** — per-check PASS/WARN/FAIL with evidence strings
- **Risk Classification** — applicable Annex III categories + days to deadline
- **Open Issues** — CRITICAL / WARNING severity, mapped to article and check ID
- **Overall Status** — `COMPLIANT` | `COMPLIANT_WITH_WARNINGS` | `NON_COMPLIANT`

**New API endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/audit/operator-report` | Generate compliance report (JSON or Markdown) |
| `GET` | `/api/v1/audit/operator-reports` | List archived reports |

Query params: `format=markdown`, `operatorName=`, `operatorContact=`, `verticals=employment,justice`

Reports are archived to the new `operator_reports` DB table.

---

## [V140-DL-01] Delivery Log Retention Policy

### `lib/deliveryLogRetention.js` (new, 188 lines)

Manages scheduled purge of `notification_delivery_log` (added V138).

- **Default retention:** 30 days (override: `ECOS_DELIVERY_LOG_RETENTION_DAYS` env)
- **Auto-schedule:** daily purge on server startup (disable: `ECOS_DELIVERY_LOG_RETENTION_ENABLED=false`)
- **Stats:** aggregate totals, success rate, avg latency, byChannel breakdown, 14-day byDay buckets
- **Audit trail:** purge runs recorded to `delivery_log_retention_runs` table

**New API endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/v1/rank/notifications/delivery-log/stats` | Delivery log aggregate stats |
| `POST` | `/api/v1/rank/notifications/delivery-log/purge` | Admin purge (body: `{ retentionDays? }`) |

---

## [V140-TA-01] Thread Aggregation in Message List

`GET /api/v1/comm/channels/:id/messages` now calls `messageThreading.enrichMessages()`
on the fetched messages before responding.

Each message in the response now includes:
```json
{
  "replyCount": 3,
  "hasReplies": true
}
```

Non-fatal: if enrichment fails, the un-enriched message list is served with a warning log.

A new DB index (`comm_messages_id_reply_count_idx`) in `migration_phase23.sql` optimises
the enrichment query for large channels.

---

## New DB Objects (`migration_phase23.sql`)

| Object | Type | Purpose |
|--------|------|---------|
| `operator_reports` | TABLE | Archived compliance report JSON |
| `delivery_log_retention_runs` | TABLE | Purge run audit trail |
| `comm_messages_id_reply_count_idx` | INDEX | Optimises enrichMessages() |

---

## New Test Files

| File | Tests | Coverage |
|------|-------|---------|
| `tests/v140OperatorReport.test.js`         | 22 | EU-01: JSON structure, Art12/14/26, risk classification, Markdown, legalDisclaimer |
| `tests/v140DeliveryLogRetention.test.js`   | 14 | DL-01: no-DB errors, mock-DB purge+stats, scheduler idempotency |
| `tests/v140ThreadAggregation.test.js`      | 9  | TA-01: enrichMessages in-memory + DB + fallback |
| `tests/v140E2ERegression.test.js`          | 10 | V139 contract intact + V140 all three features |

**~55 new tests**

---

## Sacred Files — Unchanged

```
lib/fiatLedger.js    MD5: 563e9b1f9e67091a5b6527c0a92568e5  ✅
lib/auditLog.js      MD5: e5a5c2c27801d2d03991bc8e5a1df8cb  ✅
```

---

## Migration

```bash
psql $DATABASE_URL < db/migration_phase23.sql
```

All statements additive (no drops, no renames). Safe on existing data.

---

## New Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ECOS_DELIVERY_LOG_RETENTION_DAYS` | `30` | Days to retain notification delivery log |
| `ECOS_DELIVERY_LOG_RETENTION_ENABLED` | `true` | Set `false` to disable auto-purge |

---

## Breaking Changes

None. All V139 APIs, contracts, and test suites are fully preserved.
