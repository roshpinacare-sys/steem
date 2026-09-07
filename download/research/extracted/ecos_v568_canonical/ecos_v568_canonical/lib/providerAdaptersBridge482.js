'use strict';
/**
 * src/lib/providerAdaptersBridge482.js — ECOS V482
 *
 * מחבר את Canon476 (providerAdapters) ל-hexaTowerCanon481:
 * chain map + health מרוכזים בנקודת כניסה אחת.
 *
 *   mapChain482(libDir)  — מפת שרשרת: status לכל גרסה
 *   getHealth482(libDir) — health חי מ-Canon476 (fail-closed)
 *   getReport482(libDir) — שניהם ביחד
 *
 * Zero deps. All identifiers end in 482.
 * @version 482.0.0
 */

const fs   = require('fs');
const path = require('path');

// Resolve lib/ dir relative to this file's location
// Works from both src/lib/ and lib/ (mirror)
function _libDir482(override) {
  if (override) return override;
  const d = __dirname;
  // if we're in src/lib, step up two dirs then into lib
  if (d.endsWith('src' + path.sep + 'lib') || d.includes('/src/lib')) {
    return path.resolve(d, '..', '..', 'lib');
  }
  // if we're already in lib, that's the dir
  return d;
}

const CHAIN_VERSIONS_482           = [267,268,269,273,274,275,276,277,278,279,280,281,282,283,284,285,286];
const ACTIVE_PATCH_VERSIONS_482    = new Set([268, 269, 273]);
const THIN_REEXPORT_VERSIONS_482   = new Set([267]);
const TIP_VERSION_482              = 286;

function mapChain482(libDir) {
  const dir = _libDir482(libDir);
  return CHAIN_VERSIONS_482.map(v => {
    const fp = path.join(dir, `providerAdapters${v}.js`);
    let exists = false;
    try { fs.accessSync(fp); exists = true; } catch (_) {}
    let status;
    if (!exists)                             status = 'MISSING';
    else if (THIN_REEXPORT_VERSIONS_482.has(v)) status = 'THIN_REEXPORT';
    else if (v === TIP_VERSION_482)          status = 'TIP';
    else if (ACTIVE_PATCH_VERSIONS_482.has(v)) status = 'ACTIVE_PATCH';
    else                                     status = 'CHAIN_LINK';
    return { version: v, status, exists };
  });
}

function getHealth482(libDir) {
  const dir = _libDir482(libDir);
  try {
    const c476 = require(path.join(dir, 'providerAdaptersCanon476.js'));
    if (typeof c476.getHealthSummary476 === 'function')
      return { ok: true, source: 'canon476', health: c476.getHealthSummary476() };
    if (typeof c476.getCanonInfo476 === 'function')
      return { ok: true, source: 'canon476-info', health: c476.getCanonInfo476() };
    return { ok: false, source: 'canon476', error: 'no health fn' };
  } catch (e) {
    return { ok: false, source: 'canon476', error: e.message };
  }
}

function getReport482(libDir) {
  const chain   = mapChain482(libDir);
  const health  = getHealth482(libDir);
  const thin    = chain.filter(c => c.status === 'THIN_REEXPORT').length;
  const links   = chain.filter(c => c.status === 'CHAIN_LINK').length;
  const patches = chain.filter(c => c.status === 'ACTIVE_PATCH').length;
  return {
    ok:           true,
    version:      '482.0.0',
    tower:        'providerAdapters',
    canonVersion: 476,
    tipVersion:   TIP_VERSION_482,
    chainLength:  chain.length,
    thinReexports: thin,
    chainLinks:   links,
    activePatch:  patches,
    consolidationNote: `${thin} thin re-export(s) done V482. ${links} chain-links remain (intact — required by successors). Canon476 is the entry point for all new code.`,
    chain,
    health,
  };
}

module.exports = {
  mapChain482,
  getHealth482,
  getReport482,
  CHAIN_VERSIONS_482,
  ACTIVE_PATCH_VERSIONS_482,
  THIN_REEXPORT_VERSIONS_482,
  TIP_VERSION_482,
};
