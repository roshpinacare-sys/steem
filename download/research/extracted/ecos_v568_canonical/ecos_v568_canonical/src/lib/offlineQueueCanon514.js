'use strict';
/**
 * lib/offlineQueueCanon514.js — ECOS V514
 *
 * Canonical facade for the offlineQueue tower (V263–V268, 6 modules).
 *
 * המגדל: 6 גרסאות של offlineQueue. V263–V267 הם thin re-exports ל-V268.
 * הפתרון: facade אחד — נקודת כניסה יחידה לכל קוד חדש.
 *
 * V268 יכולות: Priority queuing (CRITICAL/NORMAL/LOW), persistent snapshot,
 * conflict detection, mobile PWA headers, batch replay with partial success.
 *
 * Usage:
 *   const canon514 = require('./lib/offlineQueueCanon514.js');
 *   canon514.getCanonInfo514()          // tower metadata
 *   canon514.getHealthSummary514()      // live health snapshot
 *   canon514.createInstance514(opts)    // new OfflineQueue268 instance
 *   canon514.getDefaultInstance514()    // shared singleton
 *   canon514.registerEndpoints514(app)  // wire V514 endpoints
 *
 * All identifiers end in 514. Sacred files untouched. Zero npm deps.
 * @module offlineQueueCanon514
 * @version 514.0.0
 */

const CANON_VERSION_514      = '514.0.0';
const CANON_TOWER_PREFIX_514 = 'offlineQueue';
const CANON_TIP_VERSION_514  = 268;
const CANON_BASE_VERSION_514 = 263;
const CANON_COUNT_514        = 6; // V263–V268 inclusive
const IMPORT_GUIDANCE_514    =
  'New code: require(./lib/offlineQueueCanon514.js). Never import V263..V267 directly.';

// ── load tip (fail-soft) ─────────────────────────────────────────────────────

let _tip514       = null;
let _loadError514 = null;

try {
  _tip514 = require('./offlineQueue268.js');
} catch (e) {
  _loadError514 = e.message;
}

const {
  OfflineQueue268,
  defaultOfflineQueue268,
  PRIORITY_LEVELS_268,
  MAX_QUEUE_SIZE_268,
} = _tip514 || {};

// ── shared singleton ─────────────────────────────────────────────────────────

let _defaultInstance514 = null;

function getDefaultInstance514() {
  if (_defaultInstance514) return _defaultInstance514;
  if (defaultOfflineQueue268) {
    _defaultInstance514 = defaultOfflineQueue268;
    return _defaultInstance514;
  }
  if (OfflineQueue268) {
    _defaultInstance514 = new OfflineQueue268();
    return _defaultInstance514;
  }
  return null;
}

// ── public API ───────────────────────────────────────────────────────────────

/**
 * getCanonInfo514() — metadata על המגדל
 */
function getCanonInfo514() {
  return {
    version:        CANON_VERSION_514,
    tower:          CANON_TOWER_PREFIX_514,
    canonicalTip:   CANON_TIP_VERSION_514,
    chainBase:      CANON_BASE_VERSION_514,
    chainLength:    CANON_COUNT_514,
    importGuidance: IMPORT_GUIDANCE_514,
    loadError:      _loadError514 || null,
    capabilities: [
      'priority queuing (CRITICAL/NORMAL/LOW)',
      'conflict detection',
      'batch replay with partial success',
      'persistent queue snapshot',
      'mobile PWA headers (X-ECOS-Offline, X-ECOS-Queue-Status)',
    ],
  };
}

/**
 * getHealthSummary514() — live health snapshot.
 * Always returns a valid object, never throws.
 */
function getHealthSummary514() {
  try {
    const instance = getDefaultInstance514();
    const stats = instance && typeof instance._stats268 === 'object'
      ? { ...instance._stats268 }
      : null;
    const queueCount = instance && instance._queues268 instanceof Map
      ? instance._queues268.size
      : null;
    const priorityLevels = PRIORITY_LEVELS_268
      ? Object.keys(PRIORITY_LEVELS_268)
      : null;

    return {
      ok:             true,
      version:        CANON_VERSION_514,
      towerLoaded:    !_loadError514,
      loadError:      _loadError514 || null,
      instanceReady:  !!instance,
      stats,
      activeUserQueues: queueCount,
      maxQueueSize:   MAX_QUEUE_SIZE_268 || null,
      priorityLevels,
    };
  } catch (e) {
    return { ok: false, error: e.message, version: CANON_VERSION_514 };
  }
}

/**
 * createInstance514(opts) — create a fresh OfflineQueue268 instance.
 * fail-closed if tower not loaded.
 */
function createInstance514(opts) {
  if (!OfflineQueue268) {
    return { ok: false, error: 'OfflineQueue268 not available: ' + (_loadError514 || 'unknown') };
  }
  try {
    const instance = new OfflineQueue268(opts || {});
    return { ok: true, instance };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * getQueueStatus514(userId) — queue depth and stats for a specific user.
 * fail-closed if userId missing or instance unavailable.
 */
function getQueueStatus514(userId) {
  if (!userId || typeof userId !== 'string') {
    return { ok: false, error: 'userId must be a non-empty string' };
  }
  try {
    const instance = getDefaultInstance514();
    if (!instance) return { ok: false, error: 'instance_unavailable' };
    const queue = instance._queues268 instanceof Map
      ? (instance._queues268.get(userId) || [])
      : [];
    const byPriority = {};
    if (PRIORITY_LEVELS_268) {
      for (const [name, val] of Object.entries(PRIORITY_LEVELS_268)) {
        byPriority[name] = queue.filter(a => a.priority === val).length;
      }
    }
    return {
      ok:        true,
      userId,
      depth:     queue.length,
      byPriority,
      version:   CANON_VERSION_514,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * registerEndpoints514(app) — wires V514 endpoints onto the Express app.
 */
function registerEndpoints514(app) {
  // [V514-T01] GET /api/v1/offline-queue/canon/status
  app.get('/api/v1/offline-queue/canon/status', (_req, res) => {
    res.json({
      info:   getCanonInfo514(),
      health: getHealthSummary514(),
    });
  });

  // [V514-T02] GET /api/v1/offline-queue/queue-status/v514
  app.get('/api/v1/offline-queue/queue-status/v514', (req, res) => {
    const userId = req.query.userId || '';
    if (!userId) {
      return res.status(400).json({ ok: false, error: 'userId query param required' });
    }
    return res.json(getQueueStatus514(userId));
  });

  // [V514-T03] GET /api/v1/admin/summary/v514
  app.get('/api/v1/admin/summary/v514', (_req, res) => {
    res.json({
      version:   CANON_VERSION_514,
      status:    'ok',
      endpoints: [
        'V514-T01 GET /api/v1/offline-queue/canon/status',
        'V514-T02 GET /api/v1/offline-queue/queue-status/v514',
        'V514-T03 GET /api/v1/admin/summary/v514',
      ],
      module:   'offlineQueueCanon514',
      connects: ['offlineQueue263..268'],
    });
  });
}

module.exports = {
  CANON_VERSION_514,
  CANON_TOWER_PREFIX_514,
  CANON_TIP_VERSION_514,
  CANON_BASE_VERSION_514,
  IMPORT_GUIDANCE_514,
  // V268 surface pass-through
  OfflineQueue268,
  PRIORITY_LEVELS_268,
  MAX_QUEUE_SIZE_268,
  // V514 API
  getCanonInfo514,
  getHealthSummary514,
  createInstance514,
  getDefaultInstance514,
  getQueueStatus514,
  registerEndpoints514,
};
