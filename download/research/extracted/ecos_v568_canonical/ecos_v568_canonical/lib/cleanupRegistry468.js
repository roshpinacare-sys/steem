'use strict';
/**
 * cleanupRegistry468.js — Cleanup Registry V468
 *
 * Priority A: remove unreferenced heavy files (old patches, images, scripts)
 * that bloat the canonical archive with zero code references.
 *
 * Rules:
 *  - No new npm deps.
 *  - All identifiers end in 468.
 *  - Fail-closed: no mutations, read-only registry.
 */

const CLEANUP_VERSION_468 = '468';

class CleanupRegistryError468 extends Error {
  constructor(msg, code) {
    super(msg);
    this.name = 'CleanupRegistryError468';
    this.code = code || 'CLEANUP468_ERROR';
    this.statusCode = 500;
  }
}

const CLEANUP_MANIFEST_468 = {
  version: 'V468',
  phase: 'P352',
  feature: 'canonical-cleanup-registry',
  description: 'Priority A cleanup: unreferenced patch files, images, and scripts removed',
  removed: {
    patchFiles: {
      count: 47,
      reason: 'zero references in ecos-api-server.js, lib/, src/, or tests/',
      examples: [
        'ecos-api-server-v216-patch.js',
        'ecos-api-server-v404-patch.js',
        'ecos-api-server-v436-patch.js',
      ],
    },
    images: {
      count: 3,
      reason: 'zero references in code',
      files: [
        'gumloop/assets/social_launch_card.png',
        'gumloop/assets/chart_code_size.png',
        'gumloop/assets/chart_positioning.png',
      ],
      approximateBytesSaved: 1100000,
    },
    scripts: {
      count: 1,
      reason: 'zero references in code',
      files: [
        'scripts/reembed-patches.js',
      ],
    },
    testPatches: {
      count: 1,
      reason: 'zero references in code',
      files: [
        'tests/ecos-api-server-v216-patch.js',
      ],
    },
  },
  retained: {
    patchFiles: 39,
    note: 'referenced patch files preserved; endpoints and tests remain intact',
  },
  ecosVersion: 'V468',
};

function getCleanupReport468() {
  return JSON.parse(JSON.stringify(CLEANUP_MANIFEST_468));
}

function getSummary468() {
  return {
    ok: true,
    version: 'V468',
    description: 'Canonical Cleanup Registry — removed unreferenced heavy files from archive',
    endpoints: [
      'GET /api/v1/registry/cleanup',
      'GET /api/v1/admin/summary/v468',
    ],
    ecosVersion: 'V468',
  };
}

module.exports = {
  CLEANUP_VERSION_468,
  CleanupRegistryError468,
  getCleanupReport468,
  getSummary468,
};
