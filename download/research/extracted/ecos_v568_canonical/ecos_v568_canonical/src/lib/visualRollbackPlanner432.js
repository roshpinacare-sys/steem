'use strict';
/**
 * src/lib/visualRollbackPlanner432.js — ECOS V432
 *
 * Feature 3: Visual rollback planner
 * Visual tool to plan rollbacks.
 *
 * @version 432.0.0
 */

const VISUAL_ROLLBACK_PLANNER_VERSION432 = '432.0.0';

function planRollbackVisual432(rotationId, history) {
  const rotation = history.find(r => r.rotationId428 === rotationId);
  if (!rotation) return { ok: false, error: 'not found' };
  
  return {
    ok: true,
    plan: {
      steps: [
        { action: 'Verify backup', status: 'ready' },
        { action: 'Restore old keys', count: rotation.oldKeyIdsCount },
        { action: 'Revoke new keys', count: rotation.newKeysCount },
      ],
    },
  };
}

function wireVisualRollbackPlanner432(app, opts, auditLog) {
  const BASE432 = '/api/v1/solvency/tower/auth/keys/bulk/rotate/rollback/plan';

  app.get(BASE432, (req, res) => {
    const { rotationId } = req.query;
    let history = [];
    try {
      const r428 = require('./bulkKeyRotation428.js');
      history = r428._rotationState428.rotations;
    } catch (_) {}
    res.json(planRollbackVisual432(rotationId, history));
  });
}

module.exports = {
  VISUAL_ROLLBACK_PLANNER_VERSION432,
  planRollbackVisual432,
  wireVisualRollbackPlanner432,
};
