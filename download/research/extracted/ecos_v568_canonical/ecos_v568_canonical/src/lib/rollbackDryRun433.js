'use strict';
/**
 * src/lib/rollbackDryRun433.js — ECOS V433
 *
 * Feature 3: Rollback dry-run
 * Dry-run for rollbacks — simulates without mutating state.
 *
 * @version 433.0.0
 */

const ROLLBACK_DRY_RUN_VERSION433 = '433.0.0';

function dryRunRollback433(rotationId, history) {
  const rotation = (history || []).find(r => r.rotationId428 === rotationId);
  if (!rotation) return { ok: false, error: 'not found' };

  return {
    ok: true,
    dryRun: true,
    rotationId,
    wouldRestore: rotation.oldKeyIdsCount,
    wouldRevoke: rotation.newKeysCount,
    estimatedDurationMs: (rotation.oldKeyIdsCount + rotation.newKeysCount) * 50,
  };
}

function wireRollbackDryRun433(app, opts, auditLog) {
  const BASE433 = '/api/v1/solvency/tower/auth/keys/bulk/rotate/rollback/dryrun';

  app.get(BASE433, (req, res) => {
    const { rotationId } = req.query || {};
    let history = [];
    try {
      const r428 = require('./bulkKeyRotation428.js');
      history = r428._rotationState428.rotations;
    } catch (_) {}
    res.json(dryRunRollback433(rotationId, history));
  });
}

module.exports = {
  ROLLBACK_DRY_RUN_VERSION433,
  dryRunRollback433,
  wireRollbackDryRun433,
};
