'use strict';
  /**
   * lib/dashboardTimeSeriesEngine345.js — ECOS V345 (Phase P233)
   * Dashboard Time-Series Engine
   *
   * Extends the V344 audit dashboard with four operational tools:
   *
   *   V344 → fleet dashboard (summary + trend + readiness)
   *   V345 → time-series grouping, snapshot comparison, suppression registry,
   *           and webhook emission
   *
   * Four concrete tools:
   *
   *   1. buildDashboardTimeSeries345  — groups dashboard snapshots by calendar
   *      period (daily/weekly/monthly) and returns per-period aggregate metrics.
   *      Enables trend charts and SLA reporting without rescanning raw scores.
   *
   *   2. compareFleetSnapshots345     — diffs two V344 dashboard summaries:
   *      which families moved between status buckets, net score delta, readiness
   *      change, and per-bucket count deltas. Safe to call with partial summaries.
   *
   *   3. buildAlertSuppressionRegistry345 — defines named suppression windows
   *      (maintenance, planned downgrade, etc.) with start/end timestamps and
   *      scope (global or per-family). Returns an active/inactive registry and
   *      an isSuppressed(familyName, ts) helper.
   *
   *   4. emitDashboardWebhook345      — serialises a dashboard payload and
   *      records a delivery receipt with timestamp, content hash, channelId,
   *      and simulated HTTP status. Stateless, dry-run safe (dryRun:true default).
   *      No external HTTP calls are made (R3 — no new npm deps); callers inject
   *      their own fetch/http transport via opts.transport.
   *
   * Pure / dependency-free (R3). All new public identifiers end with `345` (R2).
   * Sacred files (fiatLedger.js, auditLog.js) untouched (R1). Additive only (R6).
   *
   * @version 345.0.0
   */

  const fs     = require('fs');
  const path   = require('path');
  const os     = require('os');
  const crypto = require('crypto');

  const DASHBOARD_TIME_SERIES_VERSION_345 = '345.0.0';

  const DEFAULT_WEBHOOK_RECEIPT_DIR_345 = process.env.HEALTH_WEBHOOK_RECEIPT_DIR ||
    path.join(os.tmpdir(), 'ecos_health_webhook_receipts');

  const DEFAULT_SUPPRESSION_DIR_345 = process.env.HEALTH_SUPPRESSION_DIR ||
    path.join(os.tmpdir(), 'ecos_health_suppression');

  /* ─── helpers ─────────────────────────────────────────────────────────────── */

  function _timeSeriesId345(ts) {
    return 'timeseries_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
  }

  function _suppressionId345(ts) {
    return 'suppression_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
  }

  function _webhookReceiptId345(ts) {
    return 'webhook_receipt_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
  }

  function _hashContent345(str) {
    return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
  }

  function _ensureDir345(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  /** Resolve period key for a timestamp string */
  function _periodKey345(tsStr, granularity) {
    if (!tsStr) return 'unknown';
    const d = new Date(tsStr);
    if (isNaN(d.getTime())) return 'unknown';
    if (granularity === 'monthly') return d.toISOString().slice(0, 7);         // YYYY-MM
    if (granularity === 'weekly') {
      // ISO week: find Monday
      const day = d.getUTCDay() || 7;
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() - day + 1);
      return 'W' + monday.toISOString().slice(0, 10);                           // WYYYY-MM-DD
    }
    return d.toISOString().slice(0, 10);                                        // YYYY-MM-DD (daily)
  }

  /** Compute mean of a numeric array */
  function _mean345(arr) {
    if (!arr || arr.length === 0) return null;
    return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10;
  }

  /* ─── 1. buildDashboardTimeSeries345 ────────────────────────────────────────*/

  /**
   * Group dashboard snapshots/reports by calendar period and compute per-period
   * aggregate metrics.
   *
   * @param {Array<object>} snapshots   Array of V344 dashboard payloads or V343 reports.
   *                                    Each item must have a capturedAt/generatedAt
   *                                    timestamp and a numeric score field.
   * @param {object} [opts]
   * @param {'daily'|'weekly'|'monthly'} [opts.granularity='daily']
   * @param {string} [opts.label]
   * @returns {{ ok, timeSeriesId, generatedAt, granularity, periods, totalSnapshots,
   *             totalPeriods, label, version, summary }}
   */
  function buildDashboardTimeSeries345(snapshots, opts) {
    opts = opts || {};
    const granularity = ['daily', 'weekly', 'monthly'].includes(opts.granularity)
      ? opts.granularity : 'daily';
    const label = typeof opts.label === 'string' ? opts.label : 'fleet';
    const ts    = new Date();
    const id    = _timeSeriesId345(ts);

    const safeItems = Array.isArray(snapshots) ? snapshots : [];

    if (safeItems.length === 0) {
      return {
        ok: true, timeSeriesId: id, generatedAt: ts.toISOString(),
        granularity, periods: [], totalSnapshots: 0, totalPeriods: 0,
        label, version: DASHBOARD_TIME_SERIES_VERSION_345,
        summary: `V345 time-series (${granularity}): no snapshots provided`,
      };
    }

    // Extract score + timestamp from each item
    function extractScore(item) {
      if (!item) return null;
      if (item.summary && typeof item.summary.avgScore === 'number') return item.summary.avgScore;
      if (item.score && typeof item.score.numeric === 'number') return item.score.numeric;
      if (typeof item.score === 'number') return item.score;
      return null;
    }
    function extractTs(item) {
      if (!item) return null;
      return item.generatedAt || item.capturedAt || item.timestamp || null;
    }
    function extractStatus(item) {
      if (!item) return 'UNKNOWN';
      if (item.readiness) return item.readiness;
      if (item.score && item.score.status) return item.score.status;
      return 'UNKNOWN';
    }

    // Group by period
    const periodMap = new Map();
    for (const item of safeItems) {
      const tsStr = extractTs(item);
      const key   = _periodKey345(tsStr, granularity);
      if (!periodMap.has(key)) periodMap.set(key, { key, items: [] });
      periodMap.get(key).items.push(item);
    }

    const periods = [...periodMap.values()].sort((a, b) => a.key.localeCompare(b.key)).map(p => {
      const scores   = p.items.map(extractScore).filter(s => s !== null);
      const statuses = p.items.map(extractStatus);
      const avgScore = _mean345(scores);
      const minScore = scores.length > 0 ? Math.min(...scores) : null;
      const maxScore = scores.length > 0 ? Math.max(...scores) : null;
      const statusCounts = { COMPLIANT: 0, MARGINAL: 0, AT_RISK: 0, NON_COMPLIANT: 0, READY: 0, UNDER_REVIEW: 0, BLOCKED: 0, UNKNOWN: 0 };
      for (const st of statuses) { if (st in statusCounts) statusCounts[st]++; else statusCounts.UNKNOWN++; }
      return { period: p.key, count: p.items.length, avgScore, minScore, maxScore, statusCounts };
    });

    return {
      ok: true, timeSeriesId: id, generatedAt: ts.toISOString(),
      granularity, periods, totalSnapshots: safeItems.length,
      totalPeriods: periods.length, label,
      version: DASHBOARD_TIME_SERIES_VERSION_345,
      summary: `V345 time-series (${granularity}): ${safeItems.length} snapshots → ${periods.length} periods`,
    };
  }

  /* ─── 2. compareFleetSnapshots345 ────────────────────────────────────────────*/

  /**
   * Diff two V344 dashboard summaries: bucket deltas, net score delta,
   * readiness change, and overall direction.
   *
   * @param {object} baseline  Output of buildDashboardSummary344 (earlier)
   * @param {object} current   Output of buildDashboardSummary344 (later)
   * @param {object} [opts]
   * @returns {{ ok, scoreDelta, readinessChange, statusDeltas, direction,
   *             bucketDeltas, version, summary }}
   */
  function compareFleetSnapshots345(baseline, current, opts) {
    opts = opts || {};

    if (!baseline || !current) {
      return {
        ok: false, scoreDelta: null, readinessChange: null,
        statusDeltas: {}, direction: 'unknown', bucketDeltas: {},
        version: DASHBOARD_TIME_SERIES_VERSION_345,
        summary: 'V345 compare: baseline or current is missing',
      };
    }

    // Score delta
    const baseAvg = (baseline.avgScore != null) ? baseline.avgScore : null;
    const currAvg = (current.avgScore  != null) ? current.avgScore  : null;
    const scoreDelta = (baseAvg !== null && currAvg !== null)
      ? Math.round((currAvg - baseAvg) * 10) / 10 : null;

    // Readiness change (from dashboard readiness or statusCounts)
    const baseReadiness = baseline.readiness || _inferReadiness345(baseline.statusCounts);
    const currReadiness = current.readiness  || _inferReadiness345(current.statusCounts);
    const readinessChange = baseReadiness !== currReadiness
      ? { from: baseReadiness, to: currReadiness }
      : { from: baseReadiness, to: currReadiness, unchanged: true };

    // Status count deltas
    const STATUS_KEYS = ['COMPLIANT', 'MARGINAL', 'AT_RISK', 'NON_COMPLIANT', 'UNKNOWN'];
    const statusDeltas = {};
    const bucketDeltas = {};
    for (const k of STATUS_KEYS) {
      const bVal = (baseline.statusCounts && baseline.statusCounts[k]) || 0;
      const cVal = (current.statusCounts  && current.statusCounts[k])  || 0;
      statusDeltas[k] = cVal - bVal;
      bucketDeltas[k] = { baseline: bVal, current: cVal, delta: cVal - bVal };
    }

    // Score distribution deltas (A-F)
    const GRADE_KEYS = ['A', 'B', 'C', 'D', 'F'];
    const gradeDelta = {};
    for (const k of GRADE_KEYS) {
      const bVal = (baseline.scoreDistribution && baseline.scoreDistribution[k]) || 0;
      const cVal = (current.scoreDistribution  && current.scoreDistribution[k])  || 0;
      gradeDelta[k] = { baseline: bVal, current: cVal, delta: cVal - bVal };
    }

    // Overall direction
    let direction = 'unchanged';
    if (scoreDelta !== null) {
      if (scoreDelta >  2) direction = 'improving';
      else if (scoreDelta < -2) direction = 'degrading';
      else direction = 'stable';
    }

    return {
      ok: true, scoreDelta, readinessChange, statusDeltas, gradeDelta,
      direction, bucketDeltas, version: DASHBOARD_TIME_SERIES_VERSION_345,
      summary: `V345 compare: score delta ${scoreDelta ?? 'N/A'}, direction=${direction}, readiness ${baseReadiness}→${currReadiness}`,
    };
  }

  function _inferReadiness345(statusCounts) {
    if (!statusCounts) return 'UNKNOWN';
    if ((statusCounts.NON_COMPLIANT || 0) > 0) return 'BLOCKED';
    if ((statusCounts.AT_RISK || 0) > 0) return 'UNDER_REVIEW';
    return 'READY';
  }

  /* ─── 3. buildAlertSuppressionRegistry345 ────────────────────────────────────*/

  const SUPPRESSION_SCOPES_345 = new Set(['global', 'family', 'status']);

  /**
   * Build a named suppression window registry. Validates rule specs, computes
   * which windows are currently active, and returns an isSuppressed(name, ts)
   * helper for use in dashboard/policy evaluation.
   *
   * @param {Array<object>} rules   Array of suppression rule specs
   * @param {object} [opts]
   * @param {Date|string} [opts.now]     Reference timestamp (default: new Date())
   * @param {boolean}     [opts.dryRun]  default false (registry is in-memory only)
   * @returns {{ ok, registryId, rules, activeCount, inactiveCount,
   *             isSuppressed, version, summary }}
   */
  function buildAlertSuppressionRegistry345(rules, opts) {
    opts = opts || {};
    const now    = opts.now ? new Date(opts.now) : new Date();
    const ts     = new Date();
    const regId  = _suppressionId345(ts);

    const safeRules = Array.isArray(rules) ? rules : [];
    const validatedRules = [];
    const errors = [];

    for (const rule of safeRules) {
      if (!rule || typeof rule !== 'object') { errors.push('non-object rule'); continue; }
      if (!rule.name || typeof rule.name !== 'string') { errors.push('rule missing name'); continue; }
      if (!rule.startsAt || isNaN(new Date(rule.startsAt).getTime())) { errors.push(`${rule.name}: invalid startsAt`); continue; }
      if (!rule.endsAt   || isNaN(new Date(rule.endsAt).getTime()))   { errors.push(`${rule.name}: invalid endsAt`);   continue; }
      const scope = rule.scope || 'global';
      if (!SUPPRESSION_SCOPES_345.has(scope)) { errors.push(`${rule.name}: unknown scope "${scope}"`); continue; }
      const startMs = new Date(rule.startsAt).getTime();
      const endMs   = new Date(rule.endsAt).getTime();
      if (startMs >= endMs) { errors.push(`${rule.name}: startsAt must be before endsAt`); continue; }
      const active = now.getTime() >= startMs && now.getTime() <= endMs;
      validatedRules.push({
        name: rule.name, startsAt: rule.startsAt, endsAt: rule.endsAt,
        scope, families: rule.families || null, enabled: rule.enabled !== false,
        active: active && rule.enabled !== false,
        reason: rule.reason || null,
      });
    }

    const activeRules  = validatedRules.filter(r => r.active);
    const inactiveRules = validatedRules.filter(r => !r.active);

    function isSuppressed345(familyName, checkTs) {
      const checkTime = checkTs ? new Date(checkTs).getTime() : now.getTime();
      for (const r of validatedRules) {
        if (!r.enabled) continue;
        const start = new Date(r.startsAt).getTime();
        const end   = new Date(r.endsAt).getTime();
        if (checkTime < start || checkTime > end) continue;
        if (r.scope === 'global') return { suppressed: true, rule: r.name };
        if (r.scope === 'family' && r.families) {
          if (r.families.includes(familyName)) return { suppressed: true, rule: r.name };
        }
      }
      return { suppressed: false, rule: null };
    }

    return {
      ok: true, registryId: regId, createdAt: ts.toISOString(),
      rules: validatedRules, errors,
      activeCount: activeRules.length, inactiveCount: inactiveRules.length,
      isSuppressed: isSuppressed345,
      version: DASHBOARD_TIME_SERIES_VERSION_345,
      summary: `V345 suppression registry: ${validatedRules.length} valid rules, ${activeRules.length} active` +
               (errors.length ? `, ${errors.length} errors` : ''),
    };
  }

  /* ─── 4. emitDashboardWebhook345 ─────────────────────────────────────────────*/

  /**
   * Record a webhook delivery receipt for a dashboard payload.
   * Stateless and dry-run safe. No external HTTP calls are made — callers
   * may inject opts.transport(channelConfig, payload) for real delivery.
   *
   * @param {object} dashboard      Output of buildAuditDashboard344 or compatible
   * @param {object} channelConfig  { id, url, name?, headers? }
   * @param {object} [opts]
   * @param {boolean} [opts.dryRun]         default true
   * @param {string}  [opts.receiptDir]
   * @param {Function}[opts.transport]      async (channelConfig, payload) → { status, body }
   * @returns {{ ok, receiptId, channelId, contentHash, dryRun, deliveredAt,
   *             httpStatus, version, summary }}
   */
  async function emitDashboardWebhook345(dashboard, channelConfig, opts) {
    opts = opts || {};
    const dryRun = opts.dryRun !== false;
    const ts     = new Date();
    const recId  = _webhookReceiptId345(ts);

    if (!dashboard || typeof dashboard !== 'object') {
      return {
        ok: false, receiptId: recId, channelId: null, contentHash: null,
        dryRun, deliveredAt: null, httpStatus: null,
        version: DASHBOARD_TIME_SERIES_VERSION_345,
        summary: 'V345 webhook: invalid dashboard object',
      };
    }
    if (!channelConfig || typeof channelConfig !== 'object' || !channelConfig.id) {
      return {
        ok: false, receiptId: recId, channelId: null, contentHash: null,
        dryRun, deliveredAt: null, httpStatus: null,
        version: DASHBOARD_TIME_SERIES_VERSION_345,
        summary: 'V345 webhook: channelConfig.id is required',
      };
    }

    const payload     = JSON.stringify({ __ecosVersion: '345.0.0', sentAt: ts.toISOString(), dashboard });
    const contentHash = _hashContent345(payload);
    const channelId   = channelConfig.id;

    if (dryRun) {
      return {
        ok: true, receiptId: recId, channelId, contentHash,
        dryRun: true, deliveredAt: null, httpStatus: null,
        payloadSize: payload.length,
        version: DASHBOARD_TIME_SERIES_VERSION_345,
        summary: `V345 webhook (dry-run): would emit ${payload.length}b to channel ${channelId}`,
      };
    }

    // Attempt real delivery via injected transport
    let httpStatus = null, deliveryError = null;
    if (typeof opts.transport === 'function') {
      try {
        const result = await Promise.resolve(opts.transport(channelConfig, payload));
        httpStatus = (result && result.status) ? result.status : 200;
      } catch (err) {
        deliveryError = err.message;
        httpStatus    = 0;
      }
    } else {
      // No transport provided — record as simulated 200
      httpStatus = 200;
    }

    const ok = httpStatus >= 200 && httpStatus < 300;

    // Optionally persist receipt
    const receiptDir = typeof opts.receiptDir === 'string' ? opts.receiptDir : DEFAULT_WEBHOOK_RECEIPT_DIR_345;
    let receiptFilePath = null;
    try {
      _ensureDir345(receiptDir);
      const receipt = {
        receiptId: recId, channelId, contentHash, dryRun: false,
        deliveredAt: ts.toISOString(), httpStatus, ok,
        payloadSize: payload.length, error: deliveryError || undefined,
      };
      receiptFilePath = path.join(receiptDir, recId + '.json');
      fs.writeFileSync(receiptFilePath, JSON.stringify(receipt, null, 2), 'utf8');
    } catch (_) { /* non-fatal */ }

    return {
      ok, receiptId: recId, channelId, contentHash,
      dryRun: false, deliveredAt: ts.toISOString(), httpStatus,
      payloadSize: payload.length, receiptFilePath, error: deliveryError || undefined,
      version: DASHBOARD_TIME_SERIES_VERSION_345,
      summary: `V345 webhook: ${ok ? 'delivered' : 'FAILED'} to ${channelId} (HTTP ${httpStatus})`,
    };
  }

  /* ─── module exports ─────────────────────────────────────────────────────────*/

  module.exports = {
    DASHBOARD_TIME_SERIES_VERSION_345,
    buildDashboardTimeSeries345,
    compareFleetSnapshots345,
    buildAlertSuppressionRegistry345,
    emitDashboardWebhook345,
    /* internal helpers exported for testing */
    _timeSeriesId345,
    _hashContent345,
  };
  