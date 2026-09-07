'use strict';
/**
 * distributionAuditLedger424.js — ECOS V424 Feature 2
 * Persist each x402 distribution to the audit log with full pool snapshot
 * so distributions are independently verifiable.
 * R1: sacred files untouched. R2: all identifiers end in 424. R3: no new npm deps.
 */

const { createHash } = require('crypto');

const _distributionLedger424 = [];
const _ledgerMeta424 = {
  totalDistributions: 0,
  totalAmountLogged: 0,
  lastEntry: null,
};

const MAX_LEDGER424 = 10000;

/**
 * buildDistributionEntry424(distribution, poolSnapshot, auditLog) → entry
 */
function buildDistributionEntry424(distribution, poolSnapshot = {}, auditLog = null) {
  const ts = Date.now();
  const id424 = createHash('sha256')
    .update(`dist424:${ts}:${Math.random()}`)
    .digest('hex')
    .slice(0, 16);

  const entry = {
    id424,
    ts,
    iso: new Date(ts).toISOString(),
    distribution: { ...distribution },
    poolSnapshot: { ...poolSnapshot },
    hash: createHash('sha256')
      .update(JSON.stringify({ distribution, poolSnapshot, ts }))
      .digest('hex'),
  };

  if (_distributionLedger424.length >= MAX_LEDGER424) {
    _distributionLedger424.shift();
  }
  _distributionLedger424.push(entry);
  _ledgerMeta424.totalDistributions++;
  _ledgerMeta424.totalAmountLogged += (distribution.amount || 0);
  _ledgerMeta424.lastEntry = entry.iso;

  if (auditLog && typeof auditLog.log === 'function') {
    auditLog.log('distribution_audit424', {
      id424,
      amount: distribution.amount,
      poolId: distribution.poolId,
      hash: entry.hash,
    });
  }

  return entry;
}

function getLedgerEntries424(limit = 100) {
  const entries = _distributionLedger424.slice(-Math.min(limit, MAX_LEDGER424));
  return { entries, meta: { ..._ledgerMeta424 }, total: _distributionLedger424.length };
}

function verifyDistributionEntry424(entry) {
  if (!entry || !entry.hash) return { valid: false, reason: 'missing entry or hash' };
  const expected = createHash('sha256')
    .update(JSON.stringify({ distribution: entry.distribution, poolSnapshot: entry.poolSnapshot, ts: entry.ts }))
    .digest('hex');
  return { valid: expected === entry.hash, expected, actual: entry.hash };
}

function getLedgerSummary424() {
  return {
    ..._ledgerMeta424,
    entriesInMemory: _distributionLedger424.length,
    maxCapacity: MAX_LEDGER424,
  };
}

function wireDistributionAuditLedger424(app, auditLog, distributionScheduler423) {
  /* POST /api/v1/x402/distribute/audit */
  app.post('/api/v1/x402/distribute/audit', (req, res) => {
    const { distribution = {}, poolSnapshot = {} } = req.body || {};
    if (!distribution.amount && distribution.amount !== 0) {
      return res.status(400).json({ ok: false, error: 'distribution.amount required' });
    }
    const entry = buildDistributionEntry424(distribution, poolSnapshot, auditLog);
    res.json({ ok: true, entry });
  });

  /* GET /api/v1/x402/distribute/audit/ledger */
  app.get('/api/v1/x402/distribute/audit/ledger', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    res.json({ ok: true, ...getLedgerEntries424(limit) });
  });

  /* GET /api/v1/x402/distribute/audit/summary */
  app.get('/api/v1/x402/distribute/audit/summary', (req, res) => {
    res.json({ ok: true, summary: getLedgerSummary424() });
  });

  /* POST /api/v1/x402/distribute/audit/verify */
  app.post('/api/v1/x402/distribute/audit/verify', (req, res) => {
    const { entry } = req.body || {};
    if (!entry) return res.status(400).json({ ok: false, error: 'entry required' });
    const result = verifyDistributionEntry424(entry);
    res.json({ ok: true, ...result });
  });
}

if (process.env.NODE_ENV === 'test') {
  module.exports = {
    buildDistributionEntry424,
    getLedgerEntries424,
    verifyDistributionEntry424,
    getLedgerSummary424,
    wireDistributionAuditLedger424,
    _distributionLedger424,
    _ledgerMeta424,
  };
} else {
  module.exports = {
    buildDistributionEntry424,
    getLedgerEntries424,
    verifyDistributionEntry424,
    getLedgerSummary424,
    wireDistributionAuditLedger424,
  };
}
