'use strict';
/**
 * lib/systemCapabilities207.js — ECOS V207 (Phase P96)
 *
 * Two pure, dependency-free capabilities (R6), version-suffixed (…207, BUG-L safe):
 *
 *  1) SYSTEM CAPABILITY REGISTRY — a single structured "self-map" of the whole
 *     platform, grouped into domains. This is the higher-order organizing layer:
 *     instead of 50+ scattered version blocks, one endpoint returns a navigable
 *     catalog of what the system can do, when each domain was introduced, and a
 *     maturity rollup. Built to power a clean, chat-first "what can this do?" view.
 *
 *  2) BURST DETECTOR (V207 roadmap item) — pure sliding-window detection of
 *     time windows where event rate exceeds a threshold. Operates on the same
 *     event envelopes stored in _eventLog181 (no parallel store).
 *
 * @version 207.0.0
 */

// ── 1) Capability registry ────────────────────────────────────────────────────
// Curated, accurate catalog of the platform's stable domains. `since` is the
// version a domain first appeared; `maturity` is a coarse stability signal.
const CAPABILITY_DOMAINS = [
  {
    id: 'economy', title: 'Economy & Ledger', since: 'V38', maturity: 'core',
    summary: 'BigInt fiat ledger, 40/40/20 split, immutable accounting (sacred).',
    surfaces: ['fiatLedger', 'royalty distribution', 'insurance pool'],
  },
  {
    id: 'audit', title: 'Audit & Integrity', since: 'V38', maturity: 'core',
    summary: 'Append-only audit log with hash chaining + Merkle mountain range.',
    surfaces: ['auditLog', 'MMR', 'integrity proofs'],
  },
  {
    id: 'rank', title: 'Rank & Reputation', since: 'V133', maturity: 'stable',
    summary: 'Tiered user rank, reward multipliers, rank-gated access.',
    surfaces: ['/api/v1/rank/*', 'requireRank middleware'],
  },
  {
    id: 'notifications', title: 'Notifications', since: 'V136', maturity: 'stable',
    summary: 'In-app notification queue: tier promotions, streak reminders, broadcasts.',
    surfaces: ['/api/v1/rank/notifications/*'],
  },
  {
    id: 'workspace', title: 'Workspaces & Tasks', since: 'V104', maturity: 'stable',
    summary: 'Workspace task lifecycle: create/update/assign/delete, bulk ops, recurrence, time-tracking.',
    surfaces: ['/api/v1/workspaces/:id/tasks/*', 'recurrence', 'bulk-status', 'time-tracking'],
  },
  {
    id: 'events', title: 'Event Log', since: 'V181', maturity: 'stable',
    summary: 'Per-workspace event ring buffer with cursor pagination.',
    surfaces: ['/api/v1/workspaces/:id/events/log'],
  },
  {
    id: 'digest', title: 'Event Digest & Analytics', since: 'V191', maturity: 'stable',
    summary: 'Read-only aggregation: counts by type, top senders, time range, hour histogram, type-gap, heatmaps, burst detection.',
    surfaces: ['/api/v1/workspaces/:id/events/digest', '…/type-gap', '…/hour-heatmap', '…/burst'],
  },
  {
    id: 'broadcast', title: 'Realtime Broadcast & SSE', since: 'V179', maturity: 'stable',
    summary: 'Fan-out message delivery to registered workspace clients (WS / SSE).',
    surfaces: ['/api/v1/workspaces/:id/broadcast', '…/events/stream'],
  },
  {
    id: 'bookmarks', title: 'Bookmarks', since: 'V184', maturity: 'stable',
    summary: 'Named workspace bookmarks: set/get/list/bulk-delete.',
    surfaces: ['/api/v1/workspaces/:id/events/bookmarks/*'],
  },
  {
    id: 'snapshots', title: 'Stats Snapshots', since: 'V185', maturity: 'stable',
    summary: 'Point-in-time stats snapshots with diff and trim.',
    surfaces: ['/api/v1/workspaces/:id/events/stats/snapshots/*'],
  },
  {
    id: 'tokens', title: 'Tokens & Auth', since: 'V181', maturity: 'stable',
    summary: 'Workspace token service with expiry and bulk rotation.',
    surfaces: ['/api/v1/workspaces/:id/token', '/api/v1/admin/tokens/bulk-rotate'],
  },
  {
    id: 'admin', title: 'Admin & Observability', since: 'V148', maturity: 'stable',
    summary: 'Per-version admin summaries, system readiness, capability self-map.',
    surfaces: ['/api/v1/admin/summary/v*', '/api/v1/system/readiness', '/api/v1/system/capabilities'],
  },
];

const MATURITY_RANK = { core: 3, stable: 2, beta: 1, experimental: 0 };

/**
 * Build the navigable capability map + rollups. Pure.
 * @param {Array} [domains=CAPABILITY_DOMAINS]
 * @returns {{ generatedAt, version, totalDomains, totalSurfaces, byMaturity, domains }}
 */
function buildCapabilityMap(domains = CAPABILITY_DOMAINS, version = '207.0.0') {
  const byMaturity = {};
  let totalSurfaces = 0;
  for (const d of domains) {
    byMaturity[d.maturity] = (byMaturity[d.maturity] || 0) + 1;
    totalSurfaces += (d.surfaces ? d.surfaces.length : 0);
  }
  const sorted = domains.slice().sort((a, b) =>
    (MATURITY_RANK[b.maturity] || 0) - (MATURITY_RANK[a.maturity] || 0) || a.title.localeCompare(b.title));
  return {
    generatedAt: new Date().toISOString(),
    version,
    totalDomains: domains.length,
    totalSurfaces,
    byMaturity,
    domains: sorted,
  };
}

// ── 2) Burst detector (V207-T02) ───────────────────────────────────────────────
class BurstValidationError207 extends Error {
  constructor(msg) { super(msg); this.name = 'BurstValidationError207'; this.code = 'BURST_VALIDATION'; this.statusCode = 400; }
}

/**
 * Detect contiguous fixed windows whose event count meets/exceeds `threshold`.
 * Events are bucketed into [floor(t/windowMs)] windows by their `sentAt`.
 * Adjacent qualifying windows are merged into a single burst.
 * @param {Array<{sentAt?:string}>} events
 * @param {{ windowMs?:number, threshold?:number }} [opts]
 * @returns {{ windowMs, threshold, totalEvents, burstCount, bursts }}
 */
function detectBursts(events, opts = {}) {
  if (!Array.isArray(events)) throw new BurstValidationError207('events must be an array');
  const windowMs  = opts.windowMs  === undefined || opts.windowMs  === null || opts.windowMs  === '' ? 60_000 : parseInt(opts.windowMs, 10);
  const threshold = opts.threshold === undefined || opts.threshold === null || opts.threshold === '' ? 5      : parseInt(opts.threshold, 10);
  if (!Number.isFinite(windowMs)  || windowMs  < 1) throw new BurstValidationError207('windowMs must be >= 1');
  if (!Number.isFinite(threshold) || threshold < 1) throw new BurstValidationError207('threshold must be >= 1');

  // bucket events by window index
  const buckets = new Map(); // windowIndex -> count
  let counted = 0;
  for (const e of events) {
    const ts = e && e.sentAt;
    if (!ts) continue;
    const ms = new Date(ts).getTime();
    if (isNaN(ms)) continue;
    const idx = Math.floor(ms / windowMs);
    buckets.set(idx, (buckets.get(idx) || 0) + 1);
    counted++;
  }

  const qualifying = [...buckets.entries()]
    .filter(([, c]) => c >= threshold)
    .sort((a, b) => a[0] - b[0]);

  // merge adjacent windows into bursts
  const bursts = [];
  for (const [idx, count] of qualifying) {
    const last = bursts[bursts.length - 1];
    if (last && idx === last._lastIdx + 1) {
      last.windows += 1;
      last.count   += count;
      last.endMs    = (idx + 1) * windowMs;
      last._lastIdx = idx;
    } else {
      bursts.push({ startMs: idx * windowMs, endMs: (idx + 1) * windowMs, windows: 1, count, _lastIdx: idx });
    }
  }
  for (const b of bursts) {
    b.startAt = new Date(b.startMs).toISOString();
    b.endAt   = new Date(b.endMs).toISOString();
    delete b._lastIdx;
  }
  return { windowMs, threshold, totalEvents: counted, burstCount: bursts.length, bursts };
}

module.exports = {
  CAPABILITY_DOMAINS,
  buildCapabilityMap,
  detectBursts,
  BurstValidationError207,
  MATURITY_RANK,
};
