'use strict';
/**
 * lib/auditWrap520.js — ECOS V520 (Phase P408)
 *
 * CONNECTION (Action D — close the gap V519 surfaced):
 * V519's auditCompletenessProbe identifies money-touching endpoints that
 * do not visibly reference an auditLog hook. V520 takes the NEXT step:
 *
 *   1. A manual CLASSIFICATIONS_520 map labels probe-surfaced endpoints
 *      as 'false-positive' (audit happens inside a service the handler
 *      calls), 'real-gap' (needs a wrapper), or 'exempt' (read-only
 *      side-effects, e.g. dry-run preview). Anything unclassified stays
 *      'unclassified' — fail-closed: do NOT auto-clear.
 *
 *   2. `wrapHandlerWithAudit520(handler, meta, opts)` returns a thin
 *      Express-style handler that, BEFORE invoking the original handler,
 *      appends a record to an AuditLog instance. When `opts.failClosed`
 *      is true and the audit append throws, the wrapped handler returns
 *      503 and the original handler is NEVER called — money cannot move
 *      without a chain entry.
 *
 *   3. A live demo endpoint POST /api/v1/audit-wrap-v520/demo proves the
 *      wrapper actually writes to an AuditLog (`getDemoAuditChain520()`
 *      exposes the head entry / length).
 *
 * SACRED is not touched: lib/auditLog.js is consumed via require, never
 * modified. No npm deps. Money math stays in BigInt μ¢ in existing
 * services — V520 only wires audit hooks, never moves funds itself.
 *
 * Endpoints:
 *   V520-T01 GET  /api/v1/registry/audit-wrap-v520/status
 *   V520-T02 GET  /api/v1/registry/audit-wrap-v520/classifications
 *   V520-T03 GET  /api/v1/registry/audit-wrap-v520/real-gaps
 *   V520-T04 POST /api/v1/audit-wrap-v520/demo
 *   V520-T05 GET  /api/v1/registry/audit-wrap-v520/demo-chain
 *   V520-T06 GET  /api/v1/admin/summary/v520
 */

const path = require('path');

const WRAP_VERSION_520 = '520.0.0';

// Manual classifications for endpoints surfaced by V519's probe as
// `needsAuditReview=true`. The probe is a regex over visible tokens, so it
// produces false-positives whenever the handler delegates to a service that
// audits internally. This table is the ONLY place gap-closure decisions live.
//
// classification:
//   'false-positive' — audit happens inside a service the handler calls.
//                      Record the rationale in `reason` so future versions
//                      do not re-flag and re-investigate.
//   'real-gap'       — handler does not audit. V520 (or later) must wrap.
//   'exempt'         — handler is read-only / dry-run / preview / no state
//                      change. Justify in `reason`.
//   'unclassified'   — (implicit) probe surfaced it, table does not list it.
//                      fail-closed: stays in the review queue.
const CLASSIFICATIONS_520 = Object.freeze({
  // V402 guards: the guard IS the audit boundary; they call auditLog
  // internally via guardMint402 / guardWithdraw402 helpers.
  'POST /api/v1/guard/mint':     { classification: 'false-positive', reason: 'guardMint402 emits audit internally; handler is a thin shell.' },
  'POST /api/v1/guard/withdraw': { classification: 'false-positive', reason: 'guardWithdraw402 emits audit internally; handler is a thin shell.' },

  // Probe / preview / dry-run endpoints that surface money-related strings in
  // the path but never move funds. Marked exempt with rationale.
  'POST /api/v1/transfer/preview':  { classification: 'exempt', reason: 'preview-only: computes a quote, no ledger write.' },
  'POST /api/v1/withdraw/quote':    { classification: 'exempt', reason: 'quote-only: read-side calculation.' },
  'POST /api/v1/payout/simulate':   { classification: 'exempt', reason: 'simulation, no ledger or external call.' },
});

function classifyEndpoint520(entry) {
  if (!entry || typeof entry.path !== 'string') return 'unclassified';
  const key = `${entry.method} ${entry.path}`;
  const row = CLASSIFICATIONS_520[key];
  return row ? row.classification : 'unclassified';
}

function _safeSummarizePayload520(payload) {
  // Defensive: cap size, strip functions / non-cloneable values. Money values
  // in payloads are commonly BigInt — auditLog.append already handles that,
  // but the summary we attach for logging must be JSON-friendly here too.
  try {
    const raw = JSON.stringify(payload, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    if (!raw) return null;
    if (raw.length <= 2048) return JSON.parse(raw);
    return { _truncated: true, _len: raw.length, sample: raw.slice(0, 1024) };
  } catch (_) {
    return { _unserializable: true };
  }
}

/**
 * Wrap an Express-style handler with an audit hook.
 *
 *   const wrapped = wrapHandlerWithAudit520(originalHandler, {
 *     kind: 'withdraw.request', source: 'POST /api/v1/withdraw',
 *   }, { failClosed: true, auditLog: someAuditLogInstance });
 *
 * Behavior:
 *   1. Before calling `handler`, append { kind, source, payload } to the
 *      provided AuditLog instance (defaults to defaultAuditLog from
 *      lib/auditLog.js).
 *   2. Payload is summarized via _safeSummarizePayload520 — at most ~2KB.
 *   3. If `opts.failClosed === true` and audit append throws, respond 503
 *      and DO NOT call `handler`. Money cannot move without a chain entry.
 *   4. Otherwise audit errors are swallowed (logged via console.warn) and
 *      `handler` still runs — matches the legacy "best-effort audit" mode.
 */
function wrapHandlerWithAudit520(handler, meta, opts) {
  if (typeof handler !== 'function') {
    throw new TypeError('wrapHandlerWithAudit520: handler must be a function');
  }
  if (!meta || typeof meta.kind !== 'string' || !meta.kind) {
    throw new TypeError('wrapHandlerWithAudit520: meta.kind is required');
  }
  if (!meta.source || typeof meta.source !== 'string') {
    throw new TypeError('wrapHandlerWithAudit520: meta.source is required');
  }
  const options    = opts || {};
  const failClosed = options.failClosed === true;
  const auditLog   = options.auditLog || require('./auditLog.js').defaultAuditLog;

  return function _auditWrapped520(req, res, next) {
    const reqBody = (req && (req.body || req.payload || req.query)) || {};
    const summary = _safeSummarizePayload520(reqBody);
    try {
      auditLog.append(meta.kind, {
        source: meta.source,
        wrap:   'V520',
        ts:     Date.now(),
        meta:   meta.extra || null,
        payload: summary,
      });
    } catch (auditErr) {
      if (failClosed) {
        if (res && typeof res.status === 'function') {
          return res.status(503).json({
            ok: false,
            error: 'audit_unavailable',
            detail: 'wrapHandlerWithAudit520: audit append failed; refusing to invoke handler (failClosed=true)',
            wrap:  'V520',
          });
        }
        // No res? Re-throw so the caller observes the failure rather than
        // silently dropping the request.
        throw auditErr;
      }
      try { console.warn('[V520] audit append failed (best-effort):', auditErr.message); } catch (_) {}
    }
    return handler(req, res, next);
  };
}

function getRealGapList520() {
  try {
    const probe = require('./auditCompletenessProbe519.js');
    const scan  = probe.scanServer519();
    if (!scan.ok) return { ok: false, reason: scan.reason || 'scan failed', realGaps: [], unclassified: [] };
    const realGaps     = [];
    const unclassified = [];
    for (const e of scan.endpoints) {
      if (!e.needsAuditReview) continue;
      const cls = classifyEndpoint520(e);
      if (cls === 'real-gap')     realGaps.push(e);
      else if (cls === 'unclassified') unclassified.push(e);
    }
    return { ok: true, realGaps, unclassified, scanned: scan.endpoints.length };
  } catch (e) {
    return { ok: false, reason: e.message, realGaps: [], unclassified: [] };
  }
}

function getWrapSummary520() {
  const gaps = getRealGapList520();
  const total = Object.keys(CLASSIFICATIONS_520).length;
  return Object.freeze({
    version: WRAP_VERSION_520,
    classifications: {
      total,
      falsePositive: Object.values(CLASSIFICATIONS_520).filter(c => c.classification === 'false-positive').length,
      exempt:        Object.values(CLASSIFICATIONS_520).filter(c => c.classification === 'exempt').length,
      realGap:       Object.values(CLASSIFICATIONS_520).filter(c => c.classification === 'real-gap').length,
    },
    probeScan: gaps.ok ? {
      scanned:        gaps.scanned,
      realGaps:       gaps.realGaps.length,
      unclassified:   gaps.unclassified.length,
    } : { error: gaps.reason },
    bridgeRegistrationsThisVersion: 0,
    contract: 'classification table closes V519 probe gaps. wrapHandlerWithAudit520(handler, meta, {failClosed}) refuses to invoke handler when failClosed=true and audit append fails — money cannot move without a chain entry.',
  });
}

// Demo audit chain — proves wrapHandlerWithAudit520 actually appends.
// Isolated AuditLog instance so we do not pollute the server's primary chain.
const { AuditLog } = require('./auditLog.js');
const _DEMO_AUDIT_520 = new AuditLog();

function getDemoAuditChain520() {
  return {
    size: _DEMO_AUDIT_520.size(),
    head: _DEMO_AUDIT_520.head(),
    verify: _DEMO_AUDIT_520.verify(),
  };
}

function registerEndpoints520(app) {
  if (!app || typeof app.get !== 'function') return;

  app.get('/api/v1/registry/audit-wrap-v520/status', (req, res) => {
    try {
      res.json({ ok: true, summary: getWrapSummary520(), ecosVersion: 'V520' });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V520' });
    }
  });

  app.get('/api/v1/registry/audit-wrap-v520/classifications', (req, res) => {
    try {
      res.json({
        ok: true,
        classifications: CLASSIFICATIONS_520,
        ecosVersion: 'V520',
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V520' });
    }
  });

  app.get('/api/v1/registry/audit-wrap-v520/real-gaps', (req, res) => {
    try {
      res.json({ ok: true, report: getRealGapList520(), ecosVersion: 'V520' });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V520' });
    }
  });

  // Live demo: a money-touching handler wrapped via wrapHandlerWithAudit520.
  // The handler itself is a no-op echo — V520 must not move funds. The point
  // is to demonstrate that an audit chain entry is created BEFORE the handler
  // runs, and that failClosed=true would refuse to run on audit failure.
  const demoHandler = function (req, res) {
    res.json({
      ok: true,
      wrapped: true,
      receivedAt: Date.now(),
      auditChainSize: _DEMO_AUDIT_520.size(),
      ecosVersion: 'V520',
    });
  };
  const wrappedDemo = wrapHandlerWithAudit520(demoHandler, {
    kind:   'demo.audit-wrap-v520',
    source: 'POST /api/v1/audit-wrap-v520/demo',
  }, {
    failClosed: true,
    auditLog:   _DEMO_AUDIT_520,
  });

  if (typeof app.post === 'function') {
    app.post('/api/v1/audit-wrap-v520/demo', wrappedDemo);
  }

  app.get('/api/v1/registry/audit-wrap-v520/demo-chain', (req, res) => {
    try {
      res.json({ ok: true, chain: getDemoAuditChain520(), ecosVersion: 'V520' });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V520' });
    }
  });

  app.get('/api/v1/admin/summary/v520', (req, res) => {
    try {
      res.json({
        ok: true,
        version: WRAP_VERSION_520,
        phase:   'P408',
        feature: 'audit-wrap + classification table',
        action:  'D — close the audit gap V519 surfaced (classify probe results; wrapper enforces audit-before-handler with failClosed)',
        description: 'Manual classification table labels every V519-probe-surfaced endpoint as false-positive / exempt / real-gap / unclassified (fail-closed default). wrapHandlerWithAudit520 enforces audit-before-handler; with failClosed=true, money-touching handlers are refused when audit cannot append. Live demo endpoint POST /api/v1/audit-wrap-v520/demo writes to an isolated AuditLog and exposes the chain via /demo-chain.',
        summary: getWrapSummary520(),
        endpoints: [
          'V520-T01 GET  /api/v1/registry/audit-wrap-v520/status',
          'V520-T02 GET  /api/v1/registry/audit-wrap-v520/classifications',
          'V520-T03 GET  /api/v1/registry/audit-wrap-v520/real-gaps',
          'V520-T04 POST /api/v1/audit-wrap-v520/demo',
          'V520-T05 GET  /api/v1/registry/audit-wrap-v520/demo-chain',
          'V520-T06 GET  /api/v1/admin/summary/v520',
        ],
        thesis:      'Surfacing > optics; closing > surfacing. Truth + fail-closed = money cannot move without a chain entry. Unclassified stays in the queue — never auto-cleared.',
        ecosVersion: 'V520',
        timestamp:   Date.now(),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V520' });
    }
  });
}

module.exports = {
  WRAP_VERSION_520,
  CLASSIFICATIONS_520,
  classifyEndpoint520,
  wrapHandlerWithAudit520,
  getRealGapList520,
  getWrapSummary520,
  getDemoAuditChain520,
  registerEndpoints520,
};
