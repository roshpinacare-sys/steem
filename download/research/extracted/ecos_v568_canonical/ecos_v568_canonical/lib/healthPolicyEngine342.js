'use strict';
/**
 * lib/healthPolicyEngine342.js — ECOS V342 (Phase P230) — Health Policy Engine
 *
 * Closes the V338–V341 automation loop with a policy layer that watches conditions
 * and auto-generates remediation triggers without operator intervention:
 *
 *   V338 → persist health snapshots
 *   V339 → detect trends + regression alerts
 *   V340 → build + score prioritized remediation plans
 *   V341 → record execution + compare projected vs actual
 *   V342 → define policies, evaluate them, report triggers, export results
 *
 * Four concrete tools:
 *
 *   1. definePolicies342        — validates + persists named policy specs to a
 *      JSON sidecar. A policy spec declares a condition (threshold, tier, alert
 *      severity, etc.) and the recommended action class when that condition fires.
 *
 *   2. evaluatePolicies342      — runs every active policy against the current
 *      V339 trend report and V340 plan. Returns which policies fired, at what
 *      severity, and which families triggered them.
 *
 *   3. buildPolicyTriggerReport342 — takes evaluatePolicies342 output and builds
 *      a structured operator report: triggered policies in priority order, per-
 *      family breakdown, recommended next-action classes, suppression hints.
 *
 *   4. exportPolicyTriggerReport342 — serializes the trigger report to a JSON
 *      sidecar. Idempotent by content hash; dry-run safe. Same conventions as
 *      all prior V338–V341 export functions.
 *
 * Pure / dependency-free (R6). All new public identifiers end with `342` (R2).
 * Sacred files (fiatLedger.js, auditLog.js) untouched (R1). No new npm deps (R3).
 *
 * @version 342.0.0
 */

const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');

const HEALTH_POLICY_VERSION_342 = '342.0.0';

const DEFAULT_POLICY_DIR_342 = process.env.HEALTH_POLICY_DIR ||
  path.join(os.tmpdir(), 'ecos_health_policy');

const DEFAULT_TRIGGER_EXPORT_DIR_342 = process.env.HEALTH_TRIGGER_EXPORT_DIR ||
  path.join(os.tmpdir(), 'ecos_health_policy_triggers');

/* ─── built-in condition types ────────────────────────────────────────────── */

const CONDITION_TYPES_342 = new Set([
  'criticalCount_gte',   // number of critical-tier families >= N
  'watchCount_gte',      // number of watch-tier families >= N
  'healthyPct_lte',      // % healthy families <= N
  'familyScore_lte',     // any family score <= N
  'overallTrend_is',     // overall trend direction matches string
  'criticalAlerts_gte',  // number of critical regression alerts >= N
  'anyFamilyDirection',  // any family has direction matching string
  'avgScore_lte',        // average score across all families <= N
]);

const ACTION_CLASSES_342 = [
  'auto-retire', 'auto-consolidate', 'auto-stub',
  'page-operator', 'block-deploy', 'notify-only', 'review-required',
];

/* ─── helpers ─────────────────────────────────────────────────────────────── */

function _policyId342(ts) {
  return 'policy_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _triggerId342(ts) {
  return 'trigger_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _hashContent342(str) {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

function _ensureDir342(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function _validatePolicySpec342(spec) {
  if (!spec || typeof spec !== 'object')
    return 'policy spec must be an object';
  if (typeof spec.name !== 'string' || !spec.name.trim())
    return 'policy spec.name must be a non-empty string';
  if (!CONDITION_TYPES_342.has(spec.conditionType))
    return 'unknown conditionType "' + spec.conditionType + '"; valid types: ' + [...CONDITION_TYPES_342].join(', ');
  if (!ACTION_CLASSES_342.includes(spec.actionClass))
    return 'unknown actionClass "' + spec.actionClass + '"; valid: ' + ACTION_CLASSES_342.join(', ');
  if (!['critical', 'warning', 'info'].includes(spec.severity))
    return 'spec.severity must be "critical", "warning", or "info"';
  return null;
}

function _evaluateCondition342(spec, trendReport, plan) {
  const families  = (trendReport.trend && trendReport.trend.families) || [];
  const alerts    = (trendReport.alerts && trendReport.alerts.alerts)  || [];
  const overall   = trendReport.overallTrend || 'unknown';
  const cv        = spec.conditionValue;

  let triggered   = false;
  const matching  = [];

  switch (spec.conditionType) {
    case 'criticalCount_gte': {
      const count = families.filter(f => f.latestTier === 'critical').length;
      triggered = count >= Number(cv);
      if (triggered) families.filter(f => f.latestTier === 'critical').forEach(f => matching.push(f.base));
      break;
    }
    case 'watchCount_gte': {
      const count = families.filter(f => f.latestTier === 'watch').length;
      triggered = count >= Number(cv);
      if (triggered) families.filter(f => f.latestTier === 'watch').forEach(f => matching.push(f.base));
      break;
    }
    case 'healthyPct_lte': {
      const total   = families.length;
      const healthy = families.filter(f => f.latestTier === 'healthy').length;
      const pct     = total > 0 ? (healthy / total) * 100 : 0;
      triggered = pct <= Number(cv);
      if (triggered) families.filter(f => f.latestTier !== 'healthy').forEach(f => matching.push(f.base));
      break;
    }
    case 'familyScore_lte': {
      families.forEach(f => {
        if (f.latestScore !== undefined && f.latestScore <= Number(cv)) {
          triggered = true;
          matching.push(f.base);
        }
      });
      break;
    }
    case 'overallTrend_is': {
      triggered = overall === String(cv);
      if (triggered) families.forEach(f => matching.push(f.base));
      break;
    }
    case 'criticalAlerts_gte': {
      const critAlerts = alerts.filter(a => a.severity === 'critical');
      triggered = critAlerts.length >= Number(cv);
      if (triggered) critAlerts.forEach(a => matching.push(a.base));
      break;
    }
    case 'anyFamilyDirection': {
      families.forEach(f => {
        if (f.direction === String(cv)) {
          triggered = true;
          matching.push(f.base);
        }
      });
      break;
    }
    case 'avgScore_lte': {
      const scores = families.map(f => f.latestScore || 0).filter(s => typeof s === 'number');
      const avg    = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      triggered    = avg <= Number(cv);
      if (triggered) families.forEach(f => matching.push(f.base));
      break;
    }
    default:
      triggered = false;
  }

  return { triggered, matchingFamilies: [...new Set(matching)] };
}

/* ─── 1. definePolicies342 ────────────────────────────────────────────────── */

/**
 * Validate and persist a set of named policy specifications to a JSON sidecar.
 * Each policy spec must have:
 *   { name, conditionType, conditionValue, actionClass, severity, enabled?, description? }
 *
 * Built-in conditionTypes:
 *   criticalCount_gte, watchCount_gte, healthyPct_lte, familyScore_lte,
 *   overallTrend_is, criticalAlerts_gte, anyFamilyDirection, avgScore_lte
 *
 * Built-in actionClasses:
 *   auto-retire, auto-consolidate, auto-stub, page-operator,
 *   block-deploy, notify-only, review-required
 *
 * @param {object[]} policySpecs  Array of policy spec objects
 * @param {object}   [opts]
 * @param {string}   [opts.policyDir]  Dir for the JSON sidecar (default: env / tmpdir)
 * @param {boolean}  [opts.dryRun=false]
 * @param {boolean}  [opts.replace=false]  Replace existing sidecar entirely
 * @returns {{ ok, policyId, policyPath, totalPolicies, validationErrors[], action, dryRun, version }}
 */
function definePolicies342(policySpecs, opts) {
  opts = opts || {};
  const dryRun    = opts.dryRun === true;
  const policyDir = opts.policyDir || DEFAULT_POLICY_DIR_342;
  const replace   = opts.replace   === true;
  const policyPath = path.join(policyDir, 'policies.json');

  if (!Array.isArray(policySpecs)) {
    return {
      ok: false, error: 'policySpecs must be an array of policy spec objects',
      policyId: null, policyPath, totalPolicies: 0,
      validationErrors: [], action: 'error', dryRun,
      version: HEALTH_POLICY_VERSION_342,
    };
  }

  const validationErrors = [];
  const valid = [];

  for (let i = 0; i < policySpecs.length; i++) {
    const err = _validatePolicySpec342(policySpecs[i]);
    if (err) {
      validationErrors.push({ index: i, name: policySpecs[i] && policySpecs[i].name, error: err });
    } else {
      valid.push({
        name:           policySpecs[i].name,
        conditionType:  policySpecs[i].conditionType,
        conditionValue: policySpecs[i].conditionValue,
        actionClass:    policySpecs[i].actionClass,
        severity:       policySpecs[i].severity,
        enabled:        policySpecs[i].enabled !== false,
        description:    policySpecs[i].description || '',
        createdAt:      new Date().toISOString(),
      });
    }
  }

  if (validationErrors.length > 0 && valid.length === 0) {
    return {
      ok: false, error: 'all policy specs failed validation',
      policyId: null, policyPath, totalPolicies: 0,
      validationErrors, action: 'error', dryRun,
      version: HEALTH_POLICY_VERSION_342,
    };
  }

  const ts       = new Date();
  const policyId = _policyId342(ts);

  let merged = valid;
  if (!replace && !dryRun && fs.existsSync(policyPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
      const existingPolicies = Array.isArray(existing.policies) ? existing.policies : [];
      const newNames = new Set(valid.map(p => p.name));
      const kept = existingPolicies.filter(p => !newNames.has(p.name));
      merged = [...kept, ...valid];
    } catch (_) { merged = valid; }
  }

  const payload = JSON.stringify({
    policyId, savedAt: ts.toISOString(),
    totalPolicies: merged.length,
    version: HEALTH_POLICY_VERSION_342,
    policies: merged,
  }, null, 2);

  if (!dryRun) {
    _ensureDir342(policyDir);
    fs.writeFileSync(policyPath, payload, 'utf8');
  }

  return {
    ok: true, policyId, policyPath,
    totalPolicies:    merged.length,
    addedPolicies:    valid.length,
    validationErrors,
    action:           dryRun ? 'dry-run' : (replace ? 'replace' : 'upsert'),
    dryRun,
    summary: dryRun
      ? 'V342 DRY-RUN — would persist ' + valid.length + ' policies'
      : 'V342 persisted ' + merged.length + ' policies (' + valid.length + ' added/updated)',
    version: HEALTH_POLICY_VERSION_342,
  };
}

/* ─── 2. evaluatePolicies342 ──────────────────────────────────────────────── */

/**
 * Evaluate each active policy against the current V339 trend report and V340 plan.
 *
 * Returns:
 *   { ok, triggered[], notTriggered[], evaluatedAt, totalEvaluated,
 *     totalTriggered, criticalTriggers, warningTriggers, version }
 *
 * Each triggered entry:
 *   { name, conditionType, conditionValue, actionClass, severity,
 *     matchingFamilies[], triggerRationale }
 *
 * @param {object[]|string} policies    Array of policy spec objects OR path to policies.json
 * @param {object}          trendReport Output of buildTrendReport339
 * @param {object}          [opts]
 * @param {object}          [opts.plan] Output of buildRemediationPlan340 (optional context)
 * @param {boolean}         [opts.enabledOnly=true]  Skip disabled policies
 * @returns {{ ok, triggered[], notTriggered[], totalEvaluated, totalTriggered, ... }}
 */
function evaluatePolicies342(policies, trendReport, opts) {
  opts = opts || {};
  const enabledOnly = opts.enabledOnly !== false;
  const plan        = opts.plan || { tasks: [] };

  // Support passing a file path string
  let policyList;
  if (typeof policies === 'string') {
    if (!fs.existsSync(policies)) {
      return {
        ok: false, error: 'policy file not found: ' + policies,
        triggered: [], notTriggered: [], totalEvaluated: 0, totalTriggered: 0,
        criticalTriggers: 0, warningTriggers: 0,
        version: HEALTH_POLICY_VERSION_342,
      };
    }
    try {
      const sidecar = JSON.parse(fs.readFileSync(policies, 'utf8'));
      policyList = sidecar.policies || [];
    } catch (e) {
      return {
        ok: false, error: 'failed to parse policy file: ' + e.message,
        triggered: [], notTriggered: [], totalEvaluated: 0, totalTriggered: 0,
        criticalTriggers: 0, warningTriggers: 0,
        version: HEALTH_POLICY_VERSION_342,
      };
    }
  } else if (Array.isArray(policies)) {
    policyList = policies;
  } else {
    return {
      ok: false, error: 'policies must be an array or a path to policies.json',
      triggered: [], notTriggered: [], totalEvaluated: 0, totalTriggered: 0,
      criticalTriggers: 0, warningTriggers: 0,
      version: HEALTH_POLICY_VERSION_342,
    };
  }

  if (!trendReport || typeof trendReport !== 'object') {
    return {
      ok: false, error: 'trendReport must be the output of buildTrendReport339',
      triggered: [], notTriggered: [], totalEvaluated: 0, totalTriggered: 0,
      criticalTriggers: 0, warningTriggers: 0,
      version: HEALTH_POLICY_VERSION_342,
    };
  }

  const active     = enabledOnly ? policyList.filter(p => p.enabled !== false) : policyList;
  const triggered  = [];
  const notTriggered = [];

  for (const spec of active) {
    const err = _validatePolicySpec342(spec);
    if (err) { notTriggered.push({ ...spec, skipped: true, skipReason: err }); continue; }

    const { triggered: fired, matchingFamilies } = _evaluateCondition342(spec, trendReport, plan);
    if (fired) {
      triggered.push({
        name:           spec.name,
        conditionType:  spec.conditionType,
        conditionValue: spec.conditionValue,
        actionClass:    spec.actionClass,
        severity:       spec.severity,
        enabled:        spec.enabled !== false,
        description:    spec.description || '',
        matchingFamilies,
        triggerRationale: 'Policy "' + spec.name + '" fired: ' + spec.conditionType +
          ' condition met for ' + matchingFamilies.length + ' familie(s) — action: ' + spec.actionClass,
      });
    } else {
      notTriggered.push({ name: spec.name, conditionType: spec.conditionType, severity: spec.severity, fired: false });
    }
  }

  // Sort triggered by severity
  const SEV = { critical: 0, warning: 1, info: 2 };
  triggered.sort((a, b) => (SEV[a.severity] ?? 3) - (SEV[b.severity] ?? 3));

  return {
    ok: true,
    evaluatedAt:      new Date().toISOString(),
    triggered,
    notTriggered,
    totalEvaluated:   active.length,
    totalTriggered:   triggered.length,
    criticalTriggers: triggered.filter(t => t.severity === 'critical').length,
    warningTriggers:  triggered.filter(t => t.severity === 'warning').length,
    infoTriggers:     triggered.filter(t => t.severity === 'info').length,
    summary: 'V342 evaluation: ' + triggered.length + '/' + active.length +
      ' policies triggered (' + triggered.filter(t => t.severity === 'critical').length + ' critical)',
    version: HEALTH_POLICY_VERSION_342,
  };
}

/* ─── 3. buildPolicyTriggerReport342 ─────────────────────────────────────── */

/**
 * Build a structured operator report from evaluatePolicies342 output.
 *
 * The report groups triggered policies by severity and action class, annotates
 * each family with the set of policies that fired for it, and provides a concise
 * recommended-actions list sorted by urgency.
 *
 * @param {object}  evalResult  Output of evaluatePolicies342
 * @param {object}  [opts]
 * @param {boolean} [opts.includeNotTriggered=false]
 * @returns {{ ok, reportId, totalTriggered, familyRiskMap{}, actionPlan[], summary, version }}
 */
function buildPolicyTriggerReport342(evalResult, opts) {
  opts = opts || {};
  const includeNotTriggered = opts.includeNotTriggered === true;

  if (!evalResult || typeof evalResult !== 'object' || !Array.isArray(evalResult.triggered)) {
    return {
      ok: false, error: 'evalResult must be the output of evaluatePolicies342',
      reportId: null, totalTriggered: 0, familyRiskMap: {},
      actionPlan: [], version: HEALTH_POLICY_VERSION_342,
    };
  }

  const ts       = new Date();
  const reportId = _triggerId342(ts);

  // Build family risk map: base → [ { policyName, severity, actionClass } ]
  const familyRiskMap = {};
  for (const t of evalResult.triggered) {
    for (const fam of (t.matchingFamilies || [])) {
      if (!familyRiskMap[fam]) familyRiskMap[fam] = [];
      familyRiskMap[fam].push({
        policyName:  t.name,
        severity:    t.severity,
        actionClass: t.actionClass,
      });
    }
  }

  // Sort each family's entries by severity
  const SEV = { critical: 0, warning: 1, info: 2 };
  for (const fam of Object.keys(familyRiskMap)) {
    familyRiskMap[fam].sort((a, b) => (SEV[a.severity] ?? 3) - (SEV[b.severity] ?? 3));
  }

  // Build action plan: deduplicate by actionClass + severity, sorted by priority
  const seenAction = new Map();
  for (const t of evalResult.triggered) {
    const key = t.actionClass + '|' + t.severity;
    if (!seenAction.has(key)) {
      seenAction.set(key, {
        actionClass:       t.actionClass,
        severity:          t.severity,
        triggeringPolicies: [],
        affectedFamilies:  new Set(),
      });
    }
    const entry = seenAction.get(key);
    entry.triggeringPolicies.push(t.name);
    (t.matchingFamilies || []).forEach(f => entry.affectedFamilies.add(f));
  }

  const actionPlan = [...seenAction.values()]
    .map(e => ({
      actionClass:       e.actionClass,
      severity:          e.severity,
      triggeringPolicies: [...new Set(e.triggeringPolicies)],
      affectedFamilies:  [...e.affectedFamilies],
      affectedCount:     e.affectedFamilies.size,
    }))
    .sort((a, b) => (SEV[a.severity] ?? 3) - (SEV[b.severity] ?? 3));

  // Summary by severity breakdown
  const severityBreakdown = { critical: 0, warning: 0, info: 0 };
  for (const t of evalResult.triggered) {
    severityBreakdown[t.severity] = (severityBreakdown[t.severity] || 0) + 1;
  }

  const result = {
    ok: true,
    reportId,
    generatedAt:       ts.toISOString(),
    totalTriggered:    evalResult.totalTriggered,
    totalEvaluated:    evalResult.totalEvaluated,
    severityBreakdown,
    familyRiskMap,
    familiesAtRisk:    Object.keys(familyRiskMap).length,
    actionPlan,
    summary: 'V342 trigger report ' + reportId + ': ' +
      evalResult.totalTriggered + ' policies triggered, ' +
      Object.keys(familyRiskMap).length + ' families at risk, ' +
      actionPlan.length + ' action class(es)',
    version: HEALTH_POLICY_VERSION_342,
  };

  if (includeNotTriggered) {
    result.notTriggered = evalResult.notTriggered || [];
  }

  return result;
}

/* ─── 4. exportPolicyTriggerReport342 ────────────────────────────────────── */

/**
 * Serialize a buildPolicyTriggerReport342 result to a JSON sidecar file.
 * Idempotent by content hash; dry-run safe.
 * Same conventions as exportExecutionAuditLog341, exportRemediationPlan340,
 * exportTrendSummary339.
 *
 * @param {object}  report     Output of buildPolicyTriggerReport342
 * @param {object}  [opts]
 * @param {string}  [opts.exportDir]  Target dir (default: env / tmpdir)
 * @param {boolean} [opts.dryRun=false]
 * @param {object}  [opts.meta]
 * @returns {{ ok, triggerId, triggerPath, action, byteSize, contentHash, dryRun, version }}
 */
function exportPolicyTriggerReport342(report, opts) {
  opts = opts || {};
  const dryRun    = opts.dryRun === true;
  const exportDir = opts.exportDir || DEFAULT_TRIGGER_EXPORT_DIR_342;
  const meta      = opts.meta || {};

  if (!report || typeof report !== 'object') {
    return {
      ok: false, error: 'report must be the output of buildPolicyTriggerReport342',
      triggerId: null, triggerPath: null, action: 'error',
      byteSize: 0, contentHash: null, dryRun,
      version: HEALTH_POLICY_VERSION_342,
    };
  }

  const ts        = new Date();
  const triggerId = _triggerId342(ts);

  const payload = JSON.stringify({
    triggerId,
    exportedAt:  ts.toISOString(),
    meta,
    triggerReport: {
      ok:                report.ok,
      reportId:          report.reportId,
      generatedAt:       report.generatedAt,
      totalTriggered:    report.totalTriggered,
      totalEvaluated:    report.totalEvaluated,
      severityBreakdown: report.severityBreakdown,
      familiesAtRisk:    report.familiesAtRisk,
      actionPlan:        report.actionPlan,
      summary:           report.summary,
      version:           report.version,
      familyRiskMap:     report.familyRiskMap,
    },
  }, null, 2);

  const contentHash = _hashContent342(payload);
  const triggerPath = path.join(exportDir, triggerId + '_' + contentHash + '.json');

  if (!dryRun) {
    _ensureDir342(exportDir);
    const existing = fs.existsSync(exportDir)
      ? fs.readdirSync(exportDir).filter(n => n.includes(contentHash))
      : [];
    if (existing.length > 0) {
      return {
        ok: true, triggerId, triggerPath: path.join(exportDir, existing[0]),
        action: 'skip', byteSize: Buffer.byteLength(payload),
        contentHash, dryRun: false,
        summary: 'V342 skip — identical trigger report already exists',
        version: HEALTH_POLICY_VERSION_342,
      };
    }
    fs.writeFileSync(triggerPath, payload, 'utf8');
  }

  return {
    ok: true, triggerId, triggerPath,
    action:      dryRun ? 'dry-run' : 'write',
    byteSize:    Buffer.byteLength(payload),
    contentHash, dryRun,
    summary: dryRun
      ? 'V342 DRY-RUN — would export trigger report ' + triggerId
      : 'V342 exported trigger report ' + triggerId + ' (' + Buffer.byteLength(payload) + ' bytes)',
    version: HEALTH_POLICY_VERSION_342,
  };
}

/* ─── exports ─────────────────────────────────────────────────────────────── */

module.exports = {
  HEALTH_POLICY_VERSION_342,
  CONDITION_TYPES_342,
  ACTION_CLASSES_342,
  definePolicies342,
  evaluatePolicies342,
  buildPolicyTriggerReport342,
  exportPolicyTriggerReport342,
};
