'use strict';
/**
 * src/lib/towerRegistryMap469.js — ECOS V469
 *
 * Tower Registry Map: catalogs duplication towers in src/lib/,
 * identifies the canonical (highest version) per prefix,
 * and returns actionable consolidation guidance.
 *
 * Pure + dependency-free (fs/path built-ins only).
 * Sacred files untouched. All identifiers end in 469.
 *
 * @version 469.0.0
 */

const fs   = require('fs');
const path = require('path');

const TOWER_THRESHOLD_469 = 3; // >3 modules = tower

/**
 * Scans a directory for versioned modules and groups them by prefix.
 * Returns an array of tower objects sorted by size desc.
 */
function scanTowers469(libDir) {
  let files;
  try {
    files = fs.readdirSync(libDir).filter(f => f.endsWith('.js'));
  } catch (_) {
    return [];
  }

  const groups469 = {};
  for (const f of files) {
    // Match: <prefix><digits>.js  (e.g. marketMaker316.js)
    // Prefix: letters + hyphens/underscores only (no digits), version: trailing digit block
    const m = f.match(/^([a-zA-Z][a-zA-Z_-]*)(\d+)\.js$/);
    if (!m) continue;
    const prefix = m[1];
    const ver    = parseInt(m[2], 10);
    if (!groups469[prefix]) groups469[prefix] = [];
    groups469[prefix].push({ file: f, ver });
  }

  const towers469 = [];
  for (const [prefix, members] of Object.entries(groups469)) {
    if (members.length <= TOWER_THRESHOLD_469) continue;
    members.sort((a, b) => b.ver - a.ver);
    const canonical469 = members[0];
    const nonCanonical469 = members.slice(1);
    towers469.push({
      prefix,
      count:          members.length,
      canonical:      canonical469.file,
      canonicalVer:   canonical469.ver,
      nonCanonical:   nonCanonical469.map(m => m.file),
      action:         'consolidate — make non-canonical thin re-exports',
    });
  }

  towers469.sort((a, b) => b.count - a.count);
  return towers469;
}

/**
 * Returns a full consolidation report469 for the standard lib paths.
 */
function getConsolidationReport469(projectRoot) {
  const root469 = projectRoot || path.resolve(__dirname, '../..');
  const srcLib  = path.join(root469, 'src', 'lib');
  const lib     = path.join(root469, 'lib');

  const srcTowers469 = scanTowers469(srcLib);
  const libTowers469 = scanTowers469(lib);

  // Deduplicate by prefix (src/lib wins)
  const seen469 = new Set(srcTowers469.map(t => t.prefix));
  const combined469 = [
    ...srcTowers469.map(t => ({ ...t, location: 'src/lib' })),
    ...libTowers469
      .filter(t => !seen469.has(t.prefix))
      .map(t => ({ ...t, location: 'lib' })),
  ];

  return {
    ok:           true,
    generatedAt:  new Date().toISOString(),
    towerCount:   combined469.length,
    totalModulesInTowers: combined469.reduce((s, t) => s + t.count, 0),
    towers:       combined469,
    summary: combined469.length === 0
      ? 'No towers detected — consolidation complete.'
      : `${combined469.length} tower(s) detected. Top priority: ${combined469[0].prefix} (${combined469[0].count} modules).`,
  };
}

module.exports = {
  scanTowers469,
  getConsolidationReport469,
  TOWER_THRESHOLD_469,
};
