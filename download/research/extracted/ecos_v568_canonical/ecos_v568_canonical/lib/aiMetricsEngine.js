/**
 * lib/aiMetricsEngine.js — ECOS V155
 * ─────────────────────────────────────────────────────────────────────────────
 * [V155-AI-01] AI Metrics & Auto-Calibration Engine
 *
 * Responsibilities:
 *   - Track confidence distribution over last N tasks (histogram)
 *   - Compute pressure detection rate (% tasks flagged by pressureDetector)
 *   - Track calibrator accuracy over time (rolling window)
 *   - Trigger auto-calibration when accuracy drops below threshold
 *   - Expose metrics via getMetrics() for API endpoint
 *
 * Design principles:
 *   - Zero external deps (pure Node.js)
 *   - In-memory ring buffer with optional DB persistence
 *   - Non-fatal: all errors logged, never crash the server
 *   - Sacred files (fiatLedger.js, auditLog.js) are NEVER touched
 */
'use strict';

const DEFAULT_WINDOW   = 100;   // tasks to keep in rolling window
const AUTO_CALIB_THRESHOLD = 0.70; // accuracy below this triggers auto-calibration
const PRESSURE_WARN_RATE   = 0.30; // pressure detection rate above this = warning
const BINS = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

/**
 * Build a confidence histogram from an array of confidence scores.
 * Returns an array of { bin, count, pct } objects.
 */
function buildHistogram(scores) {
  const counts = new Array(BINS.length - 1).fill(0);
  for (const s of scores) {
    const v = Math.max(0, Math.min(0.9999, s));
    const idx = Math.floor(v * 10);
    counts[idx] = (counts[idx] || 0) + 1;
  }
  const total = scores.length || 1;
  return counts.map((count, i) => ({
    bin:   `${(BINS[i] * 100).toFixed(0)}–${(BINS[i + 1] * 100).toFixed(0)}%`,
    low:   BINS[i],
    high:  BINS[i + 1],
    count,
    pct:   parseFloat(((count / total) * 100).toFixed(1)),
  }));
}

/**
 * Compute a simple accuracy score from a set of calibration samples.
 * accuracy = fraction of samples where |calibrated - raw| < 0.15
 */
function computeCalibrationAccuracy(samples) {
  if (!samples || samples.length === 0) return null;
  const correct = samples.filter(s => Math.abs((s.calibrated || 0) - (s.raw || 0)) < 0.15).length;
  return parseFloat((correct / samples.length).toFixed(4));
}

class AiMetricsEngine {
  constructor({ windowSize = DEFAULT_WINDOW, pool = null, log = null } = {}) {
    this._window     = windowSize;
    this._pool       = pool;
    this._log        = log || { info: () => {}, warn: () => {}, error: () => {} };
    this._tasks      = [];          // ring buffer of task records
    this._calibSamples = [];        // ring buffer of calibration samples
    this._autoCalibCount = 0;       // how many times auto-calibration fired
    this._lastAutoCalib  = null;    // ISO timestamp of last auto-calibration
    this._calibrator     = null;    // optional reference to ConfidenceCalibrator
  }

  setPool(pool)       { this._pool = pool; }
  setLogger(log)      { this._log = log; }
  setCalibrator(cal)  { this._calibrator = cal; }

  /**
   * Record a completed task.
   * @param {object} task - { confidence, verdict, pressureDetected, calibrated }
   */
  recordTask(task) {
    const entry = {
      ts:               new Date().toISOString(),
      confidence:       typeof task.confidence === 'number' ? task.confidence : null,
      verdict:          task.verdict || 'UNKNOWN',
      pressureDetected: !!task.pressureDetected,
      calibrated:       typeof task.calibrated === 'number' ? task.calibrated : null,
    };
    this._tasks.push(entry);
    if (this._tasks.length > this._window * 2) {
      this._tasks = this._tasks.slice(-this._window);
    }

    // Track calibration sample if both raw and calibrated are present
    if (entry.confidence !== null && entry.calibrated !== null) {
      this._calibSamples.push({ raw: entry.confidence, calibrated: entry.calibrated, ts: entry.ts });
      if (this._calibSamples.length > this._window * 2) {
        this._calibSamples = this._calibSamples.slice(-this._window);
      }
    }

    // Check if auto-calibration should fire
    this._maybeAutoCalibrate();
  }

  /**
   * Fire auto-calibration if accuracy has dropped below threshold.
   * Non-fatal — logs result.
   */
  _maybeAutoCalibrate() {
    if (!this._calibrator) return;
    const recent = this._calibSamples.slice(-20);
    if (recent.length < 10) return;
    const accuracy = computeCalibrationAccuracy(recent);
    if (accuracy !== null && accuracy < AUTO_CALIB_THRESHOLD) {
      this._autoCalibCount++;
      this._lastAutoCalib = new Date().toISOString();
      this._log.warn({ accuracy, threshold: AUTO_CALIB_THRESHOLD }, '[V155] Auto-calibration triggered');
      try {
        // Feed recent samples back into the calibrator
        for (const s of recent) {
          if (s.raw !== null && s.calibrated !== null) {
            this._calibrator.fit(s.raw, s.calibrated > 0.5 ? 1 : 0);
          }
        }
      } catch (e) {
        this._log.error({ err: e.message }, '[V155] Auto-calibration failed');
      }
    }
  }

  /**
   * Get the last N tasks from the ring buffer.
   */
  getRecentTasks(n = this._window) {
    return this._tasks.slice(-n);
  }

  /**
   * Compute current metrics snapshot.
   * @returns {object} metrics
   */
  getMetrics() {
    const recent = this.getRecentTasks(this._window);
    const scores = recent.map(t => t.confidence).filter(c => c !== null);
    const pressureCount = recent.filter(t => t.pressureDetected).length;
    const pressureRate  = recent.length > 0
      ? parseFloat(((pressureCount / recent.length) * 100).toFixed(1))
      : 0;

    const verdictCounts = {};
    for (const t of recent) {
      verdictCounts[t.verdict] = (verdictCounts[t.verdict] || 0) + 1;
    }

    const calibAccuracy = computeCalibrationAccuracy(this._calibSamples.slice(-this._window));

    const avgConfidence = scores.length > 0
      ? parseFloat((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(4))
      : null;

    const histogram = buildHistogram(scores);

    return {
      windowSize:       this._window,
      taskCount:        recent.length,
      avgConfidence,
      histogram,
      pressureRate,
      pressureWarn:     pressureRate > PRESSURE_WARN_RATE * 100,
      verdictCounts,
      calibrationAccuracy: calibAccuracy,
      autoCalibCount:   this._autoCalibCount,
      lastAutoCalib:    this._lastAutoCalib,
      autoCalibThreshold: AUTO_CALIB_THRESHOLD,
      status:           this._computeStatus(pressureRate, calibAccuracy, avgConfidence, recent.length),
    };
  }

  /**
   * Derive an overall AI health status.
   */
  _computeStatus(pressureRate, calibAccuracy, avgConfidence, taskCount) {
    if (taskCount === 0) return 'idle';
    if (pressureRate > PRESSURE_WARN_RATE * 100) return 'warning';
    if (avgConfidence !== null && avgConfidence < 0.5) return 'warning';
    if (calibAccuracy !== null && calibAccuracy < AUTO_CALIB_THRESHOLD) return 'degraded';
    if (avgConfidence !== null && avgConfidence < 0.7) return 'degraded';
    return 'healthy';
  }

  /**
   * Persist metrics snapshot to DB (non-fatal).
   */
  async persistSnapshot(pool) {
    const p = pool || this._pool;
    if (!p) return;
    const m = this.getMetrics();
    try {
      await p.query(
        `INSERT INTO ai_metrics_snapshots (snapshot_at, task_count, avg_confidence, pressure_rate, calib_accuracy, auto_calib_count, payload)
         VALUES (NOW(), $1, $2, $3, $4, $5, $6)`,
        [m.taskCount, m.avgConfidence, m.pressureRate, m.calibrationAccuracy, m.autoCalibCount, JSON.stringify(m)]
      );
    } catch (e) {
      this._log.warn({ err: e.message }, '[V155] aiMetricsEngine: DB persist failed (non-fatal)');
    }
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────
const defaultAiMetricsEngine = new AiMetricsEngine();

// ── [V157-TASK-09] Pure CSV serializer for metrics history ────────────────────
// Rows come from ai_metrics_snapshots (snapshot_at, task_count, avg_confidence,
// pressure_rate, calib_accuracy, auto_calib_count). Pure + dependency-free so it
// is unit-testable without a DB.
const METRICS_CSV_COLUMNS = [
  'snapshot_at', 'task_count', 'avg_confidence', 'pressure_rate', 'calib_accuracy', 'auto_calib_count',
];
function _csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = (v instanceof Date) ? v.toISOString() : String(v);
  // Quote if it contains comma, quote, or newline; double internal quotes.
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function metricsHistoryToCsv(rows) {
  const header = METRICS_CSV_COLUMNS.join(',');
  if (!Array.isArray(rows) || rows.length === 0) return header + '\n';
  const lines = rows.map(r => METRICS_CSV_COLUMNS.map(c => _csvCell(r[c])).join(','));
  return header + '\n' + lines.join('\n') + '\n';
}

module.exports = {
  AiMetricsEngine,
  defaultAiMetricsEngine,
  buildHistogram,
  computeCalibrationAccuracy,
  metricsHistoryToCsv,
  DEFAULT_WINDOW,
  AUTO_CALIB_THRESHOLD,
  PRESSURE_WARN_RATE,
};
