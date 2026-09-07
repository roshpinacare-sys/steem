'use strict';
/**
 * src/lib/rollbackSimulation431.js — ECOS V431
 *
 * Feature 3: Rollback simulation
 * Simulate rollbacks before execution.
 *
 * @version 431.0.0
 */

const ROLLBACK_SIMULATION_VERSION431 = '431.0.0';

function simulateRollback431(rotationId, deps) {
  const d = deps || {};
  const rotation = (d.history || []).find(r => r.rotationId428 === rotationId);
  
  if (!rotation) return { ok: false, error: 'rotation not found' };
  
  return {
    ok: true,
    simulation: true,
    rotationId,
    wouldReimport: rotation.oldKeyIdsCount,
    wouldDeactivate: rotation.newKeysCount,
    estimatedTimeMs: 150,
  };
}

function wireRollbackSimulation431(app, opts, auditLog) {
  const BASE431 = '/api/v1/solvency/tower/auth/keys/bulk/rotate/rollback/simulate';

  app.post(BASE431, (req, res) => {
    const { rotationId } = req.body;
    let history = [];
    try {
      const r428 = require('./bulkKeyRotation428.js');
      history = r428._rotationState428.rotations;
    } catch (_) {}
    res.json(simulateRollback431(rotationId, { history }));
  });
}

module.exports = {
  ROLLBACK_SIMULATION_VERSION431,
  simulateRollback431,
  wireRollbackSimulation431,
};
