'use strict';
/**
 * lib/auditCompletenessProbe519.js — ECOS V519 (Phase P407)
 *
 * CONNECTION (Action D — audit completeness): every money-touching endpoint
 * in ecos-api-server.js should pass through guardMint402 / guardWithdraw402
 * AND emit an auditLog record. This module is a READ-ONLY probe that
 * scans the server source, identifies money-touching endpoints by path
 * heuristics, and reports which handlers lack a visible guard/audit hook.
 *
 * It DOES NOT change any handler. It DOES NOT register descriptors anywhere.
 * It only surfaces the gap so future versions can decide which handlers
 * deserve a guard/audit (some are read-only views — e.g. /withdrawals/history
 * GET — and should be flagged as exempt manually).
 *
 * Endpoints:
 *   V519-T01 GET /api/v1/registry/audit-completeness-v519/status
 *   V519-T02 GET /api/v1/registry/audit-completeness-v519/full
 *   V519-T03 GET /api/v1/admin/summary/v519
 */

const fs   = require('fs');
const path = require('path');

const PROBE_VERSION_519 = '519.0.0';

// Path tokens that indicate a money-touching endpoint.
// Order matters only for classification (first match wins).
const MONEY_TOKENS_519 = Object.freeze([
  { token: 'mint',     kind: 'mint' },
  { token: 'withdraw', kind: 'withdraw' },
  { token: 'transfer', kind: 'transfer' },
  { token: 'settle',   kind: 'settle' },
  { token: 'payout',   kind: 'payout' },
  { token: 'disburse', kind: 'disburse' },
  { token: 'royalt',   kind: 'royalty' },
]);

// Tokens that, when present in the handler body, count as a guard call.
const GUARD_TOKENS_519 = Object.freeze([
  'guardMint402', 'guardWithdraw402',
]);

// Tokens that, when present in the handler body, count as an audit hook.
const AUDIT_TOKENS_519 = Object.freeze([
  'auditLog', 'auditAppend', 'audit.append', 'AuditLog',
]);

const ROUTE_RE_519 = /^\s*app\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/;

function _readServerSource519() {
  const p = path.resolve(__dirname, '..', 'ecos-api-server.js');
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

function _classifyPath519(pth) {
  const lower = String(pth || '').toLowerCase();
  for (const t of MONEY_TOKENS_519) {
    if (lower.indexOf(t.token) !== -1) return t.kind;
  }
  return null;
}

// Approximate "handler body": from the matching route line up to the next
// top-level `app.<verb>(` route (or 200 lines, whichever is smaller).
function _handlerBody519(lines, startIdx) {
  const out = [];
  const MAX = 200;
  for (let i = startIdx; i < lines.length && i < startIdx + MAX; i++) {
    if (i !== startIdx && ROUTE_RE_519.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

function scanServer519() {
  const src = _readServerSource519();
  if (!src) {
    return {
      ok: false,
      reason: 'ecos-api-server.js not found',
      endpoints: [],
      totals: { moneyTouching: 0, withGuard: 0, withAudit: 0, missingGuard: 0, missingAudit: 0 },
    };
  }
  const lines = src.split('\n');
  const endpoints = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(ROUTE_RE_519);
    if (!m) continue;
    const method = m[1].toUpperCase();
    const pth    = m[2];
    const kind   = _classifyPath519(pth);
    if (!kind) continue;
    const body = _handlerBody519(lines, i);
    const hasGuard = GUARD_TOKENS_519.some(t => body.indexOf(t) !== -1);
    const hasAudit = AUDIT_TOKENS_519.some(t => body.indexOf(t) !== -1);
    const isReadOnly = method === 'GET'; // GETs are usually views, not movers
    endpoints.push({
      method, path: pth, kind, line: i + 1,
      hasGuard, hasAudit, isReadOnly,
      needsGuardReview: !isReadOnly && !hasGuard,
      needsAuditReview: !isReadOnly && !hasAudit,
    });
  }
  const totals = endpoints.reduce((a, e) => {
    a.moneyTouching++;
    if (e.hasGuard) a.withGuard++;
    if (e.hasAudit) a.withAudit++;
    if (e.needsGuardReview) a.missingGuard++;
    if (e.needsAuditReview) a.missingAudit++;
    return a;
  }, { moneyTouching: 0, withGuard: 0, withAudit: 0, missingGuard: 0, missingAudit: 0 });
  return { ok: true, endpoints, totals };
}

function getProbeSummary519() {
  const r = scanServer519();
  return Object.freeze({
    version: PROBE_VERSION_519,
    moneyTouching:   r.totals.moneyTouching,
    withGuard:       r.totals.withGuard,
    withAudit:       r.totals.withAudit,
    missingGuard:    r.totals.missingGuard,
    missingAudit:    r.totals.missingAudit,
    bridgeRegistrationsThisVersion: 0,
    contract: 'money-touching = path matches mint|withdraw|transfer|settle|payout|disburse|royalt; review-required = non-GET handler with no visible guard402 / auditLog token',
  });
}

function registerEndpoints519(app) {
  if (!app || typeof app.get !== 'function') return;

  app.get('/api/v1/registry/audit-completeness-v519/status', (req, res) => {
    try {
      res.json({ ok: true, summary: getProbeSummary519(), ecosVersion: 'V519' });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V519' });
    }
  });

  app.get('/api/v1/registry/audit-completeness-v519/full', (req, res) => {
    try {
      const r = scanServer519();
      res.json({ ok: r.ok, report: r, ecosVersion: 'V519' });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V519' });
    }
  });

  app.get('/api/v1/admin/summary/v519', (req, res) => {
    try {
      const summary = getProbeSummary519();
      res.json({
        ok: true,
        version: PROBE_VERSION_519,
        phase:   'P407',
        feature: 'audit-completeness-probe',
        action:  'D — surface money-touching endpoints that lack visible guard402/auditLog',
        description: 'Read-only probe over ecos-api-server.js. Classifies endpoints by path token (mint|withdraw|transfer|settle|payout|disburse|royalt) and reports which non-GET handlers do not visibly reference guardMint402/guardWithdraw402 or an auditLog hook. Zero behavior change. Zero descriptors registered. Output is a review queue, not a verdict.',
        summary,
        endpoints: [
          'V519-T01 GET /api/v1/registry/audit-completeness-v519/status',
          'V519-T02 GET /api/v1/registry/audit-completeness-v519/full',
          'V519-T03 GET /api/v1/admin/summary/v519',
        ],
        thesis:      'Truth > optics. Surfacing gaps is the prerequisite for closing them. fail-closed: unknown handler = flagged for review, not auto-cleared.',
        ecosVersion: 'V519',
        timestamp:   Date.now(),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V519' });
    }
  });
}

module.exports = {
  PROBE_VERSION_519,
  MONEY_TOKENS_519,
  GUARD_TOKENS_519,
  AUDIT_TOKENS_519,
  scanServer519,
  getProbeSummary519,
  registerEndpoints519,
};
