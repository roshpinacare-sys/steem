'use strict';
/**
 * lib/healthRemediationEngine340.js — ECOS V340 (Phase P228) — Health Remediation Engine
 *
 * Consumes V339's trend + alert data and produces a concrete, prioritized
 * remediation plan that tells operators exactly what to fix, in what order,
 * and what impact each action is expected to have. Four concrete advances:
 *
 *   1. buildRemediationPlan340  — maps trend + regression alerts to a ranked
 *      list of RemediationTask objects (retire, consolidate, stub, review).
 *      Tasks are sorted by a composite urgency × estimated-impact score.
 *
 *   2. scoreRemediationTask340  — computes the numeric priority score for a
 *      single RemediationTask; also returns a human-readable rationale string.
 *
 *   3. exportRemediationPlan340 — serializes a buildRemediationPlan340 result
 *      to a JSON sidecar on disk. Dry-run safe; idempotent by content hash
 *      (same conventions as exportTrendSummary339).
 *
 *   4. applyRemediationDryRun340 — simulates executing the top-N tasks from
 *      a plan without touching the filesystem. Returns a dry-run manifest
 *      listing what would be changed and the projected health-score delta.
 *
 * Pure / dependency-free (R6); all new public identifiers end with `340` (R2).
 * Sacred files (fiatLedger.js, auditLog.js) untouched (R1). No new npm deps (R3).
 *
 * @version 340.0.0
 */

const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');

const HEALTH_REMEDIATION_VERSION_340 = '340.0.0';

const DEFAULT_REMEDIATION_DIR_340 = process.env.HEALTH_REMEDIATION_DIR ||
  path.join(os.tmpdir(), 'ecos_health_remediation');

/* ─── helpers ─────────────────────────────────────────────────────────────── */

function _remediationId340(ts) {
  return 'remed_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _hashContent340(str) {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

function _ensureDir340(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const TIER_SCORE = { critical: 0, watch: 1, healthy: 2, unknown: -1 };

/* ─── 1. buildRemediationPlan340 ──────────────────────────────────────────── */

/**
 * Map a V339 trend report (buildTrendReport339 output) into a prioritized
 * list of concrete RemediationTask objects.
 *
 * Task types:
 *   - 'retire'      : retire old versioned copies; target families with depth > 3
 *   - 'consolidate' : merge near-equivalent versions; target families with oracle drift
 *   - 'stub'        : write re-export stubs for retired versions
 *   - 'review'      : manual review needed; target volatile or fast-degrading families
 *
 * Each task carries:
 *   { taskId, type, base, severity, urgency, estimatedImpact, rationale,
 *     projectedScoreDelta, currentTier, targetTier }
 *
 * @param {object}  trendReport   Output of buildTrendReport339
 * @param {object}  [opts]
 * @param {number}  [opts.maxTasks]        Cap total tasks returned (default: all)
 * @param {string[]} [opts.taskTypes]      Filter to specific task types
 * @param {number}  [opts.minUrgency=0]    Only return tasks with urgency >= this
 * @returns {{ ok, tasks[], totalTasks, criticalTasks, planId, summary, version }}
 */
function buildRemediationPlan340(trendReport, opts) {
  opts = opts || {};
  const maxTasks    = typeof opts.maxTasks === 'number' && opts.maxTasks > 0 ? opts.maxTasks : Infinity;
  const taskTypes   = Array.isArray(opts.taskTypes) && opts.taskTypes.length ? new Set(opts.taskTypes) : null;
  const minUrgency  = typeof opts.minUrgency === 'number' ? opts.minUrgency : 0;

  if (!trendReport || typeof trendReport !== 'object') {
    return {
      ok: false, error: 'trendReport must be the output of buildTrendReport339',
      tasks: [], totalTasks: 0, criticalTasks: 0,
      planId: null, summary: 'V340 remediation plan: invalid trend report',
      version: HEALTH_REMEDIATION_VERSION_340,
    };
  }

  const families  = (trendReport.trend && trendReport.trend.families) || [];
  const alerts    = (trendReport.alerts && trendReport.alerts.alerts)  || [];

  // Build an alert-severity index for quick lookup
  const alertIndex = new Map();
  for (const a of alerts) {
    const prev = alertIndex.get(a.base);
    const rank = { critical: 3, warning: 2, info: 1 };
    if (!prev || (rank[a.severity] || 0) > (rank[prev.severity] || 0)) {
      alertIndex.set(a.base, a);
    }
  }

  const raw = [];

  for (const f of families) {
    const alert = alertIndex.get(f.base);
    const alertSeverity = alert ? alert.severity : null;

    // --- RETIRE task: family has degrading direction or too many versions implied by depth ---
    if (f.direction === 'degrading' || f.direction === 'volatile' || alertSeverity === 'critical') {
      const urgency = f.direction === 'degrading' ? 8
                    : f.direction === 'volatile'  ? 6
                    : alertSeverity === 'critical' ? 9 : 5;
      const projectedDelta = Math.min(20, Math.abs(f.netChange || 0) * 0.5 + 5);
      raw.push({
        type: 'retire',
        base: f.base,
        severity: alertSeverity || (urgency >= 8 ? 'critical' : 'warning'),
        urgency,
        estimatedImpact: Math.round(projectedDelta),
        rationale: `Family "${f.base}" is ${f.direction} (slope=${f.slope}, net=${f.netChange}). ` +
                   `Retiring old versioned copies reduces lineage debt and halts score decay.`,
        projectedScoreDelta: Math.round(projectedDelta),
        currentTier: f.latestTier,
        targetTier:  urgency >= 8 ? 'watch' : f.latestTier,
      });
    }

    // --- CONSOLIDATE task: tier has regressed at least once ---
    if (f.tierRegressions >= 1) {
      const urgency = f.tierRegressions >= 2 ? 9 : 6;
      const projectedDelta = f.tierRegressions * 10;
      raw.push({
        type: 'consolidate',
        base: f.base,
        severity: urgency >= 9 ? 'critical' : 'warning',
        urgency,
        estimatedImpact: Math.round(projectedDelta),
        rationale: `Family "${f.base}" suffered ${f.tierRegressions} tier regression(s). ` +
                   `Consolidating equivalent versions and updating the dispatcher registry restores stability.`,
        projectedScoreDelta: Math.round(projectedDelta),
        currentTier: f.latestTier,
        targetTier:  f.tierRegressions >= 2 ? 'watch' : 'healthy',
      });
    }

    // --- STUB task: family is improving but still has old versions to alias ---
    if (f.direction === 'improving' && f.dataPoints >= 2) {
      raw.push({
        type: 'stub',
        base: f.base,
        severity: 'info',
        urgency: 3,
        estimatedImpact: 5,
        rationale: `Family "${f.base}" is improving — write thin re-export stubs for older versioned ` +
                   `copies so callers can migrate to the latest without breaking changes.`,
        projectedScoreDelta: 5,
        currentTier: f.latestTier,
        targetTier:  'healthy',
      });
    }

    // --- REVIEW task: volatile family needs human attention ---
    if (f.direction === 'volatile') {
      raw.push({
        type: 'review',
        base: f.base,
        severity: f.latestTier === 'critical' ? 'critical' : 'warning',
        urgency: f.latestTier === 'critical' ? 8 : 5,
        estimatedImpact: 8,
        rationale: `Family "${f.base}" is volatile (stdDev=${f.stdDev}). ` +
                   `Unstable score trajectory requires manual review to determine root cause.`,
        projectedScoreDelta: 8,
        currentTier: f.latestTier,
        targetTier:  'watch',
      });
    }
  }

  // Filter by type whitelist
  let tasks = taskTypes ? raw.filter(t => taskTypes.has(t.type)) : raw;

  // Filter by min urgency
  tasks = tasks.filter(t => t.urgency >= minUrgency);

  // Score & sort each task
  tasks = tasks.map((t, i) => {
    const { score, rationale: scoreRationale } = scoreRemediationTask340(t);
    return { taskId: 'task_' + String(i + 1).padStart(4, '0') + '_' + t.type + '_' + t.base, score, scoreRationale, ...t };
  });
  tasks.sort((a, b) => b.score - a.score || b.urgency - a.urgency);

  // Re-number taskIds after sort
  tasks = tasks.map((t, i) => ({ ...t, taskId: 'task_' + String(i + 1).padStart(4, '0') + '_' + t.type + '_' + t.base }));

  // Cap
  const sliced = tasks.slice(0, maxTasks);

  const criticalTasks = sliced.filter(t => t.severity === 'critical').length;
  const planId = _remediationId340(new Date());

  return {
    ok: true,
    planId,
    tasks: sliced,
    totalTasks: sliced.length,
    totalRaw: raw.length,
    criticalTasks,
    warningTasks: sliced.filter(t => t.severity === 'warning').length,
    infoTasks:    sliced.filter(t => t.severity === 'info').length,
    generatedAt:  new Date().toISOString(),
    summary: `V340 remediation plan: ${sliced.length} tasks (${criticalTasks} critical) ` +
             `across ${new Set(sliced.map(t => t.base)).size} families`,
    version: HEALTH_REMEDIATION_VERSION_340,
  };
}

/* ─── 2. scoreRemediationTask340 ──────────────────────────────────────────── */

/**
 * Compute a numeric priority score [0..100] for a single RemediationTask.
 * Score = urgency × estimatedImpact / 10, capped at 100, with a severity bonus.
 *
 * @param {object}  task   A task object (from buildRemediationPlan340 or hand-built)
 * @returns {{ score, rationale, version }}
 */
function scoreRemediationTask340(task) {
  if (!task || typeof task !== 'object') {
    return { score: 0, rationale: 'invalid task object', version: HEALTH_REMEDIATION_VERSION_340 };
  }

  const urgency  = typeof task.urgency         === 'number' ? task.urgency         : 0;
  const impact   = typeof task.estimatedImpact === 'number' ? task.estimatedImpact : 0;

  const SEVERITY_BONUS = { critical: 15, warning: 5, info: 0 };
  const severityBonus = SEVERITY_BONUS[task.severity] || 0;

  const TYPE_BONUS = { retire: 3, consolidate: 2, review: 1, stub: 0 };
  const typeBonus = TYPE_BONUS[task.type] || 0;

  const raw = urgency * impact / 10 + severityBonus + typeBonus;
  const score = Math.min(100, Math.max(0, Math.round(raw)));

  const rationale =
    `urgency=${urgency} × impact=${impact} / 10 = ${(urgency * impact / 10).toFixed(1)}` +
    ` + severity bonus ${severityBonus} (${task.severity || 'none'})` +
    ` + type bonus ${typeBonus} (${task.type || 'none'})` +
    ` → score ${score}`;

  return { score, rationale, version: HEALTH_REMEDIATION_VERSION_340 };
}

/* ─── 3. exportRemediationPlan340 ─────────────────────────────────────────── */

/**
 * Serialize a buildRemediationPlan340 result to a JSON file on disk.
 * Same conventions as exportTrendSummary339: dry-run safe, idempotent by
 * content hash, returns { ok, remediationId, planPath, action, byteSize, contentHash }.
 *
 * @param {object}  plan      Output of buildRemediationPlan340
 * @param {object}  [opts]
 * @param {string}  [opts.remediationDir]  Target directory (default: env / tmpdir)
 * @param {boolean} [opts.dryRun=false]
 * @param {object}  [opts.meta]
 * @returns {{ ok, remediationId, planPath, action, byteSize, contentHash, dryRun, version }}
 */
function exportRemediationPlan340(plan, opts) {
  opts = opts || {};
  const dryRun         = opts.dryRun === true;
  const remediationDir = opts.remediationDir || DEFAULT_REMEDIATION_DIR_340;
  const meta           = opts.meta || {};

  if (!plan || typeof plan !== 'object') {
    return { ok: false, error: 'plan must be a non-null object', dryRun, version: HEALTH_REMEDIATION_VERSION_340 };
  }

  const ts            = new Date();
  const remediationId = _remediationId340(ts);

  const payload = JSON.stringify({
    remediationId,
    exportedAt: ts.toISOString(),
    meta,
    plan: {
      ok:             plan.ok,
      planId:         plan.planId,
      totalTasks:     plan.totalTasks,
      criticalTasks:  plan.criticalTasks,
      warningTasks:   plan.warningTasks,
      infoTasks:      plan.infoTasks,
      generatedAt:    plan.generatedAt,
      summary:        plan.summary,
      version:        plan.version,
      tasks: (plan.tasks || []).map(t => ({
        taskId:              t.taskId,
        type:                t.type,
        base:                t.base,
        severity:            t.severity,
        urgency:             t.urgency,
        score:               t.score,
        estimatedImpact:     t.estimatedImpact,
        projectedScoreDelta: t.projectedScoreDelta,
        currentTier:         t.currentTier,
        targetTier:          t.targetTier,
        rationale:           t.rationale,
      })),
    },
  }, null, 2);

  const contentHash = _hashContent340(payload);
  const planPath    = path.join(remediationDir, remediationId + '_' + contentHash + '.json');

  if (!dryRun) {
    _ensureDir340(remediationDir);
    const existingFiles = fs.existsSync(remediationDir)
      ? fs.readdirSync(remediationDir).filter(n => n.includes(contentHash))
      : [];
    if (existingFiles.length > 0) {
      return {
        ok: true, remediationId, planPath: path.join(remediationDir, existingFiles[0]),
        action: 'skip', byteSize: Buffer.byteLength(payload),
        contentHash, dryRun: false, version: HEALTH_REMEDIATION_VERSION_340,
        summary: 'V340 skip — identical remediation plan already exists',
      };
    }
    fs.writeFileSync(planPath, payload, 'utf8');
  }

  return {
    ok: true, remediationId, planPath,
    action:      dryRun ? 'dry-run' : 'write',
    byteSize:    Buffer.byteLength(payload),
    contentHash, dryRun,
    version: HEALTH_REMEDIATION_VERSION_340,
    summary: dryRun
      ? 'V340 DRY-RUN — would export remediation plan ' + remediationId
      : 'V340 exported remediation plan ' + remediationId + ' (' + Buffer.byteLength(payload) + ' bytes)',
  };
}

/* ─── 4. applyRemediationDryRun340 ───────────────────────────────────────── */

/**
 * Simulate executing the top-N tasks from a remediation plan without touching
 * the filesystem. Returns a dry-run manifest with projected outcomes.
 *
 * For each task the manifest reports:
 *   - what action would be taken (e.g. "retire 3 old versions of agentLoop")
 *   - the projected score delta per family
 *   - aggregate: projectedTotalScoreDelta, familiesAffected, taskTypes breakdown
 *
 * @param {object}  plan      Output of buildRemediationPlan340
 * @param {object}  [opts]
 * @param {number}  [opts.topN=10]          Max tasks to simulate
 * @param {boolean} [opts.strictMode=false] Return ok:false if any critical task is present
 * @returns {{ ok, actions[], projectedTotalScoreDelta, familiesAffected,
 *             taskTypeSummary, summary, version }}
 */
function applyRemediationDryRun340(plan, opts) {
  opts = opts || {};
  const topN       = typeof opts.topN === 'number' && opts.topN > 0 ? opts.topN : 10;
  const strictMode = opts.strictMode === true;

  if (!plan || !Array.isArray(plan.tasks)) {
    return {
      ok: false, error: 'plan must be the output of buildRemediationPlan340',
      actions: [], projectedTotalScoreDelta: 0, familiesAffected: 0,
      summary: 'V340 dry-run: invalid plan',
      version: HEALTH_REMEDIATION_VERSION_340,
    };
  }

  if (strictMode && plan.criticalTasks > 0) {
    return {
      ok: false,
      error: `strictMode: ${plan.criticalTasks} critical task(s) present — resolve before applying`,
      actions: [], projectedTotalScoreDelta: 0, familiesAffected: 0,
      summary: 'V340 dry-run blocked by strictMode: critical tasks present',
      version: HEALTH_REMEDIATION_VERSION_340,
    };
  }

  const tasks = plan.tasks.slice(0, topN);
  const actions = [];
  let projectedTotalScoreDelta = 0;
  const affectedFamilies = new Set();
  const typeCounts = {};

  for (const t of tasks) {
    affectedFamilies.add(t.base);
    typeCounts[t.type] = (typeCounts[t.type] || 0) + 1;
    projectedTotalScoreDelta += t.projectedScoreDelta || 0;

    const ACTION_DESCRIPTION = {
      retire:      `Would retire old versioned copies of "${t.base}" (projected +${t.projectedScoreDelta} pts)`,
      consolidate: `Would consolidate equivalent versions of "${t.base}" and update dispatcher registry (projected +${t.projectedScoreDelta} pts)`,
      stub:        `Would write thin re-export stubs for older "${t.base}" versions (projected +${t.projectedScoreDelta} pts)`,
      review:      `Would flag "${t.base}" for manual review (expected stabilization +${t.projectedScoreDelta} pts)`,
    };

    actions.push({
      taskId:              t.taskId,
      type:                t.type,
      base:                t.base,
      severity:            t.severity,
      score:               t.score,
      description:         ACTION_DESCRIPTION[t.type] || `Would apply ${t.type} on "${t.base}"`,
      projectedScoreDelta: t.projectedScoreDelta || 0,
      currentTier:         t.currentTier,
      targetTier:          t.targetTier,
      wouldExecute:        true,
      dryRun:              true,
    });
  }

  projectedTotalScoreDelta = Math.round(projectedTotalScoreDelta * 100) / 100;

  return {
    ok: true,
    dryRun: true,
    actions,
    projectedTotalScoreDelta,
    familiesAffected:  affectedFamilies.size,
    tasksSimulated:    actions.length,
    taskTypeSummary:   typeCounts,
    summary: `V340 DRY-RUN: ${actions.length} tasks simulated on ${affectedFamilies.size} families, ` +
             `projected total score delta: +${projectedTotalScoreDelta}`,
    version: HEALTH_REMEDIATION_VERSION_340,
  };
}

/* ─── exports ─────────────────────────────────────────────────────────────── */

module.exports = {
  HEALTH_REMEDIATION_VERSION_340,
  buildRemediationPlan340,
  scoreRemediationTask340,
  exportRemediationPlan340,
  applyRemediationDryRun340,
};
