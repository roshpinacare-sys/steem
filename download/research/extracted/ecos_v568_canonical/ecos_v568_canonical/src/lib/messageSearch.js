/**
 * messageSearch.js — ECOS V141
 * ─────────────────────────────────────────────────────────────────────────────
 * [V141-FTS-01] Channel message full-text search.
 *
 * Two-tier strategy:
 *   1. PostgreSQL tsvector GIN index (primary — fast, ranking-aware)
 *   2. In-memory naive filter (fallback when DB unavailable)
 *
 * Usage:
 *   const searcher = getMessageSearcher();
 *   searcher.setPool(pool);
 *   const result = await searcher.search({ channelId, q, limit, cursor });
 *
 * DB objects created by migration_phase24.sql:
 *   - comm_messages.fts_vector tsvector column
 *   - comm_messages_fts_idx GIN index
 *
 * [V141-FTS-01] Initial implementation
 */

'use strict';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT     = 100;

class MessageSearcher {
  constructor() {
    this._pool    = null;
    this._enabled = true; // set false to force in-memory fallback in tests
  }

  setPool(pool) { this._pool = pool; }
  setEnabled(v) { this._enabled = !!v; }

  /**
   * Search messages in a channel.
   *
   * @param {object} opts
   * @param {string}  opts.channelId
   * @param {string}  opts.q            — search query (required, min 1 char)
   * @param {number}  [opts.limit=20]   — max results (cap 100)
   * @param {string}  [opts.cursor]     — opaque cursor (id-based pagination)
   * @param {string}  [opts.userId]     — filter by sender
   * @param {string}  [opts.since]      — ISO timestamp lower bound
   * @param {string}  [opts.until]      — ISO timestamp upper bound
   * @returns {Promise<{ results: object[], hasMore: boolean, nextCursor: string|null, total: number|null, source: 'db'|'memory' }>}
   */
  async search(opts = {}) {
    const { channelId, q, userId, since, until } = opts;
    const limit = Math.min(parseInt(opts.limit || DEFAULT_LIMIT, 10), MAX_LIMIT);
    const cursor = opts.cursor || null;

    if (!channelId) throw new Error('[MessageSearcher] channelId is required');
    if (!q || !q.trim()) throw new Error('[MessageSearcher] q (query) is required');

    if (this._pool && this._enabled) {
      try {
        return await this._dbSearch({ channelId, q: q.trim(), limit, cursor, userId, since, until });
      } catch (err) {
        // Fallback to in-memory — non-fatal
        console.warn('[MessageSearcher] DB search failed, falling back to memory:', err.message);
      }
    }
    return this._memorySearch({ channelId, q: q.trim(), limit, cursor, userId, since, until });
  }

  // ── DB search (PostgreSQL tsvector) ────────────────────────────────────────

  async _dbSearch({ channelId, q, limit, cursor, userId, since, until }) {
    const params = [];
    const conditions = [`channel_id = $${params.push(channelId)}`];

    // Full-text search via tsvector column
    // Wrap each word with :* for prefix matching
    const tsquery = q.trim().split(/\s+/)
      .filter(Boolean)
      .map(word => word.replace(/[^a-zA-Z0-9_\u0080-\uFFFF]/g, '') || word)
      .join(' & ');
    conditions.push(`fts_vector @@ to_tsquery('simple', $${params.push(tsquery + ':*')})`);

    if (cursor)  conditions.push(`id < $${params.push(parseInt(cursor, 10))}`);
    if (userId)  conditions.push(`from_user_id = $${params.push(userId)}`);
    if (since)   conditions.push(`created_at >= $${params.push(since)}`);
    if (until)   conditions.push(`created_at <= $${params.push(until)}`);

    const whereClause = conditions.join(' AND ');

    // Count total matching (without cursor, for pagination metadata)
    let total = null;
    try {
      const countParams = params.slice(0, cursor ? params.indexOf(parseInt(cursor, 10)) : params.length);
      const countConds  = conditions.filter(c => !c.includes('id <'));
      const countRes = await this._pool.query(
        `SELECT COUNT(*) FROM comm_messages WHERE ${countConds.join(' AND ')}`,
        params.filter((_, i) => {
          const p = `$${i + 1}`;
          return !conditions.find(c => c.includes('id <') && c.includes(p));
        }).slice(0, countConds.length)
      );
      total = parseInt(countRes.rows[0].count, 10);
    } catch (_) { /* non-fatal */ }

    const sql = `
      SELECT id, channel_id, from_user_id, body, parent_id, reply_count,
             ts_rank(fts_vector, to_tsquery('simple', $2)) AS rank,
             created_at, updated_at
      FROM comm_messages
      WHERE ${whereClause}
      ORDER BY rank DESC, id DESC
      LIMIT $${params.push(limit + 1)}
    `;

    const result = await this._pool.query(sql, params);
    const rows   = result.rows;
    const hasMore = rows.length > limit;
    const items   = rows.slice(0, limit);
    const nextCursor = hasMore ? String(items[items.length - 1].id) : null;

    return { results: items, hasMore, nextCursor, total, source: 'db' };
  }

  // ── In-memory fallback ────────────────────────────────────────────────────

  _memorySearch({ channelId, q, limit, cursor, userId, since, until }) {
    // This fallback requires messages to be injected for tests
    const messages = this._memoryMessages || [];
    const lower = q.toLowerCase();
    const cursorId = cursor ? parseInt(cursor, 10) : Infinity;

    let results = messages
      .filter(m => {
        if (m.channel_id !== channelId) return false;
        if (!m.body?.toLowerCase().includes(lower)) return false;
        if (cursor && m.id >= cursorId) return false;
        if (userId && m.from_user_id !== userId) return false;
        if (since && new Date(m.created_at) < new Date(since)) return false;
        if (until && new Date(m.created_at) > new Date(until)) return false;
        return true;
      })
      .sort((a, b) => b.id - a.id)
      .slice(0, limit + 1);

    const hasMore   = results.length > limit;
    const items     = results.slice(0, limit);
    const nextCursor = hasMore ? String(items[items.length - 1].id) : null;
    return { results: items, hasMore, nextCursor, total: null, source: 'memory' };
  }

  /** Inject messages for in-memory fallback (tests / offline) */
  seedMemory(messages) {
    this._memoryMessages = messages;
  }

  stats() {
    return {
      poolConnected: !!this._pool,
      enabled:       this._enabled,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
let _instance = null;
function getMessageSearcher() {
  if (!_instance) _instance = new MessageSearcher();
  return _instance;
}

module.exports = { MessageSearcher, getMessageSearcher };
