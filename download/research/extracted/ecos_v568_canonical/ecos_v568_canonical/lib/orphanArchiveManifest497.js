'use strict';
/**
 * src/lib/orphanArchiveManifest497.js — ECOS V497 (Phase P376) — Orphan Archive Manifest
 *
 * Records and reports the V497 dead-code cleanup so the system documents its own maintenance
 * and stays honest about what it contains. 62 true orphans — lib modules required by ZERO
 * files (server, tests, other lib), with no dynamic requires anywhere to load them — were
 * ARCHIVED (moved to _archive_orphans_v497/, not deleted → fully reversible) out of the active
 * lib/ surface. This shrinks the capability graph the registry/Diamond report on to the modules
 * that are actually wired, making the system's self-model truthful.
 *
 *   loadManifest497   — read the archive manifest (count, reclaimed lines, module list).
 *   isArchived497     — was a given module archived this round? (reversibility helper)
 *   summary497        — compact report for the maintenance endpoint.
 *
 * Pure JS, no new deps (R3/R6). Read-only. Version-suffixed (…497).
 *
 * @version 497.0.0
 */

const fs = require('fs');
const path = require('path');

const ARCHIVE_VERSION_497 = '497.0.0';
const ARCHIVE_DIR_497 = '_archive_orphans_v497';

class ManifestError497 extends Error {
  constructor(msg, code) { super(msg); this.name = 'ManifestError497'; this.code = code || 'MANIFEST_ERROR'; this.statusCode = 400; }
}

function _manifestPath497(rootDir) { return path.join(rootDir || process.cwd(), ARCHIVE_DIR_497, 'MANIFEST.json'); }

/** Read the archive manifest. Returns a safe empty manifest if none exists (fail-soft for reporting). */
function loadManifest497(rootDir) {
  const p = _manifestPath497(rootDir);
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const m = JSON.parse(raw);
    if (!Array.isArray(m.modules)) m.modules = [];
    return m;
  } catch (_) {
    return { version: ARCHIVE_VERSION_497, count: 0, reclaimedLines: 0, reversible: true, modules: [], note: 'no archive manifest present' };
  }
}

/** Was this module archived this round? */
function isArchived497(moduleName, rootDir) {
  if (!moduleName) throw new ManifestError497('moduleName required', 'BAD_ARGS');
  const m = loadManifest497(rootDir);
  return m.modules.indexOf(String(moduleName).replace(/\.js$/, '')) !== -1;
}

/** Compact report. */
function summary497(rootDir) {
  const m = loadManifest497(rootDir);
  return {
    version: ARCHIVE_VERSION_497,
    archivedModules: m.count || m.modules.length,
    reclaimedLines: m.reclaimedLines || 0,
    reversible: m.reversible !== false,
    location: m.location || (ARCHIVE_DIR_497 + '/'),
    reason: m.reason || 'true orphans required by zero files',
    sample: m.modules.slice(0, 10),
  };
}

module.exports = {
  ARCHIVE_VERSION_497, ARCHIVE_DIR_497, ManifestError497,
  loadManifest497, isArchived497, summary497,
};
