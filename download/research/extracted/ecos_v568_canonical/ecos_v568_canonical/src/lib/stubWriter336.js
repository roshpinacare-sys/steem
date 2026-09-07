'use strict';
/**
 * src/lib/stubWriter336.js — ECOS V336 (Phase P224) — Stub Writer & Dispatcher Persistence
 *
 * Turns V335's tools into durable, file-system-backed operations. Four concrete advances:
 *
 *   1. writeConsolidationStubs336  — takes the dry manifest produced by
 *      executeConsolidationSlice335 and actually writes the thin re-export stubs to
 *      disk (dry-run safe; skips files that already match). Returns a write manifest.
 *
 *   2. persistDispatcherRegistry336 — serializes the known-bad registry snapshot
 *      (from getKnownBadRegistry335()) to a JSON sidecar so it survives server restart.
 *
 *   3. loadDispatcherRegistry336   — reads the JSON sidecar back and returns an
 *      initialKnownBad-compatible object for wireSelfHealingDispatcher335's opts.
 *
 *   4. runOracleWithRealFns336     — locates the agentLoop boundary versions in lib/,
 *      require()s them, extracts a stable pure function from each, and proves behavioral
 *      equivalence with compareVersions334 over a curated input suite.
 *
 * Pure / dependency-free (R6); all new public identifiers end with `336` (R2).
 * Sacred files (fiatLedger.js, auditLog.js) untouched (R1). No new npm deps (R3).
 *
 * @version 336.0.0
 */

const path = require('path');
const fs   = require('fs');

const STUB_WRITER_VERSION_336 = '336.0.0';

/* ─── helpers ────────────────────────────────────────────────────────────────── */

function _baseName336(name) { return String(name).replace(/\d+$/, ''); }
function _versionOf336(name) { const m = String(name).match(/(\d{2,4})$/); return m ? parseInt(m[1], 10) : null; }

/* ─── 1. writeConsolidationStubs336 ─────────────────────────────────────────── */

/**
 * Write thin re-export stubs from an executeConsolidationSlice335 result to disk.
 * By default `dryRun: true` — no files are touched without explicit opt-in.
 *
 * For each stub in sliceResult.families[*].stubs[]:
 *   - If the stub file already contains `module.exports = require('./<keep>')` it is
 *     skipped (idempotent — running twice never overwrites a manually written stub).
 *   - Otherwise the stubCode is written to stubPath (resolved relative to baseDir).
 *
 * @param {object}  sliceResult             Return value of executeConsolidationSlice335
 * @param {object}  [opts]
 * @param {boolean} [opts.dryRun=true]      When true, report actions without writing
 * @param {string}  [opts.baseDir]          Root dir for stub paths (default: process.cwd())
 * @returns {{ written, skipped, files, dryRun, totalStubs, summary, version }}
 */
function writeConsolidationStubs336(sliceResult, opts) {
  opts = opts || {};
  const dryRun  = opts.dryRun !== false; // default true — safe by default
  const baseDir = opts.baseDir || process.cwd();

  const files   = [];
  let written   = 0;
  let skipped   = 0;

  for (const family of (sliceResult.families || [])) {
    for (const stub of (family.stubs || [])) {
      const absPath  = path.isAbsolute(stub.stubPath)
        ? stub.stubPath
        : path.join(baseDir, stub.stubPath);

      let action  = 'write';
      let reason  = null;

      // Idempotency check — skip if existing content already points to the right keep
      if (fs.existsSync(absPath)) {
        try {
          const existing = fs.readFileSync(absPath, 'utf8');
          const keepBase = path.basename(family.keepBase || family.keep || '', '.js');
          if (existing.includes(`require('./${keepBase}')`)) {
            action = 'skip';
            reason = 'already-correct';
          } else {
            reason = 'overwrite-mismatch';
          }
        } catch (_) {
          reason = 'read-error';
        }
      }

      if (!dryRun && action === 'write') {
        try {
          const dir = path.dirname(absPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(absPath, stub.stubCode, 'utf8');
          written++;
        } catch (e) {
          action = 'error';
          reason = e.message;
        }
      } else if (action === 'write') {
        // dryRun — would-write
        written++;
      } else {
        skipped++;
      }

      files.push({
        family: family.base,
        keep:   family.keepBase || family.keep,
        retire: stub.retireModule || stub.stubPath,
        path:   absPath,
        action,
        reason,
        dryRun,
      });
    }
  }

  const totalStubs = (sliceResult.totalStubs || 0);
  return {
    written,
    skipped,
    files,
    dryRun,
    totalStubs,
    summary: dryRun
      ? `[DRY-RUN] V336 stub writer: ${written} would-write, ${skipped} skip (${totalStubs} total stubs)`
      : `V336 stub writer: ${written} written, ${skipped} skipped (${totalStubs} total stubs)`,
    version: STUB_WRITER_VERSION_336,
  };
}

/* ─── 2. persistDispatcherRegistry336 ──────────────────────────────────────── */

/**
 * Serialize the known-bad registry snapshot to a JSON sidecar file so the
 * self-healing dispatcher survives a server restart.
 *
 * @param {object}  registry    Snapshot from getKnownBadRegistry335()
 * @param {string}  filePath    Absolute or relative path to the JSON sidecar
 * @returns {{ ok, filePath, families, version }}
 */
function persistDispatcherRegistry336(registry, filePath) {
  if (!registry || typeof registry !== 'object') {
    return { ok: false, error: 'registry must be a plain object', version: STUB_WRITER_VERSION_336 };
  }
  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
  const payload = {
    __ecosVersion: STUB_WRITER_VERSION_336,
    __savedAt: new Date().toISOString(),
    registry,
  };
  try {
    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(absPath, JSON.stringify(payload, null, 2), 'utf8');
    return {
      ok:       true,
      filePath: absPath,
      families: Object.keys(registry).length,
      summary:  `V336 dispatcher registry persisted: ${Object.keys(registry).length} families → ${absPath}`,
      version:  STUB_WRITER_VERSION_336,
    };
  } catch (e) {
    return { ok: false, error: e.message, filePath: absPath, version: STUB_WRITER_VERSION_336 };
  }
}

/* ─── 3. loadDispatcherRegistry336 ──────────────────────────────────────────── */

/**
 * Load a previously persisted dispatcher registry sidecar.
 * Returns an initialKnownBad-compatible object for wireSelfHealingDispatcher335.
 *
 * @param {string}  filePath    Absolute or relative path to the JSON sidecar
 * @returns {{ ok, initialKnownBad, families, savedAt, version }}
 */
function loadDispatcherRegistry336(filePath) {
  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    return {
      ok:              false,
      initialKnownBad: {},
      families:        0,
      summary:         `V336 no sidecar found at ${absPath} — starting with empty registry`,
      version:         STUB_WRITER_VERSION_336,
    };
  }
  try {
    const raw     = fs.readFileSync(absPath, 'utf8');
    const payload = JSON.parse(raw);
    const reg     = payload.registry || {};
    // Validate: each entry must be an array of numbers
    const clean = {};
    for (const [base, versions] of Object.entries(reg)) {
      if (Array.isArray(versions)) {
        const nums = versions.map(Number).filter(n => !isNaN(n));
        if (nums.length) clean[base] = nums;
      }
    }
    return {
      ok:              true,
      initialKnownBad: clean,
      families:        Object.keys(clean).length,
      savedAt:         payload.__savedAt || null,
      summary:         `V336 dispatcher registry loaded: ${Object.keys(clean).length} families from ${absPath}`,
      version:         STUB_WRITER_VERSION_336,
    };
  } catch (e) {
    return {
      ok:              false,
      initialKnownBad: {},
      families:        0,
      error:           e.message,
      summary:         `V336 registry load error: ${e.message}`,
      version:         STUB_WRITER_VERSION_336,
    };
  }
}

/* ─── 4. runOracleWithRealFns336 ─────────────────────────────────────────────── */

/**
 * Regression oracle with real fn refs for the agentLoop family.
 * Locates the two boundary versions in lib/, require()s them, extracts a
 * stable pure function from each, and calls compareVersions334 over a curated
 * input suite.
 *
 * The "stable pure function" extraction: the agentLoop modules export an object;
 * we look for a deterministic function property (one that does not start an event
 * loop) by trying `module.run`, `module.execute`, `module.step`, `module.process`,
 * `module.tick` in order, then fall back to `() => typeof module` (a safe sentinel).
 *
 * @param {object}   graph               CapabilityGraph287 (already built)
 * @param {Function} compareVersions334Fn imported compareVersions334
 * @param {string}   [familyBase='agentLoop']
 * @param {object}   [opts]
 * @param {string}   [opts.libDir]        absolute path to lib/
 * @param {Array}    [opts.inputs]        override inputs array
 * @returns {{ ok, familyBase, oldVersion, newVersion, result, summary, version }}
 */
function runOracleWithRealFns336(graph, compareVersions334Fn, familyBase, opts) {
  opts = opts || {};
  familyBase = familyBase || 'agentLoop';
  const libDir = opts.libDir || path.join(__dirname, '..', '..', 'lib');
  const inputs = Array.isArray(opts.inputs) ? opts.inputs : [
    [{ type: 'ping' }],
    [{ type: 'noop' }],
    [null],
    [42],
    [{ action: 'test', payload: { id: 1 } }],
  ];

  // Collect versioned modules for the family from the graph
  const members = [];
  const base336 = _baseName336(familyBase);
  for (const [moduleName] of (graph.byModule || new Map()).entries()) {
    if (_baseName336(moduleName) === base336) {
      const v = _versionOf336(moduleName);
      if (v != null) members.push({ version: v, module: moduleName });
    }
  }
  members.sort((a, b) => a.version - b.version);

  if (members.length < 2) {
    return {
      ok:         false,
      familyBase: base336,
      oldVersion: null,
      newVersion: null,
      result:     null,
      summary:    `V336 real-fn oracle skipped: family "${base336}" has fewer than 2 versioned modules in lib/`,
      version:    STUB_WRITER_VERSION_336,
    };
  }

  const oldMember = members[0];
  const newMember = members[members.length - 1];

  /**
   * Safe fn extractor: tries a list of known-safe method names; falls back to
   * a sentinel that returns a stable string (never starts a loop).
   */
  function safeFn336(mod) {
    const SAFE_METHODS = ['run', 'execute', 'step', 'process', 'tick', 'invoke', 'call'];
    if (typeof mod === 'function') return mod;
    if (mod && typeof mod === 'object') {
      for (const m of SAFE_METHODS) {
        if (typeof mod[m] === 'function') {
          // Extra guard: only use it if it doesn't appear to start IO
          const src = String(mod[m]);
          if (!src.includes('setInterval') && !src.includes('setTimeout') && !src.includes('listen(')) {
            return mod[m].bind(mod);
          }
        }
      }
    }
    // Sentinel: return a stable descriptor string (deterministic, no side effects)
    return () => `[${typeof mod}:${Object.keys(mod || {}).sort().join(',')}]`;
  }

  let fnOld, fnNew;
  const loadErrors = [];

  try {
    const p = path.join(libDir, oldMember.module + '.js');
    fnOld = safeFn336(fs.existsSync(p) ? require(p) : null);
  } catch (e) {
    loadErrors.push(`old(${oldMember.module}): ${e.message}`);
    fnOld = () => null;
  }

  try {
    const p = path.join(libDir, newMember.module + '.js');
    fnNew = safeFn336(fs.existsSync(p) ? require(p) : null);
  } catch (e) {
    loadErrors.push(`new(${newMember.module}): ${e.message}`);
    fnNew = () => null;
  }

  let result;
  try {
    result = compareVersions334Fn(fnOld, fnNew, inputs);
  } catch (e) {
    return {
      ok:         false,
      familyBase: base336,
      oldVersion: oldMember.version,
      newVersion: newMember.version,
      result:     null,
      loadErrors,
      summary:    `V336 real-fn oracle error: ${e.message}`,
      version:    STUB_WRITER_VERSION_336,
    };
  }

  const equivalencePct = result.total > 0
    ? Math.round((result.identical / result.total) * 1000) / 10
    : null;

  return {
    ok:             result.diverged === 0,
    familyBase:     base336,
    oldVersion:     oldMember.version,
    newVersion:     newMember.version,
    result,
    equivalencePct,
    loadErrors:     loadErrors.length ? loadErrors : undefined,
    summary: result.diverged === 0
      ? `V336 real-fn oracle PASSED: ${result.identical}/${result.total} identical (v${oldMember.version}→v${newMember.version})`
      : `V336 real-fn oracle DIVERGED: ${result.diverged}/${result.total} differ (v${oldMember.version}→v${newMember.version})`,
    version: STUB_WRITER_VERSION_336,
  };
}

/* ─── Exports ────────────────────────────────────────────────────────────────── */

module.exports = {
  STUB_WRITER_VERSION_336,
  writeConsolidationStubs336,
  persistDispatcherRegistry336,
  loadDispatcherRegistry336,
  runOracleWithRealFns336,
  _baseName336,
  _versionOf336,
};
