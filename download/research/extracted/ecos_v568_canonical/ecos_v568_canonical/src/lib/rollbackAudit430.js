'use strict';
/**
 * src/lib/rollbackAudit430.js — ECOS V430
 *
 * Feature 3: Rollback audit trail
 * Detailed audit for rollback events.
 *
 * @version 430.0.0
 */

const ROLLBACK_AUDIT_VERSION430 = '430.0.0';

const _rollbackAuditState430 = {
  events: [],
};

function recordRollbackAudit430(rollbackData, deps) {
  const event = {
    ts: new Date().toISOString(),
    ...rollbackData,
    auditId430: 'raudit430_' + require('crypto').randomBytes(4).toString('hex'),
  };
  
  _rollbackAuditState430.events.push(event);
  
  const d = deps || {};
  if (d.auditLog && typeof d.auditLog.append === 'function') {
    d.auditLog.append({ type: 'rollback_detailed_audit430', ...event });
  }
  
  return event;
}

function wireRollbackAudit430(app, opts, auditLog) {
  const BASE430 = '/api/v1/solvency/tower/auth/keys/bulk/rotate/rollback/audit';

  app.get(BASE430 + '/events', (req, res) => {
    res.json({ ok: true, events: _rollbackAuditState430.events });
  });
}

module.exports = {
  ROLLBACK_AUDIT_VERSION430,
  recordRollbackAudit430,
  wireRollbackAudit430,
};
