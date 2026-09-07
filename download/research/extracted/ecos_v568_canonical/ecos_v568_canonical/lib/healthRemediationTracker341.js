'use strict';
/**
 * lib/healthRemediationTracker341.js — ECOS V341 (Phase P229) — Health Remediation Tracker
 *
 * Closes the full remediation loop that V338–V340 opened:
 *   V338 → persist health snapshots
 *   V339 → detect trends + regression alerts
 *   V340 → build + score prioritized remediation plan
 *   V341 → record what was executed, compare projected vs actual, build audit trail
 *
 * Four concrete tools, each advancing the "accountability" layer:
 *
 *   1. recordRemediationExecution341  — persists an execution event to a JSONL
 *      log: which tasks from a V340 plan were marked as done, by whom, at what
 *      time, and with what operator-provided outcome notes.
 *
 *   2. compareProjectedVsActual341    — takes an execution record and two health
 *      snapshots (before / after) and returns a per-family accuracy report:
 *      projected delta (from V340 score) vs observed delta, coverage, and a
 *      planAccuracy score [0..100].
 *
 *   3. buildExecutionAuditLog341      — reads the JSONL execution log and builds
 *      a structured, time-ordered summary: total executions, task breakdown by
 *      type, running score-delta accuracy, families most often remediated.
 *
 *   4. exportExecutionAuditLog341     — serializes the audit log to a JSON
 *      sidecar. Idempotent by content hash; dry-run safe. Same conventions as
 *      exportRemediationPlan340 and exportTrendSummary339.
 *
 * Pure / dependency-free (R6). All new public identifiers end with `341` (R2).
 * Sacred files (fiatLedger.js, auditLog.js) untouched (R1). No new npm deps (R3).
 *
 * @version 341.0.0
 */

const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');

const HEALTH_TRACKER_VERSION_341 = '341.0.0';

const DEFAULT_EXECUTION_LOG_DIR_341 = process.env.HEALTH_EXECUTION_LOG_DIR ||
  path.join(os.tmpdir(), 'ecos_health_execution_log');

const DEFAULT_AUDIT_EXPORT_DIR_341 = process.env.HEALTH_AUDIT_EXPORT_DIR ||
  path.join(os.tmpdir(), 'ecos_health_audit_export');

/* ─── helpers ─────────────────────────────────────────────────────────────── */

function _executionId341(ts) {
  return 'exec_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _auditId341(ts) {
  return 'audit_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _hashContent341(str) {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

function _ensureDir341(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/* ─── 1. recordRemediationExecution341 ───────────────────────────────────── */

/**
 * Record that a subset of tasks from a V340 remediation plan were executed.
 * Appends one JSON line per call to a JSONL execution log file.
 *
 * Execution record schema:
 *   { executionId, executedAt, planId, executedTaskIds[], taskDetails[],
 *     executedBy, notes, totalTasksInPlan, totalExecuted, dryRun }
 *
 * @param {object}   plan             Output of buildRemediationPlan340
 * @param {string[]} executedTaskIds  IDs of tasks marked as done (subset of plan.tasks)
 * @param {object}   [opts]
 * @param {string}   [opts.executedBy='operator']
 * @param {string}   [opts.notes='']
 * @param {string}   [opts.logDir]     Directory for the JSONL log (default: env / tmpdir)
 * @param {boolean}  [opts.dryRun=false]
 * @returns {{ ok, executionId, logPath, totalExecuted, action, dryRun, version }}
 */
function recordRemediationExecution341(plan, executedTaskIds, opts) {
  opts = opts || {};
  const dryRun     = opts.dryRun === true;
  const executedBy = typeof opts.executedBy === 'string' ? opts.executedBy : 'operator';
  const notes      = typeof opts.notes === 'string' ? opts.notes : '';
  const logDir     = opts.logDir || DEFAULT_EXECUTION_LOG_DIR_341;

  if (!plan || !Array.isArray(plan.tasks)) {
    return {
      ok: false, error: 'plan must be the output of buildRemediationPlan340',
      executionId: null, logPath: null, totalExecuted: 0,
      action: 'error', dryRun, version: HEALTH_TRACKER_VERSION_341,
    };
  }
  if (!Array.isArray(executedTaskIds)) {
    return {
      ok: false, error: 'executedTaskIds must be an array of task ID strings',
      executionId: null, logPath: null, totalExecuted: 0,
      action: 'error', dryRun, version: HEALTH_TRACKER_VERSION_341,
    };
  }

  const idSet = new Set(executedTaskIds);
  const taskDetails = plan.tasks
    .filter(t => idSet.has(t.taskId))
    .map(t => ({
      taskId:              t.taskId,
      type:                t.type,
      base:                t.base,
      severity:            t.severity,
      score:               t.score,
      estimatedImpact:     t.estimatedImpact,
      projectedScoreDelta: t.projectedScoreDelta,
      currentTier:         t.currentTier,
      targetTier:          t.targetTier,
    }));

  const ts          = new Date();
  const executionId = _executionId341(ts);
  const logPath     = path.join(logDir, 'execution_log.jsonl');

  const record = {
    executionId,
    executedAt:       ts.toISOString(),
    planId:           plan.planId || null,
    planVersion:      plan.version || null,
    executedBy,
    notes,
    executedTaskIds:  executedTaskIds.slice(),
    taskDetails,
    totalTasksInPlan: plan.totalTasks || 0,
    totalExecuted:    taskDetails.length,
    unmatchedIds:     executedTaskIds.filter(id => !plan.tasks.some(t => t.taskId === id)),
    dryRun,
    trackerVersion:   HEALTH_TRACKER_VERSION_341,
  };

  if (!dryRun) {
    _ensureDir341(logDir);
    fs.appendFileSync(logPath, JSON.stringify(record) + '\n', 'utf8');
  }

  return {
    ok: true,
    executionId,
    logPath,
    totalExecuted:  taskDetails.length,
    unmatchedIds:   record.unmatchedIds,
    action:         dryRun ? 'dry-run' : 'append',
    dryRun,
    summary: dryRun
      ? 'V341 DRY-RUN — would record execution ' + executionId + ' (' + taskDetails.length + ' tasks)'
      : 'V341 recorded execution ' + executionId + ' (' + taskDetails.length + ' tasks)',
    version: HEALTH_TRACKER_VERSION_341,
  };
}

/* ─── 2. compareProjectedVsActual341 ─────────────────────────────────────── */

/**
 * Compare the projected score deltas from a remediation plan execution record
 * against actual score changes observed between two health snapshots.
 *
 * Per-family output:
 *   { base, projectedDelta, actualDelta, error, accurate (|error|<=threshold) }
 *
 * Aggregate output:
 *   { planAccuracy, coveredFamilies, accurateFamilies, totalProjected, totalActual,
 *     overestimated, underestimated, familyResults[], executionId, version }
 *
 * planAccuracy = accurateFamilies / coveredFamilies × 100 (0 if coveredFamilies=0)
 *
 * @param {object}  executionRecord   Output of recordRemediationExecution341
 * @param {object}  snapshotBefore    Health snapshot (V338 format) taken BEFORE execution
 * @param {object}  snapshotAfter     Health snapshot (V338 format) taken AFTER execution
 * @param {object}  [opts]
 * @param {number}  [opts.accuracyThreshold=5]  Max |projectedDelta - actualDelta| for "accurate"
 * @returns {{ ok, planAccuracy, coveredFamilies, accurateFamilies,
 *             totalProjected, totalActual, familyResults[], version }}
 */
function compareProjectedVsActual341(executionRecord, snapshotBefore, snapshotAfter, opts) {
  opts = opts || {};
  const threshold = typeof opts.accuracyThreshold === 'number' ? opts.accuracyThreshold : 5;

  if (!executionRecord || !Array.isArray(executionRecord.taskDetails)) {
    return {
      ok: false, error: 'executionRecord must be the output of recordRemediationExecution341',
      planAccuracy: 0, coveredFamilies: 0, accurateFamilies: 0,
      totalProjected: 0, totalActual: 0, familyResults: [],
      version: HEALTH_TRACKER_VERSION_341,
    };
  }

  const familiesBefore = _extractFamilyScores341(snapshotBefore);
  const familiesAfter  = _extractFamilyScores341(snapshotAfter);

  if (familiesBefore === null || familiesAfter === null) {
    return {
      ok: false, error: 'snapshotBefore and snapshotAfter must be valid health snapshots',
      planAccuracy: 0, coveredFamilies: 0, accurateFamilies: 0,
      totalProjected: 0, totalActual: 0, familyResults: [],
      version: HEALTH_TRACKER_VERSION_341,
    };
  }

  const familyResults = [];
  let totalProjected = 0;
  let totalActual    = 0;
  let accurateFamilies = 0;
  let overestimated  = 0;
  let underestimated = 0;

  for (const task of executionRecord.taskDetails) {
    const base = task.base;
    const scoreBefore = familiesBefore.get(base);
    const scoreAfter  = familiesAfter.get(base);

    if (scoreBefore === undefined || scoreAfter === undefined) {
      familyResults.push({
        base, taskId: task.taskId, type: task.type,
        projectedDelta: task.projectedScoreDelta || 0,
        actualDelta: null, error: null,
        accurate: false, missing: true,
      });
      continue;
    }

    const projected  = task.projectedScoreDelta || 0;
    const actual     = Math.round((scoreAfter - scoreBefore) * 100) / 100;
    const err        = Math.round(Math.abs(projected - actual) * 100) / 100;
    const accurate   = err <= threshold;

    totalProjected += projected;
    totalActual    += actual;
    if (accurate) accurateFamilies++;
    if (projected > actual) overestimated++;
    else if (projected < actual) underestimated++;

    familyResults.push({
      base, taskId: task.taskId, type: task.type,
      projectedDelta: projected, actualDelta: actual,
      scoreBefore, scoreAfter, error: err, accurate,
    });
  }

  const coveredFamilies = familyResults.filter(r => !r.missing).length;
  const planAccuracy = coveredFamilies > 0
    ? Math.round(accurateFamilies / coveredFamilies * 100)
    : 0;

  return {
    ok: true,
    executionId:    executionRecord.executionId || null,
    planAccuracy,
    coveredFamilies,
    accurateFamilies,
    overestimated,
    underestimated,
    accuracyThreshold: threshold,
    totalProjected: Math.round(totalProjected * 100) / 100,
    totalActual:    Math.round(totalActual    * 100) / 100,
    accuracyBias:   Math.round((totalProjected - totalActual) * 100) / 100,
    familyResults,
    summary: `V341 accuracy: ${planAccuracy}% (${accurateFamilies}/${coveredFamilies} families within ±${threshold} pts)`,
    version: HEALTH_TRACKER_VERSION_341,
  };
}

function _extractFamilyScores341(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const families = (snapshot.report && snapshot.report.families) || snapshot.families;
  if (!Array.isArray(families)) return null;
  const map = new Map();
  for (const f of families) {
    if (f && typeof f.base === 'string' && typeof f.score === 'number') {
      map.set(f.base, f.score);
    }
  }
  return map;
}

/* ─── 3. buildExecutionAuditLog341 ───────────────────────────────────────── */

/**
 * Read the JSONL execution log and build a structured, time-ordered audit summary.
 *
 * Returns:
 *   { ok, totalExecutions, totalTasksExecuted, uniquePlans, uniqueFamilies,
 *     taskTypeBreakdown, topFamilies[], executionRecords[], firstExecutionAt,
 *     lastExecutionAt, summary, version }
 *
 * @param {object}  [opts]
 * @param {string}  [opts.logDir]   Directory of the JSONL log (default: env / tmpdir)
 * @param {number}  [opts.limit]    Max records to return (default: all)
 * @param {string}  [opts.since]    ISO date string — only records >= this date
 * @returns {{ ok, totalExecutions, totalTasksExecuted, ... }}
 */
function buildExecutionAuditLog341(opts) {
  opts = opts || {};
  const logDir = opts.logDir || DEFAULT_EXECUTION_LOG_DIR_341;
  const limit  = typeof opts.limit === 'number' && opts.limit > 0 ? opts.limit : Infinity;
  const since  = opts.since ? new Date(opts.since) : null;
  const logPath = path.join(logDir, 'execution_log.jsonl');

  if (!fs.existsSync(logPath)) {
    return {
      ok: true, totalExecutions: 0, totalTasksExecuted: 0,
      uniquePlans: 0, uniqueFamilies: 0, taskTypeBreakdown: {},
      topFamilies: [], executionRecords: [],
      firstExecutionAt: null, lastExecutionAt: null,
      summary: 'V341 audit log: no executions recorded yet',
      version: HEALTH_TRACKER_VERSION_341,
    };
  }

  const raw    = fs.readFileSync(logPath, 'utf8');
  const lines  = raw.split('\n').filter(l => l.trim());
  const records = [];
  for (const line of lines) {
    try {
      const r = JSON.parse(line);
      if (since && new Date(r.executedAt) < since) continue;
      records.push(r);
    } catch (_) {}
  }

  // Sort by executedAt ascending
  records.sort((a, b) => new Date(a.executedAt) - new Date(b.executedAt));

  // Apply limit
  const sliced = records.slice(0, limit === Infinity ? undefined : limit);

  // Aggregate
  const planIds         = new Set();
  const familyCounts    = new Map();
  const typeBreakdown   = {};
  let totalTasksExecuted = 0;

  for (const r of sliced) {
    if (r.planId) planIds.add(r.planId);
    totalTasksExecuted += r.totalExecuted || 0;
    for (const t of (r.taskDetails || [])) {
      familyCounts.set(t.base, (familyCounts.get(t.base) || 0) + 1);
      typeBreakdown[t.type] = (typeBreakdown[t.type] || 0) + 1;
    }
  }

  const topFamilies = [...familyCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([base, count]) => ({ base, executionCount: count }));

  return {
    ok: true,
    totalExecutions:    sliced.length,
    totalTasksExecuted,
    uniquePlans:        planIds.size,
    uniqueFamilies:     familyCounts.size,
    taskTypeBreakdown:  typeBreakdown,
    topFamilies,
    executionRecords:   sliced,
    firstExecutionAt:   sliced.length ? sliced[0].executedAt                  : null,
    lastExecutionAt:    sliced.length ? sliced[sliced.length - 1].executedAt   : null,
    summary: `V341 audit log: ${sliced.length} executions, ${totalTasksExecuted} tasks across ${familyCounts.size} families`,
    version: HEALTH_TRACKER_VERSION_341,
  };
}

/* ─── 4. exportExecutionAuditLog341 ──────────────────────────────────────── */

/**
 * Serialize a buildExecutionAuditLog341 result to a JSON sidecar file.
 * Idempotent by content hash; dry-run safe.
 * Same conventions as exportRemediationPlan340 and exportTrendSummary339.
 *
 * @param {object}  auditLog    Output of buildExecutionAuditLog341
 * @param {object}  [opts]
 * @param {string}  [opts.exportDir]  Target dir (default: env / tmpdir)
 * @param {boolean} [opts.dryRun=false]
 * @param {object}  [opts.meta]
 * @returns {{ ok, auditId, auditPath, action, byteSize, contentHash, dryRun, version }}
 */
function exportExecutionAuditLog341(auditLog, opts) {
  opts = opts || {};
  const dryRun    = opts.dryRun === true;
  const exportDir = opts.exportDir || DEFAULT_AUDIT_EXPORT_DIR_341;
  const meta      = opts.meta || {};

  if (!auditLog || typeof auditLog !== 'object') {
    return {
      ok: false, error: 'auditLog must be the output of buildExecutionAuditLog341',
      auditId: null, auditPath: null, action: 'error',
      byteSize: 0, contentHash: null, dryRun,
      version: HEALTH_TRACKER_VERSION_341,
    };
  }

  const ts      = new Date();
  const auditId = _auditId341(ts);

  const payload = JSON.stringify({
    auditId,
    exportedAt: ts.toISOString(),
    meta,
    auditLog: {
      ok:                auditLog.ok,
      totalExecutions:   auditLog.totalExecutions,
      totalTasksExecuted: auditLog.totalTasksExecuted,
      uniquePlans:       auditLog.uniquePlans,
      uniqueFamilies:    auditLog.uniqueFamilies,
      taskTypeBreakdown: auditLog.taskTypeBreakdown,
      topFamilies:       auditLog.topFamilies,
      firstExecutionAt:  auditLog.firstExecutionAt,
      lastExecutionAt:   auditLog.lastExecutionAt,
      summary:           auditLog.summary,
      version:           auditLog.version,
      records: (auditLog.executionRecords || []).map(r => ({
        executionId:   r.executionId,
        executedAt:    r.executedAt,
        planId:        r.planId,
        executedBy:    r.executedBy,
        totalExecuted: r.totalExecuted,
        taskTypes:     (r.taskDetails || []).map(t => t.type),
        families:      (r.taskDetails || []).map(t => t.base),
      })),
    },
  }, null, 2);

  const contentHash = _hashContent341(payload);
  const auditPath   = path.join(exportDir, auditId + '_' + contentHash + '.json');

  if (!dryRun) {
    _ensureDir341(exportDir);
    const existing = fs.existsSync(exportDir)
      ? fs.readdirSync(exportDir).filter(n => n.includes(contentHash))
      : [];
    if (existing.length > 0) {
      return {
        ok: true, auditId, auditPath: path.join(exportDir, existing[0]),
        action: 'skip', byteSize: Buffer.byteLength(payload),
        contentHash, dryRun: false,
        summary: 'V341 skip — identical audit log already exists',
        version: HEALTH_TRACKER_VERSION_341,
      };
    }
    fs.writeFileSync(auditPath, payload, 'utf8');
  }

  return {
    ok: true, auditId, auditPath,
    action:      dryRun ? 'dry-run' : 'write',
    byteSize:    Buffer.byteLength(payload),
    contentHash, dryRun,
    summary: dryRun
      ? 'V341 DRY-RUN — would export audit log ' + auditId
      : 'V341 exported audit log ' + auditId + ' (' + Buffer.byteLength(payload) + ' bytes)',
    version: HEALTH_TRACKER_VERSION_341,
  };
}

/* ─── exports ─────────────────────────────────────────────────────────────── */

module.exports = {
  HEALTH_TRACKER_VERSION_341,
  recordRemediationExecution341,
  compareProjectedVsActual341,
  buildExecutionAuditLog341,
  exportExecutionAuditLog341,
};
