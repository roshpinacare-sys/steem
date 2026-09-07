'use strict';
/**
 * src/lib/conflictResolution431.js — ECOS V431
 *
 * Feature 1: Cross-region conflict resolution
 * Resolve sync conflicts between regions.
 *
 * @version 431.0.0
 */

const CONFLICT_RESOLUTION_VERSION431 = '431.0.0';

const _conflictState431 = {
  conflicts: [],
  resolutionStrategy: 'last_writer_wins',
};

function resolveConflict431(local, remote) {
  if (_conflictState431.resolutionStrategy === 'last_writer_wins') {
    return (new Date(local.ts) > new Date(remote.ts)) ? local : remote;
  }
  return local;
}

function wireConflictResolution431(app, opts, auditLog) {
  const BASE431 = '/api/v1/chat/route/telemetry/dashboard/trend/aggregate/sync/conflicts';

  app.get(BASE431, (req, res) => {
    res.json({ version: CONFLICT_RESOLUTION_VERSION431, ..._conflictState431 });
  });

  app.post(BASE431 + '/strategy', (req, res) => {
    if (req.body.strategy) _conflictState431.resolutionStrategy = req.body.strategy;
    res.json({ ok: true, strategy: _conflictState431.resolutionStrategy });
  });
}

module.exports = {
  CONFLICT_RESOLUTION_VERSION431,
  resolveConflict431,
  wireConflictResolution431,
};
