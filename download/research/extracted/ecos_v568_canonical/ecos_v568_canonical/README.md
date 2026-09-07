# ECOS v411 — Canonical Bundle (Federation Auditor Distribution Reliability)

**Bundle ID:** `ecos_v411_canonical`
**Baseline:** `ecos_v410_canonical`
**Version:** `411.0.0`
**Generated:** see `MANIFEST.json` → `generated_at`

V411 is **additive on top of V410** and preserves every V361..V410 module
and endpoint. It turns the V410 distribution-layer outputs (master
attestation bundle, checkpoint replay verifier, dispute alert severity
escalation, archive pin continuity monitor) into **durable, chained,
ack-tracked, trend-analyzed** records.

## What's new in V411

| # | Direction | Module | Purpose |
|---|-----------|--------|---------|
| D1 | Attestation Bundle Ledger     | `src/lib/solvencyFederationAttestationBundleLedger411.js` | Append-only hash-chained ledger of V410 master attestation bundles. |
| D2 | Checkpoint Replay Trend       | `src/lib/solvencyFederationCheckpointReplayTrend411.js`   | Longitudinal trend over V410 replay reports: deltas, valid runs, longest streak. |
| D3 | Alert Acknowledgement Ledger  | `src/lib/solvencyFederationAlertAcknowledgement411.js`    | Operator-ack tracking over V410 escalation records; outstanding-only view. |
| D4 | Pin Continuity Trend          | `src/lib/solvencyFederationPinContinuityTrend411.js`      | Longitudinal trend over V410 pin-continuity reports: deltas, clean streaks, lastAnomalyAt. |

Wiring: `ecos-api-server-v411-patch.js` exports
`wire411({ app, logger, v410 })` and mounts 10 endpoints under
`/api/v1/solvency/federation/*` plus `/api/v1/admin/summary/v411`. See
`AI_PROTOCOL_V411.md` for the full endpoint list.

## Run it

```bash
NODE_ENV=test node tests/v411.test.js
# Total: 19 | ✓ Passed: 19 | ✗ Failed: 0
```
