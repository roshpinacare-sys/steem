/**
 * ECOS API Server — V270 Patch
 * Phase P270: Canonical Consolidation — Unified Health Summary
 *
 * Provides a consolidated health and inventory endpoint that surfaces
 * the complete V270 module state, lib/ mirror parity, and patch chain status.
 *
 * @version 270.0.0
 * @see CHANGELOG_V270.md
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname);

/**
 * Build V270 state: inventory of all versioned modules and patch files.
 */
function createV270State(opts = {}) {
  const { logger = { info: () => {}, warn: () => {} } } = opts;

  // Inventory lib/ and src/lib/ files
  const libFiles = new Set(
    (fs.existsSync(path.join(ROOT_DIR, 'lib'))
      ? fs.readdirSync(path.join(ROOT_DIR, 'lib')).filter(f => f.endsWith('.js'))
      : [])
  );
  const srcLibFiles = new Set(
    (fs.existsSync(path.join(ROOT_DIR, 'src', 'lib'))
      ? fs.readdirSync(path.join(ROOT_DIR, 'src', 'lib')).filter(f => f.endsWith('.js'))
      : [])
  );

  // Files in src/lib/ but not in lib/ (should be zero in V270)
  const missingMirrors = [...srcLibFiles].filter(f => !libFiles.has(f));

  // Patch chain
  const patches = fs.readdirSync(ROOT_DIR)
    .filter(f => /^ecos-api-server-v\d+-patch\.js$/.test(f))
    .sort();

  logger.info({ v: 270, modules: libFiles.size, missingMirrors: missingMirrors.length }, 'V270 state created');

  return {
    version: '270',
    libModules: libFiles.size,
    srcLibModules: srcLibFiles.size,
    missingMirrors,
    mirrorParity: missingMirrors.length === 0,
    patches,
    patchCount: patches.length,
  };
}

/**
 * Register V270 API endpoints on the Express app.
 */
function registerEcosV270Routes(app, state) {
  if (!app || typeof app.get !== 'function') return;

  // GET /api/v270/health
  app.get('/api/v270/health', (_req, res) => {
    res.json({
      ok: state.mirrorParity,
      version: '270',
      libModules: state.libModules,
      srcLibModules: state.srcLibModules,
      missingMirrors: state.missingMirrors,
      mirrorParity: state.mirrorParity,
      patchCount: state.patchCount,
      ecosVersion: 'V270',
    });
  });

  // GET /api/v270/inventory
  app.get('/api/v270/inventory', (_req, res) => {
    res.json({
      ok: true,
      version: '270',
      patches: state.patches,
      libModules: state.libModules,
      ecosVersion: 'V270',
      consolidationBase: 'V254',
      consolidatedThrough: 'V269',
    });
  });

  // GET /api/v1/admin/summary/v270
  app.get('/api/v1/admin/summary/v270', (_req, res) => {
    res.json({
      ok: true,
      version: 'V270',
      type: 'consolidation_release',
      mirrorParity: state.mirrorParity,
      missingMirrorCount: state.missingMirrors.length,
      patchCount: state.patchCount,
      libModuleCount: state.libModules,
      ecosVersion: 'V270',
    });
  });
}

module.exports = { createV270State, registerEcosV270Routes };
