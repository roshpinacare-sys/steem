'use strict';
/**
 * auditLedgerExport425.js — ECOS V425 Feature 2
 * Exports distribution audit entries as CSV or NDJSON for external verification.
 * R1: sacred files untouched. R2: all identifiers end in 425. R3: no new npm deps.
 */

const { createHash } = require('crypto');

const AUDIT_LEDGER_EXPORT_VERSION425 = '425.0.0';

const CSV_HEADERS425 = [
  'entryId', 'ts', 'distributionType', 'totalAmount',
  'validatorShare', 'creatorShare', 'platformShare',
  'poolSnapshotHash', 'entryHash', 'verified',
];

function escapeCSVField425(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * exportAsCSV425(entries) → CSV string
 * @param {Array} entries - distribution audit ledger entries
 */
function exportAsCSV425(entries = []) {
  const rows = [CSV_HEADERS425.join(',')];
  for (const e of entries) {
    const row = [
      e.entryId || '',
      e.ts || '',
      e.distributionType || '',
      e.totalAmount !== undefined ? e.totalAmount : '',
      e.validatorShare !== undefined ? e.validatorShare : '',
      e.creatorShare !== undefined ? e.creatorShare : '',
      e.platformShare !== undefined ? e.platformShare : '',
      e.poolSnapshotHash || '',
      e.entryHash || '',
      e.verified !== undefined ? String(e.verified) : '',
    ].map(escapeCSVField425);
    rows.push(row.join(','));
  }
  return rows.join('\n') + '\n';
}

/**
 * exportAsNDJSON425(entries) → NDJSON string (one JSON object per line)
 * @param {Array} entries - distribution audit ledger entries
 */
function exportAsNDJSON425(entries = []) {
  return entries.map(e => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '');
}

/**
 * buildExportManifest425(entries, format) → manifest object with checksum
 */
function buildExportManifest425(entries, format) {
  const payload = format === 'csv' ? exportAsCSV425(entries) : exportAsNDJSON425(entries);
  const checksum = createHash('sha256').update(payload).digest('hex');
  return {
    format,
    entryCount: entries.length,
    checksum,
    generatedAt: new Date().toISOString(),
    version: AUDIT_LEDGER_EXPORT_VERSION425,
  };
}

/**
 * filterExportEntries425(entries, opts) — filter by date range / type
 */
function filterExportEntries425(entries = [], opts = {}) {
  let result = [...entries];
  if (opts.fromTs) {
    const from = new Date(opts.fromTs).getTime();
    result = result.filter(e => e.ts && new Date(e.ts).getTime() >= from);
  }
  if (opts.toTs) {
    const to = new Date(opts.toTs).getTime();
    result = result.filter(e => e.ts && new Date(e.ts).getTime() <= to);
  }
  if (opts.distributionType) {
    result = result.filter(e => e.distributionType === opts.distributionType);
  }
  if (opts.limit) {
    result = result.slice(-Math.abs(parseInt(opts.limit, 10) || 1000));
  }
  return result;
}

/**
 * wireAuditLedgerExport425(app, auditLedger424Instance)
 */
function wireAuditLedgerExport425(app, auditLedger424Instance, auditLog) {
  function getEntries(query = {}) {
    let raw = [];
    if (auditLedger424Instance && typeof auditLedger424Instance.getEntries === 'function') {
      raw = auditLedger424Instance.getEntries() || [];
    } else if (auditLedger424Instance && Array.isArray(auditLedger424Instance.entries)) {
      raw = auditLedger424Instance.entries;
    }
    return filterExportEntries425(raw, query);
  }

  /* GET /api/v1/x402/distribute/audit/export/csv */
  app.get('/api/v1/x402/distribute/audit/export/csv', (req, res) => {
    try {
      const entries = getEntries(req.query);
      const csv = exportAsCSV425(entries);
      const manifest = buildExportManifest425(entries, 'csv');
      if (auditLog && typeof auditLog.log === 'function') {
        auditLog.log('audit_ledger_export425', { format: 'csv', entryCount: entries.length, checksum: manifest.checksum });
      }
      res.set('Content-Type', 'text/csv; charset=utf-8')
        .set('Content-Disposition', `attachment; filename="audit_ledger_${Date.now()}.csv"`)
        .set('X-Export-Checksum-425', manifest.checksum)
        .set('X-Export-Count-425', String(entries.length))
        .send(csv);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V425' });
    }
  });

  /* GET /api/v1/x402/distribute/audit/export/ndjson */
  app.get('/api/v1/x402/distribute/audit/export/ndjson', (req, res) => {
    try {
      const entries = getEntries(req.query);
      const ndjson = exportAsNDJSON425(entries);
      const manifest = buildExportManifest425(entries, 'ndjson');
      if (auditLog && typeof auditLog.log === 'function') {
        auditLog.log('audit_ledger_export425', { format: 'ndjson', entryCount: entries.length, checksum: manifest.checksum });
      }
      res.set('Content-Type', 'application/x-ndjson; charset=utf-8')
        .set('Content-Disposition', `attachment; filename="audit_ledger_${Date.now()}.ndjson"`)
        .set('X-Export-Checksum-425', manifest.checksum)
        .set('X-Export-Count-425', String(entries.length))
        .send(ndjson);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V425' });
    }
  });

  /* GET /api/v1/x402/distribute/audit/export/manifest */
  app.get('/api/v1/x402/distribute/audit/export/manifest', (req, res) => {
    try {
      const format = req.query.format === 'ndjson' ? 'ndjson' : 'csv';
      const entries = getEntries(req.query);
      const manifest = buildExportManifest425(entries, format);
      res.json({ ok: true, ecosVersion: 'V425', manifest });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V425' });
    }
  });
}

if (process.env.NODE_ENV === 'test') {
  module.exports = {
    exportAsCSV425,
    exportAsNDJSON425,
    buildExportManifest425,
    filterExportEntries425,
    wireAuditLedgerExport425,
    AUDIT_LEDGER_EXPORT_VERSION425,
    CSV_HEADERS425,
  };
} else {
  module.exports = {
    exportAsCSV425,
    exportAsNDJSON425,
    buildExportManifest425,
    filterExportEntries425,
    wireAuditLedgerExport425,
    AUDIT_LEDGER_EXPORT_VERSION425,
  };
}
