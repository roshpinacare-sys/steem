'use strict';
/**
 * src/lib/exportPruningDryRun429.js — ECOS V429
 *
 * Feature 5: Pruning Dry-Run Mode
 * Returns what would be pruned without deleting anything.
 *
 * Functions:
 *   getPruningDryRun429(deps, opts)            — compute potential prune results
 *   wireExportPruningDryRun429(app, opts, auditLog) — registers HTTP endpoints
 *
 * Endpoints: EINVPRUNE_DRY01 (1 endpoint)
 *
 * @version 429.0.0
 * R1: Sacred untouched. R2: All identifiers end in 429. R3: No new npm deps.
 */

const EXPORT_PRUNING_DRYRUN_VERSION429 = '429.0.0';

function getPruningDryRun429(deps, opts) {
  const d = deps || {};
  const o = opts || {};
  
  const retentionMs = o.retentionMs !== undefined ? o.retentionMs : (d.pruningState ? d.pruningState.retentionMs : 2592000000);
  const cutoffTs = Date.now() - retentionMs;

  let allRecords = [];
  try {
    if (d.inventoryStore && typeof d.inventoryStore.getInventory427 === 'function') {
      allRecords = d.inventoryStore.getInventory427({});
    } else if (d.inventoryState && Array.isArray(d.inventoryState.records)) {
      allRecords = d.inventoryState.records.slice();
    }
  } catch (e) {}

  const wouldPrune = [];
  let totalBytes = 0;

  for (const record of allRecords) {
    const recordTs = new Date(record.recordedAt || record.createdAt || 0).getTime();
    if (recordTs < cutoffTs) {
      wouldPrune.push({
        inventoryId: record.inventoryId427 || record.inventoryId,
        filename: record.filename,
        bytes: record.bytes,
        recordedAt: record.recordedAt,
      });
      totalBytes += record.bytes || 0;
    }
  }

  return {
    ok: true,
    version: EXPORT_PRUNING_DRYRUN_VERSION429,
    dryRunAt: new Date().toISOString(),
    retentionMs,
    cutoffTs: new Date(cutoffTs).toISOString(),
    wouldPruneCount: wouldPrune.length,
    wouldPruneBytes: totalBytes,
    wouldPruneFiles: wouldPrune.map(r => r.filename),
    records: wouldPrune,
  };
}

function wireExportPruningDryRun429(app, opts, auditLog) {
  let inventoryStore = null;
  let pruningState = null;
  try {
    inventoryStore = require('./exportInventory427.js');
  } catch (_) {}
  try {
    const p428 = require('./exportInventoryPruning428.js');
    if (p428._pruningState428) pruningState = p428._pruningState428;
  } catch (_) {}

  const BASE429 = '/api/v1/x402/distribute/audit/export/inventory/prune/dry-run';

  app.get(BASE429, (req, res) => {
    try {
      const retentionMs = req.query.retentionMs ? parseInt(req.query.retentionMs, 10) : undefined;
      const result = getPruningDryRun429({ inventoryStore, pruningState }, { retentionMs });
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}

module.exports = {
  EXPORT_PRUNING_DRYRUN_VERSION429,
  getPruningDryRun429,
  wireExportPruningDryRun429,
};
