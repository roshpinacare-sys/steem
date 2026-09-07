'use strict';
/**
 * src/lib/healthReportPersistence338.js — ECOS V338 (Phase P226) — Health Report Persistence
 *
 * Turns V337's in-memory health dashboard into a durable, file-system-backed
 * snapshot store. Four concrete advances:
 *
 *   1. persistHealthReport338   — writes a timestamped health snapshot to disk;
 *      idempotent (same content within same second is skipped). Returns a
 *      persist manifest with path, snapshotId, and byte size.
 *
 *   2. loadHealthHistory338     — reads all saved health snapshots from a directory,
 *      sorted chronologically (oldest first). Returns a history object with
 *      snapshots[], totalSnapshots, and the directory path.
 *
 *   3. compareHealthSnapshots338 — diffs two health snapshots (A vs B):
 *      families that improved (score rose), degraded (score fell), changed tier,
 *      or are unchanged. Returns a structured delta with summary and netScoreChange.
 *
 *   4. pruneHealthHistory338    — removes oldest snapshots beyond a configured
 *      maxSnapshots limit, returning a prune manifest (removed[], kept, freed bytes).
 *
 * Pure / dependency-free (R6); all new public identifiers end with `338` (R2).
 * Sacred files (fiatLedger.js, auditLog.js) untouched (R1). No new npm deps (R3).
 *
 * @version 338.0.0
 */

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const crypto = require('crypto');

const HEALTH_PERSISTENCE_VERSION_338 = '338.0.0';

const DEFAULT_HISTORY_DIR_338 = process.env.HEALTH_HISTORY_DIR ||
  path.join(os.tmpdir(), 'ecos_health_history');

/* ─── helpers ────────────────────────────────────────────────────────────────── */

function _snapshotId338(ts) {
  return 'snap_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function _hashContent338(str) {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

function _ensureDir338(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/* ─── 1. persistHealthReport338 ──────────────────────────────────────────────── */

/**
 * Persist a buildFamilyHealthReport337 result to disk as a JSON snapshot.
 * By default writes to DEFAULT_HISTORY_DIR_338.
 *
 * Idempotency: if a snapshot file with the same content hash already exists
 * within the same second, it is skipped (action: 'skip').
 *
 * @param {object}  report                  Return value of buildFamilyHealthReport337
 * @param {object}  [opts]
 * @param {string}  [opts.historyDir]       Directory to write snapshots (default: env / tmpdir)
 * @param {boolean} [opts.dryRun=false]     When true, report actions without writing
 * @param {object}  [opts.meta]             Extra metadata to embed in the snapshot (e.g. triggeredBy)
 * @returns {{ ok, snapshotId, snapshotPath, action, byteSize, contentHash, dryRun, version }}
 */
function persistHealthReport338(report, opts) {
  opts = opts || {};
  const dryRun     = opts.dryRun === true;
  const historyDir = opts.historyDir || DEFAULT_HISTORY_DIR_338;
  const meta       = opts.meta || {};

  if (!report || typeof report !== 'object') {
    return { ok: false, error: 'report must be a non-null object', dryRun, version: HEALTH_PERSISTENCE_VERSION_338 };
  }

  const ts         = new Date();
  const snapshotId = _snapshotId338(ts);

  const payload = JSON.stringify({
    snapshotId,
    capturedAt: ts.toISOString(),
    meta,
    report: {
      ok:            report.ok,
      totalFamilies: report.totalFamilies,
      criticalCount: report.criticalCount,
      watchCount:    report.watchCount,
      healthyCount:  report.healthyCount,
      reportedCount: report.reportedCount,
      summary:       report.summary,
      version:       report.version,
      families:      (report.families || []).map(f => ({
        base:             f.base,
        depth:            f.depth,
        score:            f.score,
        tier:             f.tier,
        drifted:          f.drifted,
        droppedSymbolCount: f.droppedSymbolCount,
        badVersionCount:  f.badVersionCount,
        retirableCount:   f.retirableCount,
        equivalencePct:   f.equivalencePct,
      })),
    },
  }, null, 2);

  const contentHash   = _hashContent338(payload);
  const snapshotPath  = path.join(historyDir, snapshotId + '_' + contentHash + '.json');

  if (!dryRun) {
    _ensureDir338(historyDir);
    // Idempotency: check for existing file with same hash this second
    const existingFiles = fs.existsSync(historyDir)
      ? fs.readdirSync(historyDir).filter(n => n.includes(contentHash))
      : [];
    if (existingFiles.length > 0) {
      return {
        ok: true, snapshotId, snapshotPath: path.join(historyDir, existingFiles[0]),
        action: 'skip', byteSize: Buffer.byteLength(payload),
        contentHash, dryRun: false, version: HEALTH_PERSISTENCE_VERSION_338,
        summary: 'V338 skip — identical snapshot already exists',
      };
    }
    fs.writeFileSync(snapshotPath, payload, 'utf8');
  }

  return {
    ok: true, snapshotId, snapshotPath,
    action: dryRun ? 'dry-run' : 'write',
    byteSize: Buffer.byteLength(payload),
    contentHash, dryRun,
    version: HEALTH_PERSISTENCE_VERSION_338,
    summary: dryRun
      ? 'V338 DRY-RUN — would write snapshot ' + snapshotId
      : 'V338 persisted snapshot ' + snapshotId + ' (' + Buffer.byteLength(payload) + ' bytes)',
  };
}

/* ─── 2. loadHealthHistory338 ────────────────────────────────────────────────── */

/**
 * Load all health snapshots from the history directory, sorted chronologically.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.historyDir]   Directory to read from (default: env / tmpdir)
 * @param {number}  [opts.limit]        Max snapshots to return (default: all)
 * @param {string}  [opts.order]        'asc' (oldest first, default) | 'desc' (newest first)
 * @returns {{ ok, historyDir, totalSnapshots, snapshots[], version }}
 */
function loadHealthHistory338(opts) {
  opts = opts || {};
  const historyDir = opts.historyDir || DEFAULT_HISTORY_DIR_338;
  const order      = opts.order === 'desc' ? 'desc' : 'asc';
  const limit      = typeof opts.limit === 'number' && opts.limit > 0 ? opts.limit : Infinity;

  if (!fs.existsSync(historyDir)) {
    return {
      ok: true, historyDir, totalSnapshots: 0, snapshots: [],
      version: HEALTH_PERSISTENCE_VERSION_338,
      summary: 'V338 no history found — directory does not exist',
    };
  }

  const files = fs.readdirSync(historyDir)
    .filter(n => n.startsWith('snap_') && n.endsWith('.json'))
    .sort(); // lexicographic = chronological for snap_YYYY-MM-DD_HH-MM-SS-mmm format

  if (order === 'desc') files.reverse();
  const sliced = files.slice(0, limit);

  const snapshots = [];
  for (const file of sliced) {
    const filePath = path.join(historyDir, file);
    try {
      const raw     = fs.readFileSync(filePath, 'utf8');
      const parsed  = JSON.parse(raw);
      snapshots.push({
        snapshotId:  parsed.snapshotId  || file.replace('.json', ''),
        capturedAt:  parsed.capturedAt  || null,
        meta:        parsed.meta        || {},
        file,
        filePath,
        byteSize:    Buffer.byteLength(raw),
        summary: {
          totalFamilies: parsed.report?.totalFamilies ?? null,
          criticalCount: parsed.report?.criticalCount ?? null,
          watchCount:    parsed.report?.watchCount    ?? null,
          healthyCount:  parsed.report?.healthyCount  ?? null,
        },
        report: parsed.report || null,
      });
    } catch (e) {
      snapshots.push({ file, filePath, parseError: e.message });
    }
  }

  return {
    ok: true, historyDir, totalSnapshots: files.length,
    returnedCount: snapshots.length,
    snapshots,
    version: HEALTH_PERSISTENCE_VERSION_338,
    summary: 'V338 loaded ' + snapshots.length + ' of ' + files.length + ' snapshots from ' + historyDir,
  };
}

/* ─── 3. compareHealthSnapshots338 ────────────────────────────────────────────── */

/**
 * Diff two health snapshot objects (A = older, B = newer).
 * Returns per-family delta: improved, degraded, tierChanged, unchanged.
 * Also returns aggregate netScoreChange and summary statistics.
 *
 * @param {object}  snapshotA   Older snapshot (from loadHealthHistory338 snapshots[])
 * @param {object}  snapshotB   Newer snapshot
 * @returns {{ ok, improved[], degraded[], tierChanged[], unchanged[], netScoreChange,
 *             totalFamiliesCompared, summary, version }}
 */
function compareHealthSnapshots338(snapshotA, snapshotB) {
  const empty = (label) => ({
    ok: false, error: label + ' must be a non-null snapshot object',
    improved: [], degraded: [], tierChanged: [], unchanged: [],
    netScoreChange: 0, totalFamiliesCompared: 0,
    version: HEALTH_PERSISTENCE_VERSION_338,
  });

  if (!snapshotA || typeof snapshotA !== 'object') return empty('snapshotA');
  if (!snapshotB || typeof snapshotB !== 'object') return empty('snapshotB');

  const familiesA = (snapshotA.report?.families || snapshotA.families || []);
  const familiesB = (snapshotB.report?.families || snapshotB.families || []);

  const mapA = new Map(familiesA.map(f => [f.base, f]));
  const mapB = new Map(familiesB.map(f => [f.base, f]));

  const allBases = new Set([...mapA.keys(), ...mapB.keys()]);

  const improved    = [];
  const degraded    = [];
  const tierChanged = [];
  const unchanged   = [];
  let   netScoreChange = 0;

  for (const base of allBases) {
    const a = mapA.get(base);
    const b = mapB.get(base);

    if (!a && b) {
      // New family appeared
      improved.push({ base, change: 'new', scoreA: null, scoreB: b.score, tierA: null, tierB: b.tier, delta: null });
      continue;
    }
    if (a && !b) {
      // Family disappeared (retired?)
      improved.push({ base, change: 'retired', scoreA: a.score, scoreB: null, tierA: a.tier, tierB: null, delta: null });
      continue;
    }

    const delta = (b.score ?? 0) - (a.score ?? 0);
    netScoreChange += delta;

    const tierChange = a.tier !== b.tier;

    const entry = {
      base, scoreA: a.score, scoreB: b.score, delta,
      tierA: a.tier, tierB: b.tier, tierChanged: tierChange,
    };

    if (delta > 0)      improved.push(entry);
    else if (delta < 0) degraded.push(entry);
    else                unchanged.push(entry);

    if (tierChange && delta === 0) tierChanged.push(entry);
    else if (tierChange)           tierChanged.push(entry);
  }

  // Sort improved descending by delta, degraded ascending
  improved.sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0));
  degraded.sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0));

  const totalFamiliesCompared = allBases.size;

  return {
    ok: true,
    snapshotAId: snapshotA.snapshotId || null,
    snapshotBId: snapshotB.snapshotId || null,
    capturedAtA: snapshotA.capturedAt || null,
    capturedAtB: snapshotB.capturedAt || null,
    improved, degraded, tierChanged, unchanged,
    netScoreChange: Math.round(netScoreChange * 100) / 100,
    totalFamiliesCompared,
    improvedCount:    improved.length,
    degradedCount:    degraded.length,
    tierChangedCount: tierChanged.length,
    unchangedCount:   unchanged.length,
    version: HEALTH_PERSISTENCE_VERSION_338,
    summary: 'V338 snapshot diff: ' + improved.length + ' improved, ' +
             degraded.length + ' degraded, ' + unchanged.length + ' unchanged ' +
             '(net score change: ' + (netScoreChange >= 0 ? '+' : '') +
             Math.round(netScoreChange) + ')',
  };
}

/* ─── 4. pruneHealthHistory338 ────────────────────────────────────────────────── */

/**
 * Remove oldest snapshots beyond maxSnapshots, keeping the newest N.
 * By default dryRun:true — safe for automated contexts.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.historyDir]       Directory to prune (default: env / tmpdir)
 * @param {number}  [opts.maxSnapshots=20]  Number of snapshots to keep
 * @param {boolean} [opts.dryRun=true]      When true, report without deleting
 * @returns {{ ok, removed[], kept, freedBytes, dryRun, version, summary }}
 */
function pruneHealthHistory338(opts) {
  opts = opts || {};
  const historyDir   = opts.historyDir || DEFAULT_HISTORY_DIR_338;
  const maxSnapshots = typeof opts.maxSnapshots === 'number' && opts.maxSnapshots > 0
    ? opts.maxSnapshots : 20;
  const dryRun = opts.dryRun !== false; // default true — safe

  if (!fs.existsSync(historyDir)) {
    return {
      ok: true, removed: [], kept: 0, freedBytes: 0, dryRun,
      version: HEALTH_PERSISTENCE_VERSION_338,
      summary: 'V338 prune: directory does not exist — nothing to prune',
    };
  }

  const files = fs.readdirSync(historyDir)
    .filter(n => n.startsWith('snap_') && n.endsWith('.json'))
    .sort(); // oldest first

  if (files.length <= maxSnapshots) {
    return {
      ok: true, removed: [], kept: files.length, freedBytes: 0, dryRun,
      version: HEALTH_PERSISTENCE_VERSION_338,
      summary: 'V338 prune: ' + files.length + ' snapshots ≤ maxSnapshots (' + maxSnapshots + ') — nothing to prune',
    };
  }

  const toRemove = files.slice(0, files.length - maxSnapshots);
  let freedBytes = 0;
  const removed  = [];

  for (const file of toRemove) {
    const filePath = path.join(historyDir, file);
    let byteSize   = 0;
    try { byteSize = fs.statSync(filePath).size; } catch (_) {}
    freedBytes += byteSize;
    if (!dryRun) {
      try { fs.unlinkSync(filePath); } catch (e) {
        removed.push({ file, filePath, byteSize, action: 'error', error: e.message });
        continue;
      }
    }
    removed.push({ file, filePath, byteSize, action: dryRun ? 'would-remove' : 'removed' });
  }

  return {
    ok: true,
    removed, kept: files.length - toRemove.length,
    freedBytes, dryRun,
    version: HEALTH_PERSISTENCE_VERSION_338,
    summary: 'V338 prune ' + (dryRun ? 'DRY-RUN' : '') +
             ': ' + toRemove.length + ' snapshots ' + (dryRun ? 'would be removed' : 'removed') +
             ' (' + freedBytes + ' bytes freed), ' + (files.length - toRemove.length) + ' kept',
  };
}

/* ─── exports ─────────────────────────────────────────────────────────────────── */

module.exports = {
  HEALTH_PERSISTENCE_VERSION_338,
  persistHealthReport338,
  loadHealthHistory338,
  compareHealthSnapshots338,
  pruneHealthHistory338,
};
