'use strict';
/**
 * lib/healthComplianceReporter343.js — ECOS V343 (Phase P231)
 * Health Compliance Reporter
 *
 * Closes the V338–V342 automation loop with a compliance layer that aggregates
 * every prior health layer into a single audit-ready document:
 *
 *   V338 → persist health snapshots
 *   V339 → detect trends + regression alerts
 *   V340 → build + score prioritized remediation plans
 *   V341 → record execution + compare projected vs actual
 *   V342 → define/evaluate health policies + trigger reports
 *   V343 → aggregate all layers → compliance snapshot → score → report → export
 *
 * Four concrete tools:
 *
 *   1. buildComplianceSnapshot343  — gathers current data from every layer (history,
 *      trend, plan, execution audit, policy evaluation) into a single normalised
 *      structure without side effects. Safe to call repeatedly.
 *
 *   2. scoreComplianceHealth343    — derives a [0..100] numeric compliance score and
 *      an A–F letter grade from the snapshot. Returns a per-layer penalty breakdown
 *      so operators can see exactly where points are lost.
 *
 *   3. buildComplianceReport343    — turns the snapshot + score into a structured
 *      operator/auditor report: executive summary, layer findings, recommendations,
 *      and a human-readable status string.
 *
 *   4. exportComplianceReport343   — writes the report to a JSON sidecar file.
 *      Idempotent by content hash; dry-run safe. Follows the same conventions as
 *      all prior V338–V342 export functions.
 *
 * Pure / dependency-free (R3). All new public identifiers end with `343` (R2).
 * Sacred files (fiatLedger.js, auditLog.js) untouched (R1). Additive only (R6).
 *
 * @version 343.0.0
 */

const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');

const HEALTH_COMPLIANCE_VERSION_343 = '343.0.0';

const DEFAULT_COMPLIANCE_EXPORT_DIR_343 = process.env.HEALTH_COMPLIANCE_EXPORT_DIR ||
  path.join(os.tmpdir(), 'ecos_health_compliance');

/* ─── helpers ─────────────────────────────────────────────────────────────── */

function _complianceId343(ts) {
  return 'compliance_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _hashContent343(str) {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

function _ensureDir343(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** Letter grade from numeric score [0..100] */
function _letterGrade343(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/** Compliance status label from score */
function _statusLabel343(score) {
  if (score >= 90) return 'COMPLIANT';
  if (score >= 70) return 'MARGINAL';
  if (score >= 50) return 'AT_RISK';
  return 'NON_COMPLIANT';
}

/* ─── 1. buildComplianceSnapshot343 ─────────────────────────────────────────*/

/**
 * Gather current data from all health layers into a normalised compliance
 * snapshot without side effects. Accepts pre-computed layer outputs so callers
 * can inject any combination; missing layers produce safe zero defaults.
 *
 * @param {object} [opts]
 * @param {object} [opts.history]        Output of loadHealthHistory338 (or compatible)
 * @param {object} [opts.trendReport]    Output of buildTrendReport339
 * @param {object} [opts.plan]           Output of buildRemediationPlan340
 * @param {object} [opts.executionAudit] Output of buildExecutionAuditLog341
 * @param {object} [opts.policyEval]     Output of evaluatePolicies342
 * @param {object} [opts.triggerReport]  Output of buildPolicyTriggerReport342
 * @param {object} [opts.meta]           Arbitrary caller metadata
 * @returns {{ ok, snapshotId, capturedAt, layers, meta, version }}
 */
function buildComplianceSnapshot343(opts) {
  opts = opts || {};
  const ts         = new Date();
  const snapshotId = _complianceId343(ts);

  /* ── layer 1: history ────────────────────────────────────────────────── */
  const history   = opts.history || {};
  const layerHistory = {
    available:        !!history.totalSnapshots,
    totalSnapshots:   history.totalSnapshots   || 0,
    latestCapturedAt: history.latestCapturedAt || null,
    oldestCapturedAt: history.oldestCapturedAt || null,
  };

  /* ── layer 2: trend ──────────────────────────────────────────────────── */
  const trend = opts.trendReport || {};
  const families = (trend.trend && trend.trend.families) || [];
  const layerTrend = {
    available:       !!(trend.ok || trend.overallTrend),
    overallTrend:    trend.overallTrend     || 'unknown',
    windowSize:      trend.windowSize       || 0,
    criticalAlerts:  trend.criticalAlerts   || 0,
    totalFamilies:   families.length,
    criticalCount:   families.filter(f => f.latestTier === 'critical').length,
    watchCount:      families.filter(f => f.latestTier === 'watch').length,
    healthyCount:    families.filter(f => f.latestTier === 'healthy').length,
    avgScore: families.length > 0
      ? Math.round(families.reduce((s, f) => s + (f.latestScore || 0), 0) / families.length * 10) / 10
      : null,
    worstFamilies: families
      .filter(f => f.latestScore !== undefined)
      .sort((a, b) => (a.latestScore || 0) - (b.latestScore || 0))
      .slice(0, 5)
      .map(f => ({ base: f.base, score: f.latestScore, tier: f.latestTier })),
  };

  /* ── layer 3: remediation plan ───────────────────────────────────────── */
  const plan = opts.plan || {};
  const layerPlan = {
    available:     !!(plan.ok || plan.planId),
    planId:        plan.planId        || null,
    totalTasks:    plan.totalTasks    || 0,
    criticalTasks: plan.criticalTasks || 0,
    watchTasks:    plan.watchTasks    || 0,
    projectedGain: plan.projectedGain || 0,
  };

  /* ── layer 4: execution audit ────────────────────────────────────────── */
  const audit = opts.executionAudit || {};
  const layerExecution = {
    available:          !!(audit.ok !== undefined),
    totalExecutions:    audit.totalExecutions    || 0,
    totalTasksExecuted: audit.totalTasksExecuted || 0,
    uniqueFamilies:     audit.uniqueFamilies     || 0,
    lastExecutionAt:    audit.lastExecutionAt    || null,
    firstExecutionAt:   audit.firstExecutionAt   || null,
  };

  /* ── layer 5: policy evaluation ──────────────────────────────────────── */
  const peval = opts.policyEval || {};
  const layerPolicy = {
    available:        !!(peval.ok !== undefined),
    totalEvaluated:   peval.totalEvaluated   || 0,
    totalTriggered:   peval.totalTriggered   || 0,
    criticalTriggers: peval.criticalTriggers || 0,
    warningTriggers:  peval.warningTriggers  || 0,
    infoTriggers:     peval.infoTriggers     || 0,
    evaluatedAt:      peval.evaluatedAt      || null,
  };

  /* ── layer 6: trigger report ─────────────────────────────────────────── */
  const treport = opts.triggerReport || {};
  const layerTrigger = {
    available:      !!(treport.ok !== undefined),
    reportId:       treport.reportId       || null,
    familiesAtRisk: treport.familiesAtRisk || 0,
    actionPlan:     Array.isArray(treport.actionPlan) ? treport.actionPlan : [],
  };

  return {
    ok: true,
    snapshotId,
    capturedAt: ts.toISOString(),
    layers: {
      history:   layerHistory,
      trend:     layerTrend,
      plan:      layerPlan,
      execution: layerExecution,
      policy:    layerPolicy,
      trigger:   layerTrigger,
    },
    meta:    opts.meta || {},
    summary: 'V343 compliance snapshot ' + snapshotId + ' captured at ' + ts.toISOString(),
    version: HEALTH_COMPLIANCE_VERSION_343,
  };
}

/* ─── 2. scoreComplianceHealth343 ────────────────────────────────────────── */

/**
 * Derive a [0..100] numeric compliance score and an A–F letter grade from a
 * buildComplianceSnapshot343 result. Returns a per-layer penalty breakdown.
 *
 * Scoring model (all caps at stated values):
 *
 *   Base score: 100
 *
 *   Layer: Trend (max penalty 30)
 *     -30  overall trend is "degrading"
 *     -15  overall trend is "declining"  (partial overlap)
 *     - 5  overall trend is "mixed"
 *     - 5  per critical-tier family (max -20)
 *     - 2  per critical regression alert (max -10)
 *     - 2  per watch-tier family beyond the first 2 (max -6)
 *
 *   Layer: Plan (max penalty 15)
 *     - 8  criticalTasks > 0 (any unresolved critical tasks outstanding)
 *     - 5  totalTasks > 10   (plan backlog growing)
 *     - 2  no plan available at all
 *
 *   Layer: Execution (max penalty 20)
 *     -20  no executions ever recorded (remediation never run)
 *     -10  last execution > 7 days ago
 *     - 5  execution coverage < 50 % of plan tasks
 *
 *   Layer: Policy (max penalty 20)
 *     -10  any critical policy triggered
 *     - 4  per additional critical trigger beyond first (max -8)
 *     - 5  no policies defined (totalEvaluated === 0)
 *     - 3  any warning triggers (flat)
 *
 *   Layer: History (max penalty 5)
 *     - 5  fewer than 2 snapshots available
 *
 * @param {object}  snapshot    Output of buildComplianceSnapshot343
 * @param {object}  [opts]
 * @param {boolean} [opts.strict=false]  All penalties doubled
 * @returns {{ ok, score, grade, status, breakdown, penalties[], version }}
 */
function scoreComplianceHealth343(snapshot, opts) {
  opts = opts || {};
  const strict = opts.strict === true;

  if (!snapshot || typeof snapshot !== 'object' || !snapshot.layers) {
    return {
      ok: false, error: 'snapshot must be the output of buildComplianceSnapshot343',
      score: 0, grade: 'F', status: 'NON_COMPLIANT',
      breakdown: {}, penalties: [],
      version: HEALTH_COMPLIANCE_VERSION_343,
    };
  }

  const L  = snapshot.layers;
  const mp = strict ? 2 : 1; // multiplier
  const penalties = [];
  let deduction = 0;

  function penalise(layer, reason, points) {
    const p = Math.min(points * mp, 100); // safety cap per item
    deduction += p;
    penalties.push({ layer, reason, points: p });
  }

  /* ── Trend layer ─────────────────────────────────────────────────────── */
  const tr = L.trend;
  if (tr.available) {
    if (tr.overallTrend === 'degrading')       penalise('trend', 'overall trend: degrading', 30);
    else if (tr.overallTrend === 'declining')  penalise('trend', 'overall trend: declining', 15);
    else if (tr.overallTrend === 'mixed')      penalise('trend', 'overall trend: mixed', 5);

    const critPenalty = Math.min(tr.criticalCount * 5, 20);
    if (critPenalty > 0) penalise('trend', tr.criticalCount + ' critical-tier families', critPenalty);

    const alertPenalty = Math.min(tr.criticalAlerts * 2, 10);
    if (alertPenalty > 0) penalise('trend', tr.criticalAlerts + ' critical regression alerts', alertPenalty);

    const extraWatch = Math.max(0, tr.watchCount - 2);
    const watchPenalty = Math.min(extraWatch * 2, 6);
    if (watchPenalty > 0) penalise('trend', tr.watchCount + ' watch families (>' + 2 + ' threshold)', watchPenalty);
  }

  /* ── Plan layer ──────────────────────────────────────────────────────── */
  const pl = L.plan;
  if (!pl.available) {
    penalise('plan', 'no remediation plan available', 2);
  } else {
    if (pl.criticalTasks > 0) penalise('plan', pl.criticalTasks + ' unresolved critical tasks', 8);
    if (pl.totalTasks > 10)   penalise('plan', 'plan backlog > 10 tasks (' + pl.totalTasks + ')', 5);
  }

  /* ── Execution layer ─────────────────────────────────────────────────── */
  const ex = L.execution;
  if (!ex.totalExecutions || ex.totalExecutions === 0) {
    penalise('execution', 'no remediation executions ever recorded', 20);
  } else {
    if (ex.lastExecutionAt) {
      const daysSince = (Date.now() - new Date(ex.lastExecutionAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince > 7) penalise('execution', 'last execution > 7 days ago (' + Math.round(daysSince) + 'd)', 10);
    }
    if (pl.totalTasks > 0) {
      const coverage = ex.totalTasksExecuted / pl.totalTasks;
      if (coverage < 0.5) penalise('execution', 'task coverage < 50% (' + Math.round(coverage * 100) + '%)', 5);
    }
  }

  /* ── Policy layer ────────────────────────────────────────────────────── */
  const po = L.policy;
  if (po.totalEvaluated === 0) {
    penalise('policy', 'no policies defined or evaluated', 5);
  } else {
    if (po.criticalTriggers > 0) {
      penalise('policy', po.criticalTriggers + ' critical policy trigger(s)', 10);
      const extraCrit = Math.min((po.criticalTriggers - 1) * 4, 8);
      if (extraCrit > 0) penalise('policy', 'additional critical triggers', extraCrit);
    }
    if (po.warningTriggers > 0) penalise('policy', po.warningTriggers + ' warning trigger(s)', 3);
  }

  /* ── History layer ───────────────────────────────────────────────────── */
  if (L.history.totalSnapshots < 2) {
    penalise('history', 'fewer than 2 health snapshots available', 5);
  }

  const score = Math.max(0, Math.min(100, 100 - deduction));
  const grade  = _letterGrade343(score);
  const status = _statusLabel343(score);

  // breakdown by layer
  const breakdown = {};
  for (const p of penalties) {
    if (!breakdown[p.layer]) breakdown[p.layer] = 0;
    breakdown[p.layer] += p.points;
  }

  return {
    ok: true,
    score: Math.round(score * 10) / 10,
    grade,
    status,
    breakdown,
    penalties,
    totalDeduction: deduction,
    strict,
    summary: 'V343 compliance score: ' + score + '/100 (' + grade + ') — ' + status,
    version: HEALTH_COMPLIANCE_VERSION_343,
  };
}

/* ─── 3. buildComplianceReport343 ────────────────────────────────────────── */

/**
 * Build a structured operator/auditor compliance report from a snapshot + score.
 *
 * The report contains:
 *   - executive summary (one-line status, score, grade)
 *   - per-layer findings (what was found, what it means)
 *   - recommendations (ranked by impact, derived from penalties)
 *   - risk matrix (families at risk × policy triggers × plan backlog)
 *   - nextSteps[] (ordered list of action items)
 *
 * @param {object}  snapshot   Output of buildComplianceSnapshot343
 * @param {object}  scoreResult Output of scoreComplianceHealth343
 * @param {object}  [opts]
 * @param {boolean} [opts.includeRawLayers=false]  Embed full layer data in report
 * @returns {{ ok, reportId, executiveSummary, layerFindings[], recommendations[],
 *             riskMatrix, nextSteps[], generatedAt, version }}
 */
function buildComplianceReport343(snapshot, scoreResult, opts) {
  opts = opts || {};
  const includeRaw = opts.includeRawLayers === true;

  if (!snapshot || !snapshot.layers) {
    return {
      ok: false, error: 'snapshot must be the output of buildComplianceSnapshot343',
      reportId: null, version: HEALTH_COMPLIANCE_VERSION_343,
    };
  }
  if (!scoreResult || typeof scoreResult.score !== 'number') {
    return {
      ok: false, error: 'scoreResult must be the output of scoreComplianceHealth343',
      reportId: null, version: HEALTH_COMPLIANCE_VERSION_343,
    };
  }

  const ts       = new Date();
  const reportId = _complianceId343(ts);
  const L        = snapshot.layers;
  const S        = scoreResult;

  /* ── executive summary ───────────────────────────────────────────────── */
  const executiveSummary = {
    status:      S.status,
    score:       S.score,
    grade:       S.grade,
    headline:    'Health compliance is ' + S.status + ' — score ' + S.score + '/100 (grade ' + S.grade + ')',
    capturedAt:  snapshot.capturedAt,
    snapshotId:  snapshot.snapshotId,
  };

  /* ── per-layer findings ──────────────────────────────────────────────── */
  const layerFindings = [
    {
      layer:    'history',
      status:   L.history.totalSnapshots >= 2 ? 'ok' : 'warn',
      headline: L.history.totalSnapshots + ' snapshot(s) in health history',
      detail:   L.history.totalSnapshots < 2
        ? 'Less than 2 health snapshots; trend analysis will be imprecise until more data accumulates.'
        : 'Sufficient snapshot history for trend analysis.',
      deduction: S.breakdown['history'] || 0,
    },
    {
      layer:    'trend',
      status:   L.trend.criticalCount > 0 ? 'critical' : (L.trend.watchCount > 2 ? 'warn' : 'ok'),
      headline: L.trend.totalFamilies + ' families: ' + L.trend.criticalCount + ' critical / ' +
                L.trend.watchCount + ' watch / ' + L.trend.healthyCount + ' healthy',
      detail:   'Overall trend: ' + L.trend.overallTrend + '. ' +
                (L.trend.criticalAlerts > 0 ? L.trend.criticalAlerts + ' critical regression alerts detected.' : 'No critical regression alerts.') +
                (L.trend.avgScore !== null ? ' Average family score: ' + L.trend.avgScore + '.' : ''),
      worstFamilies: L.trend.worstFamilies,
      deduction:     S.breakdown['trend'] || 0,
    },
    {
      layer:    'plan',
      status:   !L.plan.available ? 'warn' : (L.plan.criticalTasks > 0 ? 'critical' : 'ok'),
      headline: L.plan.available
        ? L.plan.totalTasks + ' remediation task(s) — ' + L.plan.criticalTasks + ' critical'
        : 'No remediation plan generated yet',
      detail: L.plan.available
        ? 'Plan ID: ' + L.plan.planId + '. Projected score gain: +' + (L.plan.projectedGain || 0) + ' pts.'
        : 'Run buildRemediationPlan340 to generate an actionable task list.',
      deduction: S.breakdown['plan'] || 0,
    },
    {
      layer:    'execution',
      status:   L.execution.totalExecutions === 0 ? 'critical' :
                (L.execution.lastExecutionAt &&
                 (Date.now() - new Date(L.execution.lastExecutionAt).getTime()) > 7 * 86400 * 1000
                  ? 'warn' : 'ok'),
      headline: L.execution.totalExecutions + ' execution(s) recorded — ' +
                L.execution.totalTasksExecuted + ' task(s) executed',
      detail: L.execution.totalExecutions === 0
        ? 'No remediation tasks have ever been executed. Use recordRemediationExecution341 after running tasks.'
        : 'Last execution: ' + (L.execution.lastExecutionAt || 'unknown') + '.',
      deduction: S.breakdown['execution'] || 0,
    },
    {
      layer:    'policy',
      status:   L.policy.criticalTriggers > 0 ? 'critical' :
                (L.policy.warningTriggers > 0  ? 'warn'     : 'ok'),
      headline: L.policy.totalEvaluated + ' policies evaluated — ' +
                L.policy.totalTriggered + ' triggered (' + L.policy.criticalTriggers + ' critical)',
      detail: L.policy.totalEvaluated === 0
        ? 'No policies defined. Use definePolicies342 to automate compliance monitoring.'
        : 'Policy evaluation at ' + (L.policy.evaluatedAt || 'unknown') + '. ' +
          L.policy.criticalTriggers + ' critical / ' + L.policy.warningTriggers + ' warning / ' +
          L.policy.infoTriggers + ' info trigger(s).',
      deduction: S.breakdown['policy'] || 0,
    },
  ];

  /* ── recommendations (sorted by deduction desc) ──────────────────────── */
  const penaltiesByWeight = [...(S.penalties || [])]
    .sort((a, b) => b.points - a.points);

  const recommendations = penaltiesByWeight.slice(0, 8).map((p, i) => ({
    rank:   i + 1,
    layer:  p.layer,
    issue:  p.reason,
    impact: p.points,
    action: _recommendAction343(p.layer, p.reason),
  }));

  /* ── risk matrix ─────────────────────────────────────────────────────── */
  const riskMatrix = {
    familiesAtRisk:   L.trigger.familiesAtRisk || L.trend.criticalCount + L.trend.watchCount,
    criticalPolicies: L.policy.criticalTriggers,
    planBacklog:      L.plan.totalTasks,
    executionGap:     L.execution.totalExecutions === 0 ? 'never' :
                      (L.execution.lastExecutionAt
                        ? Math.round((Date.now() - new Date(L.execution.lastExecutionAt).getTime()) / 86400000) + 'd'
                        : 'unknown'),
    overallRisk: S.score >= 80 ? 'LOW' : S.score >= 60 ? 'MEDIUM' : 'HIGH',
  };

  /* ── next steps ──────────────────────────────────────────────────────── */
  const nextSteps = _buildNextSteps343(L, S);

  const result = {
    ok: true,
    reportId,
    generatedAt:      ts.toISOString(),
    executiveSummary,
    layerFindings,
    recommendations,
    riskMatrix,
    nextSteps,
    summary:  'V343 compliance report ' + reportId + ': ' + S.status + ' score=' + S.score + ' grade=' + S.grade,
    version:  HEALTH_COMPLIANCE_VERSION_343,
  };

  if (includeRaw) result.rawLayers = L;
  return result;
}

function _recommendAction343(layer, reason) {
  if (layer === 'trend') {
    if (reason.includes('degrading'))  return 'Immediate: run buildRemediationPlan340 and execute top critical tasks';
    if (reason.includes('critical'))   return 'High: retire or consolidate critical-tier families this sprint';
    if (reason.includes('alert'))      return 'Medium: investigate regression alerts via compareProjectedVsActual341';
    return 'Low: monitor watch-tier families over next 3 snapshots';
  }
  if (layer === 'plan') {
    if (reason.includes('critical'))   return 'High: execute critical remediation tasks from current plan';
    if (reason.includes('backlog'))    return 'Medium: trim plan to top-10 tasks; re-evaluate remaining';
    return 'Low: generate a fresh plan via buildRemediationPlan340';
  }
  if (layer === 'execution') {
    if (reason.includes('never'))      return 'Critical: run first remediation execution via recordRemediationExecution341';
    if (reason.includes('7 days'))     return 'High: resume regular execution cadence (target: weekly)';
    return 'Medium: increase execution coverage to ≥50% of plan tasks';
  }
  if (layer === 'policy') {
    if (reason.includes('critical'))   return 'Critical: address all critical policy triggers immediately';
    if (reason.includes('no policies')) return 'Medium: define at least 3 baseline policies via definePolicies342';
    return 'Low: review and resolve warning policy triggers';
  }
  if (layer === 'history') {
    return 'Low: persist at least 2 health snapshots via persistHealthReport338';
  }
  return 'Review ' + layer + ' layer findings';
}

function _buildNextSteps343(L, S) {
  const steps = [];
  if (L.history.totalSnapshots < 2)
    steps.push({ priority: 'P3', action: 'Persist more health snapshots', tool: 'persistHealthReport338' });
  if (L.trend.criticalCount > 0)
    steps.push({ priority: 'P1', action: 'Retire/consolidate ' + L.trend.criticalCount + ' critical-tier families', tool: 'buildRemediationPlan340 → recordRemediationExecution341' });
  if (L.plan.criticalTasks > 0)
    steps.push({ priority: 'P1', action: 'Execute ' + L.plan.criticalTasks + ' critical remediation tasks', tool: 'recordRemediationExecution341' });
  if (L.execution.totalExecutions === 0)
    steps.push({ priority: 'P1', action: 'Record first remediation execution', tool: 'recordRemediationExecution341' });
  if (L.policy.criticalTriggers > 0)
    steps.push({ priority: 'P1', action: 'Resolve ' + L.policy.criticalTriggers + ' critical policy trigger(s)', tool: 'evaluatePolicies342 + buildPolicyTriggerReport342' });
  if (L.policy.totalEvaluated === 0)
    steps.push({ priority: 'P2', action: 'Define baseline health policies', tool: 'definePolicies342' });
  if (L.trend.criticalAlerts > 0)
    steps.push({ priority: 'P2', action: 'Investigate ' + L.trend.criticalAlerts + ' regression alert(s)', tool: 'detectRegressionAlerts339' });
  if (S.score < 70)
    steps.push({ priority: 'P2', action: 'Schedule weekly compliance review until score >= 70', tool: 'buildComplianceReport343' });

  // sort P1 first
  return steps.sort((a, b) => a.priority.localeCompare(b.priority));
}

/* ─── 4. exportComplianceReport343 ──────────────────────────────────────── */

/**
 * Serialise a buildComplianceReport343 result to a JSON sidecar file.
 * Idempotent by content hash; dry-run safe.
 * Same conventions as exportPolicyTriggerReport342, exportExecutionAuditLog341, etc.
 *
 * @param {object}  report      Output of buildComplianceReport343
 * @param {object}  [opts]
 * @param {string}  [opts.exportDir]   Target directory (default: env / tmpdir)
 * @param {boolean} [opts.dryRun=false]
 * @param {object}  [opts.meta]
 * @returns {{ ok, complianceId, compliancePath, action, byteSize, contentHash, dryRun, version }}
 */
function exportComplianceReport343(report, opts) {
  opts = opts || {};
  const dryRun    = opts.dryRun === true;
  const exportDir = opts.exportDir || DEFAULT_COMPLIANCE_EXPORT_DIR_343;
  const meta      = opts.meta || {};

  if (!report || typeof report !== 'object') {
    return {
      ok: false, error: 'report must be the output of buildComplianceReport343',
      complianceId: null, compliancePath: null, action: 'error',
      byteSize: 0, contentHash: null, dryRun,
      version: HEALTH_COMPLIANCE_VERSION_343,
    };
  }

  const ts           = new Date();
  const complianceId = _complianceId343(ts);

  const payload = JSON.stringify({
    complianceId,
    exportedAt: ts.toISOString(),
    meta,
    complianceReport: {
      ok:               report.ok,
      reportId:         report.reportId,
      generatedAt:      report.generatedAt,
      executiveSummary: report.executiveSummary,
      layerFindings:    report.layerFindings,
      recommendations:  report.recommendations,
      riskMatrix:       report.riskMatrix,
      nextSteps:        report.nextSteps,
      summary:          report.summary,
      version:          report.version,
    },
  }, null, 2);

  const contentHash   = _hashContent343(payload);
  const compliancePath = path.join(exportDir, complianceId + '_' + contentHash + '.json');

  if (!dryRun) {
    _ensureDir343(exportDir);
    const existing = fs.existsSync(exportDir)
      ? fs.readdirSync(exportDir).filter(n => n.includes(contentHash))
      : [];
    if (existing.length > 0) {
      return {
        ok: true, complianceId, compliancePath: path.join(exportDir, existing[0]),
        action: 'skip', byteSize: Buffer.byteLength(payload),
        contentHash, dryRun: false,
        summary: 'V343 skip — identical compliance report already exists',
        version: HEALTH_COMPLIANCE_VERSION_343,
      };
    }
    fs.writeFileSync(compliancePath, payload, 'utf8');
  }

  return {
    ok: true, complianceId, compliancePath,
    action:      dryRun ? 'dry-run' : 'write',
    byteSize:    Buffer.byteLength(payload),
    contentHash, dryRun,
    summary: dryRun
      ? 'V343 DRY-RUN — would export compliance report ' + complianceId
      : 'V343 exported compliance report ' + complianceId + ' (' + Buffer.byteLength(payload) + ' bytes)',
    version: HEALTH_COMPLIANCE_VERSION_343,
  };
}

/* ─── exports ─────────────────────────────────────────────────────────────── */

module.exports = {
  HEALTH_COMPLIANCE_VERSION_343,
  buildComplianceSnapshot343,
  scoreComplianceHealth343,
  buildComplianceReport343,
  exportComplianceReport343,
};
