'use strict';
/**
 * lib/businessPackIndex233.js — ECOS V233 (Phase P127)
 *
 * Surfaces the imported Gumloop business/design pack (gumloop/) as a structured,
 * navigable index so the GTM + architecture + design artifacts are discoverable
 * from the admin surface instead of being lost in a folder. Pure + dependency-free
 * (R6, builtins only); version-suffixed (…233, BUG-L safe).
 *
 * @version 233.0.0
 */

const fs = require('fs');
const path = require('path');

// Curated map of the pack's "gates" (G1..G5) → human labels.
const GATE_LABELS_233 = {
  G1_market:    'Market & Competitor Research (ICP)',
  G2_health:    'Code Health + Architecture',
  G3_leads:     'Outreach Templates',
  G4_marketing: 'Landing Copy + SEO Audit',
  G5_launch:    'Launch Posts, Channels, Calendar',
};

function _safeList233(dir) {
  try { return fs.readdirSync(dir).filter(f => !f.startsWith('.')); }
  catch (_) { return []; }
}

/**
 * Build the business-pack index from a base directory (the build root).
 * Reads <root>/gumloop/{deliverables,assets}. Returns a structured manifest.
 * @param {string} root  absolute path to the build root
 * @returns {{ generatedAt, version, present, gates, assets, totals }}
 */
function buildBusinessPackIndex233(root) {
  const base = path.join(root, 'gumloop');
  const present = fs.existsSync(base);
  const delivBase = path.join(base, 'deliverables');
  const assetsBase = path.join(base, 'assets');

  const gates = _safeList233(delivBase).map(gateId => {
    const files = _safeList233(path.join(delivBase, gateId));
    return {
      id: gateId,
      label: GATE_LABELS_233[gateId] || gateId,
      files: files.sort(),
      fileCount: files.length,
    };
  });

  const assets = _safeList233(assetsBase)
    .filter(f => /\.(png|jpg|jpeg|svg|webp)$/i.test(f))
    .sort();

  return {
    generatedAt: new Date().toISOString(),
    version: '233.0.0',
    present,
    gates,
    assets,
    totals: {
      gates: gates.length,
      deliverables: gates.reduce((s, g) => s + g.fileCount, 0),
      assets: assets.length,
    },
  };
}

module.exports = {
  GATE_LABELS_233,
  buildBusinessPackIndex233,
};
