'use strict';
/**
 * identityHeatmapGenerator398.js — ECOS V398 D3
 *
 * Produces a 2D actor × time heatmap of enforcement events,
 * bucketed by day-of-week and hour-of-day. Useful for spotting
 * off-hours or burst patterns.
 * Emits identity_heatmap_event_type_398.
 *
 * Function: createIdentityHeatmapGenerator398({ auditLog, audit })
 * Methods:
 *   generateHeatmap398(actorId?, opts?)  — actor or global heatmap
 *   getTopActors398(opts?)               — top N actors by enforcement volume
 */

const IDENTITY_HEATMAP_GENERATOR_VERSION_398 = '398.0.0';

const EVT_HEATMAP_398 = 'identity_heatmap_event_type_398';

// Days of week labels
const DAY_LABELS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// 24 hours
const HOUR_COUNT   = 24;
const DAY_COUNT    = 7;

// Consumed event types (enforcement-family)
const ENFORCE_TYPES_398 = new Set([
  'identity_callsite_enforce_event_type_393',
  'identity_callsite_enforce_reward_event_type_393',
  'identity_callsite_bypass_event_type_393',
  'identity_callsite_deny_event_type_393',
  'identity_batch_enforce_item_event_type_394',
  'identity_rate_limit_event_type_396',
  'identity_rate_limit_record_event_type_396',
  'identity_quota_exceeded_event_type_398',
  'identity_quota_record_event_type_398',
]);

function _makeEmptyGrid() {
  // grid[dayOfWeek][hourOfDay] = count
  const grid = [];
  for (let d = 0; d < DAY_COUNT; d++) {
    grid.push(new Array(HOUR_COUNT).fill(0));
  }
  return grid;
}

function _extractActorId(e) {
  const d = e.data || e.payload || e.details || {};
  return d.actorId || d.actor || null;
}

function createIdentityHeatmapGenerator398(opts = {}) {
  const auditLog = opts.auditLog || opts.audit || null;

  function _appendAudit(entry) {
    if (!auditLog) return;
    if (typeof auditLog.append === 'function') auditLog.append(entry);
  }

  function _getEntries() {
    if (!auditLog) return [];
    if (typeof auditLog.getEntries === 'function') return auditLog.getEntries();
    if (Array.isArray(auditLog.entries)) return auditLog.entries;
    return [];
  }

  function _filterEntries(entries, actorId, sinceTs, untilTs) {
    return entries.filter(e => {
      const type = e.type || e.eventType || '';
      if (!ENFORCE_TYPES_398.has(type)) return false;
      const ts = e.ts || e.timestamp || 0;
      if (sinceTs !== undefined && ts < sinceTs) return false;
      if (untilTs !== undefined && ts > untilTs) return false;
      if (actorId) {
        const actor = _extractActorId(e);
        if (actor !== actorId) return false;
      }
      return true;
    });
  }

  function _buildGrid(events) {
    const grid = _makeEmptyGrid();
    for (const e of events) {
      const ts  = e.ts || e.timestamp || 0;
      const d   = new Date(ts);
      const dow = d.getDay();         // 0 (Sun) – 6 (Sat)
      const h   = d.getHours();       // 0 – 23
      grid[dow][h]++;
    }
    return grid;
  }

  function _gridStats(grid) {
    let max = 0;
    let min = Infinity;
    let total = 0;
    for (const row of grid) {
      for (const v of row) {
        if (v > max) max = v;
        if (v < min) min = v;
        total += v;
      }
    }
    if (total === 0) min = 0;
    return { max, min, total };
  }

  /**
   * generateHeatmap398(actorId?, opts?)
   *
   * actorId  — if provided, heatmap for this actor only; null/undefined = global
   * opts.sinceTs  — lower time bound
   * opts.untilTs  — upper time bound
   * opts.snapshot — append EVT_HEATMAP_398
   *
   * Returns {
   *   version, generatedAt, actorId (or 'global'), sinceTs, untilTs,
   *   grid: [[count per hour per day]],
   *   dayLabels, hourLabels,
   *   stats: { max, min, total },
   *   hotspots: [{ day, hour, count }] (top 5)
   * }
   */
  function generateHeatmap398(actorId, opts = {}) {
    // Support single-arg opts call: generateHeatmap398(opts?)
    if (actorId && typeof actorId === 'object' && !opts) {
      opts = actorId;
      actorId = null;
    }
    if (typeof actorId !== 'string' || !actorId) actorId = null;

    const now      = Date.now();
    const sinceTs  = typeof opts.sinceTs === 'number' ? opts.sinceTs : undefined;
    const untilTs  = typeof opts.untilTs === 'number' ? opts.untilTs : undefined;

    const entries  = _getEntries();
    const filtered = _filterEntries(entries, actorId, sinceTs, untilTs);
    const grid     = _buildGrid(filtered);
    const stats    = _gridStats(grid);

    // Identify top-5 hotspots
    const hotspots = [];
    for (let d = 0; d < DAY_COUNT; d++) {
      for (let h = 0; h < HOUR_COUNT; h++) {
        if (grid[d][h] > 0) hotspots.push({ day: DAY_LABELS[d], dayIndex: d, hour: h, count: grid[d][h] });
      }
    }
    hotspots.sort((a, b) => b.count - a.count);
    const top5 = hotspots.slice(0, 5);

    const hourLabels = Array.from({ length: HOUR_COUNT }, (_, i) => `${String(i).padStart(2, '0')}:00`);

    const result = {
      version:      IDENTITY_HEATMAP_GENERATOR_VERSION_398,
      generatedAt:  now,
      actorId:      actorId || 'global',
      sinceTs:      sinceTs || null,
      untilTs:      untilTs || null,
      eventCount:   filtered.length,
      grid,
      dayLabels:    DAY_LABELS,
      hourLabels,
      stats,
      hotspots:     top5,
    };

    if (opts.snapshot === true) {
      _appendAudit({
        type: EVT_HEATMAP_398,
        ts:   now,
        data: { actorId: actorId || 'global', eventCount: filtered.length, stats },
      });
    }

    return result;
  }

  /**
   * getTopActors398(opts?)
   * Returns top N actors sorted by enforcement event count.
   *
   * opts.limit    — max actors (default: 10)
   * opts.sinceTs  — lower time bound
   */
  function getTopActors398(opts = {}) {
    const limit   = typeof opts.limit === 'number' && opts.limit > 0 ? opts.limit : 10;
    const sinceTs = typeof opts.sinceTs === 'number' ? opts.sinceTs : 0;
    const now     = Date.now();

    const entries  = _getEntries();
    const counts   = new Map();

    for (const e of entries) {
      const type = e.type || e.eventType || '';
      if (!ENFORCE_TYPES_398.has(type)) continue;
      const ts = e.ts || e.timestamp || 0;
      if (ts < sinceTs) continue;
      const actor = _extractActorId(e);
      if (!actor) continue;
      counts.set(actor, (counts.get(actor) || 0) + 1);
    }

    const actors = Array.from(counts.entries())
      .map(([actorId, count]) => ({ actorId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    return {
      version:     IDENTITY_HEATMAP_GENERATOR_VERSION_398,
      generatedAt: now,
      sinceTs:     sinceTs || null,
      limit,
      actors,
    };
  }

  return {
    generateHeatmap398,
    getTopActors398,
    IDENTITY_HEATMAP_GENERATOR_VERSION_398,
    EVT_HEATMAP_398,
  };
}

module.exports = {
  createIdentityHeatmapGenerator398,
  IDENTITY_HEATMAP_GENERATOR_VERSION_398,
  EVT_HEATMAP_398,
  DAY_LABELS_398:  DAY_LABELS,
  HOUR_COUNT_398:  HOUR_COUNT,
};
