'use strict';
/**
 * identityAuditExporter396.js — ECOS V396 D1
 *
 * Exports all V393–V395 identity audit events to JSON, JSONL, or CSV format.
 * Supports sinceTs/untilTs windowing, actor filter, event-type filter,
 * and streaming output for large audit logs.
 *
 * Function: createIdentityAuditExporter396({ auditLog, audit })
 * Method:   exportAuditLog396(opts?)
 */

const IDENTITY_AUDIT_EXPORTER_VERSION_396 = '396.0.0';

// Produced event type
const EVT_AUDIT_EXPORT_396 = 'identity_audit_export_event_type_396';

// Known V393–V395 identity event type prefixes for default filtering
const IDENTITY_EVENT_PREFIXES_396 = [
  'identity_callsite_',
  'identity_batch_',
  'identity_gate_',
  'identity_bypass_',
  'identity_migration_',
  'identity_enforcement_',
  'identity_reconciliation_',
  'commitment_chain_',
  'chain_integrity_',
  'enforcement_policy_',
];

function _isIdentityEvent(type) {
  return IDENTITY_EVENT_PREFIXES_396.some(p => type.startsWith(p));
}

function _entryToRow(e) {
  const t   = e.type || e.eventType || '';
  const ts  = e.ts   || e.timestamp || 0;
  const d   = e.data || e.payload   || e.details || {};
  const actorId = d.actorId || d.actor || '';
  return { type: t, ts, actorId, data: d };
}

function _escapeCSV(val) {
  if (val === null || val === undefined) return '';
  const s = typeof val === 'object' ? JSON.stringify(val) : String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function createIdentityAuditExporter396(opts = {}) {
  const auditLog = opts.auditLog || opts.audit || null;

  function _getEntries() {
    if (!auditLog) return [];
    if (typeof auditLog.getEntries === 'function') return auditLog.getEntries();
    if (Array.isArray(auditLog.entries)) return auditLog.entries;
    return [];
  }

  function _appendAudit(entry) {
    if (!auditLog) return;
    if (typeof auditLog.append === 'function') auditLog.append(entry);
  }

  /**
   * exportAuditLog396(opts?)
   *
   * opts.format          — 'json' | 'jsonl' | 'csv'  (default: 'json')
   * opts.sinceTs         — only include entries with ts >= sinceTs
   * opts.untilTs         — only include entries with ts <= untilTs
   * opts.actorFilter     — string or string[] — include only matching actorIds
   * opts.eventTypeFilter — string or string[] — include only matching event types
   * opts.identityOnly    — boolean (default true) — restrict to identity event types
   * opts.limit           — max entries to export (default: unlimited)
   * opts.snapshot        — if true, append EVT_AUDIT_EXPORT_396 to audit log
   *
   * Returns: { format, count, output: string, exportedAt: number }
   */
  function exportAuditLog396(opts = {}) {
    const format       = opts.format === 'jsonl' || opts.format === 'csv' ? opts.format : 'json';
    const sinceTs      = typeof opts.sinceTs  === 'number' ? opts.sinceTs  : 0;
    const untilTs      = typeof opts.untilTs  === 'number' ? opts.untilTs  : Infinity;
    const identityOnly = opts.identityOnly !== false;
    const doSnapshot   = opts.snapshot === true;
    const limit        = typeof opts.limit === 'number' && opts.limit > 0 ? opts.limit : Infinity;

    // Normalise actor filter
    let actorSet = null;
    if (opts.actorFilter) {
      const arr = Array.isArray(opts.actorFilter) ? opts.actorFilter : [opts.actorFilter];
      actorSet = new Set(arr.filter(Boolean));
    }

    // Normalise event type filter
    let typeSet = null;
    if (opts.eventTypeFilter) {
      const arr = Array.isArray(opts.eventTypeFilter) ? opts.eventTypeFilter : [opts.eventTypeFilter];
      typeSet = new Set(arr.filter(Boolean));
    }

    const allEntries = _getEntries();
    const filtered   = [];

    for (const e of allEntries) {
      if (filtered.length >= limit) break;

      const ts     = e.ts || e.timestamp || 0;
      const type   = e.type || e.eventType || '';
      const d      = e.data || e.payload || e.details || {};
      const actorId = d.actorId || d.actor || '';

      if (ts < sinceTs)  continue;
      if (ts > untilTs)  continue;
      if (identityOnly && !_isIdentityEvent(type)) continue;
      if (typeSet  && !typeSet.has(type))           continue;
      if (actorSet && actorId && !actorSet.has(actorId)) continue;
      if (actorSet && !actorId) continue; // if filtering by actor, skip events without one

      filtered.push(e);
    }

    let output = '';

    if (format === 'json') {
      output = JSON.stringify(
        filtered.map(e => _entryToRow(e)),
        null,
        2
      );
    } else if (format === 'jsonl') {
      output = filtered.map(e => JSON.stringify(_entryToRow(e))).join('\n');
    } else {
      // CSV
      const header = 'type,ts,actorId,data';
      const rows   = filtered.map(e => {
        const row = _entryToRow(e);
        return [
          _escapeCSV(row.type),
          _escapeCSV(row.ts),
          _escapeCSV(row.actorId),
          _escapeCSV(row.data),
        ].join(',');
      });
      output = [header, ...rows].join('\n');
    }

    const now    = Date.now();
    const result = {
      version:    IDENTITY_AUDIT_EXPORTER_VERSION_396,
      format,
      count:      filtered.length,
      sinceTs,
      untilTs:    untilTs === Infinity ? null : untilTs,
      exportedAt: now,
      output,
    };

    if (doSnapshot) {
      _appendAudit({
        type: EVT_AUDIT_EXPORT_396,
        ts:   now,
        data: {
          format,
          count:   filtered.length,
          sinceTs,
          untilTs: untilTs === Infinity ? null : untilTs,
        },
      });
    }

    return result;
  }

  return {
    exportAuditLog396,
    IDENTITY_AUDIT_EXPORTER_VERSION_396,
  };
}

module.exports = {
  createIdentityAuditExporter396,
  IDENTITY_AUDIT_EXPORTER_VERSION_396,
  EVT_AUDIT_EXPORT_396,
  IDENTITY_EVENT_PREFIXES_396,
};
