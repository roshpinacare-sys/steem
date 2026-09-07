'use strict';
/**
 * src/lib/solvencyTowerFacade422.js — ECOS V422 (Phase P310) — Solvency Tower API Facade
 *
 * Express wire function mounting a small set of read-only diagnostic endpoints
 * backed by solvencyFederationReexports421, completing the V421 consolidation story
 * with an observable surface.
 *
 * All identifiers end in 422 (R2). No new npm deps (R3). Sacred untouched (R1).
 *
 * @version 422.0.0
 */

const FACADE_VERSION_422 = '422.0.0';

// ── wireSolvencyFacade422 ─────────────────────────────────────────────────────

/**
 * Mount read-only solvency-tower diagnostic endpoints.
 * @param {object} ctx
 * @param {object} ctx.app     — Express app
 * @param {object} [ctx.logger] — optional logger
 * @param {object} [ctx.solvency] — optional solvencyFederationReexports421 module
 */
function wireSolvencyFacade422(ctx) {
  const app    = ctx && ctx.app;
  const logger = (ctx && ctx.logger) || console;
  let solvency;
  try {
    solvency = (ctx && ctx.solvency) || require('../ecos_v419_canonical/src/lib/solvencyFederationReexports421.js');
  } catch (e) {
    try { logger.warn({}, '[V422] solvencyFederationReexports421 not found — facade skipped'); } catch (_) {}
    return {};
  }

  if (!app || typeof app.get !== 'function') {
    try { logger.warn({}, '[V422] no express app — solvency facade skipped'); } catch (_) {}
    return {};
  }

  // ── F01 — GET /api/v1/solvency/tower/stats ───────────────────────────────
  app.get('/api/v1/solvency/tower/stats', (_req, res) => { // V422-F01
    try {
      const stats = solvency.stats421();
      res.json({ ok: true, ecosVersion: 'V422', stats });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V422' });
    }
  });

  // ── F02 — GET /api/v1/solvency/tower/modules ──────────────────────────────
  app.get('/api/v1/solvency/tower/modules', (_req, res) => { // V422-F02
    try {
      const names = Object.keys(solvency.byModule421 || {});
      res.json({
        ok: true,
        ecosVersion: 'V422',
        moduleCount: names.length,
        modules: names,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V422' });
    }
  });

  // ── F03 — GET /api/v1/solvency/tower/version ───────────────────────────────
  app.get('/api/v1/solvency/tower/version', (_req, res) => { // V422-F03
    try {
      res.json({
        ok: true,
        ecosVersion: 'V422',
        towerVersion: solvency.SOLVENCY_FEDERATION_TOWER_VERSION_421,
        facadeVersion: FACADE_VERSION_422,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V422' });
    }
  });

  // ── F04 — GET /api/v1/solvency/tower/module/:name ──────────────────────────
  app.get('/api/v1/solvency/tower/module/:name', (req, res) => { // V422-F04
    try {
      const name = req.params.name;
      const mod = (solvency.byModule421 || {})[name];
      if (!mod) return res.status(404).json({ ok: false, error: 'module not found', ecosVersion: 'V422' });
      // Return shallow keys summary (not full module to avoid leaking internals)
      const keys = Object.keys(mod).filter(k => typeof mod[k] !== 'function');
      res.json({
        ok: true,
        ecosVersion: 'V422',
        moduleName: name,
        exportKeys: keys,
        hasFactory: typeof mod.create === 'function' || keys.some(k => k.startsWith('create')),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V422' });
    }
  });

  try { logger.info({}, '[V422] Solvency tower facade wired: 4 endpoints'); } catch (_) {}

  return { wired: true, endpoints: 4 };
}

module.exports = {
  FACADE_VERSION_422,
  wireSolvencyFacade422,
};
